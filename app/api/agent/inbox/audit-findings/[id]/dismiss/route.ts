import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    if (userRole !== 'admin') {
      return NextResponse.json(
        { error: 'Acceso denegado: Se requiere rol admin para realizar acciones sobre el Admin Inbox' },
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

    let bodyPayload = {};
    try {
      const text = await request.text();
      if (text) {
        bodyPayload = JSON.parse(text);
      }
    } catch (e) {
      bodyPayload = {};
    }

    const targetUrl = new URL(
      '/api/v1/inbox/audit-findings/' + (await params).id + '/dismiss',
      agentCoreBaseUrl
    );

    const agentCoreResponse = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Core-Secret': agentCoreBffSecret,
        'X-Delegated-Auth-User-Id': user.id,
        'X-Delegated-Socio-Id': socio.id,
        'X-Delegated-User-Role': userRole,
      },
      body: JSON.stringify(bodyPayload),
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
