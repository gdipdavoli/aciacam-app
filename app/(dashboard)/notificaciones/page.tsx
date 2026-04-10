"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { NotificationService } from '@/services/notificationService';
import { Notificacion } from '@/types';
import { Bell, Check, Clock, Package, MapPin, Trash2, MailOpen, Mail } from 'lucide-react';

export default function NotificacionesPage() {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<Notificacion[]>([]);
    const [loading, setLoading] = useState(true);
    
    // New Message form
    const [showForm, setShowForm] = useState(false);
    const [notifTitulo, setNotifTitulo] = useState('');
    const [notifMensaje, setNotifMensaje] = useState('');
    const [isSending, setIsSending] = useState(false);

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
    }, [user]);

    const handleMarkAsRead = async (id: string) => {
        try {
            await NotificationService.markAsRead(id);
            setNotifications(notifications.map(n => 
                n.id === id ? { ...n, leido: true } : n
            ));
        } catch (error) {
            console.error("Error marking as read", error);
        }
    };

    const handleSendToAdmin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !notifTitulo || !notifMensaje) return;
        setIsSending(true);
        try {
            await NotificationService.sendToAdmin({
                socioId: user.id,
                titulo: notifTitulo,
                mensaje: notifMensaje
            });
            alert("Mensaje enviado a la administración.");
            setShowForm(false);
            setNotifTitulo('');
            setNotifMensaje('');
        } catch (error) {
            alert("Error al enviar mensaje");
        } finally {
            setIsSending(false);
        }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'delivery': return <MapPin size={20} className="text-primary" />;
            case 'order': return <Package size={20} className="text-blue-500" />;
            default: return <Bell size={20} className="text-amber-500" />;
        }
    };

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '2rem' }}>
            <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>
                        Notificaciones
                    </h1>
                    <p style={{ color: 'hsl(var(--muted-foreground))' }}>
                        Mantenete al tanto de tus pedidos y novedades de ACIACAM.
                    </p>
                </div>
                <button 
                    onClick={() => setShowForm(!showForm)}
                    style={{
                        padding: '0.6rem 1.2rem',
                        backgroundColor: showForm ? 'hsl(var(--muted))' : 'hsl(var(--primary))',
                        color: showForm ? 'hsl(var(--foreground))' : 'hsl(var(--primary-foreground))',
                        borderRadius: 'var(--radius)',
                        border: 'none',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}
                >
                    {showForm ? 'Cancelar' : <><MessageSquare size={18} /> Contactar Soporte</>}
                </button>
            </div>

            {showForm && (
                <div style={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--primary) / 0.2)', 
                    borderRadius: 'var(--radius)', 
                    padding: '1.5rem', 
                    marginBottom: '2rem',
                    boxShadow: '0 10px 15px -3px hsl(var(--primary) / 0.05)'
                }}>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1rem' }}>Enviar mensaje a administración</h3>
                    <form onSubmit={handleSendToAdmin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Asunto</label>
                            <input 
                                type="text"
                                required
                                value={notifTitulo}
                                onChange={(e) => setNotifTitulo(e.target.value)}
                                placeholder="Ej: Duda sobre mi envío"
                                style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'transparent' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Mensaje</label>
                            <textarea 
                                rows={3}
                                required
                                value={notifMensaje}
                                onChange={(e) => setNotifMensaje(e.target.value)}
                                placeholder="Escribí tu consulta aquí..."
                                style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'transparent' }}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button 
                                type="submit"
                                disabled={isSending}
                                style={{
                                    padding: '0.6rem 2rem',
                                    backgroundColor: 'hsl(var(--primary))',
                                    color: 'hsl(var(--primary-foreground))',
                                    borderRadius: 'var(--radius)',
                                    border: 'none',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    opacity: isSending ? 0.7 : 1
                                }}
                            >
                                {isSending ? 'Enviando...' : 'Enviar Consulta'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {loading ? (
                <div style={{ padding: '4rem', textAlign: 'center' }}>
                    <div className="animate-pulse flex flex-col items-center">
                        <div className="w-12 h-12 bg-muted rounded-full mb-4"></div>
                        <div className="h-4 bg-muted rounded w-48 mb-2"></div>
                        <div className="h-3 bg-muted rounded w-32"></div>
                    </div>
                </div>
            ) : notifications.length === 0 ? (
                <div style={{ 
                    textAlign: 'center', 
                    padding: '5rem 2rem', 
                    backgroundColor: 'hsl(var(--card))', 
                    borderRadius: 'var(--radius)',
                    border: '1px dashed hsl(var(--border))'
                }}>
                    <div style={{ 
                        width: '64px', 
                        height: '64px', 
                        backgroundColor: 'hsl(var(--muted) / 0.5)', 
                        borderRadius: '50%', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        margin: '0 auto 1.5rem'
                    }}>
                        <Bell size={32} className="text-muted-foreground opacity-50" />
                    </div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>No tenés notificaciones</h3>
                    <p style={{ color: 'hsl(var(--muted-foreground))' }}>Todo al día por aquí. Te avisaremos cuando haya novedades.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {notifications.map((n) => (
                        <div 
                            key={n.id} 
                            style={{
                                backgroundColor: n.leido ? 'hsl(var(--card))' : 'hsl(var(--primary) / 0.03)',
                                border: `1px solid ${n.leido ? 'hsl(var(--border))' : 'hsl(var(--primary) / 0.2)'}`,
                                borderRadius: 'var(--radius)',
                                padding: '1.25rem',
                                position: 'relative',
                                transition: 'all 0.2s ease-in-out',
                                boxShadow: n.leido ? 'none' : '0 4px 12px -4px hsl(var(--primary) / 0.1)'
                            }}
                        >
                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <div style={{ 
                                    width: '40px', 
                                    height: '40px', 
                                    borderRadius: '10px', 
                                    backgroundColor: n.leido ? 'hsl(var(--muted) / 0.3)' : 'hsl(var(--primary) / 0.1)', 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center',
                                    flexShrink: 0
                                }}>
                                    {getIcon(n.tipo)}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.25rem' }}>
                                        <h4 style={{ fontWeight: 700, fontSize: '1.1rem', color: n.leido ? 'inherit' : 'hsl(var(--primary))' }}>
                                            {n.titulo}
                                            {!n.leido && <span style={{ marginLeft: '0.5rem', width: '8px', height: '8px', backgroundColor: 'hsl(var(--primary))', borderRadius: '50%', display: 'inline-block' }}></span>}
                                        </h4>
                                        <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                            <Clock size={12} />
                                            {new Date(n.fechaCreacion).toLocaleDateString()} {new Date(n.fechaCreacion).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <p style={{ color: 'hsl(var(--foreground))', fontSize: '0.95rem', lineHeight: '1.5', opacity: n.leido ? 0.8 : 1 }}>
                                        {n.mensaje}
                                    </p>
                                    
                                    {!n.leido && (
                                        <button 
                                            onClick={() => handleMarkAsRead(n.id)}
                                            style={{
                                                marginTop: '0.75rem',
                                                fontSize: '0.8rem',
                                                fontWeight: 600,
                                                color: 'hsl(var(--primary))',
                                                backgroundColor: 'transparent',
                                                border: 'none',
                                                padding: 0,
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.4rem'
                                            }}
                                        >
                                            <Check size={14} /> Marcar como leída
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
