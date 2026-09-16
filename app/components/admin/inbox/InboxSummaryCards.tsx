'use client';

import React from 'react';
import { AdminInboxSummary, InboxCategoryFilter } from '@/types/inbox';
import { ShieldAlert, Coins, FileText, MessageSquare, Inbox } from 'lucide-react';

interface InboxSummaryCardsProps {
  summary: AdminInboxSummary | null;
  selectedCategory: InboxCategoryFilter;
  onSelectCategory: (category: InboxCategoryFilter) => void;
  userRole: string;
}

export function InboxSummaryCards({
  summary,
  selectedCategory,
  onSelectCategory,
  userRole,
}: InboxSummaryCardsProps) {
  const isAdmin = userRole.toLowerCase() === 'admin';

  const cards = [
    {
      id: 'ALL' as InboxCategoryFilter,
      label: 'Todos',
      sublabel: 'Trabajos activos',
      count: summary?.total_pending ?? 0,
      icon: Inbox,
      color: 'text-primary bg-primary/10',
    },
    ...(isAdmin
      ? [
          {
            id: 'AUDIT' as InboxCategoryFilter,
            label: 'Auditoría',
            sublabel: 'Anomalías de datos',
            count: summary?.by_category.audit ?? 0,
            icon: ShieldAlert,
            color: 'text-rose-600 dark:text-rose-400 bg-rose-500/10',
          },
          {
            id: 'FINANCIAL' as InboxCategoryFilter,
            label: 'Finanzas',
            sublabel: 'Pagos y aportes',
            count: summary?.by_category.financial ?? 0,
            icon: Coins,
            color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
          },
        ]
      : []),
    {
      id: 'DOCUMENT' as InboxCategoryFilter,
      label: 'Documentación',
      sublabel: 'Propuestas de perfil',
      count: summary?.by_category.document ?? 0,
      icon: FileText,
      color: 'text-blue-600 dark:text-blue-400 bg-blue-500/10',
    },
    {
      id: 'COMMUNICATION' as InboxCategoryFilter,
      label: 'Comunicaciones',
      sublabel: 'Avisos preventivos',
      count: summary?.by_category.communication ?? 0,
      icon: MessageSquare,
      color: 'text-purple-600 dark:text-purple-400 bg-purple-500/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((card) => {
        const Icon = card.icon;
        const isSelected = selectedCategory === card.id;

        return (
          <button
            key={card.label}
            onClick={() => onSelectCategory(card.id)}
            className={`flex flex-col p-4 rounded-xl border transition-all text-left min-h-[90px] ${
              isSelected
                ? 'bg-card border-primary ring-2 ring-primary/20 shadow-md'
                : 'bg-card border-border hover:border-primary/50 hover:bg-muted/50'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold text-muted-foreground truncate">
                {card.label}
              </span>
              <div className={`p-1.5 rounded-lg ${card.color}`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-extrabold text-foreground">
              {summary ? card.count : '-'}
            </div>
            <span className="text-[11px] text-muted-foreground mt-1 truncate">
              {card.sublabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}
