'use client';

import React from 'react';
import { Bot, User as UserIcon, AlertTriangle, Loader2 } from 'lucide-react';
import { ChatResponseEnvelope } from '@/types/chat';
import { ChatEnvelopeCard } from './ChatEnvelopeCard';

export interface ChatUiMessage {
  id: string;
  sender: 'user' | 'assistant';
  timestamp: Date;
  text?: string;
  envelope?: ChatResponseEnvelope;
  errorText?: string;
  confirmationState?: 'pending' | 'executing' | 'confirmed' | 'cancelled' | 'expired' | 'failed' | 'dismissed';
}

interface ChatMessageListProps {
  messages: ChatUiMessage[];
  isSending: boolean;
  onConfirm: (msgId: string, token: string) => void;
  onCancel: (msgId: string) => void;
  onSelectOption: (optionText: string) => void;
}

export const ChatMessageList: React.FC<ChatMessageListProps> = ({
  messages,
  isSending,
  onConfirm,
  onCancel,
  onSelectOption,
}) => {
  return (
    <div className="space-y-4">
      {messages.map((msg) => {
        const isUser = msg.sender === 'user';

        return (
          <div
            key={msg.id}
            className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {/* Avatar */}
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border shadow-2xs ${
                isUser
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-foreground border-border'
              }`}
            >
              {isUser ? <UserIcon size={16} /> : <Bot size={16} className="text-primary" />}
            </div>

            {/* Content Container */}
            <div className={`space-y-1 max-w-[88%] sm:max-w-[78%] ${isUser ? 'items-end text-right' : 'items-start text-left'}`}>
              {/* User text bubble */}
              {isUser && msg.text && (
                <div className="inline-block p-3 rounded-2xl bg-primary text-primary-foreground text-xs font-medium leading-relaxed shadow-sm rounded-tr-none whitespace-pre-wrap">
                  {msg.text}
                </div>
              )}

              {/* Assistant message & structured cards */}
              {!isUser && (
                <div className="space-y-2">
                  {/* Human message formatted bubble */}
                  {msg.envelope?.human_message && (
                    <div className="p-3 rounded-2xl bg-card border border-border text-foreground text-xs font-medium leading-relaxed shadow-xs rounded-tl-none whitespace-pre-wrap">
                      {msg.envelope.human_message}
                    </div>
                  )}

                  {/* Fallback raw text if no envelope */}
                  {!msg.envelope && msg.text && (
                    <div className="p-3 rounded-2xl bg-card border border-border text-foreground text-xs font-medium leading-relaxed shadow-xs rounded-tl-none whitespace-pre-wrap">
                      {msg.text}
                    </div>
                  )}

                  {/* Envelope Structured Card */}
                  {msg.envelope && (
                    <ChatEnvelopeCard
                      envelope={msg.envelope}
                      confirmationState={msg.confirmationState || 'pending'}
                      onConfirm={(token) => onConfirm(msg.id, token)}
                      onCancel={() => onCancel(msg.id)}
                      onSelectOption={onSelectOption}
                    />
                  )}

                  {/* Error Card */}
                  {msg.errorText && (
                    <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-xs font-semibold flex items-center gap-2 shadow-xs">
                      <AlertTriangle size={16} className="shrink-0" />
                      <span>{msg.errorText}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Timestamp */}
              <div className="text-[10px] text-muted-foreground px-1">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        );
      })}

      {/* Processing Indicator */}
      {isSending && (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-primary shrink-0 shadow-2xs">
            <Bot size={16} />
          </div>
          <div className="inline-flex items-center gap-2 p-3 rounded-2xl bg-card border border-border text-muted-foreground text-xs font-semibold shadow-xs rounded-tl-none">
            <Loader2 size={14} className="animate-spin text-primary" />
            <span>Procesando solicitud...</span>
          </div>
        </div>
      )}
    </div>
  );
};
