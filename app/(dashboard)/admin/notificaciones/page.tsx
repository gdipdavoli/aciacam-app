"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { NotificationService } from '@/services/notificationService';
import { StoreService } from '@/services/storeService';
import { Notificacion, Socio, EstadoTicket } from '@/types';
import { 
    Bell, Clock, Users, MessageSquare, Search, Filter, 
    CheckCircle, Mail, AlertTriangle, User, X, Send, 
    ChevronRight, Inbox, Archive, Trash2, RefreshCw
} from 'lucide-react';

type RecipientMode = 'all' | 'reprocann-activo' | 'reprocann-pendiente' | 'manual';

export default function AdminNotificacionesPage() {
    const { user } = useAuth();
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const [viewMode, setViewMode] = useState<'tickets' | 'massive'>((searchParams?.get('view') as any) || 'tickets');
    const [tickets, setTickets] = useState<Notificacion[]>([]);
    const [massiveNotifs, setMassiveNotifs] = useState<Notificacion[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Ticket Messaging State
    const [selectedTicketId, setSelectedTicketId] = useState<string | null>(searchParams?.get('ticketId') || null);
    const [thread, setThread] = useState<Notificacion[]>([]);
    const [loadingThread, setLoadingThread] = useState(false);
    const [replyText, setReplyText] = useState('');
    const [isReplying, setIsReplying] = useState(false);
    const [filterStatus, setFilterStatus] = useState<EstadoTicket | 'all'>((searchParams?.get('status') as any) || 'abierto');
    const scrollRef = useRef<HTMLDivElement>(null);

    // Helper to update URL params
    const updateUrl = (params: Record<string, string | null>) => {
        const current = new URLSearchParams(Array.from(searchParams?.entries() || []));
        Object.entries(params).forEach(([key, value]) => {
            if (value === null) current.delete(key);
            else current.set(key, value);
        });
        const query = current.toString();
        router.push(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
    };

    // Effect to sync URL -> Local State on back/forward
    useEffect(() => {
        const view = searchParams?.get('view') as any;
        const ticketId = searchParams?.get('ticketId');
        const status = searchParams?.get('status') as any;

        if (view && view !== viewMode) setViewMode(view);
        if (ticketId !== selectedTicketId) setSelectedTicketId(ticketId);
        if (status && status !== filterStatus) setFilterStatus(status);
    }, [searchParams]);

    // Massive Notification Modal States
    const [showMassiveModal, setShowMassiveModal] = useState(false);
    const [notifTitulo, setNotifTitulo] = useState('');
    const [notifMensaje, setNotifMensaje] = useState('');
    const [recipientMode, setRecipientMode] = useState<RecipientMode>('all');
    const [allSocios, setAllSocios] = useState<Socio[]>([]);
    const [selectedSocioIds, setSelectedSocioIds] = useState<string[]>([]);
    const [searchSocio, setSearchSocio] = useState('');
    const [isSendingMassive, setIsSendingMassive] = useState(false);

    const fetchTickets = async () => {
        setLoading(true);
        try {
            const data = await NotificationService.getTickets({ 
                estado: filterStatus === 'all' ? undefined : filterStatus 
            });
            setTickets(data);
            
            // Fetch massive notifications separately
            const massive = await NotificationService.getNotifications({ isAdminInbox: false });
            setMassiveNotifs(massive.filter(n => n.esInformativo));
        } catch (error) {
            console.error("Error fetching data", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchThread = async (id: string) => {
        setLoadingThread(true);
        try {
            const data = await NotificationService.getThread(id);
            setThread(data);
        } catch (error) {
            console.error("Error fetching thread", error);
        } finally {
            setLoadingThread(false);
        }
    };

    useEffect(() => {
        fetchTickets();
    }, [filterStatus]);

    useEffect(() => {
        if (selectedTicketId) {
            fetchThread(selectedTicketId);
        }
    }, [selectedTicketId]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [thread]);

    // Ticket Actions
    const handleTicketSelect = async (id: string) => {
        setSelectedTicketId(id);
        updateUrl({ ticketId: id });
        
        // Mark as read
        try {
            await NotificationService.markThreadAsRead(id, true);
            setTickets(prev => prev.map(t => t.id === id ? { ...t, leido: true } : t));
        } catch (error) {
            console.error("Error marking thread as read", error);
        }
    };

    const handleReply = async () => {
        if (!replyText || !selectedTicketId || !user) return;
        
        const parent = tickets.find(t => t.id === selectedTicketId);
        if (!parent) return;

        setIsReplying(true);
        
        // Optimistic Update
        const optimisticReply: Notificacion = {
            id: 'temp-' + Date.now(),
            socioId: parent.socioId,
            remitenteId: (user as any).socioId,
            remitenteNombre: 'Administración (Yo)',
            parentId: selectedTicketId,
            titulo: `RE: ${parent.titulo}`,
            mensaje: replyText,
            leido: true,
            esParaAdmin: false,
            tipo: 'support_reply',
            fechaCreacion: new Date().toISOString()
        };

        setThread(prev => [...prev, optimisticReply]);
        const textToSubmit = replyText;
        setReplyText('');

        try {
            await NotificationService.sendNotification({
                socioId: parent.socioId,
                parentId: selectedTicketId,
                titulo: `Respuesta de Soporte`,
                mensaje: textToSubmit,
                remitenteId: (user as any).socioId,
                tipo: 'support_reply',
                estado: 'pendiente' // Awaiting socio
            });
            
            // Mark original as "pendiente" (expecting socio response)
            await NotificationService.updateTicketStatus(selectedTicketId, 'pendiente');
            
            // Update local ticket list status optimistically
            setTickets(prev => prev.map(t => t.id === selectedTicketId ? { ...t, estado: 'pendiente' } : t));
            
            fetchThread(selectedTicketId);
        } catch (error) {
            alert("Error al enviar respuesta");
            setThread(prev => prev.filter(t => t.id !== optimisticReply.id));
            setReplyText(textToSubmit);
        } finally {
            setIsReplying(false);
        }
    };

    const handleUpdateStatus = async (id: string, newStatus: EstadoTicket) => {
        try {
            await NotificationService.updateTicketStatus(id, newStatus);
            setTickets(prev => prev.map(t => t.id === id ? { ...t, estado: newStatus } : t));
            if (filterStatus !== 'all' && newStatus !== filterStatus) {
                if (selectedTicketId === id) {
                    setSelectedTicketId(null);
                    updateUrl({ ticketId: null });
                }
            }
        } catch (error) {
            alert("Error al actualizar estado");
        }
    };

    // Massive Notification Logic (Simplified)
    const handleSendMassive = async () => {
        if (!notifTitulo || !notifMensaje) return;
        setIsSendingMassive(true);
        try {
            const filters: any = {};
            if (recipientMode === 'reprocann-activo') filters.reprocann_estado = 'activo';
            if (recipientMode === 'reprocann-pendiente') filters.reprocann_estado = 'pendiente';
            if (recipientMode === 'manual' && selectedSocioIds.length > 0) filters.socioIds = selectedSocioIds;

            await NotificationService.sendMassiveNotification({
                titulo: notifTitulo,
                mensaje: notifMensaje,
                tipo: 'massive',
                filters,
                remitenteId: (user as any)?.socioId
            });
            
            alert(`Notificación masiva enviada.`);
            setShowMassiveModal(false);
            setNotifTitulo('');
            setNotifMensaje('');
            fetchTickets();
        } catch (error) {
            alert("Error: " + (error as any).message);
        } finally {
            setIsSendingMassive(false);
        }
    };

    // Helper for status colors
    const getStatusColor = (status?: string) => {
        switch (status) {
            case 'abierto': return '#ef4444'; // Red
            case 'pendiente': return '#f59e0b'; // Amber
            case 'cerrado': return '#10b981'; // Green
            default: return 'gray';
        }
    };

    return (
        <div 
            className={`notifications-container ${selectedTicketId ? 'has-selection' : ''}`}
            style={{ display: 'flex', height: 'calc(100vh - 120px)', backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', overflow: 'hidden', position: 'relative' }}
        >
            <style>{`
                @media (max-width: 1024px) {
                    .notifications-sidebar {
                        width: 100% !important;
                    }
                    .notifications-container.has-selection .notifications-sidebar {
                        display: none !important;
                    }
                    .notifications-main {
                        width: 100% !important;
                    }
                    .notifications-container:not(.has-selection) .notifications-main {
                        display: none !important;
                    }
                    .chat-input-container {
                        padding: 1rem !important;
                    }
                    .messages-container {
                        padding: 1rem !important;
                    }
                }
            `}</style>
            
            {/* Sidebar: Navigation & Case List */}
            <div className="notifications-sidebar" style={{ width: '350px', borderRight: '1px solid hsl(var(--border))', display: 'flex', flexDirection: 'column', backgroundColor: 'hsl(var(--card))', transition: 'all 0.3s' }}>
                
                {/* Search & Header */}
                <div style={{ padding: '1.25rem', borderBottom: '1px solid hsl(var(--border))' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Mensajería</h2>
                        <button 
                            onClick={() => {
                                setShowMassiveModal(true);
                                StoreService.getSocios().then(setAllSocios);
                            }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--primary))' }}
                            title="Nueva Difusión"
                        >
                            <Mail size={20} />
                        </button>
                    </div>
                    
                    {/* View Switcher */}
                    <div style={{ display: 'flex', backgroundColor: 'hsl(var(--muted)/0.5)', padding: '0.25rem', borderRadius: 'var(--radius)', marginBottom: '1rem' }}>
                        <button 
                            onClick={() => {
                                setViewMode('tickets');
                                updateUrl({ view: 'tickets' });
                            }}
                            style={{ flex: 1, padding: '0.4rem', fontSize: '0.85rem', borderRadius: 'calc(var(--radius) - 2px)', border: 'none', backgroundColor: viewMode === 'tickets' ? 'hsl(var(--background))' : 'transparent', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                        >
                            <Inbox size={14} /> Casos
                        </button>
                        <button 
                            onClick={() => {
                                setViewMode('massive');
                                updateUrl({ view: 'massive' });
                            }}
                            style={{ flex: 1, padding: '0.4rem', fontSize: '0.85rem', borderRadius: 'calc(var(--radius) - 2px)', border: 'none', backgroundColor: viewMode === 'massive' ? 'hsl(var(--background))' : 'transparent', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                        >
                            <Users size={14} /> Difusiones
                        </button>
                    </div>

                    {viewMode === 'tickets' && (
                        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
                            {['abierto', 'pendiente', 'cerrado', 'all'].map(s => (
                                <button 
                                    key={s}
                                    onClick={() => {
                                        setFilterStatus(s as any);
                                        updateUrl({ status: s });
                                    }}
                                    style={{ 
                                        padding: '0.25rem 0.6rem', 
                                        borderRadius: '20px', 
                                        fontSize: '0.75rem', 
                                        border: '1px solid hsl(var(--border))', 
                                        backgroundColor: filterStatus === s ? 'hsl(var(--primary))' : 'transparent',
                                        color: filterStatus === s ? 'white' : 'inherit',
                                        textTransform: 'capitalize',
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap'
                                    }}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* List Content */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {loading ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'hsl(var(--muted-foreground))' }}><RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto' }} /></div>
                    ) : (viewMode === 'tickets' ? tickets : massiveNotifs).length === 0 ? (
                        <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'hsl(var(--muted-foreground))' }}>
                            <Archive size={40} style={{ margin: '0 auto 1rem', opacity: 0.2 }} />
                            <p style={{ fontSize: '0.85rem' }}>No hay mensajes para mostrar.</p>
                        </div>
                    ) : (
                        (viewMode === 'tickets' ? tickets : massiveNotifs).map(item => (
                            <div 
                                key={item.id}
                                onClick={() => viewMode === 'tickets' && handleTicketSelect(item.id)}
                                style={{
                                    padding: '1rem 1.25rem',
                                    borderBottom: '1px solid hsl(var(--border))',
                                    cursor: viewMode === 'tickets' ? 'pointer' : 'default',
                                    backgroundColor: selectedTicketId === item.id ? 'hsl(var(--primary)/0.05)' : 'transparent',
                                    position: 'relative',
                                    transition: 'background-color 0.2s'
                                }}
                            >
                                {selectedTicketId === item.id && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px', backgroundColor: 'hsl(var(--primary))' }}></div>}
                                
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.25rem' }}>
                                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'hsl(var(--foreground))' }}>
                                        {viewMode === 'tickets' ? (item.socioNombre || item.remitenteNombre || 'Socio') : item.titulo}
                                    </span>
                                    <span style={{ fontSize: '0.7rem', color: 'hsl(var(--muted-foreground))' }}>
                                        {new Date(item.fechaCreacion).toLocaleDateString()}
                                    </span>
                                </div>
                                
                                <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.2rem', color: 'hsl(var(--foreground))', opacity: 0.8 }}>
                                    {viewMode === 'tickets' ? item.titulo : `Difundido`}
                                </div>
                                
                                <p style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.2' }}>
                                    {item.mensaje}
                                </p>

                                {viewMode === 'tickets' && (
                                    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem' }}>
                                        <span style={{ 
                                            fontSize: '0.65rem', 
                                            fontWeight: 700, 
                                            padding: '0.1rem 0.4rem', 
                                            borderRadius: '4px', 
                                            backgroundColor: `${getStatusColor(item.estado)}20`, 
                                            color: getStatusColor(item.estado),
                                            textTransform: 'uppercase'
                                        }}>
                                            {item.estado}
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Main Pane: Reading Area */}
            <div className="notifications-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'hsl(var(--background))' }}>
                {!selectedTicketId ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--muted-foreground))' }}>
                        <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
                            <Inbox size={100} style={{ opacity: 0.05 }} />
                            <Mail size={40} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0.1 }} />
                        </div>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Bandeja de Entrada</h3>
                        <p style={{ fontSize: '0.9rem' }}>Selecciona un caso de soporte para comenzar.</p>
                    </div>
                ) : (
                    <>
                        {/* Thread Header */}
                        <div style={{ padding: '1rem 2rem', borderBottom: '1px solid hsl(var(--border))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'hsl(var(--card))', position: 'relative' }}>
                            <button 
                                onClick={() => {
                                    setSelectedTicketId(null);
                                    updateUrl({ ticketId: null });
                                }}
                                style={{
                                    display: 'none',
                                    marginRight: '1rem',
                                    padding: '0.5rem',
                                    borderRadius: '50%',
                                    backgroundColor: 'hsl(var(--muted)/0.5)',
                                    border: 'none',
                                    cursor: 'pointer'
                                }}
                                className="back-button"
                            >
                                <ChevronRight size={20} style={{ transform: 'rotate(180deg)' }} />
                            </button>
                            <style>{`
                                @media (max-width: 1024px) {
                                    .back-button { display: block !important; }
                                }
                            `}</style>
                            <div>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>{tickets.find(t => t.id === selectedTicketId)?.titulo}</h3>
                                <div style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <span style={{ fontWeight: 600 }}>{tickets.find(t => t.id === selectedTicketId)?.socioNombre || tickets.find(t => t.id === selectedTicketId)?.remitenteNombre}</span>
                                    <span style={{ color: 'hsl(var(--muted-foreground))' }}>ID: {selectedTicketId.slice(0, 8)}</span>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                <select 
                                    value={tickets.find(t => t.id === selectedTicketId)?.estado}
                                    onChange={(e) => handleUpdateStatus(selectedTicketId, e.target.value as EstadoTicket)}
                                    style={{
                                        padding: '0.4rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--border))',
                                        fontSize: '0.85rem',
                                        backgroundColor: 'hsl(var(--background))',
                                        fontWeight: 600
                                    }}
                                >
                                    <option value="abierto">Abierto</option>
                                    <option value="pendiente">En Espera</option>
                                    <option value="cerrado">Cerrado</option>
                                </select>
                                <button 
                                    onClick={() => handleUpdateStatus(selectedTicketId, 'cerrado')}
                                    style={{ padding: '0.4rem 0.8rem', backgroundColor: 'hsl(var(--primary))', color: 'white', border: 'none', borderRadius: 'var(--radius)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
                                    Cerrar Caso
                                </button>
                            </div>
                        </div>

                        {/* Thread Messages */}
                        <div ref={scrollRef} className="messages-container" style={{ flex: 1, overflowY: 'auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {loadingThread ? (
                                <p style={{ textAlign: 'center', color: 'hsl(var(--muted-foreground))' }}>Cargando conversación...</p>
                            ) : (
                                thread.map((msg, idx) => (
                                    <div 
                                        key={msg.id} 
                                        style={{ 
                                            display: 'flex', 
                                            flexDirection: 'column', 
                                            alignItems: msg.esParaAdmin ? 'flex-start' : 'flex-end',
                                            maxWidth: '85%',
                                            alignSelf: msg.esParaAdmin ? 'flex-start' : 'flex-end'
                                        }}
                                    >
                                        <div style={{ 
                                            padding: '1rem 1.25rem', 
                                            borderRadius: 'var(--radius)', 
                                            backgroundColor: msg.esParaAdmin ? 'hsl(var(--muted)/0.3)' : 'hsl(var(--primary))',
                                            color: msg.esParaAdmin ? 'inherit' : 'white',
                                            fontSize: '0.95rem',
                                            lineHeight: '1.5',
                                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                            border: msg.esParaAdmin ? '1px solid hsl(var(--border))' : 'none',
                                            position: 'relative'
                                        }}>
                                            {msg.mensaje}
                                        </div>
                                        <span style={{ fontSize: '0.7rem', color: 'hsl(var(--muted-foreground))', marginTop: '0.4rem', padding: '0 0.5rem' }}>
                                            {msg.remitenteNombre || (msg.esParaAdmin ? 'Sistema' : (msg.socioNombre || 'Socio'))} • {new Date(msg.fechaCreacion).toLocaleString()}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Reply Input */}
                        <div className="chat-input-container" style={{ padding: '1.5rem 2rem', borderTop: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--card))' }}>
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', padding: '0.5rem' }}>
                                <textarea 
                                    value={replyText}
                                    onChange={(e) => setReplyText(e.target.value)}
                                    placeholder="Escribe una respuesta..."
                                    rows={3}
                                    style={{ flex: 1, border: 'none', background: 'none', padding: '0.75rem', fontSize: '0.95rem', resize: 'none', outline: 'none' }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleReply();
                                        }
                                    }}
                                />
                                <button 
                                    onClick={handleReply}
                                    disabled={!replyText || isReplying}
                                    style={{ width: '44px', height: '44px', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--primary))', color: 'white', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: (!replyText || isReplying) ? 0.5 : 1 }}
                                >
                                    <Send size={20} />
                                </button>
                            </div>
                            <p style={{ fontSize: '0.7rem', color: 'hsl(var(--muted-foreground))', marginTop: '0.5rem', textAlign: 'right' }}>Presiona Enter para enviar</p>
                        </div>
                    </>
                )}
            </div>

            {/* Massive Modal (Reused) */}
            {showMassiveModal && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }}>
                    <div style={{ backgroundColor: 'hsl(var(--card))', borderRadius: 'var(--radius)', width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto', padding: '2rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Difusión Masiva</h2>
                            <button onClick={() => setShowMassiveModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} /></button>
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Destinatarios</label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                    {[
                                        { id: 'all', label: 'Todos los Socios', icon: Users },
                                        { id: 'reprocann-activo', label: 'Reprocann Activo', icon: CheckCircle },
                                        { id: 'reprocann-pendiente', label: 'Reprocann Pendiente', icon: Clock },
                                        { id: 'manual', label: 'Selección Manual', icon: User }
                                    ].map(mode => (
                                        <button 
                                            key={mode.id}
                                            onClick={() => setRecipientMode(mode.id as RecipientMode)}
                                            style={{
                                                padding: '0.6rem',
                                                borderRadius: 'var(--radius)',
                                                border: `1px solid ${recipientMode === mode.id ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
                                                backgroundColor: recipientMode === mode.id ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                                                color: recipientMode === mode.id ? 'hsl(var(--primary))' : 'inherit',
                                                fontSize: '0.8rem',
                                                fontWeight: 600,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.4rem',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <mode.icon size={14} /> {mode.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {recipientMode === 'manual' && (
                                <div style={{ border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', padding: '1rem' }}>
                                    <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
                                        <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))' }} />
                                        <input 
                                            type="text" 
                                            placeholder="Buscar socio..."
                                            value={searchSocio}
                                            onChange={(e) => setSearchSocio(e.target.value)}
                                            style={{ width: '100%', padding: '0.5rem 0.5rem 0.5rem 2.25rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'hsl(var(--muted) / 0.2)', fontSize: '0.85rem' }}
                                        />
                                    </div>
                                    <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                        {allSocios.filter(s => (s.nombre + ' ' + s.apellido).toLowerCase().includes(searchSocio.toLowerCase())).map(s => (
                                            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', cursor: 'pointer' }}>
                                                <input type="checkbox" checked={selectedSocioIds.includes(s.id)} onChange={() => setSelectedSocioIds(prev => prev.includes(s.id) ? prev.filter(i => i !== s.id) : [...prev, s.id])} />
                                                <span style={{ fontSize: '0.85rem' }}>{s.apellido}, {s.nombre}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Título</label>
                                <input type="text" value={notifTitulo} onChange={(e) => setNotifTitulo(e.target.value)} placeholder="Ej: Importante" style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'transparent' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Mensaje</label>
                                <textarea rows={4} value={notifMensaje} onChange={(e) => setNotifMensaje(e.target.value)} placeholder="Escribe aquí..." style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'transparent' }} />
                            </div>
                            
                            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                <button onClick={() => setShowMassiveModal(false)} style={{ flex: 1, padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', backgroundColor: 'transparent', fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
                                <button onClick={handleSendMassive} disabled={isSendingMassive || !notifTitulo || !notifMensaje} style={{ flex: 2, padding: '0.75rem', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--primary))', color: 'white', border: 'none', fontWeight: 700, cursor: 'pointer', opacity: isSendingMassive ? 0.7 : 1 }}>
                                    {isSendingMassive ? 'Enviando...' : 'Enviar Difusión'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
