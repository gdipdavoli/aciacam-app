"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { ArrowLeft } from 'lucide-react';

export default function NewSocioPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        nombre: '',
        apellido: '',
        dni: '',
        email: '',
        telefono: '',
        direccion: '',
        localidad: '',
        provincia: '',
        notas: ''
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            await StoreService.createSocio({
                ...formData,
                rol: 'member',
                estadoCuenta: {
                    saldo: 0,
                    ultimaCuotaPaga: new Date().toISOString().slice(0, 7) // Current month
                },
            },
                reprocann: { estado: 'pendiente' },
                documentacion: {
                declaracionJurada: { estado: 'pendiente' },
                contratoCultivo: { estado: 'pendiente' },
                consentimientoInformado: { estado: 'pendiente' },
                recetaMedica: { estado: 'pendiente' }
            }
            });
        router.push('/admin/socios');
    } catch (error) {
        console.error(error);
        alert('Error al crear socio');
    } finally {
        setLoading(false);
    }
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

        <h1 style={{ fontSize: '2rem', marginBottom: '2rem' }}>Registrar Nuevo Socio</h1>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            {/* Personal Info */}
            <div style={{ gridColumn: 'span 2', backgroundColor: 'hsl(var(--card))', padding: '1.5rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>Datos Personales</h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Nombre *</label>
                        <input required name="nombre" value={formData.nombre} onChange={handleChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid hsl(var(--border))' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Apellido *</label>
                        <input required name="apellido" value={formData.apellido} onChange={handleChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid hsl(var(--border))' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>DNI *</label>
                        <input required name="dni" value={formData.dni} onChange={handleChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid hsl(var(--border))' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Teléfono *</label>
                        <input required name="telefono" value={formData.telefono} onChange={handleChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid hsl(var(--border))' }} />
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Email *</label>
                        <input required type="email" name="email" value={formData.email} onChange={handleChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid hsl(var(--border))' }} />
                    </div>
                </div>
            </div>

            {/* Address */}
            <div style={{ gridColumn: 'span 2', backgroundColor: 'hsl(var(--card))', padding: '1.5rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>Domicilio</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div style={{ gridColumn: 'span 2' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Dirección</label>
                        <input name="direccion" value={formData.direccion} onChange={handleChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid hsl(var(--border))' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Localidad</label>
                        <input name="localidad" value={formData.localidad} onChange={handleChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid hsl(var(--border))' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Provincia</label>
                        <input name="provincia" value={formData.provincia} onChange={handleChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid hsl(var(--border))' }} />
                    </div>
                </div>
            </div>

            {/* Notes */}
            <div style={{ gridColumn: 'span 2', backgroundColor: 'hsl(var(--card))', padding: '1.5rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>Notas / Observaciones</h3>
                <textarea
                    name="notas"
                    value={formData.notas}
                    onChange={handleChange}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', minHeight: '100px' }}
                    placeholder="Información clínica o administrativa relevante..."
                />
            </div>

            <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'end', gap: '1rem' }}>
                <button type="button" onClick={() => router.back()} style={{ padding: '0.75rem 1.5rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', background: 'transparent', cursor: 'pointer' }}>
                    Cancelar
                </button>
                <button
                    type="submit"
                    disabled={loading}
                    style={{
                        padding: '0.75rem 1.5rem',
                        backgroundColor: 'hsl(var(--primary))',
                        color: 'hsl(var(--primary-foreground))',
                        border: 'none',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        opacity: loading ? 0.7 : 1
                    }}
                >
                    {loading ? 'Guardando...' : 'Crear Socio'}
                </button>
            </div>
        </form>
    </div>
);
}
