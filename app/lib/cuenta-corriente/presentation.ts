import type { CuentaPedidoSummary } from './contracts';

export function dinero(centavos: string | bigint | number): string {
    const value = BigInt(centavos);
    const zero = BigInt(0);
    const hundred = BigInt(100);
    const absolute = value < zero ? -value : value;
    return `${value < zero ? '-' : ''}$ ${(absolute / hundred).toLocaleString('es-AR')},${String(absolute % hundred).padStart(2, '0')}`;
}

export function parseImporte(text: string): number {
    const cleaned = text.trim();
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(cleaned)) {
        throw new Error('Ingresá un importe positivo con hasta dos decimales, sin separadores de miles.');
    }
    const [pesos, decimals = ''] = cleaned.split(/[.,]/);
    const cents = BigInt(pesos) * BigInt(100) + BigInt(decimals.padEnd(2, '0'));
    if (cents < BigInt(1) || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('El importe está fuera del rango admitido.');
    }
    return Number(cents);
}

export function resumen(cuenta: Pick<CuentaPedidoSummary, 'movimientos'>): {
    recibidos: string;
    bonificados: string;
    ajustes: string;
} {
    const totals = { recibidos: BigInt(0), bonificados: BigInt(0), ajustes: BigInt(0) };
    const byId = new Map(cuenta.movimientos.map(m => [m.id, m]));
    for (const m of cuenta.movimientos) {
        let type = m.tipo;
        if (type === 'reversion') {
            const original = m.revierteId ? byId.get(m.revierteId) : undefined;
            if (!original) throw new Error('Historial incompleto');
            type = original.tipo;
        }
        const value = BigInt(m.centavos) * BigInt(m.signo);
        if (type === 'pago') totals.recibidos -= value;
        if (type === 'bonificacion') totals.bonificados -= value;
        if (type === 'ajuste') totals.ajustes += value;
    }
    return {
        recibidos: totals.recibidos.toString(),
        bonificados: totals.bonificados.toString(),
        ajustes: totals.ajustes.toString(),
    };
}
