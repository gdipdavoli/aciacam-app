import { requireStaff } from '@/app/lib/api-auth';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { UserRole } from '@/types';
import { isValidCalendarDate } from '@/app/lib/date-format';

// Helper de inicialización perezosa para evitar fallos de evaluación estática
let _adminClient: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient {
    if (_adminClient) return _adminClient;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error('Supabase credentials (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) are missing');
    }
    _adminClient = createClient(url, key, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
    return _adminClient;
}

/**
 * Interface para validar el rol del usuario solicitante
 */
interface CallerInfo {
    rol: UserRole;
}

export async function GET(request: Request) {
    try {
        const supabaseAdmin = getSupabaseAdmin();
        const access = await requireStaff(request, supabaseAdmin);
        if (access.response) return access.response;

        // Procesar consulta usando supabaseAdmin para evitar cualquier restricción de RLS
        const { searchParams } = new URL(request.url);
        const roleFilter = searchParams.get('role');

        let query = supabaseAdmin
            .from('socios_with_auth')
            .select('*')
            .order('created_at', { ascending: false });

        if (roleFilter) {
            query = query.eq('rol', roleFilter);
        }

        const { data: socios, error: queryError } = await query;

        if (queryError) {
            console.error('API queryError in GET /api/admin/socios:', queryError);
            return NextResponse.json({ error: `Error al consultar datos: ${queryError.message}`, details: queryError }, { status: 500 });
        }

        return NextResponse.json(socios);

    } catch (e: any) {
        console.error('API catch error in GET /api/admin/socios:', e);
        return NextResponse.json({ error: `Error interno del servidor: ${e.message}` }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const supabaseAdmin = getSupabaseAdmin();
        const access = await requireStaff(request, supabaseAdmin);
        if (access.response) return access.response;

        const body = await request.json();
        const {
            nombre,
            apellido,
            dni,
            email,
            telefono,
            domicilio,
            direccion,
            localidad,
            fecha_nacimiento,
            fechaNacimiento,
            envios_habilitados,
            rol,
            status,
            reprocann_num_tramite,
            reprocann_fecha_alta,
            reprocann_fecha_vencimiento,
            reprocann_tipo,
            medico_nombre,
            medico_matricula,
            diagnostico,
            fecha_ingreso_ong,
            idempotency_key,
            idempotencyKey: bodyIdempotencyKey
        } = body;

        // Clave de idempotencia única para cada operación de alta
        const clientHeaderKey = request.headers.get('Idempotency-Key') || request.headers.get('x-idempotency-key');
        const effectiveIdempotencyKey = (clientHeaderKey || idempotency_key || bodyIdempotencyKey || '').trim();

        // 1. COMPROBACIÓN DE IDEMPOTENCIA: Si la misma operación se reintenta, recuperar el socio resultante
        if (effectiveIdempotencyKey) {
            const { data: existingAudit } = await supabaseAdmin
                .from('audit_logs')
                .select('entity_id, details, created_at')
                .eq('action', 'CREATE_SOCIO')
                .contains('details', { idempotency_key: effectiveIdempotencyKey })
                .maybeSingle();

            if (existingAudit && existingAudit.entity_id) {
                const { data: createdSocio } = await supabaseAdmin
                    .from('socios')
                    .select('*')
                    .eq('id', existingAudit.entity_id)
                    .maybeSingle();

                if (createdSocio) {
                    console.log(`[Idempotencia] Reintento de operación ${effectiveIdempotencyKey}: recuperando socio ${createdSocio.id}`);
                    return NextResponse.json({ ...createdSocio, _idempotent_replay: true }, {
                        status: 200,
                        headers: { 'X-Idempotent-Replay': 'true' }
                    });
                }
            }
        }

        // 2. Validaciones mínimas obligatorias
        if (!nombre || !apellido || !dni || !email || !telefono) {
            return NextResponse.json({
                error: 'Campos requeridos faltantes: nombre, apellido, dni, email, telefono'
            }, { status: 400 });
        }

        const cleanEmail = String(email).trim().toLowerCase();
        const cleanDni = String(dni).trim();

        // 3. Control de duplicados por DNI o Email ANTES de procesar inserción
        const { data: duplicateSocio } = await supabaseAdmin
            .from('socios')
            .select('id, email, dni, created_at')
            .or(`email.eq.${cleanEmail},dni.eq.${cleanDni}`)
            .maybeSingle();

        if (duplicateSocio) {
            // Reintento rápido del mismo cliente sin idempotency_key (fallback por ventana de 2 minutos)
            const createdAtTime = new Date(duplicateSocio.created_at).getTime();
            const nowTime = Date.now();
            if (duplicateSocio.dni === cleanDni && duplicateSocio.email === cleanEmail && (nowTime - createdAtTime) < 120000) {
                console.log(`[Idempotencia] Recuperando socio existente recién creado (ID: ${duplicateSocio.id})`);
                return NextResponse.json(duplicateSocio, { status: 200 });
            }

            const field = duplicateSocio.email === cleanEmail ? 'email' : 'DNI';
            return NextResponse.json({
                error: `Ya existe un socio registrado con el ${field} proporcionado (${field === 'email' ? cleanEmail : cleanDni})`
            }, { status: 409 });
        }

        // 4. Verificación de fecha de nacimiento
        const finalFechaNac = String(fecha_nacimiento || fechaNacimiento || '').trim();
        if (finalFechaNac && !isValidCalendarDate(finalFechaNac)) {
            return NextResponse.json({ error: 'La fecha de nacimiento es inválida o no corresponde al calendario civil gregoriano' }, { status: 400 });
        }

        const now = new Date().toISOString();
        const dbRow: any = {
            nombre: String(nombre).trim(),
            apellido: String(apellido).trim(),
            dni: cleanDni,
            email: cleanEmail,
            telefono: String(telefono).trim(),
            envios_habilitados: envios_habilitados !== undefined ? Boolean(envios_habilitados) : true,
            rol: rol || 'socio',
            status: status || 'draft',
            created_at: now,
            updated_at: now
        };

        if (finalFechaNac) {
            dbRow.fecha_nacimiento = finalFechaNac; // Persistencia directa en public.socios.fecha_nacimiento
        }

        const finalDomicilio = domicilio || direccion;
        if (finalDomicilio) dbRow.domicilio = String(finalDomicilio).trim();
        if (localidad) dbRow.localidad = String(localidad).trim();

        if (reprocann_num_tramite && String(reprocann_num_tramite).trim()) {
            dbRow.reprocann_num_tramite = String(reprocann_num_tramite).trim();
        }
        if (reprocann_fecha_alta && String(reprocann_fecha_alta).trim()) {
            dbRow.reprocann_fecha_alta = String(reprocann_fecha_alta).trim();
        }
        if (reprocann_fecha_vencimiento && String(reprocann_fecha_vencimiento).trim()) {
            dbRow.reprocann_fecha_vencimiento = String(reprocann_fecha_vencimiento).trim();
        }
        if (reprocann_tipo && String(reprocann_tipo).trim()) {
            dbRow.reprocann_tipo = String(reprocann_tipo).trim();
        }

        if (medico_nombre && String(medico_nombre).trim()) dbRow.medico_nombre = String(medico_nombre).trim();
        if (medico_matricula && String(medico_matricula).trim()) dbRow.medico_matricula = String(medico_matricula).trim();
        if (diagnostico && String(diagnostico).trim()) dbRow.diagnostico = String(diagnostico).trim();
        if (fecha_ingreso_ong && String(fecha_ingreso_ong).trim()) dbRow.fecha_ingreso_ong = String(fecha_ingreso_ong).trim();

        // 5. Inserción protegida en base de datos
        const { data: newSocio, error: insErr } = await supabaseAdmin
            .from('socios')
            .insert(dbRow)
            .select()
            .single();

        if (insErr) {
            console.error('Error inserting socio in /api/admin/socios:', insErr);
            // Capturar posible colisión por carrera concurrente
            if (insErr.code === '23505' || insErr.message?.includes('duplicate key')) {
                return NextResponse.json({
                    error: `Ya existe un socio registrado con el DNI o correo proporcionado`
                }, { status: 409 });
            }
            return NextResponse.json({ error: insErr.message }, { status: 500 });
        }

        // 6. Registro de Auditoría Administrativa con vinculación de clave de idempotencia
        try {
            await supabaseAdmin.from('audit_logs').insert({
                user_id: access.user!.id,
                action: 'CREATE_SOCIO',
                entity_type: 'socios',
                entity_id: newSocio.id,
                details: {
                    idempotency_key: effectiveIdempotencyKey || null,
                    nombre: newSocio.nombre,
                    apellido: newSocio.apellido,
                    dni: newSocio.dni,
                    email: newSocio.email,
                    fecha_nacimiento: newSocio.fecha_nacimiento,
                    envios_habilitados: newSocio.envios_habilitados,
                    created_by_email: access.user!.email,
                    reprocann_num_tramite: newSocio.reprocann_num_tramite
                }
            });
        } catch (auditErr) {
            console.warn('Non-fatal audit error during socio creation:', auditErr);
        }

        return NextResponse.json(newSocio, { status: 201 });
    } catch (e: any) {
        console.error('API POST /api/admin/socios error:', e);
        return NextResponse.json({ error: e.message || 'Error interno del servidor' }, { status: 500 });
    }
}
