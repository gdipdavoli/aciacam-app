"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { NotificationService } from '@/services/notificationService';
import { StoreService } from '@/services/storeService';
import { Notificacion, Socio } from '@/types';
import { Bell, Clock, Users, MessageSquare, Search, Filter, CheckCircle, Mail, AlertTriangle, User, X } from 'lucide-react';

type RecipientMode = 'all' | 'reprocann-activo' | 'reprocann-pendiente' | 'manual';

export default function AdminNotificacionesPage() {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<Notificacion[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'inbox' | 'sent'>('inbox');
    
    // Socio Data for Manual Selection
    const [allSocios, setAllSocios] = useState<Socio[]>([]);
    const [searchSocio, setSearchSocio] = useState('');
    
    // New Message States
    const [showModal, setShowModal] = useState(false);
    const [notifTitulo, setNotifTitulo] = useState('');
    const [notifMensaje, setNotifMensaje] = useState('');
    const [recipientMode, setRecipientMode] = useState<RecipientMode>('all');
    const [selectedSocioIds, setSelectedSocioIds] = useState<string[]>([]);
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

    const fetchSocios = async () => {
        try {
            const data = await StoreService.getSocios();
            setAllSocios(data);
        } catch (error) {
            console.error("Error fetching socios for selection", error);
        }
    };

    useEffect(() => {
        fetchData();
        if (showModal) fetchSocios();
    }, [activeTab, showModal]);

    const handleSend = async () => {
        if (!notifTitulo || !notifMensaje) return;
        setIsSending(true);
        try {
            const filters: any = {};
            if (recipientMode === 'reprocann-activo') filters.reprocann_estado = 'activo';
            if (recipientMode === 'reprocann-pendiente') filters.reprocann_estado = 'pendiente';
            if (recipientMode === 'manual' && selectedSocioIds.length > 0) filters.socioIds = selectedSocioIds;

            await NotificationService.sendMassiveNotification({
                titulo: notifTitulo,
                mensaje: notifMensaje,
                tipo: recipientMode === 'all' ? 'massive' : 'targeted',
                filters
            });
            
            alert(`Mensaje enviado correctamente a los destinatarios seleccionados.`);
            setShowModal(false);
            resetForm();
            if (activeTab === 'sent') fetchData();
        } catch (error) {
            alert("Error al enviar mensaje: " + (error as any).message);
        } finally {
            setIsSending(false);
        }
    };

    const resetForm = () => {
        setNotifTitulo('');
        setNotifMensaje('');
        setRecipientMode('all');
        setSelectedSocioIds([]);
        setSearchSocio('');
    };

    const toggleSocioSelection = (id: string) => {
        setSelectedSocioIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleMarkAsRead = async (id: string) => {
        try {
            await NotificationService.markAsRead(id);
            setNotifications(notifications.map(n => n.id === id ? { ...n, leido: true } : n));
        } catch (error) {
            console.error("Error marking as read", error);
        }
    };

    const filteredSocios = allSocios.filter(s => 
        (s.nombre + ' ' + s.apellido).toLowerCase().includes(searchSocio.toLowerCase()) ||
        s.email.toLowerCase().includes(searchSocio.toLowerCase())
    );

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto', paddingBottom: '3rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 800 }}>Centro de Comunicaciones</h1>
                    <p style={{ color: 'hsl(var(--muted-foreground))' }}>Administra las notificaciones y mensajes con los socios.</p>
                </div>
                <button 
                    onClick={() => setShowModal(true)}
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
                    <Mail size={18} /> Nuevo Mensaje
                </button>
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
                    Bandeja de Entrada
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
                                    {activeTab === 'inbox' ? `Enviado por: ${n.remitenteNombre || 'Socio'}` : `Para: ${n.socioId.slice(0, 8)}...`}
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

            {/* Compose Modal */}
            {showModal && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }}>
                    <div style={{ backgroundColor: 'hsl(var(--card))', borderRadius: 'var(--radius)', width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto', padding: '2rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Enviar Notificación</h2>
                            <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} /></button>
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
                                            placeholder="Buscar socio por nombre o email..."
                                            value={searchSocio}
                                            onChange={(e) => setSearchSocio(e.target.value)}
                                            style={{ width: '100%', padding: '0.5rem 0.5rem 0.5rem 2.25rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'hsl(var(--muted) / 0.2)', fontSize: '0.85rem' }}
                                        />
                                    </div>
                                    <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem', paddingRight: '0.5rem' }}>
                                        {filteredSocios.map(s => (
                                            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', borderRadius: '4px', cursor: 'pointer', backgroundColor: selectedSocioIds.includes(s.id) ? 'hsl(var(--primary) / 0.05)' : 'transparent' }}>
                                                <input 
                                                    type="checkbox" 
                                                    checked={selectedSocioIds.includes(s.id)}
                                                    onChange={() => toggleSocioSelection(s.id)}
                                                />
                                                <div style={{ fontSize: '0.85rem' }}>
                                                    <span style={{ fontWeight: 600 }}>{s.apellido}, {s.nombre}</span>
                                                    <span style={{ margin: '0 0.5rem', opacity: 0.3 }}>|</span>
                                                    <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.75rem' }}>{s.email}</span>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                    <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))', fontWeight: 600 }}>
                                        {selectedSocioIds.length} socios seleccionados
                                    </div>
                                </div>
                            )}

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Título del Mensaje</label>
                                <input 
                                    type="text" 
                                    value={notifTitulo}
                                    onChange={(e) => setNotifTitulo(e.target.value)}
                                    placeholder="Ej: Información Importante"
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'transparent' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Contenido</label>
                                <textarea 
                                    rows={4}
                                    value={notifMensaje}
                                    onChange={(e) => setNotifMensaje(e.target.value)}
                                    placeholder="Escribe el mensaje aquí..."
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'transparent' }}
                                />
                            </div>
                            
                            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                <button 
                                    onClick={() => setShowModal(false)}
                                    style={{ flex: 1, padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', backgroundColor: 'transparent', fontWeight: 600, cursor: 'pointer' }}
                                >
                                    Cancelar
                                </button>
                                <button 
                                    onClick={handleSend}
                                    disabled={isSending || !notifTitulo || !notifMensaje || (recipientMode === 'manual' && selectedSocioIds.length === 0)}
                                    style={{ 
                                        flex: 2, 
                                        padding: '0.75rem', 
                                        borderRadius: 'var(--radius)', 
                                        backgroundColor: 'hsl(var(--primary))', 
                                        color: 'hsl(var(--primary-foreground))', 
                                        border: 'none', 
                                        fontWeight: 700, 
                                        cursor: 'pointer',
                                        opacity: isSending ? 0.7 : 1
                                    }}
                                >
                                    {isSending ? 'Enviando...' : 'Enviar Notificación'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
