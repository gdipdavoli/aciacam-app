-- Migration 57: Fix global_configs RLS policies for Admin and Staff
-- Allows public/authenticated to read configs, and Admin/Staff to create, update, or delete configs.

ALTER TABLE public.global_configs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to avoid conflicts
DROP POLICY IF EXISTS "Anyone can read global_configs" ON public.global_configs;
DROP POLICY IF EXISTS "Admins and Staff can manage global_configs" ON public.global_configs;
DROP POLICY IF EXISTS "Public and authenticated can read global_configs" ON public.global_configs;
DROP POLICY IF EXISTS "Allow select for authenticated" ON public.global_configs;

-- 1. Allow anyone (anon + authenticated) to read global configuration parameters
CREATE POLICY "Anyone can read global_configs"
ON public.global_configs
FOR SELECT
TO public, authenticated
USING (true);

-- 2. Allow Admins and Staff to create, update, and manage global_configs
CREATE POLICY "Admins and Staff can manage global_configs"
ON public.global_configs
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.socios
    WHERE (user_id = auth.uid() OR auth_user_id = auth.uid())
    AND rol IN ('admin', 'staff')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.socios
    WHERE (user_id = auth.uid() OR auth_user_id = auth.uid())
    AND rol IN ('admin', 'staff')
  )
);
