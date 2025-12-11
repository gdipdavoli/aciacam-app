"use client";

import React, { useState } from 'react';
import { Producto } from '@/types';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { Plus } from 'lucide-react';


interface ProductCardProps {
    product: Producto;
}

export default function ProductCard({ product }: ProductCardProps) {
    const { addItem } = useCart();
    const { user } = useAuth();
    const [added, setAdded] = useState(false);


    const handleAdd = () => {
        addItem(product, 1);
        setAdded(true);
        setTimeout(() => setAdded(false), 2000);
    };

    const isLowStock = product.stockDisponible < 10 && product.stockDisponible > 0;
    const isOutOfStock = product.stockDisponible === 0;

    return (
        <div style={{
            backgroundColor: 'hsl(var(--card))',
            borderRadius: 'var(--radius)',
            border: '1px solid hsl(var(--border))',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            transition: 'transform 0.2s',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
        }}>
            <div style={{
                height: '140px',
                backgroundColor: 'hsl(var(--muted))', // Placeholder for image
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'hsl(var(--muted-foreground))',
                fontSize: '0.8rem'
            }}>
                {product.tipo.toUpperCase()}
            </div>

            <div style={{ padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{product.nombre}</h3>
                    <span style={{
                        fontSize: '0.7rem',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '999px',
                        backgroundColor: 'hsl(var(--accent))',
                        color: 'hsl(var(--accent-foreground))'
                    }}>
                        {product.categoria}
                    </span>
                </div>

                <p style={{ fontSize: '0.9rem', color: 'hsl(var(--muted-foreground))', marginBottom: '1rem', flex: 1 }}>
                    {product.descripcion}
                </p>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                    <div style={{ fontSize: '0.8rem' }}>
                        {isOutOfStock ? (
                            <span style={{ color: 'hsl(var(--destructive))', fontWeight: 500 }}>Sin stock</span>
                        ) : isLowStock ? (
                            <span style={{ color: 'orange', fontWeight: 500 }}>Últimas unidades</span>
                        ) : (
                            <span style={{ color: 'hsl(var(--primary))', fontWeight: 500 }}>Disponible</span>
                        )}
                    </div>

                    {user?.rol !== 'admin' && (
                        <button
                            onClick={handleAdd}
                            disabled={!product.activo || isOutOfStock}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                backgroundColor: 'hsl(var(--primary))',
                                filter: added ? 'brightness(0.9)' : 'none',
                                color: 'hsl(var(--primary-foreground))',
                                border: 'none',
                                padding: '0.5rem 1rem',
                                borderRadius: 'var(--radius)',
                                fontSize: '0.9rem',
                                fontWeight: 500,
                                cursor: isOutOfStock ? 'not-allowed' : 'pointer',
                                opacity: isOutOfStock ? 0.5 : 1,
                                transition: 'all 0.2s'
                            }}
                        >
                            {added ? (
                                <>Agregado!</>
                            ) : (
                                <>
                                    <Plus size={16} />
                                    Agregar
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div >
    );
}
