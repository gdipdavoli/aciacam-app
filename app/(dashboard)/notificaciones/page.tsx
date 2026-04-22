"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { NotificationService } from '@/services/notificationService';
import { StoreService } from '@/services/storeService';
import { Notificacion, EstadoTicket, Pedido } from '@/types';
import { 
    Bell, Check, Clock, Package, MapPin, MessageSquare, 
    Send, ChevronRight, X, Inbox, User, Info, Trash2
} from 'lucide-react';

export default function NotificacionesPage() {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<Notificacion[]>([]);
    const [loading, setLoading] = useState(true);
    
    // UI State
    const [showForm, setShowForm] = useState(false);
    const [notifTitulo, setNotifTitulo] = useState('');
    const [notifMensaje, setNotifMensaje] = useState('');
    const [selectedPedidoId, setSelectedPedidoId] = useState<string>('');
    const [userPedidos, setUserPedidos] = useState<Pedido[]>([]);
    const [isSending, setIsSending] = useState(false);

    // Thread/Case State
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
    const [threadMessages, setThreadMessages] = useState<Notificacion[]>([]);
    const [isReplying, setIsReplying] = useState(false);
    const [replyText, setReplyText] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);

    const fetchNotifications = async () => {
        if (!user) return;
        try {
            const data = await NotificationService.getNotifications({ socioId: user.id });
            setNotifications(data);
        } catch (error) {
            console.error("Error fetching notifications", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchNotifications();
        if (user) {
            StoreService.getPedidosBySocio(user.id).then(data => {
                setUserPedidos(data.filter(p => !p.archivado).slice(0, 5));
            });
        }
    }, [user]);

    useEffect(() => {
        if (selectedThreadId) {
            const messages = notifications.filter(n => 
                n.id === selectedThreadId || n.parentId === selectedThreadId
            ).sort((a, b) => new Date(a.fechaCreacion).getTime() - new Date(b.fechaCreacion).getTime());
            setThreadMessages(messages);
        }
    }, [selectedThreadId, notifications]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [threadMessages]);

    const handleMarkAsRead = async (id: string) => {
        try {
            await NotificationService.markThreadAsRead(id, false);
            setNotifications(prev => prev.map(n => (n.id === id || n.parentId === id) ? { ...n, leido: true } : n));
        } catch (error) {
            console.error("Error marking as read", error);
        }
    };

    const handleDeleteThread = async (id: string) => {
        if (!confirm("¿Estás seguro de que querés eliminar esta conversación? No podrás verla de nuevo, pero administración conservará una copia.")) return;
        try {
            await NotificationService.hideThreadForSocio(id);
            setNotifications(prev => prev.filter(n => n.id !== id && n.parentId !== id));
        } catch (error) {
            console.error("Error hiding thread", error);
            alert("Error al eliminar la conversación");
        }
    };

    const handleSendInitial = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !notifTitulo || !notifMensaje) return;
        setIsSending(true);
        try {
            await NotificationService.sendToAdmin({
                socioId: user.id,
                titulo: notifTitulo,
                mensaje: notifMensaje,
                metadata: selectedPedidoId ? { pedidoId: selectedPedidoId } : undefined
            });
            setShowForm(false);
            setNotifTitulo('');
            setNotifMensaje('');
            setSelectedPedidoId('');
            fetchNotifications();
        } catch (error) {
            alert("Error: " + (error as any).message);
        } finally {
            setIsSending(false);
        }
    };

    const handleReply = async () => {
        if (!replyText || !selectedThreadId || !user) return;
        setIsReplying(true);
        try {
            const root = notifications.find(n => n.id === selectedThreadId);
            await NotificationService.sendToAdmin({
                socioId: user.id,
                parentId: selectedThreadId,
                titulo: root?.titulo || 'Respuesta',
                mensaje: replyText
            });
            setReplyText('');
            fetchNotifications();
        } catch (error) {
            alert("Error al enviar respuesta");
        } finally {
            setIsReplying(false);
        }
    };

    // Grouping Logic: Get only "Root" items for the list
    const rootItems = notifications.filter(n => !n.parentId);

    const getIcon = (type: string, esInformativo?: boolean) => {
        if (esInformativo) return <Info size={20} className="text-primary" />;
        switch (type) {
            case 'delivery': return <MapPin size={20} className="text-primary" />;
            case 'order': return <Package size={20} className="text-blue-500" />;
            case 'socio_message': return <Send size={20} className="text-slate-500" />;
            default: return <Bell size={20} className="text-amber-500" />;
        }
    };

    const getStatusLabel = (status?: EstadoTicket) => {
        switch (status) {
            case 'abierto': return { label: 'Abierto', color: '#ef4444' };
            case 'pendiente': return { label: 'En Espera', color: '#f59e0b' };
            case 'cerrado': return { label: 'Resuelto', color: '#10b981' };
            default: return null;
        }
    };

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '3rem' }}>
            {/* Header */}
            <div style={{ marginBottom: '2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: '1rem' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>Mis Mensajes</h1>
                    <p style={{ color: 'hsl(var(--muted-foreground))' }}>Centro de soporte y avisos de ACIACAM.</p>
                </div>
                <button 
                    onClick={() => setShowForm(!showForm)}
                    style={{ padding: '0.6rem 1.2rem', backgroundColor: showForm ? 'hsl(var(--muted))' : 'hsl(var(--primary))', color: showForm ? 'inherit' : 'white', borderRadius: 'var(--radius)', border: 'none', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                    {showForm ? 'Cancelar' : <><MessageSquare size={18} /> Contactar Soporte</>}
                </button>
            </div>

            {/* Initial Contact Form */}
            {showForm && (
                <div style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--primary) / 0.2)', borderRadius: 'var(--radius)', padding: '1.5rem', marginBottom: '2rem' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>Nueva Consulta</h3>
                    <form onSubmit={handleSendInitial} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <input type="text" required value={notifTitulo} onChange={(e) => setNotifTitulo(e.target.value)} placeholder="Asunto (ej: Duda sobre mi envío)" style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'transparent' }} />
                            
                            <select 
                                value={selectedPedidoId} 
                                onChange={(e) => {
                                    setSelectedPedidoId(e.target.value);
                                    if (e.target.value) setNotifTitulo(`Consulta sobre Pedido #${e.target.value.slice(-6).toUpperCase()}`);
                                }}
                                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'transparent' }}
                            >
                                <option value="">Consulta General (No pedido)</option>
                                {userPedidos.map(p => (
                                    <option key={p.id} value={p.id}>Relacionado al Pedido #{p.id.slice(-6).toUpperCase()}</option>
                                ))}
                            </select>
                        </div>
                        <textarea rows={3} required value={notifMensaje} onChange={(e) => setNotifMensaje(e.target.value)} placeholder="Contanos en qué podemos ayudarte..." style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'transparent' }} />
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button type="submit" disabled={isSending} style={{ padding: '0.6rem 2rem', backgroundColor: 'hsl(var(--primary))', color: 'white', borderRadius: 'var(--radius)', border: 'none', fontWeight: 700, cursor: 'pointer', opacity: isSending ? 0.7 : 1 }}>
                                {isSending ? 'Enviando...' : 'Enviar Consulta'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Notifications List */}
            {loading ? (
                <div style={{ padding: '4rem', textAlign: 'center' }}>Cargando...</div>
            ) : rootItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '5rem 2rem', backgroundColor: 'hsl(var(--card))', borderRadius: 'var(--radius)', border: '1px dashed hsl(var(--border))' }}>
                    <Bell size={48} style={{ margin: '0 auto 1rem', opacity: 0.2 }} />
                    <p style={{ color: 'hsl(var(--muted-foreground))' }}>No tenés mensajes por ahora.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {rootItems.map((item) => {
                        const status = getStatusLabel(item.estado);
                        const isTicket = !item.esInformativo;
                        
                        return (
                            <div 
                                key={item.id} 
                                onClick={() => {
                                    if (isTicket) {
                                        setSelectedThreadId(item.id);
                                        handleMarkAsRead(item.id);
                                    }
                                }}
                                style={{
                                    backgroundColor: item.leido ? 'hsl(var(--card))' : 'hsl(var(--primary) / 0.03)',
                                    border: `1px solid ${item.leido ? 'hsl(var(--border))' : 'hsl(var(--primary) / 0.2)'}`,
                                    borderRadius: 'var(--radius)',
                                    padding: '1.25rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '1.25rem',
                                    cursor: isTicket ? 'pointer' : 'default',
                                    transition: 'transform 0.1s',
                                    position: 'relative',
                                    boxShadow: item.leido ? 'none' : '0 4px 12px -4px hsl(var(--primary) / 0.1)'
                                }}
                            >
                                <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: item.leido ? 'hsl(var(--muted)/0.5)' : 'hsl(var(--primary)/0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    {getIcon(item.tipo, item.esInformativo)}
                                </div>
                                
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                            <h4 style={{ fontWeight: 700, color: item.leido ? 'inherit' : 'hsl(var(--primary))' }}>{item.titulo}</h4>
                                            {status && (
                                                <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '4px', backgroundColor: `${status.color}20`, color: status.color, textTransform: 'uppercase' }}>
                                                    {status.label}
                                                </span>
                                            )}
                                        </div>
                                        <span style={{ fontSize: '0.7rem', color: 'hsl(var(--muted-foreground))' }}>{new Date(item.fechaCreacion).toLocaleDateString()}</span>
                                    </div>
                                    <p style={{ fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                        {item.mensaje}
                                    </p>
                                </div>

                                {isTicket ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        {item.estado === 'cerrado' && (
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleDeleteThread(item.id); }} 
                                                style={{ background: 'none', border: 'none', color: 'hsl(var(--destructive))', cursor: 'pointer', padding: '0.5rem', opacity: 0.6 }}
                                                title="Eliminar conversación"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        )}
                                        <ChevronRight size={18} style={{ color: 'hsl(var(--muted-foreground))', opacity: 0.5 }} />
                                    </div>
                                ) : (
                                    !item.leido && (
                                        <button onClick={(e) => { e.stopPropagation(); handleMarkAsRead(item.id); }} style={{ backgroundColor: 'transparent', border: 'none', color: 'hsl(var(--primary))', fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer' }}>
                                            Marcar leída
                                        </button>
                                    )
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Conversation/Thread Modal */}
            {selectedThreadId && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ width: '100%', maxWidth: '600px', height: '90vh', backgroundColor: 'hsl(var(--background))', borderTopLeftRadius: '24px', borderTopRightRadius: '24px', display: 'flex', flexDirection: 'column', boxShadow: '0 -10px 40px rgba(0,0,0,0.2)' }}>
                        {/* Modal Header */}
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid hsl(var(--border))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h3 style={{ fontWeight: 800, fontSize: '1.1rem' }}>{threadMessages[0]?.titulo}</h3>
                                <p style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>Conversación con administración</p>
                            </div>
                            <button onClick={() => setSelectedThreadId(null)} style={{ background: 'hsl(var(--muted)/0.5)', border: 'none', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <X size={20} />
                            </button>
                        </div>

                        {/* Messages Area */}
                        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            {threadMessages.map((msg) => {
                                const isFromMe = msg.remitenteId === user?.id; // Careful here, check auth link
                                // Since we don't have the user object fully aligned in types, let's use esParaAdmin logic
                                const displayedAsSocio = !msg.esParaAdmin && msg.remitenteId !== undefined;
                                // Actually, if esParaAdmin is true, it was a message FROM socio TO admin.
                                // If esParaAdmin is false, it was a message FROM admin TO socio.
                                const isSocioMessage = msg.esParaAdmin; 
                                
                                return (
                                    <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isSocioMessage ? 'flex-end' : 'flex-start' }}>
                                        <div style={{ 
                                            maxWidth: '85%', 
                                            padding: '0.85rem 1.1rem', 
                                            borderRadius: '18px', 
                                            borderBottomRightRadius: isSocioMessage ? '4px' : '18px',
                                            borderBottomLeftRadius: isSocioMessage ? '18px' : '4px',
                                            backgroundColor: isSocioMessage ? 'hsl(var(--primary))' : 'hsl(var(--muted)/0.4)',
                                            color: isSocioMessage ? 'white' : 'inherit',
                                            fontSize: '0.95rem'
                                        }}>
                                            {msg.mensaje}
                                        </div>
                                        <span style={{ fontSize: '0.65rem', color: 'hsl(var(--muted-foreground))', marginTop: '0.3rem', opacity: 0.7 }}>
                                            {new Date(msg.fechaCreacion).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Reply Area */}
                        <div style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--card))' }}>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: '24px', padding: '0.4rem 0.5rem 0.4rem 1.25rem' }}>
                                <textarea 
                                    value={replyText}
                                    onChange={(e) => setReplyText(e.target.value)}
                                    placeholder="Escribí una respuesta..."
                                    rows={1}
                                    style={{ flex: 1, border: 'none', background: 'none', padding: '0.5rem 0', outline: 'none', fontSize: '0.95rem', resize: 'none', maxHeight: '100px' }}
                                />
                                <button 
                                    onClick={handleReply}
                                    disabled={!replyText || isReplying}
                                    style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'hsl(var(--primary))', color: 'white', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: !replyText || isReplying ? 0.5 : 1 }}
                                >
                                    <Send size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
