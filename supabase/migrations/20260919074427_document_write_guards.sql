BEGIN;
DROP POLICY IF EXISTS owner_manage_docs ON public.documentos_socio;
DROP POLICY IF EXISTS socio_own_docs ON public.documentos_socio;
DROP POLICY IF EXISTS staff_admin_all_docs ON public.documentos_socio;
CREATE POLICY document_owner_or_staff ON public.documentos_socio FOR ALL TO authenticated
USING (public.get_my_role() IN ('admin','staff') OR EXISTS (
  SELECT 1 FROM public.socios s WHERE s.id::text=socio_id AND (s.auth_user_id=auth.uid() OR s.user_id=auth.uid())
))
WITH CHECK (public.get_my_role() IN ('admin','staff') OR EXISTS (
  SELECT 1 FROM public.socios s WHERE s.id::text=socio_id AND (s.auth_user_id=auth.uid() OR s.user_id=auth.uid())
));
-- Invoker validation before writes: historical permissive policies cannot let a
-- member impersonate another owner or approve their own documents.
CREATE OR REPLACE FUNCTION app_private.validate_document_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_staff boolean := coalesce(public.get_my_role(),'') IN ('admin','staff');
BEGIN
  IF auth.uid() IS NULL THEN
    IF current_user IN ('postgres','service_role') THEN
      IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'Sesión requerida';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Conservá el historial del documento'; END IF;
  IF TG_OP='UPDATE' AND (NEW.socio_id,NEW.tipo,NEW.id) IS DISTINCT FROM (OLD.socio_id,OLD.tipo,OLD.id) THEN
    RAISE EXCEPTION 'No se puede cambiar la identidad del documento';
  END IF;
  IF NOT v_staff THEN
    IF NOT EXISTS(SELECT 1 FROM public.socios WHERE id::text=NEW.socio_id AND (auth_user_id=auth.uid() OR user_id=auth.uid())) THEN
      RAISE EXCEPTION 'Documento ajeno';
    END IF;
    IF TG_OP='INSERT' THEN
      IF coalesce(NEW.verificacion_estado,'pendiente') NOT IN ('pendiente','en_revision') THEN RAISE EXCEPTION 'La aprobación requiere personal autorizado'; END IF;
      NEW.verificado_at=NULL; NEW.verificado_por=NULL; NEW.verificacion_obs=NULL;
    ELSE
      IF (NEW.verificacion_estado,NEW.verificado_at,NEW.verificado_por,NEW.verificacion_obs)
          IS DISTINCT FROM (OLD.verificacion_estado,OLD.verificado_at,OLD.verificado_por,OLD.verificacion_obs)
         AND NOT (NEW.archivo_path IS DISTINCT FROM OLD.archivo_path AND NEW.verificacion_estado='pendiente') THEN
        RAISE EXCEPTION 'La aprobación requiere personal autorizado';
      END IF;
      IF (NEW.archivo_path,NEW.fecha_emision,NEW.fecha_vencimiento) IS DISTINCT FROM (OLD.archivo_path,OLD.fecha_emision,OLD.fecha_vencimiento) THEN
        NEW.verificacion_estado='pendiente'; NEW.verificado_at=NULL; NEW.verificado_por=NULL; NEW.verificacion_obs=NULL;
      END IF;
    END IF;
    NEW.user_id=auth.uid();
  END IF;
  IF v_staff AND (TG_OP='INSERT' OR NEW.verificacion_estado IS DISTINCT FROM OLD.verificacion_estado) THEN
    NEW.verificado_at=now(); NEW.verificado_por=auth.uid()::text;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_document_change BEFORE INSERT OR UPDATE OR DELETE ON public.documentos_socio
FOR EACH ROW EXECUTE FUNCTION app_private.validate_document_change();


COMMIT;
