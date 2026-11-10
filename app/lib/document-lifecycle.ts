/**
 * app/lib/document-lifecycle.ts
 *
 * ACIACAM APP - Módulo Canónico de Ciclo de Vida y Estados Documentales
 * 
 * Centraliza las reglas de negocio para clasificar documentos entre:
 * - no_presentado: sin registro o sin archivo
 * - pendiente: archivo cargado, en espera de revisión administrativa
 * - en_revision: en revisión activa por el equipo
 * - aprobado: revisado y aprobado formalmente por Staff/Admin
 * - rechazado: observado o desaprobado administrativamente (con motivo)
 * - vencido: vencimiento oficial anterior a la fecha civil de hoy (San Luis)
 */

import { calculateDaysRemaining, formatCalendarDate } from '@/app/lib/date-format';

export type CanonicalDocType = 
    | 'reprocann'
    | 'declaracion_jurada'
    | 'consentimiento'
    | 'contrato'
    | 'contrato_autocultivo'
    | 'contrato_madre'
    | 'dni';

export type CanonicalDocState = 
    | 'no_presentado'
    | 'pendiente'
    | 'en_revision'
    | 'aprobado'
    | 'rechazado'
    | 'vencido';

export interface DocumentStateInfo {
    state: CanonicalDocState;
    label: string;
    badgeVariant: 'success' | 'warning' | 'destructive' | 'secondary' | 'neutral';
    isCompliant: boolean;
    daysRemaining: number | null;
    formattedVencimiento: string | null;
}

/**
 * Normaliza nombres y variantes de tipos de documentos al catálogo canónico.
 */
export function normalizeDocType(raw: string): CanonicalDocType {
    if (!raw) return 'declaracion_jurada';
    const lower = raw.toLowerCase().trim();
    if (lower === 'declaracionjurada' || lower === 'declaracion_jurada' || lower.includes('declaracion')) {
        return 'declaracion_jurada';
    }
    if (lower.includes('consentimiento')) return 'consentimiento';
    if (lower.includes('reprocann')) return 'reprocann';
    if (lower.includes('madre')) return 'contrato_madre';
    if (lower.includes('autocultivo')) return 'contrato_autocultivo';
    if (lower.includes('contrato')) return 'contrato';
    if (lower.includes('dni')) return 'dni';
    return lower as CanonicalDocType;
}

/**
 * Evalúa el estado canónico de un documento diferenciando:
 * 1. Aprobación administrativa (revisión humana del certificado por Staff/Admin).
 * 2. Vigencia regulatoria oficial (fecha_vencimiento frente a la fecha civil de San Luis).
 */
export function computeCanonicalDocState(doc: {
    archivo_path?: string | null;
    archivoPath?: string | null;
    verificacion_estado?: string | null;
    fecha_vencimiento?: string | null;
    fechaVencimiento?: string | null;
    is_current?: boolean;
} | null | undefined): DocumentStateInfo {
    const path = doc?.archivo_path || doc?.archivoPath;
    const rawEstado = doc?.verificacion_estado;
    const vencimiento = doc?.fecha_vencimiento || doc?.fechaVencimiento;

    // 1. No presentado
    if (!doc || !path || path.trim() === '') {
        return {
            state: 'no_presentado',
            label: 'No presentado',
            badgeVariant: 'neutral',
            isCompliant: false,
            daysRemaining: null,
            formattedVencimiento: null
        };
    }

    const days = vencimiento ? calculateDaysRemaining(vencimiento) : null;
    const formattedVenc = vencimiento ? formatCalendarDate(vencimiento) : null;
    const isVencido = days !== null && days <= 0;

    // 2. Vencido regulatoriamente (la fecha oficial expiró, independientemente de la aprobación previa)
    if (isVencido) {
        return {
            state: 'vencido',
            label: 'Vencido',
            badgeVariant: 'destructive',
            isCompliant: false,
            daysRemaining: days,
            formattedVencimiento: formattedVenc
        };
    }

    // 3. Rechazado administrativamente
    if (rawEstado === 'rechazado') {
        return {
            state: 'rechazado',
            label: 'Rechazado',
            badgeVariant: 'destructive',
            isCompliant: false,
            daysRemaining: days,
            formattedVencimiento: formattedVenc
        };
    }

    // 4. Aprobado administrativamente
    if (rawEstado === 'aprobado') {
        return {
            state: 'aprobado',
            label: 'Aprobado',
            badgeVariant: 'success',
            isCompliant: true,
            daysRemaining: days,
            formattedVencimiento: formattedVenc
        };
    }

    // 5. En revisión activa
    if (rawEstado === 'en_revision') {
        return {
            state: 'en_revision',
            label: 'En revisión',
            badgeVariant: 'warning',
            isCompliant: false,
            daysRemaining: days,
            formattedVencimiento: formattedVenc
        };
    }

    // 6. Presentado pendiente de revisión (estado inicial por defecto con archivo presente)
    return {
        state: 'pendiente',
        label: 'Pendiente de revisión',
        badgeVariant: 'secondary',
        isCompliant: false,
        daysRemaining: days,
        formattedVencimiento: formattedVenc
    };
}

