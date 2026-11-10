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

export type ExtractionSource = 'agent_core_gemini' | 'local_text_layer' | 'manual';

export type DetectedDocType = 
    | 'reprocann'
    | 'consentimiento'
    | 'constancia_tramite'
    | 'dni'
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
 * y streams comprimidos con FlateDecode mediante zlib.
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
 * Analiza el texto extraído de un documento para identificar campos canónicos.
 */
export function extractDataFromDocumentText(text: string, filename?: string): UnifiedDocumentExtraction {
    const warnings: string[] = [];
    const errors: string[] = [];
    const fieldsConf: Record<string, number> = {};

    const cleanText = text || '';
    const fnLower = (filename || '').toLowerCase();

    // 1. Detección de tipo de documento
    let docType: DetectedDocType = 'desconocido';
    const textLower = cleanText.toLowerCase();

    if (textLower.includes('reprocann') || textLower.includes('programa de cannabis') || fnLower.includes('reprocann')) {
        docType = 'reprocann';
    } else if (textLower.includes('consentimiento') || textLower.includes('declaracion jurada') || fnLower.includes('consentimiento')) {
        docType = 'consentimiento';
    } else if (textLower.includes('constancia') || textLower.includes('tramite en curso') || fnLower.includes('constancia')) {
        docType = 'constancia_tramite';
    } else if (textLower.includes('registro nacional de las personas') || textLower.includes('renaper') || fnLower.includes('dni')) {
        docType = 'dni';
    }

    // 2. Extracción de Trámite REPROCANN
    let numeroTramite: string | undefined;
    const tramiteRegexes = [
        /(?:tr[aá]mite|n[uú]mero de tr[aá]mite|nro\s*tr[aá]mite|c[oó]digo)[\s:\.#]*([A-Z0-9\-_]{4,20})/i,
        /TR-[\w\-]{4,20}/i,
        /(?:solicitud|expediente)[\s:\.#]*([A-Z0-9\-_]{5,20})/i
    ];
    for (const r of tramiteRegexes) {
        const m = cleanText.match(r);
        if (m) {
            const candidate = (m[1] || m[0]).trim();
            const upper = candidate.toUpperCase();
            if (!['PENDIENTE', 'RECHAZADO', 'CANCELADO', 'VENCIDO', 'EN_TRAMITE', 'EN TRAMITE', 'PRELIMINAR', 'BORRADOR'].includes(upper)) {
                numeroTramite = candidate;
                fieldsConf['numeroTramite'] = 0.95;
                break;
            }
        }
    }

    // 3. Extracción de DNI
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

    // 4. Extracción de Titular (Nombre y Apellido)
    let titular: { nombre?: string; apellido?: string } | undefined;
    const titularMatch = cleanText.match(/(?:titular|nombre y apellido|apellido y nombre|socio|paciente)[\s:\.#]*([A-ZÁÉÍÓÚÑa-záéíóúñ]+)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+)?)/i);
    if (titularMatch) {
        titular = {
            apellido: titularMatch[1].trim(),
            nombre: titularMatch[2].trim()
        };
        fieldsConf['titular'] = 0.85;
    }

    // 5. Extracción de Fechas (Emisión y Vencimiento)
    let fechaEmision: string | undefined;
    let fechaVencimiento: string | undefined;

    const emisionMatch = cleanText.match(/(?:emisi[oó]n|alta|otorgado|fecha de emisi[oó]n)[\s:\.#]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}-\d{2}-\d{2})/i);
    if (emisionMatch) {
        const norm = normalizeCalendarDate(emisionMatch[1]);
        if (norm) {
            fechaEmision = norm;
            fieldsConf['fechaEmision'] = 0.9;
        }
    }

    const vencimientoMatch = cleanText.match(/(?:vencimiento|v[aá]lido hasta|vigencia hasta|vence)[\s:\.#]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}-\d{2}-\d{2})/i);
    if (vencimientoMatch) {
        const norm = normalizeCalendarDate(vencimientoMatch[1]);
        if (norm) {
            fechaVencimiento = norm;
            fieldsConf['fechaVencimiento'] = 0.9;
        }
    }

    // 6. Extracción de Fecha de Nacimiento
    let fechaNacimiento: string | undefined;
    const nacMatch = cleanText.match(/(?:nacimiento|nacido el|fecha de nacimiento)[\s:\.#]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}-\d{2}-\d{2})/i);
    if (nacMatch) {
        const norm = normalizeCalendarDate(nacMatch[1]);
        if (norm) {
            fechaNacimiento = norm;
            fieldsConf['fechaNacimiento'] = 0.9;
        }
    }

    // 7. Extracción de Médico y Matrícula
    let medico: { nombre?: string; matricula?: string } | undefined;
    const medicoMatch = cleanText.match(/(?:profesional\s*m[eé]dico|m[eé]dico\s*tratante|m[eé]dico|profesional|dr\.|dra\.)[\s:\.#]*([A-ZÁÉÍÓÚÑa-záéíóúñ\.\s]{3,35}?)(?=\s*matr|\s*m\.n|\s*m\.p|\s*firma|\s*diagn|\s*,|$)/i);
    const matriculaMatch = cleanText.match(/(?:matr[ií]cula|m\.n\.|m\.p\.|mp|mn)[\s:\.#]*((?:(?:MN|MP|M\.N\.|M\.P\.)\s*)?[0-9A-Z\-]{3,12})/i);

    if (medicoMatch || matriculaMatch) {
        medico = {
            nombre: medicoMatch ? medicoMatch[1].trim() : undefined,
            matricula: matriculaMatch ? matriculaMatch[1].trim() : undefined
        };
        if (medico.nombre) fieldsConf['medicoNombre'] = 0.8;
        if (medico.matricula) fieldsConf['medicoMatricula'] = 0.85;
    }

    // 8. Extracción de Diagnóstico o Indicación Clínica
    let diagnostico: string | undefined;
    const diagMatch = cleanText.match(/(?:diagn[oó]stico|patolog[ií]a|indicaci[oó]n cl[ií]nica|cuadro)[\s:\.#]*([A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s,\.\-]{3,60})(?=\s*tratamiento|\s*m[eé]dico|\s*firma|$)/i);
    if (diagMatch) {
        diagnostico = diagMatch[1].trim();
        fieldsConf['diagnostico'] = 0.75;
    }

    // 9. Cálculo de legibilidad y confianza general
    const detectedFieldKeys = Object.keys(fieldsConf);
    const isLegible = detectedFieldKeys.length > 0;
    const overallConf = isLegible 
        ? Math.min(1.0, detectedFieldKeys.reduce((acc, k) => acc + fieldsConf[k], 0) / detectedFieldKeys.length)
        : 0.0;

    if (!isLegible) {
        warnings.push('No se detectó capa de texto digital legible. El archivo podría ser un escaneo o imagen rasterizada. Requiere completar los datos manualmente.');
    }

    if (fechaEmision && fechaVencimiento && fechaVencimiento < fechaEmision) {
        warnings.push('La fecha de vencimiento detectada es anterior a la fecha de emisión');
    }

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
        sourceDescription: 'Extracción de capa de texto digital (Optimización local)',
        warnings,
        errors,
        humanValidated: false
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
