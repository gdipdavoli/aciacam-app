
import { supabase } from './supabaseClient';

const BUCKET_NAME = 'documentos-socios';

export const StorageService = {
    /**
     * Uploads a document for a partner to the private bucket.
     * Path format: {socioId}/{docType}/{timestamp}-{safeFilename}
     */
    uploadSocioDocument: async ({ socioId, docType, file }: { socioId: string, docType: string, file: File }): Promise<{ path: string }> => {
        // Validation moved to API but kept here for immediate feedback if needed, 
        // though strictly the API handles the 'real' upload.
        if (file.size > 10 * 1024 * 1024) {
            throw new Error('El archivo excede el tamaño máximo de 10MB');
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('socioId', socioId);
        formData.append('docType', docType);

        const response = await fetch('/api/docs/upload', {
            method: 'POST',
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
        if (!supabase) {
            console.warn('Supabase not configured, cannot generate signed URL');
            return '';
        }

        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(path, expiresInSeconds);

        if (error) {
            console.error('Error creating signed URL:', error);
            throw error;
        }

        return data.signedUrl;
    }
};
