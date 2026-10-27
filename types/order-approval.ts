/**
 * types/order-approval.ts
 *
 * ACIACAM — Sprint 7B.5
 * Tipos para la Bandeja de Acciones Pendientes y Aprobaciones Humanas
 */

import { OrderType } from './index';

export interface OrderProposalItem {
  productoId: string;
  productoNombre: string;
  cantidad: number;
  stockDisponible: number; // Snapshot inmutable al momento de crear la propuesta
  suficiente: boolean;     // Evaluación histórica al momento de crear la propuesta
  stockActual?: number;    // Stock vivo actual en inventario (public.products)
  stockActualSuficiente?: boolean; // stockActual >= cantidad
  stockActualUpdatedAt?: string;   // Timestamp de última actualización de inventario
  pesoGramosUnitario?: number;
  subtotalGramos?: number;
  tipo?: 'flor' | 'gotero' | 'crema' | 'otro';
}

export interface OrderProposalValidation {
  valid: boolean;
  stock_sufficient: boolean;
  legal_transport_compliant: boolean;
  total_flores_gramos: number;
  total_goteros_unidades: number;
  warnings: string[];
  errors: string[];
  verified_at: string;
}

export interface OrderProposalGrantInfo {
  grant_id: string;
  operator_auth_user_id: string;
  target_socio_id: string;
  status: 'issued' | 'executed' | 'revoked';
  approved_payload_hash: string;
  issued_at: string;
  expires_at: string;
  correlation_id?: string;
  pedido_id?: string | null;
}

export interface OrderProposalExecutionResult {
  pedido_id: string;
  estado: string;
  operation_state: string;
  deduplicated: boolean;
  correlation_id: string;
  idempotency_key: string;
}

export interface OrderProposal {
  id: string;
  proposal_payload_hash: string;
  approved_catalogue_hash?: string;
  socio_id: string;
  socio_nombre: string;
  socio_dni?: string;
  socio_email?: string;
  socio_bloqueado?: boolean;
  tipo_pedido: OrderType;
  items: OrderProposalItem[];
  motivo: string;
  solicitante: {
    tipo: 'agente' | 'operador' | 'socio';
    nombre: string;
    id?: string;
  };
  details: {
    direccion_entrega?: string;
    localidad?: string;
    fecha_retiro?: string;
    franja_horaria?: string;
    slot_id?: string;
    observaciones?: string;
  };
  validation: OrderProposalValidation;
  status: 'pending_review' | 'grant_issued' | 'executed' | 'rejected' | 'expired';
  idempotency_key: string;
  grant?: OrderProposalGrantInfo;
  execution_result?: OrderProposalExecutionResult;
  rejection_reason?: string;
  created_at: string;
  expires_at?: string;
  stock_actual_synced_at?: string;
}

export interface CreateProposalInput {
  socio_id: string;
  items: Array<{ productoId: string; cantidad: number }>;
  tipo_pedido: OrderType;
  motivo: string;
  direccion_entrega?: string;
  localidad?: string;
  fecha_retiro?: string;
  franja_horaria?: string;
  slot_id?: string;
  observaciones?: string;
  solicitante_tipo?: 'agente' | 'operador' | 'socio';
  solicitante_nombre?: string;
  idempotency_key?: string;
}

export type { ProposalOperationalCategory } from '@/app/lib/agent/proposal-categories';
export { getProposalCategory, isActionGrantActive } from '@/app/lib/agent/proposal-categories';
