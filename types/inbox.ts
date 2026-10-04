export type AdminInboxSourceType = 'audit_findings' | 'profile_update_proposals' | 'communication_intents' | 'onboarding_proposals' | 'audit_finding' | 'profile_proposal' | 'communication_intent' | 'onboarding_proposal';
export type AdminInboxCategory = 'AUDIT' | 'FINANCIAL' | 'DOCUMENT' | 'COMMUNICATION';
export type AdminInboxPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AdminInboxStatus = 'PENDING' | 'IN_REVIEW' | 'AWAITING_APPROVAL' | 'AWAITING_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'DELIVERING' | 'SENT' | 'FAILED';

export interface SocioSummaryDTO {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  dni_masked?: string | null;
}

export interface AdminInboxItem {
  id?: string;
  source_type: string;
  source_id: string;
  category: AdminInboxCategory;
  priority: AdminInboxPriority;
  status: AdminInboxStatus;
  title: string;
  summary?: string | null;
  created_at: string;
  subject_reference?: string | null;
  socio?: SocioSummaryDTO | null;
}

export type InboxItemDTO = AdminInboxItem;

export interface AdminInboxCategoryCounts {
  audit?: number;
  financial?: number;
  document?: number;
  communication?: number;
  AUDIT?: number;
  FINANCIAL?: number;
  DOCUMENT?: number;
  COMMUNICATION?: number;
}

export interface AdminInboxSummary {
  total_pending: number;
  by_category: AdminInboxCategoryCounts;
}

export type InboxSummaryResponse = AdminInboxSummary;

export interface AdminInboxPage {
  items: AdminInboxItem[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface AuditFindingInboxDetail {
  source_type: string;
  source_id: string;
  finding_type?: string;
  domain?: string;
  severity?: string;
  title?: string;
  description?: string;
  status?: string;
  suggested_action?: string | null;
  detected_at?: string;
  first_detected_at?: string;
  last_detected_at?: string;
  last_seen_at?: string;
  updated_at?: string;
  reviewed_at?: string | null;
  review_notes?: string | null;
  socio?: SocioSummaryDTO | null;
}

export interface ProfileProposalInboxDetail {
  source_type: string;
  source_id: string;
  field_name?: string;
  current_value?: string | null;
  proposed_value?: string;
  operation_type?: string;
  operation?: string;
  confidence_score?: number;
  extraction_confidence?: number;
  status?: string;
  created_at?: string;
  reviewed_at?: string | null;
  review_notes?: string | null;
  source_reference?: string | null;
  socio?: SocioSummaryDTO | null;
}

export interface CommunicationIntentInboxDetail {
  source_type: string;
  source_id: string;
  action?: string;
  action_type?: string;
  subject?: string;
  subject_type?: string;
  subject_reference?: string | null;
  status?: string;
  requires_approval?: boolean;
  created_at?: string;
  reviewed_at?: string | null;
  review_notes?: string | null;
  safe_reference?: string | null;
  socio?: SocioSummaryDTO | null;
  channel?: string | null;
  recipient?: string | null;
  body_text?: string | null;
  template_id?: string | null;
  template_version?: string | null;
  prepared?: boolean | null;
  approved_preparation_hash?: string | null;
}

export interface OnboardingProposalInboxDetail {
  id: string;
  application_id: string;
  status: string;
  test_mode: boolean;
  proposal_hash: string;
  identidad_administrativo: {
    nombre: string;
    apellido: string;
    dni_masked: string;
    email: string;
    telefono: string;
  };
  reprocann: {
    nombre?: string | null;
    apellido?: string | null;
    numero_tramite?: string | null;
    fecha_alta?: string | null;
    vencimiento?: string | null;
    tipo?: string | null;
  };
  clinico_inicial: {
    diagnostico?: string | null;
    medico_nombre?: string | null;
    medico_matricula?: string | null;
    medico_especialidad?: string | null;
    fecha_firma?: string | null;
  };
  documentos: Record<
    string,
    {
      extraction_status?: string | null;
      document_type?: string | null;
      tipo?: string | null;
      confidence?: number | null;
      requires_review?: boolean | null;
    }
  >;
  created_at: string;
  socio?: SocioSummaryDTO | null;
}

export type InboxDetailDTO =
  | AuditFindingInboxDetail
  | ProfileProposalInboxDetail
  | CommunicationIntentInboxDetail
  | OnboardingProposalInboxDetail;

export type InboxCategoryFilter = 'ALL' | 'AUDIT' | 'FINANCIAL' | 'DOCUMENT' | 'COMMUNICATION' | null;
export type InboxPriorityFilter = 'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | null;


export interface OnboardingApplyResult {
  proposal_id: string;
  application_id: string;
  socio_id: string;
  application_status: string;
  materialized: boolean;
  idempotent: boolean;
  promoted_document_count: number;
}

export type AuditActionType = 'in_review' | 'resolve' | 'dismiss' | 'create_communication_intent';
export type ProposalActionType = 'approve' | 'reject' | 'cancel';
export type CommunicationActionType = 'approve' | 'cancel';
export type OnboardingActionType = 'approve' | 'reject' | 'apply';

export type ActionType = AuditActionType | ProposalActionType | CommunicationActionType | OnboardingActionType;

