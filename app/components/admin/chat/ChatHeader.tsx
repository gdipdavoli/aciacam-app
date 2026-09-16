'use client';

import React from 'react';
import { Bot, RotateCcw, ShieldCheck } from 'lucide-react';

interface ChatHeaderProps {
  onReset: () => void;
  messageCount: number;
  userRole?: string;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onReset,
  messageCount,
  userRole,
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 md:p-6 bg-card border-b border-border rounded-t-2xl shadow-sm">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shrink-0">
          <Bot size={24} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg md:text-xl font-bold text-foreground tracking-tight">
              Asistente ACIACAM
            </h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/30">
              <ShieldCheck size={11} />
              {userRole === 'admin' ? 'Administrador' : 'Staff'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Consultá información de gestión y ejecutá acciones controladas.
          </p>
        </div>
      </div>

      {messageCount > 0 && (
        <button
          onClick={onReset}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted border border-border transition-colors"
          title="Limpiar la sesión actual de conversación"
        >
          <RotateCcw size={14} />
          <span>Limpiar conversación</span>
        </button>
      )}
    </div>
  );
};
