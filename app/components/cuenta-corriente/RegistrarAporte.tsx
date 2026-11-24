'use client';

import { useId, useRef, useState } from 'react';
import type {
    AportesGateway,
    ComandoCuentaCorriente,
    CuentaPedidoSummary,
    MedioAporte,
} from '@/app/lib/cuenta-corriente/contracts';
import { dinero, parseImporte } from '@/app/lib/cuenta-corriente/presentation';

export function RegistrarAporte({
    cuenta,
    gateway,
    isAdmin = false,
    onRegistrado,
}: {
    cuenta: CuentaPedidoSummary;
    gateway: AportesGateway;
    isAdmin?: boolean;
    onRegistrado: () => Promise<void>;
}) {
    const id = useId();
    const [operacion, setOperacion] = useState<'aportar' | 'bonificar' | 'ajustar'>('aportar');
    const [importe, setImporte] = useState('');
    const [medio, setMedio] = useState<MedioAporte>('efectivo');
    const [referencia, setReferencia] = useState('');
    const [signo, setSigno] = useState<1 | -1>(-1);
    const [motivo, setMotivo] = useState('Aporte de sostenimiento');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const request = useRef<{ id: string; payload: ComandoCuentaCorriente } | null>(null);
    const inFlight = useRef(false);
    const [locked, setLocked] = useState(false);

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError('');
        try {
            if (!request.current) {
                const centavos = parseImporte(importe);
                const dir = operacion === 'ajustar' ? signo : -1;
                if (BigInt(cuenta.saldoCentavos) + BigInt(centavos) * BigInt(dir) < BigInt(0)) {
                    throw new Error('El importe supera el saldo pendiente del pedido.');
                }
                if (!motivo.trim()) throw new Error('Indicá el motivo.');
                if (operacion === 'aportar' && medio !== 'efectivo' && !referencia.trim()) {
                    throw new Error('Indicá la referencia de la transferencia.');
                }
                const payload: ComandoCuentaCorriente =
                    operacion === 'aportar'
                        ? {
                              operacion: 'aportar',
                              pedidoId: cuenta.pedidoId,
                              centavos,
                              medio,
                              referencia: referencia.trim() || undefined,
                              motivo: motivo.trim(),
                          }
                        : operacion === 'bonificar'
                          ? {
                                operacion: 'bonificar',
                                pedidoId: cuenta.pedidoId,
                                centavos,
                                motivo: motivo.trim(),
                            }
                          : {
                                operacion: 'ajustar',
                                pedidoId: cuenta.pedidoId,
                                centavos,
                                signo,
                                motivo: motivo.trim(),
                            };
                request.current = { id: crypto.randomUUID(), payload };
                setLocked(true);
            }
            await gateway.ejecutarComando(request.current.id, request.current.payload);
            await onRegistrado();
            setSuccess(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'No se pudo registrar la operación.');
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }

    if (success) {
        return (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <p role="status">Operación registrada en cuenta corriente.</p>
                {BigInt(cuenta.saldoCentavos) > BigInt(0) ? (
                    <button
                        type="button"
                        className="min-h-11 underline"
                        onClick={() => {
                            request.current = null;
                            setLocked(false);
                            setSuccess(false);
                            setImporte('');
                            setReferencia('');
                        }}
                    >
                        Registrar otra operación
                    </button>
                ) : null}
            </div>
        );
    }

    if (BigInt(cuenta.saldoCentavos) <= BigInt(0) && operacion !== 'ajustar') {
        return <p className="text-sm text-muted-foreground">Sin aportes pendientes para este pedido.</p>;
    }

    return (
        <form onSubmit={submit} className="space-y-3 rounded-lg border p-4" aria-label="Registrar movimiento en cuenta corriente">
            <p className="text-sm">
                Saldo pendiente: <strong>{dinero(cuenta.saldoCentavos)}</strong>
            </p>
            <fieldset disabled={busy || locked} className="grid gap-3">
                {isAdmin ? (
                    <div>
                        <label htmlFor={`${id}-op`} className="mb-1 block text-sm font-medium">
                            Operación
                        </label>
                        <select
                            id={`${id}-op`}
                            className="w-full rounded border bg-background p-2.5 text-sm"
                            value={operacion}
                            onChange={e => {
                                const nextOp = e.target.value as 'aportar' | 'bonificar' | 'ajustar';
                                setOperacion(nextOp);
                                setMotivo(
                                    nextOp === 'aportar'
                                        ? 'Aporte de sostenimiento'
                                        : nextOp === 'bonificar'
                                          ? 'Bonificación autorizada'
                                          : 'Ajuste administrativo de saldo'
                                );
                            }}
                        >
                            <option value="aportar">Registrar aporte posterior</option>
                            <option value="bonificar">Bonificación (Admin)</option>
                            <option value="ajustar">Ajuste de saldo (Admin)</option>
                        </select>
                    </div>
                ) : null}

                {operacion === 'ajustar' && isAdmin ? (
                    <div>
                        <label htmlFor={`${id}-signo`} className="mb-1 block text-sm font-medium">
                            Sentido del ajuste
                        </label>
                        <select
                            id={`${id}-signo`}
                            className="w-full rounded border bg-background p-2.5 text-sm"
                            value={String(signo)}
                            onChange={e => setSigno(e.target.value === '1' ? 1 : -1)}
                        >
                            <option value="-1">Descontar saldo (-)</option>
                            <option value="1">Incrementar saldo (+)</option>
                        </select>
                    </div>
                ) : null}

                <div>
                    <label htmlFor={`${id}-importe`} className="mb-1 block text-sm font-medium">
                        Importe en pesos
                    </label>
                    <input
                        id={`${id}-importe`}
                        className="w-full rounded border bg-background p-2.5 text-sm"
                        inputMode="decimal"
                        required
                        value={importe}
                        onChange={e => setImporte(e.target.value)}
                    />
                </div>

                {operacion === 'aportar' ? (
                    <>
                        <div>
                            <label htmlFor={`${id}-medio`} className="mb-1 block text-sm font-medium">
                                Medio de pago
                            </label>
                            <select
                                id={`${id}-medio`}
                                className="w-full rounded border bg-background p-2.5 text-sm"
                                value={medio}
                                onChange={e => setMedio(e.target.value as MedioAporte)}
                            >
                                <option value="efectivo">Efectivo</option>
                                <option value="transferencia_galicia">Transferencia Galicia</option>
                                <option value="transferencia">Transferencia</option>
                                <option value="mercadopago">Mercado Pago</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor={`${id}-ref`} className="mb-1 block text-sm font-medium">
                                Referencia {medio === 'efectivo' ? '(opcional)' : '(obligatoria)'}
                            </label>
                            <input
                                id={`${id}-ref`}
                                className="w-full rounded border bg-background p-2.5 text-sm"
                                required={medio !== 'efectivo'}
                                value={referencia}
                                onChange={e => setReferencia(e.target.value)}
                            />
                        </div>
                    </>
                ) : null}

                <div>
                    <label htmlFor={`${id}-motivo`} className="mb-1 block text-sm font-medium">
                        Motivo / observación
                    </label>
                    <input
                        id={`${id}-motivo`}
                        className="w-full rounded border bg-background p-2.5 text-sm"
                        required
                        maxLength={2000}
                        value={motivo}
                        onChange={e => setMotivo(e.target.value)}
                    />
                </div>
            </fieldset>
            {error ? (
                <p role="alert" className="text-sm text-red-700">
                    {error} {locked ? 'El reintento conserva la misma operación para evitar duplicados.' : ''}
                </p>
            ) : null}
            <button type="submit" className="btn-forest min-h-11 rounded px-4 py-2.5 text-sm font-semibold" disabled={busy}>
                {busy ? 'Registrando…' : locked ? 'Reintentar la misma operación' : 'Confirmar operación'}
            </button>
        </form>
    );
}
