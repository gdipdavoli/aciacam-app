"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Producto, OrderItem } from '@/types';

interface CartItem extends OrderItem {
    producto: Producto;
}

interface CartContextType {
    items: CartItem[];
    addItem: (product: Producto, cantidad: number) => void;
    removeItem: (productId: string) => void;
    updateQuantity: (productId: string, cantidad: number) => void;
    clearCart: () => void;
    itemCount: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
    const [items, setItems] = useState<CartItem[]>([]);

    // Load cart from local storage on mount
    useEffect(() => {
        const savedCart = localStorage.getItem('aciacam_cart');
        if (savedCart) {
            try {
                setItems(JSON.parse(savedCart));
            } catch (e) {
                console.error("Failed to parse cart", e);
            }
        }
    }, []);

    // Save cart to local storage on change
    useEffect(() => {
        localStorage.setItem('aciacam_cart', JSON.stringify(items));
    }, [items]);

    const addItem = (product: Producto, cantidad: number) => {
        setItems((prev) => {
            const existing = prev.find((i) => i.productoId === product.id);
            if (existing) {
                return prev.map((i) =>
                    i.productoId === product.id
                        ? { ...i, cantidad: i.cantidad + cantidad }
                        : i
                );
            }
            return [...prev, { productoId: product.id, productoNombre: product.nombre, cantidad, producto: product }];
        });
    };

    const removeItem = (productId: string) => {
        setItems((prev) => prev.filter((i) => i.productoId !== productId));
    };

    const updateQuantity = (productId: string, cantidad: number) => {
        if (cantidad <= 0) {
            removeItem(productId);
            return;
        }
        setItems((prev) =>
            prev.map((i) => (i.productoId === productId ? { ...i, cantidad } : i))
        );
    };

    const clearCart = () => {
        setItems([]);
    };

    const itemCount = items.reduce((acc, item) => acc + item.cantidad, 0);

    return (
        <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, clearCart, itemCount }}>
            {children}
        </CartContext.Provider>
    );
}

export function useCart() {
    const context = useContext(CartContext);
    if (context === undefined) {
        throw new Error('useCart must be used within a CartProvider');
    }
    return context;
}
