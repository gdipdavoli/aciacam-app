import type {
    AportesGateway,
    ComandoCuentaCorriente,
    CuentaSocioSummary,
    MovimientoAporte,
    PaginaPendientes,
    ResultadoCierrePeriodo,
    ResultadoComandoCC,
} from './contracts';

type RpcFn = (
    name: string,
    parameters: Record<string, unknown>
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export function createAportesGateway(rpc: RpcFn): AportesGateway {
    async function call<T>(name: string, parameters: Record<string, unknown>): Promise<T> {
        const { data, error } = await rpc(name, parameters);
        if (error) throw new Error(error.message);
        if (data === null || data === undefined) {
            throw new Error('No se recibió el resultado. Reintentá con la misma operación.');
        }
        return data as T;
    }

    return {
        estadoConfig: () => call<{ enabled: boolean; periodoCorte: string | null }>('get_cc_config_status', {}),
        consultar: async (socioId: string): Promise<CuentaSocioSummary> => {
            const [summary, movRes] = await Promise.all([
                call<any>('get_socio_cuenta_corriente_summary', { p_socio_id: socioId }),
                call<{ movimientos: MovimientoAporte[] }>('get_socio_cuenta_corriente_movements', { p_socio_id: socioId }),
            ]);

            if (!summary?.found) {
                return { found: false, socioId, cuentas: [] };
            }

            const movsByPedido = new Map<string, MovimientoAporte[]>();
            for (const m of movRes?.movimientos || []) {
                const list = movsByPedido.get(m.pedidoId) || [];
                list.push(m);
                movsByPedido.set(m.pedidoId, list);
            }

            const cuentas = Array.isArray(summary.pedidos)
                ? summary.pedidos.map((p: any) => ({
                      pedidoId: p.pedidoId,
                      esperadoCentavos: p.esperadoCentavos,
                      saldoCentavos: p.saldoCentavos,
                      movimientos: movsByPedido.get(p.pedidoId) || [],
                  }))
                : [];

            return {
                found: true,
                socioId: summary.socioId,
                estadoHistorico: summary.estadoHistorico,
                saldoCorrienteDesdeCorteCentavos: summary.saldoCorrienteDesdeCorteCentavos,
                saldoAperturaCentavos: summary.saldoAperturaCentavos,
                saldoGlobalDefinitivoCentavos: summary.saldoGlobalDefinitivoCentavos,
                cuentas,
            };
        },
        pendientes: (limit = 50, offset = 0) =>
            call<PaginaPendientes>('get_cc_pending_accounts', { p_limit: limit, p_offset: offset }),
        ejecutarComando: (commandId: string, payload: ComandoCuentaCorriente) =>
            call<ResultadoComandoCC>('cc_command', { p_command_id: commandId, p_payload: payload }),
        confirmarCierrePeriodo: (commandId: string, periodo: string) =>
            call<ResultadoCierrePeriodo>('confirm_period_close_command', { p_command_id: commandId, p_periodo: periodo }),
    };
}
