BEGIN;
CREATE OR REPLACE FUNCTION app_private.archive_and_sync_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.jwt()->>'role','') <> 'service_role' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'Sesión requerida';
  END IF;
  IF TG_OP='UPDATE' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
    INSERT INTO public.documentos_socio_versiones(documento_id,socio_id,datos,archived_by)
    VALUES(OLD.id,OLD.socio_id,to_jsonb(OLD),auth.uid());
  END IF;
  IF NEW.tipo='reprocann' AND NEW.verificacion_estado='aprobado' AND
     (TG_OP='INSERT' OR (NEW.archivo_path,NEW.fecha_emision,NEW.fecha_vencimiento,NEW.verificacion_estado)
       IS DISTINCT FROM (OLD.archivo_path,OLD.fecha_emision,OLD.fecha_vencimiento,OLD.verificacion_estado)) THEN
    UPDATE public.socios SET reprocann_fecha_alta=NEW.fecha_emision,
      reprocann_fecha_vencimiento=(NEW.fecha_vencimiento AT TIME ZONE 'UTC')::date,
      reprocann_estado='vigente' WHERE id::text=NEW.socio_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.archive_and_sync_document() FROM PUBLIC,anon,authenticated;
COMMIT;
