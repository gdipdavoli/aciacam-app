-- Migration 40: Robust RLS Omnivore Fix
-- Fixes the 403 Forbidden error by ensuring helper functions check both user_id and auth_user_id

-- 1. RE-DEFINE HELPER FUNCTIONS (SECURITY DEFINER)
-- These functions check both possible linking columns in the socios table.

CREATE OR REPLACE FUNCTION public.get_my_socio_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT id FROM public.socios 
    WHERE auth_user_id = auth.uid() 
       OR user_id = auth.uid() 
    LIMIT 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT rol FROM public.socios 
    WHERE auth_user_id = auth.uid() 
       OR user_id = auth.uid() 
    LIMIT 1
  );
END;
$$;

-- 2. REPAIR DOCUMENTS OWNERSHIP (Backfill)
-- Assign user_id to documents by looking up the socio's preferred auth link
UPDATE public.documentos_socio ds
SET user_id = COALESCE(s.auth_user_id, s.user_id)
FROM public.socios s
WHERE ds.socio_id::text = s.id::text
AND ds.user_id IS NULL
AND (s.auth_user_id IS NOT NULL OR s.user_id IS NOT NULL);

-- 3. RE-APPLY ROBUST TABLE POLICIES
DROP POLICY IF EXISTS "owner_manage_docs" ON public.documentos_socio;

CREATE POLICY "owner_manage_docs" ON public.documentos_socio
FOR ALL USING (
    user_id = auth.uid()
    OR socio_id::text = public.get_my_socio_id()::text
    OR public.get_auth_role() IN ('admin', 'staff')
)
WITH CHECK (
    user_id = auth.uid()
    OR socio_id::text = public.get_my_socio_id()::text
    OR public.get_auth_role() IN ('admin', 'staff')
);

-- 4. ENSURE PERMISSIONS
GRANT ALL ON public.documentos_socio TO authenticated;
GRANT ALL ON public.documentos_socio TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_socio_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_role() TO authenticated;
