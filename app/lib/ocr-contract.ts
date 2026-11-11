/**
 * app/lib/ocr-contract.ts
 *
 * ACIACAM APP - Contrato Unificado de Extracción Documental (Sprint UX-03C)
 *
 * Centraliza las estructuras, validaciones y reglas para:
 * 1. Extracción de capa de texto digital (optimización local server-side).
 * 2. Adaptador a Agent Core / Gemini Vision (cuando esté habilitado).
 * 3. Cotejo de identidad (DNI documento vs socio) y auditoría de revisión humana.
 *
 * REGLA DE ORO: Ninguna extracción sustituye la validación humana obligatoria.
 * Los datos extraídos son asistencias que deben ser explícitamente confirmados.
 */

import { isValidCalendarDate } from '@/app/lib/date-format';
import * as zlib from 'zlib';
import { extractText } from 'unpdf';

export type ExtractionSource = 'agent_core_gemini' | 'local_text_layer' | 'manual';

export interface FieldTraceability {
    value: string | null;
    confidence: number;
    source?: ExtractionSource;
    sourceReference?: string;
    sourceDocument?: string;
    requiresReview?: boolean;
    warnings?: string[];
}

export type DetectedDocType = 
    | 'reprocann'
    | 'consentimiento'
    | 'constancia_tramite'
    | 'dni'
    | 'receta'
    | 'desconocido';

export interface UnifiedDocumentExtraction {
    documentType: DetectedDocType;
    numeroTramite?: string;
    titular?: {
        nombre?: string;
        apellido?: string;
    };
    dni?: string;
    fechaNacimiento?: string; // YYYY-MM-DD
    fechaEmision?: string;    // YYYY-MM-DD
    fechaVencimiento?: string;// YYYY-MM-DD
    tipoAutorizacion?: 'autocultivo' | 'solidario' | 'ong' | string;
    medico?: {
        nombre?: string;
        matricula?: string;
    };
    diagnostico?: string;
    confidence: {
        overall: number; // 0.0 a 1.0
        fields: Record<string, number>;
    };
    isLegible: boolean;
    extractionSource: ExtractionSource;
    sourceDescription: string;
    warnings: string[];
    errors: string[];
    humanValidated: boolean;
    validatedBy?: string;
    validatedAt?: string;

    // UX-03C.1 y UX-03D: Diagnóstico granular, trazabilidad y soporte multi-documento
    totalPages?: number;
    requiresVisualOcr?: boolean;
    hasImageOnlyLayer?: boolean;
    detectedFieldsCount?: number;
    fieldTraceability?: Record<string, FieldTraceability>;
    canRetryGemini?: boolean;
    failureReason?: string;
}

export interface DocumentConflict {
    field: string;
    label: string;
    fileA: string;
    valueA: string;
    fileB: string;
    valueB: string;
}

export interface ConsolidatedDocumentResult {
    consolidated: Partial<{
        nombre: string;
        apellido: string;
        dni: string;
        fechaNacimiento: string;
        numeroTramite: string;
        fechaAlta: string;
        fechaVencimiento: string;
        tipoVinculacion: string;
        medicoNombre: string;
        medicoMatricula: string;
        diagnosticoPrincipal: string;
        fuenteExtraccion: string;
        camposExtraidos: string[];
    }>;
    conflicts: DocumentConflict[];
    fieldTraceability: Record<string, FieldTraceability>;
    documentSummaries: Array<{
        filename: string;
        docType: DetectedDocType;
        totalPages: number;
        requiresVisualOcr: boolean;
        isLegible: boolean;
        detectedFields: string[];
        warnings: string[];
        confidence: number;
        extraction: UnifiedDocumentExtraction;
    }>;
}

// Backward compatibility alias
export type OcrExtractedReprocann = {
    numeroTramite: string;
    titular: {
        nombre: string;
        apellido: string;
    };
    dni: string;
    fechaEmision: string;
    fechaVencimiento: string;
    tipoAutorizacion: string;
    medico?: {
        nombre?: string;
        matricula?: string;
    };
    confidence: {
        overall: number;
        numeroTramite?: number;
        fechas?: number;
        titular?: number;
    };
    humanValidated: boolean;
    validatedBy?: string;
    validatedAt?: string;
};

export interface OcrValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    data?: UnifiedDocumentExtraction;
}

/**
 * Normaliza y valida una fecha extraída en formatos comunes argentinos (DD/MM/YYYY o YYYY-MM-DD)
 * retornando formato canónico YYYY-MM-DD o null si es inválida.
 */
export function normalizeCalendarDate(rawDate: string): string | null {
    if (!rawDate) return null;
    const clean = rawDate.trim();

    // Caso YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
        return isValidCalendarDate(clean) ? clean : null;
    }

    // Caso DD/MM/YYYY o DD-MM-YYYY
    const dmyMatch = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmyMatch) {
        const day = dmyMatch[1].padStart(2, '0');
        const month = dmyMatch[2].padStart(2, '0');
        const year = dmyMatch[3];
        const iso = `${year}-${month}-${day}`;
        return isValidCalendarDate(iso) ? iso : null;
    }

    return null;
}

/**
 * Normaliza un número de DNI removiendo puntos, espacios y caracteres no numéricos.
 */
export function normalizeDni(rawDni?: string | null): string {
    if (!rawDni) return '';
    return rawDni.replace(/\D/g, '').trim();
}

/**
 * Valida cotejo de identidad entre el DNI de un documento y el DNI de un socio.
 */
export function validateIdentityMatch(docDni?: string | null, partnerDni?: string | null): {
    match: boolean;
    normalizedDoc: string;
    normalizedPartner: string;
} {
    const docClean = normalizeDni(docDni);
    const partnerClean = normalizeDni(partnerDni);

    if (!docClean || !partnerClean) {
        return { match: false, normalizedDoc: docClean, normalizedPartner: partnerClean };
    }

    return {
        match: docClean === partnerClean,
        normalizedDoc: docClean,
        normalizedPartner: partnerClean
    };
}

/**
 * Extrae la capa de texto de un Buffer PDF decodificando streams no comprimidos
 * y streams comprimidos con FlateDecode mediante zlib. (Método síncrono para fallback).
 */
