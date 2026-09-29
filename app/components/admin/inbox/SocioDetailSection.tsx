'use client';

import React from 'react';
import { SocioSummaryDTO } from '@/types/inbox';
import { formatSocioName, formatDniMasked } from '@/app/lib/socio-format';
import { User, CreditCard, Hash } from 'lucide-react';

interface SocioDetailSectionProps {
  socio?: SocioSummaryDTO | null;
}

export function SocioDetailSection({ socio }: SocioDetailSectionProps) {
  if (!socio) {
    return (
      <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-1">
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <User className="w-3.5 h-3.5" /> Socio
        </span>
        <p className="text-xs text-muted-foreground italic">Sin socio asignado a esta tarea</p>
      </div>
    );
  }

  const name = formatSocioName(socio);
  const dni = formatDniMasked(socio.dni_masked);

  return (
    <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-950/20 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
          <User className="w-3.5 h-3.5" /> Socio
        </span>
        {socio.id && (
          <span className="text-[11px] text-muted-foreground font-mono flex items-center gap-1" title={`ID Interno: ${socio.id}`}>
            <Hash className="w-3 h-3 text-muted-foreground/70" />
            <span className="truncate max-w-[140px]">{socio.id}</span>
          </span>
        )}
      </div>

      <div className="space-y-1">
        {name ? (
          <h4 className="text-base font-bold text-foreground tracking-tight">
            {name}
          </h4>
        ) : (
          <h4 className="text-sm font-semibold text-muted-foreground italic">
            Nombre incompleto
          </h4>
        )}

        {dni ? (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
            <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
            <span>{dni}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
