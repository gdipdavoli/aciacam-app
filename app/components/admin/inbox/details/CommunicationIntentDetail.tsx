'use client';

import React from 'react';
import { CommunicationIntentInboxDetail } from '@/types/inbox';
import { CheckCircle2, Ban, Calendar, ShieldCheck, Mail, MessageSquare, AlertTriangle, Lock, Send } from 'lucide-react';

interface CommunicationIntentDetailProps {
  detail: CommunicationIntentInboxDetail;
  isAdmin: boolean;
  onApprove: () => void;
  onCancel: () => void;
}

function formatDateLocal(isoString?: string | null): string {
  if (!isoString) return '-';
  try {
    return new Date(isoString).toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    return isoString;
  }
}

export function CommunicationIntentDetail({
  detail,
  isAdmin,
  onApprove,
  onCancel,
}: CommunicationIntentDetailProps) {
  const isPrepared = detail.prepared === true;

  const renderChannelBadge = () => {
    const channel = (detail.channel || '').toUpperCase();
    if (channel === 'EMAIL') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
          <Mail className="w-3.5 h-3.5" /> EMAIL
        </span>
      );
    }
    if (channel === 'WHATSAPP') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <MessageSquare className="w-3.5 h-3.5" /> WHATSAPP
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
        <Send className="w-3.5 h-3.5" /> {detail.channel || detail.subject_type || 'COMUNICACIÓN'}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header Badges */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {renderChannelBadge()}
          {detail.requires_approval && (
            <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center gap-1 border border-amber-500/20">
              <ShieldCheck className="w-3.5 h-3.5" /> Requiere aprobación previa
            </span>
          )}
        </div>
        <h2 className="text-xl font-bold text-foreground">
          {detail.subject || detail.action_type || 'Intención de comunicación'}
        </h2>
      </div>

      {/* Main Prepared Content Section */}
      {isPrepared ? (
        <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-4">
          <div className="flex items-center justify-between border-b border-primary/20 pb-2">
            <span className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
              <Send className="w-4 h-4" /> Comunicación a enviar
            </span>
            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              Contenido Preparado
            </span>
          </div>

          {/* Recipient */}
          {detail.recipient && (
            <div className="space-y-1">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                Destinatario
              </span>
              <span className="text-sm font-semibold text-foreground font-mono bg-card px-3 py-1.5 rounded-lg border border-border inline-block break-all">
                {detail.recipient}
              </span>
            </div>
          )}

          {/* Subject */}
          {detail.subject && (
            <div className="space-y-1">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                Asunto
              </span>
              <div className="text-sm font-bold text-foreground bg-card p-3 rounded-lg border border-border">
                {detail.subject}
              </div>
            </div>
          )}

          {/* Full Body Text */}
          {detail.body_text && (
            <div className="space-y-1">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                Mensaje Completo
              </span>
              <div className="p-3.5 rounded-lg bg-card border border-border text-sm text-foreground whitespace-pre-wrap break-words max-h-64 overflow-y-auto leading-relaxed shadow-inner">
                {detail.body_text}
              </div>
            </div>
          )}

          {/* Secondary Technical Metadata */}
          {(detail.template_id || detail.template_version || detail.approved_preparation_hash) && (
            <div className="pt-3 border-t border-border/60 text-xs text-muted-foreground space-y-1 font-mono bg-muted/20 p-2.5 rounded-lg">
              {detail.template_id && (
                <div className="flex items-center justify-between">
                  <span>Plantilla:</span>
                  <span className="font-semibold text-foreground">{detail.template_id} {detail.template_version ? `(v${detail.template_version})` : ''}</span>
                </div>
              )}
              {detail.approved_preparation_hash && (
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0">Hash preparación:</span>
                  <span className="font-semibold text-foreground truncate max-w-[220px]" title={detail.approved_preparation_hash}>
                    {detail.approved_preparation_hash}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Legacy Unprepared Notice */
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 space-y-2">
          <div className="flex items-center gap-2 font-bold text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>Comunicación histórica sin contenido preparado</span>
          </div>
          <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            Esta intención no contiene un mensaje preparado y no puede autorizarse para envío.
          </p>
        </div>
      )}

      {/* Subject Reference & Registration Date */}
      <div className="p-4 rounded-xl border border-border bg-card space-y-3">
        {detail.subject_reference && (
          <div>
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-0.5">
              Referencia del Asunto
            </span>
            <span className="text-xs font-semibold text-foreground font-mono bg-muted/50 px-2 py-1 rounded break-all">
              {detail.subject_reference}
            </span>
          </div>
        )}

        <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" /> Fecha de Registro
          </span>
          <span className="font-semibold text-foreground">
            {formatDateLocal(detail.created_at)}
          </span>
        </div>
      </div>

      {/* ADR-040 Domain Notice */}
      <div className="p-3 text-xs text-muted-foreground bg-muted/30 border border-border rounded-xl">
        💡 <strong>Nota de Dominio (ADR-040):</strong> Aprobar autoriza la intención de
        comunicación. El envío se ejecutará por el flujo de entrega correspondiente y no
        genera un envío inmediato ni directo desde esta pantalla.
      </div>

      {/* Actions (Admin ONLY) */}
      {isAdmin ? (
        <div className="space-y-2 pt-2 border-t border-border">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Acciones Administrativas
          </span>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <button
              onClick={onCancel}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 transition-colors min-h-[44px]"
            >
              <Ban className="w-4 h-4" />
              <span>Cancelar Intención</span>
            </button>

            {isPrepared ? (
              <button
                onClick={onApprove}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 transition-colors shadow-sm min-h-[44px]"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Autorizar / Aprobar</span>
              </button>
            ) : (
              <button
                disabled
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-muted text-muted-foreground border border-border cursor-not-allowed opacity-60 min-h-[44px]"
                title="Esta intención no contiene un mensaje preparado y no puede autorizarse para envío."
              >
                <Lock className="w-4 h-4" />
                <span>No disponible para envío</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="p-3 text-xs text-muted-foreground bg-muted/40 rounded-xl border border-border">
          Vista de lectura (Staff). Las acciones de autorización/cancelación están reservadas para administradores.
        </div>
      )}
    </div>
  );
}
