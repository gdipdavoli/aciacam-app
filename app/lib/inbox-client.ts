import {
  AdminInboxSummary,
  AdminInboxPage,
  InboxDetailDTO,
  AdminInboxCategory,
  AdminInboxPriority,
  AdminInboxSourceType,
  InboxCategoryFilter,
  InboxPriorityFilter,
  AuditActionType,
  ProposalActionType,
  CommunicationActionType,
  OnboardingActionType,
} from '@/types/inbox';

export class InboxApiError extends Error {
  status: number;
  detail?: string;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = 'InboxApiError';
    this.status = status;
    this.detail = detail;
  }
}

function parseJsonOrNull(text: string): unknown | null {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function messageFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  return String(record.detail || record.message || record.error || '');
}

async function bffFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const rawText = await res.text();
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.toLowerCase().includes('application/json');
  const payload = isJson ? parseJsonOrNull(rawText) : null;

  if (!res.ok) {
    const payloadMessage = messageFromPayload(payload);
    const errorDetail = payloadMessage || rawText.trim() || `Error HTTP ${res.status}`;

    throw new InboxApiError(
      errorDetail,
      res.status,
      errorDetail
    );
  }

  if (!payload) {
    throw new InboxApiError(
      'Respuesta inválida del servidor.',
      res.status,
      rawText.trim() || 'La respuesta exitosa no contiene JSON válido.'
    );
  }

  return payload as T;
}

export async function fetchInboxSummary(): Promise<AdminInboxSummary> {
  return bffFetch<AdminInboxSummary>('/api/agent/inbox/summary');
}

export async function fetchInboxPage(params?: {
  category?: AdminInboxCategory | InboxCategoryFilter | null;
  priority?: AdminInboxPriority | InboxPriorityFilter | null;
  limit?: number;
  cursor?: string;
}): Promise<AdminInboxPage> {
  const query = new URLSearchParams();
  if (params?.category && params.category !== 'ALL') {
    query.set('category', params.category);
  }
  if (params?.priority && params.priority !== 'ALL') {
    query.set('priority', params.priority);
  }
  if (params?.limit) {
    query.set('limit', String(params.limit));
  }
  if (params?.cursor) {
    query.set('cursor', params.cursor);
  }
  const url = `/api/agent/inbox?${query.toString()}`;
  return bffFetch<AdminInboxPage>(url);
}

export async function fetchInboxDetail(
  sourceType: string,
  sourceId: string
): Promise<InboxDetailDTO> {
  const url = `/api/agent/inbox/${sourceType}/${sourceId}`;
  return bffFetch<InboxDetailDTO>(url);
}

export async function markAuditFindingInReview(
  sourceId: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/audit-findings/${sourceId}/mark-in-review`, {
    method: 'POST',
  });
}

export async function resolveAuditFinding(
  sourceId: string,
  resolutionNote: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/audit-findings/${sourceId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution_note: resolutionNote }),
  });
}

export async function dismissAuditFinding(
  sourceId: string,
  dismissalNote?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/audit-findings/${sourceId}/dismiss`, {
    method: 'POST',
    body: JSON.stringify({ resolution_note: dismissalNote }),
  });
}

export async function createCommunicationIntentFromAuditFinding(
  sourceId: string,
  reviewNote?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/audit-findings/${sourceId}/create-communication-intent`, {
    method: 'POST',
    body: JSON.stringify({ review_notes: reviewNote }),
  });
}

export async function approveProfileProposal(
  sourceId: string,
  reviewNote?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/profile-proposals/${sourceId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ review_notes: reviewNote }),
  });
}

export async function rejectProfileProposal(
  sourceId: string,
  reviewNote?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/profile-proposals/${sourceId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ review_notes: reviewNote }),
  });
}

export async function cancelProfileProposal(
  sourceId: string,
  reviewNote?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/profile-proposals/${sourceId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ review_notes: reviewNote }),
  });
}

export async function approveCommunicationIntent(
  sourceId: string,
  reviewNote?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/communication-intents/${sourceId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ review_notes: reviewNote }),
  });
}

export async function cancelCommunicationIntent(
  sourceId: string,
  reviewNote?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/communication-intents/${sourceId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ review_notes: reviewNote }),
  });
}

export async function approveOnboardingProposal(
  sourceId: string,
  expectedProposalHash: string,
  reviewComment?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/onboarding-proposals/${sourceId}/approve`, {
    method: 'POST',
    body: JSON.stringify({
      expected_proposal_hash: expectedProposalHash,
      review_comment: reviewComment?.trim() || undefined,
    }),
  });
}


export async function applyOnboardingProposal(sourceId: string): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/onboarding-proposals/${sourceId}/apply`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function rejectOnboardingProposal(
  sourceId: string,
  expectedProposalHash: string,
  rejectionReason: string,
  reviewComment?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/onboarding-proposals/${sourceId}/reject`, {
    method: 'POST',
    body: JSON.stringify({
      expected_proposal_hash: expectedProposalHash,
      rejection_reason: rejectionReason.trim(),
      review_comment: reviewComment?.trim() || undefined,
    }),
  });
}

export async function executeAuditFindingAction(
  sourceId: string,
  action: AuditActionType,
  note?: string
): Promise<unknown> {
  if (action === 'in_review') {
    return markAuditFindingInReview(sourceId);
  } else if (action === 'resolve') {
    return resolveAuditFinding(sourceId, note || '');
  } else if (action === 'dismiss') {
    return dismissAuditFinding(sourceId, note);
  } else if (action === 'create_communication_intent') {
    return createCommunicationIntentFromAuditFinding(sourceId, note);
  }
  throw new Error(`Acción desconocida para audit_findings: ${action}`);
}

export async function executeProfileProposalAction(
  sourceId: string,
  action: ProposalActionType,
  note?: string
): Promise<unknown> {
  if (action === 'approve') {
    return approveProfileProposal(sourceId, note);
  } else if (action === 'reject') {
    return rejectProfileProposal(sourceId, note);
  } else if (action === 'cancel') {
    return cancelProfileProposal(sourceId, note);
  }
  throw new Error(`Acción desconocida para profile_proposals: ${action}`);
}

export async function executeCommunicationAction(
  sourceId: string,
  action: CommunicationActionType,
  note?: string
): Promise<unknown> {
  if (action === 'approve') {
    return approveCommunicationIntent(sourceId, note);
  } else if (action === 'cancel') {
    return cancelCommunicationIntent(sourceId, note);
  }
  throw new Error(`Acción desconocida para communication_intents: ${action}`);
}

export async function executeOnboardingAction(
  sourceId: string,
  action: OnboardingActionType,
  expectedProposalHash: string,
  rejectionReason?: string,
  reviewComment?: string
): Promise<unknown> {
  if (action === 'approve') {
    return approveOnboardingProposal(sourceId, expectedProposalHash, reviewComment);
  } else if (action === 'apply') {
    return applyOnboardingProposal(sourceId);
  } else if (action === 'reject') {
    if (!rejectionReason) {
      throw new Error('El motivo de rechazo es obligatorio para propuestas de onboarding.');
    }
    return rejectOnboardingProposal(sourceId, expectedProposalHash, rejectionReason, reviewComment);
  }
  throw new Error(`Acción desconocida para onboarding_proposals: ${action}`);
}
