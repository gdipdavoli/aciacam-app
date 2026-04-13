-- Add missing columns to documentos_socio to support full document metadata
ALTER TABLE documentos_socio
ADD COLUMN IF NOT EXISTS fecha_emision date,
ADD COLUMN IF NOT EXISTS monto decimal(12,2),
ADD COLUMN IF NOT EXISTS observaciones text;

-- Ensure 'reprocann' is a valid type (it should be since it's already used in some places, 
-- but if there is a CHECK constraint, we might need to update it. 
-- Assuming it's a 'text' column based on previous migration view)
