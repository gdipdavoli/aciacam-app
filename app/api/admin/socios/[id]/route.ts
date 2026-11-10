import { authenticate, hasStaffRole, requireStaff } from '@/app/lib/api-auth';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { isValidCalendarDate } from '@/app/lib/date-format';

let _adminClient: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient {
    if (_adminClient) return _adminClient;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase credentials are missing');
    _adminClient = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    return _adminClient;
}

const ALLOWED_SOCIO_COLUMNS = 'id, auth_user_id, nombre, apellido, dni, email, telefono, domicilio, localidad, fecha_nacimiento, rol, status, fecha_ingreso_ong, envios_habilitados, bloqueado, motivo_bloqueo, reprocann_num_tramite, reprocann_fecha_alta, reprocann_fecha_vencimiento, reprocann_tipo, medico_nombre, medico_matricula, diagnostico, created_at, updated_at, onboarding_completed_at, terms_accepted_at';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const supabaseAdmin = getSupabaseAdmin();
        const authResult = await authenticate(request, supabaseAdmin);
        const caller = (authResult && typeof authResult === 'object' && 'user' in authResult)
            ? (authResult as any).user
            : authResult;

        if (!caller) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

        const { id } = await params;
        if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
        }

        // Fetch socio explicitly from public.socios with curated allowed columns
        const { data: socio, error } = await supabaseAdmin
            .from('socios')
            .select(ALLOWED_SOCIO_COLUMNS)
            .eq('id', id)
            .single();

        if (error || !socio) {
            return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
        }

        const socioData = socio as unknown as Record<string, any>;

        // Access check: only owner or staff/admin
        if (socioData.auth_user_id !== caller.id && !await hasStaffRole(caller, supabaseAdmin)) {
            return NextResponse.json({ error: "No autorizado" }, { status: 403 });
        }

        // Fetch associated documents via service role to bypass client RLS restrictions
        const { data: docs } = await supabaseAdmin
            .from('documentos_socio')
            .select('id, socio_id, tipo, archivo_path, estado, verificacion_estado, verificacion_obs, verificado_at, verificado_por, fecha_emision, fecha_vencimiento, version, supersedes_document_id, is_current, created_at')
            .eq('socio_id', id)
            .order('created_at', { ascending: false });

        return NextResponse.json(
            { ...socioData, documentos: docs || [] },
            { headers: { "Cache-Control": "private, no-store" } }
        );
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
        }

        const supabaseAdmin = getSupabaseAdmin();
        const access = await requireStaff(request, supabaseAdmin);
        if (access.response) return access.response;

        const body = await request.json();
        const allowedUpdates: any = {};

        if (body.nombre !== undefined) allowedUpdates.nombre = String(body.nombre).trim();
        if (body.apellido !== undefined) allowedUpdates.apellido = String(body.apellido).trim();
        if (body.dni !== undefined) allowedUpdates.dni = String(body.dni).trim();
        if (body.telefono !== undefined) allowedUpdates.telefono = String(body.telefono).trim();
        if (body.email !== undefined) allowedUpdates.email = String(body.email).trim().toLowerCase();
        if (body.domicilio !== undefined || body.direccion !== undefined) {
            allowedUpdates.domicilio = String(body.domicilio || body.direccion).trim();
        }
        if (body.localidad !== undefined) allowedUpdates.localidad = String(body.localidad).trim();
        if (body.envios_habilitados !== undefined) allowedUpdates.envios_habilitados = Boolean(body.envios_habilitados);

        if (body.fecha_nacimiento !== undefined || body.fechaNacimiento !== undefined) {
            const rawDate = (body.fecha_nacimiento || body.fechaNacimiento || '').trim();
            if (rawDate === '' || rawDate === null) {
                allowedUpdates.fecha_nacimiento = null;
            } else {
                if (!isValidCalendarDate(rawDate)) {
                    return NextResponse.json({ error: 'La fecha de nacimiento no es una fecha calendario válida' }, { status: 400 });
                }
                allowedUpdates.fecha_nacimiento = rawDate;
            }
        }

        if (body.reprocann_num_tramite !== undefined) {
            allowedUpdates.reprocann_num_tramite = body.reprocann_num_tramite ? String(body.reprocann_num_tramite).trim() : null;
        }
        if (body.reprocann_fecha_alta !== undefined) allowedUpdates.reprocann_fecha_alta = body.reprocann_fecha_alta || null;
        if (body.reprocann_fecha_vencimiento !== undefined) allowedUpdates.reprocann_fecha_vencimiento = body.reprocann_fecha_vencimiento || null;
        if (body.reprocann_tipo !== undefined) {
            allowedUpdates.reprocann_tipo = body.reprocann_tipo ? String(body.reprocann_tipo).trim() : null;
        }

        if (body.medico_nombre !== undefined) allowedUpdates.medico_nombre = body.medico_nombre ? String(body.medico_nombre).trim() : null;
        if (body.medico_matricula !== undefined) allowedUpdates.medico_matricula = body.medico_matricula ? String(body.medico_matricula).trim() : null;
        if (body.diagnostico !== undefined) allowedUpdates.diagnostico = body.diagnostico ? String(body.diagnostico).trim() : null;

        allowedUpdates.updated_at = new Date().toISOString();

        const { data: updated, error } = await supabaseAdmin
            .from('socios')
            .update(allowedUpdates)
            .eq('id', id)
            .select(ALLOWED_SOCIO_COLUMNS)
            .single();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(updated);
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Error interno' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const supabaseAdmin = getSupabaseAdmin();
        const access = await requireStaff(request, supabaseAdmin, true);
        if (access.response) return access.response;
        const user = access.user!;

        // Fetch Target to get Auth ID
        const { data: targetSocio, error: fetchError } = await supabaseAdmin.from('socios').select('auth_user_id, email').eq('id', id).single();
        if (fetchError || !targetSocio) {
            return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
        }

        // Delete Auth User (if linked)
        let authUserDeleted = false;
        if (targetSocio.auth_user_id) {
            const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(targetSocio.auth_user_id);
            if (!deleteAuthError) authUserDeleted = true;
            else console.error("Failed to delete auth user by ID", deleteAuthError);
        }

        // Robust Cleanup: Search by email if not deleted yet
        if (!authUserDeleted && targetSocio.email) {
            const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
            if (!listError) {
                const orphanUser = users.find(u => u.email === targetSocio.email);
                if (orphanUser) {
                    console.log(`Clearing orphan auth user: ${orphanUser.id} for email ${targetSocio.email}`);
                    await supabaseAdmin.auth.admin.deleteUser(orphanUser.id);
                }
            }
        }

        // Delete Socio Record
        const { error: deleteSocioError } = await supabaseAdmin.from('socios').delete().eq('id', id);
        if (deleteSocioError) throw deleteSocioError;

        // Audit
        await supabaseAdmin.from('audit_logs').insert({
            user_id: user.id,
            action: 'DELETE_SOCIO',
            entity_type: 'SOCIO',
            entity_id: id,
            details: { email: targetSocio.email, deleted_auth_id: targetSocio.auth_user_id }
        });

        return NextResponse.json({ success: true });

    } catch (e: any) {
        console.error("Delete Error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
