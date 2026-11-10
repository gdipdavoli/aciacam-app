/**
 * app/lib/ocr-contract.ts
 *
 * ACIACAM APP - Contrato de Extracción Estructurada para Certificados REPROCANN
 *
 * Define la estructura, validación y reglas de integración de datos extraídos por OCR.
 * Regla de Oro: Toda extracción es asistida y requiere validación humana explícita antes
 * de ser persistida o sobrescribir datos existentes.
 */

import { isValidCalendarDate } from '@/app/lib/date-format';

export interface OcrExtractedReprocann {
    numeroTramite: string;
    titular: {
        nombre: string;
        apellido: string;
    };
    dni: string;
    fechaEmision: string; // YYYY-MM-DD
    fechaVencimiento: string; // YYYY-MM-DD
    tipoAutorizacion: 'autocultivo' | 'solidario' | 'ong' | string;
    medico?: {
        nombre?: string;
        matricula?: string;
    };
    confidence: {
        overall: number; // 0.0 a 1.0
        numeroTramite?: number;
        fechas?: number;
        titular?: number;
    };
    humanValidated: boolean; // Obligatorio: false hasta confirmación manual
    validatedBy?: string;    // email o user_id del admin/staff que aprobó
    validatedAt?: string;    // timestamp ISO de validación humana
}

export interface OcrValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    data?: OcrExtractedReprocann;
}

/**
 * Valida formalmente el payload de extracción OCR contra las reglas de integridad de ACIACAM.
 */
export function validateOcrExtraction(payload: unknown): OcrValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!payload || typeof payload !== 'object') {
        return { valid: false, errors: ['El resultado de OCR debe ser un objeto válido'], warnings };
    }

    const data = payload as Partial<OcrExtractedReprocann>;

    // 1. Número de trámite
    if (!data.numeroTramite || typeof data.numeroTramite !== 'string' || data.numeroTramite.trim() === '') {
        errors.push('Número de trámite no detectado o inválido');
    }

    // 2. Fechas civiles
    if (!data.fechaEmision || !isValidCalendarDate(data.fechaEmision)) {
        errors.push('Fecha de emisión ausente o con formato de calendario inválido (esperado YYYY-MM-DD)');
    }
    if (!data.fechaVencimiento || !isValidCalendarDate(data.fechaVencimiento)) {
        errors.push('Fecha de vencimiento ausente o con formato de calendario inválido (esperado YYYY-MM-DD)');
    }

    if (data.fechaEmision && data.fechaVencimiento && data.fechaVencimiento < data.fechaEmision) {
        errors.push('La fecha de vencimiento no puede ser anterior a la fecha de emisión');
    }

    // 3. Titular y DNI
    if (!data.titular?.nombre || !data.titular?.apellido) {
        warnings.push('Nombre y apellido del titular detectados parcialmente');
    }
    if (!data.dni || typeof data.dni !== 'string' || !/^\d{6,9}$/.test(data.dni.replace(/\D/g, ''))) {
        warnings.push('DNI detectado no tiene longitud numérica estándar');
    }

    // 4. Confianza
    const overallConf = data.confidence?.overall ?? 0;
    if (overallConf < 0.7) {
        warnings.push(`Nivel de confianza general bajo (${Math.round(overallConf * 100)}%). Requiere revisión visual exhaustiva.`);
    }

    // 5. Validación humana de seguridad
    if (data.humanValidated !== true) {
        warnings.push('La extracción no ha sido confirmada por un operador humano.');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        data: errors.length === 0 ? (data as OcrExtractedReprocann) : undefined
    };
}

/**
 * Función segura para fusionar datos extraídos con la ficha o formulario del socio.
 * Protege contra sobreescritura accidental: solo actualiza campos vacíos a menos que
 * confirmOverwrite sea explícitamente true.
 */
export function mergeOcrWithPartnerData<T extends Record<string, any>>(
    current: T,
    extracted: OcrExtractedReprocann,
    confirmOverwrite = false
): T {
    const updated: any = { ...current };

    const shouldSet = (currVal: any, newVal: any) => {
        if (!newVal) return false;
        if (currVal === undefined || currVal === null || currVal === '') return true;
        return confirmOverwrite;
    };

    if (shouldSet(updated.reprocann_num_tramite || updated.reprocann?.numeroTramite, extracted.numeroTramite)) {
        if (updated.reprocann) updated.reprocann.numeroTramite = extracted.numeroTramite;
        updated.reprocann_num_tramite = extracted.numeroTramite;
    }

    if (shouldSet(updated.reprocann_fecha_alta || updated.reprocann?.fechaAlta, extracted.fechaEmision)) {
        if (updated.reprocann) updated.reprocann.fechaAlta = extracted.fechaEmision;
        updated.reprocann_fecha_alta = extracted.fechaEmision;
    }

    if (shouldSet(updated.reprocann_fecha_vencimiento || updated.reprocann?.fechaVencimiento, extracted.fechaVencimiento)) {
        if (updated.reprocann) updated.reprocann.fechaVencimiento = extracted.fechaVencimiento;
        updated.reprocann_fecha_vencimiento = extracted.fechaVencimiento;
    }

    if (extracted.medico?.nombre && shouldSet(updated.medico_nombre || updated.medicoNombre, extracted.medico.nombre)) {
        updated.medico_nombre = extracted.medico.nombre;
        updated.medicoNombre = extracted.medico.nombre;
    }

    if (extracted.medico?.matricula && shouldSet(updated.medico_matricula || updated.medicoMatricula, extracted.medico.matricula)) {
        updated.medico_matricula = extracted.medico.matricula;
        updated.medicoMatricula = extracted.medico.matricula;
    }

    return updated as T;
}
