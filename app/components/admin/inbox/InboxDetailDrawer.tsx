'use client';

import React, { useEffect, useState } from 'react';
import {
  AdminInboxItem,
  AuditFindingInboxDetail,
  ProfileProposalInboxDetail,
  CommunicationIntentInboxDetail,
} from '@/types/inbox';
import { fetchInboxDetail } from '@/app/lib/inbox-client';
import { AuditFindingDetail } from './details/AuditFindingDetail';
import { ProfileProposalDetail } from './details/ProfileProposalDetail';
import { CommunicationIntentDetail } from './details/CommunicationIntentDetail';
import { X, Loader2, AlertCircle } from 'lucide-react';

interface InboxDetailDrawerProps {
  item: AdminInboxItem | null;
  userRole: string;
  onClose: () => void;
  onRequestAction: (actionType: string, item: AdminInboxItem, detail: unknown) => void;
}

export function InboxDetailDrawer({
  item,
  userRole,
  onClose,
  onRequestAction,
}: InboxDetailDrawerProps) {
  const [detail, setDetail] = useState<
    | AuditFindingInboxDetail
    | ProfileProposalInboxDetail
    | CommunicationIntentInboxDetail
    | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isAdmin = userRole.toLowerCase() === 'admin';

  useEffect(() => {
    if (!item) {
      setDetail(null);
      setErrorMsg(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setErrorMsg(null);

    fetchInboxDetail(item.source_type, item.source_id)
      .then((data) => {
        if (isMounted) {
          setDetail(data);
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          const apiErr = err as { detail?: string; message?: string };
          setErrorMsg(
            apiErr?.detail ||
              apiErr?.message ||
              'No se pudo cargar el detalle del elemento.'
          );
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [item]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && item) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
      className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-xs animate-in fade-in duration-200"
    >
      {/* Backdrop click */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Drawer Container */}
      <div className="relative w-full max-w-xl h-full bg-card border-l border-border shadow-2xl flex flex-col z-10 text-foreground overflow-hidden">
        {/* Drawer Header */}
        <div className="flex items-center justify-between p-5 border-b border-border bg-card">
          <div className="space-y-1">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Detalle de Trabajo
            </span>
            <h3 id="drawer-title" className="text-base font-bold line-clamp-1">
              {item.title}
            </h3>
          </div>

          <button
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Content Area */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-xs font-medium">Cargando detalle...</span>
            </div>
          ) : errorMsg ? (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-3 text-sm font-medium">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          ) : detail ? (
            <>
              {(item.source_type === 'audit_finding' || item.source_type === 'audit_findings') && (
                <AuditFindingDetail
                  detail={detail as AuditFindingInboxDetail}
                  isAdmin={isAdmin}
                  onMarkInReview={() =>
                    onRequestAction('audit_mark_in_review', item, detail)
                  }
                  onResolve={() =>
                    onRequestAction('audit_resolve', item, detail)
                  }
                  onDismiss={() =>
                    onRequestAction('audit_dismiss', item, detail)
                  }
                />
              )}

              {(item.source_type === 'profile_proposal' || item.source_type === 'profile_update_proposals') && (
                <ProfileProposalDetail
                  detail={detail as ProfileProposalInboxDetail}
                  isAdmin={isAdmin}
                  onApprove={() =>
                    onRequestAction('proposal_approve', item, detail)
                  }
                  onReject={() =>
                    onRequestAction('proposal_reject', item, detail)
                  }
                  onCancel={() =>
                    onRequestAction('proposal_cancel', item, detail)
                  }
                />
              )}

              {(item.source_type === 'communication_intent' || item.source_type === 'communication_intents') && (
                <CommunicationIntentDetail
                  detail={detail as CommunicationIntentInboxDetail}
                  isAdmin={isAdmin}
                  onApprove={() =>
                    onRequestAction('communication_approve', item, detail)
                  }
                  onCancel={() =>
                    onRequestAction('communication_cancel', item, detail)
                  }
                />
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
