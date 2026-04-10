"use client";

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Pedido, Socio, OrderType } from '@/types';
import { ArrowLeft, CheckCircle, Clock, Package, ExternalLink, Send, Calendar } from 'lucide-react';

import { getStatusLabel, getNextStatusOptions } from '@/helpers/orderHelpers';
import { NotificationService } from '@/services/notificationService';

export default function OrderDetailsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const id = params?.id as string;

    const [order, setOrder] = useState<Pedido | null>(null);
    const [socio, setSocio] = useState<Socio | null>(null);
    const [loading, setLoading] = useState(true);

    // Edit & Products State
    const [isEditing, setIsEditing] = useState(false);
    const [editedItems, setEditedItems] = useState<any[]>([]);
    const [allProducts, setAllProducts] = useState<any[]>([]);
    const [showAddProduct, setShowAddProduct] = useState(false);

    // Confirmation State
    const [pendingStatus, setPendingStatus] = useState<string | null>(null);
    const [showStatusConfirm, setShowStatusConfirm] = useState(false);
    const [showSaveConfirm, setShowSaveConfirm] = useState(false);

    // Delivery Assignment State
    const [isUpdatingDelivery, setIsUpdatingDelivery] = useState(false);
    const [editedEntregaEstimada, setEditedEntregaEstimada] = useState('');
    const [isSendingAppNotification, setIsSendingAppNotification] = useState(false);

    useEffect(() => {
        if (!authLoading) {
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                router.push('/');
                return;
            }

            // Load Order
            StoreService.getAllPedidos().then(async (allOrders) => {
                const foundOrder = allOrders.find(o => o.id === id);
                if (foundOrder) {
                    setOrder(foundOrder);
                    setEditedItems(foundOrder.items); // Init edit state
                    setEditedEntregaEstimada(foundOrder.entrega_estimada || '');
                    // Load Socio
                    const allSocios = await StoreService.getAllSocios();
                    const foundSocio = allSocios.find(s => s.id === foundOrder.socioId);
                    setSocio(foundSocio || null);
                }
                setLoading(false);
            });

            // Load Products for Editing
            StoreService.getProductos(true).then(setAllProducts);
        }
    }, [user, authLoading, router, id]);
    const handleStatusChangeRequest = (newStatus: string) => {
        setPendingStatus(newStatus);
        setShowStatusConfirm(true);
    };

    const confirmStatusChange = async () => {
        if (order && pendingStatus) {
            await StoreService.updatePedidoStatus(order.id, pendingStatus as any);
            // No need to setOrder locally if we are redirecting
            // setOrder({ ...order, estado: pendingStatus as any });
            setShowStatusConfirm(false);
            setPendingStatus(null);
            router.push('/admin'); // Redirect to list
        }
    };

    // Edit Logic
    const deleteItem = (idx: number) => {
        const newItems = [...editedItems];
        newItems.splice(idx, 1);
        setEditedItems(newItems);
    };

    const updateItemQuantity = (idx: number, change: number) => {
        const newItems = [...editedItems];
        const item = { ...newItems[idx] };
        item.cantidad = Math.max(1, item.cantidad + change);
        newItems[idx] = item;
        setEditedItems(newItems);
    };

    const addItemToOrder = (productId: string) => {
        const product = allProducts.find(p => p.id === productId);
        if (product) {
            setEditedItems([...editedItems, {
                productoId: product.id,
                productoNombre: product.nombre,
                cantidad: 1,
                precioUnitario: product.precio
            }]);
            setShowAddProduct(false);
        }
    };

    const saveOrderChanges = async () => {
        if (order) {
            await StoreService.updatePedidoItems(order.id, editedItems);
            setOrder({ ...order, items: editedItems });
            setIsEditing(false);
            setShowSaveConfirm(false);
        }
    };

    const handleUpdateDelivery = async () => {
        if (order) {
            setIsUpdatingDelivery(true);
            try {
                await StoreService.updatePedidoDelivery(order.id, {
                    entrega_estimada: editedEntregaEstimada
                });
                setOrder({ ...order, entrega_estimada: editedEntregaEstimada });
                alert("Programación de entrega actualizada");
            } catch (error) {
                console.error("Failed to update delivery", error);
                alert("Error al actualizar la entrega");
            } finally {
                setIsUpdatingDelivery(false);
            }
        }
    };

    const sendWhatsAppNotification = () => {
        if (!socio || !order) return;
        
        const message = `Hola ${socio.nombre}! Te informamos que tu pedido #${order.id.slice(-6)} de ACIACAM tiene una visita programada para el día/horario: ${editedEntregaEstimada || order.entrega_estimada}. ¡Muchas gracias!`;
        const encodedMessage = encodeURIComponent(message);
        const url = `https://wa.me/${socio.telefono.replace(/\D/g, '')}?text=${encodedMessage}`;
        window.open(url, '_blank');
    };

    const sendAppNotification = async () => {
        if (!socio || !order) return;
        setIsSendingAppNotification(true);
        try {
            await NotificationService.sendNotification({
                socioId: socio.id,
                titulo: "Entrega Programada",
                mensaje: `Tu pedido #${order.id.slice(-6)} tiene una visita programada para: ${editedEntregaEstimada || order.entrega_estimada}.`,
                tipo: 'delivery',
                metadata: { pedidoId: order.id }
            });
            alert("Notificación enviada a la App del socio");
        } catch (error) {
            console.error("Failed to send app notification", error);
            alert("Error al enviar notificación a la App");
        } finally {
            setIsSendingAppNotification(false);
        }
    };

    if (loading || authLoading) return <div style={{ padding: '2rem' }}>Cargando detalle...</div>;
    if (!order) return <div style={{ padding: '2rem' }}>Pedido no encontrado.</div>;

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

                <div className="text-right">
                    <div className="mb-2 font-semibold">Estado Actual</div>
                    <div className="relative inline-block w-full max-w-[200px]">
                        <select
                            value={order.estado}
                            onChange={(e) => handleStatusChangeRequest(e.target.value)}
                            className={`w-full appearance-none px-4 py-2 pr-10 rounded-lg border border-input text-base font-medium focus:outline-none focus:ring-2 focus:ring-ring transition-colors cursor-pointer ${pendingStatus
                                    ? 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-700'
                                    : 'bg-background text-foreground'
                                }`}
                        >
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
            </div>

            {/* ... (sections same) ... */}
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

                                {order.ubicacion_gps && (
                                    <div style={{ gridColumn: 'span 2' }}>
                                        <span style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>Ubicación exacta (GPS)</span>
                                        <a 
                                            href={order.ubicacion_gps} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 text-primary hover:underline font-semibold mt-1"
                                        >
                                            Ver en Google Maps <ExternalLink size={14} />
                                        </a>
                                    </div>
                                )}
                            </>
                        )}

                        <div style={{ gridColumn: 'span 2' }}>
                            <span style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>Observaciones / Disponibilidad</span>
                            <span style={{ fontStyle: 'italic' }}>{order.observaciones || 'Sin observaciones'}</span>
                        </div>
                    </div>

                    {order.tipoPedido === 'delivery' && (
                        <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px dashed hsl(var(--border))' }}>
                            <h4 style={{ marginBottom: '1rem', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Calendar size={18} className="text-primary" />
                                Programación de Entrega
                            </h4>
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'end' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))', marginBottom: '0.25rem' }}>Día y Horario Estimado</label>
                                    <input 
                                        type="text"
                                        value={editedEntregaEstimada}
                                        onChange={(e) => setEditedEntregaEstimada(e.target.value)}
                                        placeholder="Ej: Lunes de 10 a 14hs"
                                        className="w-full p-2 rounded-md border border-input bg-background"
                                    />
                                </div>
                                <button 
                                    onClick={handleUpdateDelivery}
                                    disabled={isUpdatingDelivery || editedEntregaEstimada === order.entrega_estimada}
                                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 disabled:opacity-50 transition-all"
                                >
                                    {isUpdatingDelivery ? 'Guardando...' : 'Guardar'}
                                </button>
                                <button 
                                    onClick={sendWhatsAppNotification}
                                    disabled={!order.entrega_estimada && !editedEntregaEstimada}
                                    className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-all flex items-center gap-2"
                                    title="Notificar por WhatsApp"
                                >
                                    <Send size={16} /> WhatsApp
                                </button>
                                <button 
                                    onClick={sendAppNotification}
                                    disabled={isSendingAppNotification || (!order.entrega_estimada && !editedEntregaEstimada)}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center gap-2"
                                    title="Notificar por App"
                                >
                                    <Bell size={16} /> {isSendingAppNotification ? 'Enviando...' : 'App'}
                                </button>
                            </div>
                        </div>
                    )}
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                        <h3 style={{ margin: 0 }}>
                            Productos ({isEditing ? editedItems.length : order.items.length})
                        </h3>
                        {!isEditing ? (
                            <button
                                onClick={() => setIsEditing(true)}
                                style={{
                                    fontSize: '0.85rem',
                                    padding: '0.25rem 0.5rem',
                                    backgroundColor: 'hsl(var(--secondary))',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }}
                            >
                                Modificar
                            </button>
                        ) : (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    onClick={() => {
                                        setEditedItems(order.items);
                                        setIsEditing(false);
                                    }}
                                    style={{
                                        fontSize: '0.85rem',
                                        padding: '0.25rem 0.5rem',
                                        background: 'none',
                                        border: '1px solid hsl(var(--border))',
                                        borderRadius: '4px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={() => setShowSaveConfirm(true)}
                                    style={{
                                        fontSize: '0.85rem',
                                        padding: '0.25rem 0.5rem',
                                        backgroundColor: 'hsl(var(--primary))',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Guardar
                                </button>
                            </div>
                        )}
                    </div>

                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        {(isEditing ? editedItems : order.items).map((item, idx) => (
                            <li key={idx} style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderBottom: '1px solid hsl(var(--border))',
                                padding: '0.75rem 0'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    {isEditing && (
                                        <button
                                            onClick={() => deleteItem(idx)}
                                            style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.5rem' }}
                                            title="Eliminar"
                                        >x</button>
                                    )}
                                    <span style={{ fontWeight: 500 }}>
                                        {item.productoNombre}
                                    </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    {isEditing ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'hsl(var(--muted))', borderRadius: '4px', padding: '2px' }}>
                                            <button onClick={() => updateItemQuantity(idx, -1)} style={{ width: '24px', border: 'none', background: 'none', cursor: 'pointer' }}>-</button>
                                            <span style={{ fontWeight: 600, minWidth: '20px', textAlign: 'center' }}>{item.cantidad}</span>
                                            <button onClick={() => updateItemQuantity(idx, 1)} style={{ width: '24px', border: 'none', background: 'none', cursor: 'pointer' }}>+</button>
                                        </div>
                                    ) : (
                                        <span style={{ fontWeight: 600 }}>x{item.cantidad}</span>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>

                    {isEditing && (
                        <div style={{ marginTop: '1rem', borderTop: '1px dashed hsl(var(--border))', paddingTop: '1rem' }}>
                            {!showAddProduct ? (
                                <button
                                    onClick={() => setShowAddProduct(true)}
                                    style={{
                                        width: '100%',
                                        padding: '0.5rem',
                                        border: '1px dashed hsl(var(--muted-foreground))',
                                        background: 'hsl(var(--muted) / 0.3)',
                                        color: 'hsl(var(--muted-foreground))',
                                        cursor: 'pointer',
                                        borderRadius: 'var(--radius)'
                                    }}
                                >
                                    + Agregar Producto
                                </button>
                            ) : (
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <select
                                        onChange={(e) => addItemToOrder(e.target.value)}
                                        defaultValue=""
                                        style={{ flex: 1, padding: '0.5rem', borderRadius: '4px', border: '1px solid hsl(var(--input))' }}
                                    >
                                        <option value="" disabled>Seleccionar producto...</option>
                                        {allProducts.map(p => (
                                            <option key={p.id} value={p.id}>{p.nombre} ({p.stockDisponible})</option>
                                        ))}
                                    </select>
                                    <button onClick={() => setShowAddProduct(false)} style={{ padding: '0.5rem', cursor: 'pointer' }}>Cancelar</button>
                                </div>
                            )}
                        </div>
                    )}
                </section>

                {/* Confirm Modals (Simple Inline Overlays) */}
                {showStatusConfirm && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-card p-8 rounded-xl max-w-md w-full border border-border shadow-xl">
                            <h3 className="text-xl font-bold mb-4">¿Confirmar cambio de estado?</h3>
                            <p className="text-muted-foreground mb-6">
                                El pedido pasará a <strong className="text-foreground">{getStatusLabel(pendingStatus as any, order.tipoPedido)}</strong>.
                            </p>
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setShowStatusConfirm(false)}
                                    className="px-4 py-2 rounded-lg hover:bg-muted transition-colors font-medium"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={confirmStatusChange}
                                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity font-medium"
                                >
                                    Confirmar
                                </button>
                            </div>
                        </div>
                    </div>
                )}


                {showSaveConfirm && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-card p-8 rounded-xl max-w-md w-full border border-border shadow-xl">
                            <h3 className="text-xl font-bold mb-4">¿Guardar cambios en el pedido?</h3>
                            <p className="text-muted-foreground mb-6">Se actualizarán los items y cantidades.</p>
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setShowSaveConfirm(false)}
                                    className="px-4 py-2 rounded-lg hover:bg-muted transition-colors font-medium"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={saveOrderChanges}
                                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity font-medium"
                                >
                                    Guardar Cambios
                                </button>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
