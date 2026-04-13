-- Migration 36: Nuclear RLS Clean & Fix
-- Removing all candidates for conflicting policies and applying a unified model

-- 1. DROP ALL CANDIDATES (Table: documentos_socio)
DROP POLICY IF EXISTS "Socio can read own documents" ON public.documentos_socio;
DROP POLICY IF EXISTS "Socio can insert own documents" ON public.documentos_socio;
DROP POLICY IF EXISTS "Socio can update own pending documents" ON public.documentos_socio;
DROP POLICY IF EXISTS "documentos_socio_select" ON public.documentos_socio;
DROP POLICY IF EXISTS "documentos_socio_insert" ON public.documentos_socio;
DROP POLICY IF EXISTS "documentos_socio_update" ON public.documentos_socio;
DROP POLICY IF EXISTS "Socio manage own" ON public.documentos_socio;

-- 2. DROP ALL CANDIDATES (Bucket: storage.objects)
DROP POLICY IF EXISTS "Socio can upload own documents" ON storage.objects;
DROP POLICY IF EXISTS "Socio can view own documents" ON storage.objects;
DROP POLICY IF EXISTS "Socio can update own documents" ON storage.objects;
DROP POLICY IF EXISTS "storage_select_docs" ON storage.objects;
DROP POLICY IF EXISTS "storage_insert_docs" ON storage.objects;
DROP POLICY IF EXISTS "storage_update_docs" ON storage.objects;

-- 3. APPLY UNIFIED POLICIES (Table: documentos_socio)

-- 3.1 SELECT (Read own)
CREATE POLICY "documentos_socio_select" ON public.documentos_socio
FOR SELECT USING (
    socio_id::text = public.get_my_socio_id()::text
    OR public.get_auth_role() IN ('admin', 'staff')
);

-- 3.2 INSERT (Create own)
CREATE POLICY "documentos_socio_insert" ON public.documentos_socio
FOR INSERT WITH CHECK (
    socio_id::text = public.get_my_socio_id()::text
    OR public.get_auth_role() IN ('admin', 'staff')
);

-- 3.3 UPDATE (Change own if not approved yet)
CREATE POLICY "documentos_socio_update" ON public.documentos_socio
FOR UPDATE USING (
    (
        socio_id::text = public.get_my_socio_id()::text 
        AND (verificacion_estado IN ('pendiente', 'rechazado'))
    )
    OR public.get_auth_role() IN ('admin', 'staff')
)
WITH CHECK (
    (
        socio_id::text = public.get_my_socio_id()::text 
        AND (verificacion_estado IN ('pendiente', 'rechazado'))
    )
    OR public.get_auth_role() IN ('admin', 'staff')
);

-- 4. APPLY UNIFIED POLICIES (Storage: bucket 'documentos-socios')

-- 4.1 SELECT
CREATE POLICY "storage_select_docs" ON storage.objects
FOR SELECT USING (
    bucket_id = 'documentos-socios'
    AND (
        (storage.foldername(name))[1] = public.get_my_socio_id()::text
        OR public.get_auth_role() IN ('admin', 'staff')
    )
);

-- 4.2 INSERT
CREATE POLICY "storage_insert_docs" ON storage.objects
FOR INSERT WITH CHECK (
    bucket_id = 'documentos-socios'
    AND (
        (storage.foldername(name))[1] = public.get_my_socio_id()::text
        OR public.get_auth_role() IN ('admin', 'staff')
    )
);

-- 4.3 UPDATE
CREATE POLICY "storage_update_docs" ON storage.objects
FOR UPDATE USING (
    bucket_id = 'documentos-socios'
    AND (
        (storage.foldername(name))[1] = public.get_my_socio_id()::text
        OR public.get_auth_role() IN ('admin', 'staff')
    )
);

-- 4.4 DELETE (Optional but good)
CREATE POLICY "storage_delete_docs" ON storage.objects
FOR DELETE USING (
    bucket_id = 'documentos-socios'
    AND (
        (storage.foldername(name))[1] = public.get_my_socio_id()::text
        OR public.get_auth_role() IN ('admin', 'staff')
    )
);
