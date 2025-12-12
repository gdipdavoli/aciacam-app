"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Socio } from '@/types';
import { Plus, Search, User, AlertTriangle } from 'lucide-react';

export default function AdminSociosPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [socios, setSocios] = useState<Socio[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filter, setFilter] = useState<'all' | 'incomplete' | 'reprocann_issue' | 'contract_issue'>('all');

    useEffect(() => {
        if (!authLoading) {
            if (!user || user.rol !== 'admin') {
                router.push('/');
                return;
            }

            StoreService.getAllSocios().then(data => {
                setSocios(data);
                setLoading(false);
            });
        }
    }, [user, authLoading, router]);

    const getReprocannStatus = (socio: Socio) => socio.reprocann?.estado || 'pendiente';
    const getContractStatus = (socio: Socio) => socio.documentacion?.contrato?.estado || 'pendiente';

    const filteredSocios = socios.filter(s => {
        const matchesSearch =
            s.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.apellido.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.dni.includes(searchTerm) ||
            s.email.toLowerCase().includes(searchTerm.toLowerCase());

        if (!matchesSearch) return false;

        const reprocann = getReprocannStatus(s);
        const contrato = getContractStatus(s);

        if (filter === 'reprocann_issue') return ['pendiente', 'vencido', 'rechazado'].includes(reprocann);
        if (filter === 'contract_issue') return ['pendiente', 'vencido'].includes(contrato);
        if (filter === 'incomplete') {
            // Logic: any major doc missing or expired
            const rIssue = ['pendiente', 'vencido'].includes(reprocann);
            const cIssue = ['pendiente', 'vencido'].includes(contrato);
            return rIssue || cIssue;
        }

        return true;
    });

    if (loading || authLoading) return <div style={{ padding: '2rem' }}>Cargando socios...</div>;

    return (
        <div>
            <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Gestión de Socios</h1>
                    <p style={{ color: 'hsl(var(--muted-foreground))' }}>Administrar pacientes y documentación.</p>
                </div>
                <button
                    onClick={() => router.push('/admin/socios/new')}
                    style={{
                        backgroundColor: 'hsl(var(--primary))',
                        color: 'hsl(var(--primary-foreground))',
                        border: 'none',
                        padding: '0.75rem 1rem',
                        borderRadius: 'var(--radius)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        cursor: 'pointer',
                        fontWeight: 500
                    }}
                >
                    <Plus size={18} />
                    Nuevo Socio
                </button>
            </div>

            {/* Filters */}
            <div style={{
                display: 'flex',
                gap: '1rem',
                marginBottom: '1.5rem',
                flexWrap: 'wrap',
                backgroundColor: 'hsl(var(--card))',
                padding: '1rem',
                borderRadius: 'var(--radius)',
                border: '1px solid hsl(var(--border))'
            }}>
                <div style={{ flex: 1, position: 'relative', minWidth: '200px' }}>
                    <Search size={18} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))' }} />
                    <input
                        type="text"
                        placeholder="Buscar por nombre, DNI, email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '0.5rem 0.5rem 0.5rem 2.2rem',
                            borderRadius: 'var(--radius)',
                            border: '1px solid hsl(var(--border))',
                            outline: 'none'
                        }}
                    />
                </div>

                <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as any)}
                    style={{
                        padding: '0.5rem',
                        borderRadius: 'var(--radius)',
                        border: '1px solid hsl(var(--border))',
                        minWidth: '200px'
                    }}
                >
                    <option value="all">Todos los estados</option>
                    <option value="incomplete">Documentación Pendiente</option>
                    <option value="reprocann_issue">Problema REPROCANN</option>
                    <option value="contract_issue">Problema Contrato</option>
                </select>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto', backgroundColor: 'hsl(var(--card))', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid hsl(var(--border))', textAlign: 'left', backgroundColor: 'hsl(var(--muted))' }}>
                            <th style={{ padding: '1rem' }}>Socio</th>
                            <th style={{ padding: '1rem' }}>DNI</th>
                            <th style={{ padding: '1rem' }}>Ubicación</th>
                            <th style={{ padding: '1rem' }}>REPROCANN</th>
                            <th style={{ padding: '1rem' }}>Documentación</th>
                            <th style={{ padding: '1rem' }}>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredSocios.map(socio => {
                            const reprocann = getReprocannStatus(socio);

                            // Calculate Doc Status
                            const docs = [
                                socio.documentacion?.consentimiento,
                                socio.documentacion?.declaracionJurada,
                                socio.documentacion?.contrato,
                                socio.documentacion?.contratoCultivo,
                                socio.documentacion?.recetaMedica
                            ];
                            const completedCount = docs.filter(d => d?.estado === 'completo').length;
                            const hasExpired = docs.some(d => d?.estado === 'vencido');
                            const hasPending = docs.some(d => d?.estado === 'pendiente');

                            let docStatusLabel = 'Completo';
                            let docColor = '#166534';
                            let docBg = '#dcfce7';

                            if (hasExpired) {
                                docStatusLabel = 'Vencido';
                                docColor = '#991b1b';
                                docBg = '#fee2e2';
                            } else if (hasPending) {
                                docStatusLabel = `${completedCount}/5`; // or just Pendiente
                                docColor = '#b45309';
                                docBg = '#ffedd5';
                            }

                            return (
                                <tr key={socio.id} style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                                    <td style={{ padding: '1rem' }}>
                                        <div style={{ fontWeight: 500 }}>{socio.nombre} {socio.apellido}</div>
                                        <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{socio.email}</div>
                                    </td>
                                    <td style={{ padding: '1rem' }}>{socio.dni}</td>
                                    <td style={{ padding: '1rem' }}>{socio.localidad || '-'}</td>

                                    <td style={{ padding: '1rem' }}>
                                        <span style={{
                                            padding: '0.2rem 0.6rem',
                                            borderRadius: '99px',
                                            fontSize: '0.8rem',
                                            backgroundColor: reprocann === 'vigente' ? '#dcfce7' : '#fee2e2',
                                            color: reprocann === 'vigente' ? '#166534' : '#991b1b',
                                            textTransform: 'capitalize'
                                        }}>
                                            {reprocann}
                                        </span>
                                    </td>

                                    <td style={{ padding: '1rem' }}>
                                        <span style={{
                                            padding: '0.2rem 0.6rem',
                                            borderRadius: '99px',
                                            fontSize: '0.8rem',
                                            backgroundColor: docBg,
                                            color: docColor,
                                            fontWeight: 600
                                        }}>
                                            {docStatusLabel}
                                        </span>
                                    </td>

                                    <td style={{ padding: '1rem' }}>
                                        <button
                                            onClick={() => router.push(`/admin/socios/${socio.id}`)}
                                            style={{
                                                padding: '0.4rem 0.8rem',
                                                backgroundColor: 'hsl(var(--secondary))',
                                                color: 'hsl(var(--secondary-foreground))',
                                                border: 'none',
                                                borderRadius: 'var(--radius)',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem'
                                            }}
                                        >
                                            Ver / Editar
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {filteredSocios.length === 0 && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'hsl(var(--muted-foreground))' }}>
                        No se encontraron socios con esos criterios.
                    </div>
                )}
            </div>
        </div>
    );
}
