'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Sparkles } from 'lucide-react';

interface ChatComposerProps {
  onSend: (message: string) => void;
  isSending: boolean;
  disabled?: boolean;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  onSend,
  isSending,
  disabled = false,
}) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [text]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = text.trim();
    if (!clean || isSending || disabled) return;
    onSend(clean);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Desktop: Enter sends message, Shift+Enter adds newline
    // Mobile: Shift+Enter or Enter adds newline (send button sends)
    if (e.key === 'Enter' && !e.shiftKey) {
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
      if (!isMobile) {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 md:p-4 bg-card border-t border-border rounded-b-2xl shadow-sm"
    >
      <div className="relative flex items-end gap-2 bg-muted/40 border border-border focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 rounded-xl p-2 transition-all">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isSending ? 'Procesando respuesta...' : 'Escribí tu mensaje o consulta... (Shift+Enter para salto de línea)'}
          disabled={isSending || disabled}
          maxLength={4000}
          rows={1}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none resize-none min-h-[40px] max-h-[160px] py-2 px-2 disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={!text.trim() || isSending || disabled}
          aria-label="Enviar mensaje"
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary text-primary-foreground font-bold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0 mb-0.5 shadow-sm"
        >
          {isSending ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Send size={18} />
          )}
        </button>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-2 px-1">
        <span className="flex items-center gap-1">
          <Sparkles size={12} className="text-primary" />
          Respuesta generada por el Asistente ACIACAM
        </span>
        {text.length > 3000 && (
          <span className={text.length > 3900 ? 'text-destructive font-bold' : ''}>
            {text.length} / 4000
          </span>
        )}
      </div>
    </form>
  );
};
