/**
 * app/lib/agent/proposal-categories.ts
 *
 * ACIACAM — Sprint 7B.8 (Prioridad 1)
 * Partición Canónica de Estados Operativos de Propuestas de Pedido
 *
 * Garantiza que toda propuesta pertenezca a exactamente UNA categoría:
 * - 'pending': En espera de aprobación, dentro de la ventana de 24h.
 * - 'issued': Con Action Grant emitido, dentro de la ventana de 24h (puede requerir renovación de 120s).
 * - 'executed': Ejecutado con éxito (estado terminal permanente, NUNCA vence).
 * - 'rejected': Rechazado administrativamente (estado terminal permanente, NUNCA vence).
 * - 'expired': Propuesta vencida tras superar su ventana de 24h (o status = 'expired').
 *
 * Invariante: pendingCount + issuedCount + executedCount + rejectedCount + expiredCount === totalProposals
 */

import { OrderProposal } from '@/types/order-approval';

export type ProposalOperationalCategory = 'pending' | 'issued' | 'executed' | 'rejected' | 'expired';

/**
 * Determina la categoría operativa única a la que pertenece una propuesta.
 * Particiona el conjunto de propuestas de manera disjunta y exhaustiva.
 */
export function getProposalCategory(
  proposal: Pick<OrderProposal, 'status' | 'expires_at'>,
  nowMs: number = Date.now()
): ProposalOperationalCategory {
  // 1. Estados terminales definitivos: NUNCA vencen
  if (proposal.status === 'executed') {
    return 'executed';
  }
  if (proposal.status === 'rejected') {
    return 'rejected';
  }

  // 2. Control de expiración de propuesta (ventana de 24 horas)
  const is24hExpired = proposal.status === 'expired' || 
    (proposal.expires_at ? new Date(proposal.expires_at).getTime() <= nowMs : false);

  if (is24hExpired) {
    return 'expired';
  }

  // 3. Estados activos no expirados
  if (proposal.status === 'grant_issued') {
    return 'issued';
  }

  if (proposal.status === 'pending_review') {
    return 'pending';
  }

  return 'pending';
}

/**
 * Determina si el Action Grant asociado a una propuesta se encuentra actualmente
 * vigente dentro de su ventana de ejecución de 120 segundos.
 */
export function isActionGrantActive(
  proposal: Pick<OrderProposal, 'status' | 'grant'>,
  nowMs: number = Date.now()
): boolean {
  if (proposal.status !== 'grant_issued' || !proposal.grant?.expires_at) {
    return false;
  }
  return new Date(proposal.grant.expires_at).getTime() > nowMs;
}
