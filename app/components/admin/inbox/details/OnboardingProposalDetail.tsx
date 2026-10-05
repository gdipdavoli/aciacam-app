'use client';

import React from 'react';
import { OnboardingProposalInboxDetail } from '@/types/inbox';
import { User, FileText, Activity, ShieldCheck, CheckCircle2, XCircle, Mail, AlertTriangle, Clock } from 'lucide-react';

interface OnboardingProposalDetailProps {
  detail: OnboardingProposalInboxDetail;
  isAdmin: boolean;
  onApprove: () => void;
  onReject: () => void;
  onApply?: () => void;
  onInvite?: () => void;
  isInviteDisabled?: boolean;
}

export function OnboardingProposalDetail({
  detail,
  isAdmin,
  onApprove,
  onReject,
  onApply,
  onInvite,
  isInviteDisabled = true, // Fail-closed default for Checkpoint 4
}: OnboardingProposalDetailProps) {
  const isAwaitingReview = detail.status === 'AWAITING_REVIEW';
  const isApproved = detail.status === 'APPROVED';
  const isReadyForInvitation = detail.status === 'READY_FOR_INVITATION';
  const isInviting = detail.status === 'INVITING';
  const isInviteFailed = detail.status === 'INVITE_FAILED';
  const isCompleted = detail.status === 'COMPLETED';

  const identidad = detail.identidad_administrativo || {};
  const reprocann = detail.reprocann || {};
  const clinico = detail.clinico_inicial || {};
  const documentos = detail.documentos || {};

  return (
    <div className="space-y-6 text-foreground">
      {/* Estado y Test Mode Header */}
      <div className="flex items-center justify-between p-3.5 bg-muted/40 rounded-xl border border-border">
        <div className="space-y-0.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Estado de Propuesta
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                detail.status === 'AWAITING_REVIEW'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                  : detail.status === 'APPROVED'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : detail.status === 'READY_FOR_INVITATION'
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                  : detail.status === 'INVITING'
                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                  : detail.status === 'INVITE_FAILED'
                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300'
                  : detail.status === 'COMPLETED'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : detail.status === 'REJECTED'
                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {isCompleted ? 'Invitación procesada' : isInviting ? 'Invitación en proceso' : isReadyForInvitation ? 'Listo para invitación' : detail.status}
            </span>
            {detail.test_mode && (
              <span className="text-[10px] font-mono px-2 py-0.5 bg-muted rounded text-muted-foreground border border-border">
                TEST_MODE
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Banner de Estado de Invitación */}
      {isInviting && (
        <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 flex items-center gap-3 text-xs font-medium">
          <Clock className="w-4 h-4 animate-spin shrink-0 text-purple-500" />
          <span>Invitación en proceso. Protección contra doble ejecución activa.</span>
        </div>
      )}

      {isInviteFailed && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 flex items-center gap-3 text-xs font-medium">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
          <span>La invitación anterior no pudo completarse. Revisa la causa operacional antes de reintentar.</span>
        </div>
      )}

      {isCompleted && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex items-center gap-3 text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
          <span>Invitación procesada. El vínculo de cuenta ha sido registrado determinísticamente.</span>
        </div>
      )}

      {/* 1. SOLICITANTE */}
      <div className="space-y-3 p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground border-b border-border pb-2">
          <User className="w-4 h-4 text-primary" />
          <span>Solicitante</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-muted-foreground block font-medium">Nombre Completo</span>
            <span className="font-semibold text-foreground">
              {identidad.nombre || '-'} {identidad.apellido || ''}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block font-medium">DNI (Enmascarado)</span>
            <span className="font-mono font-semibold text-foreground">
              {identidad.dni_masked || '-'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block font-medium">Email</span>
            <span className="font-semibold text-foreground select-all">
              {identidad.email || '-'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block font-medium">Teléfono</span>
            <span className="font-semibold text-foreground select-all">
              {identidad.telefono || '-'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. REPROCANN */}
      <div className="space-y-3 p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground border-b border-border pb-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>Datos REPROCANN</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-muted-foreground block font-medium">Nº Trámite</span>
            <span className="font-mono font-semibold text-foreground">
              {reprocann.numero_tramite || 'No especificado'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block font-medium">Tipo</span>
            <span className="font-semibold text-foreground">
              {reprocann.tipo || 'No especificado'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block font-medium">Fecha Alta</span>
            <span className="font-semibold text-foreground">
              {reprocann.fecha_alta || 'No especificado'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block font-medium">Vencimiento</span>
            <span className="font-semibold text-foreground">
              {reprocann.vencimiento || 'No especificado'}
            </span>
          </div>
        </div>
      </div>

      {/* 3. INFORMACIÓN CLÍNICA INICIAL */}
      <div className="space-y-3 p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground border-b border-border pb-2">
          <Activity className="w-4 h-4 text-blue-500" />
          <span>Información Clínica Inicial</span>
        </div>
        <div className="space-y-3 text-xs">
          <div>
            <span className="text-muted-foreground block font-medium">Diagnóstico</span>
            <span className="font-semibold text-foreground leading-relaxed block mt-0.5">
              {clinico.diagnostico || 'No especificado'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/50">
            <div>
              <span className="text-muted-foreground block font-medium">Médico Prescriptor</span>
              <span className="font-semibold text-foreground">
                {clinico.medico_nombre || 'No especificado'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block font-medium">Matrícula</span>
              <span className="font-mono font-semibold text-foreground">
                {clinico.medico_matricula || 'No especificada'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block font-medium">Especialidad</span>
              <span className="font-semibold text-foreground">
                {clinico.medico_especialidad || 'No especificada'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block font-medium">Fecha Firma</span>
              <span className="font-semibold text-foreground">
                {clinico.fecha_firma || 'No especificada'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. DOCUMENTACIÓN ADJUNTA */}
      <div className="space-y-3 p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground border-b border-border pb-2">
          <FileText className="w-4 h-4 text-violet-500" />
          <span>Documentos Adjuntos</span>
        </div>
        <div className="space-y-2 text-xs">
          {Object.keys(documentos).length === 0 ? (
            <span className="text-muted-foreground italic">Sin documentos registrados</span>
          ) : (
            Object.entries(documentos).map(([docType, docData]) => (
              <div
                key={docType}
                className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border border-border/60"
              >
                <div className="font-medium text-foreground capitalize">
                  {docType.replace(/_/g, ' ').toLowerCase()}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-muted text-foreground border border-border">
                    {docData?.extraction_status || 'DESCONOCIDO'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ACCIONES ADMINISTRATIVAS */}
      {isAdmin && isAwaitingReview && (
        <div className="pt-4 border-t border-border flex items-center justify-end gap-3">
          <button
            onClick={onReject}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 transition-colors min-h-[44px]"
          >
            <XCircle className="w-4 h-4" />
            <span>Rechazar propuesta</span>
          </button>

          <button
            onClick={onApprove}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors min-h-[44px]"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Aprobar propuesta</span>
          </button>
        </div>
      )}

      {isAdmin && isApproved && onApply && (
        <div className="pt-4 border-t border-border flex items-center justify-end gap-3">
          <button
            onClick={onApply}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors min-h-[44px]"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Aplicar alta</span>
          </button>
        </div>
      )}

      {isAdmin && (isReadyForInvitation || isInviteFailed || isInviting) && (
        <div className="pt-4 border-t border-border flex flex-col items-end gap-2">
          {isInviteDisabled && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Ejecución productiva de invitaciones bloqueada (Kill Switch OFF).
            </span>
          )}
          <button
            onClick={onInvite}
            disabled={isInviteDisabled || isInviting}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            <Mail className="w-4 h-4" />
            <span>
              {isInviting
                ? 'Invitación en proceso'
                : isInviteFailed
                ? 'Reintentar invitación'
                : 'Invitar socio'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
