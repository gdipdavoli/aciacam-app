'use client';

import React from 'react';
import { AdminInboxItem, AdminInboxPriority, AdminInboxCategory } from '@/types/inbox';
import { formatSocioDisplay, getStatusLabel } from '@/app/lib/socio-format';
import { ShieldAlert, AlertTriangle, Info, Clock, ChevronRight, User } from 'lucide-react';

interface InboxItemCardProps {
  item: AdminInboxItem;
  isSelected: boolean;
  onSelect: () => void;
}

function formatDateLocal(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    return isoString;
  }
}

export function InboxItemCard({ item, isSelected, onSelect }: InboxItemCardProps) {
  const getPriorityConfig = (priority: AdminInboxPriority) => {
    switch (priority) {
      case 'CRITICAL':
        return {
          label: 'Crítica',
          icon: ShieldAlert,
          className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
        };
      case 'HIGH':
        return {
          label: 'Alta',
          icon: AlertTriangle,
          className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
        };
      case 'MEDIUM':
        return {
          label: 'Media',
          icon: Info,
          className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
        };
      case 'LOW':
      default:
        return {
          label: 'Baja',
          icon: Clock,
          className: 'bg-muted text-muted-foreground border-border',
        };
    }
  };

  const getCategoryLabel = (category: AdminInboxCategory): string => {
    switch (category) {
      case 'AUDIT':
        return 'Auditoría';
      case 'FINANCIAL':
        return 'Finanzas';
      case 'DOCUMENT':
        return 'Documentación';
      case 'COMMUNICATION':
        return 'Comunicaciones';
      default:
        return category;
    }
  };

  const getStatusBadgeStyle = (status?: string): string => {
    if (!status) return 'bg-muted text-muted-foreground';
    const s = status.toUpperCase();
    switch (s) {
      case 'IN_REVIEW':
        return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20';
      case 'APPROVED':
      case 'SENT':
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20';
      case 'DELIVERING':
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20';
      case 'FAILED':
        return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20';
      case 'AWAITING_APPROVAL':
      case 'PENDING':
      default:
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20';
    }
  };

  const prio = getPriorityConfig(item.priority);
  const PrioIcon = prio.icon;
  const socioDisplay = formatSocioDisplay(item.socio);

  return (
    <div
      onClick={onSelect}
      className={`group flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer min-h-[72px] ${
        isSelected
          ? 'bg-card border-primary ring-2 ring-primary/20 shadow-md'
          : 'bg-card border-border hover:border-primary/40 hover:bg-muted/40'
      }`}
    >
      <div className="flex flex-col gap-1.5 flex-1 pr-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Priority Badge */}
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-md border ${prio.className}`}
          >
            <PrioIcon className="w-3 h-3" />
            <span>{prio.label}</span>
          </span>

          {/* Category Badge */}
          <span className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-muted text-muted-foreground">
            {getCategoryLabel(item.category)}
          </span>

          {/* Status Indicator */}
          <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-md ${getStatusBadgeStyle(item.status)}`}>
            {getStatusLabel(item.status)}
          </span>

          {/* Timestamp */}
          <span className="text-[11px] text-muted-foreground ml-auto">
            {formatDateLocal(item.created_at)}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
          {item.title}
        </h3>

        {/* Socio Badge (if present) */}
        {socioDisplay && (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-md w-fit">
            <User className="w-3.5 h-3.5 shrink-0" />
            <span>{socioDisplay}</span>
          </div>
        )}

        {/* Summary (if present) */}
        {item.summary && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {item.summary}
          </p>
        )}
      </div>

      <div className="text-muted-foreground group-hover:text-primary transition-colors pl-2">
        <ChevronRight className="w-5 h-5" />
      </div>
    </div>
  );
}

