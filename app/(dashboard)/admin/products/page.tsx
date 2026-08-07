"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { ProductoWithStockInfo } from '@/types';
import { useRouter } from 'next/navigation';
import { Plus, Edit, Trash2, CheckCircle, XCircle, Search, ImageIcon, History, Copy } from 'lucide-react';

export default function AdminProductsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [products, setProducts] = useState<ProductoWithStockInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
    const [searchTerm, setSearchTerm] = useState('');

    // Adjustment Drawer States (Mobile)
    const [adjustingProduct, setAdjustingProduct] = useState<ProductoWithStockInfo | null>(null);
    const [adjustQty, setAdjustQty] = useState<number>(0);
    const [adjustReason, setAdjustReason] = useState<string>('');
    const [adjustType, setAdjustType] = useState<'add' | 'subtract'>('add');
    const [submittingAdjust, setSubmittingAdjust] = useState(false);

    // Audit Log Drawer States (Mobile)
    const [auditingProduct, setAuditingProduct] = useState<ProductoWithStockInfo | null>(null);
    const [productLogs, setProductLogs] = useState<any[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);

    const fetchProducts = () => {
        setLoading(true);
        StoreService.getVariedadesWithStockInfo()
            .then(data => {
                setProducts(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    };

    useEffect(() => {
        if (!authLoading && user && (user.rol === 'admin' || user.rol === 'staff')) {
            fetchProducts();
        } else if (!authLoading && user) {
            router.push('/');
        }
    }, [authLoading, user, router]);

    const handleDelete = async (id: string) => {
        if (!user) return;
        if (confirm('¿Estás seguro de eliminar este producto?')) {
            await StoreService.deleteProduct(id, user.id);
            fetchProducts();
        }
    };

    const handleToggleActive = async (product: ProductoWithStockInfo) => {
        if (!user) return;
        const newState = !product.activo;
        // Optimistic update
        setProducts(prev => prev.map(p => p.id === product.id ? { ...p, activo: newState } : p));

        try {
            await StoreService.updateProduct(product.id, { activo: newState }, user.id);
        } catch (e) {
            console.error("Failed to toggle", e);
            fetchProducts(); // Revert on error
        }
    };

    const handleSaveAdjustment = async () => {
        if (!adjustingProduct || !user || !adjustQty || !adjustReason) return;
        setSubmittingAdjust(true);
        try {
            const currentStock = adjustingProduct.stock_fisico;
            const newStock = adjustType === 'add'
                ? currentStock + adjustQty
                : Math.max(0, currentStock - adjustQty);

            // Calculate new available stock (taking reservation into account)
            const newAvailable = Math.max(0, newStock - adjustingProduct.stock_reservado);

            // Update in Supabase
            await StoreService.updateProduct(adjustingProduct.id, { 
                stockDisponible: newAvailable 
            }, user.id);

            // Log in audit log
            await StoreService.createAuditLog(user.id, 'UPDATE', 'PRODUCT', adjustingProduct.id, {
                old: { stock_disponible: adjustingProduct.stock_disponible },
                new: { stock_disponible: newAvailable },
                observation: adjustReason
            });

            alert("Ajuste de stock realizado correctamente.");
            setAdjustingProduct(null);
            setAdjustQty(0);
            setAdjustReason('');
            fetchProducts();
        } catch (error) {
            console.error("Error adjusting stock:", error);
            alert("Hubo un error al ajustar el stock.");
        } finally {
            setSubmittingAdjust(false);
        }
    };

    const handleOpenAudit = async (product: ProductoWithStockInfo) => {
        setAuditingProduct(product);
        setLoadingLogs(true);
        try {
            const logs = await StoreService.getProductAuditLogs();
            const filtered = logs.filter((log: any) => log.entity_id === product.id);
            setProductLogs(filtered);
        } catch (error) {
            console.error("Error fetching product audit logs:", error);
        } finally {
            setLoadingLogs(false);
        }
    };

    const filteredProducts = products.filter(p => {
        const matchesSearch = p.nombre.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = filterStatus === 'all'
            ? true
            : filterStatus === 'active' ? p.activo
                : !p.activo; // inactive
        return matchesSearch && matchesStatus;
    });

    if (loading || authLoading) return <div className="p-8">Cargando catálogo...</div>;

    return (
        <div className="space-y-6 max-w-6xl mx-auto pb-12">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Productos / Stock</h1>
                    <p className="text-sm text-muted-foreground">Gestiona el catálogo de dispensas y el control de inventario.</p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                        onClick={() => router.push('/admin/products/audit')}
                        className="flex-1 sm:flex-initial bg-secondary text-secondary-foreground border px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 text-xs font-bold hover:bg-muted transition-colors shadow-sm"
                    >
                        <History size={16} />
                        Historial de Auditoría
                    </button>
                    <button
                        onClick={() => router.push('/admin/products/new')}
                        className="flex-1 sm:flex-initial bg-primary text-primary-foreground px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 text-xs font-bold hover:bg-primary/95 transition-colors shadow-md"
                    >
                        <Plus size={16} />
                        Nuevo Producto
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex gap-4 mb-6 sticky top-0 bg-background z-10 py-2 border-b border-border">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar producto..."
                        className="pl-10 p-2 border border-input rounded-md w-full bg-background text-foreground text-sm"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <select
                    className="p-2 border border-input rounded-md min-w-[150px] bg-background text-foreground text-sm"
                    value={filterStatus}
                    onChange={(e: any) => setFilterStatus(e.target.value)}
                >
                    <option value="all">Todos</option>
                    <option value="active">Activos</option>
                    <option value="inactive">Inactivos</option>
                </select>
            </div>

            {/* 1. MOBILE-FIRST CARDS VIEW (< 768px) */}
            <div className="md:hidden space-y-3">
                {filteredProducts.length === 0 ? (
                    <div className="text-center py-12 bg-card rounded-2xl border border-dashed p-6">
                        <p className="text-sm font-medium text-muted-foreground">No se encontraron productos.</p>
                    </div>
                ) : (
                    filteredProducts.map(product => (
                        <div 
                            key={product.id} 
                            className={`bg-card border rounded-2xl p-4 shadow-sm space-y-4 transition-all ${
                                !product.activo ? 'opacity-60 bg-muted/40' : ''
                            }`}
                        >
                            {/* Head Section */}
                            <div className="flex justify-between items-start gap-4">
                                <div className="min-w-0">
                                    <h4 className="font-bold text-foreground leading-tight text-sm truncate">{product.nombre}</h4>
                                    <span className="text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase mt-1 inline-block">
                                        {product.categoria}
                                    </span>
                                </div>
                                <button
                                    onClick={() => handleToggleActive(product)}
                                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all shrink-0 ${
                                        product.activo
                                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                    }`}
                                >
                                    {product.activo ? 'Activo' : 'Inactivo'}
                                </button>
                            </div>

                            {/* 3-Column Metrics Block */}
                            <div className="grid grid-cols-3 gap-2 bg-muted/30 p-3 rounded-xl text-center text-xs font-semibold">
                                <div className="border-r">
                                    <span className="text-muted-foreground block mb-0.5 text-[10px]">Disponible</span>
                                    <span className="text-green-600 block font-black">{product.stock_disponible}g</span>
                                </div>
                                <div className="border-r">
                                    <span className="text-muted-foreground block mb-0.5 text-[10px]">Reservado</span>
                                    <span className="text-amber-600 block font-black">{product.stock_reservado}g</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block mb-0.5 text-[10px]">Físico</span>
                                    <span className="text-foreground block font-black">{product.stock_fisico}g</span>
                                </div>
                            </div>

                            {/* Action buttons (1-Tap Buttons) */}
                            <div className="grid grid-cols-3 gap-2 pt-1">
                                <button
                                    onClick={() => {
                                        setAdjustingProduct(product);
                                        setAdjustQty(0);
                                        setAdjustReason('');
                                        setAdjustType('add');
                                    }}
                                    className="bg-primary hover:bg-primary/95 text-primary-foreground py-2.5 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1 shadow-sm"
                                    style={{ backgroundColor: '#0F3822' }}
                                >
                                    <Plus size={14} />
                                    Stock
                                </button>
                                <button
                                    onClick={() => handleOpenAudit(product)}
                                    className="bg-card hover:bg-muted border text-foreground py-2.5 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1 shadow-sm"
                                >
                                    <History size={14} />
                                    Auditar
                                </button>
                                <button
                                    onClick={() => router.push(`/admin/products/${product.id}`)}
                                    className="bg-card hover:bg-muted border text-foreground py-2.5 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1 shadow-sm"
                                >
                                    <Edit size={14} />
                                    Editar
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* 2. DESKTOP TRADITIONAL TABLE VIEW (>= 768px) */}
            <div className="hidden md:block bg-card rounded-lg border shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b bg-muted/50 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                <th className="p-4">Imagen</th>
                                <th className="p-4">Nombre</th>
                                <th className="p-4">Categoría</th>
                                <th className="p-4">Stock</th>
                                <th className="p-4">Estado</th>
                                <th className="p-4 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredProducts.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                                        No se encontraron productos.
                                    </td>
                                </tr>
                            ) : (
                                filteredProducts.map(product => (
                                    <tr key={product.id} className={`border-b border-border hover:bg-muted/20 ${!product.activo ? 'opacity-60 bg-muted/40' : ''}`}>
                                        <td className="p-4">
                                            {product.imagen ? (
                                                <img
                                                    src={product.imagen}
                                                    alt={product.nombre}
                                                    className="w-12 h-12 object-cover rounded-md border border-border"
                                                />
                                            ) : (
                                                <div className="w-12 h-12 bg-muted rounded-md flex items-center justify-center text-muted-foreground border border-border">
                                                    <ImageIcon size={20} />
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <div className="font-medium text-foreground">{product.nombre}</div>
                                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">{product.descripcion}</div>
                                        </td>
                                        <td className="p-4 text-sm">{product.categoria}</td>
                                        <td className="p-4 text-sm font-medium">
                                            <div className="flex flex-col gap-0.5">
                                                <span className="text-foreground">
                                                    Físico: <strong className="text-foreground font-semibold">{product.stock_fisico}</strong>g
                                                </span>
                                                {product.stock_reservado > 0 ? (
                                                    <span className="text-xs text-amber-600 dark:text-amber-400">
                                                        Reservado: {product.stock_reservado}g
                                                    </span>
                                                ) : null}
                                                <span className={`text-xs ${product.stock_disponible > 0 ? "text-green-600 dark:text-green-400" : "text-red-500 font-medium"}`}>
                                                    Disponible: {product.stock_disponible}g
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <button
                                                onClick={() => handleToggleActive(product)}
                                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold max-w-fit transition-all ${product.activo
                                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200'
                                                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                                    }`}
                                            >
                                                {product.activo ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                                {product.activo ? 'Activo' : 'Inactivo'}
                                            </button>
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => router.push(`/admin/products/new?duplicate=${product.id}`)}
                                                    className="p-2 hover:bg-secondary rounded-md text-muted-foreground hover:text-foreground transition-colors"
                                                    title="Duplicar"
                                                >
                                                    <Copy size={16} />
                                                </button>
                                                <button
                                                    onClick={() => router.push(`/admin/products/${product.id}`)}
                                                    className="p-2 hover:bg-secondary rounded-md text-muted-foreground hover:text-foreground transition-colors"
                                                    title="Editar"
                                                >
                                                    <Edit size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(product.id)}
                                                    className="p-2 hover:bg-destructive/10 rounded-md text-destructive hover:text-destructive transition-colors"
                                                    title="Eliminar"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* --- MODAL DRAWERS (MOBILE ONLY) --- */}

            {/* 1. Stock Adjust Drawer */}
            {adjustingProduct && (
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end justify-center md:hidden"
                    onClick={() => setAdjustingProduct(null)}
                >
                    <div 
                        className="bg-card w-full max-w-md rounded-t-2xl shadow-2xl border-t border-border p-6 pb-8 animate-in slide-in-from-bottom duration-200 overflow-y-auto max-h-[85%]"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Drag indicator */}
                        <div className="w-12 h-1.5 bg-muted rounded-full mx-auto mb-6 opacity-60"></div>
                        
                        <h3 className="text-lg font-black text-foreground mb-1">Ajustar Stock</h3>
                        <p className="text-xs text-muted-foreground mb-4">
                            Modificando: <strong className="text-primary">{adjustingProduct.nombre}</strong>
                        </p>
                        
                        {/* Metrics summary */}
                        <div className="grid grid-cols-3 gap-2 bg-muted/30 p-3.5 rounded-xl text-center mb-5 text-xs font-semibold">
                            <div>
                                <span className="text-muted-foreground block mb-0.5">Disponible</span>
                                <span className="text-green-600 block font-black">{adjustingProduct.stock_disponible}g</span>
                            </div>
                            <div>
                                <span className="text-muted-foreground block mb-0.5">Reservado</span>
                                <span className="text-amber-600 block font-black">{adjustingProduct.stock_reservado}g</span>
                            </div>
                            <div>
                                <span className="text-muted-foreground block mb-0.5">Físico</span>
                                <span className="text-foreground block font-black">{adjustingProduct.stock_fisico}g</span>
                            </div>
                        </div>

                        {/* Adjust Type Selection */}
                        <div className="flex bg-muted/60 p-1 rounded-xl mb-4 text-xs font-bold">
                            <button
                                onClick={() => setAdjustType('add')}
                                className={`flex-1 py-2.5 rounded-lg transition-all ${
                                    adjustType === 'add' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
                                }`}
                                style={adjustType === 'add' ? { backgroundColor: '#0F3822' } : {}}
                            >
                                Aumentar (+)
                            </button>
                            <button
                                onClick={() => setAdjustType('subtract')}
                                className={`flex-1 py-2.5 rounded-lg transition-all ${
                                    adjustType === 'subtract' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
                                }`}
                                style={adjustType === 'subtract' ? { backgroundColor: '#0F3822' } : {}}
                            >
                                Disminuir (-)
                            </button>
                        </div>

                        {/* Grams Input */}
                        <div className="space-y-1.5 mb-4">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">Gramos a Ajustar</label>
                            <input
                                type="number"
                                min="1"
                                placeholder="Ej: 10"
                                value={adjustQty || ''}
                                onChange={e => setAdjustQty(Math.max(1, parseInt(e.target.value) || 0))}
                                className="w-full p-3 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                            />
                        </div>

                        {/* Reason Input */}
                        <div className="space-y-1.5 mb-6">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">Motivo / Observación</label>
                            <textarea
                                placeholder="Ej: Ingreso de cosecha, diferencia de balanza, etc."
                                value={adjustReason}
                                onChange={e => setAdjustReason(e.target.value)}
                                rows={3}
                                className="w-full p-3 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                            />
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col gap-2">
                            <button
                                onClick={handleSaveAdjustment}
                                disabled={submittingAdjust || !adjustQty || !adjustReason}
                                className="w-full py-4 text-white rounded-xl text-sm font-black transition-all shadow-md disabled:opacity-50"
                                style={{ backgroundColor: '#0F3822' }}
                            >
                                {submittingAdjust ? 'Guardando...' : 'Confirmar Ajuste'}
                            </button>
                            <button
                                onClick={() => setAdjustingProduct(null)}
                                className="w-full py-4 bg-muted hover:bg-muted/80 text-muted-foreground rounded-xl text-sm font-black transition-colors"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 2. Audit Log Drawer */}
            {auditingProduct && (
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end justify-center md:hidden"
                    onClick={() => setAuditingProduct(null)}
                >
                    <div 
                        className="bg-card w-full max-w-md rounded-t-2xl shadow-2xl border-t border-border p-6 pb-8 animate-in slide-in-from-bottom duration-200 overflow-y-auto max-h-[85%]"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Drag handle */}
                        <div className="w-12 h-1.5 bg-muted rounded-full mx-auto mb-6 opacity-60"></div>

                        <h3 className="text-lg font-black text-foreground mb-1">Historial de Auditoría</h3>
                        <p className="text-xs text-muted-foreground mb-4">
                            Historial para: <strong className="text-primary">{auditingProduct.nombre}</strong>
                        </p>

                        <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-1 mb-6">
                            {loadingLogs ? (
                                <div className="text-center py-6 text-xs text-muted-foreground">Cargando movimientos...</div>
                            ) : productLogs.length === 0 ? (
                                <div className="text-center py-6 text-xs text-muted-foreground italic">No hay movimientos registrados.</div>
                            ) : (
                                productLogs.map(log => {
                                    const dateStr = new Date(log.created_at).toLocaleDateString('es-AR', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    });

                                    const details = log.details || {};
                                    const oldStock = details.old?.stock_disponible ?? details.before?.stock_disponible ?? 0;
                                    const newStock = details.new?.stock_disponible ?? details.after?.stock_disponible ?? 0;
                                    const diff = newStock - oldStock;
                                    
                                    const actorName = log.actor ? `${log.actor.nombre} ${log.actor.apellido}` : 'Sistema';

                                    return (
                                        <div key={log.id} className="p-3 bg-muted/30 rounded-xl border text-xs space-y-1">
                                            <div className="flex justify-between items-center">
                                                <span className="font-bold text-foreground">{log.action === 'CREATE' ? 'Carga Inicial' : 'Ajuste'}</span>
                                                <span className={`font-black ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    {diff >= 0 ? `+${diff}` : diff}g
                                                </span>
                                            </div>
                                            <p className="text-muted-foreground italic">"{details.observation || log.details?.concept || 'Ajuste de stock'}"</p>
                                            <div className="text-[10px] text-muted-foreground/85 flex justify-between">
                                                <span>Por: {actorName}</span>
                                                <span>{dateStr}</span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        <button
                            onClick={() => setAuditingProduct(null)}
                            className="w-full py-4 bg-muted hover:bg-muted/80 text-muted-foreground rounded-xl text-sm font-black transition-colors"
                        >
                            Cerrar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
