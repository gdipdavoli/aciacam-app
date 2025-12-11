"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Pedido } from '@/types';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [orders, setOrders] = useState<Pedido[]>([]);
    const [socios, setSocios] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<string>('all');

    useEffect(() => {
        if (!authLoading) {
            if (!user || user.rol !== 'admin') {
                router.push('/');
                return;
            }

            Promise.all([
                StoreService.getAllPedidos(),
                StoreService.getAllSocios()
            ]).then(([ordersData, sociosData]) => {
                setOrders(ordersData.sort((a, b) => new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime()));

                const sociosMap: Record<string, string> = {};
                sociosData.forEach(s => {
                    sociosMap[s.id] = `${s.nombre} ${s.apellido}`;
                });
                setSocios(sociosMap);

                setLoading(false);
            });
        }
    }, [user, authLoading, router]);


    const handleStatusChange = async (pedidoId: string, newStatus: string) => {
        await StoreService.updatePedidoStatus(pedidoId, newStatus as any);
        // Refresh local state
        setOrders(prev => prev.map(o => o.id === pedidoId ? { ...o, estado: newStatus as any } : o));
    };

    const filteredOrders = filterStatus === 'all'
        ? orders
        : orders.filter(o => o.estado === filterStatus);

    if (loading || authLoading) return <p>Cargando panel...</p>;

    return (
        <div>
            <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Panel Admin</h1>
                    <p style={{ color: 'hsl(var(--muted-foreground))' }}>Gestión de pedidos.</p>
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button
                        onClick={() => router.push('/admin/orders/new')}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: 'var(--radius)',
                            backgroundColor: 'hsl(var(--primary))',
                            color: 'hsl(var(--primary-foreground))',
                            border: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: 500
                        }}
                    >
                        + Nueva Dispensa
                    </button>

                    <a href="/admin/products" style={{
                        padding: '0.5rem 1rem',
                        borderRadius: 'var(--radius)',
                        border: '1px solid hsl(var(--border))',
                        backgroundColor: 'hsl(var(--card))',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        textDecoration: 'none',
                        color: 'inherit',
                        fontSize: '0.9rem',
                        fontWeight: 500
                    }}>
                        📦 Productos
                    </a>

                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        style={{
                            padding: '0.5rem',
                            borderRadius: 'var(--radius)',
                            border: '1px solid hsl(var(--border))'
                        }}
                    >
                        <option value="all">Todos los estados</option>
                        <option value="pendiente">Pendiente</option>
                        <option value="confirmado">Confirmado</option>
                        <option value="en_preparacion">En Preparación</option>
                        <option value="en_camino">En Camino</option>
                        <option value="entregado">Entregado</option>
                        <option value="retirado">Retirado</option>
                        <option value="cancelado">Cancelado</option>
                    </select>
                </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid hsl(var(--border))', textAlign: 'left' }}>
                            <th style={{ padding: '1rem' }}>ID</th>
                            <th style={{ padding: '1rem' }}>Origen</th>
                            <th style={{ padding: '1rem' }}>Socio</th>
                            <th style={{ padding: '1rem' }}>Tipo</th>
                            <th style={{ padding: '1rem' }}>Estado</th>
                            <th style={{ padding: '1rem' }}>Items</th>
                            <th style={{ padding: '1rem' }}>Fecha</th>
                            <th style={{ padding: '1rem' }}>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOrders.map(order => (
                            <tr key={order.id} style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                                <td style={{ padding: '1rem' }}>#{order.id.slice(-6)}</td>
                                <td style={{ padding: '1rem' }}>
                                    {order.origen === 'admin' ? (
                                        <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', backgroundColor: '#e0e7ff', color: '#4338ca' }}>SEDE</span>
                                    ) : (
                                        <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', backgroundColor: '#f3f4f6', color: '#6b7280' }}>APP</span>
                                    )}
                                </td>
                                <td style={{ padding: '1rem' }}>
                                    <div style={{ fontWeight: 500 }}>{socios[order.socioId] || 'Desconocido'}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))' }}>ID: {order.socioId}</div>
                                </td>
                                <td style={{ padding: '1rem' }}>{order.tipoPedido === 'retiro_sede' ? 'Retiro' : 'Delivery'}</td>

                                <td style={{ padding: '1rem' }}>
                                    <span style={{
                                        padding: '0.25rem 0.5rem',
                                        borderRadius: '999px',
                                        fontSize: '0.8rem',
                                        backgroundColor: order.estado === 'pendiente' ? 'orange' : 'hsl(var(--muted))',
                                        color: order.estado === 'pendiente' ? 'white' : 'inherit'
                                    }}>
                                        {order.estado}
                                    </span>
                                </td>
                                <td style={{ padding: '1rem' }}>{order.items.length} items</td>
                                <td style={{ padding: '1rem' }}>{new Date(order.fechaCreacion).toLocaleDateString()}</td>
                                <td style={{ padding: '1rem' }}>
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <select
                                            value={order.estado}
                                            onChange={(e) => handleStatusChange(order.id, e.target.value)}
                                            style={{
                                                padding: '0.25rem',
                                                borderRadius: '4px',
                                                border: '1px solid hsl(var(--border))'
                                            }}
                                        >
                                            <option value="pendiente">Pendiente</option>
                                            <option value="confirmado">Confirmado</option>
                                            <option value="en_preparacion">En Prep.</option>
                                            <option value="en_camino">En Camino</option>
                                            <option value="retirado">Retirado</option>
                                            <option value="entregado">Entregado</option>
                                            <option value="cancelado">Cancelado</option>
                                        </select>

                                        <a href={`/admin/orders/${order.id}`} style={{
                                            padding: '0.25rem 0.5rem',
                                            backgroundColor: 'hsl(var(--secondary))',
                                            color: 'hsl(var(--secondary-foreground))',
                                            borderRadius: '4px',
                                            textDecoration: 'none',
                                            fontSize: '0.85rem'
                                        }}>
                                            Ver
                                        </a>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

        </div>
    );
}
