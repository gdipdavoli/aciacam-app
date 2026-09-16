'use client';

import React from 'react';
import { AdminInboxItem } from '@/types/inbox';
import { InboxItemCard } from './InboxItemCard';
import { CheckCircle2, Loader2 } from 'lucide-react';

interface InboxListProps {
  items: AdminInboxItem[];
  selectedItem?: AdminInboxItem | null;
  onSelectItem: (item: AdminInboxItem) => void;
  loadingInitial: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

export function InboxList({
  items,
  selectedItem,
  onSelectItem,
  loadingInitial,
  loadingMore,
  hasMore,
  onLoadMore,
}: InboxListProps) {
  if (loadingInitial) {
    return (
      <div className="space-y-3 pt-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="p-4 rounded-xl border border-border bg-card animate-pulse space-y-3 min-h-[72px]"
          >
            <div className="flex items-center gap-2">
              <div className="h-5 w-16 bg-muted rounded-md" />
              <div className="h-5 w-24 bg-muted rounded-md" />
              <div className="h-4 w-20 bg-muted rounded-md ml-auto" />
            </div>
            <div className="h-4 w-3/4 bg-muted rounded" />
            <div className="h-3 w-1/2 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-border rounded-2xl bg-card/50 space-y-3 my-4">
        <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-foreground">Todo al día</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            No hay elementos pendientes que requieran tu atención.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="space-y-2.5">
        {items.map((item) => {
          const itemKey = item.id || `${item.source_type}:${item.source_id}`;
          const isSelected = selectedItem ? (selectedItem.id === item.id || (selectedItem.source_type === item.source_type && selectedItem.source_id === item.source_id)) : false;
          return (
            <InboxItemCard
              key={itemKey}
              item={item}
              isSelected={isSelected}
              onSelect={() => onSelectItem(item)}
            />
          );
        })}
      </div>

      {hasMore && (
        <div className="pt-4 pb-2 flex justify-center">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-xl bg-card border border-border hover:bg-muted text-foreground transition-colors disabled:opacity-50 min-h-[44px] shadow-sm"
          >
            {loadingMore && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
            <span>{loadingMore ? 'Cargando...' : 'Cargar más elementos'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
