"use client";

import React, { useState, useEffect } from 'react';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { OrderType } from '@/types';
import { useRouter } from 'next/navigation';
import { Trash2, Plus, Minus, MapPin, CheckCircle, Navigation } from 'lucide-react';
import { SlotSelector } from '@/app/components/SlotSelector';
import { toast } from 'sonner';

export default function CheckoutPage() {
    const { items, removeItem, itemCount, clearCart, updateQuantity, pesoTotal } = useCart();

    const { user, refreshUser } = useAuth();
    const router = useRouter();

    React.useEffect(() => {
        if (user) {
            if (user.rol === 'admin') {
                router.push('/admin');
            } else if (user.bloqueado) {
                router.push('/variedades');
            }
        }
    }, [user, router]);

    const [orderType, setOrderType] = useState<OrderType>('delivery');
    const [observaciones, setObservaciones] = useState('');

    // Delivery fields
    const [direccion, setDireccion] = useState(user?.direccion || '');
    const [localidad, setLocalidad] = useState(user?.localidad || '');
    const [ubicacionGps, setUbicacionGps] = useState('');
    const [guardarPerfil, setGuardarPerfil] = useState(false);
    const [isFetchingLocation, setIsFetchingLocation] = useState(false);

    // Retiro fields
    const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
    const [slotLabel, setSlotLabel] = useState('');
    const [slotDate, setSlotDate] = useState('');
    const [coordinarConAdmin, setCoordinarConAdmin] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [finalAporte, setFinalAporte] = useState(0);

    // Global Configs
    const [globalConfigs, setGlobalConfigs] = useState({
        aporte_por_gramo: 10000,
        limite_gramos_max: 40,
        limite_gramos_min: 5
    });

    useEffect(() => {
        StoreService.getGlobalConfigs().then(data => {
            if (Object.keys(data).length > 0) {
                setGlobalConfigs(prev => ({ ...prev, ...data }));
            }
        });
    }, []);

    // Sync address fields with profile when it loads
    React.useEffect(() => {
        if (user && !direccion && !localidad) {
            if (user.direccion) setDireccion(user.direccion);
            if (user.localidad) setLocalidad(user.localidad);
        }
    }, [user]);

    const hasStoredAddress = !!(user?.direccion || user?.localidad);
    const isDifferentFromStored = user && (direccion !== user.direccion || localidad !== (user.localidad || ''));

    const handleGetLocation = () => {
        if (!navigator.geolocation) {
            toast.error("Tu navegador no soporta geolocalización");
            return;
        }

        setIsFetchingLocation(true);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
                setUbicacionGps(mapsLink);
                setIsFetchingLocation(false);
                toast.success("📍 Ubicación capturada con éxito. Se enviará junto a tu pedido.");
            },
            (error) => {
                console.error("Geolocation error:", error);
                setIsFetchingLocation(false);
                toast.error("No pudimos obtener tu ubicación. Por favor, asegúrate de dar permisos al navegador.");
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    };

    if (itemCount === 0 && !showSuccessModal) {
        return (
            <div style={{ textAlign: 'center', padding: '4rem' }}>
                <h2>Tu solicitud está vacía</h2>
                <a href="/variedades" style={{ display: 'inline-block', marginTop: '1rem', color: 'hsl(var(--primary))' }}>
                    Ver opciones de tratamiento
                </a>
            </div>
        );
    }

    const handleCheckout = async () => {
        if (!user) return;

        // 1. FRESH STOCK CHECK (To prevent race conditions)
        setIsSubmitting(true);
        try {
            const freshProducts = await StoreService.getProductos();
            for (const item of items) {
                const freshProd = freshProducts.find(p => p.id === item.productoId);
                if (!freshProd || freshProd.stockDisponible < item.cantidad) {
                    toast.error(`Lo sentimos, el stock de "${item.productoNombre}" ha cambiado y ya no hay unidades suficientes disponibles.`);
                    setIsSubmitting(false);
                    return;
                }
            }
        } catch (stockErr) {
            console.error("Stock pre-check failed", stockErr);
            toast.error("No se pudo verificar el stock disponible en este momento. Por favor, reintente en unos instantes.");
            setIsSubmitting(false);
            return;
        }

        if (orderType === 'retiro_sede' && !selectedSlotId && !coordinarConAdmin) {
            toast.warning("Por favor selecciona un turno para retirar o marca la opción para coordinar con administración.");
            setIsSubmitting(false);
            return;
        }
        if (orderType === 'delivery' && (!direccion || !localidad)) {
            toast.warning("Por favor completa los datos de envío.");
            setIsSubmitting(false);
            return;
        }

        setIsSubmitting(true);

        try {
            const finalObservaciones = coordinarConAdmin 
                ? `${observaciones}\n\nSOLICITUD: Coordinar retiro con administración.` 
                : observaciones;

            await StoreService.createPedido(user.id, items, orderType, {
                observaciones: finalObservaciones,
                direccionEntrega: orderType === 'delivery' ? direccion : undefined,
                localidad: orderType === 'delivery' ? localidad : undefined,
                ubicacion_gps: orderType === 'delivery' ? ubicacionGps : undefined,
                fechaRetiroPreferida: orderType === 'retiro_sede' ? (coordinarConAdmin ? undefined : slotDate) : undefined,
                slotId: orderType === 'retiro_sede' ? (coordinarConAdmin ? undefined : selectedSlotId!) : undefined
            });

            if (orderType === 'delivery' && guardarPerfil) {
                try {
                    await StoreService.updateSocio(user.id, {
                        direccion,
                        localidad
                    });
                    await refreshUser();
                } catch (profileError) {
                    console.error("Failed to update profile", profileError);
                }
            }

            setFinalAporte(pesoTotal * globalConfigs.aporte_por_gramo);
            setShowSuccessModal(true);
            clearCart();
        } catch (error) {
            console.error("Failed to create order", error);
            toast.error("Hubo un error al crear el pedido");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            {showSuccessModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-card w-full max-w-md rounded-2xl shadow-2xl border border-border p-8 animate-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center text-center mb-8">
                            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
                                <CheckCircle size={40} />
                            </div>
                            <h2 className="text-3xl font-bold text-foreground tracking-tight">¡Solicitud Exitosa!</h2>
                            <p className="text-muted-foreground mt-3 leading-relaxed">
                                Tu solicitud ha sido registrada. Por favor, realiza el aporte para confirmar el pedido.
                            </p>
                        </div>

                        <div className="space-y-4 mb-8">
                            <div className="bg-primary/5 rounded-xl p-5 border border-primary/20">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-sm font-medium text-muted-foreground">Total a transferir</span>
                                    <span className="text-xs font-bold bg-primary/10 text-primary px-2 py-0.5 rounded uppercase">Pendiente</span>
                                </div>
                                <div className="text-3xl font-black text-primary">
                                    ${finalAporte.toLocaleString('es-AR')}
                                </div>
                            </div>

                            <div className="bg-muted/50 rounded-xl p-5 border border-border">
                                <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                                    🏦 Datos de Transferencia
                                </h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs text-muted-foreground">Alias</span>
                                        <span className="text-sm font-black bg-background px-3 py-1 rounded border border-border select-all">
                                            ACIACAM
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs text-muted-foreground">Banco</span>
                                        <span className="text-sm font-medium">Galicia</span>
                                    </div>
                                </div>
                            </div>

                            {orderType === 'retiro_sede' && (
                                <div className="bg-muted/30 rounded-xl p-4 border border-border flex items-start gap-3">
                                    <MapPin className="text-primary mt-1 shrink-0" size={18} />
                                    <div>
                                        <h3 className="text-xs font-bold text-foreground">Retiro en Sede</h3>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            Alberdi 760, San Luis
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={() => router.push('/pedidos')}
                            className="w-full py-4 px-4 bg-primary text-primary-foreground rounded-xl font-bold hover:opacity-90 transition-all shadow-lg shadow-primary/20"
                        >
                            Ver mis pedidos
                        </button>
                    </div>
                </div>
            )}

            <h1 style={{ marginBottom: '2rem', fontSize: '2rem' }}>Solicitud Mensual</h1>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-8 items-start">

                {/* Form Column */}
                <div className="min-w-0 flex flex-col gap-6">
                    <section style={{ backgroundColor: 'hsl(var(--card))', padding: '1.5rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                        <h3 style={{ marginBottom: '1rem' }}>Modalidad de Entrega</h3>
                        <div className="flex flex-col sm:flex-row gap-4">
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
                                border: `2px solid ${!user?.envios_habilitados ? 'hsl(var(--muted))' : (orderType === 'delivery' ? 'hsl(var(--primary))' : 'hsl(var(--border))')}`,
                                cursor: 'pointer',
                                backgroundColor: orderType === 'delivery' ? 'hsl(var(--primary) / 0.05)' : 'transparent',
                                opacity: 1,
                                position: 'relative'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <input
                                        type="radio"
                                        name="orderType"
                                        value="delivery"
                                        checked={orderType === 'delivery'}
                                        onChange={() => setOrderType('delivery')}
                                        style={{ marginRight: '0.5rem' }}
                                    />
                                    <div>
                                        <span style={{ display: 'block', fontWeight: 500 }}>Envío a Domicilio</span>
                                    </div>
                                </div>
                            </label>
                        </div>
                    </section>

                    <section style={{ backgroundColor: 'hsl(var(--card))', padding: '1.5rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                        <h3 style={{ marginBottom: '1rem' }}>Detalles</h3>

                        {orderType === 'retiro_sede' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Seleccionar Turno de Retiro</label>
                                    <SlotSelector
                                        selectedSlotId={selectedSlotId}
                                        onSelect={(id, label, date) => {
                                            setSelectedSlotId(id);
                                            setSlotLabel(label);
                                            setSlotDate(date);
                                            setCoordinarConAdmin(false);
                                        }}
                                    />

                                    <div style={{ 
                                        marginTop: '1.5rem', 
                                        padding: '1rem', 
                                        borderRadius: 'var(--radius)', 
                                        border: `1px dashed ${coordinarConAdmin ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
                                        backgroundColor: coordinarConAdmin ? 'hsl(var(--primary) / 0.05)' : 'transparent',
                                        transition: 'all 0.2s ease'
                                    }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                                            <input 
                                                type="checkbox" 
                                                checked={coordinarConAdmin}
                                                onChange={(e) => {
                                                    setCoordinarConAdmin(e.target.checked);
                                                    if (e.target.checked) {
                                                        setSelectedSlotId(null);
                                                        setSlotLabel('');
                                                        setSlotDate('');
                                                    }
                                                }}
                                                style={{ width: '18px', height: '18px', accentColor: 'hsl(var(--primary))' }}
                                            />
                                            <div>
                                                <span style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem' }}>Coordinar con administración</span>
                                                <span style={{ display: 'block', fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))' }}>Elegí esta opción si no encontrás un turno conveniente.</span>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4">
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Dirección de Entrega</label>
                                    <input
                                        type="text"
                                        value={direccion}
                                        onChange={(e) => setDireccion(e.target.value)}
                                        placeholder="Calle 123, Depto 4B"
                                        className="w-full p-3 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                    />
                                </div>
                                <div>
                                    <div className="flex justify-between items-end mb-2">
                                        <label style={{ display: 'block', fontSize: '0.9rem' }}>Localidad / Barrio</label>
                                        {hasStoredAddress && isDifferentFromStored && (
                                            <button 
                                                type="button"
                                                onClick={() => {
                                                    setDireccion(user.direccion || '');
                                                    setLocalidad(user.localidad || '');
                                                }}
                                                className="text-xs text-primary font-semibold hover:underline flex items-center gap-1"
                                            >
                                                🏠 Usar mi domicilio guardado
                                            </button>
                                        )}
                                    </div>
                                    <input
                                        type="text"
                                        value={localidad}
                                        onChange={(e) => setLocalidad(e.target.value)}
                                        placeholder="Palermo, CABA"
                                        className="w-full p-3 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                    />
                                </div>

                                <div className="pt-2 border-t border-border mt-2">
                                    <div className="flex flex-col gap-3">
                                        <button
                                            type="button"
                                            onClick={handleGetLocation}
                                            disabled={isFetchingLocation}
                                            className={`flex items-center justify-center gap-2 w-full p-2.5 rounded-md border text-sm font-medium transition-all ${
                                                ubicacionGps 
                                                ? 'bg-green-50 border-green-200 text-green-700' 
                                                : 'bg-secondary/50 border-border text-foreground hover:bg-secondary'
                                            }`}
                                        >
                                            {isFetchingLocation ? (
                                                <>Capturando...</>
                                            ) : ubicacionGps ? (
                                                <>Ubicación GPS capturada</>
                                            ) : (
                                                <>
                                                    <Navigation size={18} className="rotate-45" />
                                                    Compartir mi ubicación GPS (Opcional)
                                                </>
                                            )}
                                        </button>

                                        <label className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={guardarPerfil}
                                                onChange={(e) => setGuardarPerfil(e.target.checked)}
                                                className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                            />
                                            <div className="flex flex-col">
                                                <span className="text-sm font-semibold">Guardar domicilio</span>
                                                <span className="text-xs text-muted-foreground">Usar esta dirección para mis futuros pedidos</span>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div style={{ marginTop: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Disponibilidad Horaria / Observaciones</label>
                            <textarea
                                value={observaciones}
                                onChange={(e) => setObservaciones(e.target.value)}
                                rows={3}
                                placeholder="Ej: Disponible de lunes a viernes después de las 17hs..."
                                className="w-full p-3 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                            />
                        </div>
                    </section>

                    <button
                        onClick={handleCheckout}
                        disabled={isSubmitting}
                        style={{
                            width: '100%',
                            padding: '1rem',
                            backgroundColor: isSubmitting ? 'hsl(var(--muted))' : 'hsl(var(--primary))',
                            color: isSubmitting ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary-foreground))',
                            border: 'none',
                            borderRadius: 'var(--radius)',
                            fontWeight: 600,
                            fontSize: '1rem',
                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                            opacity: isSubmitting ? 0.7 : 1
                        }}
                    >
                        {isSubmitting ? 'Procesando...' : 'Confirmar Solicitud'}
                    </button>

                    <div className="text-xs text-muted-foreground p-4 bg-muted/50 rounded-lg border border-border">
                        <p className="mb-2 text-justify">
                            "Las opciones aquí presentadas corresponden a variedades disponibles dentro del servicio de cultivo solidario brindado por la asociación. La selección realizada constituye una solicitud de provisión para tratamiento médico y no implica en ningún caso una operación de compra o comercialización de productos.
                        </p>
                        <p className="text-justify">
                            El aporte indicado corresponde exclusivamente a los costos operativos del servicio de cultivo, incluyendo insumos, mantenimiento y procesos asociados, en el marco de una actividad sin fines de lucro."
                        </p>
                    </div>
                </div>

                {/* Right Column: Order Summary (Non-sticky, inline flow) */}
                <div style={{
                    backgroundColor: 'hsl(var(--card))',
                    borderRadius: 'var(--radius)',
                    border: '1px solid hsl(var(--border))',
                    padding: '1.5rem'
                }}>
                    <h3 style={{ marginBottom: '1rem' }}>Resumen de Solicitud</h3>
                    <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1.5rem' }}>
                        {items.map(item => (
                            <li key={item.productoId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', fontSize: '0.95rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                    <span style={{ fontWeight: 500 }}>{item.productoNombre}</span>
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500, fontSize: '1rem' }}>
                                <span>Total solicitado (gramos)</span>
                                <span>{pesoTotal}g</span>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '1.1rem', marginTop: '1rem', borderTop: '1px dashed hsl(var(--border))', paddingTop: '1rem' }}>
                                <span>Aporte estimado</span>
                                <span>${(pesoTotal * globalConfigs.aporte_por_gramo).toLocaleString('es-AR')}</span>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
