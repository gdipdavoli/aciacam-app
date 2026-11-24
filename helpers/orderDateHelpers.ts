export const ARGENTINA_TIMEZONE = 'America/Argentina/Buenos_Aires';

export type OrderDatePreset =
    | 'all'
    | 'today'
    | 'yesterday'
    | 'last7'
    | 'this_month'
    | 'prev_month'
    | 'custom';

/**
 * Devuelve YYYY-MM-DD en horario oficial de Argentina (America/Argentina/Buenos_Aires).
 */
export function getArgentinaDateKey(date: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: ARGENTINA_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

/**
 * Desplaza una fecha calendario YYYY-MM-DD en N días sin depender del timezone local del navegador/proceso.
 */
export function shiftDateKey(dateKey: string, deltaDays: number): string {
    const [y, m, d] = dateKey.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d + deltaDays));
    const yy = utc.getUTCFullYear();
    const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(utc.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

/**
 * Formatea un timestamp ISO a { date: 'DD/MM/AAAA', time: 'HH:mm' } en horario argentino.
 */
export function formatOrderDateTimeAR(iso?: string | null): { date: string; time: string } | null {
    if (!iso) return null;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return null;

    const parts = new Intl.DateTimeFormat('es-AR', {
        timeZone: ARGENTINA_TIMEZONE,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(parsed);

    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value || '';
    const hour = get('hour') === '24' ? '00' : get('hour');
    return {
        date: `${get('day')}/${get('month')}/${get('year')}`,
        time: `${hour}:${get('minute')}`,
    };
}

/**
 * Calcula los límites { desde, hasta } (YYYY-MM-DD) en horario argentino para un preset de filtro.
 */
export function getDateRangePresetAR(
    preset: Exclude<OrderDatePreset, 'all' | 'custom'>,
    now: Date = new Date()
): { desde: string; hasta: string } {
    const todayKey = getArgentinaDateKey(now);
    const [y, m] = todayKey.split('-').map(Number);

    switch (preset) {
        case 'today':
            return { desde: todayKey, hasta: todayKey };
        case 'yesterday': {
            const yest = shiftDateKey(todayKey, -1);
            return { desde: yest, hasta: yest };
        }
        case 'last7':
            return { desde: shiftDateKey(todayKey, -6), hasta: todayKey };
        case 'this_month': {
            const firstOfMonth = `${y}-${String(m).padStart(2, '0')}-01`;
            return { desde: firstOfMonth, hasta: todayKey };
        }
        case 'prev_month': {
            const prevMonthEndUtc = new Date(Date.UTC(y, m - 1, 0));
            const py = prevMonthEndUtc.getUTCFullYear();
            const pm = String(prevMonthEndUtc.getUTCMonth() + 1).padStart(2, '0');
            const pd = String(prevMonthEndUtc.getUTCDate()).padStart(2, '0');
            return { desde: `${py}-${pm}-01`, hasta: `${py}-${pm}-${pd}` };
        }
    }
}

/**
 * Detecta el preset activo a partir de los query params desde/hasta en horario argentino.
 */
export function detectDatePresetAR(
    desde?: string | null,
    hasta?: string | null,
    now: Date = new Date()
): OrderDatePreset {
    const d = (desde || '').trim();
    const h = (hasta || '').trim();
    if (!d && !h) return 'all';

    const presets: Array<Exclude<OrderDatePreset, 'all' | 'custom'>> = [
        'today',
        'yesterday',
        'last7',
        'this_month',
        'prev_month',
    ];
    for (const p of presets) {
        const range = getDateRangePresetAR(p, now);
        if (range.desde === d && range.hasta === h) return p;
    }
    return 'custom';
}
