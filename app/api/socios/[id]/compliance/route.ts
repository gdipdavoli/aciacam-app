import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticate, hasStaffRole } from '@/app/lib/api-auth';

export const runtime = "nodejs";

export type ComplianceDocumentState = 
    | 'no_presentado'
    | 'presentado_pendiente'
    | 'en_revision'
    | 'aprobado'
    | 'rechazado'
    | 'vencido';

function normalizeDocumentTipo(tipo: string): string {
    const raw = (tipo || '').toLowerCase().trim();
    if (raw === 'declaracionjurada' || raw === 'declaracion_jurada' || (raw.includes('declaracion') && raw.includes('jurada'))) {
        return 'declaracion_jurada';
    }
    if (raw === 'consentimiento') return 'consentimiento';
    if (raw === 'reprocann') return 'reprocann';
    if (raw === 'contrato_autocultivo' || raw === 'autocultivo') return 'contrato_autocultivo';
    if (raw === 'contrato_madre' || raw === 'madre') return 'contrato_madre';
    if (raw === 'contrato') return 'contrato';
    return raw.replace(/[\s-]+/g, '_');
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id } = await context.params;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });

    try {
        const authResult = await authenticate(request, supabaseAdmin);
        const caller = (authResult && typeof authResult === 'object' && 'user' in authResult)
            ? (authResult as any).user
            : authResult;

        if (!caller) {
            if (authResult && typeof authResult === 'object' && 'response' in authResult && (authResult as any).response) {
                return (authResult as any).response;
            }
            return NextResponse.json({ error: 'Iniciá sesión para continuar' }, { status: 401 });
        }

        if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
        }

        // 1. Fetch socio info
        const { data: socio, error: socioError } = await supabaseAdmin
            .from('socios')
            .select('id, auth_user_id, reprocann_tipo, reprocann_fecha_vencimiento, reprocann_num_tramite')
            .eq('id', id)
            .single();

        if (socioError || !socio) {
            return NextResponse.json({ error: "Socio not found" }, { status: 404 });
        }

        // Security check: Only owner or staff/admin
        if (socio.auth_user_id !== caller.id && !await hasStaffRole(caller, supabaseAdmin)) {
            return NextResponse.json({ error: 'No tenés permisos para consultar este socio' }, { status: 403 });
        }

        // 2. Fetch documents
        const { data: docs, error: docsError } = await supabaseAdmin
            .from('documentos_socio')
            .select('tipo, archivo_path, verificacion_estado, verificacion_obs, fecha_vencimiento, is_current, version')
            .eq('socio_id', id);

        if (docsError) {
            return NextResponse.json({ error: docsError.message }, { status: 500 });
        }

        // Sort documents: is_current === true first, then higher version
        const sortedDocs = [...(docs || [])].sort((a: any, b: any) => {
            if (a.is_current === true && b.is_current !== true) return -1;
            if (b.is_current === true && a.is_current !== true) return 1;
            return (b.version || 0) - (a.version || 0);
        });

        // Map by canonical key, ignoring replaced historical docs (is_current === false) once a current is picked
        const currentDocsByTipo: Record<string, any> = {};
        for (const doc of sortedDocs) {
            const canonicalTipo = normalizeDocumentTipo(doc.tipo);
            if (!currentDocsByTipo[canonicalTipo]) {
                currentDocsByTipo[canonicalTipo] = doc;
            }
        }

        // 3. Define required documents
        const documentosRequeridos: string[] = ['declaracion_jurada', 'consentimiento', 'reprocann'];
        const tipoReprocann = socio.reprocann_tipo?.toLowerCase();

        if (tipoReprocann === 'autocultivo') {
            documentosRequeridos.push('contrato_autocultivo');
        } else if (tipoReprocann === 'vinculado_ong') {
            documentosRequeridos.push('contrato_madre');
        }

        // 4. Evaluate each document detailed state
        const detalle: Record<string, {
            estado: ComplianceDocumentState;
            archivo_path?: string | null;
            fecha_vencimiento?: string | null;
            verificacion_estado?: string | null;
            verificacion_obs?: string | null;
        }> = {};

        const allTrackedTipos = Array.from(new Set([...documentosRequeridos, ...Object.keys(currentDocsByTipo)]));

        for (const tipo of allTrackedTipos) {
            const doc = currentDocsByTipo[tipo];
            if (!doc || !doc.archivo_path || doc.archivo_path.trim() === '') {
                detalle[tipo] = {
                    estado: 'no_presentado',
                    archivo_path: null
                };
                continue;
            }

            // Expiration check (consider doc date and socio date for reprocann)
            let vencimientoDateStr = doc.fecha_vencimiento;
            if (tipo === 'reprocann' && socio.reprocann_fecha_vencimiento) {
                vencimientoDateStr = socio.reprocann_fecha_vencimiento;
            }

            let isVencido = false;
            if (vencimientoDateStr) {
                const parsed = new Date(vencimientoDateStr).getTime();
                if (!isNaN(parsed) && parsed < Date.now()) {
                    isVencido = true;
                }
            }

            let estado: ComplianceDocumentState = 'presentado_pendiente';
            if (isVencido) {
                estado = 'vencido';
            } else if (doc.verificacion_estado === 'rechazado') {
                estado = 'rechazado';
            } else if (doc.verificacion_estado === 'aprobado') {
                estado = 'aprobado';
            } else if (doc.verificacion_estado === 'en_revision') {
                estado = 'en_revision';
            } else {
                estado = 'presentado_pendiente';
            }

            detalle[tipo] = {
                estado,
                archivo_path: doc.archivo_path,
                fecha_vencimiento: vencimientoDateStr,
                verificacion_estado: doc.verificacion_estado,
                verificacion_obs: doc.verificacion_obs
            };
        }

        // Sets
        const documentosPresentes = Object.keys(detalle).filter(k => detalle[k].estado !== 'no_presentado');
        const documentosAprobados = Object.keys(detalle).filter(k => detalle[k].estado === 'aprobado');
        const faltantes = documentosRequeridos.filter(req => !documentosAprobados.includes(req));
        const completo = faltantes.length === 0;

        // Reprocann overall status
        const reproDetalle = detalle['reprocann'];
        const reproVencimiento = socio.reprocann_fecha_vencimiento || reproDetalle?.fecha_vencimiento;
        const isReproVencido = reproVencimiento ? new Date(reproVencimiento).getTime() < Date.now() : false;
        
        let reproEstado = 'pendiente';
        if (isReproVencido) {
            reproEstado = 'vencido';
        } else if (reproDetalle?.estado === 'aprobado') {
            reproEstado = 'vigente';
        } else if (reproDetalle?.estado === 'rechazado') {
            reproEstado = 'rechazado';
        } else {
            reproEstado = 'pendiente';
        }

        return NextResponse.json({
            reprocann_estado: reproEstado,
            reprocann_tipo: tipoReprocann || 'desconocido',
            documentos_presentes: documentosPresentes,
            documentos_aprobados: documentosAprobados,
            documentos_requeridos: documentosRequeridos,
            faltantes,
            completo,
            detalle
        }, {
            headers: { 'Cache-Control': 'private, no-store' }
        });

    } catch (error: any) {
        console.error("Compliance API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
