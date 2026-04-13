-- Migration 38: Fix Document RLS for Legacy Records (Type Safety Fix)
-- Ensures socios can update their own documents even if they don't have a user_id yet 
-- by falling back to the socio_id relationship check.

-- 1. DROP OLD POLICY
DROP POLICY IF EXISTS "owner_manage_docs" ON public.documentos_socio;

-- 2. CREATE ROBUST POLICY
-- Added explicit type casting ::text to prevent "operator does not exist: text = uuid"
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

-- 3. ENSURE PERMISSIONS
GRANT ALL ON public.documentos_socio TO authenticated;
GRANT ALL ON public.documentos_socio TO service_role;

-- 4. FINAL BACKFILL (Optional but recommended)
-- Added explicit casting for join and update
UPDATE public.documentos_socio ds
SET user_id = s.user_id::uuid
FROM public.socios s
WHERE ds.socio_id::text = s.id::text
AND ds.user_id IS NULL
AND s.user_id IS NOT NULL;
