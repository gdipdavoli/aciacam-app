-- Migration 45: Fix Last Sign In View using Security Definer Function
-- 1. Create a security definer function to read last_sign_in_at from auth.users
CREATE OR REPLACE FUNCTION public.get_last_sign_in(auth_id uuid)
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER -- Runs as owner (postgres) to bypass schema restrictions
STABLE
AS $$
  SELECT last_sign_in_at FROM auth.users WHERE id = auth_id;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_last_sign_in(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_last_sign_in(uuid) TO service_role;

-- 2. Recreate view using the security definer function instead of direct join
CREATE OR REPLACE VIEW public.socios_with_auth AS
SELECT 
  s.*,
  public.get_last_sign_in(s.auth_user_id) AS last_sign_in_at
FROM public.socios s
WHERE (
  -- Security: Only admin/staff can see all records, or the user can see their own record
  public.get_my_role() IN ('admin', 'staff')
  OR s.auth_user_id = auth.uid()
  OR s.user_id = auth.uid()
);

-- Grant select permission
GRANT SELECT ON public.socios_with_auth TO authenticated;
GRANT SELECT ON public.socios_with_auth TO service_role;
