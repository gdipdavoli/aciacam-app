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
    const [showModal, setShowModal] = useState(false);

    const handleAdd = () => {
        addItem(product, 1);
        setAdded(true);
        setTimeout(() => setAdded(false), 2000);
    };

    const isLowStock = product.stockDisponible < 10 && product.stockDisponible > 0;
    const isOutOfStock = product.stockDisponible <= 0;

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

                <div className="text-sm text-muted-foreground mb-4 flex-1">
                    {product.descripcion && product.descripcion.length > 120 ? (
                        <>
                            {product.descripcion.substring(0, 120)}...
                            <button
                                onClick={() => setShowModal(true)}
                                className="text-xs text-primary font-semibold hover:underline ml-1 focus:outline-none"
                            >
                                Ver más
                            </button>
                        </>
                    ) : (
                        product.descripcion
                    )}
                </div>

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

            {showModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-card w-full max-w-md rounded-2xl shadow-2xl border border-border p-6 relative animate-in fade-in zoom-in-95 duration-200">
                        <button
                            onClick={() => setShowModal(false)}
                            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground p-1 hover:bg-muted rounded-full transition-colors"
                            aria-label="Cerrar"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-md bg-primary/10 text-primary uppercase tracking-wider">
                                {product.categoria}
                            </span>
                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground uppercase tracking-wider">
                                {product.tipo}
                            </span>
                        </div>
                        <h3 className="text-xl font-bold mb-3">{product.nombre}</h3>
                        <div className="max-h-[60vh] overflow-y-auto pr-1 text-sm text-foreground/80 leading-relaxed mb-6 whitespace-pre-line">
                            {product.descripcion}
                        </div>
                        <div className="flex justify-end pt-2">
                            <button
                                onClick={() => setShowModal(false)}
                                className="bg-primary text-primary-foreground hover:bg-primary/90 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-md"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
