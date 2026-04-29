"use client";

import React, { useEffect, useState } from 'react';
import { StoreService } from '@/services/storeService';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Save, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function ConfiguracionPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [configs, setConfigs] = useState<Record<string, any>>({
        aporte_por_gramo: 2500,
        limite_gramos_max: 40,
        limite_gramos_min: 10
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        if (!authLoading) {
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                router.push('/');
                return;
            }

            fetchConfigs();
        }
    }, [user, authLoading, router]);

    const fetchConfigs = async () => {
        setLoading(true);
        try {
            const data = await StoreService.getGlobalConfigs();
            if (Object.keys(data).length > 0) {
                setConfigs(prev => ({ ...prev, ...data }));
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage(null);

        try {
            // Save each config
            await Promise.all(
                Object.entries(configs).map(([key, value]) => 
                    StoreService.updateGlobalConfig(key, value)
                )
            );
            setMessage({ type: 'success', text: 'Configuración guardada correctamente.' });
        } catch (e) {
            console.error(e);
            setMessage({ type: 'error', text: 'Error al guardar la configuración.' });
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (key: string, value: string) => {
        setConfigs(prev => ({ ...prev, [key]: Number(value) }));
    };

    if (loading || authLoading) return <div className="p-8 text-center">Cargando configuración...</div>;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight mb-2">Configuración del Sistema</h1>
                <p className="text-muted-foreground">
                    Ajusta los parámetros globales del servicio de provisión.
                </p>
            </div>

            <form onSubmit={handleSave} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Aporte por Gramo */}
                    <div className="bg-card p-6 rounded-xl border border-border shadow-sm space-y-4">
                        <div className="flex items-center gap-3 text-primary">
                            <div className="p-2 bg-primary/10 rounded-lg">
                                <RefreshCw size={20} />
                            </div>
                            <h3 className="font-bold text-lg">Aporte Económico</h3>
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium mb-2">Valor de aporte por gramo ($)</label>
                            <input
                                type="number"
                                value={configs.aporte_por_gramo}
                                onChange={(e) => handleChange('aporte_por_gramo', e.target.value)}
                                className="w-full p-3 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                                min="0"
                            />
                            <p className="mt-2 text-xs text-muted-foreground">
                                Este valor se utiliza para calcular el "Aporte estimado" en la solicitud mensual del socio.
                            </p>
                        </div>
                    </div>

                    {/* Límites de Provisión */}
                    <div className="bg-card p-6 rounded-xl border border-border shadow-sm space-y-4">
                        <div className="flex items-center gap-3 text-primary">
                            <div className="p-2 bg-primary/10 rounded-lg">
                                <AlertCircle size={20} />
                            </div>
                            <h3 className="font-bold text-lg">Límites de Provisión</h3>
                        </div>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Mínimo mensual (gramos)</label>
                                <input
                                    type="number"
                                    value={configs.limite_gramos_min}
                                    onChange={(e) => handleChange('limite_gramos_min', e.target.value)}
                                    className="w-full p-3 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                                    min="0"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2">Máximo mensual (gramos)</label>
                                <input
                                    type="number"
                                    value={configs.limite_gramos_max}
                                    onChange={(e) => handleChange('limite_gramos_max', e.target.value)}
                                    className="w-full p-3 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                                    min="1"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {message && (
                    <div className={`p-4 rounded-lg flex items-center gap-3 border ${
                        message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
                    }`}>
                        {message.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                        <p className="text-sm font-medium">{message.text}</p>
                    </div>
                )}

                <div className="flex justify-end pt-4">
                    <button
                        type="submit"
                        disabled={saving}
                        className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-bold hover:opacity-90 disabled:opacity-50 transition-all shadow-md active:scale-95"
                    >
                        {saving ? (
                            <>
                                <RefreshCw className="animate-spin" size={20} />
                                Guardando...
                            </>
                        ) : (
                            <>
                                <Save size={20} />
                                Guardar Configuración
                            </>
                        )}
                    </button>
                </div>
            </form>

            <div className="p-6 bg-muted/30 rounded-xl border border-dashed border-border">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <AlertCircle size={16} className="text-amber-600" />
                    Importante
                </h4>
                <p className="text-sm text-muted-foreground">
                    Los cambios realizados aquí impactarán inmediatamente en la interfaz de los socios al momento de realizar sus solicitudes mensuales. Asegúrate de que los valores coincidan con los costos operativos actuales de la asociación.
                </p>
            </div>
        </div>
    );
}
