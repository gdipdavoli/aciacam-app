'use client';

import React from 'react';
import Link from 'next/link';
import {
  Inbox,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  ShieldAlert,
  Clock,
  ArrowUpRight,
  Loader2,
  Check,
  X,
  FileCheck,
  Coins,
  Package,
} from 'lucide-react';
import {
  ChatResponseEnvelope,
  ChatInboxQueryPayload,
  ChatCapabilityExecutionPayload,
  ChatConfirmationRequiredPayload,
  ChatClarificationRequiredPayload,
  ChatErrorPayload,
} from '@/types/chat';

interface ChatEnvelopeCardProps {
  envelope: ChatResponseEnvelope;
  confirmationState?: 'pending' | 'executing' | 'confirmed' | 'cancelled' | 'expired' | 'failed' | 'dismissed';
  onConfirm?: (token: string) => void;
  onCancel?: () => void;
  onSelectOption?: (optionText: string) => void;
}

// Presentational mapping for capability names
function getCapabilityHumanLabel(name: string): string {
  switch (name) {
    case 'STOCK_AUDIT':
      return 'Auditoría de Stock';
    case 'PAYMENT_AUDIT':
      return 'Auditoría de Pagos';
    case 'DOCUMENT_ENRICHMENT':
      return 'Revisión y Enriquecimiento Documental';
    default:
      return name;
  }
}

function getCapabilityIcon(name: string) {
  switch (name) {
    case 'STOCK_AUDIT':
      return <Package size={18} className="text-primary" />;
    case 'PAYMENT_AUDIT':
      return <Coins size={18} className="text-primary" />;
    case 'DOCUMENT_ENRICHMENT':
      return <FileCheck size={18} className="text-primary" />;
    default:
      return <CheckCircle2 size={18} className="text-primary" />;
  }
}

