import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticate, hasStaffRole } from '@/app/lib/api-auth';
import { 
    extractTextFromPdfBufferAsync, 
    extractDataFromDocumentText, 
    consolidateDocumentExtractions,
    validateIdentityMatch,
    UnifiedDocumentExtraction 
} from '@/app/lib/ocr-contract';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

export async function POST(req: NextRequest) {
    try {
        // 1. Autenticación y Autorización Staff / Admin
        const authResult = await authenticate(req, supabaseAdmin);
        const caller = (authResult && typeof authResult === 'object' && 'user' in authResult)
            ? (authResult as any).user
            : authResult;

        if (!caller) {
            return NextResponse.json({ error: 'Iniciá sesión para continuar' }, { status: 401 });
        }

        const isStaff = await hasStaffRole(caller, supabaseAdmin);
        if (!isStaff) {
            return NextResponse.json({ error: 'Solo el personal administrativo puede procesar extracción documental' }, { status: 403 });
        }

        // 2. Parsear FormData: admite archivo único ('file') o múltiples ('files')
        const formData = await req.formData();
        const targetSocioDni = formData.get('socioDni') as string | null;

        const filesToProcess: File[] = [];
        const filesMulti = formData.getAll('files') as File[];
        const singleFile = formData.get('file') as File | null;

        if (filesMulti && filesMulti.length > 0) {
            for (const f of filesMulti) {
                if (f && typeof f.size === 'number') filesToProcess.push(f);
            }
        } else if (singleFile && typeof singleFile.size === 'number') {
            filesToProcess.push(singleFile);
        }

        if (filesToProcess.length === 0) {
            return NextResponse.json({ error: 'No se suministró ningún archivo para procesar' }, { status: 400 });
        }

        // 3. Procesar cada archivo individualmente con aislamiento de fallas
        const processedItems: Array<{ filename: string; extraction: UnifiedDocumentExtraction }> = [];

        for (const file of filesToProcess) {
            // Validación de tamaño (máximo 15MB)
            if (file.size > 15 * 1024 * 1024) {
                processedItems.push({
                    filename: file.name,
                    extraction: {
                        documentType: 'desconocido',
                        confidence: { overall: 0, fields: {} },
                        isLegible: false,
                        extractionSource: 'local_text_layer',
                        sourceDescription: 'Archivo excedió el límite de tamaño',
                        warnings: ['El archivo excede el límite máximo permitido de 15MB'],
                        errors: ['Tamaño no admitido (> 15MB)'],
                        humanValidated: false,
                        totalPages: 0,
                        requiresVisualOcr: false
                    }
                });
                continue;
            }

            const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

            if (isPdf) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const uint8 = new Uint8Array(arrayBuffer);
                    const { text, totalPages, isLikelyImageOnly } = await extractTextFromPdfBufferAsync(uint8);
                    const docExtraction = extractDataFromDocumentText(text, file.name, totalPages);

                    if (isLikelyImageOnly && !docExtraction.requiresVisualOcr) {
                        docExtraction.requiresVisualOcr = true;
                        docExtraction.hasImageOnlyLayer = true;
                    }

                    processedItems.push({
                        filename: file.name,
                        extraction: docExtraction
                    });
                } catch (pdfErr: any) {
                    // Manejo grácil de PDF corrupto o malformado
                    processedItems.push({
                        filename: file.name,
                        extraction: {
                            documentType: 'desconocido',
                            confidence: { overall: 0, fields: {} },
                            isLegible: false,
                            extractionSource: 'local_text_layer',
                            sourceDescription: 'Error en decodificación de estructura PDF',
                            warnings: [`No se pudo leer la estructura del PDF (${pdfErr.message || 'archivo dañado o formato no estándar'}). Requiere carga manual.`],
                            errors: ['Archivo PDF no estructurado o dañado'],
                            humanValidated: false,
                            totalPages: 0,
                            requiresVisualOcr: false
                        }
                    });
                }
            } else {
                // Archivo de imagen rasterizada (JPEG/PNG)
                processedItems.push({
                    filename: file.name,
                    extraction: {
                        documentType: 'desconocido',
                        confidence: { overall: 0, fields: {} },
                        isLegible: false,
                        extractionSource: 'local_text_layer',
                        sourceDescription: 'Archivo de imagen rasterizada (requiere entrada manual o visión multimodal)',
                        warnings: [
                            'El archivo es una imagen sin capa de texto digital embebida.',
                            'Por favor complete o verifique los datos del socio manualmente.'
                        ],
                        errors: [],
                        humanValidated: false,
                        totalPages: 1,
                        requiresVisualOcr: true,
                        hasImageOnlyLayer: true
                    }
                });
            }
        }

        // 4. Consolidar resultados multi-documento y detectar discrepancias
        const consolidation = consolidateDocumentExtractions(processedItems);

        // 5. Determinar extracción primaria (la de mayor confianza o la primera válida)
        const primaryExtraction = processedItems.length > 0 
            ? (processedItems.find(p => p.extraction.isLegible)?.extraction || processedItems[0].extraction)
            : consolidation.documentSummaries[0]?.extraction;

        // 6. Cotejo de Identidad si se suministró DNI objetivo del socio
        let identityCheck: any = null;
        const candidateDni = consolidation.consolidated.dni || primaryExtraction?.dni;
        if (targetSocioDni && candidateDni) {
            const check = validateIdentityMatch(candidateDni, targetSocioDni);
            identityCheck = {
                matches: check.match,
                docDni: check.normalizedDoc,
                socioDni: check.normalizedPartner,
                warning: !check.match ? 'Discrepancia detectada: el DNI del documento no coincide con el DNI del socio seleccionado.' : null
            };
            if (!check.match && primaryExtraction) {
                primaryExtraction.warnings.push(`DISCREPANCIA DE IDENTIDAD: DNI del documento (${check.normalizedDoc}) difiere del socio (${check.normalizedPartner})`);
            }
        }

        return NextResponse.json({
            success: true,
            extraction: primaryExtraction,
            extractions: processedItems.map(p => ({ filename: p.filename, ...p.extraction })),
            consolidated: consolidation.consolidated,
            conflicts: consolidation.conflicts,
            documentSummaries: consolidation.documentSummaries,
            identityCheck
        }, {
            headers: { 'Cache-Control': 'no-store' }
        });

    } catch (e: any) {
        console.error('Error en endpoint de extracción documental:', e);
        return NextResponse.json({ 
            error: e.message || 'Error al procesar la extracción documental' 
        }, { status: 500 });
    }
}

