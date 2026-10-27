/**
 * app/lib/agent/backend-adapter.ts
 *
 * ACIACAM — Sprint 7B.4 (Etapa 2)
 * Adaptador Seguro para la RPC crear_pedido_administrativo_transaccional
 *
 * Preservación de Identidad y Mitigación de Elevación de Privilegios:
 * 1. Agent Core no recibe ni retransmite el JWT de sesión del operador.
 * 2. El adaptador transmite el ActionGrantToken firmado al backend (BFF).
 * 3. En el backend, tras validar la firma y vigencia del grant, la llamada a PostgreSQL
 *    se ejecuta inyectando el contexto de identidad del operador mediante:
 *    SET LOCAL request.jwt.claim.sub = :operator_auth_user_id
 *    SET LOCAL request.jwt.claim.role = 'authenticated'
 * 4. De este modo, la RPC evalúa auth.uid() contra el ID real del operador humano,
 *    verificando su rol en public.socios y persistiendo created_by_user_id en pedidos
 *    y audit_logs SIN usar service_role como sustituto ciego de identidad.
 */

import {
    ExecuteOrderInput,
    ExecuteOrderResult,
    GetOrderStatusInput,
    GetOrderStatusResult,
    ValidateOrderInput,
    ValidateOrderResult
} from '@/types/pedidos-tool';
import { CreateProposalInput, OrderProposal } from '@/types/order-approval';

export interface IBackendOrderAdapter {
    validateOrder(input: ValidateOrderInput): Promise<ValidateOrderResult>;
    createProposal(input: CreateProposalInput): Promise<OrderProposal>;
    executeOrder(input: ExecuteOrderInput): Promise<ExecuteOrderResult>;
    getOrderStatus(input: GetOrderStatusInput): Promise<GetOrderStatusResult>;
}

export class BackendCommunicationError extends Error {
    constructor(
        message: string,
        public readonly upstreamStatus?: number,
        public readonly upstreamCode?: string
    ) {
        super(message);
        this.name = 'BackendCommunicationError';
    }
}

/**
 * Adaptador de producción/integración S2S que se comunica con los endpoints del BFF
 */
export class S2SBackendOrderAdapter implements IBackendOrderAdapter {
    constructor(
        private baseUrl: string,
        private bffSecret: string
    ) {}

