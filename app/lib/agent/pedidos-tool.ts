/**
 * app/lib/agent/pedidos-tool.ts
 *
 * ACIACAM — Sprint 7B.4 (Etapa 2)
 * Implementación de PedidosTool para el Orquestador Agent Core
 *
 * Directivas de Seguridad:
 * 1. execute_order está DESHABILITADO POR DEFECTO mediante configuration flag (executionEnabled = false).
 * 2. Cero uso de JWT de sesión del operador dentro del runtime de Agent Core.
 * 3. Consumo atómico de ActionGrantToken con recuperación determinista tras timeout.
 * 4. Verificación de permisos y estado del operador en tiempo de ejecución.
 * 5. Control de límites legales de transporte (Ley 27.350 / REPROCANN: máx. 40g flores / 6 goteros).
 */

import {
    ExecuteOrderInput,
    ExecuteOrderResult,
    GetOrderStatusInput,
    GetOrderStatusResult,
    PedidosToolConfig,
    ProposeOrderInput,
    ProposeOrderResult,
    ValidateOrderInput,
    ValidateOrderResult
} from '@/types/pedidos-tool';
import { defaultActionGrantStore, IActionGrantStore } from './action-grant-store';
import { IBackendOrderAdapter } from './backend-adapter';
import { IOperatorVerifier } from './operator-verifier';
import { computeCanonicalOrderHash, computeSocioOrderHash, consolidateOrderItems } from './pedidos-tool-core';
import { randomUUID } from 'crypto';

export class PedidosTool {
    constructor(
        private config: PedidosToolConfig,
        private backendAdapter: IBackendOrderAdapter,
        private operatorVerifier: IOperatorVerifier,
        private grantStore: IActionGrantStore = defaultActionGrantStore
    ) {}

    /**
     * Operación 1: propose_order (Solo Lectura y Consolidación)
     * No modifica la base de datos ni reserva stock.
     */
    public async proposeOrder(input: ProposeOrderInput): Promise<ProposeOrderResult> {
        if (!input.socio_id || typeof input.socio_id !== 'string') {
            throw new Error('INVALID_INPUT: socio_id es obligatorio');
        }
        if (!input.items || !Array.isArray(input.items) || input.items.length === 0) {
            throw new Error('INVALID_INPUT: El pedido debe contener al menos un producto');
        }
        if (!input.motivo || input.motivo.trim().length === 0) {
            throw new Error('INVALID_INPUT: El motivo administrativo de la propuesta es obligatorio');
        }

        const consolidated = consolidateOrderItems(input.items);

        const validation = await this.backendAdapter.validateOrder({operation:'validate_order',socio_id:input.socio_id,
            items:consolidated,tipo_pedido:input.tipo_pedido,direccion_entrega:input.direccion_entrega,localidad:input.localidad});
        const policy=validation.transport_evaluation;
        if(!validation.valid || !policy) throw new Error('CANONICAL_CORE_POLICY_EVALUATION_REQUIRED');
        const totalFloresGramos=policy.flores_g;
        const totalGoterosUnidades=policy.goteros_u;
        const legalCompliant=policy.compliant;
        const legalWarning=policy.warning;

        // Persistir la propuesta estructurada en el backend institucional (order_proposals)
        const createdProposal = await this.backendAdapter.createProposal({
            socio_id: input.socio_id,
            items: consolidated.map(i => ({ productoId: i.productoId, cantidad: i.cantidad })),
            tipo_pedido: input.tipo_pedido,
            motivo: input.motivo,
            direccion_entrega: input.direccion_entrega,
            localidad: input.localidad,
            fecha_retiro: input.fecha_retiro,
            franja_horaria: input.franja_horaria,
            slot_id: input.slot_id,
            observaciones: input.observaciones,
            solicitante_tipo: 'agente',
            solicitante_nombre: 'Agent Core',
            idempotency_key: (input as any).idempotency_key || randomUUID()
        });

        return {
            proposal_id: createdProposal.id,
            target_socio_id: input.socio_id,
            tipo_pedido: input.tipo_pedido,
            consolidated_items: consolidated,
            total_flores_gramos: totalFloresGramos,
            total_goteros_unidades: totalGoterosUnidades,
            legal_transport_compliant: legalCompliant,
            legal_warning: legalWarning,
            proposal_payload_hash: createdProposal.proposal_payload_hash,
            summary: `Propuesta de pedido (${input.tipo_pedido}) persistida con éxito (#${createdProposal.id.slice(0, 8)}...) para socio ${input.socio_id}. Pendiente de aprobación humana en /admin/aprobaciones.`,
            requires_confirmation: true,
            disclaimer: 'Esta propuesta está persistida en estado pending_review. No reserva stock ni impacta registros contables hasta que un operador humano emita su aprobación formal en /admin/aprobaciones.'
        };
    }

    /**
     * Operación 2: validate_order (Comprobación de Condiciones y Preflight)
     * No congela ni reserva stock.
     */
    public async validateOrder(input: ValidateOrderInput): Promise<ValidateOrderResult> {
        return await this.backendAdapter.validateOrder(input);
    }

    /**
     * Operación 3: get_order_status (Consulta de Estado)
     */
    public async getOrderStatus(input: GetOrderStatusInput): Promise<GetOrderStatusResult> {
        return await this.backendAdapter.getOrderStatus(input);
    }

    /**
     * Operación 4: execute_order (Ejecución Transaccional)
     * Gated por configuración (deshabilitada por defecto en producción hasta autorización expresa).
     */
    public async executeOrder(input: ExecuteOrderInput): Promise<ExecuteOrderResult> {
        // 1. Guard de configuración de seguridad
        if (!this.config.executionEnabled) {
            throw new Error(
                'AGENT_ORDER_EXECUTION_DISABLED: La ejecución autónoma de pedidos por agentes se encuentra deshabilitada por configuración de seguridad.'
            );
        }

        if (!input.action_grant) {
            throw new Error('MISSING_ACTION_GRANT: La ejecución requiere un ActionGrantToken válido');
        }

        const grantPayload = input.action_grant.payload;

        // 2. Verificación de identidad y permisos del operador en tiempo de ejecución
        const operatorCheck = await this.operatorVerifier.verifyOperator(grantPayload.operator_auth_user_id);
        if (!operatorCheck.valid) {
            throw new Error(operatorCheck.error || 'OPERATOR_REVOKED: Operador no autorizado en tiempo de ejecución');
        }

        // PostgreSQL is the only authority for consumption and recovery.
        // El hash esperado se recalcula a partir de los parámetros que se pretenden ejecutar
        const expectedHash = computeCanonicalOrderHash({
            actorUserId: grantPayload.operator_auth_user_id,
            socioId: input.socio_id,
            tipoPedido: input.tipo_pedido,
            items: input.items,
            motivo: input.motivo,
            direccionEntrega: input.direccion_entrega,
            localidad: input.localidad,
            fechaRetiro: input.fecha_retiro,
            slotId: input.slot_id,
            observaciones: input.observaciones
        });

        if (grantPayload.action !== 'execute_order'
            || grantPayload.target_socio_id !== input.socio_id
            || grantPayload.approved_payload_hash !== expectedHash) {
            throw new Error('GRANT_SCOPE_MISMATCH');
        }

        // 5. Invocación transaccional al backend adapter
        const result = await this.backendAdapter.executeOrder(input);

        if (!result.success || !/^[0-9a-f-]{36}$/i.test(result.pedido_id || '')) {
            throw new Error('EXECUTION_RESULT_UNCONFIRMED');
        }

        return result;
    }
}
