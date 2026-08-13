import { Producto, Pedido, OrderType, OrderItem, Socio, Pago, ProductoWithStockInfo } from '@/types';
import { MOCK_PRODUCTOS, MOCK_SOCIOS } from './mockData';
import { supabase } from './supabaseClient';
import * as DocService from './documentacionService';

const STORAGE_KEY_PEDIDOS = 'aciacam_pedidos';
// const STORAGE_KEY_SOCIOS = 'aciacam_socios'; // No longer used for reading

// Helper to map DB row to Pago type
const mapPagoFromDB = (row: any): Pago => ({
    id: row.id,
    socioId: row.socio_id,
    fecha: row.fecha,
    concepto: row.concepto,
    monto: parseFloat(row.monto),
    medioDePago: row.medio_de_pago
});

// Helper to map DB row to Socio type
const mapSocioFromDB = (row: any): Socio => {
    return {
        id: row.id,
        nombre: row.nombre || '',
        apellido: row.apellido || '',
        dni: row.dni || '',
        telefono: row.telefono || '',
        fechaNacimiento: row.fecha_nacimiento, // DB snake_case to camelCase if needed, but here it might be direct
        email: row.email || '',
        rol: row.rol || 'socio', // Default generic role for imported rows

        // Admin props
        ordenLibro: row.orden_libro,
        actaNumero: row.acta_numero,
        debe: row.debe,
        fechaIngresoOng: row.fecha_ingreso_ong,
        // vinculacion: row.vinculacion, // Field not in diagnosis sample, ignore for now
        activo: true, // Force active for now manually or derived
        envios_habilitados: row.envios_habilitados || false,

        // Location
        localidad: row.localidad,
        direccion: row.domicilio,

        // Reprocann
        reprocann: {
            numeroTramite: row.reprocann_num_tramite,
            fechaAlta: row.reprocann_fecha_alta,
            estado: row.reprocann_estado || 'pendiente',
        },
        medicoNombre: row.medico_nombre,
        medicoMatricula: row.medico_matricula,
        diagnosticoPrincipal: row.diagnostico,

        // Documentacion (Construct from joined fields if they exist)
        documentacion: (() => {
            const docs: any = {
                contrato: {
                    estado: row.contrato_estado || 'pendiente',
                    monto: row.contrato_valor,
                }
            };
            
            if (row.documentos && Array.isArray(row.documentos)) {
                row.documentos.forEach((d: any) => {
                    // Normalize tipo string (lower case, replace spaces/dashes with underscore)
                    const normalizedTipo = String(d.tipo || '').toLowerCase()
                        .trim()
                        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
                        .replace(/[\s-]/g, '_');
                    
                    const key = normalizedTipo === 'declaracion_jurada' ? 'declaracionJurada' : normalizedTipo;
                    
                    // Map verification state to legacy 'estado' for the DocumentStatusBadge
                    let estado = d.estado || (d.archivo_path ? 'completo' : 'pendiente');
                    if (d.verificacion_estado === 'aprobado') estado = 'completo';
                    else if (d.verificacion_estado === 'rechazado') estado = 'rechazado';
                    else if (d.verificacion_estado === 'en_revision') estado = 'en_revision';
                    else if (d.archivo_path && d.verificacion_estado === 'pendiente') estado = 'en_revision';

                    docs[key] = {
                        estado,
                        archivoPath: d.archivo_path,
                        verificacion_estado: d.verificacion_estado
                    };
                });
            }
            return docs;
        })(),

        estadoCuenta: {
            saldo: 0,
            ultimaCuotaPaga: new Date().toISOString()
        },

        // Status & Auth
        auth_user_id: row.auth_user_id,
        status: row.status || 'draft',
        invited_at: row.invited_at,
        terms_accepted_at: row.terms_accepted_at,
        terms_version: row.terms_version,
        onboarding_completed_at: row.onboarding_completed_at,
        bloqueado: row.bloqueado,
        motivo_bloqueo: row.motivo_bloqueo,
        last_sign_in_at: row.last_sign_in_at
    };
};

// Start of StoreService Object
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

// Make mutable for demo products
let MOCK_PRODUCTOS_STORE = [...MOCK_PRODUCTOS];