export function extractTextFromPdfBuffer(buffer: Buffer): string {
    const raw = buffer.toString('binary');
    let fullText = '';

    // 1. Fragmentos directos de texto Tj / TJ no comprimidos
    const tjDirect = raw.match(/\(([^)]+)\)\s*Tj/g) || [];
    for (const m of tjDirect) {
        fullText += m.replace(/^\(/, '').replace(/\)\s*Tj$/, '') + ' ';
    }

    // 2. Extraer y descomprimir streams FlateDecode
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;

    while ((match = streamRegex.exec(raw)) !== null) {
        const sIndex = match.index;
        const streamHeader = raw.substring(Math.max(0, sIndex - 200), sIndex);
        const isFlate = streamHeader.includes('/FlateDecode');

        const streamStart = sIndex + match[0].indexOf('\n') + 1;
        const streamEnd = sIndex + match[0].lastIndexOf('endstream') - 1;
        if (streamEnd <= streamStart) continue;

        const slice = buffer.subarray(streamStart, streamEnd);

        if (isFlate) {
            try {
                const decompressed = zlib.inflateSync(slice).toString('utf-8');
                const tjMatches = decompressed.match(/\(([^)]+)\)\s*Tj/g) || [];
                for (const tm of tjMatches) {
                    fullText += tm.replace(/^\(/, '').replace(/\)\s*Tj$/, '') + ' ';
                }
                const arrayMatches = decompressed.match(/\[(.*?)\]\s*TJ/g) || [];
                for (const arr of arrayMatches) {
                    const subTexts = arr.match(/\(([^)]+)\)/g) || [];
                    for (const st of subTexts) {
                        fullText += st.slice(1, -1) + ' ';
                    }
                }
            } catch {
                // Stream con formato alternativo o no zlib, continuar
            }
        }
    }

    // 3. Fallback de cadenas legibles en el buffer bruto
    const asciiText = buffer.toString('utf-8', 0, Math.min(buffer.length, 100000));
    fullText += ' ' + asciiText;

    return fullText.replace(/\s+/g, ' ').trim();
}

/**
 * Extrae texto digital de un PDF de forma asíncrona mediante unpdf (PDF.js oficial).
 * Soporta documentos multipágina, fuentes con ToUnicode CMaps y compresión estándar.
 */
export async function extractTextFromPdfBufferAsync(buffer: Buffer | Uint8Array): Promise<{
    text: string;
    totalPages: number;
    isLikelyImageOnly: boolean;
}> {
    try {
        let uint8: Uint8Array;
        if (Buffer.isBuffer(buffer)) {
            uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        } else if (buffer instanceof Uint8Array) {
            uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        } else {
            const buf = Buffer.from(buffer as any);
            uint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        }
        const { text, totalPages } = await extractText(uint8, { mergePages: true });
        const rawText: any = text;
        let mergedText = (typeof rawText === 'string' ? rawText : Array.isArray(rawText) ? rawText.join('\n') : '').trim();

        // Reparación de encoding si secuencias UTF-8 fueron leídas como Latin-1 / WinAnsi
        if (mergedText.includes('Ã') || mergedText.includes('Â')) {
            try {
                const repaired = Buffer.from(mergedText, 'latin1').toString('utf8');
                if (!repaired.includes('\uFFFD')) {
                    mergedText = repaired;
                }
            } catch {
                // mantener texto original si falla conversión
            }
        }

        const numPages = totalPages || 1;

        // Si hay menos de 220 caracteres en total o menos de 75 caracteres promedio por página,
        // es un documento que depende primordialmente de imágenes rasterizadas (ej. credencial con carnet incrustado)
        const isLikelyImageOnly = mergedText.length < 220 || (numPages > 0 && mergedText.length / numPages < 75);

        return {
            text: mergedText,
            totalPages: numPages,
            isLikelyImageOnly
        };
    } catch (e: any) {
        // Fallback a parser binario básico de streams si unpdf encuentra una estructura no estándar
        const fallbackBuf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
        const fallbackText = extractTextFromPdfBuffer(fallbackBuf);
        return {
            text: fallbackText,
            totalPages: 1,
            isLikelyImageOnly: fallbackText.length < 150
        };
    }
}

/**
 * Sanea y valida estrictamente el nombre del profesional médico extraído de capa de texto local.
 * REGLA CLÍNICA UX-03D.1: La lectura de texto NO equivale a interpretación clínica.
 * Descarta fragmentos narrativos, frases jurídicas y palabras de enlace.
 */
export function sanitizeLocalDoctorName(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const trimmed = raw.trim();

    // Palabras de parada narrativas / jurídicas que indican que se capturó prosa o cláusulas
    const narrativeStopWords = [
        'de la', 'de el', 'del', 'actuante', 'tratante', 'que', 'para', 'por', 'con',
        'conforme', 'según', 'segun', 'declara', 'manifiesta', 'informa', 'informado',
        'paciente', 'asociación', 'asociacion', 'efectos', 'adversos', 'riesgos',
        'beneficios', 'tratamiento', 'marco', 'legal', 'normativa', 'decreto', 'ley',
        'salud', 'certificado', 'reprocann', 'titular', 'socio', 'firma', 'sello',
        'aclaración', 'aclaracion', 'suscribe', 'interviniente', 'garantía', 'garantia'
    ];
    const lower = trimmed.toLowerCase();
    for (const sw of narrativeStopWords) {
        if (lower.includes(sw)) return undefined;
    }

    // Limpiar prefijo Dr. / Dra.
    const cleanPrefix = trimmed.replace(/^(?:dr\.|dra\.|profesional|médico|medico)[\s:\.]*/i, '').trim();
    const words = cleanPrefix.split(/\s+/).filter(Boolean);

    // Debe contener entre 2 y 4 palabras con mayúscula inicial (Nombre y Apellido)
    if (words.length < 2 || words.length > 4) {
        return undefined;
    }

    for (const w of words) {
        if (!/^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ]+$/.test(w)) {
            return undefined;
        }
    }

    const hasDra = /dra\./i.test(trimmed);
    const hasDr = /dr\./i.test(trimmed);
    const prefix = hasDra ? 'Dra. ' : (hasDr ? 'Dr. ' : '');

    return `${prefix}${words.join(' ')}`;
}

/**
 * Sanea y valida estrictamente el diagnóstico médico (aplicable tanto a extracción local como Agent Core / Gemini).
 * REGLA CLÍNICA UX-03D.3: 
 * 1. Delimitar y extraer únicamente la patología / afección clínica.
 * 2. Si el texto incluye secciones posteriores como 'Antecedentes:', 'Tratamiento:', 'Evolución:', 'Firma:', etc.,
 *    recortar estrictamente antes de dichas secciones.
 * 3. NUNCA admitir fragmentos narrativos genéricos, cláusulas legales ni advertencias.
 */
