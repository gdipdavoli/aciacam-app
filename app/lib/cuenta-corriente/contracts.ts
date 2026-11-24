export type MedioAporte = 'efectivo' | 'transferencia_galicia' | 'transferencia' | 'mercadopago';

export type MovimientoAporte = {
    id: string;
    pedidoId: string;
    socioId: string;
    tipo: 'cargo' | 'pago' | 'bonificacion' | 'ajuste' | 'reversion';
    signo: 1 | -1;
    centavos: string;
    motivo: string;
    fecha: string;
    responsable: string;
    revierteId: string | null;
    aporteId: string | null;
    medio: MedioAporte | null;
    referencia: string | null;
    conciliada: boolean;
};

export type CuentaPedidoSummary = {
    pedidoId: string;
    esperadoCentavos: string;
    saldoCentavos: string;
    estadoEntrega?: string;
    movimientos: MovimientoAporte[];
};

export type CuentaSocioSummary = {
    found: boolean;
    socioId: string;
    estadoHistorico?: 'pendiente_conciliacion' | 'conciliado';
    saldoCorrienteDesdeCorteCentavos?: string;
    saldoAperturaCentavos?: string | null;
    saldoGlobalDefinitivoCentavos?: string | null;
    cuentas: CuentaPedidoSummary[];
};

export type PedidoPendienteGlobal = {
    pedidoId: string;
    socioId: string;
    socioNombre: string;
    estadoEntrega: string;
    esperadoCentavos: string;
    saldoCentavos: string;
    fechaPedido: string;
};

export type PaginaPendientes = {
    cuentas: PedidoPendienteGlobal[];
    limit: number;
    offset: number;
};

export type ComandoCuentaCorriente =
    | { operacion: 'aportar'; pedidoId: string; centavos: number; medio: MedioAporte; referencia?: string; motivo: string }
    | { operacion: 'bonificar'; pedidoId: string; centavos: number; motivo: string }
    | { operacion: 'ajustar'; pedidoId: string; centavos: number; signo: 1 | -1; motivo: string }
    | { operacion: 'revertir'; pedidoId: string; movimientoId: string; motivo: string }
    | { operacion: 'conciliar'; pedidoId: string; aporteId: string; referencia: string; motivo: string };

export type ResultadoComandoCC = {
    pedidoId: string;
    socioId: string;
    saldoCentavos: string;
    movimientoId: string | null;
    aporteId: string | null;
    legacyPagoId: string | null;
    reused?: boolean;
};

export type ResultadoCierrePeriodo = {
    cierrePeriodoId: string;
    periodo: string;
    estado: string;
    constanciasEmitidas: number;
    reused?: boolean;
};

export type AportesGateway = {
    estadoConfig: () => Promise<{ enabled: boolean; periodoCorte: string | null }>;
    consultar: (socioId: string) => Promise<CuentaSocioSummary>;
    pendientes: (limit?: number, offset?: number) => Promise<PaginaPendientes>;
    ejecutarComando: (commandId: string, payload: ComandoCuentaCorriente) => Promise<ResultadoComandoCC>;
    confirmarCierrePeriodo: (commandId: string, periodo: string) => Promise<ResultadoCierrePeriodo>;
};
