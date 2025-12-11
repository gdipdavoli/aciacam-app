"use client";

import React, { useEffect, useState } from 'react';
import { StoreService } from '@/services/storeService';
import { Pedido } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Package, Clock, CheckCircle, AlertCircle } from 'lucide-react';


export default function MisPedidosPage() {
    const { user } = useAuth();
    const router = useRouter(); // Assume router is imported or needs import. Let's check previously read file. It wasn't imported. I need to add import.
    const [orders, setOrders] = useState<Pedido[]>([]);

    useEffect(() => {
        if (user && user.rol === 'admin') {
            router.push('/admin');
        }
    }, [user, router]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) {
            StoreService.getPedidosBySocio(user.id).then(data => {
                setOrders(data.sort((a, b) => new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime()));
                setLoading(false);
            });
        }
    }, [user]);

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'confirmado': return 'text-green-600 bg-green-50'; // Tailwind classes example if we used them, but we use inline for now or style objects
            case 'pendiente': return 'orange';
            case 'cancelado': return 'red';
            default: return 'gray';
        }
    };

    const getStatusLabel = (status: string) => {
        return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ');
    };

    return (
        <div>
            <div style={{ marginBottom: '2rem' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Mis Pedidos</h1>
                <p style={{ color: 'hsl(var(--muted-foreground))' }}>Historial y seguimiento de tus solicitudes.</p>
            </div>

            {loading ? (
                <p>Cargando...</p>
            ) : orders.length === 0 ? (
                <div style={{
                    textAlign: 'center',
                    padding: '4rem',
                    backgroundColor: 'hsl(var(--card))',
                    borderRadius: 'var(--radius)',
                    border: '1px solid hsl(var(--border))'
                }}>
                    <Package size={48} style={{ color: 'hsl(var(--muted-foreground))', marginBottom: '1rem', opacity: 0.5 }} />
                    <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>No tienes pedidos aún</h3>
                    <p style={{ color: 'hsl(var(--muted-foreground))', marginBottom: '1.5rem' }}>
                        Explora las variedades y realiza tu primer pedido.
                    </p>
                    <a href="/variedades" style={{
                        display: 'inline-block',
                        backgroundColor: 'hsl(var(--primary))',
                        color: 'hsl(var(--primary-foreground))',
                        padding: '0.75rem 1.5rem',
                        borderRadius: 'var(--radius)',
                        fontSize: '0.9rem',
                        fontWeight: 600
                    }}>
                        Ver Variedades
                    </a>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {orders.map(order => (
                        <div key={order.id} style={{
                            backgroundColor: 'hsl(var(--card))',
                            borderRadius: 'var(--radius)',
                            border: '1px solid hsl(var(--border))',
                            padding: '1.5rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '1rem'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                                        <span style={{ fontWeight: 600 }}>#{order.id}</span>
                                        <span style={{
                                            fontSize: '0.8rem',
                                            padding: '0.2rem 0.6rem',
                                            borderRadius: '999px',
                                            backgroundColor: 'hsl(var(--muted))',
                                            textTransform: 'uppercase'
                                        }}>
                                            {order.tipoPedido.replace('_', ' ')}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>
                                        {new Date(order.fechaCreacion).toLocaleDateString()} - {new Date(order.fechaCreacion).toLocaleTimeString()}
                                    </div>
                                </div>

                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    fontWeight: 500,
                                    color: getStatusColor(order.estado)
                                }}>
                                    {order.estado === 'pendiente' && <Clock size={16} />}
                                    {order.estado === 'confirmado' && <CheckCircle size={16} />}
                                    {getStatusLabel(order.estado)}
                                </div>
                            </div>

                            <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: '1rem' }}>
                                <p style={{ fontSize: '0.9rem', fontWeight: 500, marginBottom: '0.5rem' }}>Items:</p>
                                <ul style={{ listStyle: 'none', padding: 0 }}>
                                    {order.items.map((item, idx) => (
                                        <li key={idx} style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            fontSize: '0.9rem',
                                            marginBottom: '0.25rem',
                                            color: 'hsl(var(--muted-foreground))'
                                        }}>
                                            <span>{item.cantidad}x {item.productoNombre}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
