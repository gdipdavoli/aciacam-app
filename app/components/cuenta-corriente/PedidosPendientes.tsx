'use client';

import type { PedidoPendienteGlobal } from '@/app/lib/cuenta-corriente/contracts';
import { dinero } from '@/app/lib/cuenta-corriente/presentation';

export function PedidosPendientes({
    cuentas,
    onSeleccionar,
}: {
    cuentas: PedidoPendienteGlobal[];
    onSeleccionar: (cuenta: PedidoPendienteGlobal) => void;
}) {
    const pendientes = cuentas.filter(c => BigInt(c.saldoCentavos) > BigInt(0));
    return (
        <section aria-label="Pedidos con aportes pendientes" className="space-y-3">
            <h2 className="text-xl font-semibold">Listado global de saldos pendientes</h2>
            {pendientes.length === 0 ? <p className="text-sm text-muted-foreground">No hay saldos pendientes registrados.</p> : null}
            <ul className="space-y-3">
                {pendientes.map(c => (
                    <li key={c.pedidoId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                        <div className="space-y-1 text-sm">
                            <p className="font-semibold">{c.socioNombre || c.socioId}</p>
                            <p className="break-all text-muted-foreground">Pedido #{c.pedidoId.slice(0, 8)} · {c.estadoEntrega}</p>
                            <p>
                                Esperado: {dinero(c.esperadoCentavos)} · Pendiente: <strong>{dinero(c.saldoCentavos)}</strong>
                            </p>
                        </div>
                        <button
                            type="button"
                            className="min-h-11 rounded border px-3 py-2 text-sm font-medium underline"
                            onClick={() => onSeleccionar(c)}
                        >
                            Gestionar cuenta
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
