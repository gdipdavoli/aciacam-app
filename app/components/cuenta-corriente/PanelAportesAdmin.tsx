'use client';

import { useRef, useState } from 'react';
import type { AportesGateway, CuentaSocioSummary, PaginaPendientes, ResultadoCierrePeriodo } from '@/app/lib/cuenta-corriente/contracts';
import { CuentaCorrienteSocio } from './CuentaCorrienteSocio';
import { PedidosPendientes } from './PedidosPendientes';

export function PanelAportesAdmin({
    gateway,
    socios,
    puedeRegistrar,
    isAdmin = false,
}: {
    gateway: AportesGateway;
    socios: Array<{ id: string; nombre: string }>;
    puedeRegistrar: boolean;
    isAdmin?: boolean;
}) {
    const [selected, setSelected] = useState('');
    const [account, setAccount] = useState<CuentaSocioSummary | null>(null);
    const [page, setPage] = useState<PaginaPendientes | null>(null);
    const [periodoCierre, setPeriodoCierre] = useState(() => new Date().toISOString().slice(0, 7));
    const [cierreResult, setCierreResult] = useState<ResultadoCierrePeriodo | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const request = useRef(0);

    async function consultarSocio(socioId: string) {
        if (!socioId) return;
        const current = ++request.current;
        setBusy(true);
        setError('');
        setAccount(null);
        setSelected(socioId);
        try {
            const result = await gateway.consultar(socioId);
            if (current === request.current) setAccount(result);
        } catch (e) {
            if (current === request.current) setError(e instanceof Error ? e.message : 'No se pudo consultar la cuenta.');
        } finally {
            if (current === request.current) setBusy(false);
        }
    }

    async function cargarPendientes(offset = 0) {
        const current = ++request.current;
        setBusy(true);
        setError('');
        try {
            const result = await gateway.pendientes(25, offset);
            if (current === request.current) setPage(result);
        } catch (e) {
            if (current === request.current) setError(e instanceof Error ? e.message : 'No se pudieron consultar los pendientes.');
        } finally {
            if (current === request.current) setBusy(false);
        }
    }

    async function ejecutarCierrePeriodo() {
        if (!isAdmin || !periodoCierre || busy) return;
        setBusy(true);
        setError('');
        setCierreResult(null);
        try {
            const res = await gateway.confirmarCierrePeriodo(crypto.randomUUID(), periodoCierre);
            setCierreResult(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'No se pudo emitir el cierre mensual.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="mx-auto max-w-4xl space-y-5 p-4">
            <h1 className="text-2xl font-semibold">Cuenta corriente de aportes</h1>

            <form
                onSubmit={e => {
                    e.preventDefault();
                    void consultarSocio(selected);
                }}
                className="grid gap-3 rounded-lg border p-4"
            >
                <label htmlFor="cc-socio" className="text-sm font-medium">
                    Socio
                </label>
                <select
                    id="cc-socio"
                    className="rounded border bg-background p-3 text-sm"
                    value={selected}
                    onChange={e => setSelected(e.target.value)}
                    required
                    disabled={busy}
                >
                    <option value="">Elegir socio</option>
                    {socios.map(s => (
                        <option key={s.id} value={s.id}>
                            {s.nombre}
                        </option>
                    ))}
                </select>
                <div className="flex flex-wrap gap-3">
                    <button type="submit" className="min-h-11 rounded border px-4 py-2 text-sm font-medium" disabled={busy || !selected}>
                        Consultar cuenta
                    </button>
                    <button
                        type="button"
                        className="min-h-11 rounded border px-4 py-2 text-sm font-medium"
                        disabled={busy}
                        onClick={() => void cargarPendientes(0)}
                    >
                        Consultar pedidos con aportes pendientes
                    </button>
                </div>
            </form>

            {isAdmin ? (
                <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
                    <div>
                        <label htmlFor="cc-cierre-periodo" className="mb-1 block text-sm font-medium">
                            Cierre mensual de período (YYYY-MM)
                        </label>
                        <input
                            id="cc-cierre-periodo"
                            type="month"
                            className="rounded border bg-background p-2.5 text-sm"
                            value={periodoCierre}
                            onChange={e => setPeriodoCierre(e.target.value)}
                            disabled={busy}
                        />
                    </div>
                    <button
                        type="button"
                        className="btn-forest min-h-11 rounded px-4 py-2 text-sm font-semibold"
                        disabled={busy || !periodoCierre}
                        onClick={() => void ejecutarCierrePeriodo()}
                    >
                        Emitir cierre mensual v2
                    </button>
                    {cierreResult ? (
                        <p role="status" className="text-sm text-emerald-700">
                            Período {cierreResult.periodo} cerrado ({cierreResult.constanciasEmitidas} constancias emitidas).
                        </p>
                    ) : null}
                </div>
            ) : null}

            {busy ? <p role="status">Consultando…</p> : null}
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}

            {page ? (
                <>
                    <PedidosPendientes
                        cuentas={page.cuentas}
                        onSeleccionar={cuenta => {
                            void consultarSocio(cuenta.socioId);
                        }}
                    />
                    <div className="flex gap-4">
                        {page.offset > 0 ? (
                            <button type="button" className="min-h-11 underline" disabled={busy} onClick={() => void cargarPendientes(Math.max(0, page.offset - page.limit))}>
                                Anteriores
                            </button>
                        ) : null}
                        {page.cuentas.length === page.limit ? (
                            <button type="button" className="min-h-11 underline" disabled={busy} onClick={() => void cargarPendientes(page.offset + page.limit)}>
                                Ver siguientes pendientes
                            </button>
                        ) : null}
                    </div>
                </>
            ) : null}

            {account ? (
                <CuentaCorrienteSocio
                    key={account.socioId}
                    initial={account}
                    gateway={{
                        ...gateway,
                        consultar: async socioId => {
                            const result = await gateway.consultar(socioId);
                            setPage(null);
                            return result;
                        },
                    }}
                    puedeRegistrar={puedeRegistrar}
                    isAdmin={isAdmin}
                />
            ) : null}
        </div>
    );
}
