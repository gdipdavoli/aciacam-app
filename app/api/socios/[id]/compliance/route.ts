import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticate, hasStaffRole } from '@/app/lib/api-auth';

export const runtime = "nodejs";

interface DocumentoRow {
    tipo: string;
    archivo_path: string | null;
}

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
    context: { params: Promise<{ id: string }> } // Params is a Promise in Next 15/latest App Router
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
        // Handle both return types: User directly or AuthResult { success, user, response }
        const caller = (authResult && typeof authResult === 'object' && 'user' in authResult)
            ? (authResult as any).user
            : authResult;

        if (!caller) {
            if (authResult && typeof authResult === 'object' && 'response' in authResult && (authResult as any).response) {
                return (authResult as any).response;
            }
            return NextResponse.json({ error: 'Iniciá sesión para continuar' }, { status: 401 });
        }

        // 1. Fetch socio info
        const { data: socio, error: socioError } = await supabaseAdmin
            .from('socios')
            .select('auth_user_id, reprocann_tipo, reprocann_fecha_vencimiento')
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
            .select('tipo, archivo_path, verificacion_estado, fecha_vencimiento, is_current')
            .eq('socio_id', id);

        if (docsError) {
            return NextResponse.json({ error: docsError.message }, { status: 500 });
        }

        // 3. Determine present documents (normalized to canonical snake_case)
        const documentosPresentesSet = new Set(
            (docs || [])
                .filter((d: any) => d.archivo_path && d.archivo_path.trim() !== '')
                .map((d: any) => normalizeDocumentTipo(d.tipo))
        );
        const documentosPresentes = Array.from(documentosPresentesSet);

        // 4. Calculate required documents (canonical standard)
        const documentosRequeridos: string[] = ['declaracion_jurada', 'consentimiento', 'reprocann'];
        const tipoReprocann = socio.reprocann_tipo?.toLowerCase();

        // Check active reprocann document
        const reproDoc = (docs || []).find((d: any) => normalizeDocumentTipo(d.tipo) === 'reprocann' && d.is_current !== false);
        const vencimiento = socio.reprocann_fecha_vencimiento || reproDoc?.fecha_vencimiento;
        const isVencido = vencimiento ? new Date(vencimiento).getTime() < Date.now() : true;
        const reproEstado = (!vencimiento || isVencido) ? 'vencido' : (reproDoc?.verificacion_estado === 'aprobado' ? 'vigente' : 'pendiente');

        if (reproEstado === 'vigente' || tipoReprocann) {
            if (tipoReprocann === 'autocultivo') {
                documentosRequeridos.push('contrato_autocultivo');
            } else if (tipoReprocann === 'vinculado_ong') {
                documentosRequeridos.push('contrato_madre');
            }
        }

        // 5. Calculate missing and status
        const faltantes = documentosRequeridos.filter(req => !documentosPresentesSet.has(req));
        const completo = faltantes.length === 0;

        return NextResponse.json({
            reprocann_estado: reproEstado,
            reprocann_tipo: tipoReprocann || 'desconocido',
            documentos_presentes: documentosPresentes,
            documentos_requeridos: documentosRequeridos,
            faltantes,
            completo
        });

    } catch (error: any) {
        console.error("Compliance API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
