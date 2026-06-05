-- Migration 47: Calculate last activity based on login, terms acceptance, and latest order dates.

-- 1. Create a function to determine the greatest activity date for a socio
CREATE OR REPLACE FUNCTION public.get_last_activity(auth_id uuid, socio_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER -- Bypasses auth schema restrictions
STABLE
AS $$
DECLARE
  last_sign_in timestamptz;
  last_pedido timestamptz;
  last_terms timestamptz;
  result timestamptz;
BEGIN
  -- 1. Obtener última conexión registrada en la tabla de autenticación
  IF auth_id IS NOT NULL THEN
    SELECT last_sign_in_at INTO last_sign_in FROM auth.users WHERE id = auth_id;
  END IF;

  -- 2. Obtener fecha de aceptación de términos del socio
  SELECT terms_accepted_at INTO last_terms FROM public.socios WHERE id = socio_id;

  -- 3. Obtener la fecha del último pedido realizado por el socio
  SELECT MAX(created_at) INTO last_pedido FROM public.pedidos WHERE public.pedidos.socio_id = get_last_activity.socio_id;

  -- Determinar la fecha más reciente de actividad
  result := COALESCE(last_sign_in, '1970-01-01Z'::timestamptz);
  
  IF last_terms IS NOT NULL AND last_terms > result THEN
    result := last_terms;
  END IF;

  IF last_pedido IS NOT NULL AND last_pedido > result THEN
    result := last_pedido;
  END IF;

  -- Si no se registra ninguna actividad, devolver NULL
  IF result = '1970-01-01Z'::timestamptz THEN
    RETURN NULL;
  END IF;

  RETURN result;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_last_activity(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_last_activity(uuid, uuid) TO service_role;

-- 2. Recreate the view using get_last_activity instead of get_last_sign_in
CREATE OR REPLACE VIEW public.socios_with_auth AS
SELECT 
  s.*,
  public.get_last_activity(s.auth_user_id, s.id) AS last_sign_in_at
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

-- Re-grant select permissions on the view
GRANT SELECT ON public.socios_with_auth TO authenticated;
GRANT SELECT ON public.socios_with_auth TO service_role;
