'use client';

import React from 'react';
import { CommunicationIntentInboxDetail } from '@/types/inbox';
import { MessageSquare, CheckCircle2, Ban, Calendar, ShieldCheck } from 'lucide-react';

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
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            Asunto: {detail.subject_type}
          </span>
          {detail.requires_approval && (
            <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center gap-1 border border-amber-500/20">
              <ShieldCheck className="w-3 h-3" /> Requiere aprobación previa
            </span>
          )}
        </div>
        <h2 className="text-xl font-bold text-foreground">
          Intención: {detail.action_type}
        </h2>
      </div>

      {/* Reference & Details Card */}
      <div className="p-4 rounded-xl border border-border bg-card space-y-3">
        {detail.subject_reference && (
          <div>
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-0.5">
              Referencia del Asunto
            </span>
            <span className="text-sm font-semibold text-foreground font-mono bg-muted/50 px-2 py-1 rounded">
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

      {/* ADR-040 Mandatory Clarification Notice */}
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

            <button
              onClick={onApprove}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 transition-colors shadow-sm min-h-[44px]"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Autorizar / Aprobar</span>
            </button>
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
