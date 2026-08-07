"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { StoreService } from '@/services/storeService';
import { Pago, Socio } from '@/types';
import { Coins, Search, ArrowLeft, DollarSign, Calendar, CreditCard } from 'lucide-react';

export default function AdminPagosPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();

    const [pagos, setPagos] = useState<Pago[]>([]);
    const [socios, setSocios] = useState<Socio[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (!authLoading) {
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                router.push('/');
                return;
            }
            fetchData();
        }
    }, [user, authLoading, router]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [allPagos, allSocios] = await Promise.all([
                StoreService.getAllPagos(),
                StoreService.getAllSocios()
            ]);
            setPagos(allPagos);
            setSocios(allSocios);
        } catch (error) {
            console.error("Error fetching payments:", error);
        } finally {
            setLoading(false);
        }
    };

    // Filter payments by search term (socio name, concept, or payment method)
    const filteredPagos = pagos.filter(p => {
        const socio = socios.find(s => s.id === p.socioId);
        const socioName = socio ? `${socio.nombre} ${socio.apellido}`.toLowerCase() : '';
        const searchLower = searchTerm.toLowerCase();

        return (
            socioName.includes(searchLower) ||
            p.concepto.toLowerCase().includes(searchLower) ||
            p.medioDePago.toLowerCase().includes(searchLower)
        );
    });

    // Total cash calculation
    const totalCaja = filteredPagos.reduce((acc, p) => acc + p.monto, 0);

    if (authLoading || loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                <p className="text-muted-foreground font-medium text-sm">Cargando pagos y caja...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-12">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button onClick={() => router.back()} className="p-2 hover:bg-muted rounded-xl transition-colors">
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <Coins className="text-primary" size={26} />
                        Historial de Pagos / Caja
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Registro de aportes mensuales y control de caja general.
                    </p>
                </div>
            </div>

            {/* Metrics Panel */}
            <div className="bg-card border rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="space-y-1">
                    <p className="text-xs uppercase font-black text-muted-foreground tracking-wider">Caja Total Acumulada (Filtrado)</p>
                    <p className="text-3xl font-black text-primary">
                        ${totalCaja.toLocaleString('es-AR')}
                    </p>
                </div>
                <div className="text-xs text-muted-foreground bg-muted px-3.5 py-2 rounded-xl">
                    Se muestran {filteredPagos.length} transacciones registradas.
                </div>
            </div>

            {/* Filter Bar */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                <input
                    type="text"
                    placeholder="Buscar por socio, concepto, medio de pago..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-input bg-card text-sm focus:ring-2 focus:ring-primary focus:outline-none transition-all shadow-sm"
                />
            </div>

            {/* Payments List Table */}
            <div className="bg-card border rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead>
                            <tr className="bg-muted/40 border-b text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                <th className="p-4">Socio</th>
                                <th className="p-4">Fecha</th>
                                <th className="p-4">Concepto</th>
                                <th className="p-4">Medio de Pago</th>
                                <th className="p-4 text-right">Monto</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filteredPagos.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-muted-foreground italic">
                                        No se encontraron aportes registrados con ese criterio.
                                    </td>
                                </tr>
                            ) : (
                                filteredPagos.map(pago => {
                                    const socio = socios.find(s => s.id === pago.socioId);
                                    const dateStr = new Date(pago.fecha).toLocaleDateString('es-AR', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric'
                                    });

                                    return (
                                        <tr key={pago.id} className="hover:bg-muted/20 transition-colors">
                                            <td className="p-4">
                                                <div className="font-bold text-foreground">
                                                    {socio ? `${socio.apellido}, ${socio.nombre}` : 'Socio Desconocido'}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    DNI: {socio?.dni || 'N/A'}
                                                </div>
                                            </td>
                                            <td className="p-4 text-muted-foreground flex items-center gap-1.5 mt-2 border-none">
                                                <Calendar size={14} className="opacity-60" />
                                                {dateStr}
                                            </td>
                                            <td className="p-4 font-medium text-foreground">
                                                {pago.concepto}
                                            </td>
                                            <td className="p-4 text-muted-foreground flex items-center gap-1.5 mt-2 border-none">
                                                <CreditCard size={14} className="opacity-60" />
                                                <span className="capitalize">{pago.medioDePago}</span>
                                            </td>
                                            <td className="p-4 text-right font-black text-primary">
                                                ${pago.monto.toLocaleString('es-AR')}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
