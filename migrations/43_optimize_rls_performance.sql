-- Migration 43: Optimize RLS Performance
-- Fixes N+1 query problem by making helper functions STABLE and using LANGUAGE sql

-- 1. Index on user_id to ensure fast lookups
CREATE INDEX IF NOT EXISTS idx_socios_user_id ON public.socios(user_id);

-- 2. Optimize get_my_socio_id
CREATE OR REPLACE FUNCTION public.get_my_socio_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id FROM public.socios 
  WHERE auth_user_id = auth.uid() 
     OR user_id = auth.uid() 
  LIMIT 1;
$$;

-- 3. Optimize get_auth_role
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT rol FROM public.socios 
  WHERE auth_user_id = auth.uid() 
     OR user_id = auth.uid() 
  LIMIT 1;
$$;

-- 4. Optimize get_my_role (used in older policies)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT rol FROM public.socios 
  WHERE auth_user_id = auth.uid() 
     OR user_id = auth.uid() 
  LIMIT 1;
$$;
