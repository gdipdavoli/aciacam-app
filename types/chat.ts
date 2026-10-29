/**
 * types/chat.ts
 *
 * Contratos estructurados y fuertemente tipados para el BFF de Chat.
 * Soporta enrutamiento dual seguro:
 * - Mensajes conversacionales hacia Agent Core Python (QUERY_INBOX, RUN_CAPABILITY, etc.)
 * - Propuestas de pedidos deterministas hacia Agent Core TypeScript (PROPOSE_ORDER)
 */

export interface ChatOrderItemInput {
  readonly producto_id?: string;
  readonly product_id?: string;
  readonly productoId?: string;
  readonly cantidad: number;
}

export interface ChatBffRequest {
  readonly message?: string;
  readonly confirmation_token?: string;
  readonly intent?: string;
  readonly items?: ReadonlyArray<ChatOrderItemInput>;
  readonly tipo_pedido?: string;
  readonly motivo?: string;
  readonly direccion_entrega?: string;
  readonly localidad?: string;
  readonly fecha_retiro?: string;
  readonly franja_horaria?: string;
  readonly slot_id?: string;
  readonly observaciones?: string;
  readonly details?: Record<string, unknown>;
}

export type ChatIntentType =
  | 'QUERY_INBOX'
  | 'RUN_CAPABILITY'
  | 'PREPARE_INBOX_ACTION'
  | 'CONFIRM_ACTION'
  | 'CANCEL_CONFIRMATION'
  | 'UNKNOWN'
  | 'PROPOSE_ORDER';

export interface ChatInboxQueryPayload {
  readonly items: ReadonlyArray<unknown>;
  readonly total_count: number;
}

export interface ChatCapabilityExecutionPayload {
  readonly capability_name: string;
  readonly execution_id: string;
  readonly status: string;
  readonly summary: string;
}

export interface ChatConfirmationRequiredPayload {
  readonly confirmation_token: string;
  readonly action_summary: string;
  readonly human_target_description: string;
  readonly expires_at: string;
  readonly risk_level: string;
}

export interface ChatClarificationRequiredPayload {
  readonly clarification_question: string;
  readonly suggested_options?: ReadonlyArray<string>;
}

export interface ChatErrorPayload {
  readonly error_code: string;
  readonly message: string;
}

export interface ChatProposalCreatedPayload {
  readonly status: string;
  readonly proposal_id: string;
  readonly proposal_payload_hash: string;
  readonly proposal_status: string;
  readonly items_count: number;
  readonly raw_proposal?: unknown;
}

export type ChatResponsePayload =
  | ChatInboxQueryPayload
  | ChatCapabilityExecutionPayload
  | ChatConfirmationRequiredPayload
  | ChatClarificationRequiredPayload
  | ChatErrorPayload
  | ChatProposalCreatedPayload;

export interface ChatResponseEnvelope {
  readonly request_id: string;
  readonly intent: ChatIntentType;
  readonly payload: ChatResponsePayload;
  readonly human_message: string;
  readonly requires_confirmation: boolean;
  readonly requires_clarification: boolean;
}

export interface ChatBffErrorResponse {
  readonly error: string;
  readonly error_code?: string;
}

export type ChatBffResponse = ChatResponseEnvelope | ChatBffErrorResponse;
