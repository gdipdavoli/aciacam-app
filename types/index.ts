export type UserRole = 'member' | 'admin';

export type EstadoDocumento = 'pendiente' | 'completo' | 'vencido' | 'no_aplica';

export type DocumentoSocio = {
    estado: EstadoDocumento;
    fechaEntrega?: string;       // ISO
    fechaVencimiento?: string;   // ISO
    observaciones?: string;
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
    contratoCultivo?: DocumentoSocio;
    recetaMedica?: DocumentoSocio;
    contrato?: DocumentoSocio & { estadoContrato?: EstadoContrato }; // Mantengo por compatibilidad si se usa
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

    // Specific to retiro
    fechaRetiroPreferida?: string;
    franjaHoraria?: string;
}

export interface Pago {
    id: string;
    socioId: string;
    fecha: string;
    concepto: string;
    monto: number;
    medioDePago: string;
}
