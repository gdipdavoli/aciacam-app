import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface DocumentoRow {
    tipo: string;
    archivo_path: string | null;
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> } // Params is a Promise in Next 15/latest App Router
) {
    const { id } = await context.params;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });

    try {
        // 1. Fetch socio info
        const { data: socio, error: socioError } = await supabaseAdmin
            .from('socios')
            .select('reprocann_estado, reprocann_tipo')
            .eq('id', id)
            .single();

        if (socioError || !socio) {
            return NextResponse.json({ error: "Socio not found" }, { status: 404 });
        }

        // 2. Fetch documents
        const { data: docs, error: docsError } = await supabaseAdmin
            .from('documentos_socio')
            .select('tipo, archivo_path')
            .eq('socio_id', id);

        if (docsError) {
            return NextResponse.json({ error: docsError.message }, { status: 500 });
        }

        // 3. Determine present documents
        // Filter rows where path is not null/empty
        const documentosPresentes = Array.from(new Set(
            (docs as DocumentoRow[])
                .filter(d => d.archivo_path && d.archivo_path.trim() !== '')
                .map(d => d.tipo)
        ));

        // 4. Calculate required documents
        const documentosRequeridos: string[] = ['declaracionJurada', 'consentimiento'];
        const estado = socio.reprocann_estado?.toLowerCase();
        const tipoReprocann = socio.reprocann_tipo?.toLowerCase();

        if (estado === 'activo') {
            if (tipoReprocann === 'autocultivo') {
                documentosRequeridos.push('contrato_autocultivo');
            } else if (tipoReprocann === 'vinculado_ong') {
                documentosRequeridos.push('contrato_madre');
            }
            // if reprocann_tipo is missing/unknown, we can't require specific contract but technically 'activo' implies one.
            // Sticking to explicit rules.
        } else if (estado === 'pendiente') {
            // No contract required yet
        }

        // 5. Calculate missing and status
        const faltantes = documentosRequeridos.filter(req => !documentosPresentes.includes(req));
        const completo = faltantes.length === 0;

        return NextResponse.json({
            reprocann_estado: estado || 'desconocido',
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
