
import { supabase } from './supabaseClient';

const BUCKET_NAME = 'documentos-socios';

export const StorageService = {
    /**
     * Uploads a document for a partner to the private bucket.
     * Path format: {socioId}/{docType}/{timestamp}-{safeFilename}
     */
    uploadSocioDocument: async ({ socioId, docType, file }: { socioId: string, docType: string, file: File }): Promise<{ path: string }> => {
        if (!supabase) {
            throw new Error('Supabase not configured');
        }

        // Basic validation
        if (file.size > 10 * 1024 * 1024) { // 10MB
            throw new Error('El archivo excede el tamaño máximo de 10MB');
        }
        const safeFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const timestamp = Date.now();
        const path = `${socioId}/${docType}/${timestamp}-${safeFilename}`;

        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(path, file, {
                cacheControl: '3600',
                upsert: false,
            });

        if (error) {
            console.error('Error uploading file:', error);
            throw error;
        }

        return { path: data.path }; // data.path is the key in the bucket
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
