export type UserRole = 'socio' | 'staff' | 'admin';

export type EstadoDocumento = 'pendiente' | 'completo' | 'vencido';

export type DocumentoSocio = {
    /** @deprecated DO NOT USE. Use verificacion_estado and presence check instead. */
    estado?: EstadoDocumento;
    archivoPath?: string;      // Path in Supabase Storage (bucket: documentos-socios)
    fechaEmision?: string;    // ISO Date (fecha de firma/emisión)
    fechaVencimiento?: string; // ISO Date (para REPROCANN / receta)
    monto?: number;            // Para contratos
    observaciones?: string;

    // New Verification Model
    verificacion_estado?: 'pendiente' | 'en_revision' | 'aprobado' | 'rechazado';
    verificacion_obs?: string;
    verificado_at?: string; // ISO Date
    verificado_por?: string;
};

export type EstadoContrato = 'sin_contrato' | 'activo' | 'vencido' | 'rescindido';

export type ReprocannInfo = {
    numeroTramite?: string;
    fechaAlta?: string;
    fechaVencimiento?: string;
    estado?: 'pendiente' | 'vigente' | 'vencido' | 'rechazado';
};

export type DocumentacionSocio = {
    consentimiento?: DocumentoSocio;
    declaracionJurada?: DocumentoSocio;
    reprocann?: DocumentoSocio;
    contrato_autocultivo?: DocumentoSocio;
    contrato_madre?: DocumentoSocio;
    contrato?: DocumentoSocio; // Legacy support
    [key: string]: DocumentoSocio | undefined;
};

export interface Socio {
    id: string;
    nombre: string;
    apellido: string;
    dni: string;
    telefono: string;
    fechaNacimiento?: string; // ISO Date
    email: string;
    rol: UserRole;

    // Administrative
    ordenLibro?: number;
    actaNumero?: number;
    debe?: string;
    fechaIngresoOng?: string;
    vinculacion?: string;
    activo?: boolean;
    envios_habilitados?: boolean;
    idempotencyKey?: string;

    // Location
    direccion?: string; // Domicilio
    localidad?: string;
    provincia?: string;

    // Medical / Reprocann
    reprocann?: ReprocannInfo;
    medicoNombre?: string;
    medicoMatricula?: string;
    diagnosticoPrincipal?: string;

    // Docs & Notes
    documentacion?: DocumentacionSocio;
    notas?: string;

    estadoCuenta?: {
        saldo?: number;
        ultimaCuotaPaga?: string; // ISO Date YYYY-MM
    };

    // Auth Link
    // Auth Link
    userId?: string; // Legacy/Migration
    auth_user_id?: string; // New Strict Link

    // Status & Onboarding
    status?: 'draft' | 'ready_to_invite' | 'invited' | 'active' | 'suspended';
    invited_at?: string; // ISO Date
    invited_by?: string; // Staff UUID
    terms_accepted_at?: string; // ISO Date
    terms_version?: string;
    onboarding_completed_at?: string; // ISO Date
    
    // Safety & Compliance
    bloqueado?: boolean;
    motivo_bloqueo?: string;
    
    // Activity
    last_sign_in_at?: string;
}

export interface SocioInvite {
    id: string;
    socioId: string;
    email: string;
    token: string;
    expiresAt: string;
    usedAt?: string;
    createdAt: string;
    createdBy?: string;
}

export interface Producto {
    id: string;
    nombre: string;
    tipo: 'gotero' | 'flor' | 'crema' | 'otro';
    descripcion: string;
    categoria: string; // e.g., 'Indica', 'Sativa', 'Hibrido', 'CBD'
    stockDisponible: number;
    activo: boolean;
    imagen?: string;
    peso_gramos: number; // Peso por unidad (ej. 10 para flores)
    stockReal?: number;
    stockReservado?: number;
    precio?: number;
    ratio?: string;
    concentracion?: string;
}

