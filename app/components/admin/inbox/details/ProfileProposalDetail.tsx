'use client';

import React from 'react';
import { ProfileProposalInboxDetail } from '@/types/inbox';
import { FileText, CheckCircle2, XCircle, Ban, Sparkles } from 'lucide-react';

interface ProfileProposalDetailProps {
  detail: ProfileProposalInboxDetail;
  isAdmin: boolean;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
}

function renderScalarValue(val: unknown): string {
  if (val === null || val === undefined) return 'Sin valor';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export function ProfileProposalDetail({
  detail,
  isAdmin,
  onApprove,
  onReject,
  onCancel,
}: ProfileProposalDetailProps) {
  const confidencePercent =
    detail.extraction_confidence !== undefined && detail.extraction_confidence !== null
      ? Math.round(detail.extraction_confidence * 100)
      : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            Campo: {detail.field_name}
          </span>
          <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-muted text-muted-foreground">
            Operación: {detail.operation === 'ADD' ? 'Agregar' : 'Modificar'}
          </span>
        </div>
        <h2 className="text-xl font-bold text-foreground">
          Propuesta para {detail.field_name}
        </h2>
      </div>

      {/* Visual Comparison Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Current Value */}
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Valor Actual
          </span>
          <div className="text-sm font-semibold text-foreground break-words min-h-[24px]">
            {renderScalarValue(detail.current_value)}
          </div>
        </div>

        {/* Proposed Value */}
        <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-1">
          <span className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Valor Propuesto
          </span>
          <div className="text-sm font-bold text-foreground break-words min-h-[24px]">
            {renderScalarValue(detail.proposed_value)}
          </div>
        </div>
      </div>

      {/* Extraction Confidence Bar */}
      {confidencePercent !== null && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-muted-foreground">Confianza de Extracción OCR</span>
            <span className="text-foreground font-bold">{confidencePercent}%</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full transition-all rounded-full ${
                confidencePercent >= 80
                  ? 'bg-emerald-500'
                  : confidencePercent >= 50
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
              }`}
              style={{ width: `${confidencePercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Safe Source Reference */}
      {detail.source_reference && (
        <div className="p-3 text-xs text-muted-foreground bg-muted/40 rounded-xl border border-border">
          <span className="font-semibold text-foreground">Referencia de Origen:</span>{' '}
          {detail.source_reference}
        </div>
      )}

      {/* POL-026 Mandatory Clarification */}
      <div className="p-3 text-xs text-muted-foreground bg-muted/30 border border-border rounded-xl">
        💡 <strong>Nota de Dominio (POL-026):</strong> Aprobar esta propuesta registra
        la decisión de revisión humana. No modifica todavía los datos del perfil del socio.
      </div>

      {/* Actions (Admin ONLY) */}
      {isAdmin ? (
        <div className="space-y-2 pt-2 border-t border-border">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Acciones Administrativas
          </span>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <button
              onClick={onReject}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 transition-colors min-h-[44px]"
            >
              <XCircle className="w-4 h-4" />
              <span>Rechazar</span>
            </button>

            <button
              onClick={onCancel}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-card border border-border text-foreground hover:bg-muted transition-colors min-h-[44px]"
            >
              <Ban className="w-4 h-4 text-muted-foreground" />
              <span>Cancelar</span>
            </button>

            <button
              onClick={onApprove}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 transition-colors shadow-sm min-h-[44px]"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Aprobar</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3 text-xs text-muted-foreground bg-muted/40 rounded-xl border border-border">
          Vista de lectura (Staff). Las acciones de aprobación/rechazo están reservadas para administradores.
        </div>
      )}
    </div>
  );
}
