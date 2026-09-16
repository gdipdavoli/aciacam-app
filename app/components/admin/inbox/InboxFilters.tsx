'use client';

import React from 'react';
import { InboxCategoryFilter, InboxPriorityFilter } from '@/types/inbox';
import { Filter } from 'lucide-react';

interface InboxFiltersProps {
  selectedCategory: InboxCategoryFilter;
  onSelectCategory: (cat: InboxCategoryFilter) => void;
  selectedPriority: InboxPriorityFilter;
  onSelectPriority: (prio: InboxPriorityFilter) => void;
  userRole: string;
}

export function InboxFilters({
  selectedCategory,
  onSelectCategory,
  selectedPriority,
  onSelectPriority,
  userRole,
}: InboxFiltersProps) {
  const isAdmin = userRole.toLowerCase() === 'admin';

  const categoryTabs: { id: InboxCategoryFilter; label: string }[] = [
    { id: 'ALL', label: 'Todos' },
    ...(isAdmin
      ? [
          { id: 'AUDIT' as InboxCategoryFilter, label: 'Auditoría' },
          { id: 'FINANCIAL' as InboxCategoryFilter, label: 'Finanzas' },
        ]
      : []),
    { id: 'DOCUMENT' as InboxCategoryFilter, label: 'Documentación' },
    { id: 'COMMUNICATION' as InboxCategoryFilter, label: 'Comunicaciones' },
  ];

  const priorities: { id: InboxPriorityFilter; label: string }[] = [
    { id: 'ALL', label: 'Todas las prioridades' },
    { id: 'CRITICAL', label: 'Crítica' },
    { id: 'HIGH', label: 'Alta' },
    { id: 'MEDIUM', label: 'Media' },
    { id: 'LOW', label: 'Baja' },
  ];

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2">
      {/* Scrollable Horizontal Category Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 no-scrollbar">
        {categoryTabs.map((tab) => {
          const isActive = selectedCategory === tab.id;
          return (
            <button
              key={tab.label}
              onClick={() => onSelectCategory(tab.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors min-h-[36px] ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-card text-muted-foreground border border-border hover:bg-muted hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Priority Dropdown */}
      <div className="flex items-center gap-2 self-start md:self-auto">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <select
          value={selectedPriority || 'ALL'}
          onChange={(e) =>
            onSelectPriority(e.target.value as InboxPriorityFilter)
          }
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-card border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer min-h-[36px]"
        >
          {priorities.map((prio) => (
            <option key={prio.label} value={prio.id || 'ALL'}>
              {prio.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
