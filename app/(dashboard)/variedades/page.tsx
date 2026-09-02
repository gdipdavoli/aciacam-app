"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { StoreService } from '@/services/storeService';
import { Producto } from '@/types';
import ProductCard from '@/app/components/products/ProductCard';
import { Search, Leaf, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function VariedadesPage() {
    const { user } = useAuth();
    const [products, setProducts] = useState<Producto[]>([]);
    const [filteredProducts, setFilteredProducts] = useState<Producto[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [selectedType, setSelectedType] = useState<string>('todos');

    useEffect(() => {
        async function fetchProducts() {
            // Service fetches active products by default for public
            const data = await StoreService.getProductos();
            setProducts(data);
            setFilteredProducts(data);
            setLoading(false);
        }
        fetchProducts();
    }, []);

    useEffect(() => {
        let result = products;

        // Filter by type
        if (selectedType !== 'todos') {
            result = result.filter(p => p.tipo === selectedType);
        }

        // Filter by search
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            result = result.filter(p =>
                p.nombre.toLowerCase().includes(lower) ||
                (p.categoria && p.categoria.toLowerCase().includes(lower)) ||
                (p.descripcion && p.descripcion.toLowerCase().includes(lower))
            );
        }

        setFilteredProducts(result);
    }, [searchTerm, selectedType, products]);

    // Format display names for categories/types
    const getLabelForType = (type: string) => {
        switch (type.toLowerCase()) {
            case 'todos': return 'Todos';
            case 'flor': return 'Flores';
            case 'gotero': return 'Goteros';
            case 'crema': return 'Cremas';
            case 'otro': return 'Otros';
            default: return type.charAt(0).toUpperCase() + type.slice(1);
        }
    };

    // Calculate item count per type chip
    const typesWithCounts = useMemo(() => {
        const uniqueTypes = Array.from(new Set(products.map(p => p.tipo)));
        const allTypes = ['todos', ...uniqueTypes];

        return allTypes.map(t => {
            const count = t === 'todos'
                ? products.length
                : products.filter(p => p.tipo === t).length;
            return { type: t, label: getLabelForType(t), count };
        });
    }, [products]);

    return (
        <div className="space-y-6 max-w-7xl mx-auto px-1 sm:px-0">
            <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1 text-foreground">Opciones de Tratamiento</h1>
                <p className="text-sm sm:text-base text-muted-foreground">
                    Explora nuestras variedades disponibles y seleccioná las opciones para tu solicitud de provisión mensual.
                </p>
            </div>

            {/* Rendering Catalog or Blocked State or Empty State */}
            {loading ? (
                <div className="text-center py-16 text-muted-foreground font-medium">Cargando catálogo de tratamientos...</div>
            ) : user?.bloqueado ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 mt-6 rounded-2xl border-2 border-red-200 bg-red-50 text-center">
                    <div className="bg-red-100 text-red-600 p-5 rounded-full mb-5 shadow-sm">
                        <ShieldAlert size={40} strokeWidth={1.5} />
                    </div>
                    <h2 className="text-2xl font-bold mb-2 text-red-900">Acceso Restringido</h2>
                    <p className="text-red-800/80 max-w-md text-base sm:text-lg mb-4">
                        Tu cuenta se encuentra bloqueada temporalmente por administración.
                    </p>
                    {user.motivo_bloqueo && (
                        <div className="bg-white/50 border border-red-200 p-4 rounded-xl max-w-lg">
                            <p className="text-xs uppercase font-black text-red-900/40 mb-1 tracking-widest">Motivo de la restricción</p>
                            <p className="text-red-700 font-medium text-sm">{user.motivo_bloqueo}</p>
                        </div>
                    )}
                    <p className="mt-8 text-sm text-red-900/60">
                        Por favor, contacta con el equipo de administración para regularizar tu situación.
                    </p>
                </div>
            ) : products.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 mt-6 rounded-2xl border-2 border-dashed border-green-200 bg-green-50">
                    <div className="bg-green-100 text-green-700 p-5 rounded-full mb-5 shadow-sm">
                        <Leaf size={40} strokeWidth={1.5} />
                    </div>
                    <h2 className="text-2xl font-bold mb-2 text-green-900">¡Estamos prontos a cosechar!</h2>
                    <p className="text-green-800/80 max-w-md text-center text-base sm:text-lg">
                        En este momento no hay variedades activas en el catálogo. Preparando la próxima temporada para ti 🌱.
                    </p>
                </div>
            ) : (
                <>
                    {/* Filters Header: Search & Category Chips */}
                    <div className="space-y-3 mt-4">
                        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
                            {/* Search bar */}
                            <div className="relative flex-1 max-w-md">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                <input
                                    type="text"
                                    placeholder="Buscar por nombre, categoría o tipo..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none text-sm transition-all shadow-xs"
                                />
                            </div>

                            {/* Catalog summary count */}
                            <div className="text-xs font-semibold text-muted-foreground self-end sm:self-center">
                                Mostrando {filteredProducts.length} de {products.length} variedades
                            </div>
                        </div>

                        {/* Category Chips Bar with Horizontal Scroll */}
                        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1.5 border-b border-border/40">
                            <SlidersHorizontal size={16} className="text-muted-foreground shrink-0 mr-1 hidden sm:block" />
                            {typesWithCounts.map(({ type, label, count }) => {
                                const isSelected = selectedType === type;
                                return (
                                    <button
                                        key={type}
                                        onClick={() => setSelectedType(type)}
                                        className={`px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-semibold transition-all duration-150 whitespace-nowrap flex items-center gap-1.5 cursor-pointer shrink-0 active:scale-95 ${
                                            isSelected
                                                ? 'bg-primary text-primary-foreground shadow-xs border border-primary'
                                                : 'bg-secondary/80 text-secondary-foreground hover:bg-secondary border border-transparent'
                                        }`}
                                    >
                                        <span>{label}</span>
                                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                                            isSelected
                                                ? 'bg-primary-foreground/20 text-primary-foreground'
                                                : 'bg-muted text-muted-foreground'
                                        }`}>
                                            {count}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Products Grid: Responsive Compact Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5 mt-4">
                        {filteredProducts.map(p => (
                            <ProductCard key={p.id} product={p} />
                        ))}
                    </div>

                    {/* Empty Search Result */}
                    {filteredProducts.length === 0 && (
                        <div className="text-center py-16 px-4 bg-muted/30 rounded-2xl border border-dashed border-border mt-4">
                            <p className="text-base font-semibold text-foreground mb-1">No se encontraron tratamientos</p>
                            <p className="text-sm text-muted-foreground mb-4">Prueba ajustando los términos de búsqueda o seleccionando otra categoría.</p>
                            <button
                                onClick={() => { setSearchTerm(''); setSelectedType('todos'); }}
                                className="text-xs font-bold text-primary hover:underline"
                            >
                                Limpiar filtros
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
