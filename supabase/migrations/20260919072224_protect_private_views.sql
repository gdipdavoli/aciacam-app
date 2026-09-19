BEGIN;
DROP POLICY IF EXISTS "Admins can do everything on invites" ON public.socio_invites;
DROP POLICY IF EXISTS "Public can read invites by token" ON public.socio_invites;
REVOKE ALL ON public.socio_invites FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.socio_invites TO authenticated;
GRANT UPDATE(consumed_at,status) ON public.socio_invites TO authenticated;
GRANT ALL ON public.socio_invites TO service_role;
DROP POLICY IF EXISTS invite_owner_read ON public.socio_invites;
CREATE POLICY invite_owner_read ON public.socio_invites FOR SELECT TO authenticated
USING (public.get_my_role() IN ('admin','staff') OR EXISTS (
    SELECT 1 FROM public.socios s WHERE s.id=socio_id AND (s.auth_user_id=auth.uid() OR s.user_id=auth.uid())
));
DROP POLICY IF EXISTS invite_owner_consume ON public.socio_invites;
CREATE POLICY invite_owner_consume ON public.socio_invites FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.socios s WHERE s.id=socio_id AND (s.auth_user_id=auth.uid() OR s.user_id=auth.uid())))
WITH CHECK (status='consumed' AND consumed_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.socios s WHERE s.id=socio_id AND (s.auth_user_id=auth.uid() OR s.user_id=auth.uid())
));
ALTER VIEW public.v_socio_latest_invite SET (security_invoker=true);
REVOKE ALL ON public.v_socio_latest_invite FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v_socio_latest_invite TO service_role;
ALTER VIEW public.socios_with_auth SET (security_invoker=true);
ALTER VIEW public.v_documentacion_socios SET (security_invoker=true);
REVOKE ALL ON public.socios_with_auth,public.v_documentacion_socios FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.socios_with_auth,public.v_documentacion_socios TO authenticated,service_role;
COMMIT;