export const ChatEnvelopeCard: React.FC<ChatEnvelopeCardProps> = ({
  envelope,
  confirmationState = 'pending',
  onConfirm,
  onCancel,
  onSelectOption,
}) => {
  const { intent, payload, requires_confirmation, requires_clarification } = envelope;

  // 1. CONFIRMATION REQUIRED CARD
  if (requires_confirmation) {
    const confPayload = payload as ChatConfirmationRequiredPayload;

    return (
      <div className="my-2 p-4 rounded-xl border border-blue-500/30 bg-blue-500/10 dark:bg-blue-950/20 text-foreground space-y-3 shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-blue-500/20 pb-2">
          <div className="flex items-center gap-2 font-bold text-sm text-blue-600 dark:text-blue-400">
            <ShieldAlert size={18} />
            <span>Confirmación Requerida</span>
          </div>
          {confPayload.risk_level && (
            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-blue-500/20 text-blue-700 dark:text-blue-300">
              {confPayload.risk_level === 'LEVEL_3_SENSITIVE_MUTATION' ? 'Mutación Sensible' : confPayload.risk_level}
            </span>
          )}
        </div>

        <div className="space-y-1.5 text-xs">
          <p className="font-semibold text-foreground">{confPayload.action_summary}</p>
          <p className="text-muted-foreground">{confPayload.human_target_description}</p>
        </div>

        {/* Action Controls / Terminal State */}
        <div className="pt-2 flex items-center justify-between gap-3">
          {confirmationState === 'pending' && (
            <>
              <button
                onClick={() => onCancel && onCancel()}
                className="px-3.5 py-1.5 rounded-lg border border-border text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex items-center gap-1.5"
              >
                <X size={14} />
                <span>Descartar</span>
              </button>
              <button
                onClick={() => onConfirm && onConfirm(confPayload.confirmation_token)}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5"
              >
                <Check size={14} />
                <span>Confirmar Acción</span>
              </button>
            </>
          )}

          {confirmationState === 'executing' && (
            <div className="inline-flex items-center gap-2 text-xs font-bold text-blue-600 dark:text-blue-400">
              <Loader2 size={16} className="animate-spin" />
              <span>Ejecutando confirmación...</span>
            </div>
          )}

          {confirmationState === 'confirmed' && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
              <Check size={14} />
              <span>Acción Confirmada</span>
            </div>
          )}

          {(confirmationState === 'dismissed' || confirmationState === 'cancelled') && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-muted text-muted-foreground text-xs font-bold">
              <X size={14} />
              <span>Descartada</span>
            </div>
          )}

          {confirmationState === 'expired' && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-bold">
              <Clock size={14} />
              <span>Confirmación Vencida</span>
            </div>
          )}

          {confirmationState === 'failed' && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-destructive/20 text-destructive text-xs font-bold">
              <AlertTriangle size={14} />
              <span>Fallo al Confirmar</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. CLARIFICATION REQUIRED CARD
  if (requires_clarification) {
    const clarifPayload = payload as ChatClarificationRequiredPayload;

    return (
      <div className="my-2 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/20 text-foreground space-y-3 shadow-sm">
        <div className="flex items-center gap-2 font-bold text-sm text-amber-600 dark:text-amber-400">
          <HelpCircle size={18} />
          <span>Aclaración Requerida</span>
        </div>

        <p className="text-xs font-medium text-foreground">{clarifPayload.clarification_question}</p>

        {clarifPayload.suggested_options && clarifPayload.suggested_options.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {clarifPayload.suggested_options.map((opt, idx) => (
              <button
                key={idx}
                onClick={() => onSelectOption && onSelectOption(opt)}
                className="px-3 py-1.5 rounded-lg bg-card hover:bg-muted border border-border text-xs font-semibold text-foreground shadow-xs transition-colors"
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 3. QUERY_INBOX RESULT CARD
  if (intent === 'QUERY_INBOX') {
    const inboxPayload = payload as ChatInboxQueryPayload;
    const items = (inboxPayload.items || []) as Array<Record<string, unknown>>;
    const totalCount = inboxPayload.total_count ?? items.length;

    return (
      <div className="my-2 p-4 rounded-xl border border-border bg-card text-foreground space-y-3 shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
          <div className="flex items-center gap-2 font-bold text-sm text-foreground">
            <Inbox size={18} className="text-primary" />
            <span>Bandeja de Gestión (Admin Inbox)</span>
          </div>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            Total: {totalCount}
          </span>
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-1">
            No hay pendientes para mostrar en este momento.
          </p>
        ) : (
          <div className="space-y-2">
            {items.slice(0, 5).map((item, idx) => {
              const title = String(item.title || item.human_summary || 'Pendiente');
              const summary = String(item.summary || '');
              const priority = String(item.priority || '');
              const sourceType = String(item.source_type || '');

              return (
                <div
                  key={idx}
                  className="p-2.5 rounded-lg bg-muted/40 border border-border/60 flex items-start justify-between gap-3 text-xs"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground truncate">{title}</span>
                      {priority && (
                        <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-primary/10 text-primary">
                          {priority}
                        </span>
                      )}
                    </div>
                    {summary && <p className="text-muted-foreground text-[11px] line-clamp-2">{summary}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="pt-1 flex items-center justify-end">
          <Link
            href="/admin/inbox"
            className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
          >
            <span>Ver todo en Bandeja</span>
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  // 4. RUN_CAPABILITY / CAPABILITY EXECUTION RESULT CARD
  if (intent === 'RUN_CAPABILITY' || intent === 'CONFIRM_ACTION' || intent === 'CANCEL_CONFIRMATION') {
    const capPayload = payload as ChatCapabilityExecutionPayload;
    const name = capPayload.capability_name || 'Tarea de Gestión';
    const humanName = getCapabilityHumanLabel(name);
    const summary = capPayload.summary || 'Ejecución completada';

    return (
      <div className="my-2 p-4 rounded-xl border border-border bg-card text-foreground space-y-2 shadow-sm">
        <div className="flex items-center gap-2.5 border-b border-border pb-2">
          {getCapabilityIcon(name)}
          <div>
            <h4 className="font-bold text-xs text-foreground">{humanName}</h4>
            {capPayload.status && (
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                Estado: {capPayload.status}
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground pt-1">{summary}</p>
      </div>
    );
  }

  // 5. ERROR PAYLOAD ENVELOPE
  if ('error_code' in (payload as unknown as Record<string, unknown>)) {
    const errPayload = payload as ChatErrorPayload;
    return (
      <div className="my-2 p-3 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-xs space-y-1">
        <div className="flex items-center gap-1.5 font-bold">
          <AlertTriangle size={15} />
          <span>Error de Asistente ({errPayload.error_code})</span>
        </div>
        <p>{errPayload.message}</p>
      </div>
    );
  }

  return null;
};
