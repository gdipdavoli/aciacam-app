/**
 * app/lib/date-format.ts
 *
 * Módulo centralizado y canónico para el formateo y cálculo de fechas en ACIACAM App.
 *
 * Principios:
 * 1. Fechas Calendario (tipo Postgres DATE: 'YYYY-MM-DD'):
 *    - Representan un día civil abstracto (ej. fecha de nacimiento, emisión, alta o vencimiento REPROCANN).
 *    - NUNCA deben interpretarse mediante instanciación Date en UTC ni sufrir conversión horaria de husos.
 *    - Se validan estrictamente (formato YYYY-MM-DD y existencia real en calendario civil gregoriano).
 *    - Se preservan exactamente el año, mes y día registrados.
 * 2. Marcas Temporales (tipo Postgres TIMESTAMPTZ: ISO con hora y zona horaria):
 *    - Representan un instante real en la línea temporal (ej. created_at, updated_at, verificado_at).
 *    - Se convierten y formatean siempre en la zona horaria institucional de San Luis: America/Argentina/San_Luis.
 * 3. Cálculos de Vencimiento:
 *    - Los días restantes se computan en aritmética civil pura contra la fecha civil actual en San Luis,
 *      evitando desfasajes por horario de verano o diferencias de milisegundos de medianoches locales.
 */

export const INSTITUTIONAL_TIMEZONE = 'America/Argentina/San_Luis';

export interface CalendarDateParts {
    year: number;
    month: number;
    day: number;
}

/**
 * Determina si un año gregoriano es bisiesto.
 */
export function isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Valida estrictamente si una cadena cumple con el formato 'YYYY-MM-DD'
 * y representa una fecha existente en el calendario civil gregoriano.
 * Rechaza fechas inexistentes (ej. 2026-02-30, 2027-02-29, 2026-04-31, 2026-13-01).
 */
export function isValidCalendarDate(dateStr?: string | null): boolean {
    if (!dateStr || typeof dateStr !== 'string') return false;
    const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);

    if (year < 1900 || year > 2100) return false;
    if (month < 1 || month > 12) return false;

    const daysInMonth = [
        31, // Enero
        isLeapYear(year) ? 29 : 28, // Febrero
        31, // Marzo
        30, // Abril
        31, // Mayo
        30, // Junio
        31, // Julio
        31, // Agosto
        30, // Septiembre
        31, // Octubre
        30, // Noviembre
        31  // Diciembre
    ];

    return day >= 1 && day <= daysInMonth[month - 1];
}

/**
 * Parsea una cadena de fecha calendario en sus partes civil numéricas [year, month, day].
 * Retorna null si la fecha es inválida o inexistente.
 */
export function parseCalendarDate(dateStr?: string | null): CalendarDateParts | null {
    if (!isValidCalendarDate(dateStr)) return null;
    const parts = (dateStr as string).trim().split('-');
    return {
        year: parseInt(parts[0], 10),
        month: parseInt(parts[1], 10),
        day: parseInt(parts[2], 10)
    };
}

/**
 * Formatea una fecha calendario ('YYYY-MM-DD') al formato civil institucional 'DD/MM/AAAA'.
 * Preserva exactamente el día, mes y año sin ninguna alteración por zona horaria.
 */
export function formatCalendarDate(dateStr?: string | null, fallback = 'No informada'): string {
    const parts = parseCalendarDate(dateStr);
    if (!parts) return fallback;
    const d = String(parts.day).padStart(2, '0');
    const m = String(parts.month).padStart(2, '0');
    const y = String(parts.year);
    return `${d}/${m}/${y}`;
}

/**
 * Convierte una fecha civil Gregoriana a días enteros absolutos desde el epoch UTC (1970-01-01).
 * Al usar Date.UTC(y, m-1, d), la aritmética es uniforme e invariable (86.400.000 ms por día).
 */
export function civilDateToDays(year: number, month: number, day: number): number {
    return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

/**
 * Obtiene la fecha civil de hoy en la zona horaria institucional de San Luis (America/Argentina/San_Luis).
 */
export function getSanLuisCivilToday(): CalendarDateParts {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: INSTITUTIONAL_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.format(now).split('-');
    return {
        year: parseInt(parts[0], 10),
        month: parseInt(parts[1], 10),
        day: parseInt(parts[2], 10)
    };
}

/**
 * Calcula los días civiles restantes hasta la fecha de vencimiento ('YYYY-MM-DD')
 * tomando como referencia estricta la fecha civil de America/Argentina/San_Luis.
 * Retorna un entero (positivo = días a vencer, 0 = vence hoy, negativo = vencido).
 */
export function calculateDaysRemaining(targetDateStr?: string | null): number | null {
    const targetParts = parseCalendarDate(targetDateStr);
    if (!targetParts) return null;

    const todayParts = getSanLuisCivilToday();

    const targetDays = civilDateToDays(targetParts.year, targetParts.month, targetParts.day);
    const todayDays = civilDateToDays(todayParts.year, todayParts.month, todayParts.day);

    return targetDays - todayDays;
}

/**
 * Formatea una marca temporal real (TIMESTAMPTZ: ej. '2026-10-09T14:58:22Z')
 * en la zona horaria institucional America/Argentina/San_Luis.
 */
export function formatTimestamp(
    isoString?: string | null,
    options: { includeTime?: boolean; fallback?: string } = {}
): string {
    const { includeTime = false, fallback = 'No informada' } = options;
    if (!isoString || typeof isoString !== 'string') return fallback;

    const d = new Date(isoString);
    if (isNaN(d.getTime())) return fallback;

    if (includeTime) {
        // Formato: DD/MM/AAAA a las HH:mm
        const datePart = new Intl.DateTimeFormat('es-AR', {
            timeZone: INSTITUTIONAL_TIMEZONE,
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).format(d);

        const timePart = new Intl.DateTimeFormat('es-AR', {
            timeZone: INSTITUTIONAL_TIMEZONE,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(d);

        return `${datePart} a las ${timePart}`;
    }

    return new Intl.DateTimeFormat('es-AR', {
        timeZone: INSTITUTIONAL_TIMEZONE,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(d);
}

/**
 * Formatea un período mensual de cuota si existiese un dato verificado (ej. '2026-11' o ISO).
 * Si no es válido o está ausente, retorna fallback representativo.
 */
export function formatPeriodoCuota(value?: string | null): string {
    if (!value || typeof value !== 'string') return 'Información de aportes no disponible';
    const match = value.trim().match(/^(\d{4})-(\d{2})/);
    if (!match) return 'Información de aportes no disponible';

    const year = match[1];
    const month = parseInt(match[2], 10);
    const months = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    if (month < 1 || month > 12) return 'Información de aportes no disponible';
    return `${months[month - 1]} ${year}`;
}

