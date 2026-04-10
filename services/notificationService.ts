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
            remitente:socios!remitente_id (nombre, apellido)
        `);

        if (params.isAdminInbox) {
            query = query.eq('es_para_admin', true);
        } else if (params.socioId) {
            query = query.eq('socio_id', params.socioId).eq('es_para_admin', false);
        }

        const { data, error } = await query.order('fecha_creacion', { ascending: false });

        if (error) throw error;

        return (data || []).map(row => ({
            id: row.id,
            socioId: row.socio_id,
            remitenteId: row.remitente_id,
            remitenteNombre: row.remitente ? `${row.remitente.nombre} ${row.remitente.apellido}` : undefined,
            titulo: row.titulo,
            mensaje: row.mensaje,
            leido: row.leido,
            tipo: row.tipo,
            esParaAdmin: row.es_para_admin,
            metadata: row.metadata,
            fechaCreacion: row.fecha_creacion
        }));
    },

    /**
     * Mark a notification as read
     */
    markAsRead: async (notificationId: string): Promise<void> => {
        if (!supabase) return;

        const { error } = await supabase
            .from('notificaciones')
            .update({ leido: true })
            .eq('id', notificationId);

        if (error) throw error;
    },

    /**
     * Send a notification to a socio (Admin only)
     */
    sendNotification: async (params: {
        socioId: string;
        titulo: string;
        mensaje: string;
        tipo?: string;
        metadata?: any;
    }): Promise<Notificacion> => {
        if (!supabase) throw new Error("Supabase client not initialized");

        const { data, error } = await supabase
            .from('notificaciones')
            .insert([{
                socio_id: params.socioId,
                titulo: params.titulo,
                mensaje: params.mensaje,
                tipo: params.tipo || 'general',
                metadata: params.metadata || {},
                leido: false,
                es_para_admin: false
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
            fechaCreacion: data.fecha_creacion
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
        }
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
            titulo: params.titulo,
            mensaje: params.mensaje,
            tipo: params.tipo || 'massive',
            leido: false,
            es_para_admin: false
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
    }): Promise<void> => {
        if (!supabase) return;

        const { error } = await supabase
            .from('notificaciones')
            .insert([{
                socio_id: params.socioId, // Still associated with the socio
                remitente_id: params.socioId,
                titulo: params.titulo,
                mensaje: params.mensaje,
                tipo: 'socio_message',
                leido: false,
                es_para_admin: true
            }]);

        if (error) throw error;
    },

    /**
     * Get unread notifications count
     */
    getUnreadCount: async (params: { socioId?: string, isAdminInbox?: boolean }): Promise<number> => {
        if (!supabase) return 0;

        let query = supabase
            .from('notificaciones')
            .select('*', { count: 'exact', head: true })
            .eq('leido', false);

        if (params.isAdminInbox) {
            query = query.eq('es_para_admin', true);
        } else if (params.socioId) {
            query = query.eq('socio_id', params.socioId).eq('es_para_admin', false);
        }

        const { count, error } = await query;

        if (error) throw error;
        return count || 0;
    }
};
