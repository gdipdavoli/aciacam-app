import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticate, hasStaffRole } from '@/app/lib/api-auth';
import { isValidCalendarDate } from '@/app/lib/date-format';

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

        const { searchParams } = new URL(request.url);
        const tipoFilter = searchParams.get('tipo');

        let query = supabaseAdmin
            .from('documentos_socio')
            .select('id, socio_id, tipo, archivo_path, estado, verificacion_estado, verificacion_obs, verificado_at, verificado_por, fecha_emision, fecha_vencimiento, version, supersedes_document_id, is_current, created_at, updated_at')
            .eq('socio_id', id);

        if (tipoFilter) {
            const cleanTipoFilter = (tipoFilter === 'declaracionJurada' || tipoFilter === 'declaracion_jurada') ? 'declaracion_jurada' : tipoFilter;
            query = query.eq('tipo', cleanTipoFilter);
        }

        const { data: docs, error } = await query.order('created_at', { ascending: false });

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

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const authResult = await authenticate(request, supabaseAdmin);
        const caller = (authResult && typeof authResult === 'object' && 'user' in authResult)
            ? (authResult as any).user
            : authResult;

        if (!caller) {
            return NextResponse.json({ error: 'Iniciá sesión para continuar' }, { status: 401 });
        }

        const { id } = await context.params;
        if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
        }

        // 1. Fetch target socio
        const { data: targetSocio, error: socioErr } = await supabaseAdmin
            .from('socios')
            .select('id, auth_user_id, reprocann_num_tramite, reprocann_fecha_alta, reprocann_fecha_vencimiento, reprocann_tipo')
            .eq('id', id)
            .maybeSingle();

        if (socioErr || !targetSocio) {
            return NextResponse.json({ error: 'Socio no encontrado' }, { status: 404 });
        }

        // 2. Authorization & Role Verification
        const isStaff = await hasStaffRole(caller, supabaseAdmin);
        if (!isStaff) {
            if (targetSocio.auth_user_id !== caller.id) {
                return NextResponse.json({ error: 'No tenés permisos para modificar documentos de otro socio' }, { status: 403 });
            }
        }

        // 3. Parse and Validate Payload
        const body = await request.json().catch(() => ({}));
        const {
            tipo: rawTipo,
            verificacion_estado,
            verificacion_obs,
            archivo_path,
            fecha_emision,
            fecha_vencimiento,
            monto,
            observaciones,
            numero_tramite
        } = body;

        if (!rawTipo || typeof rawTipo !== 'string') {
            return NextResponse.json({ error: 'Tipo de documento requerido' }, { status: 400 });
        }

        const rawLower = rawTipo.toLowerCase().trim();
        const cleanTipo = (rawLower === 'declaracionjurada' || rawLower === 'declaracion_jurada' || (rawLower.includes('declaracion') && rawLower.includes('jurada')))
            ? 'declaracion_jurada'
            : rawTipo.trim();

        const VALID_TIPOS = ['reprocann', 'declaracion_jurada', 'consentimiento', 'contrato', 'contrato_autocultivo', 'contrato_madre', 'dni'];
        if (!VALID_TIPOS.includes(cleanTipo)) {
            return NextResponse.json({ error: `Tipo de documento inválido: ${cleanTipo}` }, { status: 400 });
        }

        // Role boundary: Only staff/admin can verify documents
        if (!isStaff) {
            if (verificacion_estado && verificacion_estado !== 'pendiente') {
                return NextResponse.json({ error: 'Solo el personal administrativo puede verificar documentos' }, { status: 403 });
            }
            if (verificacion_obs) {
                return NextResponse.json({ error: 'No tenés permisos para ingresar observaciones de verificación' }, { status: 403 });
            }
        }

        // Validate verification state if provided
        const VALID_VERIFICACION = ['pendiente', 'aprobado', 'rechazado', 'en_revision'];
        if (verificacion_estado !== undefined && !VALID_VERIFICACION.includes(verificacion_estado)) {
            return NextResponse.json({
                error: `Estado de verificación inválido. Valores válidos: ${VALID_VERIFICACION.join(', ')}`
            }, { status: 400 });
        }

        // Strict Date Format and Calendar Validation
        if (fecha_emision) {
            if (typeof fecha_emision !== 'string' || !isValidCalendarDate(fecha_emision)) {
                return NextResponse.json({ error: 'Fecha de emisión inválida o inexistente (formato esperado YYYY-MM-DD)' }, { status: 400 });
            }
        }
        if (fecha_vencimiento) {
            if (typeof fecha_vencimiento !== 'string' || !isValidCalendarDate(fecha_vencimiento)) {
                return NextResponse.json({ error: 'Fecha de vencimiento inválida o inexistente (formato esperado YYYY-MM-DD)' }, { status: 400 });
            }
        }

        // Fetch current document of this type
        const { data: existingDoc } = await supabaseAdmin
            .from('documentos_socio')
            .select('*')
            .eq('socio_id', id)
            .eq('tipo', cleanTipo)
            .eq('is_current', true)
            .maybeSingle();

        const effectivePath = archivo_path || existingDoc?.archivo_path;

        // Specific REPROCANN approval validations
        if (cleanTipo === 'reprocann' && verificacion_estado === 'aprobado') {
            const effFechaEmision = fecha_emision || existingDoc?.fecha_emision;
            const effFechaVenc = fecha_vencimiento || existingDoc?.fecha_vencimiento;

            if (!effectivePath) {
                return NextResponse.json({ error: 'No se puede aprobar un documento REPROCANN sin archivo adjunto' }, { status: 400 });
            }
            if (!effFechaEmision || !effFechaVenc) {
                return NextResponse.json({ error: 'Para aprobar REPROCANN se requiere fecha de emisión y vencimiento válidas' }, { status: 400 });
            }
            if (effFechaVenc < effFechaEmision) {
                return NextResponse.json({ error: 'La fecha de vencimiento no puede ser anterior a la fecha de emisión' }, { status: 400 });
            }
        }

        let resultDoc: any = null;
        const now = new Date().toISOString();

        // 4. Persistence with History, Atomicity and Versioning
        const isNewFile = archivo_path && existingDoc?.archivo_path && (archivo_path !== existingDoc.archivo_path);

        if (existingDoc && !isNewFile) {
            // Case A: Update existing current document metadata / verification
            const previousSnapshot = {
                verificacion_estado: existingDoc.verificacion_estado,
                verificacion_obs: existingDoc.verificacion_obs,
                verificado_at: existingDoc.verificado_at,
                verificado_por: existingDoc.verificado_por,
                fecha_emision: existingDoc.fecha_emision,
                fecha_vencimiento: existingDoc.fecha_vencimiento,
                archivo_path: existingDoc.archivo_path
            };

            const updates: any = {
                updated_at: now
            };

            if (verificacion_estado !== undefined) {
                updates.verificacion_estado = verificacion_estado;
                if (verificacion_estado !== 'pendiente') {
                    updates.verificado_at = now;
                    updates.verificado_por = caller.email || caller.id;
                } else {
                    updates.verificado_at = null;
                    updates.verificado_por = null;
                }
            }
            const obsToStore = verificacion_obs !== undefined ? verificacion_obs : observaciones;
            if (obsToStore !== undefined) updates.verificacion_obs = (obsToStore ? String(obsToStore).slice(0, 1000) : null);
            if (fecha_emision !== undefined) updates.fecha_emision = fecha_emision || null;
            if (fecha_vencimiento !== undefined) updates.fecha_vencimiento = fecha_vencimiento || null;
            if (archivo_path) updates.archivo_path = archivo_path;

            const { data: updated, error: updErr } = await supabaseAdmin
                .from('documentos_socio')
                .update(updates)
                .eq('id', existingDoc.id)
                .select()
                .single();

            if (updErr) {
                console.error('Error updating existing documento_socio:', updErr);
                return NextResponse.json({ error: updErr.message }, { status: 500 });
            }
            resultDoc = updated;

            // Synchronize with public.socios table (with compensating rollback)
            if (cleanTipo === 'reprocann') {
                const socioUpdates: any = {
                    updated_at: now
                };
                if (numero_tramite && typeof numero_tramite === 'string' && numero_tramite.trim()) {
                    socioUpdates.reprocann_num_tramite = numero_tramite.trim();
                }
                if (fecha_vencimiento) {
                    socioUpdates.reprocann_fecha_vencimiento = fecha_vencimiento;
                }
                if (fecha_emision) {
                    socioUpdates.reprocann_fecha_alta = fecha_emision;
                }

                if (Object.keys(socioUpdates).length > 1) {
                    const { error: sUpdErr } = await supabaseAdmin
                        .from('socios')
                        .update(socioUpdates)
                        .eq('id', id);

                    if (sUpdErr) {
                        console.error('Rollback Case A: Error synchronizing reprocann to socios table:', sUpdErr);
                        // Compensating rollback on documentos_socio
                        await supabaseAdmin
                            .from('documentos_socio')
                            .update(previousSnapshot)
                            .eq('id', existingDoc.id);

                        return NextResponse.json({ error: 'Fallo al sincronizar datos del socio. Operación revertida.' }, { status: 500 });
                    }
                }
            }
        } else {
            // Case B: Insert new document (or new version superseding previous)
            const newVersion = existingDoc ? (existingDoc.version || 1) + 1 : 1;
            const supersedesId = existingDoc ? existingDoc.id : null;

            // 1. If an active version exists, archive it first (required by unique constraint idx_documentos_socio_unique_current)
            if (existingDoc) {
                const { error: archErr } = await supabaseAdmin
                    .from('documentos_socio')
                    .update({ is_current: false, updated_at: now })
                    .eq('id', existingDoc.id);

                if (archErr) {
                    console.error('Error archiving previous document version:', archErr);
                    return NextResponse.json({ error: 'Error al archivar versión anterior: ' + archErr.message }, { status: 500 });
                }
            }

            const insertObs = (verificacion_obs !== undefined ? verificacion_obs : observaciones);
            const insertPayload: any = {
                socio_id: id,
                tipo: cleanTipo,
                archivo_path: effectivePath || null,
                verificacion_estado: verificacion_estado || 'pendiente',
                verificacion_obs: insertObs ? String(insertObs).slice(0, 1000) : null,
                fecha_emision: fecha_emision || null,
                fecha_vencimiento: fecha_vencimiento || null,
                uploaded_by: isStaff ? 'admin' : 'socio_web',
                is_current: true,
                version: newVersion,
                supersedes_document_id: supersedesId,
                created_at: now,
                updated_at: now
            };

            if (isStaff && verificacion_estado && verificacion_estado !== 'pendiente') {
                insertPayload.verificado_at = now;
                insertPayload.verificado_por = caller.email || caller.id;
            }

            // 2. Insert new version
            const { data: inserted, error: insErr } = await supabaseAdmin
                .from('documentos_socio')
                .insert(insertPayload)
                .select()
                .single();

            if (insErr) {
                console.error('Error inserting documento_socio:', insErr);
                // Compensating rollback: restore previous version as current
                if (existingDoc) {
                    await supabaseAdmin
                        .from('documentos_socio')
                        .update({ is_current: true })
                        .eq('id', existingDoc.id);
                }
                return NextResponse.json({ error: insErr.message }, { status: 500 });
            }
            resultDoc = inserted;

            // 3. Synchronize with public.socios table (with compensating rollback)
            if (cleanTipo === 'reprocann') {
                const socioUpdates: any = {
                    updated_at: now
                };
                if (numero_tramite && typeof numero_tramite === 'string' && numero_tramite.trim()) {
                    socioUpdates.reprocann_num_tramite = numero_tramite.trim();
                }
                if (fecha_vencimiento) {
                    socioUpdates.reprocann_fecha_vencimiento = fecha_vencimiento;
                }
                if (fecha_emision) {
                    socioUpdates.reprocann_fecha_alta = fecha_emision;
                }

                if (Object.keys(socioUpdates).length > 1) {
                    const { error: sUpdErr } = await supabaseAdmin
                        .from('socios')
                        .update(socioUpdates)
                        .eq('id', id);

                    if (sUpdErr) {
                        console.error('Rollback Case B: Error synchronizing reprocann to socios table:', sUpdErr);
                        // Compensating rollback: delete newly inserted row and re-activate existingDoc
                        await supabaseAdmin.from('documentos_socio').delete().eq('id', inserted.id);
                        if (existingDoc) {
                            await supabaseAdmin
                                .from('documentos_socio')
                                .update({ is_current: true })
                                .eq('id', existingDoc.id);
                        }
                        return NextResponse.json({ error: 'Fallo al sincronizar datos del socio. Operación revertida.' }, { status: 500 });
                    }
                }
            }
        }

        // 6. Administrative Audit Log
        if (isStaff) {
            try {
                await supabaseAdmin.from('audit_logs').insert({
                    user_id: caller.id,
                    action: 'UPDATE_DOCUMENT_VERIFICATION',
                    entity_type: 'documentos_socio',
                    entity_id: resultDoc.id,
                    details: {
                        socio_id: id,
                        tipo: cleanTipo,
                        verificacion_estado: resultDoc.verificacion_estado,
                        verificacion_obs: resultDoc.verificacion_obs,
                        fecha_emision: resultDoc.fecha_emision,
                        fecha_vencimiento: resultDoc.fecha_vencimiento,
                        version: resultDoc.version,
                        is_current: resultDoc.is_current,
                        actor_email: caller.email
                    }
                });
            } catch (auditErr) {
                console.warn('Audit log insert non-fatal warning:', auditErr);
            }
        }

        return NextResponse.json({ success: true, document: resultDoc }, { status: 200 });

    } catch (e: any) {
        console.error('POST /api/socios/[id]/documents error:', e);
        return NextResponse.json({ error: e.message || 'Error interno del servidor' }, { status: 500 });
    }
}

