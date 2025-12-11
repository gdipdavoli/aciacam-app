"use client";

import React, { useState } from 'react';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { OrderType } from '@/types';
import { useRouter } from 'next/navigation';
import { Trash2, Plus, Minus } from 'lucide-react';

export default function CheckoutPage() {
    const { items, removeItem, itemCount, clearCart, updateQuantity } = useCart();

    const { user } = useAuth();
    const router = useRouter();

    React.useEffect(() => {
        if (user && user.rol === 'admin') {
            router.push('/admin');
        }
    }, [user, router]);

    const [step, setStep] = useState<1 | 2>(1);
    const [orderType, setOrderType] = useState<OrderType>('retiro_sede');
    const [observaciones, setObservaciones] = useState('');

    // Delivery fields
    const [direccion, setDireccion] = useState(user?.direccion || '');
    const [localidad, setLocalidad] = useState('');

    // Retiro fields
    const [fechaRetiro, setFechaRetiro] = useState('');
    const [franjaHoraria, setFranjaHoraria] = useState('');

    const [isSubmitting, setIsSubmitting] = useState(false);

    if (itemCount === 0) {
        return (
            <div style={{ textAlign: 'center', padding: '4rem' }}>
                <h2>Tu carrito está vacío</h2>
                <a href="/variedades" style={{ display: 'inline-block', marginTop: '1rem', color: 'hsl(var(--primary))' }}>
                    Volver al catálogo
                </a>
            </div>
        );
    }

    const handleCheckout = async () => {
        if (!user) return;
        setIsSubmitting(true);

        try {
            await StoreService.createPedido(user.id, items, orderType, {
                observaciones,
                direccionEntrega: orderType === 'delivery' ? direccion : undefined,
                localidad: orderType === 'delivery' ? localidad : undefined,
                fechaRetiroPreferida: orderType === 'retiro_sede' ? fechaRetiro : undefined,
                franjaHoraria: orderType === 'retiro_sede' ? franjaHoraria : undefined
            });

            clearCart();
            router.push('/pedidos'); // Go to orders list
        } catch (error) {
            console.error("Failed to create order", error);
            alert("Hubo un error al crear el pedido");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h1 style={{ marginBottom: '2rem', fontSize: '2rem' }}>Finalizar Pedido</h1>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '2rem', alignItems: 'start' }}>

                {/* Left Column: Form */}
                <div>
                    {step === 1 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <section style={{ backgroundColor: 'hsl(var(--card))', padding: '1.5rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                                <h3 style={{ marginBottom: '1rem' }}>Tipo de Pedido</h3>
                                <div style={{ display: 'flex', gap: '1rem' }}>
                                    <label style={{
                                        flex: 1,
                                        padding: '1rem',
                                        borderRadius: 'var(--radius)',
                                        border: `2px solid ${orderType === 'retiro_sede' ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
                                        cursor: 'pointer',
                                        backgroundColor: orderType === 'retiro_sede' ? 'hsl(var(--primary) / 0.05)' : 'transparent'
                                    }}>
                                        <input
                                            type="radio"
                                            name="orderType"
                                            value="retiro_sede"
                                            checked={orderType === 'retiro_sede'}
                                            onChange={() => setOrderType('retiro_sede')}
                                            style={{ marginRight: '0.5rem' }}
                                        />
                                        Retiro en Sede
                                    </label>

                                    <label style={{
                                        flex: 1,
                                        padding: '1rem',
                                        borderRadius: 'var(--radius)',
                                        border: `2px solid ${orderType === 'delivery' ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
                                        cursor: 'pointer',
                                        backgroundColor: orderType === 'delivery' ? 'hsl(var(--primary) / 0.05)' : 'transparent'
                                    }}>
                                        <input
                                            type="radio"
                                            name="orderType"
                                            value="delivery"
                                            checked={orderType === 'delivery'}
                                            onChange={() => setOrderType('delivery')}
                                            style={{ marginRight: '0.5rem' }}
                                        />
                                        Delivery
                                    </label>
                                </div>
                            </section>

                            <section style={{ backgroundColor: 'hsl(var(--card))', padding: '1.5rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                                <h3 style={{ marginBottom: '1rem' }}>Detalles</h3>

                                {orderType === 'retiro_sede' ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Día preferido</label>
                                            <input
                                                type="date"
                                                value={fechaRetiro}
                                                onChange={(e) => setFechaRetiro(e.target.value)}
                                                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--input))' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Franja Horaria</label>
                                            <select
                                                value={franjaHoraria}
                                                onChange={(e) => setFranjaHoraria(e.target.value)}
                                                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--input))' }}
                                            >
                                                <option value="">Seleccionar...</option>
                                                <option value="manana">Mañana (10 - 13hs)</option>
                                                <option value="tarde">Tarde (15 - 19hs)</option>
                                            </select>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Dirección de Entrega</label>
                                            <input
                                                type="text"
                                                value={direccion}
                                                onChange={(e) => setDireccion(e.target.value)}
                                                placeholder="Calle 123, Depto 4B"
                                                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--input))' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Localidad / Barrio</label>
                                            <input
                                                type="text"
                                                value={localidad}
                                                onChange={(e) => setLocalidad(e.target.value)}
                                                placeholder="Palermo, CABA"
                                                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--input))' }}
                                            />
                                        </div>
                                        <p style={{ fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>
                                            * El costo de envío se confirmará al procesar el pedido.
                                        </p>
                                    </div>
                                )}

                                <div style={{ marginTop: '1rem' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Observaciones</label>
                                    <textarea
                                        value={observaciones}
                                        onChange={(e) => setObservaciones(e.target.value)}
                                        rows={3}
                                        placeholder="Alguna aclaración..."
                                        style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--input))', resize: 'vertical' }}
                                    />
                                </div>
                            </section>

                            <button
                                onClick={handleCheckout}
                                disabled={isSubmitting}
                                style={{
                                    width: '100%',
                                    padding: '1rem',
                                    backgroundColor: 'hsl(var(--primary))',
                                    color: 'hsl(var(--primary-foreground))',
                                    border: 'none',
                                    borderRadius: 'var(--radius)',
                                    fontWeight: 600,
                                    fontSize: '1rem',
                                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                    opacity: isSubmitting ? 0.7 : 1
                                }}
                            >
                                {isSubmitting ? 'Procesando...' : 'Confirmar Pedido'}
                            </button>
                        </div>
                    )}
                </div>

                {/* Right Column: Order Summary */}
                <div style={{
                    backgroundColor: 'hsl(var(--card))',
                    borderRadius: 'var(--radius)',
                    border: '1px solid hsl(var(--border))',
                    padding: '1.5rem',
                    position: 'sticky',
                    top: '2rem'
                }}>
                    <h3 style={{ marginBottom: '1rem' }}>Resumen</h3>
                    <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1.5rem' }}>
                        {items.map(item => (
                            <li key={item.productoId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', fontSize: '0.95rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                    <span style={{ fontWeight: 500 }}>{item.productoNombre}</span>
                                    {/* <span style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))' }}>$ Total calc if needed</span> */}
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', backgroundColor: 'hsl(var(--muted))', borderRadius: 'var(--radius)' }}>
                                        <button
                                            onClick={() => updateQuantity(item.productoId, item.cantidad - 1)}
                                            style={{ padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}
                                        >
                                            <Minus size={14} />
                                        </button>
                                        <span style={{ fontSize: '0.9rem', width: '20px', textAlign: 'center' }}>{item.cantidad}</span>
                                        <button
                                            onClick={() => updateQuantity(item.productoId, item.cantidad + 1)}
                                            style={{ padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}
                                        >
                                            <Plus size={14} />
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => removeItem(item.productoId)}
                                        style={{ background: 'none', border: 'none', color: 'hsl(var(--destructive))', cursor: 'pointer', padding: '0.25rem' }}
                                        title="Eliminar"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                    <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '1.1rem' }}>
                            <span>Total unidades</span>
                            <span>{itemCount}</span>
                        </div>
                    </div>

                </div>

            </div>
        </div>
    );
}
