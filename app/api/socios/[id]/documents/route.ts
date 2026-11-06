import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticate, hasStaffRole } from '@/app/lib/api-auth';

export const runtime = 'nodejs';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    }
);

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const authResult = await authenticate(request, supabaseAdmin);
        const caller = (authResult && typeof authResult === 'object' && 'user' in authResult)
            ? (authResult as any).user
            : authResult;

        if (!caller) return NextResponse.json({ error: 'Iniciá sesión para continuar' }, { status: 401 });

        const { id } = await context.params;
        if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
        }

        // Verify owner or staff
        const isStaff = await hasStaffRole(caller, supabaseAdmin);
        if (!isStaff) {
            const { data: owner } = await supabaseAdmin
                .from('socios')
                .select('auth_user_id')
                .eq('id', id)
                .maybeSingle();

            if (!owner || owner.auth_user_id !== caller.id) {
                return NextResponse.json({ error: 'No tenés permisos para consultar estos documentos' }, { status: 403 });
            }
        }

        const { data: docs, error } = await supabaseAdmin
            .from('documentos_socio')
            .select('id, socio_id, tipo, archivo_path, estado, verificacion_estado, verificacion_obs, verificado_at, verificado_por, fecha_emision, fecha_vencimiento, version, supersedes_document_id, is_current, created_at')
            .eq('socio_id', id)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching documentos_socio:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(docs || [], {
            headers: { 'Cache-Control': 'private, no-store' }
        });
    } catch (e: any) {
        console.error('Documents API error:', e);
        return NextResponse.json({ error: e.message || 'Error interno del servidor' }, { status: 500 });
    }
}

