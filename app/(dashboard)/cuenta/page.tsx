"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Pago, Pedido } from '@/types';
import { User, CreditCard, History } from 'lucide-react';

export default function CuentaPage() {
    const { user } = useAuth();
    const [pagos, setPagos] = useState<Pago[]>([]);
    const [pedidos, setPedidos] = useState<Pedido[]>([]); // To show consumption history
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) {
            Promise.all([
                StoreService.getPagosBySocio(user.id),
                StoreService.getPedidosBySocio(user.id)
            ]).then(([pagosData, pedidosData]) => {
                setPagos(pagosData);
                setPedidos(pedidosData.filter(p => p.estado === 'retirado' || p.estado === 'entregado'));
                setLoading(false);
            });
        }
    }, [user]);

    if (!user) return null;

    return (
        <div>
            <div style={{ marginBottom: '2rem' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Mi Cuenta</h1>
                <p style={{ color: 'hsl(var(--muted-foreground))' }}>Estado de tu suscripción y consumos.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', alignItems: 'start' }}>

                {/* Profile Card */}
                <div style={{
                    backgroundColor: 'hsl(var(--card))',
                    borderRadius: 'var(--radius)',
                    border: '1px solid hsl(var(--border))',
                    padding: '2rem',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center'
                }}>
                    <div style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '50%',
                        backgroundColor: 'hsl(var(--muted))',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '1rem',
                        color: 'hsl(var(--muted-foreground))'
                    }}>
                        <User size={40} />
                    </div>
                    <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{user.nombre} {user.apellido}</h2>
                    <p style={{ color: 'hsl(var(--muted-foreground))', marginBottom: '1.5rem' }}>Socio #{user.id}</p>

                    <div style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid hsl(var(--border))' }}>
                            <span style={{ color: 'hsl(var(--muted-foreground))' }}>Email</span>
                            <span style={{ fontWeight: 500 }}>{user.email}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid hsl(var(--border))' }}>
                            <span style={{ color: 'hsl(var(--muted-foreground))' }}>Teléfono</span>
                            <span style={{ fontWeight: 500 }}>{user.telefono}</span>
                        </div>
                        {user.direccion && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid hsl(var(--border))' }}>
                                <span style={{ color: 'hsl(var(--muted-foreground))' }}>Dirección</span>
                                <span style={{ fontWeight: 500 }}>{user.direccion}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Subscription Status */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                    <div style={{
                        backgroundColor: 'hsl(var(--card))',
                        borderRadius: 'var(--radius)',
                        border: '1px solid hsl(var(--border))',
                        padding: '1.5rem'
                    }}>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                            <CreditCard size={20} />
                            Estado de Cuota
                        </h3>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <span>Última cuota paga:</span>
                            <span style={{ fontWeight: 600 }}>{user.estadoCuenta.ultimaCuotaPaga}</span>
                        </div>

                        <div style={{
                            backgroundColor: 'hsl(var(--primary) / 0.1)',
                            color: 'hsl(var(--primary))',
                            padding: '1rem',
                            borderRadius: 'var(--radius)',
                            textAlign: 'center',
                            fontWeight: 600
                        }}>
                            Estás al día con tu cuota
                        </div>
                    </div>

                    <div style={{
                        backgroundColor: 'hsl(var(--card))',
                        borderRadius: 'var(--radius)',
                        border: '1px solid hsl(var(--border))',
                        padding: '1.5rem'
                    }}>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                            <History size={20} />
                            Historial de Pagos
                        </h3>

                        {loading ? <p>Cargando...</p> : (
                            <ul style={{ listStyle: 'none', padding: 0 }}>
                                {pagos.map(pago => (
                                    <li key={pago.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
                                        <div>
                                            <div style={{ fontWeight: 500 }}>{pago.concepto}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))' }}>{pago.fecha}</div>
                                        </div>
                                        <div style={{ fontWeight: 600 }}>${pago.monto}</div>
                                    </li>
                                ))}
                                {pagos.length === 0 && <p style={{ fontSize: '0.9rem', color: 'hsl(var(--muted-foreground))' }}>No hay pagos registrados reciente.</p>}
                            </ul>
                        )}
                    </div>

                </div>

            </div>
        </div>
    );
}
