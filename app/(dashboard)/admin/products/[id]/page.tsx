"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'; // Correct import for App Router
import { StoreService } from '@/services/storeService';
import { Producto } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { Upload, X, Save, Trash2 } from 'lucide-react';

// For Next.js 15, params are a Promise, but for clientside commonly we use use(params) or just props in previous versions.
// However, since this is "use client", we receive params via props. 
// Standard in Page.tsx: ({ params }: { params: { id: string } })
// BUT in Next 15 it might be await params. Let's use React.use() if needed or just async props wrapper? 
// Simplest: use `useParams` hook or standard props. 
// Warning: `params` prop in Client Components is not recommended in recent Next.js checks, but typically still passed.
// Safe bet: Helper wrapper or use router params? No, `useParams` hook.

import { useParams } from 'next/navigation';

export default function EditProductPage() {
    const router = useRouter();
    const params = useParams();
    const id = params?.id as string;
    const { user, loading: authLoading } = useAuth();

    const [loading, setLoading] = useState(true);

    if (!authLoading && user && user.rol !== 'admin' && user.rol !== 'staff') {
        router.push('/');
        return null; // or render Access Denied
    }
    const [saving, setSaving] = useState(false);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const [formData, setFormData] = useState<Producto | null>(null);

    useEffect(() => {
        if (id) {
            StoreService.getProductById(id)
                .then(p => {
                    if (p) {
                        setFormData(p);
                        if (p.imagen) setPreviewUrl(p.imagen);
                    } else {
                        alert("Producto no encontrado");
                        router.push('/admin/products');
                    }
                })
                .finally(() => setLoading(false));
        }
    }, [id, router]);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            
            // Limit to 4.5MB (Vercel standard serverless body limit)
            if (file.size > 4.5 * 1024 * 1024) {
                alert("La imagen es muy pesada. Por favor usá una de menos de 4.5MB.");
                e.target.value = ''; // Reset input
                return;
            }

            setImageFile(file);
            setPreviewUrl(URL.createObjectURL(file));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData) return;
        setSaving(true);

        try {
            let imagePath = formData.imagen;

            if (imageFile) {
                const uploadData = new FormData();
                uploadData.append('file', imageFile);
                uploadData.append('productId', formData.id);

                const res = await fetch('/api/products/upload-image', {
                    method: 'POST',
                    body: uploadData
                });

                if (!res.ok) {
                    let errorMsg = `Error ${res.status}`;
                    try {
                        const contentType = res.headers.get("content-type");
                        if (contentType && contentType.includes("application/json")) {
                            const err = await res.json();
                            errorMsg = err.error || errorMsg;
                        } else {
                            if (res.status === 413) errorMsg = "La imagen es demasiado grande. Intentá con una más pequeña.";
                        }
                    } catch (e) { /* ignore */ }
                    
                    alert(`Error subiendo imagen: ${errorMsg}`);
                    setSaving(false);
                    return;
                } else {
                    const { path } = await res.json();
                    imagePath = path;
                }
            }

            await StoreService.updateProduct(formData.id, {
                nombre: formData.nombre,
                tipo: formData.tipo,
                descripcion: formData.descripcion,
                categoria: formData.categoria,
                stockDisponible: Number(formData.stockDisponible),
                activo: formData.activo,
                imagen: imagePath,
                peso_gramos: Number(formData.peso_gramos)
            }, user!.id);

            router.push('/admin/products');
            router.refresh();

        } catch (error) {
            console.error(error);
            alert('Error al actualizar producto');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div>Cargando...</div>;
    if (!formData) return <div>No encontrado</div>;

    return (
        <div className="max-w-2xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold">Editar Producto</h1>
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
                                onClick={() => { setImageFile(null); setPreviewUrl(null); setFormData(p => ({ ...p!, imagen: '' })); }}
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

                    <div>
                        <label className="block text-sm font-medium mb-1">Peso por unidad (gramos)</label>
                        <input
                            type="number"
                            required
                            min="1"
                            className="w-full p-2 border rounded-md bg-background text-foreground"
                            value={formData.peso_gramos.toString()}
                            onChange={e => {
                                const val = e.target.value;
                                setFormData({
                                    ...formData,
                                    peso_gramos: val === '' ? '' : Number(val)
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
                        disabled={saving}
                        className="flex-1 py-2 px-4 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium flex justify-center items-center gap-2"
                    >
                        {saving ? 'Guardando...' : <><Save size={18} /> Actualizar Producto</>}
                    </button>
                </div>
            </form>
        </div>
    );
}
