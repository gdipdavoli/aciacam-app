import { Producto, Pedido, OrderType, OrderItem, Socio, Pago } from '@/types';
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
        onboarding_completed_at: row.onboarding_completed_at
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
    // precio: row.precio // Add to generic type if needed later
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

        let query = supabase.from('products').select('*').order('created_at', { ascending: false });

        if (!includeInactive) {
            query = query.eq('activo', true);
        }

        const { data, error } = await query;

        if (error) {
            // Expanded Error Logging for Safari/Mobile debugging
            console.error('Error fetching products:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
            return [];
        }

        return (data || []).map(mapProductFromDB);
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
        if (order.estado !== 'pendiente') throw new Error("Solo se pueden cancelar pedidos pendientes");

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
            imagen: producto.imagen
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

    updateProduct: async (id: string, updates: Partial<Producto>, actorId: string): Promise<void> => {
        const dbUpdates: any = {};
        if (updates.nombre !== undefined) dbUpdates.nombre = updates.nombre;
        if (updates.tipo !== undefined) dbUpdates.tipo = updates.tipo;
        if (updates.descripcion !== undefined) dbUpdates.descripcion = updates.descripcion;
        if (updates.categoria !== undefined) dbUpdates.categoria = updates.categoria;
        if (updates.stockDisponible !== undefined) dbUpdates.stock_disponible = updates.stockDisponible;
        if (updates.activo !== undefined) dbUpdates.activo = updates.activo;
        if (updates.imagen !== undefined) dbUpdates.imagen = updates.imagen;

        const { error } = await supabase
            .from('products')
            .update(dbUpdates)
            .eq('id', id);

        if (error) throw error;

        await StoreService.createAuditLog(actorId, 'UPDATE', 'PRODUCT', id, dbUpdates);
    },

    deleteProduct: async (id: string, actorId: string): Promise<void> => {
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) throw error;

        await StoreService.createAuditLog(actorId, 'DELETE', 'PRODUCT', id, { deletedId: id });
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
        // Use API Route allows bypass of RLS using Service Key on server
        try {
            const url = role ? `/api/admin/socios?role=${role}` : '/api/admin/socios';
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch socios');
            const data = await res.json();
            return (data || []).map(mapSocioFromDB);
        } catch (e) {
            console.error('StoreService: API Fetch failed, falling back to Client (Restricted by RLS)', e);
            if (!supabase) return MOCK_SOCIOS;

            let query = supabase
                .from('socios')
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
            setTimeout(() => resolve({ source: 'timeout' }), 2500) // Reduced from 8s to 2.5s
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
        if (!supabase) return { aporte_por_gramo: 10000, limite_gramos_max: 40, limite_gramos_min: 10 };
        const { data, error } = await supabase.from('global_configs').select('*');
        if (error) {
            console.error("Error fetching configs:", error);
            return { aporte_por_gramo: 10000, limite_gramos_max: 40, limite_gramos_min: 10 };
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
    }
};
