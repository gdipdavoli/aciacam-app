import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { authJson, isTemporaryAuthFailure, preserveSupabaseAuthResponse } from '@/app/lib/supabase/auth-response';
import { validateEnvironmentOrThrow } from '@/app/lib/env-guard';

export type AgentTargetService = 'python' | 'typescript';

export interface DelegatedBffContext {
  userId: string;
  socioId: string;
  userRole: string;
  agentCoreBaseUrl: string;
  agentCoreBffSecret: string;
  s2sHeaders: Record<string, string>;
  targetService: AgentTargetService;
}

export type BffAuthResult =
  | { success: true; context: DelegatedBffContext; authResponse: NextResponse }
  | { success: false; response: NextResponse };

export function withBffAuthResponse<T extends NextResponse>(auth: BffAuthResult, response: T): T {
  return auth.success ? preserveSupabaseAuthResponse(response, auth.authResponse) : response;
}

/**
 * Helper canónico de autenticación y autorización BFF para S2S Agent Core.
 * Resuelve la identidad de socio EXCLUSIVAMENTE vía public.socios.auth_user_id = auth.users.id.
 * Sin fallbacks de identidad alternativa ni consultas disyuntivas.
 *
 * Soporta resolución dual:
 * - targetService === 'python': resuelve AGENT_CORE_PYTHON_URL || AGENT_CORE_BASE_URL || AGENT_CORE_URL
 * - targetService === 'typescript': resuelve AGENT_CORE_ORDER_WORKER_URL || AGENT_CORE_BASE_URL
 */
export async function getDelegatedBffContext(
  request: NextRequest,
  allowedRoles: string[] = ['admin', 'staff'],
  targetService: AgentTargetService = 'python'
): Promise<BffAuthResult> {
  let authResponse: NextResponse | null = null;
  try {
    validateEnvironmentOrThrow();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return {
        success: false,
        response: authJson(
          null,
          { error: 'Configuración de Supabase incompleta en el servidor' },
          { status: 500 }
        ),
      };
    }

    // 1. Validar primero la sesión/JWT del usuario (vía Bearer Header o Cookie SSR)
    let user = null;
    const authHeader = request.headers.get('authorization');
    if (authHeader && /^Bearer\s+\S+$/i.test(authHeader)) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const adminAuthClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: authData, error: bearerAuthError } = await adminAuthClient.auth.getUser(token);
      if (bearerAuthError && isTemporaryAuthFailure(bearerAuthError)) {
        return {
          success: false,
          response: authJson(
            null,
            { error: 'Autenticación temporalmente no disponible. Reintentá en unos instantes.' },
            { status: 503 }
          ),
        };
      }
      user = authData?.user || null;
    }

    if (!user) {
      authResponse = NextResponse.next();
      const supabaseUserClient = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              authResponse?.cookies.set(name, value, options)
            );
          },
        },
      });

      const { data: authData, error: authError } = await supabaseUserClient.auth.getUser();
      if (!authError && authData?.user) {
        user = authData.user;
      } else if (authError && isTemporaryAuthFailure(authError)) {
        return {
          success: false,
          response: authJson(
            authResponse,
            { error: 'Autenticación temporalmente no disponible. Reintentá en unos instantes.' },
            { status: 503 }
          ),
        };
      }
    }

    if (!user) {
      return {
        success: false,
        response: authJson(authResponse, { error: 'No autenticado' }, { status: 401 }),
      };
    }

    // 2. Resolver socio usando cliente server-side service_role (aislado de permisos DDL de tabla)
    //    Seleccionando EXCLUSIVAMENTE id y rol vía auth_user_id = user.id
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: socios, error: socioError } = await supabaseAdmin
      .from('socios')
      .select('id, rol')
      .eq('auth_user_id', user.id);

    if (socioError) {
      return {
        success: false,
        response: authJson(
          authResponse,
          { error: 'Error al consultar perfil de socio', detail: socioError.message },
          { status: 500 }
        ),
      };
    }

    if (!socios || socios.length === 0) {
      return {
        success: false,
        response: authJson(
          authResponse,
          { error: 'No se pudo resolver el perfil de socio para la sesión activa' },
          { status: 403 }
        ),
      };
    }

    // Rechazar explícitamente multiplicidad de perfiles vinculados
    if (socios.length > 1) {
      return {
        success: false,
        response: authJson(
          authResponse,
          { error: 'Inconsistencia de perfil: se encontraron múltiples registros vinculados' },
          { status: 403 }
        ),
      };
    }

    const socio = socios[0];
    const userRole = String(socio.rol || '').toLowerCase().trim();

    if (!allowedRoles.includes(userRole)) {
      return {
        success: false,
        response: authJson(
          authResponse,
          { error: `Acceso denegado: Rol '${userRole}' no autorizado para esta operación` },
          { status: 403 }
        ),
      };
    }

    // 3. Resolución segura de destino según targetService
    let agentCoreBaseUrl: string | undefined;
    let agentCoreBffSecret: string | undefined;

    if (targetService === 'typescript') {
      agentCoreBaseUrl = process.env.AGENT_CORE_ORDER_WORKER_URL || process.env.AGENT_CORE_BASE_URL;
      agentCoreBffSecret = process.env.AGENT_CORE_ORDER_WORKER_SECRET || process.env.AGENT_CORE_BFF_SECRET;
    } else {
      agentCoreBaseUrl = process.env.AGENT_CORE_PYTHON_URL || process.env.AGENT_CORE_BASE_URL || process.env.AGENT_CORE_URL;
      agentCoreBffSecret = process.env.AGENT_CORE_BFF_SECRET;
    }

    if (!agentCoreBaseUrl || !agentCoreBffSecret) {
      return {
        success: false,
        response: authJson(
          authResponse,
          { error: `Configuración S2S de Agent Core (${targetService}) no disponible en el servidor` },
          { status: 500 }
        ),
      };
    }

    const s2sHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Agent-Core-Secret': agentCoreBffSecret,
      'Authorization': 'Bearer ' + agentCoreBffSecret,
      'X-Delegated-Auth-User-Id': user.id,
      'X-Delegated-Socio-Id': socio.id,
      'X-Delegated-User-Role': userRole,
    };

    return {
      success: true,
      context: {
        userId: user.id,
        socioId: socio.id,
        userRole,
        agentCoreBaseUrl,
        agentCoreBffSecret,
        s2sHeaders,
        targetService,
      },
      authResponse: authResponse || NextResponse.next(),
    };
  } catch (error: any) {
    return {
      success: false,
      response: authJson(
        authResponse,
        { error: error?.message || 'Error interno en autenticación BFF' },
        { status: 500 }
      ),
    };
  }
}
