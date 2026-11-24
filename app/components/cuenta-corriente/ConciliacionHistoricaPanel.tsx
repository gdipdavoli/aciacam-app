'use client';

import { useState } from 'react';

export type LoteConciliacionHistorica =
    | 'impago_90k'
    | 'posibles_duplicados'
    | 'sin_importe_con_pago'
    | 'sin_importe_sin_pago';

export type RegistroRevisionHistorica = {
    lote: LoteConciliacionHistorica;
    actor: string;
    fecha: string;
    motivo: string;
    evidencia: string;
};

const LOTES_DIAGNOSTICO: Array<{
    id: LoteConciliacionHistorica;
    titulo: string;
    cantidad: string;
    clasificacion: 'Saldo verificado' | 'Saldo no determinable' | 'Requiere revisión';
    criterio: string;
}> = [
    {
        id: 'impago_90k',
        titulo: 'Pedido entregado con importe ($90.000) y sin pago registrado',
        cantidad: '1 pedido ($90.000)',
        clasificacion: 'Requiere revisión',
        criterio: 'Verificar si la transferencia ingresó en banco o confirmar deuda de apertura.',
    },
    {
        id: 'posibles_duplicados',
        titulo: 'Grupos de posibles pagos duplicados (socio + pedido + monto)',
        cantidad: '6 grupos (5 mismo día / 1 días distintos)',
        clasificacion: 'Requiere revisión',
        criterio: 'Contrastación con extracto bancario y caja; no eliminar pagos automáticamente.',
    },
    {
        id: 'sin_importe_con_pago',
        titulo: 'Pedidos entregados sin importe histórico con pagos registrados',
        cantidad: '455 pedidos ($43.747.101 registrados)',
        clasificacion: 'Saldo no determinable',
        criterio: 'Sin importe en pedidos.total ni en items; no reconstruir con precios actuales.',
    },
    {
        id: 'sin_importe_sin_pago',
        titulo: 'Pedidos entregados sin importe histórico ni pago registrado',
        cantidad: '239 pedidos',
        clasificacion: 'Saldo no determinable',
        criterio: 'No asumir deuda ni condonación automática; requiere confirmación administrativa.',
    },
];

export function ConciliacionHistoricaPanel({
    fechaCorte = '2026-12-01',
    puedeConfirmar = false,
}: {
    fechaCorte?: string;
    puedeConfirmar?: boolean;
}) {
    const [loteActivo, setLoteActivo] = useState<LoteConciliacionHistorica>('impago_90k');
    const [motivo, setMotivo] = useState('');
    const [evidencia, setEvidencia] = useState('');
    const [borradoresRevision, setBorradoresRevision] = useState<RegistroRevisionHistorica[]>([]);

    function registrarBorradorRevision(e: React.FormEvent) {
        e.preventDefault();
        if (!puedeConfirmar || !motivo.trim()) return;
        setBorradoresRevision(prev => [
            {
                lote: loteActivo,
                actor: 'admin-sesion',
                fecha: new Date().toISOString(),
                motivo: motivo.trim(),
                evidencia: evidencia.trim() || 'Sin adjunto',
            },
            ...prev,
        ]);
        setMotivo('');
        setEvidencia('');
    }

    return (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4" aria-label="Conciliación histórica progresiva">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                        Transición y conciliación histórica (corte propuesto {fechaCorte})
                    </h2>
                    <p className="text-xs text-slate-600">
                        Separación explícita entre historial anterior al corte, saldos de apertura confirmados, saldos no determinables y movimientos posteriores al corte. No se ejecutan cancelaciones masivas sin revisión y autorización expresa.
                    </p>
                </div>
                <span className="rounded bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
                    Modo diagnóstico / sin activación
                </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                {LOTES_DIAGNOSTICO.map(lote => (
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
                            <span className="text-xs font-bold text-slate-900">{lote.cantidad}</span>
                        </div>
                        <p className="mt-1 text-sm font-medium text-slate-900">{lote.titulo}</p>
                        <p className="mt-1 text-xs text-slate-600">{lote.criterio}</p>
                    </button>
                ))}
            </div>

            <form onSubmit={registrarBorradorRevision} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-700">
                    Registro auditado por caso (actor, fecha, motivo y evidencia) — Lote seleccionado: <code>{loteActivo}</code>
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                    <input
                        type="text"
                        placeholder="Motivo administrativo obligatorio"
                        value={motivo}
                        onChange={e => setMotivo(e.target.value)}
                        disabled={!puedeConfirmar}
                        className="rounded border bg-white px-3 py-2 text-sm"
                    />
                    <input
                        type="text"
                        placeholder="Referencia / evidencia bancaria o acta"
                        value={evidencia}
                        onChange={e => setEvidencia(e.target.value)}
                        disabled={!puedeConfirmar}
                        className="rounded border bg-white px-3 py-2 text-sm"
                    />
                </div>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-600">
                        {puedeConfirmar
                            ? 'Registra revisión local sin cancelar saldos masivamente.'
                            : 'Confirmaciones deshabilitadas hasta habilitar etapa de conciliación.'}
                    </span>
                    <button
                        type="submit"
                        disabled={!puedeConfirmar || !motivo.trim()}
                        className="min-h-10 rounded border bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                    >
                        Registrar revisión auditada
                    </button>
                </div>
            </form>

            {borradoresRevision.length > 0 ? (
                <ul className="space-y-1 text-xs text-slate-700">
                    {borradoresRevision.map((r, idx) => (
                        <li key={idx} className="rounded border bg-white px-3 py-2">
                            <strong>{r.lote}</strong> · {r.actor} · {r.fecha.slice(0, 10)} · {r.motivo} ({r.evidencia})
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}
