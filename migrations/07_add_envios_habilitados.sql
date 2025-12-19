-- Add envios_habilitados column to socios table
-- Default to false (opt-in) as per user request ("se debería habilitar a determinados").

ALTER TABLE public.socios
ADD COLUMN IF NOT EXISTS envios_habilitados BOOLEAN DEFAULT false;
