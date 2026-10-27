/**
 * app/lib/agent/pedidos-tool-core.ts
 *
 * ACIACAM — Sprint 7B.4 (Etapa 1)
 * Funciones Puras para Autorización Delegada, Huella Canónica e Idempotencia Integral
 */

import * as crypto from 'crypto';
import {
    ActionGrantPayload,
    ActionGrantToken,
    CanonicalOrderStatus,
    ConsolidatedOrderItem,
    OrderItemInput,
    ORDER_STATUS_TRANSITIONS,
    SocioCheckoutIdempotencyEnvelope
} from '@/types/pedidos-tool';
import { OrderType } from '@/types';

export function canonicalText(value: string): string { return value.trim().normalize('NFC'); }
export function canonicalUuid(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('INVALID_UUID');
    return value.toLowerCase();
}

/**
 * 1. Consolidación canónica y determinista de ítems de pedido.
 * Agrupa productos duplicados, suma cantidades y ordena por UUID de producto en orden ascendente.
 * Esta representación coincide 1:1 con la lógica de la RPC crear_pedido_administrativo_transaccional.
 */
export function consolidateOrderItems(
    items: ReadonlyArray<OrderItemInput>
): ReadonlyArray<ConsolidatedOrderItem> {
    const map = new Map<string, number>();

    for (const item of items) {
        const rawId = (item as any).productoId || (item as any).producto_id || (item as any).id;
        if (!rawId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
            throw new Error('INVALID_PRODUCT_ID: Cada ítem debe contener un UUID de producto válido');
        }
        const qty = Number(item.cantidad);
        if (!/^[1-9][0-9]*$/.test(String(item.cantidad)) || !Number.isSafeInteger(qty) || qty > 2147483647) {
            throw new Error('INVALID_QUANTITY: La cantidad debe ser un entero positivo mayor a cero');
        }
        const id = rawId.toLowerCase();
        const sum = (map.get(id) || 0) + qty;
        if (sum > 2147483647) throw new Error('ORDER_QUANTITY_INVALID');
        map.set(id, sum);
    }

    const sortedIds = Array.from(map.keys()).sort();
    return sortedIds.map(id => ({
        productoId: id,
        cantidad: map.get(id)!
    }));
}

/**
 * 2. Cálculo determinista de la huella canónica (SHA-256).
 * Produce exactamente la misma huella calculada en la RPC PostgreSQL
 * para garantizar interoperabilidad y deduplicación temprana.
 */
export function computeCanonicalOrderHash(params: {
    actorUserId: string;
    socioId: string;
    tipoPedido: OrderType;
    items: ReadonlyArray<OrderItemInput>;
    motivo: string;
    direccionEntrega?: string;
    localidad?: string;
    fechaRetiro?: string;
    franjaHoraria?: string;
    slotId?: string;
    observaciones?: string;
}): string {
    const consolidated = consolidateOrderItems(params.items);
    const itemsCanonicalStr = consolidated.map(i => `${i.productoId}:${i.cantidad}`).join(',');

    const normTipoPedido = (params.tipoPedido || '').toLowerCase().trim();

    const fields = [
        'LPCP-v2',
        canonicalUuid(params.actorUserId),
        canonicalUuid(params.socioId),
        normTipoPedido,
        itemsCanonicalStr,
        params.motivo.trim(),
        normTipoPedido === 'delivery' ? (params.direccionEntrega || '') : '',
        normTipoPedido === 'delivery' ? (params.localidad || '') : '',
        normTipoPedido === 'retiro_sede' ? (params.fechaRetiro || '').trim() : '',
        normTipoPedido === 'retiro_sede' ? (params.franjaHoraria || '').trim() : '',
        params.slotId ? params.slotId.trim() : '',
        (params.observaciones || '').trim()
    ];

    const lpcpString = fields.map(canonicalText).map(f => `${Buffer.byteLength(f, 'utf8')}:${f};`).join('');
    return crypto.createHash('sha256').update(lpcpString, 'utf8').digest('hex');
}

/**
 * 2b. Cálculo determinista de la huella canónica de checkout de socios (LPCP-v2-SOCIO).
 * Formato inequívoco con prefijo de longitud en bytes UTF-8 para garantizar paridad con PostgreSQL.
 */