    public async validateOrder(input: ValidateOrderInput): Promise<ValidateOrderResult> {
        try {
            const res = await fetch(`${this.baseUrl}/api/admin/pedidos/validate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Agent-Core-Secret': this.bffSecret
                },
                body: JSON.stringify(input)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new BackendCommunicationError(
                    errData.error || `Error en validación previa: ${res.statusText}`,
                    res.status,
                    errData.code
                );
            }

            return await res.json();
        } catch (err: any) {
            if (err instanceof BackendCommunicationError) throw err;
            throw new BackendCommunicationError(`Falla de comunicación S2S: ${err.message}`, 502, 'S2S_NETWORK_FAILURE');
        }
    }

    public async createProposal(input: CreateProposalInput): Promise<OrderProposal> {
        try {
            const res = await fetch(`${this.baseUrl}/api/admin/pedidos/proposals`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Agent-Core-Secret': this.bffSecret,
                    'X-Solicitante-Tipo': input.solicitante_tipo || 'agente',
                    'X-Solicitante-Nombre': input.solicitante_nombre || 'Agent Core'
                },
                body: JSON.stringify(input)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new BackendCommunicationError(
                    errData.error || `Error al crear propuesta: ${res.statusText}`,
                    res.status,
                    errData.code
                );
            }

            const data = await res.json();
            return data.proposal;
        } catch (err: any) {
            if (err instanceof BackendCommunicationError) throw err;
            throw new BackendCommunicationError(`Falla de comunicación S2S: ${err.message}`, 502, 'S2S_NETWORK_FAILURE');
        }
    }

    public async executeOrder(input: ExecuteOrderInput): Promise<ExecuteOrderResult> {
        try {
            const res = await fetch(`${this.baseUrl}/api/admin/pedidos/execute-grant`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Agent-Core-Secret': this.bffSecret,
                    'X-Delegated-Auth-User-Id': input.action_grant.payload.operator_auth_user_id,
                    'Idempotency-Key': input.idempotency_key
                },
                body: JSON.stringify(input)
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                throw new BackendCommunicationError(
                    data.error || `Error en ejecución transaccional: ${res.statusText}`,
                    res.status,
                    data.code
                );
            }

            return {
                success: true,
                deduplicated: Boolean(data.deduplicated),
                pedido_id: data.pedido?.id || data.pedido_id,
                estado: data.pedido?.estado || 'pendiente',
                idempotency_key: input.idempotency_key,
                audit_log_id: data.audit_log_id
            };
        } catch (err: any) {
            if (err instanceof BackendCommunicationError) throw err;
            throw new BackendCommunicationError(`Falla de comunicación S2S: ${err.message}`, 502, 'S2S_NETWORK_FAILURE');
        }
    }

    public async getOrderStatus(input: GetOrderStatusInput): Promise<GetOrderStatusResult> {
        try {
            if(!input.grant_id || !input.operator_auth_user_id) throw new BackendCommunicationError('GRANT_ID_AND_ACTOR_REQUIRED',400);
            const query = `grant_id=${encodeURIComponent(input.grant_id)}`;

            const res = await fetch(`${this.baseUrl}/api/admin/pedidos/status?${query}`, {
                method: 'GET',
                headers: {
                    'X-Agent-Core-Secret': this.bffSecret,
                    'X-Delegated-Auth-User-Id': input.operator_auth_user_id
                }
            });

            if (!res.ok) {
                if (res.status === 404) {
                    return { found: false, terminal: false };
                }
                const errData = await res.json().catch(() => ({}));
                throw new BackendCommunicationError(
                    errData.error || `Error al consultar pedido: ${res.statusText}`,
                    res.status,
                    errData.code
                );
            }

            return await res.json();
        } catch (err: any) {
            if (err instanceof BackendCommunicationError) throw err;
            throw new BackendCommunicationError(`Falla de comunicación S2S: ${err.message}`, 502, 'S2S_NETWORK_FAILURE');
        }
    }
}

/**
 * Adaptador para pruebas locales controladas y validaciones de arnés
 */
export class MockBackendOrderAdapter implements IBackendOrderAdapter {
    private orders = new Map<string, any>();
    private stock = new Map<string, number>();
    private networkFailureSimulated = false;

    public setProductStock(productId: string, qty: number) {
        this.stock.set(productId, qty);
    }

    public simulateNetworkFailure(enabled: boolean) {
        this.networkFailureSimulated = enabled;
    }

    public async validateOrder(input: ValidateOrderInput): Promise<ValidateOrderResult> {
        if (this.networkFailureSimulated) {
            throw new BackendCommunicationError('SIMULATED_S2S_TIMEOUT: Error de conexión con el backend', 504, 'GATEWAY_TIMEOUT');
        }

        const stockPreflight = input.items.map(it => {
            const avail = this.stock.get(it.productoId) ?? 100;
            return {
                productoId: it.productoId,
                cantidadSolicitada: it.cantidad,
                stockDisponibleActual: avail,
                suficiente: avail >= it.cantidad
            };
        });

        const insufficient = stockPreflight.some(s => !s.suficiente);

        return {
            valid: !insufficient,
            socio_status: 'active',
            socio_bloqueado: false,
            envios_habilitados: true,
            stock_preflight: stockPreflight,
            transport_evaluation: {
                flores_g: 5,
                goteros_u: 0,
                compliant: true
            },
            errors: insufficient ? ['Stock insuficiente en uno o más productos'] : [],
            warnings: [],
            verified_at: new Date().toISOString(),
            notice: 'La validación previa no congela ni garantiza disponibilidad futura de stock. La reserva física se realiza de forma atómica en la transacción definitiva.'
        };
    }

    public async createProposal(input: CreateProposalInput): Promise<OrderProposal> {
        if (this.networkFailureSimulated) {
            throw new BackendCommunicationError('SIMULATED_S2S_TIMEOUT: Error de conexión con el backend', 504, 'GATEWAY_TIMEOUT');
        }

        const id = 'prop-' + Math.random().toString(36).substring(2, 10);
        const hash = 'a1b2c3d4' + Math.random().toString(16).padEnd(56, '0');
        return {
            id,
            proposal_payload_hash: hash,
            socio_id: input.socio_id,
            socio_nombre: 'Socio de Prueba',
            tipo_pedido: input.tipo_pedido,
            items: input.items.map(it => ({
                productoId: it.productoId,
                productoNombre: 'Producto Sintético',
                cantidad: it.cantidad,
                stockDisponible: 20,
                suficiente: true
            })),
            motivo: input.motivo,
            solicitante: {
                tipo: input.solicitante_tipo || 'agente',
                nombre: input.solicitante_nombre || 'Agent Core'
            },
            details: {
                direccion_entrega: input.direccion_entrega,
                localidad: input.localidad,
                fecha_retiro: input.fecha_retiro,
                franja_horaria: input.franja_horaria,
                slot_id: input.slot_id,
                observaciones: input.observaciones
            },
            validation: {
                valid: true,
                stock_sufficient: true,
                legal_transport_compliant: true,
                total_flores_gramos: 5,
                total_goteros_unidades: 0,
                warnings: [],
                errors: [],
                verified_at: new Date().toISOString()
            },
            status: 'pending_review',
            idempotency_key: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86400000).toISOString()
        };
    }

    public async executeOrder(input: ExecuteOrderInput): Promise<ExecuteOrderResult> {
        if (this.networkFailureSimulated) {
            throw new BackendCommunicationError('SIMULATED_S2S_TIMEOUT: Error de conexión con el backend', 504, 'GATEWAY_TIMEOUT');
        }

        // Deduplicación idempotente
        for (const [_, order] of this.orders) {
            if (order.idempotency_key === input.idempotency_key) {
                return {
                    success: true,
                    deduplicated: true,
                    pedido_id: order.id,
                    estado: order.estado,
                    idempotency_key: input.idempotency_key,
                    audit_log_id: order.audit_log_id
                };
            }
        }

        // Comprobar y descontar stock atómicamente
        for (const it of input.items) {
            const currentStock = this.stock.get(it.productoId) ?? 100;
            if (currentStock < it.cantidad) {
                throw new BackendCommunicationError(
                    `ORDER_STOCK_INSUFFICIENT: Stock insuficiente para el producto ${it.productoId}. Solicitado: ${it.cantidad}, disponible: ${currentStock}`,
                    400,
                    'INSUFFICIENT_STOCK'
                );
            }
        }

        // Descontar
        for (const it of input.items) {
            const currentStock = this.stock.get(it.productoId) ?? 100;
            this.stock.set(it.productoId, currentStock - it.cantidad);
        }

        const newOrderId = '40000000-0000-4000-8000-' + Math.floor(Math.random() * 1000000000000).toString().padStart(12, '0');
        const newOrder = {
            id: newOrderId,
            socio_id: input.socio_id,
            items: input.items,
            tipo_pedido: input.tipo_pedido,
            estado: 'pendiente' as const,
            idempotency_key: input.idempotency_key,
            audit_log_id: '50000000-0000-4000-8000-000000000001',
            created_at: new Date().toISOString()
        };

        this.orders.set(newOrderId, newOrder);

        return {
            success: true,
            deduplicated: false,
            pedido_id: newOrderId,
            estado: 'pendiente',
            idempotency_key: input.idempotency_key,
            audit_log_id: newOrder.audit_log_id
        };
    }

    public async getOrderStatus(input: GetOrderStatusInput): Promise<GetOrderStatusResult> {
        if (this.networkFailureSimulated) {
            throw new BackendCommunicationError('SIMULATED_S2S_TIMEOUT: Error de conexión con el backend', 504, 'GATEWAY_TIMEOUT');
        }

        let order = null;
        if (input.pedido_id) {
            order = this.orders.get(input.pedido_id);
        } else if (input.idempotency_key) {
            for (const [_, o] of this.orders) {
                if (o.idempotency_key === input.idempotency_key) {
                    order = o;
                    break;
                }
            }
        }

        if (!order) {
            return { found: false, terminal: false };
        }

        return {
            found: true,
            pedido_id: order.id,
            socio_id: order.socio_id,
            estado: order.estado,
            tipo_pedido: order.tipo_pedido,
            items: order.items,
            created_at: order.created_at,
            terminal: ['retirado', 'entregado', 'cancelado'].includes(order.estado)
        };
    }
}
