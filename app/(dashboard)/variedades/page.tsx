"use client";

import React, { useEffect, useState } from 'react';
import { StoreService } from '@/services/storeService';
import { Producto } from '@/types';
import ProductCard from '@/app/components/products/ProductCard';
import { Search, Leaf, ShieldAlert } from 'lucide-react';
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
            // Service now fetches only active products by default for public
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
                p.categoria.toLowerCase().includes(lower)
            );
        }

        setFilteredProducts(result);
    }, [searchTerm, selectedType, products]);

    // Unique types for filter
    const types = ['todos', ...Array.from(new Set(products.map(p => p.tipo)))];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight mb-2">Opciones de Tratamiento</h1>
                <p className="text-muted-foreground">
                    Explora nuestras variedades disponibles y seleccioná las opciones para tu solicitud de provisión mensual.
                </p>
            </div>

            {/* Rendering Catalog or Blocked State or Empty State */}
            {loading ? (
                <div className="text-center py-12 text-muted-foreground">Cargando catálogo...</div>
            ) : user?.bloqueado ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 mt-8 rounded-2xl border-2 border-red-200 bg-red-50 text-center">
                    <div className="bg-red-100 text-red-600 p-5 rounded-full mb-5 shadow-sm">
                        <ShieldAlert size={40} strokeWidth={1.5} />
                    </div>
                    <h2 className="text-2xl font-bold mb-2 text-red-900">Acceso Restringido</h2>
                    <p className="text-red-800/80 max-w-md text-lg mb-4">
                        Tu cuenta se encuentra bloqueada temporalmente por administración.
                    </p>
                    {user.motivo_bloqueo && (
                        <div className="bg-white/50 border border-red-200 p-4 rounded-xl max-w-lg">
                            <p className="text-xs uppercase font-black text-red-900/40 mb-1 tracking-widest">Motivo de la restricción</p>
                            <p className="text-red-700 font-medium">{user.motivo_bloqueo}</p>
                        </div>
                    )}
                    <p className="mt-8 text-sm text-red-900/60">
                        Por favor, contacta con el equipo de administración para regularizar tu situación.
                    </p>
                </div>
            ) : products.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 mt-8 rounded-2xl border-2 border-dashed border-green-200 bg-green-50">
                    <div className="bg-green-100 text-green-700 p-5 rounded-full mb-5 shadow-sm">
                        <Leaf size={40} strokeWidth={1.5} />
                    </div>
                    <h2 className="text-2xl font-bold mb-2 text-green-900">¡Estamos prontos a cosechar!</h2>
                    <p className="text-green-800/80 max-w-md text-center text-lg">
                        En este momento no hay variedades activas en el catálogo. Preparando la próxima temporada para ti 🌱.
                    </p>
                </div>
            ) : (
                <>
                    {/* Filters */}
                    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center mt-6">
                        <div className="relative w-full max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 rounded-lg border bg-background focus:ring-2 focus:ring-primary focus:outline-none"
                            />
                        </div>

                        <div className="flex gap-2 overflow-x-auto pb-2 w-full sm:w-auto">
                            {types.map(type => (
                                <button
                                    key={type}
                                    onClick={() => setSelectedType(type)}
                                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors capitalize whitespace-nowrap ${selectedType === type
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                                        }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mt-6">
                        {filteredProducts.map(p => (
                            <ProductCard key={p.id} product={p} />
                        ))}
                    </div>

                    {filteredProducts.length === 0 && (
                        <div className="text-center py-12 text-muted-foreground">
                            No se encontraron productos para tu búsqueda.
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
