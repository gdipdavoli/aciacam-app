"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Search, Calendar, User, Package, ChevronDown, RefreshCw, TrendingUp, TrendingDown, Scale, Printer, FileText } from 'lucide-react';

export default function StockAuditPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'deduction' | 'adjustment' | 'create_delete'>('all');
    const [activeTab, setActiveTab] = useState<'reconciliation' | 'history'>('reconciliation');
    const [ordersMap, setOrdersMap] = useState<Record<string, { socioName: string; status: string }>>({});

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const [logsData, pedidosData, sociosData] = await Promise.all([
                StoreService.getProductAuditLogs(),
                StoreService.getAllPedidos(true),
                StoreService.getAllSocios()
            ]);

            const map: Record<string, { socioName: string; status: string }> = {};
            pedidosData.forEach((order: any) => {
                const socio = sociosData.find((s: any) => s.id === order.socioId);
                map[order.id] = {
                    socioName: socio ? `${socio.nombre} ${socio.apellido}` : 'Socio Desconocido',
                    status: order.estado
                };
            });

            setOrdersMap(map);
            setLogs(logsData);
        } catch (e) {
            console.error("Failed to fetch audit logs", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!authLoading && user && (user.rol === 'admin' || user.rol === 'staff')) {
            fetchLogs();
        } else if (!authLoading && user) {
            router.push('/');
        }
    }, [authLoading, user, router]);

    // Parse stock info and type from a log row
    const parseStockChange = (log: any) => {
        const action = log.action;
        const details = log.details || {};
        
        let oldStock = 0;
        let newStock = 0;
        let diff = 0;
        let productName = details.new?.nombre || details.after?.nombre || details.before?.nombre || details.old?.nombre || 'Producto Desconocido';
        let changeType = 'Actualización';
        
        const note = details.note || null;
        const orderId = details.order_id || null;

        if (action === 'CREATE') {
            newStock = details.after?.stock_disponible || 0;
            oldStock = 0;
            diff = newStock;
            changeType = 'Stock Inicial';
        } else if (action === 'DELETE') {
            oldStock = details.before?.stock_disponible || 0;
            newStock = 0;
            diff = -oldStock;
            changeType = 'Producto Eliminado';
        } else if (action === 'UPDATE') {
            oldStock = details.old?.stock_disponible ?? details.before?.stock_disponible ?? 0;
            newStock = details.new?.stock_disponible ?? details.after?.stock_disponible ?? 0;
            diff = newStock - oldStock;
            
            const changes = details.changes || {};
            const changedKeys = Object.keys(changes);
            
            if (orderId) {
                changeType = 'Deducción (Pedido/Dispensa)';
            } else if (changedKeys.includes('stock_disponible') || oldStock !== newStock) {
                changeType = diff < 0 ? 'Deducción (Ajuste)' : 'Ajuste de Stock';
            } else {
                changeType = 'Edición de variedad';
            }
        }

        return {
            productName,
            oldStock,
            newStock,
            diff,
            changeType,
            note,
            orderId
        };
    };

    // Process all logs to add parsed details and filter non-stock updates
    const processedAllLogs = logs
        .map(log => {
            const parsed = parseStockChange(log);
            return { ...log, parsed };
        })
        .filter(log => {
            // Only keep logs that actually changed stock_disponible (or creation/deletion)
            const details = log.details || {};
            const changes = details.changes || {};
            const oldStock = details.old?.stock_disponible ?? details.before?.stock_disponible;
            const newStock = details.new?.stock_disponible ?? details.after?.stock_disponible;
            
            return oldStock !== newStock || Object.keys(changes).includes('stock_disponible') || log.action === 'CREATE' || log.action === 'DELETE';
        });

    // Apply global filters (Search term + Date range)
    const filteredLogs = processedAllLogs.filter(log => {
        // 1. Variety Search Filter
        const matchesSearch = log.parsed.productName.toLowerCase().includes(searchTerm.toLowerCase());
        if (!matchesSearch) return false;

        // 2. Date range filter
        const logDate = new Date(log.created_at);
        if (startDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            if (logDate < start) return false;
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            if (logDate > end) return false;
        }

        return true;
    });

    // Calculate Inflows and Outflows based on FILTERED logs
    let totalInflow = 0;
    let totalOutflow = 0;

    filteredLogs.forEach(log => {
        const diff = log.parsed.diff;
        if (diff > 0) {
            totalInflow += diff;
        } else if (diff < 0) {
            totalOutflow += Math.abs(diff);
        }
    });

    // Group changes by normalized product name based on FILTERED logs (Prevent duplicates when recreated or name edited)
    const productSummaryMap: Record<string, {
        name: string;
        displayName: string;
        inflow: number;
        outflow: number;
        net: number;
    }> = {};

    filteredLogs.forEach(log => {
        const parsed = log.parsed;
        const diff = parsed.diff;
        
        // Normalize name: trim spaces, lowercase, replace multiple spaces with single space
        const normName = parsed.productName.trim().replace(/\s+/g, ' ').toLowerCase();

        if (!productSummaryMap[normName]) {
            productSummaryMap[normName] = {
                name: normName,
                displayName: parsed.productName, // Since logs is DESC (latest first), this captures the most recent name
                inflow: 0,
                outflow: 0,
                net: 0
            };
        }

        if (diff > 0) {
            productSummaryMap[normName].inflow += diff;
        } else if (diff < 0) {
            productSummaryMap[normName].outflow += Math.abs(diff);
        }
        productSummaryMap[normName].net += diff;
    });

    const productSummaries = Object.values(productSummaryMap).sort((a, b) => b.inflow + b.outflow - (a.inflow + a.outflow));

    // Filters specific for the history tab
    const historyLogsList = filteredLogs.filter(log => {
        if (filterType === 'all') return true;
        if (filterType === 'deduction') return log.parsed.diff < 0;
        if (filterType === 'adjustment') return log.parsed.diff > 0;
        if (filterType === 'create_delete') return log.action === 'CREATE' || log.action === 'DELETE';
        
        return true;
    });

    if (loading || authLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
                <RefreshCw className="animate-spin text-primary" size={32} />
                <p className="text-muted-foreground">Cargando registros de auditoría...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <style>{`
                @media print {
                    aside, nav, .print\\:hidden, button {
                        display: none !important;
                    }
                    main, .main {
                        margin: 0 !important;
                        padding: 0 !important;
                    }
                    body {
                        background-color: white !important;
                        color: black !important;
                    }
                    .print-report-container {
                        border: none !important;
                        box-shadow: none !important;
                    }
                }
            `}</style>

            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 print:hidden">
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => router.push('/admin/products')}
                        className="p-2 hover:bg-muted rounded-lg border transition-colors"
                        title="Volver a productos"
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Auditoría de Stock</h1>
                        <p className="text-sm text-muted-foreground">Historial de movimientos, conciliación y reporte de stock de variedades.</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchLogs}
                        className="flex items-center gap-2 px-3 py-2.5 border rounded-lg hover:bg-muted text-sm font-medium transition-colors bg-background"
                    >
                        <RefreshCw size={14} />
                        Actualizar
                    </button>

                    <button
                        onClick={() => window.print()}
                        className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:opacity-90 text-sm font-semibold transition-all shadow-sm"
                    >
                        <Printer size={15} />
                        Imprimir Reporte
                    </button>
                </div>
            </div>

            {/* Print Header (Only visible when printing) */}
            <div className="hidden print:block border-b pb-4 mb-6">
                <h1 className="text-3xl font-black text-emerald-900">ACIACAM</h1>
                <h2 className="text-xl font-bold text-foreground mt-1">Reporte de Auditoría y Conciliación de Stock</h2>
                <div className="text-xs text-muted-foreground mt-2 flex justify-between">
                    <span>Generado por: {user?.nombre} {user?.apellido}</span>
                    <span>Fecha: {new Date().toLocaleString('es-AR')}</span>
                </div>
                {/* Print Filter Subtitle */}
                {(startDate || endDate || searchTerm) && (
                    <div className="text-[10px] text-muted-foreground mt-1.5 uppercase font-bold tracking-wide">
                        Filtros Aplicados: {searchTerm && `Variedad: "${searchTerm}" `} {startDate && `Desde: ${startDate} `} {endDate && `Hasta: ${endDate}`}
                    </div>
                )}
            </div>

            {/* Unified Global Filters */}
            <div className="flex flex-col md:flex-row gap-4 bg-card p-4 rounded-xl border print:hidden">
                {/* Search Variety */}
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por variedad..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="pl-10 p-2.5 border rounded-lg w-full bg-background text-foreground text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                    />
                </div>
                
                {/* Date range inputs */}
                <div className="flex flex-col sm:flex-row items-center gap-2">
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider shrink-0">Desde:</span>
                        <input
                            type="date"
                            value={startDate}
                            onChange={e => setStartDate(e.target.value)}
                            className="p-2 border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-auto"
                        />
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider shrink-0">Hasta:</span>
                        <input
                            type="date"
                            value={endDate}
                            onChange={e => setEndDate(e.target.value)}
                            className="p-2 border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-auto"
                        />
                    </div>
                    
                    {/* Reset button */}
                    {(startDate || endDate || searchTerm) && (
                        <button
                            onClick={() => {
                                setStartDate('');
                                setEndDate('');
                                setSearchTerm('');
                            }}
                            className="text-xs text-red-500 hover:text-red-700 font-bold px-2.5 py-2 border border-red-200 bg-red-50 hover:bg-red-100 rounded-lg transition-colors w-full sm:w-auto text-center"
                        >
                            Limpiar Filtros
                        </button>
                    )}
                </div>
            </div>

            {/* Tabs Selector */}
            <div className="flex border-b print:hidden">
                <button
                    onClick={() => setActiveTab('reconciliation')}
                    className={`px-5 py-3 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
                        activeTab === 'reconciliation'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <Scale size={16} />
                    Resumen de Conciliación
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`px-5 py-3 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
                        activeTab === 'history'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <FileText size={16} />
                    Historial de Transacciones
                </button>
            </div>

            {/* SECTION: SUMMARY CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1. Inflow Card */}
                <div className="bg-card p-5 rounded-2xl border shadow-sm flex items-center gap-4">
                    <div className="p-3.5 bg-green-50 text-green-600 dark:bg-green-950/20 dark:text-green-400 rounded-xl">
                        <TrendingUp size={24} />
                    </div>
                    <div>
                        <span className="text-xs text-muted-foreground font-medium block">Total Ingresos / Carga</span>
                        <span className="text-2xl font-black text-green-600 dark:text-green-400 mt-1 block">+{totalInflow} u.</span>
                    </div>
                </div>

                {/* 2. Outflow Card */}
                <div className="bg-card p-5 rounded-2xl border shadow-sm flex items-center gap-4">
                    <div className="p-3.5 bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400 rounded-xl">
                        <TrendingDown size={24} />
                    </div>
                    <div>
                        <span className="text-xs text-muted-foreground font-medium block">Total Egresos / Dispensas</span>
                        <span className="text-2xl font-black text-red-600 dark:text-red-400 mt-1 block">-{totalOutflow} u.</span>
                    </div>
                </div>

                {/* 3. Net Balance Card */}
                <div className="bg-card p-5 rounded-2xl border shadow-sm flex items-center gap-4">
                    <div className={`p-3.5 rounded-xl ${
                        totalInflow - totalOutflow >= 0
                            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400'
                            : 'bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400'
                    }`}>
                        <Scale size={24} />
                    </div>
                    <div>
                        <span className="text-xs text-muted-foreground font-medium block">Balance Neto</span>
                        <span className={`text-2xl font-black mt-1 block ${
                            totalInflow - totalOutflow >= 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                        }`}>
                            {totalInflow - totalOutflow >= 0 ? '+' : ''}{totalInflow - totalOutflow} u.
                        </span>
                    </div>
                </div>
            </div>

            {/* TAB: RECONCILIATION SUMMARY */}
            {activeTab === 'reconciliation' && (
                <div className="space-y-6">
                    <div className="bg-card rounded-xl border overflow-hidden shadow-sm print-report-container">
                        <div className="p-5 border-b bg-muted/20 print:hidden">
                            <h3 className="font-bold text-foreground">Desglose de Conciliación por Variedad</h3>
                            <p className="text-xs text-muted-foreground mt-1">Suma acumulada de entradas y salidas registradas en la auditoría de cada genética.</p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        <th className="p-4">Variedad / Genética</th>
                                        <th className="p-4 text-center">Total Ingresado (+)</th>
                                        <th className="p-4 text-center">Total Egresado (-)</th>
                                        <th className="p-4 text-center">Variación Neta</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border text-sm">
                                    {productSummaries.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="p-12 text-center text-muted-foreground">
                                                No se encontraron registros de conciliación de stock para los filtros aplicados.
                                            </td>
                                        </tr>
                                    ) : (
                                        productSummaries.map((summary) => (
                                            <tr key={summary.name} className="hover:bg-muted/10 transition-colors">
                                                <td className="p-4 font-bold text-foreground">
                                                    <div className="flex items-center gap-2">
                                                        <Package size={16} className="text-muted-foreground" />
                                                        {summary.displayName}
                                                    </div>
                                                </td>
                                                <td className="p-4 text-center text-green-600 dark:text-green-400 font-mono font-bold">
                                                    +{summary.inflow} u.
                                                </td>
                                                <td className="p-4 text-center text-red-600 dark:text-red-400 font-mono font-bold">
                                                    -{summary.outflow} u.
                                                </td>
                                                <td className="p-4 text-center font-mono font-black">
                                                    <span className={`px-2 py-0.5 rounded ${
                                                        summary.net > 0 
                                                            ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' 
                                                            : summary.net < 0 
                                                            ? 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400' 
                                                            : 'bg-muted text-muted-foreground'
                                                    }`}>
                                                        {summary.net > 0 ? '+' : ''}{summary.net} u.
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB: HISTORY LOGS */}
            {activeTab === 'history' && (
                <div className="space-y-6">
                    {/* Filters specific to history tab */}
                    <div className="flex flex-wrap gap-2 print:hidden">
                        <button
                            onClick={() => setFilterType('all')}
                            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${filterType === 'all' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted border'}`}
                        >
                            Todos
                        </button>
                        <button
                            onClick={() => setFilterType('deduction')}
                            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${filterType === 'deduction' ? 'bg-orange-50 text-orange-700 border-orange-200 border hover:bg-orange-100/50' : 'bg-background hover:bg-muted border'}`}
                        >
                            Salidas / Deducciones
                        </button>
                        <button
                            onClick={() => setFilterType('adjustment')}
                            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${filterType === 'adjustment' ? 'bg-green-50 text-green-700 border-green-200 border hover:bg-green-100/50' : 'bg-background hover:bg-muted border'}`}
                        >
                            Ajustes / Entradas
                        </button>
                        <button
                            onClick={() => setFilterType('create_delete')}
                            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${filterType === 'create_delete' ? 'bg-blue-50 text-blue-700 border-blue-200 border hover:bg-blue-100/50' : 'bg-background hover:bg-muted border'}`}
                        >
                            Altas / Bajas
                        </button>
                    </div>

                    {/* List */}
                    <div className="bg-card rounded-xl border overflow-hidden shadow-sm print-report-container">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        <th className="p-4">Fecha</th>
                                        <th className="p-4">Variedad</th>
                                        <th className="p-4">Usuario Responsable</th>
                                        <th className="p-4">Tipo de Movimiento</th>
                                        <th className="p-4 text-center">Stock Anterior</th>
                                        <th className="p-4 text-center">Ajuste</th>
                                        <th className="p-4 text-center">Stock Nuevo</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border text-sm">
                                    {historyLogsList.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="p-12 text-center text-muted-foreground">
                                                No se encontraron registros de modificaciones de stock para los filtros aplicados.
                                            </td>
                                        </tr>
                                    ) : (
                                        historyLogsList.map((log) => {
                                            const { productName, oldStock, newStock, diff, changeType, note, orderId } = log.parsed;
                                            const actorName = log.actor 
                                                ? `${log.actor.nombre} ${log.actor.apellido}`
                                                : 'Sistema / Proceso Automático';
                                            
                                            let diffColor = 'text-gray-600 dark:text-gray-400';
                                            let diffBg = 'bg-gray-100 dark:bg-gray-800';
                                            let diffText = `${diff}`;

                                            if (diff > 0) {
                                                diffColor = 'text-green-700 dark:text-green-400 font-bold';
                                                diffBg = 'bg-green-50 dark:bg-green-950/30';
                                                diffText = `+${diff}`;
                                            } else if (diff < 0) {
                                                diffColor = 'text-red-700 dark:text-red-400 font-bold';
                                                diffBg = 'bg-red-50 dark:bg-red-950/30';
                                                diffText = `${diff}`;
                                            }

                                            return (
                                                <tr key={log.id} className="hover:bg-muted/10 transition-colors">
                                                    <td className="p-4 whitespace-nowrap text-muted-foreground">
                                                        <div className="flex items-center gap-2">
                                                            <Calendar size={14} />
                                                            {new Date(log.created_at).toLocaleString('es-AR', {
                                                                day: '2-digit',
                                                                month: '2-digit',
                                                                year: 'numeric',
                                                                hour: '2-digit',
                                                                minute: '2-digit'
                                                            })}
                                                        </div>
                                                    </td>
                                                    <td className="p-4 font-medium">
                                                        <div className="flex flex-col">
                                                            <div className="flex items-center gap-2 text-foreground font-semibold">
                                                                <Package size={16} className="text-muted-foreground" />
                                                                {productName}
                                                            </div>
                                                            {note && (
                                                                <span className="text-xs text-muted-foreground mt-0.5 font-normal bg-muted/50 px-1.5 py-0.5 rounded max-w-max italic">
                                                                    Nota: {note}
                                                                </span>
                                                            )}
                                                            {orderId && (
                                                                <>
                                                                    <Link 
                                                                        href={`/admin/orders/${orderId}`} 
                                                                        className="text-xs text-primary hover:underline mt-1 font-semibold flex items-center gap-1 print:hidden"
                                                                    >
                                                                        👤 Socio: {ordersMap[orderId]?.socioName || `Pedido #${orderId.substring(0, 8)}`}
                                                                        {ordersMap[orderId]?.status === 'cancelado' && (
                                                                            <span className="text-red-500 font-bold ml-1.5 text-[10px] bg-red-50 px-1 py-0.5 rounded border border-red-200 uppercase">
                                                                                (Cancelado)
                                                                            </span>
                                                                        )}
                                                                    </Link>
                                                                    <span className="hidden print:inline text-xs text-muted-foreground mt-0.5">
                                                                        Socio: {ordersMap[orderId]?.socioName || `Pedido #${orderId.substring(0, 8)}`}
                                                                        {ordersMap[orderId]?.status === 'cancelado' && ' (Cancelado)'}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-muted-foreground">
                                                        <div className="flex items-center gap-2">
                                                            <User size={14} />
                                                            {actorName}
                                                        </div>
                                                    </td>
                                                    <td className="p-4">
                                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                            changeType.includes('Deducción') 
                                                                ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300'
                                                                : changeType.includes('Ajuste')
                                                                ? 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300'
                                                                : changeType.includes('Inicial')
                                                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                                                                : 'bg-muted text-muted-foreground'
                                                        }`}>
                                                            {changeType}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-center font-mono text-muted-foreground">
                                                        {oldStock} u.
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        <span className={`px-2.5 py-1 rounded-md text-xs ${diffBg} ${diffColor}`}>
                                                            {diffText} u.
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-center font-mono font-semibold">
                                                        {newStock} u.
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
