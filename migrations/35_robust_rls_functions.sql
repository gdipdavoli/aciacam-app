-- Migration 35: Robust RLS with Security Definer Functions
-- Solving the 403 Forbidden error using reliable server-side checks

-- 1. SECURITY DEFINER FUNCTIONS
-- These bypass RLS on the table they query but internally check auth.uid() for security.

-- 1.1 Helper to get the current socio's table ID
CREATE OR REPLACE FUNCTION public.get_my_socio_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER -- Runs as postgres, bypassing recursive RLS checks
AS $$
BEGIN
  RETURN (SELECT id FROM public.socios WHERE user_id = auth.uid());
END;
$$;

-- 1.2 Helper for role check (already exists, but ensuring it's robust)
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (SELECT rol FROM public.socios WHERE user_id = auth.uid());
END;
$$;

-- 2. TABLE POLICIES: documentos_socio

-- Enable RLS (just in case)
ALTER TABLE public.documentos_socio ENABLE ROW LEVEL SECURITY;

-- Clear previous policies to avoid conflict
DROP POLICY IF EXISTS "Socio can read own documents" ON public.documentos_socio;
DROP POLICY IF EXISTS "Socio can insert own documents" ON public.documentos_socio;
DROP POLICY IF EXISTS "Socio can update own pending documents" ON public.documentos_socio;

-- 2.1 SELECT
CREATE POLICY "documentos_socio_select" ON public.documentos_socio
FOR SELECT USING (
    socio_id = public.get_my_socio_id()
    OR public.get_auth_role() IN ('admin', 'staff')
);

-- 2.2 INSERT
CREATE POLICY "documentos_socio_insert" ON public.documentos_socio
FOR INSERT WITH CHECK (
    socio_id = public.get_my_socio_id()
    OR public.get_auth_role() IN ('admin', 'staff')
);

-- 2.3 UPDATE (Restricted to 'pendiente' for socios)
CREATE POLICY "documentos_socio_update" ON public.documentos_socio
FOR UPDATE USING (
    (socio_id = public.get_my_socio_id() AND verificacion_estado = 'pendiente')
    OR public.get_auth_role() IN ('admin', 'staff')
);

-- 3. STORAGE POLICIES: documentos-socios bucket

-- Clear previous policies
DROP POLICY IF EXISTS "Socio can upload own documents" ON storage.objects;
DROP POLICY IF EXISTS "Socio can view own documents" ON storage.objects;
DROP POLICY IF EXISTS "Socio can update own documents" ON storage.objects;

-- 3.1 SELECT
CREATE POLICY "storage_select_docs" ON storage.objects
FOR SELECT USING (
    bucket_id = 'documentos-socios'
    AND (
        (storage.foldername(name))[1] = public.get_my_socio_id()::text
        OR public.get_auth_role() IN ('admin', 'staff')
    )
);

-- 3.2 INSERT
CREATE POLICY "storage_insert_docs" ON storage.objects
FOR INSERT WITH CHECK (
    bucket_id = 'documentos-socios'
    AND (
        (storage.foldername(name))[1] = public.get_my_socio_id()::text
        OR public.get_auth_role() IN ('admin', 'staff')
    )
);

-- 3.3 UPDATE
CREATE POLICY "storage_update_docs" ON storage.objects
FOR UPDATE USING (
    bucket_id = 'documentos-socios'
    AND (
        (storage.foldername(name))[1] = public.get_my_socio_id()::text
        OR public.get_auth_role() IN ('admin', 'staff')
    )
);

-- 4. GRANT permissions
GRANT ALL ON public.documentos_socio TO authenticated;
GRANT ALL ON public.documentos_socio TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_socio_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_role() TO authenticated;
