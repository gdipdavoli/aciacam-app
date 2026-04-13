-- Migration 39: Fix Backfill & ID Types
-- Ensuring every document has a clear, UUID-format user_id link to its owner

-- 1. Ensure column is correct type
ALTER TABLE public.documentos_socio ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- 2. Aggressive backfill using explicit casting
-- Link documents to their owners by joining through the socios table
UPDATE public.documentos_socio ds
SET user_id = s.user_id::uuid
FROM public.socios s
WHERE ds.socio_id::text = s.id::text
AND (ds.user_id IS NULL OR ds.user_id != s.user_id::uuid);

-- 3. Safety check: Grant permissions again
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON public.documentos_socio TO authenticated;
