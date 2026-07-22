"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Producto } from '@/types';
import { useRouter } from 'next/navigation';
import { Plus, Edit, Trash2, CheckCircle, XCircle, Search, ImageIcon, History, Copy } from 'lucide-react';

export default function AdminProductsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [products, setProducts] = useState<Producto[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
    const [searchTerm, setSearchTerm] = useState('');

    const fetchProducts = () => {
        setLoading(true);
        StoreService.getProductos(true) // Fetch ALL (include inactive)
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

    const handleToggleActive = async (product: Producto) => {
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

    const filteredProducts = products.filter(p => {
        const matchesSearch = p.nombre.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = filterStatus === 'all'
            ? true
            : filterStatus === 'active' ? p.activo
                : !p.activo; // inactive
        return matchesSearch && matchesStatus;
    });

    if (loading || authLoading) return <div className="p-8">Cargando productos...</div>;

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold mb-2">Productos</h1>
                    <p className="text-muted-foreground">Gestiona el catálogo de dispensas.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => router.push('/admin/products/audit')}
                        className="bg-secondary text-secondary-foreground border border-border px-4 py-2 rounded-lg flex items-center gap-2 font-medium hover:bg-muted transition-colors"
                    >
                        <History size={18} />
                        Auditar Stock
                    </button>
                    <button
                        onClick={() => router.push('/admin/products/new')}
                        className="bg-primary text-primary-foreground px-4 py-2 rounded-lg flex items-center gap-2 font-medium hover:bg-primary/90 transition-colors"
                    >
                        <Plus size={18} />
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
                        className="pl-10 p-2 border border-input rounded-md w-full bg-background text-foreground"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <select
                    className="p-2 border border-input rounded-md min-w-[150px] bg-background text-foreground"
                    value={filterStatus}
                    onChange={(e: any) => setFilterStatus(e.target.value)}
                >
                    <option value="all">Todos</option>
                    <option value="active">Activos</option>
                    <option value="inactive">Inactivos</option>
                </select>
            </div>

            <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b bg-muted/50">
                                <th className="p-4 font-medium text-sm">Imagen</th>
                                <th className="p-4 font-medium text-sm">Nombre</th>
                                <th className="p-4 font-medium text-sm">Categoría</th>
                                <th className="p-4 font-medium text-sm">Stock</th>
                                <th className="p-4 font-medium text-sm">Estado</th>
                                <th className="p-4 font-medium text-sm text-right">Acciones</th>
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
                                            <div className="font-medium">{product.nombre}</div>
                                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">{product.descripcion}</div>
                                        </td>
                                        <td className="p-4 text-sm">{product.categoria}</td>
                                        <td className="p-4 text-sm font-medium">
                                            <div className="flex flex-col gap-0.5">
                                                <span className="text-foreground">
                                                    Físico: <strong className="text-foreground font-semibold">{product.stockReal ?? product.stockDisponible}</strong> u.
                                                </span>
                                                {product.stockReservado !== undefined && product.stockReservado > 0 ? (
                                                    <span className="text-xs text-amber-600 dark:text-amber-400">
                                                        Reservado: {product.stockReservado} u.
                                                    </span>
                                                ) : null}
                                                <span className={`text-xs ${product.stockDisponible > 0 ? "text-green-600 dark:text-green-400" : "text-red-500 font-medium"}`}>
                                                    Disponible: {product.stockDisponible} u.
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
        </div>
    );
}
