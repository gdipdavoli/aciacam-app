-- Migration 46: Allow service_role to bypass WHERE clause in view
CREATE OR REPLACE VIEW public.socios_with_auth AS
SELECT 
  s.*,
  public.get_last_sign_in(s.auth_user_id) AS last_sign_in_at
FROM public.socios s
WHERE (
  -- Allow admin and staff roles
  public.get_my_role() IN ('admin', 'staff')
  -- Allow individual users to see their own records
  OR s.auth_user_id = auth.uid()
  OR s.user_id = auth.uid()
  -- Allow service_role key (server-side/admin queries) to bypass restrictions
  OR current_setting('role', true) = 'service_role'
);

-- Re-grant select permission
GRANT SELECT ON public.socios_with_auth TO authenticated;
GRANT SELECT ON public.socios_with_auth TO service_role;
