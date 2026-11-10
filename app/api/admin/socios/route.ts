import { requireStaff } from '@/app/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/app/lib/supabase/server';
import { NextResponse } from 'next/server';
import { UserRole } from '@/types';

// Server-Role Supabase Client (Admin Access)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

/**
 * Interface para validar el rol del usuario solicitante
 */
interface CallerInfo {
    rol: UserRole;
}

export async function GET(request: Request) {
    try {
        const access = await requireStaff(request, supabaseAdmin);
        if (access.response) return access.response;

        // 4. Procesar consulta usando supabaseAdmin para evitar cualquier restricción de RLS
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
            console.error('API queryError:', queryError);
            return NextResponse.json({ error: `Error al consultar datos: ${queryError.message}`, details: queryError }, { status: 500 });
        }

        // 5. Retornar datos
        return NextResponse.json(socios);

    } catch (e: any) {
        console.error('API catch error:', e);
        return NextResponse.json({ error: `Error interno del servidor: ${e.message}` }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
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
            rol,
            status,
            reprocann_num_tramite,
            reprocann_fecha_alta,
            reprocann_fecha_vencimiento,
            reprocann_tipo,
            medico_nombre,
            medico_matricula,
            diagnostico,
            fecha_ingreso_ong
        } = body;

        // Validaciones mínimas obligatorias
        if (!nombre || !apellido || !dni || !email || !telefono) {
            return NextResponse.json({
                error: 'Campos requeridos faltantes: nombre, apellido, dni, email, telefono'
            }, { status: 400 });
        }

        const cleanEmail = String(email).trim().toLowerCase();
        const cleanDni = String(dni).trim();

        // Evitar duplicados por DNI o Email
        const { data: existingSocio } = await supabaseAdmin
            .from('socios')
            .select('id, email, dni')
            .or(`email.eq.${cleanEmail},dni.eq.${cleanDni}`)
            .maybeSingle();

        if (existingSocio) {
            const field = existingSocio.email === cleanEmail ? 'email' : 'DNI';
            return NextResponse.json({
                error: `Ya existe un socio registrado con el ${field} proporcionado (${field === 'email' ? cleanEmail : cleanDni})`
            }, { status: 409 });
        }

        const now = new Date().toISOString();
        const dbRow: any = {
            nombre: String(nombre).trim(),
            apellido: String(apellido).trim(),
            dni: cleanDni,
            email: cleanEmail,
            telefono: String(telefono).trim(),
            rol: rol || 'socio',
            status: status || 'draft',
            created_at: now,
            updated_at: now
        };

        const finalDomicilio = domicilio || direccion;
        if (finalDomicilio) dbRow.domicilio = String(finalDomicilio).trim();
        if (localidad) dbRow.localidad = String(localidad).trim();

        const finalFechaNac = fecha_nacimiento || fechaNacimiento;
        if (finalFechaNac) dbRow.fecha_nacimiento = finalFechaNac;

        if (reprocann_num_tramite) dbRow.reprocann_num_tramite = String(reprocann_num_tramite).trim();
        if (reprocann_fecha_alta) dbRow.reprocann_fecha_alta = reprocann_fecha_alta;
        if (reprocann_fecha_vencimiento) dbRow.reprocann_fecha_vencimiento = reprocann_fecha_vencimiento;
        if (reprocann_tipo) dbRow.reprocann_tipo = String(reprocann_tipo).trim();

        if (medico_nombre) dbRow.medico_nombre = String(medico_nombre).trim();
        if (medico_matricula) dbRow.medico_matricula = String(medico_matricula).trim();
        if (diagnostico) dbRow.diagnostico = String(diagnostico).trim();
        if (fecha_ingreso_ong) dbRow.fecha_ingreso_ong = fecha_ingreso_ong;

        const { data: newSocio, error: insErr } = await supabaseAdmin
            .from('socios')
            .insert(dbRow)
            .select()
            .single();

        if (insErr) {
            console.error('Error inserting socio in /api/admin/socios:', insErr);
            return NextResponse.json({ error: insErr.message }, { status: 500 });
        }

        // Registro de Auditoría Administrativa
        try {
            await supabaseAdmin.from('audit_logs').insert({
                user_id: access.user!.id,
                action: 'CREATE_SOCIO',
                entity_type: 'socios',
                entity_id: newSocio.id,
                details: {
                    nombre: newSocio.nombre,
                    apellido: newSocio.apellido,
                    dni: newSocio.dni,
                    email: newSocio.email,
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
