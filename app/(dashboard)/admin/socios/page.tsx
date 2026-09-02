"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Socio } from '@/types';
import { Plus, Search, User, AlertTriangle } from 'lucide-react';

function formatFriendlyDate(dateStr?: string): string {
    if (!dateStr) return 'Nunca';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Nunca';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMs < 0) return 'Hace un momento';
    if (diffMins < 1) return 'Hace un momento';
    if (diffMins < 60) return `Hace ${diffMins} ${diffMins === 1 ? 'minuto' : 'minutos'}`;
    if (diffHours < 24) return `Hace ${diffHours} ${diffHours === 1 ? 'hora' : 'horas'}`;
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7) return `Hace ${diffDays} días`;

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} - ${hours}:${minutes}`;
}

function getReprocannTrafficLight(socio: Socio) {
    const rawStatus = socio.reprocann?.estado || socio.documentacion?.reprocann?.verificacion_estado || 'pendiente';
    const vencimientoStr = socio.reprocann?.fechaVencimiento || socio.documentacion?.reprocann?.fechaVencimiento;

    if (!vencimientoStr || rawStatus === 'pendiente' || rawStatus === 'rechazado') {
        return {
            label: rawStatus === 'rechazado' ? 'Rechazado' : 'Pendiente',
            badgeClass: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
            dateFormatted: vencimientoStr ? formatDateOnly(vencimientoStr) : 'Sin fecha',
            daysLeft: null,
            statusType: 'red' as const
        };
    }

    const vencimientoDate = new Date(vencimientoStr);
    if (isNaN(vencimientoDate.getTime())) {
        return {
            label: 'Pendiente',
            badgeClass: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
            dateFormatted: 'Sin fecha',
            daysLeft: null,
            statusType: 'red' as const
        };
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(vencimientoDate.getFullYear(), vencimientoDate.getMonth(), vencimientoDate.getDate());

    const diffMs = target.getTime() - today.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const dateFormatted = `${String(vencimientoDate.getDate()).padStart(2, '0')}/${String(vencimientoDate.getMonth() + 1).padStart(2, '0')}/${vencimientoDate.getFullYear()}`;

    if (diffDays <= 0 || rawStatus === 'vencido') {
        return {
            label: 'Vencido',
            badgeClass: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
            dateFormatted,
            daysLeft: 0,
            statusType: 'red' as const
        };
    }

    if (diffDays <= 30) {
        return {
            label: `Por Vencer (${diffDays}d)`,
            badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 font-bold',
            dateFormatted,
            daysLeft: diffDays,
            statusType: 'amber' as const
        };
    }

    return {
        label: 'Vigente',
        badgeClass: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
        dateFormatted,
        daysLeft: diffDays,
        statusType: 'green' as const
    };
}

function formatDateOnly(dateStr: string): string {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

const getSocioStatus = (socio: Socio) => {
    if (socio.auth_user_id && socio.terms_accepted_at) return 'vinculado';

    if (socio.invited_at) {
        const inviteDate = new Date(socio.invited_at);
        const now = new Date();
        const diffHours = (now.getTime() - inviteDate.getTime()) / (1000 * 60 * 60);

        if (diffHours > 48) return 'vencido';
        return 'enviado';
    }

    return 'borrador';
};

// --- MEMOIZED SUB-COMPONENTS FOR DOM OPTIMIZATION ---

interface SocioItemProps {
    socio: Socio;
    onViewDetail: (id: string) => void;
}

const SocioMobileCard = React.memo(function SocioMobileCard({ socio, onViewDetail }: SocioItemProps) {
    const status = getSocioStatus(socio);
    const reproLight = getReprocannTrafficLight(socio);

    const cleanPhone = socio.telefono ? socio.telefono.replace(/[^0-9]/g, '') : '';
    const whatsappLink = `https://wa.me/${cleanPhone}`;
    const roleLabel = socio.rol === 'admin' ? 'Admin' : socio.rol === 'staff' ? 'Staff' : 'Socio';

    return (
        <div className="bg-card border border-border rounded-xl p-4 shadow-xs space-y-4 transition-all">
            {/* Header: Name & Role Badge */}
            <div className="flex justify-between items-start gap-4">
                <div className="min-w-0">
                    <h4 className="font-bold text-foreground text-sm leading-tight truncate">
                        {socio.nombre} {socio.apellido}
                    </h4>
                    <div className="text-xs text-muted-foreground truncate">{socio.email}</div>
                    <span className="text-[10px] font-extrabold text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase mt-1.5 inline-block">
                        Rol: {roleLabel}
                    </span>
                </div>

                {/* State Badge */}
                <div className="shrink-0 text-right">
                    {status === 'vinculado' && <span className="px-2.5 py-0.5 rounded-full text-[9px] uppercase font-black bg-green-100 text-green-700 border border-green-200 block text-center">Vinculado</span>}
                    {status === 'enviado' && <span className="px-2.5 py-0.5 rounded-full text-[9px] uppercase font-black bg-blue-100 text-blue-700 border border-blue-200 block text-center">Enviado</span>}
                    {status === 'vencido' && <span className="px-2.5 py-0.5 rounded-full text-[9px] uppercase font-black bg-red-100 text-red-700 border border-red-200 block text-center">Expirado</span>}
                    {status === 'borrador' && <span className="px-2.5 py-0.5 rounded-full text-[9px] uppercase font-black bg-gray-100 text-gray-500 border border-gray-200 block text-center">Borrador</span>}
                </div>
            </div>

            {/* Details & REPROCANN Badges */}
            <div className="flex justify-between items-center text-xs border-t border-b border-dashed py-3">
                <div className="space-y-1">
                    <div className="text-muted-foreground font-medium">DNI: <span className="text-foreground font-bold">{socio.dni}</span></div>
                    <div className="text-muted-foreground font-medium">Vencimiento: <span className="text-foreground font-semibold">{reproLight.dateFormatted}</span></div>
                </div>
                <div className="text-right space-y-1">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border inline-block ${reproLight.badgeClass}`}>
                        {reproLight.label}
                    </span>
                </div>
            </div>

            {/* Last Connection */}
            <div className="text-xs text-muted-foreground flex justify-between items-center">
                <span>Última conexión:</span>
                <span className="font-semibold text-foreground">{formatFriendlyDate(socio.last_sign_in_at)}</span>
            </div>

            {/* Bottom Tactile Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                    onClick={() => onViewDetail(socio.id)}
                    className="text-white py-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1 shadow-xs active:scale-95"
                    style={{ backgroundColor: '#0F3822' }}
                >
                    Ver Ficha
                </button>

                {socio.telefono ? (
                    <a
                        href={whatsappLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1 shadow-xs text-center active:scale-95"
                    >
                        WhatsApp
                    </a>
                ) : (
                    <button
                        disabled
                        className="bg-muted text-muted-foreground py-3 rounded-xl text-xs font-bold cursor-not-allowed opacity-60"
                    >
                        Sin Teléfono
                    </button>
                )}
            </div>
        </div>
    );
});

const SocioTableRow = React.memo(function SocioTableRow({ socio, onViewDetail }: SocioItemProps) {
    const status = getSocioStatus(socio);
    const reproLight = getReprocannTrafficLight(socio);

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
        <tr className="border-b border-border hover:bg-muted/50 transition-colors">
            <td className="p-4">
                <div className="font-medium text-foreground">{socio.nombre} {socio.apellido}</div>
                <div className="text-xs text-muted-foreground">{socio.email}</div>
            </td>
            <td className="p-4 text-center">
                {status === 'vinculado' && <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold bg-green-100 text-green-700 border border-green-200">Vinculado</span>}
                {status === 'enviado' && <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold bg-blue-100 text-blue-700 border border-blue-200">Enviado</span>}
                {status === 'vencido' && <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold bg-red-100 text-red-700 border border-red-200">Link Vencido</span>}
                {status === 'borrador' && <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold bg-gray-100 text-gray-500 border border-gray-200">Borrador</span>}
            </td>
            <td className="p-4 text-sm font-medium">{socio.dni}</td>
            <td className="p-4 text-sm">{socio.localidad || '-'}</td>

            {/* Enriched REPROCANN Traffic Light Column */}
            <td className="p-4">
                <div className="flex flex-col gap-0.5">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border w-fit ${reproLight.badgeClass}`}>
                        {reproLight.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground font-medium">
                        Venc: {reproLight.dateFormatted}
                    </span>
                </div>
            </td>

            <td className="p-4">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${docBadgeClass}`}>
                    {docStatusLabel}
                </span>
            </td>

            <td className="p-4 text-sm text-muted-foreground">
                {formatFriendlyDate(socio.last_sign_in_at)}
            </td>

            <td className="p-4">
                <button
                    onClick={() => onViewDetail(socio.id)}
                    className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors text-sm font-medium"
                >
                    Ver / Editar
                </button>
            </td>
        </tr>
    );
});

export default function AdminSociosPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [socios, setSocios] = useState<Socio[]>([]);
    const [loading, setLoading] = useState(true);

    // Instant input value state & 300ms debounced search state
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [filter, setFilter] = useState<'all' | 'incomplete' | 'reprocann_issue' | 'contract_issue'>('all');

    // Debounce effect (300ms)
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300);
        return () => clearTimeout(handler);
    }, [searchTerm]);

    useEffect(() => {
        if (!authLoading) {
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                return;
            }

            Promise.all([
                StoreService.getAllSocios('socio'),
                StoreService.getEstadoDocumentacionTodos()
            ]).then(([sociosData, docSummaries]) => {
                const docMap = new Map(docSummaries.map(s => [s.socio_id, s]));

                const merged: Socio[] = sociosData.map(socio => {
                    const summary = docMap.get(socio.id);
                    if (summary) {
                        return {
                            ...socio,
                            reprocann: {
                                ...socio.reprocann,
                                fechaVencimiento: socio.reprocann?.fechaVencimiento || summary.reprocann_vencimiento || undefined,
                                estado: (summary.reprocann_estado as any) || socio.reprocann?.estado || 'pendiente'
                            },
                            documentacion: {
                                ...socio.documentacion,
                                consentimiento: summary.consentimiento_archivo ? { estado: 'completo' as const, archivoPath: summary.consentimiento_archivo } : undefined,
                                declaracionJurada: summary.ddjj_archivo ? { estado: 'completo' as const, archivoPath: summary.ddjj_archivo } : undefined,
                                reprocann: summary.reprocann_archivo ? { estado: 'completo' as const, archivoPath: summary.reprocann_archivo, fechaVencimiento: summary.reprocann_vencimiento || undefined } : undefined,
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

    const handleViewDetail = React.useCallback((id: string) => {
        router.push(`/admin/socios/${id}`);
    }, [router]);

    const getReprocannStatus = (socio: Socio) => socio.reprocann?.estado || 'pendiente';
    const getContractStatus = (socio: Socio) => socio.documentacion?.contrato?.estado || 'pendiente';

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

            const updated = await StoreService.getAllSocios('socio');
            setSocios(updated);
        } catch (e: any) {
            console.error(e);
            alert('Error enviando invitaciones masivas: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const pendingCount = useMemo(() => {
        return socios.filter(s => ['borrador', 'vencido'].includes(getSocioStatus(s))).length;
    }, [socios]);

    // Memoized filtered socios using debounced search term
    const filteredSocios = useMemo(() => {
        const lowerSearch = debouncedSearchTerm.toLowerCase().trim();

        return socios.filter(s => {
            const matchesSearch = !lowerSearch ||
                s.nombre.toLowerCase().includes(lowerSearch) ||
                s.apellido.toLowerCase().includes(lowerSearch) ||
                s.dni.includes(lowerSearch) ||
                s.email.toLowerCase().includes(lowerSearch);

            if (!matchesSearch) return false;

            const reprocann = getReprocannStatus(s);
            const contrato = getContractStatus(s);
            const light = getReprocannTrafficLight(s);

            if (filter === 'reprocann_issue') {
                return ['pendiente', 'vencido', 'rechazado'].includes(reprocann) || light.statusType === 'amber' || light.statusType === 'red';
            }
            if (filter === 'contract_issue') return ['pendiente', 'vencido'].includes(contrato);
            if (filter === 'incomplete') {
                const rIssue = ['pendiente', 'vencido'].includes(reprocann) || light.statusType === 'amber' || light.statusType === 'red';
                const cIssue = ['pendiente', 'vencido'].includes(contrato);
                return rIssue || cIssue;
            }

            return true;
        });
    }, [socios, debouncedSearchTerm, filter]);

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

    if (loading || authLoading) return <div className="p-8 text-muted-foreground font-medium">Cargando catálogo de socios...</div>;

    return (
        <div>
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold mb-2">Gestión de Socios</h1>
                    <p className="text-muted-foreground">Administrar pacientes, vencimientos de REPROCANN y documentación.</p>
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
                        className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-3 rounded-xl flex items-center gap-2 font-medium transition-colors shadow-xs"
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
                        className="w-full pl-9 p-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm transition-all"
                    />
                </div>

                <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as any)}
                    className="p-2 rounded-lg border border-input bg-background text-foreground min-w-[200px] focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                >
                    <option value="all">Todos los estados</option>
                    <option value="incomplete">Documentación Pendiente</option>
                    <option value="reprocann_issue">Problema REPROCANN (Por Vencer / Vencido)</option>
                    <option value="contract_issue">Problema Contrato</option>
                </select>
            </div>

            {/* 1. MOBILE CARDS VIEW (< 768px) */}
            <div className="md:hidden space-y-3">
                {filteredSocios.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground bg-card rounded-xl border border-border">
                        No se encontraron socios con esos criterios.
                    </div>
                ) : (
                    filteredSocios.map(socio => (
                        <SocioMobileCard key={socio.id} socio={socio} onViewDetail={handleViewDetail} />
                    ))
                )}
            </div>

            {/* 2. DESKTOP TRADITIONAL TABLE VIEW (>= 768px) */}
            <div className="hidden md:block overflow-x-auto bg-card rounded-xl border border-border">
                <table className="w-full border-collapse min-w-[800px]">
                    <thead>
                        <tr className="border-b border-border text-left bg-muted/50">
                            <th className="p-4 text-muted-foreground font-medium">Socio</th>
                            <th className="p-4 text-muted-foreground font-medium text-center">Estado</th>
                            <th className="p-4 text-muted-foreground font-medium">DNI</th>
                            <th className="p-4 text-muted-foreground font-medium">Ubicación</th>
                            <th className="p-4 text-muted-foreground font-medium">REPROCANN</th>
                            <th className="p-4 text-muted-foreground font-medium">Documentación</th>
                            <th className="p-4 text-muted-foreground font-medium">Última Conexión</th>
                            <th className="p-4 text-muted-foreground font-medium">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredSocios.map(socio => (
                            <SocioTableRow key={socio.id} socio={socio} onViewDetail={handleViewDetail} />
                        ))}
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
