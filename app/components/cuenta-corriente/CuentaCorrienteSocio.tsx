'use client';

import { useState } from 'react';
import type { AportesGateway, CuentaSocioSummary, MovimientoAporte } from '@/app/lib/cuenta-corriente/contracts';
import {
    dinero,
    formatEstadoHistoricoLabel,
    formatMedioPagoLabel,
    resumen,
} from '@/app/lib/cuenta-corriente/presentation';
import { RegistrarAporte } from './RegistrarAporte';

const tipos: Record<MovimientoAporte['tipo'], string> = {
    cargo: 'Aporte comprometido',
    pago: 'Aporte recibido',
    bonificacion: 'Bonificación autorizada',
    ajuste: 'Ajuste autorizado',
    reversion: 'Reversión',
};

export function CuentaCorrienteSocio({
    initial,
    gateway,
    puedeRegistrar,
    isAdmin = false,
    ccEnabled = true,
    periodoCorte = null,
}: {
    initial: CuentaSocioSummary;
    gateway: AportesGateway;
    puedeRegistrar: boolean;
    isAdmin?: boolean;
    ccEnabled?: boolean;
    periodoCorte?: string | null;
}) {
    const [data, setData] = useState(initial);
    const [actionBusy, setActionBusy] = useState<string | null>(null);
    const [actionError, setActionError] = useState('');

    async function refresh() {
        setData(await gateway.consultar(initial.socioId));
    }

    async function handleConciliar(m: MovimientoAporte) {
        if (!m.aporteId || actionBusy) return;
        const ref = window.prompt('Referencia bancaria confirmada para conciliar transferencia:', m.referencia || '');
        if (!ref || ref.trim().length < 2) return;
        setActionBusy(m.id);
        setActionError('');
        try {
            await gateway.ejecutarComando(crypto.randomUUID(), {
                operacion: 'conciliar',
                pedidoId: m.pedidoId,
                aporteId: m.aporteId,
                referencia: ref.trim(),
                motivo: `Conciliación de transferencia ${ref.trim()}`,
            });
            await refresh();
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'No se pudo conciliar la transferencia.');
        } finally {
            setActionBusy(null);
        }
    }

    async function handleRevertir(m: MovimientoAporte) {
        if (actionBusy) return;
        const motivo = window.prompt('Motivo auditado de la reversión:');
        if (!motivo || !motivo.trim()) return;
        setActionBusy(m.id);
        setActionError('');
        try {
            await gateway.ejecutarComando(crypto.randomUUID(), {
                operacion: 'revertir',
                pedidoId: m.pedidoId,
                movimientoId: m.id,
                motivo: motivo.trim(),
            });
            await refresh();
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'No se pudo revertir el movimiento.');
        } finally {
            setActionBusy(null);
        }
    }

    return (
        <section className="space-y-4" aria-label="Cuenta corriente de aportes">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">Estado de cuenta corriente</h2>
                {data.found ? (
                    <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-800">
                        <span>
                            Historial anterior al corte:{' '}
                            <strong>{formatEstadoHistoricoLabel(data.estadoHistorico)}</strong>
                        </span>
                        <span>
                            · Saldo de apertura:{' '}
                            <strong>
                                {data.saldoAperturaCentavos !== null && data.saldoAperturaCentavos !== undefined
                                    ? `${dinero(data.saldoAperturaCentavos)} (confirmado)`
                                    : 'No determinable (pendiente de revisión)'}
                            </strong>
                        </span>
                        {ccEnabled && periodoCorte && data.saldoCorrienteDesdeCorteCentavos !== undefined ? (
                            <span>
                                · Movimientos desde corte ({periodoCorte}):{' '}
                                <strong>{dinero(data.saldoCorrienteDesdeCorteCentavos)}</strong>
                            </span>
                        ) : null}
                        {data.saldoGlobalDefinitivoCentavos ? (
                            <span>
                                · Saldo definitivo: <strong>{dinero(data.saldoGlobalDefinitivoCentavos)}</strong>
                            </span>
                        ) : null}
                    </div>
                ) : null}
            </div>

            {actionError ? <p role="alert" className="text-sm text-red-700">{actionError}</p> : null}

            {!data.found || data.cuentas.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    No hay un aporte comprometido documentado para este socio desde la fecha de corte. No se presume un saldo retroactivo.
                </p>
            ) : null}

            {data.cuentas.map(cuenta => {
                const totals = resumen(cuenta);
                const saldo = BigInt(cuenta.saldoCentavos);
                const zero = BigInt(0);
                const revertedIds = new Set(cuenta.movimientos.map(m => m.revierteId).filter(Boolean));
                return (
                    <article key={cuenta.pedidoId} className="space-y-4 rounded-xl border p-4">
                        <h3 className="break-all font-semibold">Pedido {cuenta.pedidoId}</h3>
                        <p className="text-sm">
                            Estado económico:{' '}
                            {saldo > zero
                                ? BigInt(totals.recibidos) > zero
                                    ? 'Aporte parcial, saldo pendiente'
                                    : 'Sin aporte recibido, saldo pendiente'
                                : saldo < zero
                                  ? 'Crédito a favor'
                                  : 'Sin pendiente'}
                            .
                        </p>
                        <dl className="grid grid-cols-2 gap-2 text-sm">
                            <dt>Aporte previsto</dt>
                            <dd>{dinero(cuenta.esperadoCentavos)}</dd>
                            <dt>Aportes recibidos netos</dt>
                            <dd>{dinero(totals.recibidos)}</dd>
                            <dt>Bonificaciones netas</dt>
                            <dd>{dinero(totals.bonificados)}</dd>
                            <dt>Ajustes netos</dt>
                            <dd>{dinero(totals.ajustes)}</dd>
                            <dt>{saldo < zero ? 'Crédito a favor' : 'Pendiente'}</dt>
                            <dd className="font-semibold">{dinero(saldo < zero ? -saldo : saldo)}</dd>
                        </dl>

                        <details open>
                            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
                                Historial de movimientos ({cuenta.movimientos.length})
                            </summary>
                            <ol className="space-y-3">
                                {cuenta.movimientos.map(m => {
                                    const yaRevertido = revertedIds.has(m.id);
                                    const puedeConciliar =
                                        isAdmin && m.tipo === 'pago' && m.medio !== 'efectivo' && !m.conciliada && !yaRevertido && Boolean(m.aporteId);
                                    const puedeRevertir =
                                        isAdmin && ['pago', 'bonificacion', 'ajuste'].includes(m.tipo) && !yaRevertido;

                                    return (
                                        <li key={m.id} className="space-y-1 break-words rounded border p-3 text-sm">
                                            <p className="font-medium">
                                                {tipos[m.tipo]} · {dinero(m.centavos)}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {new Date(m.fecha).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} · Resp: {m.responsable}
                                            </p>
                                            <p>{m.motivo}</p>
                                            {m.medio ? (
                                                <p className="text-xs">
                                                    {formatMedioPagoLabel(m.medio)} · {m.referencia || 'Sin referencia'} ·{' '}
                                                    {m.medio === 'efectivo'
                                                        ? 'Recibido'
                                                        : m.conciliada
                                                          ? 'Transferencia conciliada'
                                                          : 'Transferencia pendiente de conciliación'}
                                                </p>
                                            ) : null}
                                            {m.revierteId ? <p className="text-xs text-amber-700">Compensa el movimiento {m.revierteId}</p> : null}
                                            {(puedeConciliar || puedeRevertir) ? (
                                                <div className="flex flex-wrap gap-2 pt-1">
                                                    {puedeConciliar ? (
                                                        <button
                                                            type="button"
                                                            disabled={actionBusy === m.id}
                                                            onClick={() => void handleConciliar(m)}
                                                            className="rounded border px-2.5 py-1 text-xs font-medium"
                                                        >
                                                            Conciliar transferencia
                                                        </button>
                                                    ) : null}
                                                    {puedeRevertir ? (
                                                        <button
                                                            type="button"
                                                            disabled={actionBusy === m.id}
                                                            onClick={() => void handleRevertir(m)}
                                                            className="rounded border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700"
                                                        >
                                                            Revertir
                                                        </button>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ol>
                        </details>

                        {puedeRegistrar ? (
                            <RegistrarAporte key={cuenta.pedidoId} cuenta={cuenta} gateway={gateway} isAdmin={isAdmin} onRegistrado={refresh} />
                        ) : null}
                    </article>
                );
            })}
        </section>
    );
}
