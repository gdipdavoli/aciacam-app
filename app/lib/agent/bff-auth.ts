import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { authJson, isTemporaryAuthFailure, preserveSupabaseAuthResponse } from '@/app/lib/supabase/auth-response';
import { validateEnvironmentOrThrow } from '@/app/lib/env-guard';

export type AgentTargetService = 'python' | 'typescript';

export interface VerifiedBffIdentity {
  userId: string;
  socioId: string;
  userRole: string;
}

export interface VerifyBffIdentityOptions {
  allowBearer?: boolean;
  unauthenticatedMessage?: string;
  unlinkedSocioMessage?: string;
  unauthorizedRoleMessage?: string;
}

export type BffIdentityResult =
  | { success: true; identity: VerifiedBffIdentity; authResponse: NextResponse }
  | { success: false; response: NextResponse };

export interface DelegatedBffContext extends VerifiedBffIdentity {
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
 * Resuelve y verifica de forma canónica la sesión del usuario y su perfil en public.socios.
 * - Valida primero la sesión autenticada de Supabase (SSR cookies, y opcionalmente Bearer JWT).
 * - Consulta public.socios EXCLUSIVAMENTE en el servidor mediante SUPABASE_SERVICE_ROLE_KEY
 *   filtrando por auth_user_id = user.id (aislado de permisos DDL del rol authenticated y sin exponer service_role al cliente).
 * - Distingue de forma determinística y fail-closed entre:
 *   1. Error interno de consulta a base de datos (500)
 *   2. Usuario autenticado no vinculado a un socio o con multiplicidad de registros (403)
 *   3. Rol no autorizado para la operación (403)
 */
export async function resolveVerifiedBffIdentity(
  request: NextRequest,
  allowedRoles: string[] = ['admin', 'staff'],
  options: VerifyBffIdentityOptions = {}
): Promise<BffIdentityResult> {
  const {
    allowBearer = true,
    unauthenticatedMessage = 'No autenticado',
    unlinkedSocioMessage = 'No se pudo resolver el perfil de socio para la sesión activa',
    unauthorizedRoleMessage,
  } = options;

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

    // 1. Validar primero la sesión/JWT del usuario (vía Bearer Header opcional o Cookie SSR)
    let user = null;
    if (allowBearer) {
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
    }

    if (!user) {
      authResponse = NextResponse.next();
      const supabaseUserClient = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options: cookieOpts }) =>
              authResponse?.cookies.set(name, value, cookieOpts)
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
        response: authJson(authResponse, { error: unauthenticatedMessage }, { status: 401 }),
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
          { error: 'Error al consultar perfil de socio' },
          { status: 500 }
        ),
      };
    }

    const sociosList = Array.isArray(socios)
      ? socios
      : socios && typeof socios === 'object' && 'id' in socios
        ? [socios as { id: string; rol: string }]
        : [];

    if (sociosList.length === 0) {
      return {
        success: false,
        response: authJson(
          authResponse,
          { error: unlinkedSocioMessage },
          { status: 403 }
        ),
      };
    }

    // Rechazar explícitamente multiplicidad de perfiles vinculados
    if (sociosList.length > 1) {
      return {
        success: false,
        response: authJson(
          authResponse,
          { error: 'Inconsistencia de perfil: se encontraron múltiples registros vinculados' },
          { status: 403 }
        ),
      };
    }

    const socio = sociosList[0];
    const userRole = String(socio.rol || '').toLowerCase().trim();

    if (!allowedRoles.includes(userRole)) {
      return {
        success: false,
        response: authJson(
          authResponse,
          {
            error:
              unauthorizedRoleMessage ||
              `Acceso denegado: Rol '${userRole}' no autorizado para esta operación`,
          },
          { status: 403 }
        ),
      };
    }

    return {
      success: true,
      identity: {
        userId: user.id,
        socioId: socio.id,
        userRole,
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

/**
 * Construye el contexto S2S hacia el servicio Agent Core correspondiente ('python' o 'typescript')
 * a partir de una identidad BFF previamente verificada.
 */
export function resolveDelegatedUpstreamContext(
  identity: VerifiedBffIdentity,
  authResponse: NextResponse,
  targetService: AgentTargetService = 'python'
): BffAuthResult {
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
    const errorMsg =
      targetService === 'typescript'
        ? 'Configuración S2S de Agent Core (worker) no disponible en el servidor'
        : 'Configuración S2S de Agent Core no disponible en el servidor';
    return {
      success: false,
      response: authJson(authResponse, { error: errorMsg }, { status: 500 }),
    };
  }

  const s2sHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Agent-Core-Secret': agentCoreBffSecret,
    'Authorization': 'Bearer ' + agentCoreBffSecret,
    'X-Delegated-Auth-User-Id': identity.userId,
    'X-Delegated-Socio-Id': identity.socioId,
    'X-Delegated-User-Role': identity.userRole,
  };

  return {
    success: true,
    context: {
      ...identity,
      agentCoreBaseUrl,
      agentCoreBffSecret,
      s2sHeaders,
      targetService,
    },
    authResponse,
  };
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
  const identityResult = await resolveVerifiedBffIdentity(request, allowedRoles, {
    allowBearer: true,
  });
  if (!identityResult.success) {
    return identityResult;
  }

  return resolveDelegatedUpstreamContext(
    identityResult.identity,
    identityResult.authResponse,
    targetService
  );
}
