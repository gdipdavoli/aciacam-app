'use client';

import { useState } from 'react';
import type {
    AportesGateway,
    LoteConciliacionId,
    LotesConciliacionHistoricaResponse,
    RevisionHistoricaItem,
} from '@/app/lib/cuenta-corriente/contracts';

const METADATOS_LOTES: Array<{
    id: LoteConciliacionId;
    titulo: string;
    clasificacion: 'Saldo verificado' | 'Saldo no determinable' | 'Requiere revisión';
    criterio: string;
}> = [
    {
        id: 'impago_con_importe',
        titulo: 'Pedidos entregados con importe y sin pago completo',
        clasificacion: 'Requiere revisión',
        criterio: 'Verificar ingreso bancario o confirmar saldo de apertura.',
    },
    {
        id: 'posibles_duplicados',
        titulo: 'Grupos de posibles pagos duplicados (socio + pedido + monto)',
        clasificacion: 'Requiere revisión',
        criterio: 'Contrastación con extracto bancario y caja; no eliminar pagos automáticamente.',
    },
    {
        id: 'sin_importe_con_pago',
        titulo: 'Pedidos entregados sin importe histórico con pagos registrados',
        clasificacion: 'Saldo no determinable',
        criterio: 'Sin importe en pedidos.total ni en items; no reconstruir con precios actuales.',
    },
    {
        id: 'sin_importe_sin_pago',
        titulo: 'Pedidos entregados sin importe histórico ni pago registrado',
        clasificacion: 'Saldo no determinable',
        criterio: 'No asumir deuda ni condonación automática; requiere confirmación administrativa.',
    },
];

function resumenDinamicoLote(id: LoteConciliacionId, data: LotesConciliacionHistoricaResponse | null): string {
    if (!data) return 'Sin consultar';
    switch (id) {
        case 'impago_con_importe':
            return `${data.lotes.impagoConImporte.cantidad} pedidos ($${Number(data.lotes.impagoConImporte.montoArs).toLocaleString('es-AR')})`;
        case 'posibles_duplicados':
            return `${data.lotes.posiblesDuplicados.grupos} grupos`;
        case 'sin_importe_con_pago':
            return `${data.lotes.sinImporteConPago.cantidad} pedidos ($${Number(data.lotes.sinImporteConPago.pagosArs).toLocaleString('es-AR')} en pagos)`;
        case 'sin_importe_sin_pago':
            return `${data.lotes.sinImporteSinPago.cantidad} pedidos`;
    }
}

export function ConciliacionHistoricaPanel({
    gateway,
    fechaCorteInicial = '2026-12-01',
    isAdmin = false,
}: {
    gateway: AportesGateway;
    fechaCorteInicial?: string;
    isAdmin?: boolean;
}) {
    const [fechaCorte, setFechaCorte] = useState(fechaCorteInicial);
    const [datos, setDatos] = useState<LotesConciliacionHistoricaResponse | null>(null);
    const [loteActivo, setLoteActivo] = useState<LoteConciliacionId>('impago_con_importe');
    const [accion, setAccion] = useState<RevisionHistoricaItem['accion']>('observacion');
    const [motivo, setMotivo] = useState('');
    const [evidencia, setEvidencia] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function cargarLotes() {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            const res = await gateway.lotesHistoricos(fechaCorte);
            setDatos(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'No se pudieron consultar los lotes históricos.');
        } finally {
            setBusy(false);
        }
    }

    async function registrarRevision(e: React.FormEvent) {
        e.preventDefault();
        if (!isAdmin || busy || motivo.trim().length < 5 || evidencia.trim().length < 3) return;
        setBusy(true);
        setError('');
        try {
            await gateway.registrarRevisionHistorica({
                lote: loteActivo,
                fechaCorte,
                accion,
                motivo: motivo.trim(),
                evidencia: evidencia.trim(),
            });
            setMotivo('');
            setEvidencia('');
            const res = await gateway.lotesHistoricos(fechaCorte);
            setDatos(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'No se pudo registrar la revisión histórica.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4" aria-label="Conciliación histórica progresiva">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
                <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                        Transición y conciliación histórica (corte {fechaCorte})
                    </h2>
                    <p className="text-xs text-slate-600">
                        Consulta dinámica en base de datos. Actor y fecha determinados por el servidor. Sin cancelaciones masivas automáticas.
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <input
                        type="date"
                        value={fechaCorte}
                        onChange={e => setFechaCorte(e.target.value)}
                        className="rounded border bg-white px-2.5 py-1.5 text-sm"
                        aria-label="Fecha de corte"
                    />
                    <button
                        type="button"
                        onClick={() => void cargarLotes()}
                        disabled={busy}
                        className="min-h-10 rounded border bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                        {busy ? 'Consultando…' : 'Consultar lotes'}
                    </button>
                </div>
            </div>

            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}

            <div className="grid gap-3 md:grid-cols-2">
                {METADATOS_LOTES.map(lote => (
                    <button
                        key={lote.id}
                        type="button"
                        onClick={() => setLoteActivo(lote.id)}
                        className={`rounded-lg border p-3 text-left transition ${
                            loteActivo === lote.id ? 'border-emerald-700 bg-emerald-50/40' : 'border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{lote.clasificacion}</span>
                            <span className="text-xs font-bold text-slate-900">{resumenDinamicoLote(lote.id, datos)}</span>
                        </div>
                        <p className="mt-1 text-sm font-medium text-slate-900">{lote.titulo}</p>
                        <p className="mt-1 text-xs text-slate-600">{lote.criterio}</p>
                    </button>
                ))}
            </div>

            <form onSubmit={registrarRevision} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                        Registrar revisión persistida — Lote: <code>{loteActivo}</code>
                    </span>
                    <select
                        value={accion}
                        onChange={e => setAccion(e.target.value as RevisionHistoricaItem['accion'])}
                        disabled={!isAdmin || busy}
                        className="rounded border bg-white px-2.5 py-1 text-xs"
                    >
                        <option value="observacion">Observación</option>
                        <option value="diferir_revision">Diferir revisión</option>
                        <option value="confirmar_duplicado">Confirmar duplicado</option>
                        <option value="descartar_duplicado">Descartar duplicado</option>
                    </select>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                    <input
                        type="text"
                        placeholder="Motivo administrativo (mín. 5 caracteres)"
                        value={motivo}
                        onChange={e => setMotivo(e.target.value)}
                        disabled={!isAdmin || busy}
                        className="rounded border bg-white px-3 py-2 text-sm"
                    />
                    <input
                        type="text"
                        placeholder="Referencia / evidencia bancaria o acta"
                        value={evidencia}
                        onChange={e => setEvidencia(e.target.value)}
                        disabled={!isAdmin || busy}
                        className="rounded border bg-white px-3 py-2 text-sm"
                    />
                </div>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-600">
                        {isAdmin ? 'Persiste en aciacam_cc.revisiones_historicas (inmutable).' : 'Solo administradores pueden registrar revisiones.'}
                    </span>
                    <button
                        type="submit"
                        disabled={!isAdmin || busy || motivo.trim().length < 5 || evidencia.trim().length < 3}
                        className="min-h-10 rounded border bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                    >
                        Guardar revisión auditada
                    </button>
                </div>
            </form>

            {datos && datos.revisiones.length > 0 ? (
                <ul className="space-y-1 text-xs text-slate-700">
                    {datos.revisiones.map(r => (
                        <li key={r.id} className="rounded border bg-white px-3 py-2">
                            <strong>{r.lote}</strong> · {r.accion} · {r.fecha.slice(0, 10)} · {r.motivo} ({r.evidencia})
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}
