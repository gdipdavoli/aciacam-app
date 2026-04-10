"use client";

import React, { useEffect, useState } from 'react';
import { StoreService } from '@/services/storeService';
import { Pedido } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Package, Clock, CheckCircle, AlertCircle, MapPin, ExternalLink } from 'lucide-react';


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
                <div className="text-center p-16 bg-card rounded-lg border border-border">
                    <Package size={48} className="text-muted-foreground mb-4 opacity-50 mx-auto" />
                    <h3 className="text-xl font-semibold mb-2">No tienes pedidos aún</h3>
                    <p className="text-muted-foreground mb-6">
                        Explora las variedades y realiza tu primer pedido.
                    </p>
                    <a href="/variedades" className="inline-block bg-primary text-primary-foreground px-6 py-3 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors">
                        Ver Variedades
                    </a>
                </div>
            ) : (
                <div className="grid gap-3">
                    {orders.map(order => (
                        <div key={order.id} className="bg-card rounded-lg border border-border p-4 hover:border-primary/50 transition-colors">
                            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-3">
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-lg">
                                            {(() => {
                                                let displayDate: Date;
                                                // Fix Timezone for Socio View as well
                                                if (order.fechaRetiroPreferida && order.fechaRetiroPreferida.length === 10) {
                                                    displayDate = new Date(`${order.fechaRetiroPreferida}T00:00:00`);
                                                } else {
                                                    displayDate = order.fechaRetiroPreferida ? new Date(order.fechaRetiroPreferida) : new Date(order.fechaCreacion);
                                                }

                                                const dateStr = displayDate.toLocaleDateString('es-AR', {
                                                    day: 'numeric',
                                                    month: 'long'
                                                });

                                                // Capitalize
                                                return dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
                                            })()}
                                            {order.fechaRetiroPreferida && <span style={{ fontSize: '0.7em', color: 'hsl(var(--muted-foreground))', marginLeft: '6px' }}>(Fecha de Retiro)</span>}
                                        </span>
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide font-medium">
                                            {order.tipoPedido.replace('_', ' ')}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>#{order.id.slice(0, 8)}...</span>
                                        <span>•</span>
                                        {/* Show Time only if it's not a pure date-slot or if we have specific hour */}
                                        <span>
                                            {order.fechaRetiroPreferida && order.fechaRetiroPreferida.length === 10
                                                ? 'Turno Reservado'
                                                : new Date(order.fechaCreacion).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                            }
                                        </span>
                                    </div>
                                </div>

                                <div className={`
                                    self-start sm:self-center px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1.5
                                    ${order.estado === 'pendiente' ? 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border border-orange-500/20' :
                                        order.estado === 'confirmado' ? 'bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20' :
                                            'bg-destructive/10 text-destructive border border-destructive/20'}
                                `}>
                                    {order.estado === 'pendiente' && <Clock size={14} />}
                                    {order.estado === 'confirmado' && <CheckCircle size={14} />}
                                    {order.estado === 'cancelado' && <AlertCircle size={14} />}
                                    {getStatusLabel(order.estado)}
                                </div>
                            </div>

                            <div className="pt-3 border-t border-border/50">
                                <ul className="space-y-1">
                                    {order.items.map((item, idx) => (
                                        <li key={idx} className="text-sm text-foreground/80 flex justify-between items-center">
                                            <span className="flex items-center gap-2">
                                                <span className="font-medium bg-muted w-5 h-5 rounded flex items-center justify-center text-xs">
                                                    {item.cantidad}
                                                </span>
                                                {item.productoNombre}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {order.tipoPedido === 'retiro_sede' && order.estado === 'confirmado' && (
                                <div className="mt-3 pt-3 border-t border-border/50 flex items-start gap-3 text-sm">
                                    <MapPin size={16} className="text-muted-foreground shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-muted-foreground">Retiro por Sede: <span className="font-medium text-foreground">Alberdi 760, San Luis</span></p>
                                        <a
                                            href="https://maps.app.goo.gl/HtCe4QQrq5GptKZt8"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline inline-flex items-center gap-1 mt-1 text-xs font-medium"
                                        >
                                            Ver ubicación en mapa <ExternalLink size={10} />
                                        </a>
                                    </div>
                                </div>
                            )}

                            {order.tipoPedido === 'delivery' && order.entrega_estimada && (
                                <div className="mt-3 pt-3 border-t border-border/50 flex items-start gap-3 text-sm">
                                    <Clock size={16} className="text-primary shrink-0 mt-0.5" />
                                    <div className="bg-primary/5 p-3 rounded-md border border-primary/10 w-full">
                                        <p className="text-primary font-semibold mb-1">Visita Programada</p>
                                        <p className="text-foreground">{order.entrega_estimada}</p>
                                        <p className="text-[10px] text-muted-foreground mt-2 uppercase tracking-tight">
                                            Recibirás una notificación cuando estemos cerca
                                        </p>
                                    </div>
                                </div>
                            )}

                            {order.estado === 'pendiente' && (
                                <div className="mt-3 pt-3 border-t border-border/50 flex justify-end">
                                    <button
                                        onClick={async () => {
                                            if (!user) return;
                                            if (confirm('¿Estás seguro que deseas cancelar este pedido?')) {
                                                try {
                                                    await StoreService.cancelOrderSocio(order.id, user.id);
                                                    // Refresh list
                                                    const updated = await StoreService.getPedidosBySocio(user.id);
                                                    setOrders(updated.sort((a, b) => new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime()));
                                                } catch (e) {
                                                    alert('Error al cancelar el pedido');
                                                    console.error(e);
                                                }
                                            }
                                        }}
                                        className="text-xs text-destructive hover:bg-destructive/10 px-3 py-1.5 rounded-md font-medium transition-colors border border-destructive/20"
                                    >
                                        Cancelar Pedido
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

