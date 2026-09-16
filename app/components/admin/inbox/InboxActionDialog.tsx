'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, X, AlertCircle } from 'lucide-react';

interface InboxActionDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: 'primary' | 'destructive' | 'success';
  requiresNote?: boolean;
  noteMinLength?: number;
  notePlaceholder?: string;
  onConfirm: (note: string) => Promise<void>;
  onClose: () => void;
}

export function InboxActionDialog({
  isOpen,
  title,
  description,
  confirmLabel,
  confirmVariant = 'primary',
  requiresNote = false,
  noteMinLength = 0,
  notePlaceholder = 'Escribe un comentario u observación opcional...',
  onConfirm,
  onClose,
}: InboxActionDialogProps) {
  const [note, setNote] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setNote('');
      setErrorMsg(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNote = note.trim();

    if (requiresNote && cleanNote.length < noteMinLength) {
      setErrorMsg(
        `Se requiere una nota explicativa de al menos ${noteMinLength} caracteres.`
      );
      return;
    }

    if (cleanNote.length > 500) {
      setErrorMsg('La nota no puede exceder los 500 caracteres.');
      return;
    }

    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      await onConfirm(cleanNote);
      onClose();
    } catch (err: unknown) {
      // Error handled by parent toast
    } finally {
      setIsSubmitting(false);
    }
  };

  const getButtonClass = () => {
    switch (confirmVariant) {
      case 'destructive':
        return 'bg-destructive text-destructive-foreground hover:bg-destructive/90';
      case 'success':
        return 'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500';
      case 'primary':
      default:
        return 'bg-primary text-primary-foreground hover:bg-primary/90';
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="action-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-xl overflow-hidden text-foreground">
        {/* Dialog Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 id="action-dialog-title" className="text-lg font-bold">
            {title}
          </h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar diálogo"
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Dialog Content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground flex justify-between">
              <span>
                Nota explicativa{' '}
                {requiresNote ? '(Requerida)' : '(Opcional)'}
              </span>
              <span className="text-muted-foreground font-normal">
                {note.length} / 500
              </span>
            </label>
            <textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder={notePlaceholder}
              maxLength={500}
              rows={3}
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground resize-none disabled:opacity-50"
            />
          </div>

          {errorMsg && (
            <div className="flex items-center gap-2 p-3 text-xs font-medium bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Dialog Footer */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-card border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50 min-h-[44px]"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className={`inline-flex items-center justify-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 min-h-[44px] ${getButtonClass()}`}
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{confirmLabel}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
