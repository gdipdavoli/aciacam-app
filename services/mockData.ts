import { Socio, Producto } from '@/types';

export const MOCK_SOCIOS: Socio[] = [
    {
        id: '1',
        nombre: 'Juan',
        apellido: 'Pérez',
        dni: '12345678',
        telefono: '1155556666',
        email: 'juan@example.com',
        rol: 'socio',

        ordenLibro: 10,
        actaNumero: 100,
        fechaIngresoOng: '2024-01-15',
        vinculacion: 'Solidario',
        activo: true,

        direccion: 'Av. Siempre Viva 123',
        localidad: 'CABA',
        provincia: 'Buenos Aires',

        reprocann: {
            numeroTramite: 'REP-12345',
            fechaAlta: '2024-02-01',
            estado: 'vigente'
        },
        medicoNombre: 'Dr. House',
        medicoMatricula: 'MN 9999',
        diagnosticoPrincipal: 'Dolor Crónico',

        documentacion: {
            contrato: { estado: 'completo', fechaEmision: '2024-01-15', fechaVencimiento: '2026-01-15', archivoPath: '100/contrato/contrato_firmado.pdf' },
            consentimiento: { estado: 'completo', fechaEmision: '2024-01-15' },
            declaracionJurada: { estado: 'pendiente' }
        },
        estadoCuenta: {
            saldo: 0,
            ultimaCuotaPaga: '2025-11',
        },
    },
    {
        id: '100',
        nombre: 'Carlos',
        apellido: 'Gomez',
        dni: '22333444',
        telefono: '1199998888',
        email: 'carlos@example.com',
        rol: 'socio',

        vinculacion: 'Particular',
        activo: false,

        direccion: 'Calle Falsa 123',
        localidad: 'La Plata',

        reprocann: {
            estado: 'vencido',
        },

        documentacion: {
            contrato: { estado: 'vencido', fechaEmision: '2022-01-01', fechaVencimiento: '2023-01-01', observaciones: 'Renovar urgente' },

        },
        estadoCuenta: {
            saldo: 0,
            ultimaCuotaPaga: '2025-10',
        },
    },
    {
        id: '2',
        nombre: 'Maria',
        apellido: 'Garcia',
        dni: '87654321',
        telefono: '1144445555',
        email: 'admin@aciacam.com',
        rol: 'admin',
        direccion: 'Sede Central',
        estadoCuenta: {
            saldo: 0,
            ultimaCuotaPaga: '2025-12',
        },
    },
];

export const MOCK_PRODUCTOS: Producto[] = [
    {
        id: 'p1',
        nombre: 'Aceite CBD 10%',
        tipo: 'gotero',
        categoria: 'CBD',
        descripcion: 'Gotero de 10ml con alta concentración de CBD.',
        stockDisponible: 50,
        activo: true,
        peso_gramos: 1,
    },
    {
        id: 'p2',
        nombre: 'Aceite THC 5%',
        tipo: 'gotero',
        categoria: 'THC',
        descripcion: 'Gotero de 10ml, variedad híbrida.',
        stockDisponible: 20,
        activo: true,
        peso_gramos: 1,
    },
    {
        id: 'p3',
        nombre: 'Flores OG Kush',
        tipo: 'flor',
        categoria: 'Indica',
        descripcion: 'Cogollos premium, efecto relajante.',
        stockDisponible: 100, // gramos
        activo: true,
        peso_gramos: 1,
    },
    {
        id: 'p4',
        nombre: 'Flores Lemon Haze',
        tipo: 'flor',
        categoria: 'Sativa',
        descripcion: 'Aroma cítrico, efecto energizante.',
        stockDisponible: 5, // bajo stock
        activo: true,
        peso_gramos: 1,
    },
    {
        id: 'p5',
        nombre: 'Crema Analgésica',
        tipo: 'crema',
        categoria: 'Topico',
        descripcion: 'Para dolores musculares y articulares.',
        stockDisponible: 0,
        activo: true,
        peso_gramos: 1,
    },
];
