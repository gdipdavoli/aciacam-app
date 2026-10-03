import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export interface DelegatedBffContext {
  userId: string;
  socioId: string;
  userRole: string;
  agentCoreBaseUrl: string;
  agentCoreBffSecret: string;
  s2sHeaders: Record<string, string>;
}

export type BffAuthResult =
  | { success: true; context: DelegatedBffContext }
  | { success: false; response: NextResponse };

/**
 * Helper canónico de autenticación y autorización BFF para S2S Agent Core.
 * Resuelve la identidad de socio EXCLUSIVAMENTE vía public.socios.auth_user_id = auth.users.id.
 * Sin fallbacks de identidad alternativa ni consultas disyuntivas.
 */
export async function getDelegatedBffContext(
  request: NextRequest,
  allowedRoles: string[] = ['admin', 'staff']
): Promise<BffAuthResult> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return {
        success: false,
        response: NextResponse.json(
          { error: 'Configuración de Supabase incompleta en el servidor' },
          { status: 500 }
        ),
      };
    }

    const response = NextResponse.next();
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        response: NextResponse.json({ error: 'No autenticado' }, { status: 401 }),
      };
    }

    // Lookup estricto de socio usando EXCLUSIVAMENTE auth_user_id
    const { data: socio, error: socioError } = await supabase
      .from('socios')
      .select('id, rol')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (socioError || !socio) {
      return {
        success: false,
        response: NextResponse.json(
          { error: 'No se pudo resolver el perfil de socio para la sesión activa' },
          { status: 403 }
        ),
      };
    }

    const userRole = String(socio.rol || '').toLowerCase().trim();

    if (!allowedRoles.includes(userRole)) {
      return {
        success: false,
        response: NextResponse.json(
          { error: `Acceso denegado: Rol '${userRole}' no autorizado para esta operación` },
          { status: 403 }
        ),
      };
    }

    const agentCoreBaseUrl = process.env.AGENT_CORE_BASE_URL;
    const agentCoreBffSecret = process.env.AGENT_CORE_BFF_SECRET;

    if (!agentCoreBaseUrl || !agentCoreBffSecret) {
      return {
        success: false,
        response: NextResponse.json(
          { error: 'Configuración S2S de Agent Core no disponible en el servidor' },
          { status: 500 }
        ),
      };
    }

    const s2sHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Agent-Core-Secret': agentCoreBffSecret,
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
      },
    };
  } catch (error: any) {
    return {
      success: false,
      response: NextResponse.json(
        { error: error?.message || 'Error interno en autenticación BFF' },
        { status: 500 }
      ),
    };
  }
}
