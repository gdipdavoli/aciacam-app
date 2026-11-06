
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasStaffRole } from '@/app/lib/api-auth';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_SOCIO_COLUMNS = 'id, auth_user_id, nombre, apellido, dni, email, telefono, domicilio, localidad, rol, status, fecha_ingreso_ong, envios_habilitados, bloqueado, motivo_bloqueo, reprocann_num_tramite, reprocann_fecha_alta, reprocann_fecha_vencimiento, reprocann_tipo, medico_nombre, medico_matricula, diagnostico, created_at, updated_at, onboarding_completed_at, terms_accepted_at';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('id');

    if (!userId) {
        return NextResponse.json({ error: 'Missing user id' }, { status: 400 });
    }

    try {
        const user = await authenticate(request, supabaseAdmin);
        if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
            return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
        }
        if (user.id !== userId && !await hasStaffRole(user, supabaseAdmin)) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }
        const { data, error } = await supabaseAdmin
            .from('socios')
            .select(ALLOWED_SOCIO_COLUMNS)
            .eq('auth_user_id', userId)
            .maybeSingle();

        if (error) {
            console.error('Error fetching socio by user id:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        if (!data) {
            // Not found (404) is a valid state (unlinked user)
            return NextResponse.json(null, { status: 404 });
        }

        const socioData = data as unknown as Record<string, any>;

        // Fetch documents via service role to ensure consistent access across roles
        const { data: docs } = await supabaseAdmin
            .from('documentos_socio')
            .select('id, tipo, archivo_path, verificacion_estado, verificacion_obs, fecha_emision, fecha_vencimiento, is_current, version')
            .eq('socio_id', socioData.id);

        return NextResponse.json({ ...socioData, documentos: docs || [] }, { headers: { 'Cache-Control': 'private, no-store' } });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
