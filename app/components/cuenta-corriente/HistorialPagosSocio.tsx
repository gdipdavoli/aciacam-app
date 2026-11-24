'use client';

import { useMemo, useState } from 'react';
import type { Pago } from '@/types';
import {
    CONCEPTO_APORTE_ESTANDAR,
    formatMedioPagoLabel,
    formatPesosArs,
    isConceptoEstandar,
} from '@/app/lib/cuenta-corriente/presentation';

function formatFechaCorta(fecha?: string | null): string {
    if (!fecha) return 'Sin fecha';
    const d = new Date(fecha);
    if (Number.isNaN(d.getTime())) return fecha;
    return d.toLocaleDateString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

function getPeriodo(fecha?: string | null): string {
    if (!fecha) return '';
    const match = fecha.match(/^(\d{4}-\d{2})/);
    if (match) return match[1];
    const d = new Date(fecha);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 7);
}

export function HistorialPagosSocio({ pagos }: { pagos: Pago[] }) {
    const [periodoFiltro, setPeriodoFiltro] = useState('todos');
    const [medioFiltro, setMedioFiltro] = useState('todos');

    const periodosDisponibles = useMemo(() => {
        const set = new Set<string>();
        for (const p of pagos) {
            const per = getPeriodo(p.fecha);
            if (per) set.add(per);
        }
        return Array.from(set).sort((a, b) => b.localeCompare(a));
    }, [pagos]);

    const mediosDisponibles = useMemo(() => {
        const set = new Set<string>();
        for (const p of pagos) {
            set.add(formatMedioPagoLabel(p.medioDePago));
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
    }, [pagos]);

    const pagosFiltrados = useMemo(() => {
        return pagos.filter(p => {
            if (periodoFiltro !== 'todos' && getPeriodo(p.fecha) !== periodoFiltro) return false;
            if (medioFiltro !== 'todos' && formatMedioPagoLabel(p.medioDePago) !== medioFiltro) return false;
            return true;
        });
    }, [pagos, periodoFiltro, medioFiltro]);

    const subtotalFiltrado = useMemo(
        () => pagosFiltrados.reduce((acc, p) => acc + (Number(p.monto) || 0), 0),
        [pagosFiltrados]
    );

    const tieneConceptoEstandar = useMemo(
        () => pagosFiltrados.some(p => isConceptoEstandar(p.concepto)),
        [pagosFiltrados]
    );

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
                        Período
                        <select
                            value={periodoFiltro}
                            onChange={e => setPeriodoFiltro(e.target.value)}
                            aria-label="Filtrar aportes por período"
                            className="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
                        >
                            <option value="todos">Todos los períodos</option>
                            {periodosDisponibles.map(per => (
                                <option key={per} value={per}>
                                    {per}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
                        Medio de pago
                        <select
                            value={medioFiltro}
                            onChange={e => setMedioFiltro(e.target.value)}
                            aria-label="Filtrar aportes por medio de pago"
                            className="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
                        >
                            <option value="todos">Todos los medios</option>
                            {mediosDisponibles.map(m => (
                                <option key={m} value={m}>
                                    {m}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <div className="shrink-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-right">
                    <div className="text-xs text-slate-600">
                        Mostrando <strong>{pagosFiltrados.length}</strong> de {pagos.length} aportes
                    </div>
                    <div className="whitespace-nowrap text-sm font-semibold text-slate-900 tabular-nums">
                        Subtotal filtrado (aportes registrados): {formatPesosArs(subtotalFiltrado)}
                    </div>
                </div>
            </div>

            {tieneConceptoEstandar ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <strong>Concepto estándar:</strong> {CONCEPTO_APORTE_ESTANDAR}.
                </p>
            ) : null}

            {pagosFiltrados.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
                    No hay aportes registrados para los filtros seleccionados.
                </p>
            ) : (
                <>
                    <div className="hidden rounded-lg border border-slate-200 md:block">
                        <table className="w-full table-fixed border-collapse text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
                                    <th className="w-[100px] px-3 py-2.5">Fecha</th>
                                    <th className="px-3 py-2.5">Concepto</th>
                                    <th className="w-[155px] px-3 py-2.5">Medio de pago</th>
                                    <th className="w-[115px] px-3 py-2.5 text-right">Monto</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 bg-white">
                                {pagosFiltrados.map(pago => {
                                    const esEstandar = isConceptoEstandar(pago.concepto);
                                    return (
                                        <tr key={pago.id} className="hover:bg-slate-50">
                                            <td className="whitespace-nowrap px-3 py-2.5 text-slate-700 tabular-nums">
                                                {formatFechaCorta(pago.fecha)}
                                            </td>
                                            <td className="break-words px-3 py-2.5 text-slate-900">
                                                {esEstandar ? (
                                                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-800">
                                                        Aporte social estándar
                                                    </span>
                                                ) : (
                                                    <span className="font-medium text-slate-900">{pago.concepto}</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2.5 text-slate-800">
                                                {formatMedioPagoLabel(pago.medioDePago)}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-emerald-900 tabular-nums">
                                                {formatPesosArs(pago.monto)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="space-y-3 md:hidden">
                        {pagosFiltrados.map(pago => {
                            const esEstandar = isConceptoEstandar(pago.concepto);
                            return (
                                <article key={pago.id} className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm">
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="text-xs font-medium text-slate-600 tabular-nums">
                                            {formatFechaCorta(pago.fecha)}
                                        </span>
                                        <span className="text-sm font-bold text-emerald-900 tabular-nums">
                                            {formatPesosArs(pago.monto)}
                                        </span>
                                    </div>
                                    <p className="mt-1.5 text-sm font-medium text-slate-900">
                                        {esEstandar ? 'Aporte social estándar' : pago.concepto}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-700">
                                        Medio: <strong>{formatMedioPagoLabel(pago.medioDePago)}</strong>
                                    </p>
                                </article>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
