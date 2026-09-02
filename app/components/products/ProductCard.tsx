"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { Producto } from '@/types';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { Plus, Minus, ImageIcon, Info, Check } from 'lucide-react';

interface ProductCardProps {
    product: Producto;
}

export default function ProductCard({ product }: ProductCardProps) {
    const { items, addItem, updateQuantity } = useCart();
    const { user } = useAuth();
    const [added, setAdded] = useState(false);
    const [showModal, setShowModal] = useState(false);

    const cartItem = items.find((i) => i.productoId === product.id);
    const currentQty = cartItem ? cartItem.cantidad : 0;

    const handleAdd = () => {
        addItem(product, 1);
        setAdded(true);
        setTimeout(() => setAdded(false), 1500);
    };

    const handleIncrement = () => {
        if (currentQty < product.stockDisponible) {
            updateQuantity(product.id, currentQty + 1);
        }
    };

    const handleDecrement = () => {
        if (currentQty > 0) {
            updateQuantity(product.id, currentQty - 1);
        }
    };

    const isOutOfStock = product.stockDisponible <= 0;
    const isStaffOrAdmin = user?.rol === 'admin' || user?.rol === 'staff';

    // Format type label
    const formattedType = product.tipo
        ? product.tipo.charAt(0).toUpperCase() + product.tipo.slice(1)
        : '';

    return (
        <div className="bg-card border border-border/80 rounded-2xl p-3 md:p-4 shadow-xs hover:shadow-md transition-all duration-200 flex flex-row md:flex-col items-center md:items-stretch gap-3 md:gap-3 group">
            {/* Image Container: Left square on Mobile (w-20/w-24), Top banner on Desktop (md:w-full md:h-36) */}
            <div className="relative w-20 h-20 xs:w-24 xs:h-24 md:w-full md:h-36 shrink-0 rounded-xl overflow-hidden bg-muted flex items-center justify-center">
                {product.imagen ? (
                    <Image
                        src={product.imagen}
                        alt={product.nombre}
                        fill
                        sizes="(max-width: 768px) 96px, (max-width: 1200px) 33vw, 25vw"
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground bg-secondary/50 p-2">
                        <ImageIcon size={24} className="opacity-30 mb-1" />
                        <span className="text-[10px] uppercase font-bold tracking-wider opacity-40 text-center line-clamp-1">
                            {product.tipo}
                        </span>
                    </div>
                )}

                {/* Badge Overlay for desktop category */}
                {product.categoria && (
                    <div className="absolute top-2 left-2 hidden md:flex items-center gap-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-white border border-white/10 uppercase tracking-wider shadow-xs">
                            {product.categoria}
                        </span>
                    </div>
                )}
            </div>

            {/* Content Center */}
            <div className="flex-1 min-w-0 flex flex-col justify-between h-full md:h-auto gap-1">
                {/* Title & Info trigger */}
                <div>
                    <div className="flex items-start justify-between gap-1">
                        <h3 className="text-sm sm:text-base font-bold leading-tight text-foreground line-clamp-1 md:line-clamp-2">
                            {product.nombre}
                        </h3>
                        {product.descripcion && (
                            <button
                                onClick={() => setShowModal(true)}
                                title="Ver detalles"
                                className="text-muted-foreground hover:text-primary p-0.5 rounded-md transition-colors shrink-0"
                            >
                                <Info size={16} />
                            </button>
                        )}
                    </div>

                    {/* Key Attributes / Badges row */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="inline-flex items-center text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 capitalize">
                            {formattedType}
                        </span>

                        {product.ratio ? (
                            <span className="inline-flex items-center text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                                Ratio {product.ratio}
                            </span>
                        ) : product.concentracion ? (
                            <span className="inline-flex items-center text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20">
                                {product.concentracion}
                            </span>
                        ) : product.categoria ? (
                            <span className="inline-flex items-center text-[10px] sm:text-xs font-medium px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground">
                                {product.categoria}
                            </span>
                        ) : null}
                    </div>
                </div>

                {/* Bottom / Right Section: Status & Action */}
                <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/40 md:mt-2">
                    {/* Stock indicator (Generic for socios, numeric for admin) */}
                    <div className="flex flex-col">
                        {isStaffOrAdmin ? (
                            <span className={`text-xs font-semibold ${product.stockDisponible > 0 ? "text-blue-600 dark:text-blue-400" : "text-destructive"}`}>
                                Stock: {product.stockDisponible}
                            </span>
                        ) : (
                            <span className={`text-xs font-semibold ${isOutOfStock ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                                {isOutOfStock ? "Sin stock" : "Disponible"}
                            </span>
                        )}
                    </div>

                    {/* Action controls (for Socio / Normal User) */}
                    {!isStaffOrAdmin && (
                        <div className="shrink-0">
                            {currentQty > 0 ? (
                                <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-lg p-0.5">
                                    <button
                                        onClick={handleDecrement}
                                        className="w-7 h-7 rounded-md flex items-center justify-center bg-background text-foreground hover:bg-muted font-bold text-xs shadow-xs transition-colors"
                                        aria-label="Disminuir cantidad"
                                    >
                                        <Minus size={13} />
                                    </button>
                                    <span className="w-5 text-center text-xs font-extrabold text-primary">
                                        {currentQty}
                                    </span>
                                    <button
                                        onClick={handleIncrement}
                                        disabled={currentQty >= product.stockDisponible || user?.bloqueado}
                                        className="w-7 h-7 rounded-md flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-xs shadow-xs transition-colors disabled:opacity-40"
                                        aria-label="Aumentar cantidad"
                                    >
                                        <Plus size={13} />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={handleAdd}
                                    disabled={!product.activo || isOutOfStock || user?.bloqueado}
                                    className={`
                                        flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs active:scale-95
                                        ${added
                                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                            : 'bg-primary text-primary-foreground hover:bg-primary/90'
                                        }
                                        ${(!product.activo || isOutOfStock || user?.bloqueado) ? 'opacity-50 cursor-not-allowed grayscale' : ''}
                                    `}
                                >
                                    {added ? (
                                        <>
                                            <Check size={14} />
                                            <span>Agregado</span>
                                        </>
                                    ) : (
                                        <>
                                            <Plus size={14} />
                                            <span>Solicitar</span>
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Modal for full details */}
            {showModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-card w-full max-w-md rounded-2xl shadow-2xl border border-border p-6 relative animate-in fade-in zoom-in-95 duration-200">
                        <button
                            onClick={() => setShowModal(false)}
                            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground p-1.5 hover:bg-muted rounded-full transition-colors"
                            aria-label="Cerrar"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <div className="flex items-center gap-2 mb-3">
                            {product.categoria && (
                                <span className="text-[10px] font-bold px-2.5 py-1 rounded-md bg-primary/10 text-primary uppercase tracking-wider">
                                    {product.categoria}
                                </span>
                            )}
                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground uppercase tracking-wider capitalize">
                                {product.tipo}
                            </span>
                        </div>
                        <h3 className="text-xl font-bold mb-3">{product.nombre}</h3>
                        <div className="max-h-[60vh] overflow-y-auto pr-1 text-sm text-foreground/80 leading-relaxed mb-6 whitespace-pre-line">
                            {product.descripcion || 'Sin descripción detallada.'}
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t">
                            <div className="text-sm font-semibold">
                                {isStaffOrAdmin ? (
                                    <span className={product.stockDisponible > 0 ? "text-blue-600 dark:text-blue-400" : "text-destructive"}>
                                        Stock: {product.stockDisponible}
                                    </span>
                                ) : (
                                    <span className={isOutOfStock ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}>
                                        {isOutOfStock ? "Sin stock" : "Disponible"}
                                    </span>
                                )}
                            </div>
                            <button
                                onClick={() => setShowModal(false)}
                                className="bg-primary text-primary-foreground hover:bg-primary/90 px-5 py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
