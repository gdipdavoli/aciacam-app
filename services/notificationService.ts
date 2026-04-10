import { supabase } from './supabaseClient';
import { Notificacion } from '@/types';

export const NotificationService = {
    /**
     * Get all notifications for a specific socio
     */
    getNotifications: async (socioId: string): Promise<Notificacion[]> => {
        if (!supabase) return [];

        const { data, error } = await supabase
            .from('notificaciones')
            .select('*')
            .eq('socio_id', socioId)
            .order('fecha_creacion', { ascending: false });

        if (error) throw error;

        return (data || []).map(row => ({
            id: row.id,
            socioId: row.socio_id,
            titulo: row.titulo,
            mensaje: row.mensaje,
            leido: row.leido,
            tipo: row.tipo,
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
                leido: false
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
            metadata: data.metadata,
            fechaCreacion: data.fecha_creacion
        };
    },

    /**
     * Get unread notifications count for a socio
     */
    getUnreadCount: async (socioId: string): Promise<number> => {
        if (!supabase) return 0;

        const { count, error } = await supabase
            .from('notificaciones')
            .select('*', { count: 'exact', head: true })
            .eq('socio_id', socioId)
            .eq('leido', false);

        if (error) throw error;
        return count || 0;
    }
};
