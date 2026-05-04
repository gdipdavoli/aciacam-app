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

    estadoCuenta: {
        saldo: number;
        ultimaCuotaPaga: string; // ISO Date YYYY-MM
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
}

export type OrderStatus = 'pendiente' | 'confirmado' | 'en_preparacion' | 'en_camino' | 'retirado' | 'entregado' | 'cancelado';
export type OrderType = 'retiro_sede' | 'delivery';

export interface OrderItem {
    productoId: string;
    cantidad: number;
    productoNombre: string; // denormalized for easier display
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
}

export interface Pago {
    id: string;
    socioId: string;
    fecha: string;
    concepto: string;
    monto: number;
    medioDePago: string;
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


