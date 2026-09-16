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

async function bffFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let errorDetail = '';
    try {
      const errJson = await res.json();
      errorDetail = errJson.detail || errJson.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await res.text();
    }
    throw new InboxApiError(
      errorDetail || `Error HTTP ${res.status}`,
      res.status,
      errorDetail
    );
  }

  return res.json();
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
  return bffFetch(`/api/agent/inbox/audit_findings/${sourceId}/in_review`, {
    method: 'POST',
  });
}

export async function resolveAuditFinding(
  sourceId: string,
  resolutionNote: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/audit_findings/${sourceId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution_note: resolutionNote }),
  });
}

export async function dismissAuditFinding(
  sourceId: string,
  dismissalNote?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/audit_findings/${sourceId}/dismiss`, {
    method: 'POST',
    body: JSON.stringify({ dismissal_note: dismissalNote }),
  });
}

export async function approveProfileProposal(
  sourceId: string,
  reviewNote?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/profile_update_proposals/${sourceId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ review_note: reviewNote }),
  });
}

export async function rejectProfileProposal(
  sourceId: string,
  reviewNote?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/profile_update_proposals/${sourceId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ review_note: reviewNote }),
  });
}

export async function cancelProfileProposal(
  sourceId: string,
  reviewNote?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/profile_update_proposals/${sourceId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ review_note: reviewNote }),
  });
}

export async function approveCommunicationIntent(
  sourceId: string,
  reviewNote?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/communication_intents/${sourceId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ review_note: reviewNote }),
  });
}

export async function cancelCommunicationIntent(
  sourceId: string,
  reviewNote?: string
): Promise<unknown> {
  return bffFetch(`/api/agent/inbox/communication_intents/${sourceId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ review_note: reviewNote }),
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
