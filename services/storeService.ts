import { Producto, Pedido, OrderType, OrderItem, Socio } from '@/types';
import { MOCK_PRODUCTOS, MOCK_SOCIOS } from './mockData';


const STORAGE_KEY_PEDIDOS = 'aciacam_pedidos';
const STORAGE_KEY_SOCIOS = 'aciacam_socios';

// Helper to get socios from storage
const getStoredSocios = (): Socio[] => {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(STORAGE_KEY_SOCIOS);
    if (!stored) {
        // Initialize with default mock data if empty
        if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEY_SOCIOS, JSON.stringify(MOCK_SOCIOS));
        }
        return MOCK_SOCIOS;
    }
    try {
        return JSON.parse(stored);
    } catch (e) {
        console.error('Error parsing socios from storage', e);
        return [];
    }
};

// Helper to save socios to storage
const saveStoredSocios = (socios: Socio[]) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_SOCIOS, JSON.stringify(socios));
    }
};

// Helper to get orders from storage
const getStoredPedidos = (): Pedido[] => {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(STORAGE_KEY_PEDIDOS);
    if (!stored) return [];
    try {
        return JSON.parse(stored);
    } catch (e) {
        console.error('Error parsing orders from storage', e);
        return [];
    }
};

// Helper to save orders to storage
const saveStoredPedidos = (pedidos: Pedido[]) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_PEDIDOS, JSON.stringify(pedidos));
    }
};

// Make mutable for demo products (kept in memory for simplicity as requested per plan focus on Orders)
let MOCK_PRODUCTOS_STORE = [...MOCK_PRODUCTOS];

export const StoreService = {
    getProductos: async (): Promise<Producto[]> => {
        return MOCK_PRODUCTOS_STORE;
    },

    getProductById: async (id: string): Promise<Producto | undefined> => {
        return MOCK_PRODUCTOS_STORE.find(p => p.id === id);
    },

    createPedido: async (
        socioId: string,
        items: OrderItem[],
        tipo: OrderType,
        details: Partial<Pedido>
    ): Promise<Pedido> => {
        const newOrder: Pedido = {
            id: `ord-${Date.now()}`,
            socioId,
            items,
            tipoPedido: tipo,
            origen: details.origen || 'app', // Default to app
            fechaCreacion: new Date().toISOString(),
            estado: 'pendiente',
            ...details
        };

        const currentOrders = getStoredPedidos();
        const updatedOrders = [...currentOrders, newOrder];
        saveStoredPedidos(updatedOrders);

        return newOrder;
    },

    getPedidosBySocio: async (socioId: string): Promise<Pedido[]> => {
        const orders = getStoredPedidos();
        return orders.filter(p => p.socioId === socioId);
    },

    // Payment functions
    getPagosBySocio: async (socioId: string): Promise<any[]> => {
        return [
            { id: 'pay-1', socioId, fecha: '2025-11-05', concepto: 'Cuota Noviembre', monto: 5000, medioDePago: 'Transferencia' },
            { id: 'pay-2', socioId, fecha: '2025-10-05', concepto: 'Cuota Octubre', monto: 5000, medioDePago: 'Efectivo' }
        ];
    },

    // Admin functions
    getAllPedidos: async (): Promise<Pedido[]> => {
        return getStoredPedidos();
    },

    updatePedidoStatus: async (pedidoId: string, status: Pedido['estado']): Promise<void> => {
        const orders = getStoredPedidos();
        const updatedOrders = orders.map(p =>
            p.id === pedidoId ? { ...p, estado: status } : p
        );
        saveStoredPedidos(updatedOrders);
    },

    // Admin Product Management
    addProduct: async (producto: Omit<Producto, 'id'>): Promise<Producto> => {
        const newProduct: Producto = {
            id: `p-${Date.now()}`,
            ...producto
        };
        MOCK_PRODUCTOS_STORE.push(newProduct);
        return newProduct;
    },

    updateProduct: async (id: string, updates: Partial<Producto>): Promise<void> => {
        const index = MOCK_PRODUCTOS_STORE.findIndex(p => p.id === id);
        if (index !== -1) {
            MOCK_PRODUCTOS_STORE[index] = { ...MOCK_PRODUCTOS_STORE[index], ...updates };
        }
    },

    deleteProduct: async (id: string): Promise<void> => {
        MOCK_PRODUCTOS_STORE = MOCK_PRODUCTOS_STORE.filter(p => p.id !== id);
    },

    // User Management helpers
    getAllSocios: async (): Promise<Socio[]> => {
        return getStoredSocios();
    },

    getSocioById: async (id: string): Promise<Socio | undefined> => {
        const socios = getStoredSocios();
        return socios.find(s => s.id === id);
    },

    createSocio: async (socio: Omit<Socio, 'id'>): Promise<Socio> => {
        const newSocio: Socio = {
            id: `soc-${Date.now()}`,
            ...socio
        };
        const socios = getStoredSocios();
        saveStoredSocios([...socios, newSocio]);
        return newSocio;
    },

    updateSocio: async (id: string, updates: Partial<Socio>): Promise<void> => {
        const socios = getStoredSocios();
        const updated = socios.map(s => s.id === id ? { ...s, ...updates } : s);
        saveStoredSocios(updated);
    }
};
