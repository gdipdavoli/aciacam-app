-- Migration 33: Socio Document Permissions
-- Enable RLS and setup policies for documentos_socio table and storage bucket

-- 1. Table: documentos_socio
ALTER TABLE public.documentos_socio ENABLE ROW LEVEL SECURITY;

-- 1.1 SELECT: Socio can read own docs, Admin/Staff can read all
DROP POLICY IF EXISTS "Socio can read own documents" ON public.documentos_socio;
CREATE POLICY "Socio can read own documents"
ON public.documentos_socio FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.socios s
        WHERE s.id = documentos_socio.socio_id
        AND s.user_id = auth.uid()
    )
    OR public.get_auth_role() IN ('admin', 'staff')
);

-- 1.2 INSERT: Socio can insert own docs, Admin/Staff can insert for anyone
DROP POLICY IF EXISTS "Socio can insert own documents" ON public.documentos_socio;
CREATE POLICY "Socio can insert own documents"
ON public.documentos_socio FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.socios s
        WHERE s.id = socio_id
        AND s.user_id = auth.uid()
    )
    OR public.get_auth_role() IN ('admin', 'staff')
);

-- 1.3 UPDATE: Socio can ONLY update if status is 'pendiente', Admin/Staff can update anything
DROP POLICY IF EXISTS "Socio can update own pending documents" ON public.documentos_socio;
CREATE POLICY "Socio can update own pending documents"
ON public.documentos_socio FOR UPDATE
USING (
    (
        EXISTS (
            SELECT 1 FROM public.socios s
            WHERE s.id = documentos_socio.socio_id
            AND s.user_id = auth.uid()
        )
        AND verificacion_estado = 'pendiente'
    )
    OR public.get_auth_role() IN ('admin', 'staff')
);

-- 2. Storage: documentos-socios bucket
-- Policies for storage.objects

-- 2.1 INSERT: Socio can upload to their own folder, Admin/Staff to any
DROP POLICY IF EXISTS "Socio can upload own documents" ON storage.objects;
CREATE POLICY "Socio can upload own documents"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'documentos-socios'
    AND (
        (storage.foldername(name))[1] IN (
            SELECT id::text FROM public.socios WHERE user_id = auth.uid()
        )
        OR public.get_auth_role() IN ('admin', 'staff')
    )
);

-- 2.2 SELECT: Socio can view own documents, Admin/Staff all
DROP POLICY IF EXISTS "Socio can view own documents" ON storage.objects;
CREATE POLICY "Socio can view own documents"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'documentos-socios'
    AND (
        (storage.foldername(name))[1] IN (
            SELECT id::text FROM public.socios WHERE user_id = auth.uid()
        )
        OR public.get_auth_role() IN ('admin', 'staff')
    )
);

-- 2.3 UPDATE/UPSERT: Same folder restriction + status check (implicit by path if they can't update the DB record)
DROP POLICY IF EXISTS "Socio can update own documents" ON storage.objects;
CREATE POLICY "Socio can update own documents"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'documentos-socios'
    AND (
        (storage.foldername(name))[1] IN (
            SELECT id::text FROM public.socios WHERE user_id = auth.uid()
        )
        OR public.get_auth_role() IN ('admin', 'staff')
    )
);

-- 3. GRANTS
GRANT ALL ON public.documentos_socio TO authenticated;
GRANT ALL ON public.documentos_socio TO service_role;