export function computeSocioOrderHash(params: {
    socioId: string;
    tipoPedido: OrderType;
    items: ReadonlyArray<OrderItemInput>;
    direccionEntrega?: string;
    localidad?: string;
    fechaRetiro?: string;
    franjaHoraria?: string;
    slotId?: string;
    observaciones?: string;
}): string {
    const consolidated = consolidateOrderItems(params.items);
    const itemsCanonicalStr = consolidated.map(i => `${i.productoId}:${i.cantidad}`).join(',');
    const normTipoPedido = (params.tipoPedido || '').toLowerCase().trim();

    const fields = [
        'LPCP-v2-SOCIO',
        canonicalUuid(params.socioId),
        normTipoPedido,
        itemsCanonicalStr,
        normTipoPedido === 'delivery' ? (params.direccionEntrega || '') : '',
        normTipoPedido === 'delivery' ? (params.localidad || '') : '',
        normTipoPedido === 'retiro_sede' ? (params.fechaRetiro || '').trim() : '',
        normTipoPedido === 'retiro_sede' ? (params.franjaHoraria || '').trim() : '',
        params.slotId ? params.slotId.trim() : '',
        (params.observaciones || '').trim()
    ];

    const lpcpString = fields.map(canonicalText).map(f => `${Buffer.byteLength(f, 'utf8')}:${f};`).join('');
    return crypto.createHash('sha256').update(lpcpString, 'utf8').digest('hex');
}

/**
 * 3. Emisión de ticket de autorización delegada de corto alcance (ActionGrantToken).
 * Firmado con HMAC-SHA256 usando el secreto S2S. Máxima validez permitida: 120 segundos.
 */
export function createActionGrantToken(
    params: {
        operatorAuthUserId: string;
        operatorRole: 'admin' | 'staff';
        targetSocioId: string;
        approvedPayloadHash: string;
        ttlSeconds?: number;
    },
    secret: string
): ActionGrantToken {
    if (!secret || secret.length < 32) {
        throw new Error('SECURITY_CONFIG_ERROR: El secreto para firmar ActionGrants debe tener al menos 32 caracteres');
    }

    const now = Math.floor(Date.now() / 1000);
    const ttl = Math.min(params.ttlSeconds || 120, 120); // Tope de seguridad: 120s

    const payload: ActionGrantPayload = {
        grant_id: crypto.randomUUID(),
        action: 'execute_order',
        operator_auth_user_id: params.operatorAuthUserId,
        operator_role: params.operatorRole,
        target_socio_id: params.targetSocioId,
        approved_payload_hash: params.approvedPayloadHash,
        issued_at: now,
        expires_at: now + ttl
    };

    const signature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

    return { payload, signature };
}

/**
 * 4. Verificación estricta de ticket de autorización delegada.
 * Comprueba firma, expiración y correspondencia exacta de carga antes de autorizar escrituras.
 */
export function verifyActionGrantToken(
    token: ActionGrantToken,
    expectedPayloadHash: string,
    secret: string
): { valid: boolean; error?: string } {
    if (!token || !token.payload || !token.signature) {
        return { valid: false, error: 'INVALID_GRANT_STRUCTURE: Token malformado' };
    }

    const { payload, signature } = token;

    if (payload.action !== 'execute_order') return { valid: false, error: 'GRANT_ACTION_MISMATCH' };
    if (!Number.isSafeInteger(payload.issued_at) || !Number.isSafeInteger(payload.expires_at)
        || payload.expires_at <= payload.issued_at || payload.expires_at - payload.issued_at > 120) {
        return { valid: false, error: 'GRANT_INVALID_WINDOW' };
    }
    // A. Verificar firma criptográfica
    const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

    const sigBuffer = Buffer.from(signature, 'hex');
    const expBuffer = Buffer.from(expectedSig, 'hex');

    if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
        return { valid: false, error: 'GRANT_SIGNATURE_MISMATCH: Firma de autorización inválida o adulterada' };
    }

    // B. Verificar ventana de expiración
    const now = Math.floor(Date.now() / 1000);
    if (payload.expires_at < now) {
        return { valid: false, error: 'GRANT_EXPIRED: El ticket de autorización ha expirado' };
    }
    if (payload.issued_at > now + 30) {
        return { valid: false, error: 'GRANT_FUTURE_TIMESTAMP: El ticket posee fecha futura inválida' };
    }

    // C. Verificar correspondencia exacta con los parámetros aprobados
    if (payload.approved_payload_hash !== expectedPayloadHash) {
        return { valid: false, error: 'PAYLOAD_HASH_MISMATCH: Los parámetros a ejecutar difieren de los autorizados por el operador' };
    }

    return { valid: true };
}

