export type AdminInboxSourceType = 'audit_findings' | 'profile_update_proposals' | 'communication_intents' | 'audit_finding' | 'profile_proposal' | 'communication_intent';
export type AdminInboxCategory = 'AUDIT' | 'FINANCIAL' | 'DOCUMENT' | 'COMMUNICATION';
export type AdminInboxPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AdminInboxStatus = 'PENDING' | 'IN_REVIEW' | 'AWAITING_APPROVAL' | 'APPROVED' | 'DELIVERING' | 'SENT' | 'FAILED';

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

export type InboxDetailDTO = AuditFindingInboxDetail | ProfileProposalInboxDetail | CommunicationIntentInboxDetail;

export type InboxCategoryFilter = 'ALL' | 'AUDIT' | 'FINANCIAL' | 'DOCUMENT' | 'COMMUNICATION' | null;
export type InboxPriorityFilter = 'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | null;

export type AuditActionType = 'in_review' | 'resolve' | 'dismiss' | 'create_communication_intent';
export type ProposalActionType = 'approve' | 'reject' | 'cancel';
export type CommunicationActionType = 'approve' | 'cancel';

export type ActionType = AuditActionType | ProposalActionType | CommunicationActionType;


