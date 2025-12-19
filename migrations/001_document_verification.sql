-- Add verification columns and unique constraint

ALTER TABLE documentos_socio
ADD COLUMN IF NOT EXISTS verificacion_estado text NOT NULL DEFAULT 'pendiente',
ADD COLUMN IF NOT EXISTS verificacion_obs text,
ADD COLUMN IF NOT EXISTS verificado_at timestamptz,
ADD COLUMN IF NOT EXISTS verificado_por text;

-- Add UNIQUE constraint to prevent duplicate rows for same doc type
ALTER TABLE documentos_socio
ADD CONSTRAINT unique_socio_tipo UNIQUE (socio_id, tipo);

-- Optional: Backfill verification status from old 'estado' if relevant
-- UPDATE documentos_socio SET verificacion_estado = 'aprobado' WHERE estado = 'completo';
