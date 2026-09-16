import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Configuración de Supabase incompleta en el servidor' },
        { status: 500 }
      );
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
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { data: socio, error: socioError } = await supabase
      .from('socios')
      .select('id, rol')
      .or('auth_user_id.eq.' + user.id + ',user_id.eq.' + user.id)
      .maybeSingle();

    if (socioError || !socio) {
      return NextResponse.json(
        { error: 'No se pudo resolver el perfil de socio para la sesión activa' },
        { status: 403 }
      );
    }

    const userRole = String(socio.rol || '').toLowerCase().trim();

    if (userRole === 'socio') {
      return NextResponse.json(
        { error: 'El rol socio no tiene autorización para acceder al Admin Inbox' },
        { status: 403 }
      );
    }

    if (!['admin', 'staff'].includes(userRole)) {
      return NextResponse.json(
        { error: 'Rol no reconocido ' + userRole },
        { status: 403 }
      );
    }

    const agentCoreBaseUrl = process.env.AGENT_CORE_BASE_URL;
    const agentCoreBffSecret = process.env.AGENT_CORE_BFF_SECRET;

    if (!agentCoreBaseUrl || !agentCoreBffSecret) {
      return NextResponse.json(
        { error: 'Configuración S2S de Agent Core no disponible en el servidor' },
        { status: 500 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const targetUrl = new URL('/api/v1/inbox/summary', agentCoreBaseUrl);
    searchParams.forEach((value, key) => {
      targetUrl.searchParams.append(key, value);
    });

    const agentCoreResponse = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Core-Secret': agentCoreBffSecret,
        'X-Delegated-Auth-User-Id': user.id,
        'X-Delegated-Socio-Id': socio.id,
        'X-Delegated-User-Role': userRole,
      },
      cache: 'no-store',
    });

    const data = await agentCoreResponse.json();
    return NextResponse.json(data, { status: agentCoreResponse.status });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Error interno en el BFF' },
      { status: 500 }
    );
  }
}