export interface ProductoWithStockInfo extends Producto {
    stock_disponible: number;
    stock_reservado: number;
    stock_fisico: number;
    pedidos_reservados_count: number;
}

export type OrderStatus = 'pendiente' | 'confirmado' | 'en_preparacion' | 'listo_para_retiro' | 'en_camino' | 'retirado' | 'entregado' | 'cancelado' | 'procesando';
export type OrderType = 'retiro_sede' | 'delivery';

export interface OrderItem {
    productoId: string;
    cantidad: number;
    productoNombre: string; // denormalized for easier display
    nombre?: string; // compatibilidad con fuentes alternativas
    precioUnitario?: number;
    nombreOrigen?: 'original' | 'catalogo' | 'desconocido';
}

export type OrigenPedido = 'app' | 'admin';

export interface Pedido {
    id: string;
    socioId: string;
    tipoPedido: OrderType;
    origen: OrigenPedido; // 'app' | 'admin'
    fechaCreacion: string; // ISO Date
    estado: OrderStatus;
    items: OrderItem[];
    observaciones?: string;

    // Specific to delivery
    direccionEntrega?: string;
    localidad?: string;
    ubicacion_gps?: string;

    // Specific to retiro
    fechaRetiroPreferida?: string;
    franjaHoraria?: string;

    // Delivery schedule
    entrega_estimada?: string;

    // Soft delete/Archive
    archivado?: boolean;
    socio?: Socio;
    created_by_user_id?: string;
    idempotency_key?: string;
    updated_at?: string;
}

export interface PedidosFilterOptions {
    page?: number;
    limit?: number;
    status?: string;
    origen?: string;
    tipoPedido?: string;
    desde?: string;
    hasta?: string;
    search?: string;
    sortBy?: 'created_at' | 'fecha_retiro_preferida' | 'updated_at';
    sortDir?: 'asc' | 'desc';
    includeArchived?: boolean;
}

export interface PaginatedPedidosResult {
    pedidos: Pedido[];
    pagination: {
        page: number;
        limit: number;
        totalCount: number;
        totalPages: number;
        hasMore: boolean;
    };
    counts: {
        all: number;
        active: number;
        en_preparacion: number;
        finalized: number;
        archived: number;
    };
}

export type PagoConcepto = 'aporte_sostenimiento' | 'cuota_social' | 'donacion' | 'otro';

export interface Pago {
    id: string;
    socioId: string;
    fecha: string;
    concepto: string;
    monto: number;
    medioDePago: string;
    pedidoId?: string;
    referencia?: string;
    socio?: Socio;
}

export interface CierreMensual {
    id: string;
    socioId: string;
    periodo: string;
    numeroConstancia: string;
    fechaGeneracion: string;
    generadoPor?: string;
    datos: {
        socio: Socio;
        dispensas: Array<{
            pedidoId: string;
            fecha: string;
            items: OrderItem[];
            operador?: string;
        }>;
        aportes: Array<{
            fecha: string;
            concepto: string;
            medioDePago: string;
            referencia?: string;
            monto: number;
        }>;
        version_pie_legal: number;
        pie_legal: string;
    };
    hashSha256: string;
    estado: 'emitido' | 'anulado';
    fechaAnulacion?: string;
    motivoAnulacion?: string;
    anuladoPor?: string;
}

export type EstadoTicket = 'abierto' | 'pendiente' | 'cerrado';

export interface Notificacion {
    id: string;
    socioId: string;
    remitenteId?: string;
    remitenteNombre?: string;
    socioNombre?: string;
    titulo: string;
    mensaje: string;
    leido: boolean;
    esParaAdmin: boolean;
    tipo: 'general' | 'delivery' | 'order' | 'socio_message' | string;
    metadata?: any;
    fechaCreacion: string;
    
    // Ticketing fields
    parentId?: string;
    estado?: EstadoTicket;
    esInformativo?: boolean;
    asignadoA?: string;
    ocultoParaSocio?: boolean;
}



export * from './chat';
