"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Pedido } from '@/types';
import { useRouter } from 'next/navigation';
import { getStatusLabel, getNextStatusOptions, shouldShowInDefaultList, isFinalStatus } from '@/helpers/orderHelpers';
import { MoreVertical, Navigation } from 'lucide-react'; // Added for Mobile Menu

export default function AdminPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [orders, setOrders] = useState<Pedido[]>([]);
    const [socios, setSocios] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    // User Requirement: "Debe seguir existiendo y solo mostrarse si el usuario filtra"
    // Default filter: 'active' (hides status 3)
    const [filterStatus, setFilterStatus] = useState<string>('active');

    useEffect(() => {
        if (!authLoading) {
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                router.push('/'); // Redirect unauthorized to home (or show access denied)
                return;
            }

            Promise.all([
                StoreService.getAllPedidos(),
                StoreService.getAllSocios()
            ]).then(([ordersData, sociosData]) => {
                // Sort by Agenda Date (fechaRetiroPreferida)
                setOrders(ordersData.sort((a, b) => {
                    // Use a far future date for nulls if we want them last, or epoch if first. 
                    // Usually pending/active orders have a date.
                    const dateA = a.fechaRetiroPreferida ? new Date(a.fechaRetiroPreferida).getTime() : new Date(a.fechaCreacion).getTime();
                    const dateB = b.fechaRetiroPreferida ? new Date(b.fechaRetiroPreferida).getTime() : new Date(b.fechaCreacion).getTime();
                    return dateA - dateB;
                }));

                const sociosMap: Record<string, string> = {};
                sociosData.forEach(s => {
                    sociosMap[s.id] = `${s.nombre} ${s.apellido}`;
                });
                setSocios(sociosMap);

                setLoading(false);
            });
        }
    }, [user, authLoading, router]);


    // State for Confirm Modal
    const [pendingChange, setPendingChange] = useState<{ id: string, newStatus: string, currentStatus: string } | null>(null);

    const handleStatusChangeRequest = (pedidoId: string, newStatus: string) => {
        const order = orders.find(o => o.id === pedidoId);
        if (order) {
            setPendingChange({
                id: pedidoId,
                newStatus,
                currentStatus: order.estado
            });
        }
    };

    const confirmStatusChange = async () => {
        if (!pendingChange) return;

        const { id, newStatus } = pendingChange;

        await StoreService.updatePedidoStatus(id, newStatus as any);
        // Refresh local state
        setOrders(prev => prev.map(o => o.id === id ? { ...o, estado: newStatus as any } : o));

        setPendingChange(null);
    };

    const cancelStatusChange = () => {
        setPendingChange(null);
        // React re-render will reset the select value to order.estado automatically
    };

    const filteredOrders = orders.filter(o => {
        if (filterStatus === 'all') return true;
        if (filterStatus === 'active') return shouldShowInDefaultList(o.estado);
        if (filterStatus === 'finalized') return isFinalStatus(o.estado);
        return o.estado === filterStatus;
    });

    if (loading || authLoading) return <p>Cargando panel...</p>;

    return (
        <div>
            <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Gestión de pedidos</h1>
                    <p style={{ color: 'hsl(var(--muted-foreground))' }}>Gestión de pedidos.</p>
                </div>

                <div className="flex items-center gap-2">
                    {/* Primary Action - Always Visible but compact on mobile */}
                    <button
                        onClick={() => router.push('/admin/orders/new')}
                        className="flex items-center gap-2 bg-primary text-primary-foreground px-3 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                        <span>+ <span className="hidden sm:inline">Nueva Dispensa</span><span className="sm:hidden">Nueva</span></span>
                    </button>

                    {/* Desktop Secondary Actions */}
                    <div className="hidden md:flex gap-2">
                        <button
                            onClick={async () => {
                                if (confirm('¿Archivar todos los pedidos finalizados (Entregados/Cancelados/Retirados) de la lista? No se borrarán de la base de datos.')) {
                                    setLoading(true);
                                    try {
                                        await StoreService.archiveFinishedOrders();
                                        // Refresh
                                        const ordersData = await StoreService.getAllPedidos();
                                        setOrders(ordersData.sort((a, b) => {
                                            const dateA = a.fechaRetiroPreferida ? new Date(a.fechaRetiroPreferida).getTime() : new Date(a.fechaCreacion).getTime();
                                            const dateB = b.fechaRetiroPreferida ? new Date(b.fechaRetiroPreferida).getTime() : new Date(b.fechaCreacion).getTime();
                                            return dateA - dateB;
                                        }));
                                    } catch (e) {
                                        alert('Error al archivar pedidos');
                                        console.error(e);
                                    } finally {
                                        setLoading(false);
                                    }
                                }
                            }}
                            className="flex items-center gap-2 bg-card border border-border px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                            title="Archivar pedidos finalizados"
                        >
                            🧹 Limpiar
                        </button>

                        <a href="/admin/products" className="flex items-center gap-2 bg-card border border-border px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-muted transition-colors no-underline">
                            📦 Productos
                        </a>
                    </div>

                    {/* Mobile Menu for Secondary Actions */}
                    <div className="md:hidden relative">
                        <details className="group relative">
                            <summary className="list-none cursor-pointer p-2 border border-border rounded bg-card text-foreground hover:bg-muted">
                                <MoreVertical size={20} />
                            </summary>
                            <div className="absolute right-0 top-full mt-2 w-48 bg-card border border-border rounded shadow-lg z-50 p-1 flex flex-col gap-1">
                                <button
                                    onClick={async () => {
                                        if (confirm('¿Archivar todos los pedidos finalizados?')) {
                                            setLoading(true);
                                            try { await StoreService.archiveFinishedOrders(); window.location.reload(); } catch (e) { console.error(e); setLoading(false); }
                                        }
                                    }}
                                    className="text-left w-full px-4 py-2 text-sm hover:bg-muted rounded text-foreground"
                                >
                                    🧹 Limpiar Lista
                                </button>
                                <a href="/admin/products" className="block w-full px-4 py-2 text-sm hover:bg-muted rounded text-foreground no-underline">
                                    📦 Ver Productos
                                </a>
                            </div>
                        </details>
                    </div>

                    {/* Filter Select */}
                    <div className="relative inline-block w-full max-w-[140px] md:max-w-[200px]">
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="w-full appearance-none px-3 py-2 pr-8 rounded-lg border border-input bg-background/50 hover:bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring transition-colors cursor-pointer"
                        >
                            <option value="active">Activos</option>
                            <option value="finalized">Finalizados</option>
                            <option value="all">Todos</option>
                            <option disabled>──────────</option>
                            <option value="pendiente">Pendiente</option>
                            <option value="en_preparacion">En Prep.</option>
                            <option value="confirmado">Confirmado</option>
                            <option value="en_camino">En Camino</option>
                            <option value="entregado">Entregado</option>
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                            </svg>
                        </div>
                    </div>
                </div>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid hsl(var(--border))', textAlign: 'left' }}>
                            <th style={{ padding: '1rem' }}>Origen</th>
                            <th style={{ padding: '1rem' }}>Socio</th>
                            <th style={{ padding: '1rem' }}>Tipo</th>
                            <th style={{ padding: '1rem' }}>Estado</th>
                            <th style={{ padding: '1rem' }}>Productos</th>
                            <th style={{ padding: '1rem' }}>Fecha Turno</th>
                            <th style={{ padding: '1rem' }}>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOrders.map(order => {
                            // Display Date Logic: Show User Preferred Date first
                            let displayDate: Date;
                            const isAgendaDate = !!order.fechaRetiroPreferida;

                            // Fix Timezone Issue: 
                            // If fechaRetiroPreferida is YYYY-MM-DD (len 10), appending T00:00:00 makes it Local Midnight instead of UTC Midnight.
                            if (order.fechaRetiroPreferida && order.fechaRetiroPreferida.length === 10) {
                                displayDate = new Date(`${order.fechaRetiroPreferida}T00:00:00`);
                            } else {
                                displayDate = order.fechaRetiroPreferida ? new Date(order.fechaRetiroPreferida) : new Date(order.fechaCreacion);
                            }

                            return (
                                <tr
                                    key={order.id}
                                    style={{ borderBottom: '1px solid hsl(var(--border))', cursor: 'pointer' }}
                                    onClick={() => router.push(`/admin/orders/${order.id}`)}
                                    className="hover:bg-muted/50 transition-colors"
                                >
                                    <td style={{ padding: '1rem' }}>
                                        {order.origen === 'admin' ? (
                                            <span className="text-[0.75rem] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300">SEDE</span>
                                        ) : (
                                            <span className="text-[0.75rem] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">APP</span>
                                        )}
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <div style={{ fontWeight: 500 }}>{socios[order.socioId] || 'Desconocido'}</div>
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <div className="flex items-center gap-2">
                                            {order.tipoPedido === 'retiro_sede' ? (
                                                <span className="text-amber-600 dark:text-amber-400 font-medium">Retiro</span>
                                            ) : (
                                                <span className="text-blue-600 dark:text-blue-400 font-medium">Delivery</span>
                                            )}
                                            {order.ubicacion_gps && (
                                                <a 
                                                    href={order.ubicacion_gps} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer" 
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="p-1 px-2.5 bg-green-100 text-green-700 rounded-md hover:bg-green-200 transition-colors"
                                                    title="Ver GPS"
                                                >
                                                    <Navigation size={12} className="rotate-45" />
                                                </a>
                                            )}
                                        </div>
                                    </td>

                                    <td style={{ padding: '1rem' }}>
                                        <span className={`
                                            px-2 py-1 rounded-full text-xs border
                                            ${order.estado === 'pendiente'
                                                ? 'bg-orange-500 text-white border-orange-600'
                                                : 'bg-muted text-foreground border-border'}
                                        `}>
                                            {getStatusLabel(order.estado, order.tipoPedido)}
                                        </span>
                                    </td>
                                    <td style={{ padding: '1rem', maxWidth: '300px' }}>
                                        <div className="text-sm text-muted-foreground truncate">
                                            {order.items.map(i => `${i.cantidad}x ${i.productoNombre}`).join(', ')}
                                        </div>
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <div style={{ fontWeight: isAgendaDate ? 600 : 400 }}>
                                            {displayDate.toLocaleDateString()}
                                            {isAgendaDate && <span className="block text-xs text-muted-foreground">{displayDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} hs</span>}
                                        </div>
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <div onClick={e => e.stopPropagation()}>
                                            <div className="relative inline-block w-full max-w-[160px]">
                                                <select
                                                    value={order.estado}
                                                    onChange={(e) => handleStatusChangeRequest(order.id, e.target.value)}
                                                    className="w-full appearance-none bg-background border border-input text-foreground px-3 py-1.5 pr-8 rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring hover:bg-muted/50 transition-colors cursor-pointer"
                                                >
                                                    <option value="" disabled>Cambiar estado...</option>
                                                    {getNextStatusOptions(order.tipoPedido).map(opt => (
                                                        <option key={opt.value} value={opt.value}>
                                                            {opt.label}
                                                        </option>
                                                    ))}
                                                </select>
                                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                                                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                                        <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {filteredOrders.length === 0 && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'hsl(var(--muted-foreground))' }}>
                        No hay pedidos en esta vista ({filterStatus === 'active' ? 'Activos' : filterStatus}).
                    </div>
                )}
            </div>

            {/* Mobile Cards View */}
            <div className="md:hidden flex flex-col gap-4">
                {filteredOrders.map(order => {
                    let displayDate: Date;
                    const isAgendaDate = !!order.fechaRetiroPreferida;
                    if (order.fechaRetiroPreferida && order.fechaRetiroPreferida.length === 10) {
                        displayDate = new Date(`${order.fechaRetiroPreferida}T00:00:00`);
                    } else {
                        displayDate = order.fechaRetiroPreferida ? new Date(order.fechaRetiroPreferida) : new Date(order.fechaCreacion);
                    }

                    return (
                        <div
                            key={order.id}
                            onClick={() => router.push(`/admin/orders/${order.id}`)}
                            className="bg-card border border-border rounded-lg p-4 shadow-sm active:scale-[0.98] transition-transform"
                        >
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <div className="font-semibold text-lg">{socios[order.socioId] || 'Desconocido'}</div>
                                    <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                                        {order.tipoPedido === 'retiro_sede' ? '🏢 Retiro' : '🛵 Delivery'}
                                        <span>•</span>
                                        <span>{displayDate.toLocaleDateString()}</span>
                                        {order.ubicacion_gps && (
                                            <>
                                                <span>•</span>
                                                <a 
                                                    href={order.ubicacion_gps} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer" 
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-green-600 font-bold flex items-center gap-1"
                                                >
                                                    <Navigation size={12} className="rotate-45" /> Map Pin
                                                </a>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <span className={`
                                    px-2 py-1 rounded text-xs font-bold uppercase tracking-wide
                                    ${order.estado === 'pendiente' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' : 'bg-muted text-muted-foreground'}
                                `}>
                                    {getStatusLabel(order.estado, order.tipoPedido)}
                                </span>
                            </div>

                            <div className="mb-4 text-sm bg-muted/50 p-2 rounded">
                                {order.items.map(i => `${i.cantidad}x ${i.productoNombre}`).join(', ')}
                            </div>

                            <div onClick={e => e.stopPropagation()}>
                                <select
                                    value={order.estado}
                                    onChange={(e) => handleStatusChangeRequest(order.id, e.target.value)}
                                    className="w-full bg-background border border-input text-foreground px-3 py-2 rounded-md text-sm font-medium"
                                >
                                    <option value="" disabled>Cambiar estado...</option>
                                    {getNextStatusOptions(order.tipoPedido).map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    );
                })}
                {filteredOrders.length === 0 && (
                    <div className="text-center p-8 text-muted-foreground">
                        No hay pedidos ({filterStatus === 'active' ? 'Activos' : filterStatus}).
                    </div>
                )}
            </div>

            {/* Confirm Modal */}
            {pendingChange && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
                }}>
                    <div className="bg-card p-8 rounded-lg max-w-md w-full border border-border shadow-lg">
                        <h3 className="text-lg font-bold mb-4">¿Confirmar cambio de estado?</h3>
                        <p className="mb-6 text-muted-foreground">
                            El pedido pasará a <strong>
                                {getStatusLabel(pendingChange.newStatus as any,
                                    orders.find(o => o.id === pendingChange.id)?.tipoPedido || 'retiro_sede'
                                )}
                            </strong>.
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                            <button onClick={cancelStatusChange} className="px-4 py-2 rounded hover:bg-muted transition-colors">Cancelar</button>
                            <button onClick={confirmStatusChange} className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity">Confirmar</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
