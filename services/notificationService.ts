import { supabase } from './supabaseClient';
import { Notificacion } from '@/types';

export const NotificationService = {
    /**
     * Get all notifications (Socio or Admin Inbox)
     */
    getNotifications: async (params: { socioId?: string, isAdminInbox?: boolean }): Promise<Notificacion[]> => {
        if (!supabase) return [];

        let query = supabase.from('notificaciones').select(`
            *,
            remitente:socios!remitente_id (nombre, apellido),
            socio:socios!socio_id (nombre, apellido)
        `);

        if (params.isAdminInbox) {
            query = query.eq('es_para_admin', true);
        } else if (params.socioId) {
            query = query.eq('socio_id', params.socioId).eq('oculto_para_socio', false);
        }

        const { data, error } = await query.order('fecha_creacion', { ascending: false });

        if (error) throw error;

        return (data || []).map(row => ({
            id: row.id,
            socioId: row.socio_id,
            remitenteId: row.remitente_id,
            remitenteNombre: row.remitente ? `${row.remitente.nombre} ${row.remitente.apellido}` : undefined,
            socioNombre: row.socio ? `${row.socio.nombre} ${row.socio.apellido}` : undefined,
            titulo: row.titulo,
            mensaje: row.mensaje,
            leido: row.leido,
            tipo: row.tipo,
            esParaAdmin: row.es_para_admin,
            metadata: row.metadata,
            fechaCreacion: row.fecha_creacion,
            // New ticketing fields mapping
            parentId: row.parent_id,
            estado: row.estado,
            esInformativo: row.es_informativo,
            asignadoA: row.asignado_a,
            ocultoParaSocio: row.oculto_para_socio
        }));
    },

    /**
     * Get unique cases (Tickets) for administration
     */
    getTickets: async (filters?: { estado?: string }): Promise<Notificacion[]> => {
        if (!supabase) return [];

        let query = supabase
            .from('notificaciones')
            .select(`
                *,
                remitente:socios!remitente_id (nombre, apellido),
                socio:socios!socio_id (nombre, apellido)
            `)
            .is('parent_id', null)
            .eq('es_informativo', false);

        if (filters?.estado) {
            query = query.eq('estado', filters.estado);
        }

        const { data, error } = await query.order('fecha_creacion', { ascending: false });
        if (error) throw error;

        return (data || []).map(row => ({
            id: row.id,
            socioId: row.socio_id,
            remitenteId: row.remitente_id,
            remitenteNombre: row.remitente ? `${row.remitente.nombre} ${row.remitente.apellido}` : undefined,
            socioNombre: row.socio ? `${row.socio.nombre} ${row.socio.apellido}` : undefined,
            titulo: row.titulo,
            mensaje: row.mensaje,
            leido: row.leido,
            tipo: row.tipo,
            esParaAdmin: row.es_para_admin,
            metadata: row.metadata,
            fechaCreacion: row.fecha_creacion,
            parentId: row.parent_id,
            estado: row.estado,
            esInformativo: row.es_informativo,
            asignadoA: row.asignado_a,
            ocultoParaSocio: row.oculto_para_socio
        }));
    },

    /**
     * Get all messages in a specific thread
     */
    getThread: async (parentId: string): Promise<Notificacion[]> => {
        if (!supabase) return [];

        const { data, error } = await supabase
            .from('notificaciones')
            .select(`
                *,
                remitente:socios!remitente_id (nombre, apellido),
                socio:socios!socio_id (nombre, apellido)
            `)
            .or(`id.eq.${parentId},parent_id.eq.${parentId}`)
            .order('fecha_creacion', { ascending: true });

        if (error) throw error;

        return (data || []).map(row => ({
            id: row.id,
            socioId: row.socio_id,
            remitenteId: row.remitente_id,
            remitenteNombre: row.remitente ? `${row.remitente.nombre} ${row.remitente.apellido}` : undefined,
            socioNombre: row.socio ? `${row.socio.nombre} ${row.socio.apellido}` : undefined,
            titulo: row.titulo,
            mensaje: row.mensaje,
            leido: row.leido,
            tipo: row.tipo,
            esParaAdmin: row.es_para_admin,
            metadata: row.metadata,
            fechaCreacion: row.fecha_creacion,
            parentId: row.parent_id,
            estado: row.estado,
            esInformativo: row.es_informativo,
            asignadoA: row.asignado_a,
            ocultoParaSocio: row.oculto_para_socio
        }));
    },

    /**
     * Update case status
     */
    updateTicketStatus: async (ticketId: string, estado: string): Promise<void> => {
        if (!supabase) return;

        const { error } = await supabase
            .from('notificaciones')
            .update({ estado })
            .eq('id', ticketId);

        if (error) throw error;

        // If ticket is closed, automatically mark all thread messages as read for admin
        if (estado === 'cerrado') {
            try {
                await NotificationService.markThreadAsRead(ticketId, true);
            } catch (err) {
                console.error("Error marking thread as read on status update:", err);
            }
        }
    },

    /**
     * Mark all messages in a thread as read for a specific recipient
     */
    markThreadAsRead: async (threadId: string, isAdmin: boolean): Promise<void> => {
        if (!supabase) return;

        let query = supabase
            .from('notificaciones')
            .update({ leido: true })
            .or(`id.eq.${threadId},parent_id.eq.${threadId}`)
            .eq('leido', false);

        if (isAdmin) {
            query = query.eq('es_para_admin', true);
        } else {
            query = query.eq('es_para_admin', false);
        }

        const { error } = await query;
        if (error) throw error;
    },

    /**
     * Hide a thread for the socio (Soft Delete)
     */
    hideThreadForSocio: async (threadId: string): Promise<void> => {
        if (!supabase) return;

        const { error } = await supabase
            .from('notificaciones')
            .update({ oculto_para_socio: true })
            .or(`id.eq.${threadId},parent_id.eq.${threadId}`);

        if (error) throw error;
    },

    /**
     * Send a notification to a socio (Admin only)
     * Now automatically threads messages if they are related to the same order.
     */
    sendNotification: async (params: {
        socioId: string;
        titulo: string;
        mensaje: string;
        tipo?: string;
        metadata?: any;
        remitenteId?: string;
        parentId?: string;
        estado?: string;
        esInformativo?: boolean;
    }): Promise<Notificacion> => {
        if (!supabase) throw new Error("Supabase client not initialized");

        let parentId = params.parentId;

        // Auto-threading logic for orders
        const pedidoId = params.metadata?.pedidoId || params.metadata?.orderId;
        if (!parentId && pedidoId) {
            // Find if there's already a root ticket for this order
            const { data: existing } = await supabase
                .from('notificaciones')
                .select('id')
                .eq('socio_id', params.socioId)
                .is('parent_id', null)
                .or(`metadata->>pedidoId.eq.${pedidoId},metadata->>orderId.eq.${pedidoId}`)
                .limit(1)
                .single();
            
            if (existing) {
                parentId = existing.id;
            }
        }

        const { data, error } = await supabase
            .from('notificaciones')
            .insert([{
                socio_id: params.socioId,
                remitente_id: params.remitenteId,
                titulo: params.titulo,
                mensaje: params.mensaje,
                tipo: params.tipo || 'general',
                metadata: params.metadata || {},
                leido: false,
                es_para_admin: false,
                parent_id: parentId,
                estado: params.estado || 'abierto',
                es_informativo: params.esInformativo || false
            }])
            .select()
            .single();

        if (error) throw error;

        return {
            id: data.id,
            socioId: data.socio_id,
            titulo: data.titulo,
            mensaje: data.mensaje,
            leido: data.leido,
            tipo: data.tipo,
            esParaAdmin: data.es_para_admin,
            metadata: data.metadata,
            fechaCreacion: data.fecha_creacion,
            parentId: data.parent_id,
            estado: data.estado,
            esInformativo: data.es_informativo,
            ocultoParaSocio: data.oculto_para_socio
        };
    },

    /**
     * Broadcast a notification to a group of socios
     */
    sendMassiveNotification: async (params: {
        titulo: string;
        mensaje: string;
        tipo?: string;
        filters?: {
            reprocann_estado?: string;
            socioIds?: string[];
        };
        remitenteId?: string;
    }): Promise<void> => {
        if (!supabase) return;

        let socioIds: string[] = [];

        // 1. Identify Target Socios
        if (params.filters?.socioIds && params.filters.socioIds.length > 0) {
            // Manual selection
            socioIds = params.filters.socioIds;
        } else {
            // Filtered or All
            let query = supabase.from('socios').select('id').eq('status', 'active');
            
            if (params.filters?.reprocann_estado) {
                query = query.eq('reprocann_estado', params.filters.reprocann_estado);
            }

            const { data: socios, error: socioError } = await query;
            if (socioError) throw socioError;
            if (!socios || socios.length === 0) return;
            socioIds = socios.map(s => s.id);
        }

        // 2. Prepare bulk insert
        const inserts = socioIds.map(id => ({
            socio_id: id,
            remitente_id: params.remitenteId,
            titulo: params.titulo,
            mensaje: params.mensaje,
            tipo: params.tipo || 'massive',
            leido: false,
            es_para_admin: false,
            es_informativo: true // Set massive notifications as informative
        }));

        // 3. Insert
        const { error } = await supabase
            .from('notificaciones')
            .insert(inserts);

        if (error) throw error;
    },


    /**
     * Send message from socio to administration
     */
    sendToAdmin: async (params: {
        socioId: string;
        titulo: string;
        mensaje: string;
        parentId?: string;
        metadata?: any;
    }): Promise<void> => {
        if (!supabase) return;

        let parentId = params.parentId;
        const pedidoId = params.metadata?.pedidoId || params.metadata?.orderId;

        // Auto-threading logic for socio messages
        if (!parentId && pedidoId) {
            const { data: existing } = await supabase
                .from('notificaciones')
                .select('id')
                .eq('socio_id', params.socioId)
                .is('parent_id', null)
                .or(`metadata->>pedidoId.eq.${pedidoId},metadata->>orderId.eq.${pedidoId}`)
                .limit(1)
                .single();
            
            if (existing) {
                parentId = existing.id;
            }
        }

        const { error } = await supabase
            .from('notificaciones')
            .insert([{
                socio_id: params.socioId,
                remitente_id: params.socioId,
                titulo: params.titulo,
                mensaje: params.mensaje,
                tipo: 'socio_message',
                leido: false,
                es_para_admin: true,
                estado: 'abierto',
                parent_id: parentId,
                metadata: params.metadata || {},
                es_informativo: false
            }]);

        if (error) throw error;
    },

    /**
     * Get unread notifications count
     */
    getUnreadCount: async (params: { socioId?: string, isAdminInbox?: boolean }): Promise<number> => {
        if (!supabase) return 0;

        if (params.isAdminInbox) {
            // For Admin, count unique threads (Cases) that have unread messages
            const { data, error } = await supabase
                .from('notificaciones')
                .select('id, parent_id')
                .eq('es_para_admin', true)
                .eq('leido', false);
            
            if (error) throw error;
            if (!data || data.length === 0) return 0;

            // Group by the "root" message ID. 
            // If it has a parent_id, that's the root. If not, the message itself is the root.
            const uniqueThreads = Array.from(new Set(data.map(n => n.parent_id || n.id)));
            
            // Filter out threads that are closed ('cerrado')
            const { data: rootStatuses, error: statusErr } = await supabase
                .from('notificaciones')
                .select('id, estado')
                .in('id', uniqueThreads);

            if (statusErr || !rootStatuses) {
                console.error("Error fetching root statuses for unread count:", statusErr);
                return uniqueThreads.length;
            }

            const activeThreads = rootStatuses.filter(r => r.estado !== 'cerrado');
            return activeThreads.length;
        } else {
            // For Socio, keep counting individual unread notifications
            let query = supabase
                .from('notificaciones')
                .select('*', { count: 'exact', head: true })
                .eq('leido', false)
                .eq('socio_id', params.socioId)
                .eq('es_para_admin', false)
                .eq('oculto_para_socio', false);

            const { count, error } = await query;
            if (error) throw error;
            return count || 0;
        }
    }
};
