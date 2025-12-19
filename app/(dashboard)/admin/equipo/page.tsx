"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Socio } from '@/types'; // Staff uses Socio type for now
import { Plus, Search, Shield, Trash2 } from 'lucide-react';

export default function AdminEquipoPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [staffList, setStaffList] = useState<Socio[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (!authLoading) {
            // ONLY ADMIN can manage staff
            if (!user || user.rol !== 'admin') {
                router.push('/');
                return;
            }

            // Fetch 'staff' role
            StoreService.getAllSocios('staff').then(data => {
                setStaffList(data);
                setLoading(false);
            });
        }
    }, [user, authLoading, router]);

    if (!authLoading && (!user || user.rol !== 'admin')) {
        return null; // Redirect handles it
    }

    const filteredStaff = staffList.filter(s => {
        return (
            s.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.apellido.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.email.toLowerCase().includes(searchTerm.toLowerCase())
        );
    });

    if (loading || authLoading) return <div style={{ padding: '2rem' }}>Cargando equipo...</div>;

    const handleInvite = async (socioId: string) => {
        if (!confirm('¿Enviar invitación por email a este miembro?')) return;
        try {
            await StoreService.inviteSocio(socioId);
            alert('Invitación enviada correctamente.');
            // Refresh list logic if needed, or just UI update?
            // For now, simpler to reload or just alert.
        } catch (error: any) {
            console.error('Invite error:', error);
            alert(`Error al invitar: ${error.message}`);
        }
    };

    return (
        <div>
            <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Gestión de Equipo</h1>
                    <p style={{ color: 'hsl(var(--muted-foreground))' }}>Administrar acceso de colaboradores (Staff).</p>
                </div>
                <button
                    onClick={() => router.push('/admin/equipo/new')}
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
                    Nuevo Miembro
                </button>
            </div>

            {/* Filters */}
            <div className="mb-6 bg-card p-4 rounded-xl border border-border">
                <div className="relative max-w-[400px]">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Buscar por nombre o email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 p-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto bg-card rounded-xl border border-border">
                <table className="w-full border-collapse min-w-[600px]">
                    <thead>
                        <tr className="border-b border-border text-left bg-muted/50">
                            <th className="p-4 text-muted-foreground font-medium">Miembro</th>
                            <th className="p-4 text-muted-foreground font-medium">Estado</th>
                            <th className="p-4 text-muted-foreground font-medium">Contacto</th>
                            <th className="p-4 text-muted-foreground font-medium">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredStaff.map(member => (
                            <tr key={member.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                                <td className="p-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-semibold">
                                            {member.nombre[0]}{member.apellido[0]}
                                        </div>
                                        <div>
                                            <div className="font-medium">{member.nombre} {member.apellido}</div>
                                            <div className="text-xs text-muted-foreground">ID: {member.id.slice(0, 8)}...</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="p-4">
                                    <div className="flex flex-col gap-1">
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold w-fit bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                            <Shield size={14} />
                                            {member.rol.toUpperCase()}
                                        </span>
                                        {member.status === 'invited' && (
                                            <span className="text-xs text-orange-500 font-medium">Invitado</span>
                                        )}
                                        {member.auth_user_id && member.status !== 'invited' && (
                                            <span className="text-xs text-green-500 font-medium">Activo</span>
                                        )}
                                    </div>
                                </td>
                                <td className="p-4">
                                    <div>{member.email}</div>
                                    <div className="text-xs text-muted-foreground">{member.telefono}</div>
                                </td>
                                <td className="p-4">
                                    <div className="flex gap-2">
                                        <button
                                            className="px-3 py-1 bg-secondary text-secondary-foreground text-xs rounded hover:bg-secondary/80 transition"
                                            onClick={() => handleInvite(member.id)}
                                            title="Enviar invitación por email"
                                        >
                                            Invitar
                                        </button>
                                        <button
                                            className="text-destructive hover:text-destructive/80 transition-colors"
                                            onClick={() => alert("Función Eliminar pendiente")}
                                            title="Eliminar"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {filteredStaff.length === 0 && (
                    <div className="p-8 text-center text-muted-foreground">
                        No se encontraron miembros del equipo.
                    </div>
                )}
            </div>
        </div>
    );
}
