"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { StoreService } from '@/services/storeService';
import { Upload, X, Save } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function NewProductPage() {
    const router = useRouter();
    const { user, loading: authLoading } = useAuth();
    const [loading, setLoading] = useState(false);

    if (!authLoading && user && user.rol !== 'admin' && user.rol !== 'staff') {
        router.push('/');
        return null;
    }
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    // Form State
    const [formData, setFormData] = useState({
        nombre: '',
        tipo: 'gotero',
        descripcion: '',
        categoria: '',
        stockDisponible: 0,
        activo: true,
        imagen: ''
    });

    // Load draft on mount
    React.useEffect(() => {
        const saved = localStorage.getItem('new_product_draft');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setFormData(prev => ({ ...prev, ...parsed }));
            } catch (e) {
                console.error("Failed to parse product draft", e);
            }
        }
    }, []);

    // Save draft on change
    React.useEffect(() => {
        const timeout = setTimeout(() => {
            localStorage.setItem('new_product_draft', JSON.stringify(formData));
        }, 500);
        return () => clearTimeout(timeout);
    }, [formData]);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setImageFile(file);
            setPreviewUrl(URL.createObjectURL(file));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setLoading(true);

        try {
            const product = await StoreService.addProduct({
                ...formData,
                tipo: formData.tipo as any,
                stockDisponible: Number(formData.stockDisponible)
            }, user.id);

            if (imageFile) {
                const uploadData = new FormData();
                uploadData.append('file', imageFile);
                uploadData.append('productId', product.id);

                const res = await fetch('/api/products/upload-image', {
                    method: 'POST',
                    body: uploadData
                });

                if (!res.ok) {
                    const err = await res.json();
                    alert(`Error subiendo imagen: ${err.error}`);
                } else {
                    const { path } = await res.json();
                    // Update product with image path
                    await StoreService.updateProduct(product.id, { imagen: path }, user.id);
                }
            }

            localStorage.removeItem('new_product_draft');
            router.push('/admin/products');
            router.refresh();

        } catch (error: any) {
            console.error(error);
            alert(`Error al crear producto: ${error.message || JSON.stringify(error)}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold">Nuevo Producto</h1>
                <button
                    onClick={() => router.back()}
                    className="p-2 hover:bg-muted rounded-full"
                >
                    <X size={24} />
                </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6 bg-card p-6 rounded-lg border shadow-sm">

                {/* Image Upload */}
                <div className="flex flex-col items-center gap-4 p-4 border-2 border-dashed rounded-lg bg-muted/30">
                    {previewUrl ? (
                        <div className="relative group">
                            <img src={previewUrl} alt="Preview" className="h-40 w-40 object-cover rounded-md shadow-sm" />
                            <button
                                type="button"
                                onClick={() => { setImageFile(null); setPreviewUrl(null); }}
                                className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-md hover:bg-red-600"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ) : (
                        <div className="text-center">
                            <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
                            <div className="mt-2 flex text-sm text-muted-foreground justify-center">
                                <label className="relative cursor-pointer rounded-md bg-background font-medium text-primary hover:text-primary/90">
                                    <span>Subir una imagen</span>
                                    <input type="file" className="sr-only" accept="image/*" onChange={handleImageChange} />
                                </label>
                            </div>
                            <p className="text-xs text-muted-foreground">PNG, JPG, WEBP hasta 5MB</p>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <label className="block text-sm font-medium mb-1">Nombre</label>
                        <input
                            type="text"
                            required
                            className="w-full p-2 border rounded-md bg-background text-foreground"
                            value={formData.nombre}
                            onChange={e => setFormData({ ...formData, nombre: e.target.value })}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Tipo</label>
                        <select
                            className="w-full p-2 border rounded-md bg-background text-foreground"
                            value={formData.tipo}
                            onChange={e => setFormData({ ...formData, tipo: e.target.value as any })}
                        >
                            <option value="gotero">Gotero</option>
                            <option value="flor">Flor</option>
                            <option value="crema">Crema</option>
                            <option value="otro">Otro</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Categoría</label>
                        <input
                            type="text"
                            className="w-full p-2 border rounded-md bg-background text-foreground"
                            placeholder="Ej. Sativa, CBD..."
                            value={formData.categoria}
                            onChange={e => setFormData({ ...formData, categoria: e.target.value })}
                        />
                    </div>

                    <div className="col-span-2">
                        <label className="block text-sm font-medium mb-1">Descripción</label>
                        <textarea
                            className="w-full p-2 border rounded-md bg-background text-foreground"
                            rows={3}
                            value={formData.descripcion}
                            onChange={e => setFormData({ ...formData, descripcion: e.target.value })}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Stock Disponible</label>
                        <input
                            type="number"
                            required
                            min="0"
                            className="w-full p-2 border rounded-md bg-background text-foreground"
                            value={formData.stockDisponible.toString()}
                            onChange={e => {
                                const val = e.target.value;
                                setFormData({
                                    ...formData,
                                    stockDisponible: val === '' ? '' : Number(val)
                                } as any)
                            }}
                        />
                    </div>

                    <div className="flex items-center gap-3 pt-6">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                className="w-5 h-5 rounded border-input text-primary focus:ring-primary"
                                checked={formData.activo}
                                onChange={e => setFormData({ ...formData, activo: e.target.checked })}
                            />
                            <span className="text-sm font-medium">Producto Activo</span>
                        </label>
                    </div>
                </div>

                <div className="flex gap-3 pt-4 border-t">
                    <button
                        type="button"
                        onClick={() => router.back()}
                        className="flex-1 py-2 px-4 border rounded-md hover:bg-muted font-medium"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        disabled={loading}
                        className="flex-1 py-2 px-4 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium flex justify-center items-center gap-2"
                    >
                        {loading ? 'Guardando...' : <><Save size={18} /> Guardar Producto</>}
                    </button>
                </div>

            </form>
        </div>
    );
}
