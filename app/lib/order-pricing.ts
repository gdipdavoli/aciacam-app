/**
 * app/lib/order-pricing.ts
 *
 * Cálculo unificado de aportes, gramos de flores y unidades de aceites/goteros.
 * - Flores: aporte = cantidad * peso_gramos * aporte_por_gramo; computa en floresGramos.
 * - Aceites/goteros: aporte = cantidad * aporte_unidad (o precio); independiente de peso_gramos;
 *   no contamina el contador de gramos de flores.
 * - Pedidos históricos: preserva el valor persistido en order.total o precioUnitario del ítem.
 */

export interface PricingProductLike {
    id?: string;
    tipo?: string | null;
    peso_gramos?: number | null;
    aporte_unidad?: number | null;
    precio?: number | null;
}

export interface PricingCartItemLike {
    productoId?: string;
    cantidad: number;
    precioUnitario?: number;
    producto?: PricingProductLike | null;
}

export function isOilProduct(tipo?: string | null): boolean {
    const t = String(tipo || '').toLowerCase().trim();
    return t === 'gotero' || t === 'aceite' || t.includes('gotero') || t.includes('aceite');
}

export function getUnitAporte(
    product: PricingProductLike | null | undefined,
    aportePorGramo: number
): number {
    if (!product) return 0;
    if (isOilProduct(product.tipo)) {
        const rawUnit = product.aporte_unidad ?? product.precio ?? 0;
        const unit = Number(rawUnit);
        return Number.isFinite(unit) && unit >= 0 ? unit : 0;
    }
    const grams = Number(product.peso_gramos || 0);
    const rate = Number(aportePorGramo || 0);
    if (!Number.isFinite(grams) || !Number.isFinite(rate) || grams < 0 || rate < 0) return 0;
    return grams * rate;
}

export function calculateItemAporte(
    product: PricingProductLike | null | undefined,
    cantidad: number,
    aportePorGramo: number
): number {
    const qty = Number(cantidad || 0);
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    return getUnitAporte(product, aportePorGramo) * qty;
}

export function calculateCartSummary(
    items: PricingCartItemLike[],
    aportePorGramo: number
): {
    floresGramos: number;
    aceitesUnidades: number;
    aporteTotal: number;
} {
    let floresGramos = 0;
    let aceitesUnidades = 0;
    let aporteTotal = 0;

    for (const item of items) {
        const qty = Number(item.cantidad || 0);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const prod = item.producto;
        if (prod && isOilProduct(prod.tipo)) {
            aceitesUnidades += qty;
        } else if (prod) {
            floresGramos += qty * Number(prod.peso_gramos || 0);
        }
        if (typeof item.precioUnitario === 'number' && Number.isFinite(item.precioUnitario) && item.precioUnitario >= 0) {
            aporteTotal += item.precioUnitario * qty;
        } else {
            aporteTotal += calculateItemAporte(prod, qty, aportePorGramo);
        }
    }

    return { floresGramos, aceitesUnidades, aporteTotal };
}

export function resolveOrderTotal(
    order: {
        total?: number | null;
        items?: Array<{
            productoId?: string;
            cantidad: number;
            precioUnitario?: number;
            producto?: PricingProductLike | null;
        }>;
    },
    productsById: Map<string, PricingProductLike>,
    aportePorGramo: number
): number {
    if (typeof order.total === 'number' && Number.isFinite(order.total) && order.total > 0) {
        return order.total;
    }
    const items = Array.isArray(order.items) ? order.items : [];
    let sum = 0;
    for (const item of items) {
        const qty = Number(item.cantidad || 0);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        if (typeof item.precioUnitario === 'number' && Number.isFinite(item.precioUnitario) && item.precioUnitario >= 0) {
            sum += item.precioUnitario * qty;
            continue;
        }
        const prod = item.producto || (item.productoId ? productsById.get(item.productoId) : undefined);
        sum += calculateItemAporte(prod, qty, aportePorGramo);
    }
    return sum;
}
