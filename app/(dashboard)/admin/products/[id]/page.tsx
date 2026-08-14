"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation'; // Correct import for App Router
import { StoreService } from '@/services/storeService';
import { Producto } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { Upload, X, Save } from 'lucide-react';

export default function EditProductPage() {
    const router = useRouter();
    const params = useParams();
    const id = params?.id as string;
    const { user, loading: authLoading } = useAuth();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const [formData, setFormData] = useState<Producto | null>(null);
    const [originalStock, setOriginalStock] = useState<number | null>(null);
    const [auditNote, setAuditNote] = useState('');
    const [adjustmentType, setAdjustmentType] = useState<'none' | 'add' | 'subtract'>('none');
    const [adjustmentQty, setAdjustmentQty] = useState<number>(0);

    if (!authLoading && user && user.rol !== 'admin' && user.rol !== 'staff') {
        router.push('/');
        return null;
    }

    useEffect(() => {
        if (id) {
            StoreService.getProductos(true)
                .then(products => {
                    const p = products.find(prod => prod.id === id);
                    if (p) {
                        setFormData(p);
                        setOriginalStock(p.stockReal ?? p.stockDisponible);
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

            const updates: any = {
                nombre: formData.nombre,
                tipo: formData.tipo,
                descripcion: formData.descripcion,
                categoria: formData.categoria,
                activo: formData.activo,
                imagen: imagePath,
                peso_gramos: Number(formData.peso_gramos)
            };

            if (adjustmentType !== 'none' && adjustmentQty > 0) {
                const finalStock = adjustmentType === 'add' 
                    ? (originalStock ?? 0) + adjustmentQty 
                    : Math.max(0, (originalStock ?? 0) - adjustmentQty);

                if (finalStock < 0) {
                    alert("No podés reducir el stock por debajo de cero.");
                    setSaving(false);
                    return;
                }

                // Calculate new available stock (physical stock - reserved stock)
                const newAvailable = Math.max(0, finalStock - (formData.stockReservado ?? 0));
                updates.stockDisponible = newAvailable;
                updates.last_audit_note = auditNote;
            }

            await StoreService.updateProduct(formData.id, updates, user!.id);

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

                    {/* Sección de stock actual e info */}
                    <div className="col-span-2 bg-muted/40 p-4 rounded-lg border border-border">
                        <h3 className="text-sm font-semibold mb-2">Información de Stock Actual</h3>
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div className="bg-background p-2 rounded border">
                                <div className="text-xs text-muted-foreground">Físico (Depósito)</div>
                                <div className="text-lg font-bold text-foreground">{originalStock ?? 0} u.</div>
                            </div>
                            <div className="bg-background p-2 rounded border">
                                <div className="text-xs text-muted-foreground">Reservado (Pedidos)</div>
                                <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{formData.stockReservado ?? 0} u.</div>
                            </div>
                            <div className="bg-background p-2 rounded border">
                                <div className="text-xs text-muted-foreground">Disponible</div>
                                <div className="text-lg font-bold text-green-600 dark:text-green-400">
                                    {Math.max(0, (originalStock ?? 0) - (formData.stockReservado ?? 0))} u.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Controles de Ajuste de Stock */}
                    <div className="col-span-2 border-t pt-4 mt-2">
                        <label className="block text-sm font-semibold mb-2">Ajustar Inventario Físico</label>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-muted-foreground mb-1">Acción</label>
                                <select
                                    className="w-full p-2 border rounded-md bg-background text-foreground text-sm"
                                    value={adjustmentType}
                                    onChange={e => {
                                        const type = e.target.value as any;
                                        setAdjustmentType(type);
                                        if (type === 'none') {
                                            setAdjustmentQty(0);
                                            setAuditNote('');
                                        }
                                    }}
                                >
                                    <option value="none">Sin cambios en el stock</option>
                                    <option value="add">Aumentar Stock (+)</option>
                                    <option value="subtract">Disminuir Stock (-)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs text-muted-foreground mb-1">Cantidad</label>
                                <input
                                    type="number"
                                    min="0"
                                    disabled={adjustmentType === 'none'}
                                    className="w-full p-2 border rounded-md bg-background text-foreground text-sm disabled:opacity-50"
                                    placeholder="Ej. 5"
                                    value={adjustmentQty === 0 ? '' : adjustmentQty}
                                    onChange={e => {
                                        const val = e.target.value;
                                        setAdjustmentQty(val === '' ? 0 : Math.max(0, parseInt(val, 10)));
                                    }}
                                />
                            </div>
                        </div>

                        {adjustmentType !== 'none' && adjustmentQty > 0 && (
                            <div className="mt-4 space-y-4">
                                {/* Vista previa del stock final */}
                                <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded border border-blue-200 dark:border-blue-900/50 text-sm flex justify-between items-center">
                                    <span className="text-blue-800 dark:text-blue-300 font-medium">Stock Físico Resultante:</span>
                                    <span className="text-blue-900 dark:text-blue-200 font-bold text-base">
                                        {adjustmentType === 'add' 
                                            ? (originalStock ?? 0) + adjustmentQty 
                                            : Math.max(0, (originalStock ?? 0) - adjustmentQty)} u.
                                    </span>
                                </div>

                                {/* Observación obligatoria */}
                                <div className="bg-amber-50 dark:bg-amber-950/20 p-4 rounded-lg border border-amber-200 dark:border-amber-900/50">
                                    <label className="block text-sm font-semibold mb-1 text-amber-800 dark:text-amber-300">
                                        Observación del ajuste de stock (Requerido)
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="Ej: ingreso de lote, corrección de inventario"
                                        className="w-full p-2 border border-amber-300 dark:border-amber-800 rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                                        value={auditNote}
                                        onChange={e => setAuditNote(e.target.value)}
                                    />
                                </div>
                            </div>
                        )}
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

                    <div className="flex items-center gap-3 pt-6 col-span-2">
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
