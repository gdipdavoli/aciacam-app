'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Bot, Inbox, CheckCircle2, Coins, ArrowRight } from 'lucide-react';
import { ChatResponseEnvelope } from '@/types/chat';
import { ChatHeader } from './ChatHeader';
import { ChatComposer } from './ChatComposer';
import { ChatMessageList, ChatUiMessage } from './ChatMessageList';

interface ChatContainerProps {
  userRole?: string;
}

const SUGGESTED_PROMPTS = [
  {
    title: 'Bandeja de Pendientes',
    prompt: '¿Qué tengo pendiente en la bandeja?',
    icon: Inbox,
  },
  {
    title: 'Auditoría de Stock',
    prompt: 'Revisá inconsistencias de stock.',
    icon: CheckCircle2,
  },
  {
    title: 'Auditoría de Pagos',
    prompt: 'Auditá pedidos y pagos.',
    icon: Coins,
  },
];

export const ChatContainer: React.FC<ChatContainerProps> = ({ userRole }) => {
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const handleReset = () => {
    setMessages([]);
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isSending) return;

    const userMsgId = `user-${Date.now()}`;
    const newMsg: ChatUiMessage = {
      id: userMsgId,
      sender: 'user',
      timestamp: new Date(),
      text: text.trim(),
    };

    setMessages((prev) => [...prev, newMsg]);
    setIsSending(true);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim() }),
      });

      const data = await res.json();
      const assistantMsgId = `asst-${Date.now()}`;

      if (res.status === 200) {
        const envelope = data as ChatResponseEnvelope;
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            timestamp: new Date(),
            envelope,
            confirmationState: envelope.requires_confirmation ? 'pending' : undefined,
          },
        ]);
      } else if (res.status === 401) {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            timestamp: new Date(),
            errorText: 'Sesión expirada o no autenticada. Iniciá sesión nuevamente.',
          },
        ]);
      } else if (res.status === 403) {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            timestamp: new Date(),
            errorText: 'No tenés permisos para realizar esta acción.',
          },
        ]);
      } else if (res.status === 409) {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            timestamp: new Date(),
            errorText: 'La acción ya fue procesada o el estado cambió desde que se preparó.',
          },
        ]);
      } else if (res.status === 502) {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            timestamp: new Date(),
            errorText: 'El asistente devolvió una respuesta no válida. Intentá nuevamente.',
          },
        ]);
      } else if (res.status === 503) {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            timestamp: new Date(),
            errorText: 'El asistente no está disponible temporalmente.',
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            timestamp: new Date(),
            errorText: 'Ocurrió un error al procesar la solicitud.',
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `asst-err-${Date.now()}`,
          sender: 'assistant',
          timestamp: new Date(),
          errorText: 'El asistente no está disponible temporalmente.',
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleConfirmAction = async (msgId: string, confirmationToken: string) => {
    if (!confirmationToken || isSending) return;

    // Update state to executing
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, confirmationState: 'executing' } : m))
    );
    setIsSending(true);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation_token: confirmationToken }),
      });

      const data = await res.json();
      const assistantMsgId = `asst-conf-res-${Date.now()}`;

      if (res.status === 200) {
        const envelope = data as ChatResponseEnvelope;

        // Mark previous card as confirmed
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, confirmationState: 'confirmed' } : m))
        );

        // Add result message
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            timestamp: new Date(),
            envelope,
          },
        ]);
      } else if (res.status === 400 && data?.payload?.error_code === 'CONFIRMATION_EXPIRED') {
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, confirmationState: 'expired' } : m))
        );
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            timestamp: new Date(),
            errorText: 'La confirmación venció. Volvé a solicitar la acción.',
          },
        ]);
      } else if (res.status === 409) {
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, confirmationState: 'failed' } : m))
        );
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            timestamp: new Date(),
            errorText: 'La acción ya fue procesada o el estado cambió desde que se preparó.',
          },
        ]);
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, confirmationState: 'failed' } : m))
        );
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            timestamp: new Date(),
            errorText: 'Ocurrió un error al procesar la confirmación.',
          },
        ]);
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, confirmationState: 'failed' } : m))
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleCancelAction = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const updatedEnvelope = m.envelope
          ? {
              ...m.envelope,
              payload: {
                ...m.envelope.payload,
                confirmation_token: undefined,
              },
            }
          : m.envelope;
        return {
          ...m,
          envelope: updatedEnvelope as typeof m.envelope,
          confirmationState: 'dismissed',
        };
      })
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] max-w-5xl mx-auto bg-card border border-border rounded-2xl shadow-lg overflow-hidden">
      {/* Header */}
      <ChatHeader
        onReset={handleReset}
        messageCount={messages.length}
        userRole={userRole}
      />

      {/* Main Conversation Body */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 bg-muted/20">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-6 max-w-lg mx-auto">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shadow-xs">
              <Bot size={36} />
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-bold text-foreground tracking-tight">
                ¡Hola! ¿En qué puedo ayudarte hoy?
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Podés consultar pendientes o pedir que ejecute tareas disponibles de gestión interna.
              </p>
            </div>

            {/* Suggested Prompts */}
            <div className="w-full space-y-2 pt-2 text-left">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                Sugerencias de consulta:
              </span>
              <div className="grid grid-cols-1 gap-2">
                {SUGGESTED_PROMPTS.map((promptObj, idx) => {
                  const Icon = promptObj.icon;
                  return (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(promptObj.prompt)}
                      className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-card hover:bg-muted/80 border border-border/80 text-left transition-all hover:shadow-xs group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                          <Icon size={16} />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                            {promptObj.title}
                          </h4>
                          <p className="text-[11px] text-muted-foreground">{promptObj.prompt}</p>
                        </div>
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <ChatMessageList
            messages={messages}
            isSending={isSending}
            onConfirm={handleConfirmAction}
            onCancel={handleCancelAction}
            onSelectOption={handleSendMessage}
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer Footer */}
      <ChatComposer onSend={handleSendMessage} isSending={isSending} />
    </div>
  );
};
