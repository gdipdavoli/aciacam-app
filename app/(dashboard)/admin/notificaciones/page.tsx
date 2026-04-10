"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { NotificationService } from '@/services/notificationService';
import { Notificacion, Socio } from '@/types';
import { Bell, Clock, Send, Users, MessageSquare, Search, Filter, CheckCircle, Mail, AlertTriangle } from 'lucide-react';

export default function AdminNotificacionesPage() {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<Notificacion[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'inbox' | 'sent'>('inbox');
    
    // New Message States
    const [showMassiveModal, setShowMassiveModal] = useState(false);
    const [massiveTitulo, setMassiveTitulo] = useState('');
    const [massiveMensaje, setMassiveMensaje] = useState('');
    const [isSending, setIsSending] = useState(false);

    const fetchData = async () => {
        setLoading(true);
        try {
            const data = await NotificationService.getNotifications({ 
                isAdminInbox: activeTab === 'inbox' 
            });
            setNotifications(data);
        } catch (error) {
            console.error("Error fetching admin notifications", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [activeTab]);

    const handleSendMassive = async () => {
        if (!massiveTitulo || !massiveMensaje) return;
        setIsSending(true);
        try {
            await NotificationService.sendMassiveNotification({
                titulo: massiveTitulo,
                mensaje: massiveMensaje,
                tipo: 'massive'
            });
            alert("Mensaje masivo enviado correctamente a todos los socios activos.");
            setShowMassiveModal(false);
            setMassiveTitulo('');
            setMassiveMensaje('');
            if (activeTab === 'sent') fetchData();
        } catch (error) {
            alert("Error al enviar mensaje masivo: " + (error as any).message);
        } finally {
            setIsSending(false);
        }
    };

    const handleMarkAsRead = async (id: string) => {
        try {
            await NotificationService.markAsRead(id);
            setNotifications(notifications.map(n => n.id === id ? { ...n, leido: true } : n));
        } catch (error) {
            console.error("Error marking as read", error);
        }
    };

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto', paddingBottom: '3rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 800 }}>Centro de Comunicaciones</h1>
                    <p style={{ color: 'hsl(var(--muted-foreground))' }}>Administrá las notificaciones y mensajes con los socios.</p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button 
                        onClick={() => setShowMassiveModal(true)}
                        style={{
                            backgroundColor: 'hsl(var(--primary))',
                            color: 'hsl(var(--primary-foreground))',
                            border: 'none',
                            padding: '0.6rem 1.2rem',
                            borderRadius: 'var(--radius)',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            cursor: 'pointer'
                        }}
                    >
                        <Users size={18} /> Mensaje Masivo
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid hsl(var(--border))', marginBottom: '1.5rem' }}>
                <button 
                    onClick={() => setActiveTab('inbox')}
                    style={{
                        padding: '0.75rem 1.5rem',
                        borderBottom: activeTab === 'inbox' ? '2px solid hsl(var(--primary))' : 'none',
                        color: activeTab === 'inbox' ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                        fontWeight: 600,
                        backgroundColor: 'transparent',
                        cursor: 'pointer'
                    }}
                >
                    Bandeja de Entrada (Socios)
                </button>
                <button 
                    onClick={() => setActiveTab('sent')}
                    style={{
                        padding: '0.75rem 1.5rem',
                        borderBottom: activeTab === 'sent' ? '2px solid hsl(var(--primary))' : 'none',
                        color: activeTab === 'sent' ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                        fontWeight: 600,
                        backgroundColor: 'transparent',
                        cursor: 'pointer'
                    }}
                >
                    Notificaciones Enviadas
                </button>
            </div>

            {loading ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'hsl(var(--muted-foreground))' }}>Cargando mensajes...</div>
            ) : notifications.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '5rem', backgroundColor: 'hsl(var(--muted) / 0.2)', borderRadius: 'var(--radius)' }}>
                    <MessageSquare size={48} style={{ margin: '0 auto 1rem', opacity: 0.2 }} />
                    <p>No se encontraron mensajes en esta sección.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {notifications.map(n => (
                        <div key={n.id} style={{
                            backgroundColor: n.leido ? 'hsl(var(--card))' : 'hsl(var(--primary) / 0.02)',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: 'var(--radius)',
                            padding: '1rem 1.5rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'start'
                        }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                                    {!n.leido && <span style={{ width: '8px', height: '8px', backgroundColor: 'hsl(var(--primary))', borderRadius: '50%' }}></span>}
                                    <h4 style={{ fontWeight: 700, fontSize: '1.05rem' }}>{n.titulo}</h4>
                                    <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                        <Clock size={12} /> {new Date(n.fechaCreacion).toLocaleString()}
                                    </span>
                                </div>
                                <p style={{ fontSize: '0.9rem', color: 'hsl(var(--foreground))', opacity: 0.9, marginBottom: '0.5rem' }}>{n.mensaje}</p>
                                <div style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))', fontWeight: 600 }}>
                                    {activeTab === 'inbox' ? `Enviado por: ${n.remitenteNombre || 'Socio'}` : `Para Socio ID: ${n.socioId.slice(0, 8)}...`}
                                </div>
                            </div>
                            {activeTab === 'inbox' && !n.leido && (
                                <button 
                                    onClick={() => handleMarkAsRead(n.id)}
                                    style={{
                                        backgroundColor: 'hsl(var(--primary) / 0.1)',
                                        color: 'hsl(var(--primary))',
                                        border: 'none',
                                        padding: '0.4rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        fontSize: '0.8rem',
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                >
                                    Marcar Leído
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Massive Modal */}
            {showMassiveModal && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }}>
                    <div style={{ backgroundColor: 'hsl(var(--card))', borderRadius: 'var(--radius)', width: '100%', maxWidth: '500px', padding: '2rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>Mensaje Masivo</h2>
                        <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Este mensaje llegará a TODOS los socios activos del sistema.</p>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Título</label>
                                <input 
                                    type="text" 
                                    value={massiveTitulo}
                                    onChange={(e) => setMassiveTitulo(e.target.value)}
                                    placeholder="Ej: Novedades del Club"
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'transparent' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Mensaje</label>
                                <textarea 
                                    rows={4}
                                    value={massiveMensaje}
                                    onChange={(e) => setMassiveMensaje(e.target.value)}
                                    placeholder="Escribe el contenido aquí..."
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'transparent' }}
                                />
                            </div>
                            
                            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                <button 
                                    onClick={() => setShowMassiveModal(false)}
                                    style={{ flex: 1, padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', backgroundColor: 'transparent', fontWeight: 600, cursor: 'pointer' }}
                                >
                                    Cancelar
                                </button>
                                <button 
                                    onClick={handleSendMassive}
                                    disabled={isSending || !massiveTitulo || !massiveMensaje}
                                    style={{ 
                                        flex: 1, 
                                        padding: '0.6rem', 
                                        borderRadius: 'var(--radius)', 
                                        backgroundColor: 'hsl(var(--primary))', 
                                        color: 'hsl(var(--primary-foreground))', 
                                        border: 'none', 
                                        fontWeight: 600, 
                                        cursor: 'pointer',
                                        opacity: isSending ? 0.7 : 1
                                    }}
                                >
                                    {isSending ? 'Enviando...' : 'Enviar a Todos'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
