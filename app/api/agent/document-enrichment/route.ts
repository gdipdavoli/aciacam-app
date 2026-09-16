import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/app/lib/supabase/server';
import { NextResponse } from 'next/server';
import { UserRole } from '@/types';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

interface CallerInfo {
    id: string;
    rol: UserRole;
}

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get('Authorization');
        const token = authHeader?.replace('Bearer ', '');
        let user = null;

        if (token) {
            const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
            if (!authError && authUser) {
                user = authUser;
            }
        }

        if (!user) {
            const supabase = await createClientServer();
            const { data: { session }, error: authError } = await supabase.auth.getSession();
            if (!authError && session?.user) {
                user = session.user;
            }
        }

        if (!user) {
            return NextResponse.json({ error: 'No autorizado: Inicie sesión' }, { status: 401 });
        }

        const { data: caller, error: roleError } = await supabaseAdmin
            .from('socios')
            .select('id, rol')
            .or(`auth_user_id.eq.${user.id},user_id.eq.${user.id}`)
            .single();

        const callerInfo = caller as CallerInfo | null;
        if (roleError || !callerInfo || (callerInfo.rol !== 'admin' && callerInfo.rol !== 'staff')) {
            return NextResponse.json({ error: 'Prohibido: Se requieren permisos de administrador o staff' }, { status: 403 });
        }

        const agentCoreUrl = process.env.AGENT_CORE_BASE_URL || 'http://localhost:8000';
        const bffSecret = process.env.AGENT_CORE_BFF_SECRET;

        if (!bffSecret) {
            return NextResponse.json({ error: 'Error de servidor: Configuración S2S no establecida' }, { status: 500 });
        }

        const body = await request.json();

        if (!body.socio_id || !body.document_id) {
            return NextResponse.json({ error: 'Bad Request: socio_id y document_id son obligatorios' }, { status: 400 });
        }

        const response = await fetch(`${agentCoreUrl}/api/v1/orchestration/document-enrichment`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Agent-Core-Secret': bffSecret,
                'X-Delegated-Auth-User-Id': user.id,
                'X-Delegated-Socio-Id': callerInfo.id || '',
                'X-Delegated-User-Role': callerInfo.rol,
            },
            body: JSON.stringify({
                socio_id: body.socio_id,
                document_id: body.document_id,
                reason: body.reason || 'Solicitud de enriquecimiento documental desde App BFF',
            }),
        });

        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (e: any) {
        console.error('Error en BFF document-enrichment:', e);
        return NextResponse.json({ error: `Error interno del servidor: ${e.message}` }, { status: 500 });
    }
}