/**
 * 5. Derivación determinista de clave de idempotencia para checkout de socios.
 * La clave no es un UUID aleatorio generado en frontend, sino un UUID v5 derivado
 * de (socio_id + order_intent_id + hash_de_items_y_entrega).
 *
 * Propiedades (Sprint 7B.4 - Etapa 2 y 3.2):
 * - Reintentos por fallo de red: Reutilizan el mismo orderIntentId -> idéntica idempotency_key.
 * - Dos compras legítimas con contenido idéntico: Cada una genera un orderIntentId único -> claves distintas.
 * - Mutación del carrito: Cambia la huella de ítems (LPCP-v2-SOCIO) -> renueva la clave automáticamente.
 */
export function deriveSocioCheckoutEnvelope(params: {
    socioId: string;
    orderIntentId?: string;
    cartSessionId?: string;
    items: ReadonlyArray<OrderItemInput>;
    tipoPedido: OrderType;
    direccionEntrega?: string;
    localidad?: string;
    fechaRetiro?: string;
    franjaHoraria?: string;
    slotId?: string;
    observaciones?: string;
    clientAttempt?: number;
}): SocioCheckoutIdempotencyEnvelope {
    const intentId = (params.orderIntentId || params.cartSessionId || '').trim();
    if (!intentId) {
        throw new Error('INVALID_INTENT_ID: Debe especificarse un orderIntentId o cartSessionId válido');
    }

    const hash = computeSocioOrderHash({
        socioId: params.socioId,
        tipoPedido: params.tipoPedido,
        items: params.items,
        direccionEntrega: params.direccionEntrega,
        localidad: params.localidad,
        fechaRetiro: params.fechaRetiro,
        franjaHoraria: params.franjaHoraria,
        slotId: params.slotId,
        observaciones: params.observaciones
    });

    // Derivar UUID v5 determinístico con namespace fijo de ACIACAM
    const NAMESPACE_CHECKOUT = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'; // RFC 4122 namespace OID
    const seed = `${params.socioId.trim()}:${intentId}:${hash}`;
    const key = crypto.createHash('sha1').update(NAMESPACE_CHECKOUT + seed).digest('hex');

    // Formatear como UUID canónico v5
    const idempotencyKey = [
        key.substring(0, 8),
        key.substring(8, 12),
        '5' + key.substring(13, 16),
        ((parseInt(key.substring(16, 18), 16) & 0x3f) | 0x80).toString(16) + key.substring(18, 20),
        key.substring(20, 32)
    ].join('-');

    return {
        order_intent_id: intentId,
        cart_session_id: params.cartSessionId,
        socio_id: params.socioId,
        canonical_payload_hash: hash,
        idempotency_key: idempotencyKey,
        client_attempt: params.clientAttempt || 1,
        timestamp: Date.now()
    };
}

/**
 * 6. Validador de transiciones canónicas de estado de pedidos.
 */
export function validateOrderStatusTransition(
    currentStatus: CanonicalOrderStatus,
    targetStatus: CanonicalOrderStatus
): { allowed: boolean; reason?: string } {
    if (currentStatus === targetStatus) {
        return { allowed: true }; // Idempotente
    }

    const rule = ORDER_STATUS_TRANSITIONS[currentStatus];
    if (!rule) {
        return { allowed: false, reason: `Estado origen '${currentStatus}' no reconocido en la matriz canónica` };
    }

    if (rule.terminal) {
        return { allowed: false, reason: `El pedido ya se encuentra en estado terminal '${currentStatus}' y no admite transiciones` };
    }

    if (!rule.allowedNext.includes(targetStatus)) {
        return {
            allowed: false,
            reason: `Transición inválida: no se permite pasar de '${currentStatus}' a '${targetStatus}'. Permitidos: [${rule.allowedNext.join(', ')}]`
        };
    }

    return { allowed: true };
}
