"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Search, Calendar, User, Package, ChevronDown, RefreshCw } from 'lucide-react';

export default function StockAuditPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'deduction' | 'adjustment' | 'create_delete'>('all');

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const data = await StoreService.getProductAuditLogs();
            setLogs(data);
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
            
            // Check if only stock_disponible changed
            const changes = details.changes || {};
            const changedKeys = Object.keys(changes);
            const onlyStock = changedKeys.length === 1 && changedKeys.includes('stock_disponible');
            
            if (onlyStock) {
                changeType = diff < 0 ? 'Deducción (Pedido/Dispensa)' : 'Ajuste de Stock';
            } else if (changedKeys.includes('stock_disponible')) {
                changeType = 'Edición General (Stock Modificado)';
            } else {
                changeType = 'Edición de variedad';
            }
        }

        return {
            productName,
            oldStock,
            newStock,
            diff,
            changeType
        };
    };

    const filteredLogs = logs
        .map(log => {
            const parsed = parseStockChange(log);
            return { ...log, parsed };
        })
        // Filter logs to show only stock-related changes
        .filter(log => {
            const action = log.action;
            const details = log.details || {};
            
            if (action === 'CREATE' || action === 'DELETE') return true;
            
            // Check if stock was updated
            const changes = details.changes || {};
            const oldStock = details.old?.stock_disponible ?? details.before?.stock_disponible;
            const newStock = details.new?.stock_disponible ?? details.after?.stock_disponible;
            
            return oldStock !== newStock || Object.keys(changes).includes('stock_disponible');
        })
        .filter(log => {
            // Search filter
            const matchesSearch = log.parsed.productName.toLowerCase().includes(searchTerm.toLowerCase());
            
            // Type filter
            if (filterType === 'all') return matchesSearch;
            if (filterType === 'deduction') return matchesSearch && log.parsed.diff < 0 && log.parsed.changeType.includes('Deducción');
            if (filterType === 'adjustment') return matchesSearch && log.parsed.diff > 0 && log.parsed.changeType.includes('Ajuste');
            if (filterType === 'create_delete') return matchesSearch && (log.action === 'CREATE' || log.action === 'DELETE');
            
            return matchesSearch;
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
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
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
                        <p className="text-sm text-muted-foreground">Historial de movimientos, ajustes y entregas de stock de variedades.</p>
                    </div>
                </div>
                <button
                    onClick={fetchLogs}
                    className="flex items-center gap-2 px-3 py-2 border rounded-lg hover:bg-muted text-sm font-medium transition-colors"
                >
                    <RefreshCw size={14} />
                    Actualizar
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-xl border">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                    <input
                        type="text"
                        placeholder="Filtrar por variedad..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="pl-10 p-2.5 border rounded-lg w-full bg-background text-foreground text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                    />
                </div>
                
                <div className="flex gap-2">
                    <button
                        onClick={() => setFilterType('all')}
                        className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${filterType === 'all' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted border'}`}
                    >
                        Todos
                    </button>
                    <button
                        onClick={() => setFilterType('deduction')}
                        className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${filterType === 'deduction' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300' : 'bg-background hover:bg-muted border'}`}
                    >
                        Deducciones/Ventas
                    </button>
                    <button
                        onClick={() => setFilterType('adjustment')}
                        className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${filterType === 'adjustment' ? 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300' : 'bg-background hover:bg-muted border'}`}
                    >
                        Ajustes/Ingresos
                    </button>
                    <button
                        onClick={() => setFilterType('create_delete')}
                        className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${filterType === 'create_delete' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300' : 'bg-background hover:bg-muted border'}`}
                    >
                        Altas/Bajas
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="bg-card rounded-xl border overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <th className="p-4">Fecha</th>
                                <th className="p-4">Variedad</th>
                                <th className="p-4">Usuario Responsable</th>
                                <th className="p-4">Tipo de Movimiento</th>
                                <th className="p-4 text-center">Stock Inicial</th>
                                <th className="p-4 text-center">Ajuste</th>
                                <th className="p-4 text-center">Stock Final</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border text-sm">
                            {filteredLogs.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="p-12 text-center text-muted-foreground">
                                        No se encontraron registros de modificaciones de stock.
                                    </td>
                                </tr>
                            ) : (
                                filteredLogs.map((log) => {
                                    const { productName, oldStock, newStock, diff, changeType } = log.parsed;
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
                                                <div className="flex items-center gap-2">
                                                    <Package size={16} className="text-muted-foreground" />
                                                    {productName}
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
    );
}
