-- Migration 37: Simplified Ownership Fix
-- Adding user_id directly to documentos_socio to make RLS trivial and high-performance

-- 1. Modify Table
ALTER TABLE public.documentos_socio ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();

-- 2. Backfill existing records
UPDATE public.documentos_socio ds
SET user_id = s.user_id
FROM public.socios s
WHERE ds.socio_id = s.id
AND ds.user_id IS NULL;

-- 3. Nuclear Policy Cleanup (again, to be safe)
DROP POLICY IF EXISTS "Socio can read own documents" ON public.documentos_socio;
DROP POLICY IF EXISTS "Socio can insert own documents" ON public.documentos_socio;
DROP POLICY IF EXISTS "Socio can update own pending documents" ON public.documentos_socio;
DROP POLICY IF EXISTS "documentos_socio_select" ON public.documentos_socio;
DROP POLICY IF EXISTS "documentos_socio_insert" ON public.documentos_socio;
DROP POLICY IF EXISTS "documentos_socio_update" ON public.documentos_socio;
DROP POLICY IF EXISTS "documentos_socio_all_ops" ON public.documentos_socio;

-- 4. Unified Direct Policy
-- This doesn't depend on joins, so it avoids 403 Forbidden issues entirely.
CREATE POLICY "owner_manage_docs" ON public.documentos_socio
FOR ALL USING (
    user_id = auth.uid()
    OR public.get_auth_role() IN ('admin', 'staff')
)
WITH CHECK (
    user_id = auth.uid()
    OR public.get_auth_role() IN ('admin', 'staff')
);

-- 5. STORAGE POLICIES (Sync with user_id is harder here, so we stick to get_my_socio_id which usually works fine for storage)
-- But we'll refine them anyway.
DROP POLICY IF EXISTS "storage_select_docs" ON storage.objects;
DROP POLICY IF EXISTS "storage_insert_docs" ON storage.objects;
DROP POLICY IF EXISTS "storage_update_docs" ON storage.objects;
DROP POLICY IF EXISTS "storage_delete_docs" ON storage.objects;

CREATE POLICY "storage_manage_docs" ON storage.objects
FOR ALL USING (
    bucket_id = 'documentos-socios'
    AND (
        (storage.foldername(name))[1] = public.get_my_socio_id()::text
        OR public.get_auth_role() IN ('admin', 'staff')
    )
)
WITH CHECK (
    bucket_id = 'documentos-socios'
    AND (
        (storage.foldername(name))[1] = public.get_my_socio_id()::text
        OR public.get_auth_role() IN ('admin', 'staff')
    )
);

-- 6. Grant Permissions
GRANT ALL ON public.documentos_socio TO authenticated;
