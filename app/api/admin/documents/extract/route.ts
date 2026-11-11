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
export const maxDuration = 60; // Fluid compute timeout extendido para modelos de visión multimodal (Vercel)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const AGENT_CORE_TIMEOUT_MS = Number(process.env.AGENT_CORE_TIMEOUT_MS) || 45000;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

export async function POST(req: NextRequest) {
    try {
        // 1. Autenticación y Autorización Staff / Admin con rol real verificado
        const authResult = await authenticate(req, supabaseAdmin);
        const caller = (authResult && typeof authResult === 'object' && 'user' in authResult)
            ? (authResult as any).user
            : authResult;

        if (!caller) {
            return NextResponse.json({ error: 'Iniciá sesión para continuar' }, { status: 401 });
        }

        // Obtener el perfil y rol real del socio desde public.socios
        const { data: socioData } = await supabaseAdmin
            .from('socios')
            .select('id, rol')
            .eq('auth_user_id', caller.id)
            .maybeSingle();

        const callerRole = (socioData?.rol || caller.app_metadata?.role || '').toLowerCase().trim();
        const isStaff = callerRole === 'admin' || callerRole === 'staff';
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

        // Configuración de integración granular para OCR documental (Sprint UX-03D)
        // Bandera específica sin habilitar globalmente Agent Core
        const agentCoreBaseUrl = process.env.AGENT_CORE_PYTHON_URL || process.env.AGENT_CORE_BASE_URL || process.env.AGENT_CORE_URL;
        const agentCoreBffSecret = process.env.AGENT_CORE_BFF_SECRET;
        const isDocumentOcrEnabled = process.env.AGENT_CORE_DOCUMENT_OCR_ENABLED === 'true';
        const hasAgentCoreConfig = Boolean(agentCoreBaseUrl && agentCoreBffSecret && isDocumentOcrEnabled);

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
            const fileMime = file.type || (isPdf ? 'application/pdf' : 'image/jpeg');
            let agentCoreExtraction: UnifiedDocumentExtraction | null = null;

            // Intento prioritario 1: Extracción inteligente vía Agent Core (Gemini Vision)
            let errorCategory = 'NONE';
            let failureReason = '';
            let canRetry = true;

            if (hasAgentCoreConfig) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const base64Content = Buffer.from(arrayBuffer).toString('base64');
                    const cleanUrl = agentCoreBaseUrl!.replace(/\/+$/, '');

                    const callerUserId = caller.id;
                    const callerSocioId = socioData?.id || caller.id;

                    const makeCall = async () => {
                        return await fetch(`${cleanUrl}/api/v1/documents/analyze-read-only`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Agent-Core-Secret': agentCoreBffSecret!,
                                'Authorization': `Bearer ${agentCoreBffSecret!}`,
                                'X-Delegated-Auth-User-Id': callerUserId,
                                'X-Delegated-User-Role': callerRole,
                                'X-Delegated-Socio-Id': callerSocioId,
                            },
                            body: JSON.stringify({
                                file_bytes_base64: base64Content,
                                mime_type: fileMime,
                                filename: file.name,
                            }),
                            signal: AbortSignal.timeout(AGENT_CORE_TIMEOUT_MS),
                        });
                    };

                    let acResponse: Response | null = null;
                    try {
                        acResponse = await makeCall();
                        // Reintento único ante errores transitorios de alta demanda (503 / 429)
                        if (acResponse && (acResponse.status === 503 || acResponse.status === 429)) {
                            console.warn(`[Extraction] Agent Core respondió con HTTP ${acResponse.status} (alta demanda transitoria). Reintentando en 1.5s...`);
                            await new Promise(r => setTimeout(r, 1500));
                            acResponse = await makeCall();
                        }
                    } catch (fetchErr: any) {
                        if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError') {
                            errorCategory = 'TIMEOUT';
                            failureReason = `Timeout de Agent Core superado (${AGENT_CORE_TIMEOUT_MS / 1000}s)`;
                            console.warn(`[Extraction] Timeout al conectar con Agent Core (${AGENT_CORE_TIMEOUT_MS / 1000}s).`);
                        } else {
                            errorCategory = 'CONNECTION_ERROR';
                            failureReason = fetchErr.message || 'Error de conexión con Agent Core';
                            console.warn(`[Extraction] Error de conexión con Agent Core: ${failureReason}. Reintentando una vez...`);
                            try {
                                await new Promise(r => setTimeout(r, 1000));
                                acResponse = await makeCall();
                            } catch (retryErr: any) {
                                failureReason = retryErr.message || failureReason;
                            }
                        }
                    }

                    if (acResponse) {
                        if (acResponse.ok) {
                            const acData = await acResponse.json();
                            if (acData && (acData.status === 'success' || acData.status === 'partial_success')) {
                                const f = acData.fields || {};
                                agentCoreExtraction = {
                                    documentType: (['reprocann', 'consentimiento', 'dni', 'receta'].includes(acData.document_type)
                                        ? acData.document_type
                                        : 'desconocido') as any,
                                    titular: (f.nombre?.value || f.apellido?.value) ? {
                                        nombre: f.nombre?.value || undefined,
                                        apellido: f.apellido?.value || undefined,
                                    } : undefined,
                                    dni: f.dni?.value || undefined,
                                    fechaNacimiento: f.fecha_nacimiento?.value || undefined,
                                    numeroTramite: f.numero_tramite?.value || undefined,
                                    fechaEmision: f.fecha_emision?.value || f.fecha_alta?.value || undefined,
                                    fechaVencimiento: f.fecha_vencimiento?.value || undefined,
                                    tipoAutorizacion: f.tipo_autorizacion?.value || undefined,
                                    medico: (f.medico_nombre?.value || f.medico_matricula?.value) ? {
                                        nombre: f.medico_nombre?.value || undefined,
                                        matricula: f.medico_matricula?.value || undefined,
                                    } : undefined,
                                    diagnostico: f.diagnostico?.value || undefined,
                                    confidence: {
                                        overall: typeof acData.confidence === 'number' ? acData.confidence : 0.9,
                                        fields: Object.fromEntries(
                                            Object.entries(f).map(([k, v]: [string, any]) => [k, v?.confidence ?? 0.9])
                                        )
                                    },
                                    isLegible: acData.is_legible ?? true,
                                    extractionSource: 'agent_core_gemini',
                                    sourceDescription: `Agent Core (Gemini Vision - ${acData.model_used || 'gemini-3.5-flash'})`,
                                    warnings: acData.warnings || [],
                                    errors: acData.errors || [],
                                    humanValidated: false,
                                    totalPages: 1,
                                    requiresVisualOcr: false,
                                    hasImageOnlyLayer: false,
                                    detectedFieldsCount: Object.keys(f).length,
                                    fieldTraceability: f,
                                    canRetryGemini: false,
                                };
                            }
                        } else {
                            if (acResponse.status === 401) {
                                errorCategory = 'AUTH_ERROR';
                                canRetry = false;
                                failureReason = 'Autenticación S2S rechazada por Agent Core.';
                            } else if (acResponse.status === 403) {
                                errorCategory = 'FORBIDDEN';
                                canRetry = false;
                                failureReason = 'Rol no autorizado para extracción documental.';
                            } else if (acResponse.status === 423) {
                                errorCategory = 'OCR_DISABLED';
                                canRetry = false;
                                failureReason = 'OCR deshabilitado por política en Agent Core.';
                            } else if (acResponse.status === 400) {
                                errorCategory = 'BAD_REQUEST';
                                canRetry = false;
                                failureReason = 'Documento o formato rechazado por validación.';
                            } else {
                                errorCategory = `HTTP_${acResponse.status}`;
                                failureReason = `Agent Core retornó HTTP ${acResponse.status}`;
                            }
                            console.warn(`[Extraction] Agent Core no procesó el documento: ${failureReason}. Aplicando fallback local.`);
                        }
                    }
                } catch (acErr: any) {
                    console.warn(`[Extraction] Excepción no controlada con Agent Core (${acErr.message || acErr}). Aplicando fallback local.`);
                    failureReason = acErr.message || 'Error inesperado';
                }
            }

            if (agentCoreExtraction) {
                processedItems.push({
                    filename: file.name,
                    extraction: agentCoreExtraction
                });
                continue;
            }

            // Intento secundario 2: Fallback local (unpdf para PDF, o aviso de manual para imágenes)
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

                    if (hasAgentCoreConfig) {
                        if (errorCategory === 'TIMEOUT') {
                            docExtraction.warnings.push(`Extracción asistida local: Agent Core demoró más de ${AGENT_CORE_TIMEOUT_MS / 1000}s. Podés reintentar el análisis con Gemini.`);
                        } else if (errorCategory === 'AUTH_ERROR' || errorCategory === 'OCR_DISABLED') {
                            docExtraction.warnings.push('Extracción asistida local: El servicio OCR centralizado está inactivo por configuración de seguridad.');
                        } else {
                            docExtraction.warnings.push('Extracción asistida local: Agent Core no estuvo disponible temporalmente. Se leyó la capa de texto PDF.');
                        }
                    }

                    docExtraction.canRetryGemini = canRetry && hasAgentCoreConfig && errorCategory !== 'AUTH_ERROR' && errorCategory !== 'OCR_DISABLED';
                    docExtraction.failureReason = failureReason;

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
                // Archivo de imagen rasterizada sin Agent Core
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
                            hasAgentCoreConfig 
                                ? 'Agent Core (Gemini Vision) no estuvo disponible temporalmente para OCR.'
                                : 'Por favor complete o verifique los datos del socio manualmente.'
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

