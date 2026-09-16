'use client';

import React from 'react';
import { AuditFindingInboxDetail } from '@/types/inbox';
import { ShieldAlert, Calendar, Info, CheckCircle2, Eye, Trash2 } from 'lucide-react';

interface AuditFindingDetailProps {
  detail: AuditFindingInboxDetail;
  isAdmin: boolean;
  onMarkInReview: () => void;
  onResolve: () => void;
  onDismiss: () => void;
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

export function AuditFindingDetail({
  detail,
  isAdmin,
  onMarkInReview,
  onResolve,
  onDismiss,
}: AuditFindingDetailProps) {
  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
            Severidad: {detail.severity}
          </span>
          <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-muted text-muted-foreground">
            Dominio: {detail.domain}
          </span>
        </div>
        <h2 className="text-xl font-bold text-foreground leading-snug">
          {detail.title}
        </h2>
      </div>

      {/* Description */}
      {detail.description && (
        <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-1">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Descripción del Hallazgo
          </span>
          <p className="text-sm text-foreground leading-relaxed">
            {detail.description}
          </p>
        </div>
      )}

      {/* Suggested Action */}
      {detail.suggested_action && (
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 space-y-1">
          <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
            <Info className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider">
              Acción Sugerida del Sistema
            </span>
          </div>
          <p className="text-sm text-foreground font-medium">
            {detail.suggested_action}
          </p>
        </div>
      )}

      {/* Timeline Metadata */}
      <div className="grid grid-cols-2 gap-3 p-4 rounded-xl border border-border bg-card">
        <div>
          <span className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <Calendar className="w-3.5 h-3.5" /> Primera Detección
          </span>
          <span className="text-xs font-semibold text-foreground">
            {formatDateLocal(detail.detected_at)}
          </span>
        </div>
        <div>
          <span className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <Calendar className="w-3.5 h-3.5" /> Última Re-detección
          </span>
          <span className="text-xs font-semibold text-foreground">
            {formatDateLocal(detail.last_seen_at)}
          </span>
        </div>
      </div>

      {/* Domain Clarification Notice */}
      <div className="p-3 text-xs text-muted-foreground bg-muted/30 border border-border rounded-xl">
        💡 <strong>Nota de Dominio:</strong> Esta acción registra la revisión del
        hallazgo. No modifica automáticamente los datos relacionados de stock, pedidos o pagos.
      </div>

      {/* Actions (Admin ONLY) */}
      {isAdmin ? (
        <div className="space-y-2 pt-2 border-t border-border">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Acciones Administrativas
          </span>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {detail.status === 'OPEN' && (
              <button
                onClick={onMarkInReview}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-card border border-border text-foreground hover:bg-muted transition-colors min-h-[44px]"
              >
                <Eye className="w-4 h-4 text-indigo-500" />
                <span>Marcar en revisión</span>
              </button>
            )}

            <button
              onClick={onResolve}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 transition-colors shadow-sm min-h-[44px]"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Resolver</span>
            </button>

            <button
              onClick={onDismiss}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 transition-colors min-h-[44px]"
            >
              <Trash2 className="w-4 h-4" />
              <span>Descartar</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3 text-xs text-amber-600 bg-amber-500/10 rounded-xl border border-amber-500/20">
          Se requiere rol de administrador para realizar acciones sobre hallazgos.
        </div>
      )}
    </div>
  );
}
