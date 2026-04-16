"use client";

import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { MessageCircle, X, Send, Bot, User, ChevronDown, Sparkles } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export function ChatWidget() {
    const [isOpen, setIsOpen] = useState(false);
    const { session } = useAuth();
    const scrollRef = useRef<HTMLDivElement>(null);

    const chat = useChat({
        api: '/api/chat',
        headers: {
            Authorization: `Bearer ${session?.access_token}`,
        },
        initialMessages: [
            {
                id: 'welcome',
                role: 'assistant',
                content: '¡Hola! Soy Cogollito, tu asistente de ACIACAM. ¿En qué puedo ayudarte hoy?',
            },
        ],
    } as any) as any;

    const { messages, input, handleInputChange, handleSubmit, isLoading } = chat;

    // Auto-scroll to bottom when messages change
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isOpen]);

    if (!session) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
            {/* Chat Window */}
            {isOpen && (
                <div className="mb-4 w-80 sm:w-96 h-[500px] bg-card border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
                    {/* Header */}
                    <div className="p-4 bg-primary text-primary-foreground flex items-center justify-between shadow-md">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
                                <Bot size={22} className="text-white" />
                            </div>
                            <div>
                                <h3 className="font-bold text-sm tracking-wide">Cogollito AI</h3>
                                <div className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                                    <span className="text-[10px] opacity-80 uppercase font-semibold">En línea</span>
                                </div>
                            </div>
                        </div>
                        <button 
                            onClick={() => setIsOpen(false)}
                            className="p-1.5 hover:bg-white/10 rounded-full transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Messages Area */}
                    <div 
                        ref={scrollRef}
                        className="flex-1 overflow-y-auto p-4 space-y-4 bg-dots-lighter"
                    >
                        {messages.map((m) => (
                            <div 
                                key={m.id} 
                                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div className={`flex gap-2 max-w-[85%] ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                    <div className={`mt-1 p-1 rounded-full h-fit ${m.role === 'user' ? 'bg-primary/10' : 'bg-muted'}`}>
                                        {m.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                                    </div>
                                    <div className={`
                                        p-3 rounded-2xl text-sm shadow-sm
                                        ${m.role === 'user' 
                                            ? 'bg-primary text-primary-foreground rounded-tr-none' 
                                            : 'bg-muted text-foreground rounded-tl-none border'
                                        }
                                    `}>
                                        {m.content}
                                    </div>
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-muted p-3 rounded-2xl rounded-tl-none border animate-pulse">
                                    <div className="flex gap-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-foreground/30 animate-bounce"></div>
                                        <div className="w-1.5 h-1.5 rounded-full bg-foreground/30 animate-bounce delay-75"></div>
                                        <div className="w-1.5 h-1.5 rounded-full bg-foreground/30 animate-bounce delay-150"></div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Input Area */}
                    <form onSubmit={handleSubmit} className="p-4 border-t bg-background">
                        <div className="relative flex items-center">
                            <input
                                placeholder="Pregúntame por tus pedidos..."
                                className="w-full p-3 pr-12 rounded-xl border bg-muted/50 focus:bg-background focus:ring-2 focus:ring-primary/20 transition-all outline-none text-sm"
                                value={input}
                                onChange={handleInputChange}
                            />
                            <button
                                type="submit"
                                disabled={isLoading || !input.trim()}
                                className="absolute right-2 p-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 transition-all shadow-md"
                            >
                                <Send size={16} />
                            </button>
                        </div>
                        <p className="text-[10px] text-center mt-2 text-muted-foreground flex items-center justify-center gap-1">
                            <Sparkles size={10} className="text-primary" />
                            Impulsado por Antigravity AI
                        </p>
                    </form>
                </div>
            )}

            {/* Floating Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    p-4 rounded-full shadow-2xl transition-all duration-300 hover:scale-110 active:scale-90
                    ${isOpen ? 'bg-muted text-foreground rotate-90 scale-0 opacity-0' : 'bg-primary text-primary-foreground'}
                `}
                style={{ display: isOpen ? 'none' : 'flex' }}
            >
                <div className="relative">
                    <MessageCircle size={28} />
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 border-2 border-primary rounded-full"></span>
                </div>
            </button>
        </div>
    );
}
