"use client";

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Pedido, Socio, OrderType } from '@/types';
import { ArrowLeft, CheckCircle, Clock, Package } from 'lucide-react';

export default function OrderDetailsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const id = params?.id as string;

    const [order, setOrder] = useState<Pedido | null>(null);
    const [socio, setSocio] = useState<Socio | null>(null);
    const [loading, setLoading] = useState(true);



    useEffect(() => {
        if (!authLoading) {
            if (!user || user.rol !== 'admin') {
                router.push('/');
                return;
            }

            // Load Order
            StoreService.getAllPedidos().then(async (allOrders) => {
                const foundOrder = allOrders.find(o => o.id === id);
                if (foundOrder) {
                    setOrder(foundOrder);
                    // Load Socio
                    const allSocios = await StoreService.getAllSocios();
                    const foundSocio = allSocios.find(s => s.id === foundOrder.socioId);
                    setSocio(foundSocio || null);
                }
                setLoading(false);
            });
        }
    }, [user, authLoading, router, id]);

    const handleStatusChange = async (newStatus: string) => {
        if (order) {
            await StoreService.updatePedidoStatus(order.id, newStatus as any);
            setOrder({ ...order, estado: newStatus as any });
        }
    };

    if (loading || authLoading) return <div style={{ padding: '2rem' }}>Cargando detalle...</div>;
    if (!order) return <div style={{ padding: '2rem' }}>Pedido no encontrado.</div>;

    const translateStatus = (status: string) => {
        return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ');
    };

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '2rem' }}>
            <button
                onClick={() => router.back()}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    marginBottom: '1rem',
                    color: 'hsl(var(--muted-foreground))'
                }}
            >
                <ArrowLeft size={20} />
                Volver
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '2rem' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>Pedido #{order.id.slice(-6)}</h1>
                    <p style={{ color: 'hsl(var(--muted-foreground))' }}>
                        Realizado el {new Date(order.fechaCreacion).toLocaleDateString()} a las {new Date(order.fechaCreacion).toLocaleTimeString()}
                    </p>
                </div>

                <div style={{ textAlign: 'right' }}>
                    <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Estado Actual</div>
                    <select
                        value={order.estado}
                        onChange={(e) => handleStatusChange(e.target.value)}
                        style={{
                            padding: '0.5rem',
                            borderRadius: 'var(--radius)',
                            border: '1px solid hsl(var(--border))',
                            fontSize: '1rem'
                        }}
                    >
                        <option value="pendiente">Pendiente</option>
                        <option value="confirmado">Confirmado</option>
                        <option value="en_preparacion">En Preparación</option>
                        <option value="en_camino">En Camino</option>
                        <option value="retirado">Retirado</option>
                        <option value="entregado">Entregado</option>
                        <option value="cancelado">Cancelado</option>
                    </select>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>

                {/* Datos del Pedido */}
                <section style={{
                    backgroundColor: 'hsl(var(--card))',
                    borderRadius: 'var(--radius)',
                    border: '1px solid hsl(var(--border))',
                    padding: '1.5rem'
                }}>
                    <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                        Detalles de Entrega
                    </h3>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <span style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>Tipo</span>
                            <span style={{ fontWeight: 500 }}>{order.tipoPedido === 'retiro_sede' ? 'Retiro en Sede' : 'Delivery'}</span>
                        </div>

                        {order.tipoPedido === 'retiro_sede' ? (
                            <>
                                <div>
                                    <span style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>Fecha Preferida</span>
                                    <span>{order.fechaRetiroPreferida || '-'}</span>
                                </div>
                                <div>
                                    <span style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>Franja Horaria</span>
                                    <span>{order.franjaHoraria || '-'}</span>
                                </div>
                            </>
                        ) : (
                            <>
                                <div>
                                    <span style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>Dirección</span>
                                    <span>{order.direccionEntrega || '-'}</span>
                                </div>
                                <div>
                                    <span style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>Localidad</span>
                                    <span>{order.localidad || '-'}</span>
                                </div>
                            </>
                        )}

                        <div style={{ gridColumn: 'span 2' }}>
                            <span style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>Observaciones</span>
                            <span style={{ fontStyle: 'italic' }}>{order.observaciones || 'Sin observaciones'}</span>
                        </div>
                    </div>
                </section>

                {/* Datos del Socio */}
                <section style={{
                    backgroundColor: 'hsl(var(--card))',
                    borderRadius: 'var(--radius)',
                    border: '1px solid hsl(var(--border))',
                    padding: '1.5rem'
                }}>
                    <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                        Datos del Socio
                    </h3>
                    {socio ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <span style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>Nombre Completo</span>
                                <span>{socio.nombre} {socio.apellido}</span>
                            </div>
                            <div>
                                <span style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>Email</span>
                                <span>{socio.email}</span>
                            </div>
                            <div>
                                <span style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>Teléfono</span>
                                <span>{socio.telefono}</span>
                            </div>
                            <div>
                                <span style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>DNI</span>
                                <span>{socio.dni}</span>
                            </div>
                        </div>
                    ) : (
                        <p>Información del socio no disponible.</p>
                    )}
                </section>

                {/* Items */}
                <section style={{
                    backgroundColor: 'hsl(var(--card))',
                    borderRadius: 'var(--radius)',
                    border: '1px solid hsl(var(--border))',
                    padding: '1.5rem'
                }}>
                    <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                        Productos ({order.items.length})
                    </h3>

                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        {order.items.map((item, idx) => (
                            <li key={idx} style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                borderBottom: idx < order.items.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                                padding: '0.75rem 0'
                            }}>
                                <span style={{ fontWeight: 500 }}>{item.cantidad}x {item.productoNombre}</span>
                            </li>
                        ))}
                    </ul>
                </section>

            </div>
        </div>
    );
}
