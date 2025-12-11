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
        <div>
            <div style={{ marginBottom: '2rem' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Variedades Disponibles</h1>
                <p style={{ color: 'hsl(var(--muted-foreground))' }}>
                    Explora nuestro catálogo y agregá productos a tu pedido.
                </p>
            </div>

            {/* Filters */}
            <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '1rem',
                marginBottom: '2rem',
                alignItems: 'center'
            }}>
                <div style={{
                    position: 'relative',
                    flex: 1,
                    minWidth: '250px',
                    maxWidth: '400px'
                }}>
                    <Search size={18} style={{
                        position: 'absolute',
                        left: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'hsl(var(--muted-foreground))'
                    }} />
                    <input
                        type="text"
                        placeholder="Buscar..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '0.75rem 0.75rem 0.75rem 2.5rem',
                            borderRadius: 'var(--radius)',
                            border: '1px solid hsl(var(--input))',
                            backgroundColor: 'hsl(var(--background))',
                            fontSize: '0.95rem'
                        }}
                    />
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
                    {types.map(type => (
                        <button
                            key={type}
                            onClick={() => setSelectedType(type)}
                            style={{
                                padding: '0.5rem 1rem',
                                borderRadius: '999px',
                                border: '1px solid hsl(var(--border))',
                                backgroundColor: selectedType === type ? 'hsl(var(--primary))' : 'transparent',
                                color: selectedType === type ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
                                cursor: 'pointer',
                                textTransform: 'capitalize',
                                fontSize: '0.9rem',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {type}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <p>Cargando catálogo...</p>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '1.5rem'
                }}>
                    {filteredProducts.map(p => (
                        <ProductCard key={p.id} product={p} />
                    ))}
                </div>
            )}

            {!loading && filteredProducts.length === 0 && (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'hsl(var(--muted-foreground))' }}>
                    No se encontraron productos.
                </div>
            )}
        </div>
    );
}
