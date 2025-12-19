"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { StoreService } from '@/services/storeService';
import { ChevronLeft, Save, UserPlus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function NewStaffPage() {
    const router = useRouter();
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);

    // Check access
    if (user && user.rol !== 'admin') {
        router.push('/');
        return null;
    }

    const [formData, setFormData] = useState({
        nombre: '',
        apellido: '',
        dni: '',
        email: '',
        telefono: '',
        // Defaults
        rol: 'staff',
        activo: true
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            await StoreService.createSocio({
                ...formData,
                rol: 'staff', // Enforce staff role
                estadoCuenta: {
                    saldo: 0,
                    ultimaCuotaPaga: new Date().toISOString().slice(0, 7) // Current month
                },
                // Fill required but irrelevant fields for staff with placeholders
                documentacion: {},
                reprocann: { estado: 'pendiente' }
            } as any); // Type assertion if strict missing props

            // Success
            router.push('/admin/equipo');
        } catch (error) {
            console.error('Error creating staff:', error);
            alert('Error al crear miembro del equipo. Revise la consola.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ marginBottom: '2rem' }}>
                <button
                    onClick={() => router.back()}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'hsl(var(--muted-foreground))',
                        marginBottom: '1rem'
                    }}
                >
                    <ChevronLeft size={20} />
                    Volver
                </button>
                <h1 style={{ fontSize: '2rem', fontWeight: 600 }}>Nuevo Miembro del Equipo</h1>
                <p style={{ color: 'hsl(var(--muted-foreground))' }}>Registrar un usuario interno (Staff).</p>
            </div>

            <form onSubmit={handleSubmit} style={{
                backgroundColor: 'hsl(var(--card))',
                padding: '2rem',
                borderRadius: 'var(--radius)',
                border: '1px solid hsl(var(--border))',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.5rem'
            }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Nombre</label>
                        <input
                            required
                            name="nombre"
                            value={formData.nombre}
                            onChange={handleChange}
                            style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Apellido</label>
                        <input
                            required
                            name="apellido"
                            value={formData.apellido}
                            onChange={handleChange}
                            style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}
                        />
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Email (Login)</label>
                        <input
                            required
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>ID Interno / DNI</label>
                        <input
                            required
                            name="dni"
                            placeholder="Legajo o DNI"
                            value={formData.dni}
                            onChange={handleChange}
                            style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}
                        />
                    </div>
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Teléfono</label>
                    <input
                        required
                        name="telefono"
                        value={formData.telefono}
                        onChange={handleChange}
                        style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}
                    />
                </div>

                <div style={{ paddingTop: '1rem', borderTop: '1px solid hsl(var(--border))', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            backgroundColor: 'hsl(var(--primary))',
                            color: 'hsl(var(--primary-foreground))',
                            border: 'none',
                            padding: '0.75rem 2rem',
                            borderRadius: 'var(--radius)',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            gap: '0.5rem',
                            alignItems: 'center',
                            opacity: loading ? 0.7 : 1
                        }}
                    >
                        <UserPlus size={18} />
                        {loading ? 'Creando...' : 'Crear Miembro'}
                    </button>
                </div>
            </form>
        </div>
    );
}
