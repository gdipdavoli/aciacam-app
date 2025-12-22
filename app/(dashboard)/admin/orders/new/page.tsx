"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Socio, Producto, OrderType, OrderItem } from '@/types';
import { ArrowLeft, User, ShoppingBag, Truck, Check } from 'lucide-react';
import { SlotSelector } from '@/app/components/SlotSelector';

export default function NewDispensePage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();

    const [step, setStep] = useState<1 | 2 | 3>(1);

    // Step 1: Socio
    const [socios, setSocios] = useState<Socio[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSocio, setSelectedSocio] = useState<Socio | null>(null);

    // Step 2: Order Details
    const today = new Date().toISOString().split('T')[0];
    const [orderType, setOrderType] = useState<OrderType>('retiro_sede');
    const [address, setAddress] = useState('');
    const [date, setDate] = useState(today); // Legacy, kept for fallback
    const [notes, setNotes] = useState('');

    // Slot Logic
    const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
    const [slotLabel, setSlotLabel] = useState('');
    const [slotDate, setSlotDate] = useState('');

    // Step 3: Products
    const [products, setProducts] = useState<Producto[]>([]);
    const [cart, setCart] = useState<Record<string, number>>({});

    useEffect(() => {
        if (!authLoading) {
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                router.push('/');
                return;
            }
            StoreService.getAllSocios().then(setSocios);
            StoreService.getProductos().then(setProducts);
        }
    }, [user, authLoading, router]);

    const filteredSocios = socios.filter(s =>
        (s.nombre + ' ' + s.apellido).toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.dni.includes(searchTerm)
    );

    const handleSelectSocio = (s: Socio) => {
        setSelectedSocio(s);
        setAddress(s.direccion || '');
        setStep(2);
    };

    const handleNextStep = () => {
        if (orderType === 'retiro_sede' && !selectedSlotId) {
            alert('Por favor selecciona un turno de retiro.');
            return;
        }
        if (orderType === 'delivery' && !address) {
            alert('Por favor completa la dirección.');
            return;
        }
        setStep(3);
    }

    const handleAddToCart = (id: string, qty: number) => {
        setCart(prev => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + qty) }));
    };

    const totalItems = Object.values(cart).reduce((a, b) => a + b, 0);

    const handleConfirm = async () => {
        if (!selectedSocio) return;

        const items: OrderItem[] = Object.entries(cart)
            .filter(([_, qty]) => qty > 0)
            .map(([id, qty]) => {
                const prod = products.find(p => p.id === id);
                return {
                    productoId: id,
                    cantidad: qty,
                    productoNombre: prod?.nombre || 'Desconocido'
                };
            });

        if (items.length === 0) {
            alert('El pedido debe tener al menos un producto.');
            return;
        }

        try {
            await StoreService.createPedido(selectedSocio.id, items, orderType, {
                origen: 'admin',
                direccionEntrega: orderType === 'delivery' ? address : undefined,
                observaciones: notes,
                fechaRetiroPreferida: orderType === 'retiro_sede' ? slotDate : undefined,
                slotId: orderType === 'retiro_sede' ? selectedSlotId! : undefined,
                estado: 'confirmado' // Auto-confirm admin orders
            });
            alert('Dispensa creada correctamente');
            router.push('/admin');
        } catch (e) {
            console.error(e);
            alert('Error al crear dispensa');
        }
    };

    if (authLoading) return <div style={{ padding: '2rem' }}>Cargando...</div>;

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '3rem' }}>
            {/* Header */}
            <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button onClick={() => router.back()} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                    <ArrowLeft />
                </button>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Nueva Dispensa Manual</h1>
            </div>

            {/* Stepper */}
            <div style={{ display: 'flex', marginBottom: '2rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '1rem' }}>
                {[1, 2, 3].map(s => (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '2rem', opacity: step >= s ? 1 : 0.4 }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: step >= s ? 'hsl(var(--primary))' : 'hsl(var(--muted))', color: step >= s ? 'white' : 'black', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 600 }}>{s}</div>
                        <span style={{ fontWeight: 500 }}>{s === 1 ? 'Socio' : s === 2 ? 'Entrega' : 'Productos'}</span>
                    </div>
                ))}
            </div>

            {/* STEP 1: SELECT SOCIO */}
            {step === 1 && (
                <div>
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Buscar Socio</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type="text"
                                placeholder="Nombre, DNI..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                style={{ width: '100%', padding: '0.75rem', paddingLeft: '2.5rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
                                autoFocus
                            />
                            <SearchIcon style={{ position: 'absolute', left: 10, top: 12, opacity: 0.5 }} size={18} />
                        </div>
                    </div>

                    <div style={{ border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', maxHeight: '400px', overflowY: 'auto' }}>
                        {filteredSocios.map(s => (
                            <div
                                key={s.id}
                                onClick={() => handleSelectSocio(s)}
                                style={{ padding: '1rem', borderBottom: '1px solid hsl(var(--border))', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            >
                                <div>
                                    <div style={{ fontWeight: 600 }}>{s.apellido}, {s.nombre}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))' }}>DNI: {s.dni}</div>
                                </div>
                                <div style={{ color: 'hsl(var(--primary))', fontSize: '0.9rem' }}>Seleccionar →</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* STEP 2: ORDER DETAILS */}
            {step === 2 && selectedSocio && (
                <div>
                    <div style={{ padding: '1rem', backgroundColor: 'hsl(var(--muted))', borderRadius: 'var(--radius)', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <strong>Socio:</strong> {selectedSocio.nombre} {selectedSocio.apellido} (DNI {selectedSocio.dni})
                        </div>
                        <button onClick={() => setStep(1)} style={{ fontSize: '0.8rem', color: 'blue', border: 'none', background: 'none', cursor: 'pointer' }}>Cambiar</button>
                    </div>

                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Tipo de Entrega</label>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button
                                onClick={() => setOrderType('retiro_sede')}
                                style={{
                                    flex: 1, padding: '1rem', borderRadius: 'var(--radius)', border: orderType === 'retiro_sede' ? '2px solid hsl(var(--primary))' : '1px solid hsl(var(--border))',
                                    backgroundColor: orderType === 'retiro_sede' ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                                    cursor: 'pointer'
                                }}
                            >
                                🏢 Retiro en Sede
                            </button>
                            <button
                                onClick={() => setOrderType('delivery')}
                                style={{
                                    flex: 1, padding: '1rem', borderRadius: 'var(--radius)', border: orderType === 'delivery' ? '2px solid hsl(var(--primary))' : '1px solid hsl(var(--border))',
                                    backgroundColor: orderType === 'delivery' ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                                    cursor: 'pointer'
                                }}
                            >
                                🛵 Delivery
                            </button>
                        </div>
                    </div>

                    {orderType === 'retiro_sede' ? (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Turno de Retiro</label>
                            <SlotSelector
                                selectedSlotId={selectedSlotId}
                                onSelect={(id, label, date) => {
                                    setSelectedSlotId(id);
                                    setSlotLabel(label);
                                    setSlotDate(date);
                                }}
                            />
                        </div>
                    ) : (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Dirección de Entrega</label>
                            <input type="text" value={address} onChange={e => setAddress(e.target.value)} style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }} />
                        </div>
                    )}

                    <div style={{ marginBottom: '2rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Observaciones / Notas</label>
                        <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', minHeight: '80px', backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }} placeholder="Opcional..." />
                    </div>

                    <button
                        onClick={handleNextStep}
                        style={{ width: '100%', padding: '1rem', backgroundColor: 'hsl(var(--primary))', color: 'white', border: 'none', borderRadius: 'var(--radius)', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                        Continuar
                    </button>
                </div>
            )}

            {/* STEP 3: PRODUCTS */}
            {step === 3 && (
                <div>
                    <h3 style={{ marginBottom: '1rem' }}>Seleccionar Productos</h3>
                    <div style={{ marginBottom: '2rem' }}>
                        {products.map(p => {
                            const qty = cart[p.id] || 0;
                            return (
                                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', borderBottom: '1px solid hsl(var(--border))' }}>
                                    <div>
                                        <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                                        <div style={{ fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>{p.tipo} - {p.categoria}</div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        {qty > 0 && (
                                            <button onClick={() => handleAddToCart(p.id, -1)} style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid hsl(var(--border))', cursor: 'pointer' }}>-</button>
                                        )}
                                        <span style={{ width: 30, textAlign: 'center', fontWeight: 600 }}>{qty}</span>
                                        <button onClick={() => handleAddToCart(p.id, 1)} style={{ width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', backgroundColor: 'hsl(var(--primary))', color: 'white', border: 'none' }}>+</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div style={{ padding: '1.5rem', backgroundColor: 'hsl(var(--card))', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                        <h4 style={{ marginBottom: '1rem' }}>Resumen del Pedido</h4>
                        {totalItems === 0 ? (
                            <p style={{ color: 'hsl(var(--muted-foreground))' }}>Selecciona productos para continuar.</p>
                        ) : (
                            <ul style={{ marginBottom: '1.5rem', paddingLeft: '1rem' }}>
                                {Object.entries(cart).filter(([_, q]) => q > 0).map(([id, q]) => {
                                    const p = products.find(x => x.id === id);
                                    return <li key={id}>{p?.nombre} x {q}</li>
                                })}
                            </ul>
                        )}

                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button
                                onClick={() => setStep(2)}
                                style={{ flex: 1, padding: '1rem', backgroundColor: 'transparent', color: 'inherit', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Volver
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={totalItems === 0}
                                style={{ flex: 2, padding: '1rem', backgroundColor: 'hsl(var(--primary))', color: 'white', border: 'none', borderRadius: 'var(--radius)', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', opacity: totalItems === 0 ? 0.5 : 1 }}
                            >
                                Confirmar Dispensa
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const SearchIcon = ({ size, style }: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
);
