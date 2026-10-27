/**
 * types/pedidos-tool.ts
 *
 * ACIACAM — Sprint 7B.4 (Etapa 1)
 * Contratos Fuertemente Tipados para PedidosTool, Autorización Delegada e Idempotencia Integral
 *
 * Directivas de Diseño:
 * 1. Cero uso de 'any' o catch-alls desestructurados.
 * 2. Validación en dos fases: propose/validate (solo lectura) -> execute (transaccional con reserva de stock).
 * 3. Autorización delegada mediante ActionGrantToken de corto alcance (sin compartir JWT de admin con Agent Core).
 * 4. Idempotencia integral basada en anclaje de sesión de compra y huella canónica determinista.
 * 5. Estados canónicos estrictos alineados 1:1 con la restricción pedidos_estado_check de PostgreSQL.
 */

import { OrderType } from './index';

// ============================================================================
// 1. ESTADOS CANÓNICOS Y MATRIZ DE COMPATIBILIDAD
// ============================================================================

/**
 * Estados canónicos permitidos en la base de datos PostgreSQL (restricción pedidos_estado_check).
 */
export type CanonicalOrderStatus =
    | 'pendiente'
    | 'confirmado'
    | 'en_preparacion'
    | 'listo_para_retiro'
    | 'en_camino'
    | 'retirado'
    | 'entregado'
    | 'cancelado';

/**
 * Estado legacy permitido únicamente para lectura y retrocompatibilidad de pedidos históricos.
 * Prohibido para cualquier operación de escritura o actualización.
 */
export type LegacyOrderStatus = CanonicalOrderStatus | 'procesando';

export interface OrderStatusTransitionRule {
    readonly from: CanonicalOrderStatus;
    readonly allowedNext: ReadonlyArray<CanonicalOrderStatus>;
    readonly terminal: boolean;
    readonly stockEffect: 'reserve' | 'release' | 'none';
}

/**
 * Matriz canónica de transiciones de estado de pedidos.
 */
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<CanonicalOrderStatus, OrderStatusTransitionRule>> = {
    pendiente: {
        from: 'pendiente',
        allowedNext: ['confirmado', 'cancelado'],
        terminal: false,
        stockEffect: 'reserve' // El stock ya fue reservado en el insert
    },
    confirmado: {
        from: 'confirmado',
        allowedNext: ['en_preparacion', 'cancelado'],
        terminal: false,
        stockEffect: 'none'
    },
    en_preparacion: {
        from: 'en_preparacion',
        allowedNext: ['listo_para_retiro', 'en_camino', 'cancelado'],
        terminal: false,
        stockEffect: 'none'
    },
    listo_para_retiro: {
        from: 'listo_para_retiro',
        allowedNext: ['retirado', 'cancelado'],
        terminal: false,
        stockEffect: 'none'
    },
    en_camino: {
        from: 'en_camino',
        allowedNext: ['entregado', 'cancelado'],
        terminal: false,
        stockEffect: 'none'
    },
    retirado: {
        from: 'retirado',
        allowedNext: [],
        terminal: true,
        stockEffect: 'none' // Finalizado
    },
    entregado: {
        from: 'entregado',
        allowedNext: [],
        terminal: true,
        stockEffect: 'none' // Finalizado
    },
    cancelado: {
        from: 'cancelado',
        allowedNext: [],
        terminal: true,
        stockEffect: 'release' // Trigger restituye stock automáticamente
    }
};

// ============================================================================
// 2. ÍTEMS Y CARGA CANÓNICA DE PEDIDO
// ============================================================================

export interface OrderItemInput {
    readonly productoId: string;
    readonly cantidad: number;
}

export interface ConsolidatedOrderItem {
    readonly productoId: string;
    readonly cantidad: number;
    readonly productoNombre?: string;
    readonly precioUnitario?: number;
    readonly pesoGramosUnitario?: number;
    readonly subtotalGramos?: number;
}

// ============================================================================
// 3. AUTORIZACIÓN DELEGADA POR ACCIÓN (ACTION GRANT TOKEN)
// ============================================================================

/**
 * Carga útil del ticket de autorización delegada de corto alcance.
 * Emitido por el BFF autenticado con el operador humano y validado antes de escribir.
 */
