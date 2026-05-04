"use client";

import React, { useState } from 'react';
import { Producto } from '@/types';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { Plus, ImageIcon } from 'lucide-react';


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
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
            <div className="h-48 bg-muted relative">
                {product.imagen ? (
                    <img
                        src={product.imagen}
                        alt={product.nombre}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-gray-100">
                        <div className="flex flex-col items-center gap-2">
                            <ImageIcon size={32} className="opacity-20" />
                            <span className="text-xs uppercase font-medium tracking-wider opacity-40">{product.tipo}</span>
                        </div>
                    </div>
                )}

                {/* Badge Overlay */}
                <div className="absolute top-3 left-3">
                    <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm text-white border border-white/10 uppercase tracking-wide shadow-sm">
                        {product.categoria}
                    </span>
                </div>
            </div>

            <div className="p-4 flex flex-col flex-1">
                <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-bold leading-tight line-clamp-2">{product.nombre}</h3>
                </div>

                <p className="text-sm text-muted-foreground mb-4 line-clamp-3 flex-1">
                    {product.descripcion}
                </p>

                <div className="flex justify-between items-center mt-auto pt-4 border-t border-dashed">
                    <div className="text-xs font-medium">
                        {(user?.rol === 'admin' || user?.rol === 'staff') ? (
                            // Admin/Staff View: Show Exact Stock
                            <span className={product.stockDisponible > 0 ? "text-blue-600" : "text-destructive"}>
                                Stock: {product.stockDisponible}
                            </span>
                        ) : (
                            // Socio View: Generic Status
                            isOutOfStock ? (
                                <span className="text-destructive">Sin stock</span>
                            ) : (
                                <span className="text-green-600">Disponible</span>
                            )
                        )}
                    </div>

                    {user?.rol !== 'admin' && user?.rol !== 'staff' && (
                        <button
                            onClick={handleAdd}
                            disabled={!product.activo || isOutOfStock || user?.bloqueado}
                            className={`
                                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                                ${added
                                    ? 'bg-green-600 text-white hover:bg-green-700'
                                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                                }
                                ${(!product.activo || isOutOfStock || user?.bloqueado) ? 'opacity-50 cursor-not-allowed grayscale' : ''}
                            `}
                        >
                            {added ? (
                                <span>Agregado</span>
                            ) : (
                                <>
                                    <Plus size={16} />
                                    <span>Solicitar</span>
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
