"use client";

import React, { useEffect, useState, useTransition, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Pedido, OrderStatus, OrderType, PedidosFilterOptions } from '@/types';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { getStatusLabel, getNextStatusOptions, isFinalStatus } from '@/helpers/orderHelpers';
import { 
    Search, 
    Filter, 
    RotateCcw, 
    Archive, 
    ArchiveRestore, 
    ChevronLeft, 
    ChevronRight, 
    Navigation, 
    Plus, 
    Package, 
    Clock, 
    Calendar, 
    User, 
    CheckCircle2, 
    AlertCircle,
    ArrowUpDown,
    Check,
    X,
    Eye
} from 'lucide-react';
import PaymentRegistrationModal from '@/app/components/admin/PaymentRegistrationModal';

export default function AdminOrdersPage() {
    const { user, session, loading: authLoading, isInitialized } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    // Estados de datos
    const [orders, setOrders] = useState<Pedido[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Estados de conteos globales para las pestañas
    const [counts, setCounts] = useState<{
        all: number;
        active: number;
        en_preparacion: number;
        finalized: number;
        archived: number;
    }>({
        all: 0,
        active: 0,
        en_preparacion: 0,
        finalized: 0,
        archived: 0
    });

    // Paginación
    const [pagination, setPagination] = useState({
        page: 1,
        limit: 15,
        totalCount: 0,
        totalPages: 1,
        hasMore: false
    });

    // Filtros extraídos de la URL
    const currentTab = searchParams.get('tab') || 'active';
    const currentSearch = searchParams.get('search') || '';
    const currentPage = parseInt(searchParams.get('page') || '1', 10);
    const currentLimit = parseInt(searchParams.get('limit') || '15', 10);
    const currentOrigen = searchParams.get('origen') || 'all';
    const currentTipoPedido = searchParams.get('tipoPedido') || 'all';
    const currentDesde = searchParams.get('desde') || '';
    const currentHasta = searchParams.get('hasta') || '';
    const currentSortBy = (searchParams.get('sortBy') as any) || 'created_at';
    const currentSortDir = (searchParams.get('sortDir') as any) || 'desc';
    const currentStatusDetail = searchParams.get('statusDetail') || '';

    // Estado local para input de búsqueda (con debounce)
    const [searchInput, setSearchInput] = useState(currentSearch);
    const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

    // Drawer de filtros avanzados en mobile
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    // Modales de cambio de estado y cobro
    const [pendingChange, setPendingChange] = useState<{ id: string; newStatus: string; currentStatus: string } | null>(null);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentModalOrder, setPaymentModalOrder] = useState<Pedido | null>(null);
    const [paymentModalTargetStatus, setPaymentModalTargetStatus] = useState<'entregado' | 'retirado' | null>(null);

    // Modales de archivado
    const [archiveModalTarget, setArchiveModalTarget] = useState<{ id: string; socioNombre?: string; archivado: boolean } | null>(null);
    const [showBulkArchiveModal, setShowBulkArchiveModal] = useState(false);
    const [archiveActionLoading, setArchiveActionLoading] = useState(false);

    // Función para actualizar URL y disparar fetch
    const updateUrlParams = useCallback((updates: Record<string, string | number | null | undefined>) => {
        const params = new URLSearchParams(searchParams.toString());

        Object.entries(updates).forEach(([key, val]) => {
            if (val === null || val === undefined || val === '' || val === 'all') {
                params.delete(key);
            } else {
                params.set(key, String(val));
            }
        });

        // Si se cambia algún filtro que no sea 'page', reiniciar a página 1
        if (!('page' in updates)) {
            params.set('page', '1');
        }

        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, [router, pathname, searchParams]);

    // Manejo de debounce en búsqueda
    const handleSearchChange = (val: string) => {
        setSearchInput(val);
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = setTimeout(() => {
            updateUrlParams({ search: val.trim() || null });
        }, 350);
    };

    const clearSearch = () => {
        setSearchInput('');
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        updateUrlParams({ search: null });
    };

    // Carga de pedidos desde el backend BFF
    const fetchOrders = useCallback(async () => {
        if (!isInitialized || !user || (user.rol !== 'admin' && user.rol !== 'staff')) {
            return;
        }

        setLoading(true);
        setErrorMsg(null);

        try {
            // Resolver qué 'status' enviar según la pestaña y el filtro detallado
            let statusToQuery = currentTab;
            if (currentStatusDetail && currentStatusDetail !== 'all') {
                statusToQuery = currentStatusDetail;
            }

            const options: PedidosFilterOptions = {
                page: currentPage,
                limit: currentLimit,
                status: statusToQuery,
                origen: currentOrigen,
                tipoPedido: currentTipoPedido,
                desde: currentDesde || undefined,
                hasta: currentHasta || undefined,
                search: currentSearch || undefined,
                sortBy: currentSortBy,
                sortDir: currentSortDir,
                includeArchived: currentTab === 'archived'
            };

            const result = await StoreService.getPedidosPaginated(options);
            setOrders(result.pedidos);
            setPagination(result.pagination);
            setCounts(result.counts);
        } catch (err: any) {
            console.error('Error cargando pedidos en admin:', err);
            setErrorMsg(err.message || 'Error al cargar pedidos del servidor');
        } finally {
            setLoading(false);
        }
    }, [
        isInitialized,
        user,
        currentPage,
        currentLimit,
        currentTab,
        currentStatusDetail,
        currentOrigen,
        currentTipoPedido,
        currentDesde,
        currentHasta,
        currentSearch,
        currentSortBy,
        currentSortDir
    ]);

    // Disparar carga cuando cambian los searchParams o el auth
    useEffect(() => {
        if (!authLoading && isInitialized) {
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                router.replace('/');
                return;
            }
            fetchOrders();
        }
    }, [authLoading, isInitialized, user, fetchOrders, router]);

    // Sincronizar input local de búsqueda si la URL cambia externamente (ej: botón Volver)
    useEffect(() => {
        setSearchInput(currentSearch);
    }, [currentSearch]);

    // Limpiar todos los filtros
    const handleResetFilters = () => {
        setSearchInput('');
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        router.replace(`${pathname}?tab=${currentTab}&page=1`, { scroll: false });
    };

    // Solicitud de cambio de estado
    const handleStatusChangeRequest = (pedidoId: string, newStatus: string) => {
        const order = orders.find(o => o.id === pedidoId);
        if (order) {
            setPendingChange({
                id: pedidoId,
                newStatus,
                currentStatus: order.estado
            });
        }
    };

    // Confirmación de cambio de estado
    const confirmStatusChange = async () => {
        if (!pendingChange) return;

        const { id, newStatus } = pendingChange;

        if (newStatus === 'entregado' || newStatus === 'retirado') {
            const order = orders.find(o => o.id === id);
            if (order) {
                setPaymentModalOrder(order);
                setPaymentModalTargetStatus(newStatus as any);
                setShowPaymentModal(true);
                setPendingChange(null);
                return;
            }
        }

        try {
            await StoreService.updatePedidoStatus(id, newStatus as any);
            setPendingChange(null);
            await fetchOrders();
        } catch (error: any) {
            console.error("Error al actualizar estado:", error);
            alert(error.message || "Error al actualizar el estado del pedido.");
            setPendingChange(null);
        }
    };

    // Confirmación de pago y entrega
    const handlePaymentConfirm = async (
        payments: Array<{ amount: number; method: string; reference?: string; concepto: string }>,
        isDonation: boolean,
        donationReason?: string
    ) => {
        if (!paymentModalOrder || !paymentModalTargetStatus || !user) return;

        const orderId = paymentModalOrder.id;
        const actorId = session?.user?.id || user.auth_user_id || user.id;

        try {
            await StoreService.confirmOrderAndPayments(
                orderId,
                paymentModalTargetStatus,
                payments,
                isDonation,
                donationReason,
                actorId
            );

            setShowPaymentModal(false);
            setPaymentModalOrder(null);
            setPaymentModalTargetStatus(null);
            await fetchOrders();
        } catch (err: any) {
            console.error("Error confirmando cobro y entrega:", err);
            alert(err.message || "Error al confirmar cobro y entrega del pedido.");
        }
    };

    // Archivado individual
    const handleToggleArchive = async () => {
        if (!archiveModalTarget) return;
        setArchiveActionLoading(true);
        try {
            await StoreService.setOrderArchived(
                archiveModalTarget.id,
                archiveModalTarget.archivado,
                archiveModalTarget.archivado ? 'Archivado individual desde panel admin' : 'Restauración individual desde panel admin'
            );
            setArchiveModalTarget(null);
            await fetchOrders();
        } catch (err: any) {
            alert(err.message || 'Error al modificar estado de archivado');
        } finally {
            setArchiveActionLoading(false);
        }
    };

    // Archivado masivo de finalizados
    const handleBulkArchive = async () => {
        setArchiveActionLoading(true);
        try {
            const count = await StoreService.archiveFinishedOrders(
                'Archivado masivo de pedidos finalizados desde panel admin',
                user?.id
            );
            setShowBulkArchiveModal(false);
            alert(`Se archivaron exitosamente ${count} pedidos finalizados.`);
            await fetchOrders();
        } catch (err: any) {
            alert(err.message || 'Error al archivar pedidos finalizados');
        } finally {
            setArchiveActionLoading(false);
        }
    };

    if (authLoading || !isInitialized) {
        return (
            <div className="min-h-[50vh] flex flex-col items-center justify-center space-y-3">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                <p className="text-sm text-muted-foreground">Verificando credenciales de acceso...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-12">
            {/* Header Superior y Botones Principales */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-5">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Gestión de Pedidos</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Control de solicitudes, agenda de turnos, entregas en sede y seguimiento histórico.
                    </p>
                </div>

                <div className="flex items-center gap-2.5">
                    {/* Botón Nueva Dispensa */}
                    <button
                        onClick={() => router.push('/admin/orders/new')}
                        className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
                    >
                        <Plus size={18} />
                        <span>Nueva Dispensa</span>
                    </button>

                    {/* Acciones Secundarias (Desktop) */}
                    <div className="hidden md:flex items-center gap-2">
                        <button
                            onClick={() => setShowBulkArchiveModal(true)}
                            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            title="Archivar pedidos finalizados (no elimina datos)"
                        >
                            <Archive size={15} />
                            <span>Archivar finalizados</span>
                        </button>

                        <Link
                            href="/admin/agenda"
                            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-primary/20 bg-primary/10 text-primary hover:bg-primary/20 transition-colors no-underline"
                        >
                            <Calendar size={15} />
                            <span>Agenda</span>
                        </Link>
                    </div>
                </div>
            </div>

            {/* Pestañas Canónicas con Conteos Globales */}
            <div className="flex items-center gap-2 border-b border-border/80 overflow-x-auto no-scrollbar pb-px">
                <button
                    onClick={() => updateUrlParams({ tab: 'active', statusDetail: null })}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                        currentTab === 'active'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <span>Activos</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        currentTab === 'active' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                        {counts.active}
                    </span>
                </button>

                <button
                    onClick={() => updateUrlParams({ tab: 'en_preparacion', statusDetail: null })}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                        currentTab === 'en_preparacion'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <span>En Preparación</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        currentTab === 'en_preparacion' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                        {counts.en_preparacion}
                    </span>
                </button>

                <button
                    onClick={() => updateUrlParams({ tab: 'finalized', statusDetail: null })}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                        currentTab === 'finalized'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <span>Finalizados</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        currentTab === 'finalized' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                        {counts.finalized}
                    </span>
                </button>

                <button
                    onClick={() => updateUrlParams({ tab: 'archived', statusDetail: null })}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                        currentTab === 'archived'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <Archive size={15} />
                    <span>Archivados</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        currentTab === 'archived' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                        {counts.archived}
                    </span>
                </button>

                <button
                    onClick={() => updateUrlParams({ tab: 'all', statusDetail: null })}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                        currentTab === 'all'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <span>Todos</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        currentTab === 'all' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                        {counts.all}
                    </span>
                </button>
            </div>

            {/* Barra de Búsqueda y Filtros Combinados */}
            <div className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
                    {/* Input de Búsqueda con debounce */}
                    <div className="relative flex-1">
                        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            placeholder="Buscar por socio, DNI o ID de pedido..."
                            className="w-full pl-10 pr-9 py-2.5 text-sm rounded-xl border border-input bg-background/60 hover:bg-background focus:bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all placeholder:text-muted-foreground/60"
                        />
                        {searchInput && (
                            <button
                                onClick={clearSearch}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-full hover:bg-muted"
                                title="Limpiar búsqueda"
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>

                    {/* Filtro por Origen */}
                    <div className="w-full md:w-36">
                        <select
                            value={currentOrigen}
                            onChange={(e) => updateUrlParams({ origen: e.target.value })}
                            className="w-full py-2.5 px-3 rounded-xl border border-input bg-background/60 text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none cursor-pointer"
                        >
                            <option value="all">Origen: Todos</option>
                            <option value="sede">Sede (Admin)</option>
                            <option value="app">App (Socio)</option>
                        </select>
                    </div>

                    {/* Filtro por Tipo de Pedido */}
                    <div className="w-full md:w-40">
                        <select
                            value={currentTipoPedido}
                            onChange={(e) => updateUrlParams({ tipoPedido: e.target.value })}
                            className="w-full py-2.5 px-3 rounded-xl border border-input bg-background/60 text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none cursor-pointer"
                        >
                            <option value="all">Tipo: Todos</option>
                            <option value="retiro_sede">Retiro en Sede</option>
                            <option value="delivery">Envío / Delivery</option>
                        </select>
                    </div>

                    {/* Botón Filtros Avanzados (Toggle en mobile) */}
                    <button
                        onClick={() => setShowAdvancedFilters(prev => !prev)}
                        className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
                            showAdvancedFilters || currentDesde || currentHasta || currentStatusDetail
                                ? 'border-primary/50 bg-primary/10 text-primary'
                                : 'border-border bg-card text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        <Filter size={16} />
                        <span className="md:inline">Filtros</span>
                    </button>

                    {/* Botón Limpiar Filtros */}
                    {(currentSearch || currentOrigen !== 'all' || currentTipoPedido !== 'all' || currentDesde || currentHasta || currentStatusDetail) && (
                        <button
                            onClick={handleResetFilters}
                            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-border hover:bg-muted text-muted-foreground hover:text-foreground text-sm font-semibold transition-colors"
                            title="Restablecer todos los filtros aplicados"
                        >
                            <RotateCcw size={16} />
                            <span className="hidden sm:inline">Limpiar</span>
                        </button>
                    )}
                </div>

                {/* Filtros Avanzados Colapsables (Fechas, Orden y Estado Detallado) */}
                {showAdvancedFilters && (
                    <div className="pt-3 border-t border-border/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-in fade-in-50 duration-150">
                        <div>
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">Fecha Desde:</label>
                            <input
                                type="date"
                                value={currentDesde}
                                onChange={(e) => updateUrlParams({ desde: e.target.value || null })}
                                className="w-full py-2 px-3 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">Fecha Hasta:</label>
                            <input
                                type="date"
                                value={currentHasta}
                                onChange={(e) => updateUrlParams({ hasta: e.target.value || null })}
                                className="w-full py-2 px-3 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">Ordenar por:</label>
                            <div className="flex gap-1.5">
                                <select
                                    value={currentSortBy}
                                    onChange={(e) => updateUrlParams({ sortBy: e.target.value })}
                                    className="flex-1 py-2 px-3 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:outline-none cursor-pointer"
                                >
                                    <option value="created_at">Fecha Creación</option>
                                    <option value="fecha_retiro_preferida">Fecha Turno</option>
                                    <option value="updated_at">Fecha Cierre</option>
                                </select>
                                <button
                                    onClick={() => updateUrlParams({ sortDir: currentSortDir === 'asc' ? 'desc' : 'asc' })}
                                    className="p-2 rounded-xl border border-border bg-background hover:bg-muted text-foreground"
                                    title={currentSortDir === 'asc' ? 'Ascendente (Más antiguos primero)' : 'Descendente (Más recientes primero)'}
                                >
                                    <ArrowUpDown size={16} />
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">Estado Detallado:</label>
                            <select
                                value={currentStatusDetail}
                                onChange={(e) => updateUrlParams({ statusDetail: e.target.value || null })}
                                className="w-full py-2 px-3 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:outline-none cursor-pointer"
                            >
                                <option value="all">Cualquiera en esta pestaña</option>
                                <option value="pendiente">Pendiente</option>
                                <option value="en_preparacion">En preparación</option>
                                <option value="confirmado">Confirmado</option>
                                <option value="en_camino">En camino</option>
                                <option value="entregado">Entregado</option>
                                <option value="retirado">Retirado</option>
                                <option value="cancelado">Cancelado</option>
                            </select>
                        </div>
                    </div>
                )}
            </div>

            {/* Mensaje de Error si ocurre */}
            {errorMsg && (
                <div className="p-4 rounded-xl border border-destructive/40 bg-destructive/10 text-destructive flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <AlertCircle size={18} />
                        <span className="text-sm font-semibold">{errorMsg}</span>
                    </div>
                    <button
                        onClick={fetchOrders}
                        className="px-3 py-1 rounded-lg bg-destructive text-destructive-foreground text-xs font-bold hover:opacity-90"
                    >
                        Reintentar
                    </button>
                </div>
            )}

            {/* Estado de Carga (Skeleton) */}
            {loading && (
                <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="h-16 w-full bg-card/60 border border-border rounded-xl animate-pulse"></div>
                    ))}
                </div>
            )}

            {/* Vista de Tabla Desktop */}
            {!loading && orders.length > 0 && (
                <div className="hidden md:block bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-border bg-muted/30 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    <th className="py-3.5 px-4">Pedido / Origen</th>
                                    <th className="py-3.5 px-4">Socio</th>
                                    <th className="py-3.5 px-4">Tipo & Destino / Turno</th>
                                    <th className="py-3.5 px-4">Solicitud</th>
                                    <th className="py-3.5 px-4">Fechas</th>
                                    <th className="py-3.5 px-4">Estado</th>
                                    <th className="py-3.5 px-4 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60 text-sm">
                                {orders.map((order) => {
                                    const socioName = order.socio
                                        ? `${order.socio.nombre} ${order.socio.apellido}`
                                        : 'Socio no registrado';

                                    const isFinal = isFinalStatus(order.estado);

                                    return (
                                        <tr
                                            key={order.id}
                                            className="hover:bg-muted/40 transition-colors cursor-pointer group"
                                            onClick={() => router.push(`/admin/orders/${order.id}`)}
                                        >
                                            {/* ID y Origen */}
                                            <td className="py-3.5 px-4 font-mono">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-foreground">
                                                        #{order.id.slice(0, 8)}
                                                    </span>
                                                    {order.origen === 'admin' ? (
                                                        <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300">
                                                            SEDE
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                                            APP
                                                        </span>
                                                    )}
                                                    {order.archivado && (
                                                        <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300" title="Pedido archivado">
                                                            Archivado
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Socio */}
                                            <td className="py-3.5 px-4">
                                                <div>
                                                    <div className="font-bold text-foreground group-hover:text-primary transition-colors">
                                                        {socioName}
                                                    </div>
                                                    {order.socio?.dni && (
                                                        <div className="text-xs text-muted-foreground">
                                                            DNI {order.socio.dni}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Tipo y Turno / Destino */}
                                            <td className="py-3.5 px-4">
                                                <div className="flex items-center gap-1.5">
                                                    {order.tipoPedido === 'retiro_sede' ? (
                                                        <span className="font-semibold text-amber-600 dark:text-amber-400">
                                                            Retiro en Sede
                                                        </span>
                                                    ) : (
                                                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                                                            Delivery
                                                        </span>
                                                    )}

                                                    {order.ubicacion_gps && (
                                                        <a
                                                            href={order.ubicacion_gps}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="p-1 text-green-700 bg-green-100 dark:bg-green-900/40 dark:text-green-300 rounded hover:bg-green-200"
                                                            title="Ver ubicación en GPS"
                                                        >
                                                            <Navigation size={12} className="rotate-45" />
                                                        </a>
                                                    )}
                                                </div>
                                                {order.tipoPedido === 'retiro_sede' && order.fechaRetiroPreferida && (
                                                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                                        <Clock size={12} />
                                                        <span>Turno: {order.fechaRetiroPreferida} {order.franjaHoraria ? `(${order.franjaHoraria})` : ''}</span>
                                                    </div>
                                                )}
                                                {order.tipoPedido === 'delivery' && order.direccionEntrega && (
                                                    <div className="text-xs text-muted-foreground truncate max-w-[200px] mt-0.5">
                                                        {order.direccionEntrega} {order.localidad ? `(${order.localidad})` : ''}
                                                    </div>
                                                )}
                                            </td>

                                            {/* Solicitud / Productos */}
                                            <td className="py-3.5 px-4 max-w-[220px]">
                                                <div className="text-xs text-muted-foreground truncate" title={order.items?.map(i => `${i.cantidad}x ${i.productoNombre}`).join(', ')}>
                                                    {order.items && order.items.length > 0
                                                        ? order.items.map(i => `${i.cantidad}x ${i.productoNombre}`).join(', ')
                                                        : 'Sin productos informados'}
                                                </div>
                                            </td>

                                            {/* Fechas de Creación y Cierre */}
                                            <td className="py-3.5 px-4 whitespace-nowrap">
                                                <div className="text-xs">
                                                    <span className="font-medium text-foreground">
                                                        {new Date(order.fechaCreacion).toLocaleDateString()}
                                                    </span>
                                                    <span className="text-muted-foreground ml-1">
                                                        {new Date(order.fechaCreacion).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                {isFinal && order.updated_at && (
                                                    <div className="text-[11px] text-muted-foreground mt-0.5">
                                                        Cierre: {new Date(order.updated_at).toLocaleDateString()}
                                                    </div>
                                                )}
                                            </td>

                                            {/* Estado Canónico */}
                                            <td className="py-3.5 px-4">
                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                                                    order.estado === 'pendiente'
                                                        ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200'
                                                        : order.estado === 'en_preparacion'
                                                        ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200'
                                                        : order.estado === 'confirmado' || order.estado === 'en_camino'
                                                        ? 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/40 dark:text-indigo-200'
                                                        : order.estado === 'entregado' || order.estado === 'retirado'
                                                        ? 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-200'
                                                        : 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-200'
                                                }`}>
                                                    {getStatusLabel(order.estado, order.tipoPedido)}
                                                </span>
                                            </td>

                                            {/* Selector de Estado y Botones de Acción */}
                                            <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center justify-end gap-2">
                                                    {/* Selector de Estado */}
                                                    <select
                                                        value={order.estado}
                                                        onChange={(e) => handleStatusChangeRequest(order.id, e.target.value)}
                                                        className="py-1 px-2.5 rounded-lg border border-input bg-background text-xs font-semibold hover:bg-muted focus:ring-2 focus:ring-primary focus:outline-none cursor-pointer max-w-[140px]"
                                                    >
                                                        <option value="" disabled>Cambiar...</option>
                                                        {getNextStatusOptions(order.tipoPedido).map(opt => (
                                                            <option key={opt.value} value={opt.value}>
                                                                {opt.label}
                                                            </option>
                                                        ))}
                                                    </select>

                                                    {/* Botón Archivar / Restaurar */}
                                                    {order.archivado ? (
                                                        <button
                                                            onClick={() => setArchiveModalTarget({ id: order.id, socioNombre: socioName, archivado: false })}
                                                            className="p-1.5 text-muted-foreground hover:text-primary rounded-lg border border-border bg-background hover:bg-muted"
                                                            title="Restaurar pedido a listas activas"
                                                        >
                                                            <ArchiveRestore size={15} />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => setArchiveModalTarget({ id: order.id, socioNombre: socioName, archivado: true })}
                                                            className="p-1.5 text-muted-foreground hover:text-amber-600 rounded-lg border border-border bg-background hover:bg-muted"
                                                            title="Archivar pedido"
                                                        >
                                                            <Archive size={15} />
                                                        </button>
                                                    )}

                                                    {/* Botón Ver Detalle */}
                                                    <Link
                                                        href={`/admin/orders/${order.id}`}
                                                        className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg border border-border bg-background hover:bg-muted"
                                                        title="Ver ficha completa de la dispensa"
                                                    >
                                                        <Eye size={15} />
                                                    </Link>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Vista Mobile Cards */}
            {!loading && orders.length > 0 && (
                <div className="md:hidden flex flex-col gap-3">
                    {orders.map((order) => {
                        const socioName = order.socio
                            ? `${order.socio.nombre} ${order.socio.apellido}`
                            : 'Socio no registrado';
                        const isFinal = isFinalStatus(order.estado);

                        return (
                            <div
                                key={order.id}
                                onClick={() => router.push(`/admin/orders/${order.id}`)}
                                className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-3 cursor-pointer active:scale-[0.99] transition-transform"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono font-bold text-foreground text-sm">
                                            #{order.id.slice(0, 8)}
                                        </span>
                                        {order.origen === 'admin' ? (
                                            <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300">
                                                SEDE
                                            </span>
                                        ) : (
                                            <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                                APP
                                            </span>
                                        )}
                                        {order.archivado && (
                                            <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                                                Archivado
                                            </span>
                                        )}
                                    </div>
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${
                                        order.estado === 'pendiente'
                                            ? 'bg-amber-100 text-amber-800 border-amber-300'
                                            : order.estado === 'en_preparacion'
                                            ? 'bg-blue-100 text-blue-800 border-blue-300'
                                            : order.estado === 'entregado' || order.estado === 'retirado'
                                            ? 'bg-green-100 text-green-800 border-green-300'
                                            : 'bg-muted text-muted-foreground'
                                    }`}>
                                        {getStatusLabel(order.estado, order.tipoPedido)}
                                    </span>
                                </div>

                                <div>
                                    <div className="font-bold text-foreground">{socioName}</div>
                                    {order.socio?.dni && (
                                        <div className="text-xs text-muted-foreground">DNI {order.socio.dni}</div>
                                    )}
                                </div>

                                <div className="text-xs text-muted-foreground flex flex-col gap-1 border-t border-border/40 pt-2">
                                    <div className="flex items-center justify-between">
                                        <span>Tipo: <strong className="text-foreground">{order.tipoPedido === 'retiro_sede' ? 'Retiro en Sede' : 'Delivery'}</strong></span>
                                        <span>{new Date(order.fechaCreacion).toLocaleDateString()}</span>
                                    </div>
                                    {order.items && (
                                        <div className="truncate">
                                            Items: {order.items.map(i => `${i.cantidad}x ${i.productoNombre}`).join(', ')}
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center justify-between pt-2 border-t border-border/40" onClick={e => e.stopPropagation()}>
                                    <select
                                        value={order.estado}
                                        onChange={(e) => handleStatusChangeRequest(order.id, e.target.value)}
                                        className="py-1 px-2.5 rounded-lg border border-input bg-background text-xs font-semibold focus:outline-none"
                                    >
                                        <option value="" disabled>Cambiar estado...</option>
                                        {getNextStatusOptions(order.tipoPedido).map(opt => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>

                                    <div className="flex items-center gap-1.5">
                                        {order.archivado ? (
                                            <button
                                                onClick={() => setArchiveModalTarget({ id: order.id, socioNombre: socioName, archivado: false })}
                                                className="p-2 text-xs font-semibold rounded-lg border bg-background"
                                                title="Restaurar"
                                            >
                                                <ArchiveRestore size={16} />
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => setArchiveModalTarget({ id: order.id, socioNombre: socioName, archivado: true })}
                                                className="p-2 text-xs font-semibold rounded-lg border bg-background"
                                                title="Archivar"
                                            >
                                                <Archive size={16} />
                                            </button>
                                        )}
                                        <Link
                                            href={`/admin/orders/${order.id}`}
                                            className="p-2 text-xs font-semibold rounded-lg border bg-primary text-primary-foreground no-underline"
                                        >
                                            Ver
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Estado Vacío Contextual (solo cuando no hay error de carga) */}
            {!loading && !errorMsg && orders.length === 0 && (
                <div className="p-12 text-center bg-card border border-border rounded-2xl shadow-sm space-y-4">
                    <div className="w-16 h-16 rounded-full bg-muted/60 text-muted-foreground flex items-center justify-center mx-auto">
                        <Package size={32} />
                    </div>
                    <div className="space-y-1">
                        <h3 className="text-lg font-bold text-foreground">
                            {currentTab === 'active' && counts.active === 0
                                ? 'No hay pedidos activos actualmente'
                                : 'No se encontraron pedidos en esta vista'}
                        </h3>
                        <p className="text-sm text-muted-foreground max-w-md mx-auto">
                            {currentTab === 'active' && counts.finalized > 0
                                ? `Todos los pedidos se encuentran finalizados o entregados (${counts.finalized} disponibles). Podés consultarlos en la pestaña 'Finalizados' o 'Todos'.`
                                : currentSearch
                                ? `No se encontraron coincidencias para "${currentSearch}". Intentá con otro nombre, DNI o identificador.`
                                : 'Ajustá los filtros aplicados o iniciá una nueva dispensa con el botón superior.'}
                        </p>
                    </div>

                    <div className="flex items-center justify-center gap-3 pt-2">
                        {currentTab === 'active' && counts.finalized > 0 && (
                            <button
                                onClick={() => updateUrlParams({ tab: 'finalized', statusDetail: null })}
                                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
                            >
                                Ver Finalizados ({counts.finalized})
                            </button>
                        )}
                        {(currentSearch || currentOrigen !== 'all' || currentTipoPedido !== 'all' || currentDesde || currentHasta) && (
                            <button
                                onClick={handleResetFilters}
                                className="px-4 py-2 rounded-xl border border-border bg-card text-foreground hover:bg-muted text-sm font-semibold transition-colors"
                            >
                                Restablecer filtros
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Paginación Server-Side */}
            {!loading && pagination.totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-border">
                    <div className="text-xs text-muted-foreground">
                        Mostrando <strong className="text-foreground">{(pagination.page - 1) * pagination.limit + 1}</strong> a <strong className="text-foreground">{Math.min(pagination.page * pagination.limit, pagination.totalCount)}</strong> de <strong className="text-foreground">{pagination.totalCount}</strong> pedidos
                    </div>

                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => updateUrlParams({ page: Math.max(1, pagination.page - 1) })}
                            disabled={pagination.page <= 1}
                            className="p-2 rounded-xl border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none transition-colors"
                            title="Página anterior"
                        >
                            <ChevronLeft size={16} />
                        </button>

                        {/* Números de página */}
                        {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                            let pageNum = i + 1;
                            if (pagination.totalPages > 5 && pagination.page > 3) {
                                pageNum = pagination.page - 3 + i;
                                if (pageNum > pagination.totalPages) pageNum = pagination.totalPages - (4 - i);
                            }
                            if (pageNum < 1) pageNum = 1;

                            return (
                                <button
                                    key={pageNum}
                                    onClick={() => updateUrlParams({ page: pageNum })}
                                    className={`w-9 h-9 rounded-xl text-xs font-bold transition-all ${
                                        pagination.page === pageNum
                                            ? 'bg-primary text-primary-foreground shadow-sm'
                                            : 'border border-border bg-card text-foreground hover:bg-muted'
                                    }`}
                                >
                                    {pageNum}
                                </button>
                            );
                        })}

                        <button
                            onClick={() => updateUrlParams({ page: Math.min(pagination.totalPages, pagination.page + 1) })}
                            disabled={!pagination.hasMore}
                            className="p-2 rounded-xl border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none transition-colors"
                            title="Página siguiente"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Modal de Confirmación de Cambio de Estado */}
            {pendingChange && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-card w-full max-w-md rounded-2xl p-6 border border-border shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                                <AlertCircle size={22} />
                            </div>
                            <div>
                                <h3 className="font-bold text-foreground">Confirmar cambio de estado</h3>
                                <p className="text-xs text-muted-foreground">Esta acción actualizará el flujo de la dispensa.</p>
                            </div>
                        </div>

                        <p className="text-sm text-foreground/80">
                            ¿Cambiar estado del pedido <strong className="font-mono">#{pendingChange.id.slice(0, 8)}</strong> de <span className="font-semibold underline">{pendingChange.currentStatus}</span> a <span className="font-bold text-primary uppercase">{pendingChange.newStatus}</span>?
                        </p>

                        <div className="flex items-center justify-end gap-2.5 pt-2">
                            <button
                                onClick={() => setPendingChange(null)}
                                className="px-4 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={confirmStatusChange}
                                className="px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                            >
                                Confirmar Cambio
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Registro de Pago (Entregado / Retirado) */}
            {showPaymentModal && paymentModalOrder && paymentModalTargetStatus && (
                <PaymentRegistrationModal
                    isOpen={showPaymentModal}
                    orderItems={paymentModalOrder.items || []}
                    socioName={paymentModalOrder.socio ? `${paymentModalOrder.socio.nombre} ${paymentModalOrder.socio.apellido}` : 'Socio'}
                    onClose={() => {
                        setShowPaymentModal(false);
                        setPaymentModalOrder(null);
                        setPaymentModalTargetStatus(null);
                    }}
                    onConfirm={handlePaymentConfirm}
                />
            )}

            {/* Modal de Confirmación de Archivado Individual */}
            {archiveModalTarget && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-card w-full max-w-md rounded-2xl p-6 border border-border shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                archiveModalTarget.archivado ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                            }`}>
                                {archiveModalTarget.archivado ? <Archive size={22} /> : <ArchiveRestore size={22} />}
                            </div>
                            <div>
                                <h3 className="font-bold text-foreground">
                                    {archiveModalTarget.archivado ? 'Archivar pedido' : 'Restaurar pedido'}
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                    {archiveModalTarget.archivado ? 'Ocultar de la lista activa' : 'Volver a mostrar en listas principales'}
                                </p>
                            </div>
                        </div>

                        <div className="text-sm text-foreground/80 space-y-2">
                            <p>
                                {archiveModalTarget.archivado
                                    ? `¿Archivar el pedido #${archiveModalTarget.id.slice(0, 8)} de ${archiveModalTarget.socioNombre || 'socio'}?`
                                    : `¿Restaurar el pedido #${archiveModalTarget.id.slice(0, 8)} de ${archiveModalTarget.socioNombre || 'socio'} a las listas activas?`}
                            </p>
                            <p className="text-xs text-muted-foreground bg-muted/40 p-3 rounded-xl border border-border/60">
                                <strong>Nota importante:</strong> El archivado nunca elimina registros de la base de datos ni afecta stock ni aportes. El pedido puede ser consultado en la pestaña «Archivados».
                            </p>
                        </div>

                        <div className="flex items-center justify-end gap-2.5 pt-2">
                            <button
                                disabled={archiveActionLoading}
                                onClick={() => setArchiveModalTarget(null)}
                                className="px-4 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                disabled={archiveActionLoading}
                                onClick={handleToggleArchive}
                                className={`px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity ${
                                    archiveModalTarget.archivado ? 'bg-amber-600 hover:bg-amber-700' : 'bg-primary hover:opacity-90'
                                } disabled:opacity-50`}
                            >
                                {archiveActionLoading ? 'Procesando...' : (archiveModalTarget.archivado ? 'Confirmar Archivado' : 'Confirmar Restauración')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Confirmación de Archivado Masivo */}
            {showBulkArchiveModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-card w-full max-w-md rounded-2xl p-6 border border-border shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center">
                                <Archive size={22} />
                            </div>
                            <div>
                                <h3 className="font-bold text-foreground">Archivar pedidos finalizados</h3>
                                <p className="text-xs text-muted-foreground">Limpieza segura de vistas activas</p>
                            </div>
                        </div>

                        <div className="text-sm text-foreground/80 space-y-2">
                            <p>
                                ¿Archivar todos los pedidos finalizados (Entregados, Retirados y Cancelados)?
                            </p>
                            <p className="text-xs text-muted-foreground bg-muted/40 p-3 rounded-xl border border-border/60">
                                <strong>IMPORTANTE:</strong> Esta operación NO borra ningún dato de la base de datos. Los pedidos archivados continúan auditados y accesibles en cualquier momento desde la pestaña «Archivados».
                            </p>
                        </div>

                        <div className="flex items-center justify-end gap-2.5 pt-2">
                            <button
                                disabled={archiveActionLoading}
                                onClick={() => setShowBulkArchiveModal(false)}
                                className="px-4 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                disabled={archiveActionLoading}
                                onClick={handleBulkArchive}
                                className="px-4 py-2 rounded-xl text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white transition-colors disabled:opacity-50"
                            >
                                {archiveActionLoading ? 'Archivando...' : 'Confirmar Archivado Masivo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