export interface ActionGrantPayload {
    /** Identificador único del ticket para prevenir replay attacks (nonce) */
    readonly grant_id: string;
    /** Acción específica autorizada */
    readonly action: 'execute_order' | 'confirm_order';
    /** Identificador de usuario del operador que autorizó la acción */
    readonly operator_auth_user_id: string;
    /** Rol del operador (admin o staff) */
    readonly operator_role: 'admin' | 'staff';
    /** Socio destinatario al que se le aplicará la operación */
    readonly target_socio_id: string;
    /** Hash SHA-256 de la carga canónica aprobada por el operador humano */
    readonly approved_payload_hash: string;
    /** Momento de emisión en época Unix (segundos) */
    readonly issued_at: number;
    /** Momento de expiración estricta en época Unix (segundos) - Máximo 120 segundos */
    readonly expires_at: number;
}

export interface ActionGrantToken {
    readonly payload: ActionGrantPayload;
    /** Firma criptográfica HMAC-SHA256 generada por el backend con AGENT_ACTION_SECRET */
    readonly signature: string;
}

// ============================================================================
// 4. OPERACIONES DE PEDIDOS TOOL (ORQUESTADOR AGENT CORE)
// ============================================================================

export type PedidosToolOperation =
    | 'propose_order'
    | 'validate_order'
    | 'execute_order'
    | 'get_order_status';

/**
 * Operación 1: propose_order (Propuesta de Solo Lectura)
 */
export interface ProposeOrderInput {
    readonly operation?: 'propose_order';
    readonly socio_id: string;
    readonly items: ReadonlyArray<OrderItemInput>;
    readonly tipo_pedido: OrderType;
    readonly motivo: string;
    readonly direccion_entrega?: string;
    readonly localidad?: string;
    readonly fecha_retiro?: string;
    readonly franja_horaria?: string;
    readonly slot_id?: string;
    readonly observaciones?: string;
    readonly idempotency_key?: string;
}

export interface ProposeOrderResult {
    readonly proposal_id: string;
    readonly target_socio_id: string;
    readonly tipo_pedido: OrderType;
    readonly consolidated_items: ReadonlyArray<ConsolidatedOrderItem>;
    readonly total_flores_gramos: number;
    readonly total_goteros_unidades: number;
    readonly legal_transport_compliant: boolean;
    readonly legal_warning?: string;
    readonly proposal_payload_hash: string;
    readonly summary: string;
    readonly requires_confirmation: true;
    readonly disclaimer: string;
}

/**
 * Operación 2: validate_order (Comprobación de Reglas y Permisos)
 */
export interface ValidateOrderInput {
    readonly operation: 'validate_order';
    readonly proposal_id?: string;
    readonly socio_id: string;
    readonly items: ReadonlyArray<OrderItemInput>;
    readonly tipo_pedido: OrderType;
    readonly direccion_entrega?: string;
    readonly localidad?: string;
}

export interface StockPreflightItem {
    readonly productoId: string;
    readonly cantidadSolicitada: number;
    readonly stockDisponibleActual: number;
    readonly suficiente: boolean;
}

export interface ValidateOrderResult {
    readonly transport_evaluation?: { flores_g: number; goteros_u: number; compliant: boolean; warning?: string };
    readonly valid: boolean;
    readonly socio_status: string;
    readonly socio_bloqueado: boolean;
    readonly motivo_bloqueo?: string | null;
    readonly envios_habilitados: boolean;
    readonly stock_preflight: ReadonlyArray<StockPreflightItem>;
    readonly errors: ReadonlyArray<string>;
    readonly warnings: ReadonlyArray<string>;
    readonly verified_at: string;
    /** Cláusula obligatoria: la validación previa no congela stock */
    readonly notice: string;
}

/**
 * Operación 3: execute_order (Ejecución Atómica y Transaccional)
 */
export interface ExecuteOrderInput {
    readonly operation: 'execute_order';
    readonly proposal_id: string;
    /** Token de autorización delegada firmado por el BFF con la aprobación del operador */
    readonly action_grant: ActionGrantToken;
    /** Clave de idempotencia única del intento de ejecución */
    readonly idempotency_key: string;
    /** Parámetros completos a ejecutar (deben coincidir exactamente con el hash del grant) */
    readonly socio_id: string;
    readonly items: ReadonlyArray<OrderItemInput>;
    readonly tipo_pedido: OrderType;
    readonly motivo: string;
    readonly direccion_entrega?: string;
    readonly localidad?: string;
    readonly fecha_retiro?: string;
    readonly slot_id?: string;
    readonly observaciones?: string;
}