// Helper to map DB Product
const mapProductFromDB = (row: any): Producto => ({
    id: row.id,
    nombre: row.nombre,
    tipo: row.tipo,
    descripcion: row.descripcion,
    categoria: row.categoria,
    stockDisponible: row.stock_disponible,
    activo: row.activo,
    imagen: row.imagen,
    peso_gramos: row.peso_gramos || 1 // Fallback to 1 if not set
});

// Helper to map DB Order
const mapPedidoFromDB = (row: any): Pedido => ({
    id: row.id,
    socioId: row.socio_id,
    tipoPedido: row.tipo_pedido,
    origen: row.origen,
    fechaCreacion: row.created_at,
    estado: row.estado,
    items: row.items, // JSONB auto-parsed
    observaciones: row.observaciones,
    direccionEntrega: row.direccion_entrega,
    localidad: row.localidad,
    ubicacion_gps: row.ubicacion_gps,
    fechaRetiroPreferida: row.fecha_retiro_preferida,
    franjaHoraria: row.franja_horaria,
    entrega_estimada: row.entrega_estimada,
    archivado: row.archivado
});

export const StoreService = {
    getProductos: async (includeInactive = false): Promise<Producto[]> => {
        if (!supabase) return [];

        // 1. Fetch Products
        let query = supabase.from('products').select('*').order('created_at', { ascending: false });
        if (!includeInactive) {
            query = query.eq('activo', true);
        }
        const { data: productsData, error: prodError } = await query;
        if (prodError) {
            console.error('Error fetching products:', prodError);
            return [];
        }

        // 2. Fetch Pending/Preparing orders to calculate "Committed Stock"
        // We only care about orders that are NOT yet delivered, picked up, or cancelled.
        const { data: pendingOrders, error: orderError } = await supabase
            .from('pedidos')
            .select('items')
            .not('estado', 'in', '("entregado","retirado","cancelado")');

        if (orderError) {
            console.error('Error fetching pending orders for stock calc:', orderError);
            // Fallback to raw stock if orders fetch fails
            return (productsData || []).map(mapProductFromDB);
        }

        // 3. Aggregate committed stock per product
        const committedStockMap: Record<string, number> = {};
        pendingOrders?.forEach((order: any) => {
            const items = order.items as any[];
            if (Array.isArray(items)) {
                items.forEach(item => {
                    const id = item.productoId;
                    const qty = item.cantidad || 0;
                    committedStockMap[id] = (committedStockMap[id] || 0) + qty;
                });
            }
        });

        // 4. Map
        return (productsData || []).map(row => {
            const product = mapProductFromDB(row);
            const committed = committedStockMap[product.id] || 0;
            product.stockReal = row.stock_disponible + committed; // Physical stock in warehouse
            product.stockReservado = committed; // Reserved stock
            product.stockDisponible = row.stock_disponible; // Net available stock (trigger already deducted active ones)
            return product;
        });
    },

    getVariedadesWithStockInfo: async (): Promise<ProductoWithStockInfo[]> => {
        if (!supabase) return [];

        // 1. Fetch Products
        const { data: productsData, error: prodError } = await supabase
            .from('products')
            .select('*')
            .order('nombre', { ascending: true });

        if (prodError) {
            console.error('Error fetching products for stock info:', prodError);
            throw prodError;
        }

        // 2. Fetch all orders with state 'pendiente' or 'en_preparacion'
        const { data: activeOrders, error: orderError } = await supabase
            .from('pedidos')
            .select('items')
            .in('estado', ['pendiente', 'en_preparacion']);

        if (orderError) {
            console.error('Error fetching active orders for stock info:', orderError);
            throw orderError;
        }

        // 3. Aggregate reserved stock and count of orders
        const reservedStockMap: Record<string, number> = {};
        const countMap: Record<string, number> = {};

        activeOrders?.forEach((order: any) => {
            const items = order.items as any[];
            if (Array.isArray(items)) {
                items.forEach(item => {
                    const id = item.productoId;
                    const qty = parseInt(item.cantidad) || 0;
                    if (id) {
                        reservedStockMap[id] = (reservedStockMap[id] || 0) + qty;
                        countMap[id] = (countMap[id] || 0) + 1;
                    }
                });
            }
        });

        // 4. Map to ProductoWithStockInfo
        return (productsData || []).map(row => {
            const prod = mapProductFromDB(row);
            const stock_reservado = reservedStockMap[prod.id] || 0;
            const stock_disponible = row.stock_disponible || 0;
            const stock_fisico = stock_disponible + stock_reservado;
            const pedidos_reservados_count = countMap[prod.id] || 0;

            return {
                ...prod,
                stock_disponible,
                stock_reservado,
                stock_fisico,
                pedidos_reservados_count
            };
        });
    },

    getProductById: async (id: string): Promise<Producto | undefined> => {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !data) return undefined;
        return mapProductFromDB(data);
    },

    // ... Pedido methods ...



    // ... Pedido methods ...

    createPedido: async (
        socioId: string,
        items: OrderItem[],
        tipo: OrderType,
        details: Partial<Pedido> & { slotId?: string }
    ): Promise<Pedido> => {
        if (!supabase) throw new Error("Supabase client not initialized");

        console.log("Creating Pedido Payload:", { socioId, items, tipo, details });

        // --- PRE-FLIGHT CHECKS (DEBUGGING 400 ERROR) ---

        // 1. Check Socio (Optional Debug Check - Modified to be less brittle)
        const { data: socioCheck, error: socioError } = await supabase
            .from('socios')
            .select('id')
            .eq('id', socioId)
            .maybeSingle(); // Use maybeSingle to avoid 406 on 0 rows

        if (socioError) {
            console.error("DEBUG: Socio ID Check Error:", socioError);
            // We don't throw here to let the INSERT attempt proceed (it will fail with RLS if truly forbidden)
        } else if (!socioCheck) {
            console.warn("DEBUG: Socio ID not found via client RLS:", socioId);
            // throw new Error(`DEBUG: Socio no encontrado en DB (${socioId})`);
        }

        // 2. Check Slot (if required)
        if (details.slotId) {
            const { data: slotCheck, error: slotError } = await supabase
                .from('pickup_slots')
                .select('id')
                .eq('id', details.slotId)
                .maybeSingle();

            if (slotError || !slotCheck) {
                console.error("DEBUG: Slot ID Invalid or Not Found:", details.slotId);
            }
        }

        // ----------------------------------------------

        const dbRow = {
            socio_id: socioId,
            items: items,
            tipo_pedido: tipo,
            origen: details.origen || 'app',
            estado: 'pendiente',
            observaciones: details.observaciones,
            direccion_entrega: details.direccionEntrega,
            localidad: details.localidad,
            ubicacion_gps: details.ubicacion_gps,
            fecha_retiro_preferida: details.fechaRetiroPreferida,
            franja_horaria: details.franjaHoraria,
            entrega_estimada: details.entrega_estimada,
            slot_id: details.slotId
        };

        console.log("Sending to Supabase 'pedidos':", dbRow);

        const { data, error } = await supabase
            .from('pedidos')
            .insert(dbRow)
            .select()
            .single();

        if (error) {
            console.error("StoreService: Create Order Failed", error);
            // Log full error details
            console.error("Full Error Details:", JSON.stringify(error, null, 2));
            throw error;
        }

        return mapPedidoFromDB(data);
    },

    getPedidosBySocio: async (socioId: string): Promise<Pedido[]> => {
        if (!supabase) return [];

        const { data, error } = await supabase
            .from('pedidos')
            .select('*')
            .eq('socio_id', socioId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error("StoreService: Get Pedidos Failed", error.message || error);
            return [];
        }

        return (data || []).map(mapPedidoFromDB);
    },

    getPagosBySocio: async (socioId: string): Promise<Pago[]> => {
        if (!supabase) return [];

        const { data, error } = await supabase
            .from('pagos')
            .select('*')
            .eq('socio_id', socioId)
            .order('fecha', { ascending: false });

        if (error) {
            console.error("StoreService: Get Pagos Failed", error.message || error);
            return [];
        }

        return (data || []).map(mapPagoFromDB);
    },

    getAllPagos: async (): Promise<Pago[]> => {
        if (!supabase) return [];

        const { data, error } = await supabase
            .from('pagos')
            .select('*')
            .order('fecha', { ascending: false });

        if (error) {
            console.error("StoreService: Get All Pagos Failed", error.message || error);
            return [];
        }

        return (data || []).map(mapPagoFromDB);
    },

    createPago: async (pago: Omit<Pago, 'id'>, actorId: string): Promise<Pago> => {
        if (!supabase) throw new Error("Supabase client not initialized");

        const dbRow = {
            socio_id: pago.socioId,
            fecha: pago.fecha,
            concepto: pago.concepto,
            monto: pago.monto,
            medio_de_pago: pago.medioDePago,
            created_by: actorId
        };

        const { data, error } = await supabase
            .from('pagos')
            .insert(dbRow)
            .select()
            .single();

        if (error) {
            console.error("StoreService: Create Pago Failed", error);
            throw error;
        }

        await StoreService.createAuditLog(actorId, 'CREATE', 'PAYMENT', data.id, dbRow);

        return mapPagoFromDB(data);
    },

    getAllPedidos: async (includeArchived = false): Promise<Pedido[]> => {
        if (!supabase) return [];

        let query = supabase
            .from('pedidos')
            .select('*')
            .order('created_at', { ascending: false });

        if (!includeArchived) {
            query = query.or('archivado.is.null,archivado.eq.false');
        }

        const { data, error } = await query;

        if (error) {
            console.error("StoreService: GetAllPedidos Failed", error);
            return [];
        }

        return (data || []).map(mapPedidoFromDB);
    },

    updatePedidoStatus: async (pedidoId: string, status: Pedido['estado']): Promise<void> => {
        if (!supabase) return;

        // If status is "Entregado", use RPC to deduct stock safely
        if (status === 'entregado') {
            const { data, error } = await supabase.rpc('confirm_order_delivery', {
                p_order_id: pedidoId
            });

            if (error) {
                console.error("StoreService: RPC Delivery Failed", error);
                throw error;
            }

            // The RPC returns { success: boolean, error?: string }
            if (data && !data.success) {
                throw new Error(data.error || 'Error al confirmar entrega y stock');
            }

            return;
        }

        // Standard update for other statuses
        const { error } = await supabase
            .from('pedidos')
            .update({ estado: status })
            .eq('id', pedidoId);

        if (error) throw error;
    },

    updatePedidoItems: async (pedidoId: string, items: OrderItem[]): Promise<void> => {
        if (!supabase) return;

        const { error } = await supabase
            .from('pedidos')
            .update({ items: items }) // JSONB Update
            .eq('id', pedidoId);

        if (error) throw error;
    },

    updatePedidoDelivery: async (pedidoId: string, deliveryInfo: { entrega_estimada?: string }): Promise<void> => {
        if (!supabase) return;

        const { error } = await supabase
            .from('pedidos')
            .update(deliveryInfo)
            .eq('id', pedidoId);

        if (error) throw error;
    },

    cancelOrderSocio: async (pedidoId: string, socioId: string): Promise<void> => {
        if (!supabase) return;

        // 1. Check if allowed (Must be own order and 'pendiente')
        const { data: order, error: fetchError } = await supabase
            .from('pedidos')
            .select('estado, socio_id')
            .eq('id', pedidoId)
            .single();

        if (fetchError || !order) throw new Error("Pedido no encontrado");
        if (order.socio_id !== socioId) throw new Error("No autorizado");
        if (order.estado !== 'pendiente' && order.estado !== 'procesando') {
            throw new Error("Solo se pueden cancelar pedidos pendientes o en proceso");
        }

        // 2. Update
        const { error } = await supabase
            .from('pedidos')
            .update({ estado: 'cancelado' })
            .eq('id', pedidoId);

        if (error) throw error;
    },

    archiveFinishedOrders: async (): Promise<void> => {
        if (!supabase) return;

        // Archive: Entregado, Retirado, Cancelado
        const statusesToArchive = ['entregado', 'retirado', 'cancelado'];

        console.log("StoreService: Attempting to archive orders with status:", statusesToArchive);

        const { data, error, count } = await supabase
            .from('pedidos')
            .update({ archivado: true })
            .in('estado', statusesToArchive)
            .select();

        if (error) {
            console.error("StoreService: Archive Failed", error);
            throw error;
        }

        console.log(`StoreService: Archived ${data?.length} orders.`);
    },

    addProduct: async (producto: Omit<Producto, 'id'>, actorId: string): Promise<Producto> => {
        const dbRow = {
            nombre: producto.nombre,
            tipo: producto.tipo,
            descripcion: producto.descripcion,
            categoria: producto.categoria,
            stock_disponible: producto.stockDisponible,
            activo: producto.activo !== undefined ? producto.activo : true,
            imagen: producto.imagen,
            peso_gramos: producto.peso_gramos || 10
        };

        const { data, error } = await supabase
            .from('products')
            .insert(dbRow)
            .select()
            .single();

        if (error) throw error;

        await StoreService.createAuditLog(actorId, 'CREATE', 'PRODUCT', data.id, dbRow);

        return mapProductFromDB(data);
    },

    updateProduct: async (id: string, updates: Partial<Producto> & { last_audit_note?: string }, actorId: string): Promise<void> => {
        const dbUpdates: any = {};
        if (updates.nombre !== undefined) dbUpdates.nombre = updates.nombre;
        if (updates.tipo !== undefined) dbUpdates.tipo = updates.tipo;
        if (updates.descripcion !== undefined) dbUpdates.descripcion = updates.descripcion;
        if (updates.categoria !== undefined) dbUpdates.categoria = updates.categoria;
        if (updates.stockDisponible !== undefined) dbUpdates.stock_disponible = updates.stockDisponible;
        if (updates.activo !== undefined) dbUpdates.activo = updates.activo;
        if (updates.imagen !== undefined) dbUpdates.imagen = updates.imagen;
        if (updates.peso_gramos !== undefined) dbUpdates.peso_gramos = updates.peso_gramos;
        if (updates.last_audit_note !== undefined) dbUpdates.last_audit_note = updates.last_audit_note;

        // Clear last_audit_order_id on manual updates to prevent carrying over previous order associations
        dbUpdates.last_audit_order_id = null;

        const { error } = await supabase
            .from('products')
            .update(dbUpdates)
            .eq('id', id);

        if (error) throw error;
    },

    deleteProduct: async (id: string, actorId: string): Promise<void> => {
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) throw error;
    },

    createAuditLog: async (actorId: string, action: string, entityType: string, entityId: string, details: any) => {
        try {
            await supabase.from('audit_logs').insert({
                user_id: actorId,
                action,
                entity_type: entityType,
                entity_id: entityId,
                details
            });
        } catch (e) {
            console.error('Failed to create audit log', e);
            // Don't block main flow if audit fails, but log it critical
        }
    },

    // --- SOCIOS: NOW USING SUPABASE ---

    getAllSocios: async (role?: string): Promise<Socio[]> => {
        try {
            if (!supabase) throw new Error("Supabase client not initialized");
            const { data: { session } } = await supabase.auth.getSession();
            const headers: Record<string, string> = {};
            if (session?.access_token) {
                headers['Authorization'] = `Bearer ${session.access_token}`;
            }

            const url = role ? `/api/admin/socios?role=${role}` : '/api/admin/socios';
            const res = await fetch(url, { headers });
            if (!res.ok) throw new Error('Failed to fetch socios');
            const data = await res.json();
            return (data || []).map(mapSocioFromDB);
        } catch (e) {
            console.error('StoreService: API Fetch failed, falling back to Client (Restricted by RLS)', e);
            if (!supabase) return MOCK_SOCIOS;

            let query = supabase
                .from('socios_with_auth')
                .select('*')
                .order('created_at', { ascending: false });

            if (role) {
                query = query.eq('rol', role);
            }

            const { data, error } = await query;

            if (error) return [];
            return (data || []).map(mapSocioFromDB);
        }
    },

    getSocioById: async (id: string): Promise<Socio | undefined> => {
        // Try API first (Admin access bypass)
        try {
            const res = await fetch(`/api/admin/socios/${id}`);
            if (res.ok) {
                const data = await res.json();
                const docs = await StoreService.getDocumentosBySocio(data.id);
                return mapSocioFromDB({ ...data, documentos: docs });
            }
        } catch (e) {
            console.log("StoreService: API Fetch failed for detail", e);
        }

        if (!supabase) return MOCK_SOCIOS.find(s => s.id === id);

        // Fallback to Client (RLS restricted)
        const { data, error } = await supabase
            .from('socios')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !data) {
            console.log('Socio not found in DB', id);
            return undefined;
        }

        // Fetch documents separately to be robust against schema cache errors
        const docs = await StoreService.getDocumentosBySocio(data.id);
        const mergedData = { ...data, documentos: docs };

        return mapSocioFromDB(mergedData);
    },

    getSocioByUserId: async (userId: string): Promise<Socio | undefined> => {
        if (!supabase) return undefined;

        // 1. Race Client Logic vs Quick Timeout
        // Logic: If Client RLS (Supabase) takes > 2.5s, it's likely a network or deadlock issue.
        // We immediately fall back to the API (Service Role) which uses standard fetch and won't hang.

        let clientResult: any = null;
        let usedFallback = false;

        const clientPromise = (async () => {
            try {
                const res = await supabase
                    .from('socios')
                    .select('*')
                    .or(`auth_user_id.eq.${userId},user_id.eq.${userId}`)
                    .maybeSingle();

                if (res.data) {
                    const { data: docs } = await supabase
                        .from('documentos_socio')
                        .select('*')
                        .eq('socio_id', res.data.id);
                    return { ...res, data: { ...res.data, documentos: docs || [] }, source: 'client' };
                }
                return { source: 'client', ...res };
            } catch (err) {
                return { source: 'client_error', error: err };
            }
        })();

        const timeoutPromise = new Promise<{ source: 'timeout' }>((resolve) =>
            setTimeout(() => resolve({ source: 'timeout' }), 1500)
        );

        console.time("getSocioRace");
        const winner: any = await Promise.race([clientPromise, timeoutPromise]);
        console.timeEnd("getSocioRace");

        if (winner.source === 'client') {
            const { data, error } = winner;
            if (data) {
                console.log(`StoreService: Socio found via Client RLS [${data.id}]`);
                return mapSocioFromDB(data);
            } else if (error) {
                console.warn(`StoreService: Client query error: ${error.message}.`);
                usedFallback = true;
            } else {
                // Null data (not found)
                console.log("StoreService: Client returned null. Verifying with API.");
                usedFallback = true;
            }
        } else if (winner.source === 'client_error') {
            console.error("StoreService: Client query failed immediately.", winner.error);
            usedFallback = true;
        } else {
            console.warn("StoreService: Client Query too slow (>2.5s). Switching to API Fallback.");
            usedFallback = true;
        }

        if (usedFallback) {
            try {
                console.time("getSocioByUserId-API");
                const res = await fetch(`/api/admin/socios/by-user?id=${userId}`, {
                    cache: 'no-store',
                    headers: { 'Cache-Control': 'no-cache' }
                });
                console.timeEnd("getSocioByUserId-API");

                if (res.ok) {
                    const data = await res.json();
                    if (data) {
                        console.log(`StoreService: Socio found via API Fallback [${data.id}]`);
                        // Documents are joined in API or fetched here
                        const docs = await StoreService.getDocumentosBySocio(data.id);
                        return mapSocioFromDB({ ...data, documentos: docs });
                    }
                } else if (res.status === 404) {
                    console.log("StoreService: API confirmed no socio linked.");
                    return undefined;
                } else {
                    console.log("StoreService: API returned error status", res.status);
                }
            } catch (e) {
                console.error("StoreService: API Fetch Fallback failed", e);
            }
        }

        return undefined;
    },
    
    getSocios: async (): Promise<Socio[]> => {
        if (!supabase) return [];
        const { data, error } = await supabase
            .from('socios')
            .select('*')
            .eq('status', 'active')
            .order('apellido', { ascending: true });

        if (error) throw error;
        return (data || []).map(mapSocioFromDB);
    },


    getSocioByEmail: async (email: string): Promise<Socio | undefined> => {
        if (!supabase) return MOCK_SOCIOS.find(s => s.email === email);

        const { data, error } = await supabase
            .from('socios')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !data) return undefined;
        return mapSocioFromDB(data);
    },

    createSocio: async (socio: Omit<Socio, 'id'>): Promise<Socio> => {
        if (!supabase) {
            console.warn('Supabase not configured, using mock');
            return { id: 'mock-id', ...socio } as Socio;
        }

        const dbRow = {
            nombre: socio.nombre,
            apellido: socio.apellido,
            dni: socio.dni,
            email: socio.email,
            telefono: socio.telefono,
            rol: socio.rol || 'socio' // Add role persistence
        };

        const { data, error } = await supabase
            .from('socios')
            .insert(dbRow)
            .select()
            .single();

        if (error) {
            console.error('Error creating socio:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
            throw error;
        }
        return mapSocioFromDB(data);
    },

    updateSocio: async (id: string, updates: Partial<Socio>): Promise<void> => {
        if (!supabase) return;

        const dbUpdates: any = {};
        if (updates.nombre !== undefined) dbUpdates.nombre = updates.nombre;
        if (updates.apellido !== undefined) dbUpdates.apellido = updates.apellido;
        if (updates.dni !== undefined) dbUpdates.dni = updates.dni;
        if (updates.telefono !== undefined) dbUpdates.telefono = updates.telefono;
        if (updates.email !== undefined) dbUpdates.email = updates.email;
        if (updates.localidad !== undefined) dbUpdates.localidad = updates.localidad;
        if (updates.direccion !== undefined) dbUpdates.domicilio = updates.direccion;
        if (updates.fechaNacimiento !== undefined) dbUpdates.fecha_nacimiento = updates.fechaNacimiento;

        // Admin
        if (updates.ordenLibro !== undefined) dbUpdates.orden_libro = updates.ordenLibro;
        if (updates.actaNumero !== undefined) dbUpdates.acta_numero = updates.actaNumero;
        if (updates.fechaIngresoOng !== undefined) dbUpdates.fecha_ingreso_ong = updates.fechaIngresoOng;
        if (updates.envios_habilitados !== undefined) dbUpdates.envios_habilitados = updates.envios_habilitados;
        if (updates.status !== undefined) dbUpdates.status = updates.status;
        if (updates.rol !== undefined) dbUpdates.rol = updates.rol;
        if (updates.bloqueado !== undefined) dbUpdates.bloqueado = updates.bloqueado;
        if (updates.motivo_bloqueo !== undefined) dbUpdates.motivo_bloqueo = updates.motivo_bloqueo;

        // Reprocann
        if (updates.reprocann) {
            if (updates.reprocann.numeroTramite !== undefined) dbUpdates.reprocann_num_tramite = updates.reprocann.numeroTramite;
            if (updates.reprocann.fechaAlta !== undefined) dbUpdates.reprocann_fecha_alta = updates.reprocann.fechaAlta;
            if (updates.reprocann.estado !== undefined) dbUpdates.reprocann_estado = updates.reprocann.estado;
        }

        // Medical
        if (updates.medicoNombre !== undefined) dbUpdates.medico_nombre = updates.medicoNombre;
        if (updates.medicoMatricula !== undefined) dbUpdates.medico_matricula = updates.medicoMatricula;
        if (updates.diagnosticoPrincipal !== undefined) dbUpdates.diagnostico = updates.diagnosticoPrincipal;

        if (Object.keys(dbUpdates).length > 0) {
            const { error } = await supabase.from('socios').update(dbUpdates).eq('id', id);
            if (error) {
              console.error("StoreService.updateSocio error:", error);
              throw error;
            }
        }
    },

    // --- DOCUMENTACION: DELEGATED TO DocService ---
    getDocumentosBySocio: DocService.getDocumentosBySocio,
    getDocumentoByTipo: DocService.getDocumentoByTipo,
    upsertDocumentoSocio: DocService.upsertDocumentoSocio,
    verificarDocumento: DocService.verificarDocumento,
    uploadDocumento: DocService.uploadDocumento,
    getUrlDocumento: DocService.getUrlDocumento,
    registrarRecordatorioEnviado: DocService.registrarRecordatorioEnviado,
    getEstadoDocumentacionTodos: DocService.getEstadoDocumentacionTodos,
    getSociosConDocsPendientes: DocService.getSociosConDocsPendientes,
    getSociosReprocannPorVencer: DocService.getSociosReprocannPorVencer,

    // --- SLOTS (AGENDA) ---
    getSlots: async (startDate?: string): Promise<any[]> => {
        if (!supabase) return [];
        let query = supabase.from('pickup_slots').select('*').order('start_time', { ascending: true });
        
        if (startDate) {
            const startOfDate = new Date(`${startDate}T00:00:00`).toISOString();
            query = query.gte('start_time', startOfDate);
        }

        const { data, error } = await query;
        if (error) throw error;
        
        return (data || []).map(slot => {
            const startObj = new Date(slot.start_time);
            const endObj = new Date(slot.end_time);
            return {
                ...slot,
                date: startObj.toLocaleDateString('en-CA'), // Formato YYYY-MM-DD para el UI
                start_time: startObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                end_time: endObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
            };
        });
    },

    deleteSlot: async (id: string): Promise<void> => {
        if (!supabase) return;
        const { error } = await supabase.from('pickup_slots').delete().eq('id', id);
        if (error) throw error;
    },

    createMassiveSlots: async (dates: string[], startTime: string, endTime: string, intervalMinutes: number): Promise<void> => {
        if (!supabase) return;
        
        const slotsToInsert: any[] = [];
        
        dates.forEach(date => {
            let current = new Date(`${date}T${startTime}`);
            const end = new Date(`${date}T${endTime}`);
            
            while (current < end) {
                const startStr = current.toISOString();
                current.setMinutes(current.getMinutes() + intervalMinutes);
                const endStr = current.toISOString();
                
                if (current <= end) {
                    slotsToInsert.push({
                        start_time: startStr,
                        end_time: endStr,
                        capacity: 1 // Default capacity
                    });
                }
            }
        });

        if (slotsToInsert.length > 0) {
            const { error } = await supabase.from('pickup_slots').insert(slotsToInsert);
            if (error) throw error;
        }
    },

    inviteSocio: async (socioId: string): Promise<any> => {
        // Retrieve Token using Supabase Client (Auth Context)
        if (!supabase) throw new Error("Supabase client not initialized");
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("No active session");

        const res = await fetch('/api/admin/invite', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                socioId,
                redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to invite');
        return data;
    }
    ,

    bulkInviteSocios: async (socioIds: string[]): Promise<any> => {
        if (!supabase) throw new Error("Supabase client not initialized");
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("No active session");

        const res = await fetch('/api/admin/invite/bulk', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                socioIds,
                redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to bulk invite');
        return data;
    },

    getGlobalConfigs: async (): Promise<Record<string, any>> => {
        if (!supabase) return { aporte_por_gramo: 10000, limite_gramos_max: 40, limite_gramos_min: 5 };
        const { data, error } = await supabase.from('global_configs').select('*');
        if (error) {
            console.error("Error fetching configs:", error);
            return { aporte_por_gramo: 10000, limite_gramos_max: 40, limite_gramos_min: 5 };
        }
        const configs: Record<string, any> = {};
        data.forEach(row => {
            configs[row.key] = row.value;
        });
        return configs;
    },

    updateGlobalConfig: async (key: string, value: any): Promise<void> => {
        if (!supabase) return;
        const { error } = await supabase
            .from('global_configs')
            .upsert({ key, value, updated_at: new Date().toISOString() });
        if (error) throw error;
    },

    getProductAuditLogs: async (): Promise<any[]> => {
        if (!supabase) return [];
        const { data, error } = await supabase
            .from('audit_logs')
            .select(`
                id,
                actor_socio_id,
                action,
                entity_type,
                entity_id,
                details,
                created_at,
                actor:socios!actor_socio_id(nombre, apellido)
            `)
            .eq('entity_type', 'PRODUCT')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("StoreService: getProductAuditLogs failed", error);
            return [];
        }
        return data || [];
    },

    getStatsData: async (startDate?: string, endDate?: string) => {
        if (!supabase) throw new Error("Supabase client not initialized");
        
        let queryPedidos = supabase.from('pedidos').select('*');
        let queryPagos = supabase.from('pagos').select('*');

        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            const rangeDuration = end.getTime() - start.getTime();
            const prevStartDate = new Date(start.getTime() - rangeDuration);
            const prevStartStr = prevStartDate.toISOString().split('T')[0];
            
            queryPedidos = queryPedidos
                .gte('created_at', prevStartStr)
                .lte('created_at', endDate + 'T23:59:59.999Z');
            queryPagos = queryPagos
                .gte('fecha', prevStartStr)
                .lte('fecha', endDate + 'T23:59:59.999Z');
        }

        // Fetch everything needed for stats
        const [
            { data: pedidos, error: errP },
            { data: socios, error: errS },
            { data: productos, error: errProd },
            { data: pagos, error: errPag }
        ] = await Promise.all([
            queryPedidos,
            supabase.from('socios').select('*'),
            supabase.from('products').select('*'),
            queryPagos
        ]);

        if (errP || errS || errProd || errPag) {
            console.error("Error fetching stats data:", { errP, errS, errProd, errPag });
            throw new Error("Error al obtener datos para estadísticas");
        }

        return {
            pedidos: pedidos.map(mapPedidoFromDB),
            socios,
            productos: productos.map(mapProductFromDB),
            pagos
        };
    }
};
