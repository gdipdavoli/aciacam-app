-- STAGING ONLY: validate against a separate database before production deployment.
BEGIN;

ALTER TABLE public.cierres_mensuales ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.cierres_mensuales TO authenticated;
GRANT USAGE ON SEQUENCE public.cierres_correlativo_seq TO authenticated;
CREATE POLICY cierre_read ON public.cierres_mensuales FOR SELECT TO authenticated
USING (public.get_my_role() IN ('admin','staff') OR EXISTS (
  SELECT 1 FROM public.socios s WHERE s.id=socio_id AND (s.auth_user_id=auth.uid() OR s.user_id=auth.uid())
));
CREATE POLICY cierre_create ON public.cierres_mensuales FOR INSERT TO authenticated
WITH CHECK (public.get_my_role() IN ('admin','staff'));
CREATE POLICY cierre_update ON public.cierres_mensuales FOR UPDATE TO authenticated
USING (public.get_my_role() IN ('admin','staff')) WITH CHECK (public.get_my_role() IN ('admin','staff'));

CREATE OR REPLACE FUNCTION app_private.prepare_monthly_close() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_socio public.socios; v_start timestamptz; v_end timestamptz;
  v_orders jsonb; v_payments jsonb;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.get_my_role(),'') NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Anulá la constancia; no se elimina'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['estado','fecha_anulacion','motivo_anulacion','anulado_por'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['estado','fecha_anulacion','motivo_anulacion','anulado_por'])
       OR OLD.estado <> 'emitido' OR NEW.estado <> 'anulado' OR nullif(trim(NEW.motivo_anulacion),'') IS NULL THEN
      RAISE EXCEPTION 'Solo se permite anular una constancia emitida con motivo';
    END IF;
    NEW.fecha_anulacion=now(); NEW.anulado_por=auth.uid();
    RETURN NEW;
  END IF;
  IF NEW.periodo !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Período inválido'; END IF;
  v_start=(NEW.periodo || '-01')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires';
  v_end=((NEW.periodo || '-01')::date + interval '1 month')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires';
  SELECT * INTO STRICT v_socio FROM public.socios WHERE id=NEW.socio_id;
  -- A single SQL statement gives orders and payments a shared MVCC snapshot.
  SELECT
    (SELECT coalesce(jsonb_agg(jsonb_build_object('pedidoId',p.id,'fecha',p.created_at,
       'items',p.items,'operador','Sistema ACIACAM') ORDER BY p.created_at,p.id),'[]'::jsonb)
     FROM public.pedidos p WHERE p.socio_id=NEW.socio_id AND p.estado IN ('entregado','retirado')
       AND p.created_at>=v_start AND p.created_at<v_end),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('fecha',p.fecha,'concepto',p.concepto,
       'medioDePago',p.medio_de_pago,'referencia',p.referencia,'monto',p.monto) ORDER BY p.fecha,p.id),'[]'::jsonb)
     FROM public.pagos p WHERE p.socio_id=NEW.socio_id AND p.fecha>=v_start AND p.fecha<v_end)
  INTO v_orders,v_payments;
  NEW.datos=jsonb_build_object('socio',jsonb_build_object('id',v_socio.id,
    'nombre',v_socio.nombre,'apellido',v_socio.apellido,'dni',v_socio.dni,'email',v_socio.email,
    'diagnosticoPrincipal',v_socio.diagnostico,'reprocann',jsonb_build_object(
      'numeroTramite',v_socio.reprocann_num_tramite,'estado',v_socio.reprocann_estado)),
    'dispensas',v_orders,'aportes',v_payments,'version_pie_legal',1,
    'pie_legal','Los importes consignados corresponden exclusivamente a aportes voluntarios destinados al sostenimiento del programa de cultivo solidario desarrollado por la Asociación Civil para la Investigación y el Acceso del Cannabis Medicinal (ACIACAM), en cumplimiento de su Estatuto Social, de la Ley 27.350, su Decreto Reglamentario 883/2020, la Resolución MS 800/2021 y demás normativa aplicable. Dichos aportes no constituyen precio de venta ni contraprestación comercial por los productos dispensados.');
  NEW.hash_sha256=encode(sha256(convert_to(NEW.datos::text,'UTF8')),'hex');
  NEW.generado_por=auth.uid(); NEW.fecha_generacion=now(); NEW.estado='emitido';
  NEW.fecha_anulacion=NULL; NEW.motivo_anulacion=NULL; NEW.anulado_por=NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER prepare_monthly_close BEFORE INSERT OR UPDATE OR DELETE ON public.cierres_mensuales
FOR EACH ROW EXECUTE FUNCTION app_private.prepare_monthly_close();

CREATE OR REPLACE FUNCTION app_private.audit_monthly_close() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.audit_logs(user_id,action,entity_type,entity_id,details)
  VALUES(auth.uid(),CASE WHEN TG_OP='INSERT' THEN 'CREATE' ELSE 'UPDATE' END,'CIERRE_MENSUAL',NEW.id::text,
    jsonb_build_object('periodo',NEW.periodo,'hash_sha256',NEW.hash_sha256,'estado',NEW.estado,'motivo',NEW.motivo_anulacion));
  RETURN NEW;
END $$;
CREATE TRIGGER audit_monthly_close AFTER INSERT OR UPDATE ON public.cierres_mensuales
FOR EACH ROW EXECUTE FUNCTION app_private.audit_monthly_close();

ALTER TABLE public.socios ADD COLUMN IF NOT EXISTS reprocann_fecha_vencimiento date;
CREATE TABLE public.documentos_socio_versiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL,
  socio_id text NOT NULL,
  datos jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid
);
ALTER TABLE public.documentos_socio_versiones ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.documentos_socio_versiones TO authenticated;
CREATE POLICY document_history_read ON public.documentos_socio_versiones FOR SELECT TO authenticated
USING (public.get_my_role() IN ('admin','staff') OR EXISTS (
  SELECT 1 FROM public.socios s WHERE s.id::text=socio_id AND (s.auth_user_id=auth.uid() OR s.user_id=auth.uid())
));

CREATE OR REPLACE FUNCTION app_private.validate_reprocann_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.tipo='reprocann' AND NEW.verificacion_estado='aprobado' THEN
    IF NEW.archivo_path IS NULL OR NEW.fecha_emision IS NULL OR NEW.fecha_vencimiento IS NULL
       OR NEW.fecha_vencimiento::date<NEW.fecha_emision THEN
      RAISE EXCEPTION 'Confirmá archivo, fecha de emisión y vencimiento antes de aprobar';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_reprocann_approval BEFORE INSERT OR UPDATE ON public.documentos_socio
FOR EACH ROW EXECUTE FUNCTION app_private.validate_reprocann_approval();

-- Trigger-only privilege to append history and synchronize the member's approved
-- dates. There is no exposed RPC granting clients this authority.
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
  IF NEW.tipo='reprocann' AND NEW.verificacion_estado='aprobado' THEN
    UPDATE public.socios SET reprocann_fecha_alta=NEW.fecha_emision,
      reprocann_fecha_vencimiento=(NEW.fecha_vencimiento AT TIME ZONE 'UTC')::date,
      reprocann_estado='vigente' WHERE id::text=NEW.socio_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.archive_and_sync_document() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER archive_and_sync_document AFTER INSERT OR UPDATE ON public.documentos_socio
FOR EACH ROW EXECUTE FUNCTION app_private.archive_and_sync_document();

COMMIT;
