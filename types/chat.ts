/**
 * types/chat.ts
 *
 * Contratos estructurados y fuertemente tipados para el BFF de Chat (Sprint 2 - Step 10E-B.2).
 * Sin any, sin Record<string, any>, sin catch-all en ChatResponsePayload.
 */

export interface ChatBffRequest {
  readonly message?: string;
  readonly confirmation_token?: string;
}

export type ChatIntentType =
  | 'QUERY_INBOX'
  | 'RUN_CAPABILITY'
  | 'PREPARE_INBOX_ACTION'
  | 'CONFIRM_ACTION'
  | 'CANCEL_CONFIRMATION'
  | 'UNKNOWN';

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

export type ChatResponsePayload =
  | ChatInboxQueryPayload
  | ChatCapabilityExecutionPayload
  | ChatConfirmationRequiredPayload
  | ChatClarificationRequiredPayload
  | ChatErrorPayload;

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