export interface ExecuteOrderResult {
    readonly success: boolean;
    readonly deduplicated: boolean;
    readonly pedido_id: string;
    readonly estado: CanonicalOrderStatus;
    readonly idempotency_key: string;
    readonly audit_log_id?: string;
    readonly error_code?: string;
    readonly error_message?: string;
}

/**
 * Operación 4: get_order_status (Consulta de Estado)
 */
export interface GetOrderStatusInput {
    readonly operation: 'get_order_status';
    readonly grant_id?: string;
    readonly operator_auth_user_id?: string;
    readonly pedido_id?: string;
    readonly idempotency_key?: string;
}

export interface GetOrderStatusResult {
    readonly found: boolean;
    readonly pedido_id?: string;
    readonly socio_id?: string;
    readonly estado?: CanonicalOrderStatus;
    readonly tipo_pedido?: OrderType;
    readonly items?: ReadonlyArray<ConsolidatedOrderItem>;
    readonly created_at?: string;
    readonly updated_at?: string;
    readonly created_by_user_id?: string;
    readonly terminal: boolean;
}

// ============================================================================
// 5. SOLUCIÓN DE IDEMPOTENCIA INTEGRAL PARA SOCIOS (CHECKOUT)
// ============================================================================

/**
 * Sobre de idempotencia para el checkout de socios.
 * La clave no es un simple UUID aleatorio en memoria, sino un anclaje determinista:
 * 1. order_intent_id: Identificador unívoco del intento/intención de pedido generado al iniciar el checkout.
 * 2. cart_session_id: Identificador del ciclo de compra activo del socio (opcional/retrocompatible).
 * 3. client_attempt: Contador entero de reintentos sobre la misma intención.
 * 4. canonical_payload_hash: Huella SHA-256 de los ítems y datos de entrega.
 *
 * Propiedades esenciales (Sprint 7B.4 - Etapa 2):
 * - Reintentos de red o doble-clic: Reutilizan el mismo order_intent_id, generando exactamente la misma idempotency_key.
 * - Dos compras legítimas con contenido idéntico: Cada compra inicia un order_intent_id nuevo y genera claves distintas.
 * - Mutación del carrito: Cambia canonical_payload_hash, rotando la clave automáticamente.
 */
export interface SocioCheckoutIdempotencyEnvelope {
    readonly order_intent_id: string;
    readonly cart_session_id?: string;
    readonly socio_id: string;
    readonly canonical_payload_hash: string;
    readonly idempotency_key: string; // Generado vía UUID v5 determinístico sobre order_intent_id + hash
    readonly client_attempt: number;
    readonly timestamp: number;
}

// ============================================================================
// 6. CICLO DE VIDA DEL GRANT Y CONSUMO ATÓMICO (STAGE 2)
// ============================================================================

export type GrantStatus = 'issued' | 'consumed' | 'expired' | 'revoked';

export interface GrantExecutionRecord {
    readonly grant_id: string;
    readonly status: GrantStatus;
    readonly operator_auth_user_id: string;
    readonly target_socio_id: string;
    readonly approved_payload_hash: string;
    readonly idempotency_key: string;
    readonly pedido_id?: string;
    readonly execution_result?: any;
    readonly issued_at: number;
    readonly expires_at: number;
    readonly consumed_at?: number;
}

export type GrantConsumptionResult =
    | {
          readonly success: true;
          readonly alreadyExecuted: false;
          readonly grant: ActionGrantPayload;
      }
    | {
          readonly success: true;
          readonly alreadyExecuted: true; // Recuperación de timeout: resultado previamente persistido
          readonly previousResult: any;
          readonly pedidoId?: string;
      }
    | {
          readonly success: false;
          readonly code: 'GRANT_NOT_FOUND' | 'GRANT_EXPIRED' | 'GRANT_ALREADY_CONSUMED' | 'PAYLOAD_MISMATCH' | 'CONCURRENCY_CONFLICT';
          readonly error: string;
      };

export interface OperatorVerificationResult {
    readonly valid: boolean;
    readonly role: 'admin' | 'staff' | 'other';
    readonly active: boolean;
    readonly blocked: boolean;
    readonly error?: string;
    readonly code?: string;
}

export interface PedidosToolConfig {
    /** Feature flag: la ejecución autónoma de pedidos debe estar deshabilitada por defecto */
    readonly executionEnabled: boolean;
    readonly enabled?: boolean;
    readonly secret?: string;
    readonly grantTtlSeconds?: number;
}
