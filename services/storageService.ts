
import { supabase } from './supabaseClient';

const BUCKET_NAME = 'documentos-socios';

export const StorageService = {
    /**
     * Uploads a document for a partner to the private bucket.
     * Path format: {socioId}/{docType}/{timestamp}-{safeFilename}
     */
    uploadSocioDocument: async ({ 
        socioId, 
        docType, 
        file,
        fechaEmision,
        fechaVencimiento,
        numeroTramite,
        verificacionEstado,
        verificacionObs
    }: { 
        socioId: string;
        docType: string;
        file: File;
        fechaEmision?: string;
        fechaVencimiento?: string;
        numeroTramite?: string;
        verificacionEstado?: string;
        verificacionObs?: string;
    }): Promise<{ path: string }> => {
        // Validation moved to API but kept here for immediate feedback if needed, 
        // though strictly the API handles the 'real' upload.
        if (file.size > 15 * 1024 * 1024) {
            throw new Error('El archivo excede el tamaño máximo de 15MB');
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('socioId', socioId);
        formData.append('docType', docType);
        if (fechaEmision) formData.append('fechaEmision', fechaEmision);
        if (fechaVencimiento) formData.append('fechaVencimiento', fechaVencimiento);
        if (numeroTramite) formData.append('numeroTramite', numeroTramite);
        if (verificacionEstado) formData.append('verificacionEstado', verificacionEstado);
        if (verificacionObs) formData.append('verificacionObs', verificacionObs);

        // Include Authorization header and credentials
        const headers: Record<string, string> = {};
        if (supabase) {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.access_token) {
                    headers['Authorization'] = `Bearer ${session.access_token}`;
                }
            } catch (authErr) {
                console.warn('Could not retrieve active session for document upload:', authErr);
            }
        }

        const response = await fetch('/api/docs/upload', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Error al subir documento');
        }

        const data = await response.json();
        return { path: data.path };
    },

    /**
     * Generates a temporary signed URL to view/download the file.
     */
    createSignedUrl: async (path: string, expiresInSeconds = 600): Promise<string> => {
        try {
            // Get session token if available to authenticate the fetch call
            const { data: { session } } = await supabase.auth.getSession();
            const headers: Record<string, string> = {};
            if (session?.access_token) {
                headers['Authorization'] = `Bearer ${session.access_token}`;
            }

            const response = await fetch(`/api/docs/signed-url?path=${encodeURIComponent(path)}`, { headers });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch signed URL from API');
            }

            const data = await response.json();
            return data.signedUrl;
        } catch (err) {
            console.warn("Failed to generate signed URL via API, falling back to client-side SDK...", err);
            
            if (!supabase) {
                console.warn('Supabase not configured, cannot generate signed URL');
                return '';
            }

            const { data, error } = await supabase.storage
                .from(BUCKET_NAME)
                .createSignedUrl(path, expiresInSeconds);

            if (error) {
                console.error('Error creating signed URL via client-side SDK:', error);
                throw error;
            }

            return data.signedUrl;
        }
    }
};