export function sanitizeDiagnosis(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const rawLower = raw.toLowerCase().trim();

    // 0. Frases narrativas completas que descalifican inmediatamente cualquier texto clínico
    if (/\by\s+su\s+evoluci[oó]n\b/i.test(rawLower) || /^\s*y\s+su\b/i.test(rawLower)) {
        return undefined;
    }

    let trimmed = raw.trim();

    // 1. Quitar prefijos comunes: Diagnóstico:, Patología:, Dx:, Cuadro:
    trimmed = trimmed.replace(/^(?:diagn[oó]stico|patolog[ií]a|indicaci[oó]n\s*cl[ií]nica|cuadro(?:\s*cl[ií]nico)?|dx)[\s:\.#\-]*/i, '').trim();

    // 2. Recortar antes de secciones clínicas complementarias, evolución o firmas
    const sectionDelimiter = /(?:\.|\;|\n|\r|\s)\s*(?:antecedentes|tratamiento|evoluci[oó]n|historia(?:\s*cl[ií]nica)?|firma|sello|matr[ií]cula|posolog[ií]a|plan|m[eé]dico\s*actuante|profesional|paciente\s*manifiesta)\b/i;
    const delimMatch = trimmed.match(sectionDelimiter);
    if (delimMatch && delimMatch.index !== undefined && delimMatch.index > 0) {
        trimmed = trimmed.substring(0, delimMatch.index).trim();
    }

    // 3. Limpiar puntuación residual
    trimmed = trimmed.replace(/[\.\,\;\:\-\s]+$/, '').trim();

    // Descartar fragmentos que comienzan con conjunciones o posesivos aislados (ej. "y su", "de la")
    if (/^(?:y|o|e|u|de|del|la|el|los|las|su|sus|con|sin)\b/i.test(trimmed)) {
        return undefined;
    }

    // Longitud razonable para una patología concisa
    if (trimmed.length > 80 || trimmed.length < 4) return undefined;

    const lower = trimmed.toLowerCase();

    // Patrones narrativos sobre el fragmento final
    const narrativePhrasePatterns = [
        /\by\s+no\s+refiere\b/i,
        /\bno\s+refiere\s+efectos\b/i,
        /\befectos\s+adversos\b/i,
        /\brefiere\b/i,
        /\bpresenta\s+cuadro\b/i,
        /\btolerancia\b/i,
        /\bbuena\s+tolerancia\b/i,
        /\bseg[uú]n\s+criterio\b/i,
        /\bgarant[ií]a\s+de\b/i,
        /\bper[ií]odo\s+de\b/i,
        /\bsujet[oa]\s+a\b/i,
        /\bconstat[oó]\b/i
    ];
    for (const pattern of narrativePhrasePatterns) {
        if (pattern.test(lower)) return undefined;
    }

    const legalOrNarrativeWords = [
        'ley', 'decreto', 'normativa', 'conforme', 'artículo', 'articulo',
        'resolución', 'resolucion', 'garantía', 'garantia', 'resultado',
        'efectos', 'secundarios', 'adversos', 'riesgos', 'consentimiento',
        'informado', 'reprocann', 'programa', 'ministerio', 'salud',
        'declaración', 'declaracion', 'jurada', 'manifiesta', 'declara',
        'asociación', 'asociacion', 'según', 'segun', 'indica'
    ];
    for (const w of legalOrNarrativeWords) {
        if (lower.includes(w)) return undefined;
    }

    return trimmed;
}

export function sanitizeLocalDiagnosis(raw: string | undefined): string | undefined {
    return sanitizeDiagnosis(raw);
}

/**
 * Normaliza y valida la matrícula médica extraída de capa de texto local.
 */
export function sanitizeLocalMatricula(rawMatricula?: string, fullContext?: string): string | undefined {
    if (!rawMatricula) return undefined;
    let val = rawMatricula.trim().replace(/^[:\.\-#\s]+/, '');
    if (!val || val.length < 3) return undefined;

    const hasMN = /^(?:mn|m\.n\.)/i.test(val);
    const hasMP = /^(?:mp|m\.p\.)/i.test(val);

    if (hasMN) {
        val = val.replace(/^(?:mn|m\.n\.)\s*/i, 'MN ').trim();
    } else if (hasMP) {
        val = val.replace(/^(?:mp|m\.p\.)\s*/i, 'MP ').trim();
    } else if (fullContext) {
        if (/matr[ií]cula\s*nacional/i.test(fullContext)) {
            val = `MN ${val}`;
        } else if (/matr[ií]cula\s*provincial/i.test(fullContext)) {
            val = `MP ${val}`;
        }
    }
    return val;
}

/**
 * Analiza el texto extraído de un documento para identificar campos canónicos.
 */
export function extractDataFromDocumentText(text: string, filename?: string, totalPages = 1): UnifiedDocumentExtraction {
    const warnings: string[] = [];
    const errors: string[] = [];
    const fieldsConf: Record<string, number> = {};

    const cleanText = text || '';
    const fnLower = (filename || '').toLowerCase();
    const textLower = cleanText.toLowerCase();

    // 1. Detección de tipo de documento
    let docType: DetectedDocType = 'desconocido';

    if (textLower.includes('consentimiento') || textLower.includes('declaracion jurada') || textLower.includes('declaración jurada') || fnLower.includes('consentimiento')) {
        docType = 'consentimiento';
    } else if (textLower.includes('constancia') || textLower.includes('tramite en curso') || textLower.includes('trámite en curso') || fnLower.includes('constancia')) {
        docType = 'constancia_tramite';
    } else if (textLower.includes('registro nacional de las personas') || textLower.includes('renaper') || fnLower.includes('dni')) {
        docType = 'dni';
    } else if (textLower.includes('reprocann') || textLower.includes('programa de cannabis') || textLower.includes('credencial') || textLower.includes('carnet') || fnLower.includes('reprocann') || fnLower.includes('credencial')) {
        docType = 'reprocann';
    }

    // 2. Detección de credencial o documento basado en imagen rasterizada
    const isCredentialKeyword = textLower.includes('credencial') || 
                                textLower.includes('carnet') || 
                                textLower.includes('certificado de inscripci') || 
                                fnLower.includes('credencial') || 
                                fnLower.includes('carnet');
    const isSparseText = cleanText.length < 250;
    const isLikelyImageCredential = (isCredentialKeyword && isSparseText) || (docType === 'reprocann' && cleanText.length < 160);

    if (isLikelyImageCredential) {
        warnings.push('Credencial REPROCANN con imagen rasterizada incrustada. El archivo carece de capa de texto digital legible para los datos principales del carnet; requiere verificación visual o procesamiento por visión multimodal en Agent Core. No se sobrescribieron datos previos.');
    }

    // 3. Extracción de Trámite REPROCANN
    let numeroTramite: string | undefined;
    const tramiteRegexes = [
        /(?:tr[aá\W]?mite|n[uú\W]?mero de tr[aá\W]?mite|nro\s*tr[aá\W]?mite|c[oó\W]?digo|n[°º\W]?\s*de\s*solicitud|solicitud|expediente)[\s:\.#]*([A-Z0-9\-_]{4,25})/i,
        /TR-[\w\-]{4,25}/i
    ];
    for (const r of tramiteRegexes) {
        const m = cleanText.match(r);
        if (m) {
            const candidate = (m[1] || m[0]).trim();
            const upper = candidate.toUpperCase();
            if (!['PENDIENTE', 'RECHAZADO', 'CANCELADO', 'VENCIDO', 'EN_TRAMITE', 'EN TRAMITE', 'PRELIMINAR', 'BORRADOR', 'VIGENTE'].includes(upper)) {
                numeroTramite = candidate;
                fieldsConf['numeroTramite'] = 0.95;
                break;
            }
        }
    }

    // 4. Extracción de DNI
    let dni: string | undefined;
    const dniRegexes = [
        /(?:dni|d\.n\.i\.|documento|identidad)[\s:\.#]*([0-9]{1,2}\.?[0-9]{3}\.?[0-9]{3})/i,
        /\b([0-9]{7,8})\b/
    ];
    for (const r of dniRegexes) {
        const m = cleanText.match(r);
        if (m) {
            const num = normalizeDni(m[1] || m[0]);
            if (num.length >= 7 && num.length <= 8) {
                dni = num;
                fieldsConf['dni'] = 0.9;
                break;
            }
        }
    }

    // 5. Extracción de Titular (Nombre y Apellido con soporte para compuestos)
    let titular: { nombre?: string; apellido?: string } | undefined;
    const titularLineMatch = cleanText.match(/(?:^|[\r\n])\s*(?:apellido y nombre|nombre y apellido|paciente|titular|socio)[\s:\.#]*([^\r\n]+)/i);
    if (titularLineMatch) {
        const rawVal = titularLineMatch[1].trim();
        if (rawVal.includes(',')) {
            const parts = rawVal.split(',').map(p => p.trim());
            if (parts[0] && parts[1]) {
                titular = {
                    apellido: parts[0],
                    nombre: parts[1]
                };
                fieldsConf['titular'] = 0.9;
            }
        } else {
            const words = rawVal.split(/\s+/).filter(w => /^[A-ZÁÉÍÓÚÑa-záéíóúñ]+$/.test(w));
            if (words.length >= 2) {
                const compoundParticles = ['de', 'del', 'la', 'las', 'los', 'san', 'santa', 'di', 'da', 'dos', 'van', 'von'];
                if (/nombre y apellido/i.test(titularLineMatch[0])) {
                    if (words.length === 2) {
                        titular = { nombre: words[0], apellido: words[1] };
                    } else if (words.length === 3) {
                        if (compoundParticles.includes(words[1].toLowerCase())) {
                            titular = { nombre: words[0], apellido: `${words[1]} ${words[2]}` };
                        } else {
                            titular = { nombre: `${words[0]} ${words[1]}`, apellido: words[2] };
                        }
                    } else {
                        // 4 palabras: "Juan Manuel Perez Garcia" o "Juan Manuel de la Fuente"
                        const pIdx = words.findIndex((w, i) => i > 0 && compoundParticles.includes(w.toLowerCase()));
                        if (pIdx > 0) {
                            titular = { nombre: words.slice(0, pIdx).join(' '), apellido: words.slice(pIdx).join(' ') };
                        } else {
                            titular = { nombre: words.slice(0, 2).join(' '), apellido: words.slice(2).join(' ') };
                        }
                    }
                } else {
                    // "Apellido y Nombre"
                    if (words.length === 2) {
                        titular = { apellido: words[0], nombre: words[1] };
                    } else if (words.length === 3) {
                        if (compoundParticles.includes(words[0].toLowerCase())) {
                            titular = { apellido: `${words[0]} ${words[1]}`, nombre: words[2] };
                        } else {
                            titular = { apellido: words[0], nombre: `${words[1]} ${words[2]}` };
                        }
                    } else {
                        titular = { apellido: `${words[0]} ${words[1]}`, nombre: words.slice(2).join(' ') };
                    }
                }
                fieldsConf['titular'] = 0.85;
            }
        }
    }

    // 6. Extracción de Fecha de Nacimiento
    let fechaNacimiento: string | undefined;
    const nacMatch = cleanText.match(/(?:nacimiento|nacido el|fecha de nacimiento|f\.\s*nac\.?)[\s:\.#]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}-\d{2}-\d{2})/i);
    if (nacMatch) {
        const norm = normalizeCalendarDate(nacMatch[1]);
        if (norm) {
            fechaNacimiento = norm;
            fieldsConf['fechaNacimiento'] = 0.9;
        }
    }

    // 7. Detección de Firmas Digitales vs Fechas de Emisión y Vencimiento
    const hasDigitalSignature = /firmad[oa] digitalmente|firma digital|validez de la firma|firmado por/i.test(cleanText);
    if (hasDigitalSignature) {
        warnings.push('Se detectó firma digital en el documento. Por normativa de seguridad, su marca temporal no se asume como fecha de emisión ni vencimiento REPROCANN.');
    }

    // Fecha de Emisión (REGLA UX-03D.2: Solo documentos oficiales REPROCANN pueden definir fecha de emisión/alta)
    let fechaEmision: string | undefined;
    if (docType === 'reprocann') {
        const emisionMatch = cleanText.match(/(?:emisi[oó]n|alta|otorgado|fecha de emisi[oó]n|solicitado el)[\s:\.#]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}-\d{2}-\d{2})/i);
        if (emisionMatch) {
            const norm = normalizeCalendarDate(emisionMatch[1]);
            if (norm) {
                fechaEmision = norm;
                fieldsConf['fechaEmision'] = 0.9;
            }
        }
    }

    // Fecha de Vencimiento
    // En consentimientos informados no hay vencimiento oficial de credencial: no asignar.
    let fechaVencimiento: string | undefined;
    if (docType !== 'consentimiento') {
        const vencimientoMatch = cleanText.match(/(?:vencimiento|v[aá\W]?lido hasta|vigencia hasta|vence el|vence)[\s:\.#]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}-\d{2}-\d{2})/i);
        if (vencimientoMatch) {
            const norm = normalizeCalendarDate(vencimientoMatch[1]);
            if (norm) {
                fechaVencimiento = norm;
                fieldsConf['fechaVencimiento'] = 0.9;
            }
        }
    }

    // 8. Extracción de Médico y Matrícula (Regla UX-03D.1: Sanitización clínica estricta)
    let medico: { nombre?: string; matricula?: string } | undefined;
    const medicoMatch = cleanText.match(/(?:profesional\s*m.*?dico\s*tratante|profesional\s*m.*?dico|m.*?dico\s*tratante|m.*?dico|profesional|dr\.|dra\.)[\s:\.#]*([A-ZÁÉÍÓÚÑa-záéíóúñ\.\s]{3,45}?)(?=\s*matr|\s*m\.n|\s*m\.p|\s*firma|\s*diagn|\s*,|\r|\n|$)/i);
    const matriculaMatch = cleanText.match(/(?:matr[ií]cula(?:\s+(?:nacional|provincial))?(?:\s+n[ºo°]\.?)?|m\.n\.|m\.p\.|mp|mn)[\s:\.#\-]*((?:(?:MN|MP|M\.N\.|M\.P\.)\s*)?[0-9A-Z\-]{3,12})/i);

    const sanitizedDocName = sanitizeLocalDoctorName(medicoMatch ? medicoMatch[1] : undefined);
    const sanitizedMatricula = sanitizeLocalMatricula(matriculaMatch ? matriculaMatch[1] : undefined, matriculaMatch ? matriculaMatch[0] : undefined);

    if (sanitizedDocName || sanitizedMatricula) {
        medico = {
            nombre: sanitizedDocName,
            matricula: sanitizedMatricula
        };
        if (sanitizedDocName) fieldsConf['medicoNombre'] = 0.85;
        if (sanitizedMatricula) fieldsConf['medicoMatricula'] = 0.9;
    }

    if (medicoMatch && !sanitizedDocName) {
        warnings.push('Nombre de profesional médico no concluyente en capa de texto. Se requiere validación manual o visión multimodal.');
    }

    // 9. Extracción de Diagnóstico o Indicación Clínica (Regla UX-03D.1: Cero inferencias vagas)
    let diagnostico: string | undefined;
    const diagMatch = cleanText.match(/(?:diagn.*?stico|patolog.*?a|indicaci.*?n cl.*?nica|cuadro)[\s:\.#]*([^\r\n]{3,80}?)(?=\s*plan|\s*tratamiento|\s*m.*?dico|\s*firma|\r|\n|$)/i);
    const sanitizedDiag = sanitizeLocalDiagnosis(diagMatch ? diagMatch[1] : undefined);

    if (sanitizedDiag) {
        diagnostico = sanitizedDiag;
        fieldsConf['diagnostico'] = 0.8;
    } else if (diagMatch) {
        warnings.push('Diagnóstico no inferido automáticamente desde capa de texto para preservar integridad clínica. Pendiente de revisión.');
    }

    // 10. Cálculo de legibilidad y confianza general
    const detectedFieldKeys = Object.keys(fieldsConf);
    const detectedFieldsCount = detectedFieldKeys.length;
    const isLegible = detectedFieldsCount > 0 && !isLikelyImageCredential;
    const overallConf = isLegible 
        ? Math.min(1.0, detectedFieldKeys.reduce((acc, k) => acc + fieldsConf[k], 0) / detectedFieldsCount)
        : (isLikelyImageCredential ? 0.1 : 0.0);

    if (!isLegible && !isLikelyImageCredential) {
        warnings.push('No se detectó capa de texto digital legible. El archivo podría ser un escaneo o imagen rasterizada. Requiere completar los datos manualmente.');
    }

    if (fechaEmision && fechaVencimiento && fechaVencimiento < fechaEmision) {
        warnings.push('La fecha de vencimiento detectada es anterior a la fecha de emisión');
    }

    // Trazabilidad granular para campos extraídos localmente
    const localTraceability: Record<string, FieldTraceability> = {};
    if (titular?.nombre) localTraceability['nombre'] = { value: titular.nombre, confidence: fieldsConf['titular'] || 0.85, source: 'local_text_layer', sourceReference: 'Texto digital', requiresReview: false, warnings: [] };
    if (titular?.apellido) localTraceability['apellido'] = { value: titular.apellido, confidence: fieldsConf['titular'] || 0.85, source: 'local_text_layer', sourceReference: 'Texto digital', requiresReview: false, warnings: [] };
    if (dni) localTraceability['dni'] = { value: dni, confidence: fieldsConf['dni'] || 0.9, source: 'local_text_layer', sourceReference: 'Texto digital', requiresReview: false, warnings: [] };
    if (fechaNacimiento) localTraceability['fechaNacimiento'] = { value: fechaNacimiento, confidence: fieldsConf['fechaNacimiento'] || 0.9, source: 'local_text_layer', sourceReference: 'Texto digital', requiresReview: false, warnings: [] };
    if (numeroTramite) localTraceability['numeroTramite'] = { value: numeroTramite, confidence: fieldsConf['numeroTramite'] || 0.95, source: 'local_text_layer', sourceReference: 'Texto digital', requiresReview: false, warnings: [] };
    if (fechaEmision) localTraceability['fechaEmision'] = { value: fechaEmision, confidence: fieldsConf['fechaEmision'] || 0.9, source: 'local_text_layer', sourceReference: 'Texto digital', requiresReview: false, warnings: [] };
    if (fechaVencimiento) localTraceability['fechaVencimiento'] = { value: fechaVencimiento, confidence: fieldsConf['fechaVencimiento'] || 0.9, source: 'local_text_layer', sourceReference: 'Texto digital', requiresReview: false, warnings: [] };
    if (medico?.nombre) localTraceability['medicoNombre'] = { value: medico.nombre, confidence: fieldsConf['medicoNombre'] || 0.85, source: 'local_text_layer', sourceReference: 'Texto digital', requiresReview: false, warnings: [] };
    if (medico?.matricula) localTraceability['medicoMatricula'] = { value: medico.matricula, confidence: fieldsConf['medicoMatricula'] || 0.9, source: 'local_text_layer', sourceReference: 'Texto digital', requiresReview: false, warnings: [] };
    if (diagnostico) localTraceability['diagnosticoPrincipal'] = { value: diagnostico, confidence: fieldsConf['diagnostico'] || 0.5, source: 'local_text_layer', sourceReference: 'Texto digital', requiresReview: true, warnings: ['Pendiente de validación médica'] };

    return {
        documentType: docType,
        numeroTramite,
        titular,
        dni,
        fechaNacimiento,
        fechaEmision,
        fechaVencimiento,
        tipoAutorizacion: docType === 'reprocann' ? 'ong' : undefined,
        medico,
        diagnostico,
        confidence: {
            overall: Number(overallConf.toFixed(2)),
            fields: fieldsConf
        },
        isLegible,
        extractionSource: 'local_text_layer',
        sourceDescription: 'Extracción de capa de texto digital (Optimización local con unpdf)',
        warnings,
        errors,
        humanValidated: false,
        totalPages,
        requiresVisualOcr: isLikelyImageCredential,
        hasImageOnlyLayer: isLikelyImageCredential,
        detectedFieldsCount,
        fieldTraceability: localTraceability
    };
}

/**
 * Consolida múltiples extracciones documentales, detecta discrepancias o conflictos
 * y produce un resumen granular para control humano en el wizard.
 */
export function consolidateDocumentExtractions(
    items: Array<{ filename: string; extraction: UnifiedDocumentExtraction }>
): ConsolidatedDocumentResult {
    const consolidated: any = {};
    const conflicts: DocumentConflict[] = [];
    const documentSummaries: ConsolidatedDocumentResult['documentSummaries'] = [];
    const fieldsOrigin: Record<string, { filename: string; value: any }> = {};
    const fieldTraceability: Record<string, FieldTraceability> = {};
    let hasGeminiSource = false;

    for (const item of items) {
        const { filename, extraction } = item;
        const detectedFields: string[] = [];

        if (extraction.extractionSource === 'agent_core_gemini') {
            hasGeminiSource = true;
        }

        // Incorporar trazabilidad de campos granular con mapeo cruzado snake_case y camelCase
        if (extraction.fieldTraceability) {
            const camelFieldMap: Record<string, string> = {
                numero_tramite: 'numeroTramite',
                fecha_emision: 'fechaEmision',
                fecha_alta: 'fechaAlta',
                fecha_vencimiento: 'fechaVencimiento',
                tipo_autorizacion: 'tipoAutorizacion',
                medico_nombre: 'medicoNombre',
                medico_matricula: 'medicoMatricula',
                diagnostico: 'diagnosticoPrincipal',
                fecha_nacimiento: 'fechaNacimiento',
                nombre: 'nombre',
                apellido: 'apellido',
                dni: 'dni'
            };

            for (const [k, trace] of Object.entries(extraction.fieldTraceability)) {
                const targetKey = camelFieldMap[k] || k;
                const rawTrace: any = trace || {};
                const traceObj: FieldTraceability = {
                    value: typeof rawTrace.value !== 'undefined' ? String(rawTrace.value) : String(rawTrace),
                    confidence: typeof rawTrace.confidence === 'number' ? rawTrace.confidence : (extraction.confidence.overall || 0.9),
                    source: rawTrace.source || extraction.extractionSource,
                    sourceReference: rawTrace.sourceReference || rawTrace.source_reference || extraction.sourceDescription,
                    sourceDocument: filename,
                    requiresReview: Boolean(rawTrace.requiresReview || rawTrace.requires_review),
                    warnings: rawTrace.warnings || []
                };

                if (!fieldTraceability[targetKey] || (traceObj.confidence || 0) >= (fieldTraceability[targetKey].confidence || 0)) {
                    fieldTraceability[targetKey] = traceObj;
                }
                if (!fieldTraceability[k]) {
                    fieldTraceability[k] = traceObj;
                }
            }
        }

        if (extraction.titular?.nombre) detectedFields.push('nombre');
        if (extraction.titular?.apellido) detectedFields.push('apellido');
        if (extraction.dni) detectedFields.push('dni');
        if (extraction.fechaNacimiento) detectedFields.push('fechaNacimiento');
        if (extraction.numeroTramite) detectedFields.push('numeroTramite');
        if (extraction.fechaEmision) detectedFields.push('fechaAlta');
        if (extraction.fechaVencimiento) detectedFields.push('fechaVencimiento');
        if (extraction.medico?.nombre) detectedFields.push('medicoNombre');
        if (extraction.medico?.matricula) detectedFields.push('medicoMatricula');
        if (extraction.diagnostico) detectedFields.push('diagnosticoPrincipal');

        documentSummaries.push({
            filename,
            docType: extraction.documentType,
            totalPages: extraction.totalPages || 1,
            requiresVisualOcr: extraction.requiresVisualOcr || false,
            isLegible: extraction.isLegible,
            detectedFields,
            warnings: extraction.warnings || [],
            confidence: extraction.confidence.overall,
            extraction
        });

        // Si el documento carece de texto digital legible (imagen rasterizada) y no proviene de Agent Core, no participa en consolidación ni genera conflictos falsos
        if (extraction.requiresVisualOcr && detectedFields.length === 0 && extraction.extractionSource !== 'agent_core_gemini') {
            continue;
        }

        const assignOrConflict = (fieldKey: string, fieldLabel: string, newVal: any) => {
            if (!newVal) return;
            const existing = fieldsOrigin[fieldKey];
            if (!existing) {
                fieldsOrigin[fieldKey] = { filename, value: newVal };
                consolidated[fieldKey] = newVal;
                if (!fieldTraceability[fieldKey]) {
                    fieldTraceability[fieldKey] = {
                        value: String(newVal),
                        confidence: extraction.confidence.fields[fieldKey] || extraction.confidence.overall,
                        source: extraction.extractionSource,
                        sourceReference: extraction.sourceDescription,
                        sourceDocument: filename,
                        requiresReview: fieldKey === 'diagnosticoPrincipal' || (extraction.confidence.overall < 0.85),
                        warnings: []
                    };
                }
            } else {
                const normExisting = String(existing.value).trim().toLowerCase();
                const normNew = String(newVal).trim().toLowerCase();
                if (normExisting !== normNew) {
                    conflicts.push({
                        field: fieldKey,
                        label: fieldLabel,
                        fileA: existing.filename,
                        valueA: String(existing.value),
                        fileB: filename,
                        valueB: String(newVal)
                    });
                }
            }
        };

        if (extraction.titular?.nombre) assignOrConflict('nombre', 'Nombre', extraction.titular.nombre);
        if (extraction.titular?.apellido) assignOrConflict('apellido', 'Apellido', extraction.titular.apellido);
        if (extraction.dni) assignOrConflict('dni', 'DNI', extraction.dni);
        if (extraction.fechaNacimiento) assignOrConflict('fechaNacimiento', 'Fecha de Nacimiento', extraction.fechaNacimiento);
        if (extraction.numeroTramite) assignOrConflict('numeroTramite', 'Número de Trámite', extraction.numeroTramite);

        // Tratamiento inteligente de fecha de alta: Únicamente certificados o constancias oficiales REPROCANN definen fechaAlta
        if (extraction.fechaEmision && extraction.documentType === 'reprocann') {
            const existingOriginItem = fieldsOrigin['fechaAlta']
                ? items.find(i => i.filename === fieldsOrigin['fechaAlta'].filename)
                : null;
            if (existingOriginItem && existingOriginItem.extraction.documentType !== 'reprocann') {
                fieldsOrigin['fechaAlta'] = { filename, value: extraction.fechaEmision };
                consolidated['fechaAlta'] = extraction.fechaEmision;
                fieldTraceability['fechaAlta'] = {
                    value: String(extraction.fechaEmision),
                    confidence: extraction.confidence.fields['fechaEmision'] || extraction.confidence.overall,
                    source: extraction.extractionSource,
                    sourceReference: extraction.sourceDescription,
                    sourceDocument: filename,
                    requiresReview: false,
                    warnings: []
                };
            } else {
                assignOrConflict('fechaAlta', 'Fecha de Alta REPROCANN', extraction.fechaEmision);
            }
        }

        // Vencimiento REPROCANN: La credencial/certificado REPROCANN es la fuente oficial
        if (extraction.fechaVencimiento) {
            if (extraction.documentType === 'reprocann') {
                const existingOriginItem = fieldsOrigin['fechaVencimiento']
                    ? items.find(i => i.filename === fieldsOrigin['fechaVencimiento'].filename)
                    : null;
                if (existingOriginItem && existingOriginItem.extraction.documentType !== 'reprocann') {
                    fieldsOrigin['fechaVencimiento'] = { filename, value: extraction.fechaVencimiento };
                    consolidated['fechaVencimiento'] = extraction.fechaVencimiento;
                    fieldTraceability['fechaVencimiento'] = {
                        value: String(extraction.fechaVencimiento),
                        confidence: extraction.confidence.fields['fechaVencimiento'] || extraction.confidence.overall,
                        source: extraction.extractionSource,
                        sourceReference: extraction.sourceDescription,
                        sourceDocument: filename,
                        requiresReview: false,
                        warnings: []
                    };
                } else {
                    assignOrConflict('fechaVencimiento', 'Fecha de Vencimiento', extraction.fechaVencimiento);
                }
            } else if (!consolidated.fechaVencimiento) {
                assignOrConflict('fechaVencimiento', 'Fecha de Vencimiento', extraction.fechaVencimiento);
            }
        }

        // Datos clínicos (Médico, Matrícula, Diagnóstico):
        // REGLA CLÍNICA UX-03D.2: El diagnóstico y médico deben priorizar Gemini Vision.
        // Si proviene de texto digital local, no contaminar automáticamente la propuesta final sin verificación humana.
        if (extraction.medico?.nombre) {
            const isGemini = extraction.extractionSource === 'agent_core_gemini';
            const existingOriginItem = fieldsOrigin['medicoNombre']
                ? items.find(i => i.filename === fieldsOrigin['medicoNombre'].filename)
                : null;
            if (isGemini && existingOriginItem && existingOriginItem.extraction.extractionSource !== 'agent_core_gemini') {
                fieldsOrigin['medicoNombre'] = { filename, value: extraction.medico.nombre };
                consolidated['medicoNombre'] = extraction.medico.nombre;
                fieldTraceability['medicoNombre'] = {
                    value: String(extraction.medico.nombre),
                    confidence: extraction.confidence.fields['medico'] || extraction.confidence.overall,
                    source: extraction.extractionSource,
                    sourceReference: extraction.sourceDescription,
                    sourceDocument: filename,
                    requiresReview: false,
                    warnings: []
                };
            } else {
                assignOrConflict('medicoNombre', 'Médico Tratante', extraction.medico.nombre);
            }
        }

        if (extraction.medico?.matricula) {
            assignOrConflict('medicoMatricula', 'Matrícula Médica', extraction.medico.matricula);
        }

        if (extraction.diagnostico) {
            const isGemini = extraction.extractionSource === 'agent_core_gemini';
            const effectiveDiagnosis = sanitizeDiagnosis(extraction.diagnostico) || (isGemini ? extraction.diagnostico : undefined);
            if (!effectiveDiagnosis) {
                // Diagnóstico ambiguo o descartado por heurística de integridad clínica
                continue;
            }

            const existingOriginItem = fieldsOrigin['diagnosticoPrincipal']
                ? items.find(i => i.filename === fieldsOrigin['diagnosticoPrincipal'].filename)
                : null;
            if (isGemini && existingOriginItem && existingOriginItem.extraction.extractionSource !== 'agent_core_gemini') {
                fieldsOrigin['diagnosticoPrincipal'] = { filename, value: effectiveDiagnosis };
                consolidated['diagnosticoPrincipal'] = effectiveDiagnosis;
                fieldTraceability['diagnosticoPrincipal'] = {
                    value: String(effectiveDiagnosis),
                    confidence: extraction.confidence.fields['diagnostico'] || extraction.confidence.overall,
                    source: extraction.extractionSource,
                    sourceReference: extraction.sourceDescription,
                    sourceDocument: filename,
                    requiresReview: false,
                    warnings: []
                };
            } else if (!consolidated.diagnosticoPrincipal) {
                fieldsOrigin['diagnosticoPrincipal'] = { filename, value: effectiveDiagnosis };
                consolidated['diagnosticoPrincipal'] = effectiveDiagnosis;
                fieldTraceability['diagnosticoPrincipal'] = {
                    value: String(effectiveDiagnosis),
                    confidence: extraction.confidence.fields['diagnostico'] || extraction.confidence.overall,
                    source: extraction.extractionSource,
                    sourceReference: extraction.sourceDescription,
                    sourceDocument: filename,
                    requiresReview: !isGemini,
                    warnings: isGemini ? [] : ['Diagnóstico detectado en texto digital local. Requiere verificación médica explícita.']
                };
            } else {
                assignOrConflict('diagnosticoPrincipal', 'Diagnóstico Principal', effectiveDiagnosis);
            }
        }
    }

    consolidated.camposExtraidos = Object.keys(fieldsOrigin);
    consolidated.fuenteExtraccion = hasGeminiSource
        ? 'Consolidación asistida con Gemini Vision (Agent Core)'
        : 'Consolidación multi-documental (unpdf + control asistido)';

    return {
        consolidated,
        conflicts,
        fieldTraceability,
        documentSummaries
    };
}

/**
 * Valida formalmente el payload unificado de extracción.
 */
export function validateUnifiedExtraction(extraction: UnifiedDocumentExtraction): OcrValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [...(extraction.warnings || [])];

    if (extraction.documentType === 'reprocann') {
        if (!extraction.numeroTramite) {
            warnings.push('Número de trámite REPROCANN no detectado en el documento');
        }
        if (extraction.fechaEmision && !isValidCalendarDate(extraction.fechaEmision)) {
            errors.push('Fecha de emisión con formato inválido');
        }
        if (extraction.fechaVencimiento && !isValidCalendarDate(extraction.fechaVencimiento)) {
            errors.push('Fecha de vencimiento con formato inválido');
        }
        if (extraction.fechaEmision && extraction.fechaVencimiento && extraction.fechaVencimiento < extraction.fechaEmision) {
            errors.push('La fecha de vencimiento no puede ser anterior a la fecha de emisión');
        }
    }

    if (extraction.dni && !/^\d{7,8}$/.test(normalizeDni(extraction.dni))) {
        warnings.push('DNI detectado no tiene longitud numérica estándar de 7 u 8 dígitos');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        data: extraction
    };
}

// Backward-compatible validation wrapper
export function validateOcrExtraction(payload: unknown): OcrValidationResult {
    if (!payload || typeof payload !== 'object') {
        return { valid: false, errors: ['El resultado de OCR debe ser un objeto válido'], warnings: [] };
    }
    const data = payload as any;
    if (data.documentType && data.extractionSource) {
        return validateUnifiedExtraction(data as UnifiedDocumentExtraction);
    }
    // Fallback old structure
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!data.numeroTramite || typeof data.numeroTramite !== 'string' || data.numeroTramite.trim() === '') {
        errors.push('Número de trámite no detectado o inválido');
    }
    if (!data.fechaEmision || !isValidCalendarDate(data.fechaEmision)) {
        errors.push('Fecha de emisión ausente o con formato de calendario inválido (esperado YYYY-MM-DD)');
    }
    if (!data.fechaVencimiento || !isValidCalendarDate(data.fechaVencimiento)) {
        errors.push('Fecha de vencimiento ausente o con formato de calendario inválido (esperado YYYY-MM-DD)');
    }
    if (data.fechaEmision && data.fechaVencimiento && data.fechaVencimiento < data.fechaEmision) {
        errors.push('La fecha de vencimiento no puede ser anterior a la fecha de emisión');
    }
    if (!data.titular?.nombre || !data.titular?.apellido) {
        warnings.push('Nombre y apellido del titular detectados parcialmente');
    }
    if (!data.dni || typeof data.dni !== 'string' || !/^\d{6,9}$/.test(data.dni.replace(/\D/g, ''))) {
        warnings.push('DNI detectado no tiene longitud numérica estándar');
    }
    const overallConf = data.confidence?.overall ?? 0;
    if (overallConf < 0.7) {
        warnings.push(`Nivel de confianza general bajo (${Math.round(overallConf * 100)}%). Requiere revisión visual exhaustiva.`);
    }
    if (data.humanValidated !== true) {
        warnings.push('La extracción no ha sido confirmada por un operador humano.');
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        data: errors.length === 0 ? (data as any) : undefined
    };
}

/**
 * Fusiona los datos extraídos de manera segura en un formulario de socio.
 * Protege contra sobreescritura accidental: solo sobrescribe si confirmOverwrite es true.
 */
export function mergeUnifiedExtractionWithPartner<T extends Record<string, any>>(
    current: T,
    extracted: UnifiedDocumentExtraction,
    confirmOverwrite = false
): T {
    const updated: any = { ...current };

    const shouldSet = (currVal: any, newVal: any) => {
        if (newVal === undefined || newVal === null || newVal === '') return false;
        if (currVal === undefined || currVal === null || currVal === '') return true;
        return confirmOverwrite;
    };

    if (extracted.titular?.nombre && shouldSet(updated.nombre, extracted.titular.nombre)) {
        updated.nombre = extracted.titular.nombre;
    }
    if (extracted.titular?.apellido && shouldSet(updated.apellido, extracted.titular.apellido)) {
        updated.apellido = extracted.titular.apellido;
    }
    if (extracted.dni && shouldSet(updated.dni, extracted.dni)) {
        updated.dni = extracted.dni;
    }
    if (extracted.fechaNacimiento && shouldSet(updated.fechaNacimiento, extracted.fechaNacimiento)) {
        updated.fechaNacimiento = extracted.fechaNacimiento;
    }
    if (extracted.numeroTramite && shouldSet(updated.numeroTramite || updated.reprocann_num_tramite, extracted.numeroTramite)) {
        if (updated.numeroTramite !== undefined) updated.numeroTramite = extracted.numeroTramite;
        if (updated.reprocann_num_tramite !== undefined) updated.reprocann_num_tramite = extracted.numeroTramite;
        if (updated.reprocann) updated.reprocann.numeroTramite = extracted.numeroTramite;
    }
    if (extracted.fechaEmision && shouldSet(updated.fechaAlta || updated.reprocann_fecha_alta, extracted.fechaEmision)) {
        if (updated.fechaAlta !== undefined) updated.fechaAlta = extracted.fechaEmision;
        if (updated.reprocann_fecha_alta !== undefined) updated.reprocann_fecha_alta = extracted.fechaEmision;
        if (updated.reprocann) updated.reprocann.fechaAlta = extracted.fechaEmision;
    }
    if (extracted.fechaVencimiento && shouldSet(updated.fechaVencimiento || updated.reprocann_fecha_vencimiento, extracted.fechaVencimiento)) {
        if (updated.fechaVencimiento !== undefined) updated.fechaVencimiento = extracted.fechaVencimiento;
        if (updated.reprocann_fecha_vencimiento !== undefined) updated.reprocann_fecha_vencimiento = extracted.fechaVencimiento;
        if (updated.reprocann) updated.reprocann.fechaVencimiento = extracted.fechaVencimiento;
    }
    if (extracted.medico?.nombre && shouldSet(updated.medicoNombre || updated.medico_nombre, extracted.medico.nombre)) {
        if (updated.medicoNombre !== undefined) updated.medicoNombre = extracted.medico.nombre;
        if (updated.medico_nombre !== undefined) updated.medico_nombre = extracted.medico.nombre;
    }
    if (extracted.medico?.matricula && shouldSet(updated.medicoMatricula || updated.medico_matricula, extracted.medico.matricula)) {
        if (updated.medicoMatricula !== undefined) updated.medicoMatricula = extracted.medico.matricula;
        if (updated.medico_matricula !== undefined) updated.medico_matricula = extracted.medico.matricula;
    }
    if (extracted.diagnostico && shouldSet(updated.diagnosticoPrincipal || updated.diagnostico, extracted.diagnostico)) {
        if (updated.diagnosticoPrincipal !== undefined) updated.diagnosticoPrincipal = extracted.diagnostico;
        if (updated.diagnostico !== undefined) updated.diagnostico = extracted.diagnostico;
    }

    return updated as T;
}

// Backward-compatible merger wrapper
export function mergeOcrWithPartnerData<T extends Record<string, any>>(
    current: T,
    extracted: any,
    confirmOverwrite = false
): T {
    return mergeUnifiedExtractionWithPartner(current, extracted, confirmOverwrite);
}
