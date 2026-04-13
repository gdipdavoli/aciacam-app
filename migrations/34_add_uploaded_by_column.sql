-- Migration 34: Add uploaded_by column to documentos_socio
-- Tracking source of document uploads for better restriction logic

ALTER TABLE public.documentos_socio 
ADD COLUMN IF NOT EXISTS uploaded_by text DEFAULT 'socio_web';

COMMENT ON COLUMN public.documentos_socio.uploaded_by IS 'Indicates who uploaded the document (socio_web, admin_web, etc.)';
