'use client';

import React from 'react';
import { RefreshCw, Inbox } from 'lucide-react';

interface InboxHeaderProps {
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function InboxHeader({ onRefresh, isRefreshing }: InboxHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
          <Inbox className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Bandeja
          </h1>
          <p className="text-sm text-muted-foreground">
            Elementos que requieren tu atención.
          </p>
        </div>
      </div>

      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors rounded-lg bg-card border border-border hover:bg-muted text-foreground disabled:opacity-50 disabled:pointer-events-none shadow-sm min-h-[44px]"
      >
        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        <span>Actualizar</span>
      </button>
    </div>
  );
}
