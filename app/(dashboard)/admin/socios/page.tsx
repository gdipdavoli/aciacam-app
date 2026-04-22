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
            console.log("AdminSocios: Checking Access", user);
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                return;
            }

            Promise.all([
                StoreService.getAllSocios('socio'),
                StoreService.getEstadoDocumentacionTodos()
            ]).then(([sociosData, docSummaries]) => {
                // Merge doc status into socios
                const docMap = new Map(docSummaries.map(s => [s.socio_id, s]));
                
                const merged: Socio[] = sociosData.map(socio => {
                    const summary = docMap.get(socio.id);
                    if (summary) {
                        return {
                            ...socio,
                            documentacion: {
                                ...socio.documentacion,
                                consentimiento: summary.consentimiento_archivo ? { estado: 'completo' as const, archivoPath: summary.consentimiento_archivo } : undefined,
                                declaracionJurada: summary.ddjj_archivo ? { estado: 'completo' as const, archivoPath: summary.ddjj_archivo } : undefined,
                                reprocann: summary.reprocann_archivo ? { estado: 'completo' as const, archivoPath: summary.reprocann_archivo } : undefined,
                            }
                        };
                    }
                    return socio;
                });
                setSocios(merged);
                setLoading(false);
            });
        }
    }, [user, authLoading, router]);

    if (!authLoading && (!user || (user.rol !== 'admin' && user.rol !== 'staff'))) {
        return (
            <div className="p-8 text-center">
                <h1 className="text-xl font-bold text-red-500">Acceso Denegado</h1>
                <p>Usuario: {user?.id}</p>
                <p>Rol detectado: {user?.rol || 'Ninguno'}</p>
                <p>Esperado: admin o staff</p>
                <button onClick={() => router.push('/')} className="mt-4 p-2 bg-gray-200 rounded">Ir al Inicio</button>
            </div>
        );
    }

    const getReprocannStatus = (socio: Socio) => socio.reprocann?.estado || 'pendiente';
    const getContractStatus = (socio: Socio) => socio.documentacion?.contrato?.estado || 'pendiente';

    const getSocioStatus = (socio: Socio) => {
        // Vinculado only if they have accepted terms (meaning they logged in)
        if (socio.auth_user_id && socio.terms_accepted_at) return 'vinculado';
        
        if (socio.invited_at) {
            const inviteDate = new Date(socio.invited_at);
            const now = new Date();
            const diffHours = (now.getTime() - inviteDate.getTime()) / (1000 * 60 * 60);
            
            // If they have auth_user_id but haven't accepted terms yet, they are still in "enviado" or "vencido"
            if (diffHours > 48) return 'vencido';
            return 'enviado';
        }
        
        return 'borrador';
    };

    const handleBulkInvite = async () => {
        const canInvite = (s: Socio) => ['borrador', 'vencido'].includes(getSocioStatus(s));
        const pendingSocios = socios.filter(canInvite);
        if (pendingSocios.length === 0) return;

        if (!confirm(`¿Estás seguro de enviar invitación a ${pendingSocios.length} socios pendientes?`)) return;

        setLoading(true);
        try {
            const ids = pendingSocios.map(s => s.id);
            const res = await StoreService.bulkInviteSocios(ids);

            alert(`Invitaciones enviadas. Exitosas: ${res.succeeded}, Fallidas: ${res.failed}, Omitidas: ${res.skipped}`);

            // Refresh
            const updated = await StoreService.getAllSocios('socio');
            setSocios(updated);
        } catch (e: any) {
            console.error(e);
            alert('Error enviando invitaciones masivas: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const pendingCount = socios.filter(s => ['borrador', 'vencido'].includes(getSocioStatus(s))).length;

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
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold mb-2">Gestión de Socios</h1>
                    <p className="text-muted-foreground">Administrar pacientes y documentación.</p>
                </div>
                <div className="flex gap-3">
                    {pendingCount > 0 && (
                        <button
                            onClick={handleBulkInvite}
                            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 py-3 rounded-xl flex items-center gap-2 font-medium transition-colors border border-border"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
                            Invitar Pendientes ({pendingCount})
                        </button>
                    )}
                    <button
                        onClick={() => router.push('/admin/socios/new')}
                        className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-3 rounded-xl flex items-center gap-2 font-medium transition-colors"
                    >
                        <Plus size={18} />
                        Nuevo Socio
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-4 mb-6 bg-card p-4 rounded-xl border border-border">
                <div className="flex-1 relative min-w-[200px]">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Buscar por nombre, DNI, email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 p-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>

                <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as any)}
                    className="p-2 rounded-lg border border-input bg-background text-foreground min-w-[200px] focus:outline-none focus:ring-2 focus:ring-ring"
                >
                    <option value="all">Todos los estados</option>
                    <option value="incomplete">Documentación Pendiente</option>
                    <option value="reprocann_issue">Problema REPROCANN</option>
                    <option value="contract_issue">Problema Contrato</option>
                </select>
            </div>

            {/* Table */}
            <div className="overflow-x-auto bg-card rounded-xl border border-border">
                <table className="w-full border-collapse min-w-[800px]">
                    <thead>
                        <tr className="border-b border-border text-left bg-muted/50">
                            <th className="p-4 text-muted-foreground font-medium">Socio</th>
                            <th className="p-4 text-muted-foreground font-medium text-center">Estado</th>
                            <th className="p-4 text-muted-foreground font-medium">DNI</th>
                            <th className="p-4 text-muted-foreground font-medium">Ubicación</th>
                            <th className="p-4 text-muted-foreground font-medium">REPROCANN</th>
                            <th className="p-4 text-muted-foreground font-medium">Documentación</th>
                            <th className="p-4 text-muted-foreground font-medium">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredSocios.map(socio => {
                            const reprocann = getReprocannStatus(socio);
                            const status = getSocioStatus(socio);

                            // Calculate Doc Status
                            const coreDocs = [
                                socio.documentacion?.consentimiento,
                                socio.documentacion?.declaracionJurada,
                                socio.documentacion?.reprocann
                            ];
                            const allDocs = Object.values(socio.documentacion || {});
                            
                            const coreCompletedCount = coreDocs.filter(d => d?.estado === 'completo').length;
                            const hasExpired = allDocs.some(d => d?.estado === 'vencido');

                            let docStatusLabel = 'PENDIENTE';
                            let docBadgeClass = 'bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400 border border-gray-200 dark:border-gray-700';

                            if (hasExpired) {
                                docStatusLabel = 'VENCIDO';
                                docBadgeClass = 'bg-red-100 text-red-700 dark:bg-red-800/30 dark:text-red-400 border border-red-200 dark:border-red-900';
                            } else if (coreCompletedCount === 3) {
                                docStatusLabel = 'COMPLETO';
                                docBadgeClass = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800';
                            } else if (coreCompletedCount > 0) {
                                docStatusLabel = 'FALTA';
                                docBadgeClass = 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border border-orange-200 dark:border-orange-800';
                            }

                            return (
                                <tr key={socio.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                                    <td className="p-4">
                                        <div className="font-medium">{socio.nombre} {socio.apellido}</div>
                                        <div className="text-sm text-muted-foreground">{socio.email}</div>
                                    </td>
                                    <td className="p-4 text-center">
                                        {status === 'vinculado' && <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold bg-green-100 text-green-700 border border-green-200">Vinculado</span>}
                                        {status === 'enviado' && <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold bg-blue-100 text-blue-700 border border-blue-200">Enviado</span>}
                                        {status === 'vencido' && <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold bg-red-100 text-red-700 border border-red-200">Link Vencido</span>}
                                        {status === 'borrador' && <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold bg-gray-100 text-gray-500 border border-gray-200">Borrador</span>}
                                    </td>
                                    <td className="p-4">{socio.dni}</td>
                                    <td className="p-4">{socio.localidad || '-'}</td>

                                    <td className="p-4">
                                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize border ${reprocann === 'vigente'
                                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800'
                                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800'
                                            }`}>
                                            {reprocann}
                                        </span>
                                    </td>

                                    <td className="p-4">
                                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${docBadgeClass}`}>
                                            {docStatusLabel}
                                        </span>
                                    </td>

                                    <td className="p-4">
                                        <button
                                            onClick={() => router.push(`/admin/socios/${socio.id}`)}
                                            className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors text-sm font-medium"
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
                    <div className="p-8 text-center text-muted-foreground">
                        No se encontraron socios con esos criterios.
                    </div>
                )}
            </div>
        </div>
    );
}
