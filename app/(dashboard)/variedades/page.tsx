"use client";

import React, { useEffect, useState } from 'react';
import { StoreService } from '@/services/storeService';
import { Producto } from '@/types';
import ProductCard from '@/app/components/products/ProductCard';
import { Search } from 'lucide-react';

export default function VariedadesPage() {
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
                <h1 className="text-3xl font-bold tracking-tight mb-2">Variedades Disponibles</h1>
                <p className="text-muted-foreground">
                    Explora nuestro catálogo y agregá productos a tu pedido.
                </p>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
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

            {loading ? (
                <div className="text-center py-12 text-muted-foreground">Cargando catálogo...</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredProducts.map(p => (
                        <ProductCard key={p.id} product={p} />
                    ))}
                </div>
            )}

            {!loading && filteredProducts.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                    No se encontraron productos.
                </div>
            )}
        </div>
    );
}
