/**
 * app/lib/cierres/cierre-service.ts
 *
 * Servicio compartido para Cuenta Corriente (aciacam_cc) y Cierres Mensuales v2 (CIE-01C).
 * Consumible por la UI administrativa y, en etapas futuras, por Agent Core con aprobación humana.
 * Todos los feature flags nuevos permanecen desactivados por defecto (aciacam_cc.config.enabled = false).
 */

export type EstadoHistoricoCuenta = 'nueva' | 'pendiente_conciliacion' | 'conciliada';

export type CuentaCorrienteOperacion =
    | 'abrir'
    | 'aportar'
    | 'bonificar'
    | 'ajustar'
    | 'revertir'
    | 'conciliar';

export interface CuentaCorrienteOrderBalance {
    pedidoId: string;
    esperadoCentavos: string;
    saldoCentavos: string | null;
}

export interface CuentaCorrienteSummary {
    found: boolean;
    socioId?: string;
    estadoHistorico?: EstadoHistoricoCuenta;
    saldoCorrienteDesdeCorteCentavos?: string;
    saldoAperturaCentavos?: string | null;
    saldoGlobalDefinitivoCentavos?: string | null;
    pedidos?: CuentaCorrienteOrderBalance[];
}

export interface CierrePeriodoConfirmResult {
    cierrePeriodoId: string;
    periodo: string;
    estado: string;
    constanciasEmitidas?: number;
    reused: boolean;
}

export interface CierreV2ResumenCuenta {
    estado_historico: EstadoHistoricoCuenta;
    saldo_inicial_centavos: number | string | null;
    saldo_corriente_desde_corte_centavos: number | string | null;
    saldo_final_definitivo_centavos: number | string | null;
}

export function isValidPeriodo(periodo: string): boolean {
    return /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(periodo);
}

export function formatCentavosAr(centavos: number | string | null | undefined): string {
    if (centavos === null || centavos === undefined || centavos === '') {
        return 'Pendiente de conciliación';
    }
    const numeric = typeof centavos === 'string' ? Number(centavos) : centavos;
    if (!Number.isFinite(numeric)) return 'Pendiente de conciliación';
    const pesos = numeric / 100;
    const isNeg = pesos < 0;
    return `${isNeg ? '-' : ''}$${Math.abs(pesos).toLocaleString('es-AR', {
        minimumFractionDigits: Math.abs(numeric) % 100 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
    })}`;
}

export function canDisplayDefinitiveGlobalBalance(estadoHistorico?: EstadoHistoricoCuenta | null): boolean {
    return estadoHistorico === 'nueva' || estadoHistorico === 'conciliada';
}

export async function fetchSocioCuentaCorrienteSummary(
    supabaseClient: { rpc: (fn: string, params?: Record<string, any>) => Promise<{ data: any; error: any }> },
    socioId: string
): Promise<CuentaCorrienteSummary> {
    const { data, error } = await supabaseClient.rpc('get_socio_cuenta_corriente_summary', {
        p_socio_id: socioId,
    });
    if (error) throw error;
    return (data || { found: false }) as CuentaCorrienteSummary;
}

export async function confirmPeriodClose(
    supabaseClient: { rpc: (fn: string, params?: Record<string, any>) => Promise<{ data: any; error: any }> },
    params: { commandId: string; periodo: string; actorId?: string | null }
): Promise<CierrePeriodoConfirmResult> {
    if (!isValidPeriodo(params.periodo)) {
        throw new Error('Período inválido (formato esperado YYYY-MM).');
    }
    const { data, error } = await supabaseClient.rpc('confirm_period_close_command', {
        p_command_id: params.commandId,
        p_periodo: params.periodo,
        p_actor_id: params.actorId ?? null,
    });
    if (error) throw error;
    return data as CierrePeriodoConfirmResult;
}
