-- INC-08: Separación de habilitación institucional/documental para dispensa vs acceso digital
-- No activa cuentas digitales ni altera documentos ni fechas REPROCANN existentes.
BEGIN;

-- 1. Campos independientes de admisión institucional (sin tocar socios.status digital)
ALTER TABLE public.socios
    ADD COLUMN IF NOT EXISTS admision_institucional_estado text NOT NULL DEFAULT 'pendiente'
        CHECK (admision_institucional_estado IN ('pendiente', 'admitido', 'rechazado', 'suspendido')),
    ADD COLUMN IF NOT EXISTS admision_institucional_at timestamptz,
    ADD COLUMN IF NOT EXISTS admision_institucional_por uuid;

-- Backfill conservador: solo acredita admisión cuando existe evidencia documental/registral previa
UPDATE public.socios s
SET admision_institucional_estado = CASE
        WHEN s.status = 'suspended' THEN 'suspendido'
        WHEN s.acta_numero IS NOT NULL
          OR s.orden_libro IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.onboarding_application_materializations m WHERE m.socio_id = s.id)
            THEN 'admitido'
        ELSE 'pendiente'
    END,
    admision_institucional_at = CASE
        WHEN s.status <> 'suspended' AND (
            s.acta_numero IS NOT NULL
            OR s.orden_libro IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.onboarding_application_materializations m WHERE m.socio_id = s.id)
        ) THEN COALESCE(s.fecha_ingreso_ong::timestamptz, s.created_at)
        ELSE NULL
    END
WHERE s.admision_institucional_estado = 'pendiente';

-- 2. Función centralizada de evaluación (separa acceso digital de habilitación para dispensar)
CREATE OR REPLACE FUNCTION public.evaluate_socio_dispensation_eligibility(p_socio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_socio public.socios%ROWTYPE;
    v_today date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
    v_acceso_digital text;
    v_repro_doc record;
    v_repro_prof record;
    v_repro_verified boolean := false;
    v_repro_vencimiento date := NULL;
    v_repro_vigente boolean := false;
    v_has_ddjj boolean := false;
    v_has_consent boolean := false;
    v_has_contrato boolean := true;
    v_tipo_repro text;
    v_bloqueado boolean := false;
    v_motivos text[] := ARRAY[]::text[];
    v_elegible boolean := false;
BEGIN
    SELECT * INTO v_socio FROM public.socios WHERE id = p_socio_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'found', false,
            'elegibleParaDispensa', false,
            'motivosRechazo', ARRAY['SOCIO_NO_ENCONTRADO']
        );
    END IF;

    -- A. Acceso digital (independiente de la habilitación para dispensar)
    v_acceso_digital := CASE
        WHEN v_socio.bloqueado IS TRUE OR v_socio.status = 'suspended' THEN 'deshabilitado'
        WHEN v_socio.status = 'active' AND v_socio.auth_user_id IS NOT NULL THEN 'activado'
        WHEN v_socio.status = 'invited' THEN 'invitado'
        WHEN v_socio.status = 'ready_to_invite' THEN 'invitacion_pendiente'
        ELSE 'sin_invitacion'
    END;

    -- B. Bloqueos / suspensiones
    v_bloqueado := COALESCE(v_socio.bloqueado, false)
        OR v_socio.status = 'suspended'
        OR v_socio.admision_institucional_estado IN ('rechazado', 'suspendido');
    IF v_bloqueado THEN
        v_motivos := array_append(v_motivos, 'SOCIO_BLOQUEADO');
    END IF;

    -- C. Admisión institucional acreditada
    IF v_socio.admision_institucional_estado IS DISTINCT FROM 'admitido' THEN
        v_motivos := array_append(v_motivos, 'SIN_ADMISION_INSTITUCIONAL');
    END IF;

    -- D. REPROCANN vigente y verificado (nunca asume certificado cargado = vigente)
    SELECT d.verificacion_estado, d.fecha_vencimiento
    INTO v_repro_doc
    FROM public.documentos_socio d
    WHERE d.socio_id = p_socio_id::text
      AND d.is_current IS NOT FALSE
      AND lower(btrim(d.tipo)) = 'reprocann'
    ORDER BY d.version DESC NULLS LAST, d.created_at DESC
    LIMIT 1;

    SELECT r.verification_status, r.fecha_vencimiento
    INTO v_repro_prof
    FROM public.socio_reprocann_profiles r
    WHERE r.socio_id = p_socio_id
    ORDER BY r.updated_at DESC
    LIMIT 1;

    v_repro_verified := (v_repro_doc.verificacion_estado = 'aprobado')
        OR (upper(COALESCE(v_repro_prof.verification_status, '')) = 'VERIFIED');

    v_repro_vencimiento := COALESCE(
        v_repro_prof.fecha_vencimiento,
        v_socio.reprocann_fecha_vencimiento,
        v_repro_doc.fecha_vencimiento::date
    );

    IF NOT v_repro_verified THEN
        v_motivos := array_append(v_motivos, 'REPROCANN_SIN_VERIFICAR');
    ELSIF v_repro_vencimiento IS NULL OR v_repro_vencimiento < v_today THEN
        v_motivos := array_append(v_motivos, 'REPROCANN_VENCIDO');
    ELSE
        v_repro_vigente := true;
    END IF;

    -- E. Documentación obligatoria aprobada (documentos_socio actuales)
    SELECT EXISTS (
        SELECT 1 FROM public.documentos_socio d
        WHERE d.socio_id = p_socio_id::text
          AND d.is_current IS NOT FALSE
          AND lower(btrim(d.tipo)) IN ('declaracion_jurada', 'declaracionjurada')
          AND d.verificacion_estado = 'aprobado'
    ) INTO v_has_ddjj;

    SELECT EXISTS (
        SELECT 1 FROM public.documentos_socio d
        WHERE d.socio_id = p_socio_id::text
          AND d.is_current IS NOT FALSE
          AND lower(btrim(d.tipo)) = 'consentimiento'
          AND d.verificacion_estado = 'aprobado'
    ) INTO v_has_consent;

    v_tipo_repro := lower(btrim(COALESCE(v_socio.reprocann_tipo, '')));
    IF v_tipo_repro = 'autocultivo' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.documentos_socio d
            WHERE d.socio_id = p_socio_id::text
              AND d.is_current IS NOT FALSE
              AND lower(btrim(d.tipo)) IN ('contrato_autocultivo', 'contrato')
              AND d.verificacion_estado = 'aprobado'
        ) INTO v_has_contrato;
    ELSIF v_tipo_repro = 'vinculado_ong' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.documentos_socio d
            WHERE d.socio_id = p_socio_id::text
              AND d.is_current IS NOT FALSE
              AND lower(btrim(d.tipo)) IN ('contrato_madre', 'contrato')
              AND d.verificacion_estado = 'aprobado'
        ) INTO v_has_contrato;
    END IF;

    IF NOT (v_has_ddjj AND v_has_consent AND v_has_contrato) THEN
        v_motivos := array_append(v_motivos, 'DOCUMENTACION_INCOMPLETA');
    END IF;

    v_elegible := (cardinality(v_motivos) = 0);

    RETURN jsonb_build_object(
        'found', true,
        'socioId', p_socio_id,
        'elegibleParaDispensa', v_elegible,
        'accesoDigitalEstado', v_acceso_digital,
        'admisionInstitucional', v_socio.admision_institucional_estado,
        'reprocannVerificado', v_repro_verified,
        'reprocannVigente', v_repro_vigente,
        'reprocannVencimiento', v_repro_vencimiento,
        'documentacionCompleta', (v_has_ddjj AND v_has_consent AND v_has_contrato AND v_repro_vigente),
        'bloqueado', v_bloqueado,
        'motivosRechazo', v_motivos
    );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_socio_dispensation_eligibility(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_socio_dispensation_eligibility(uuid) TO authenticated;

-- 3. RPC de consulta para frontend/API (admin/staff o socio titular)
CREATE OR REPLACE FUNCTION public.get_socio_dispensation_eligibility(p_socio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_role text := lower(btrim(COALESCE(public.get_my_role(), '')));
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
    IF v_role NOT IN ('admin', 'staff') AND NOT EXISTS (
        SELECT 1 FROM public.socios s WHERE s.id = p_socio_id AND (s.auth_user_id = v_actor OR s.user_id = v_actor)
    ) THEN
        RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
    RETURN public.evaluate_socio_dispensation_eligibility(p_socio_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_socio_dispensation_eligibility(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_socio_dispensation_eligibility(uuid) TO authenticated;

-- 4. Actualizar assert_order_business para usar habilitación institucional/documental independiente del acceso digital
CREATE OR REPLACE FUNCTION public.assert_order_business(
    p_socio uuid,
    p_items jsonb,
    p_type text,
    p_address text,
    p_city text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s public.socios;
    i record;
    p public.products;
    v_eval jsonb;
    v_motivos text[];
BEGIN
    IF p_type IS NULL OR p_type NOT IN ('delivery', 'retiro_sede') THEN
        RAISE EXCEPTION 'INVALID_ORDER_TYPE';
    END IF;

    SELECT * INTO s FROM public.socios WHERE id = p_socio FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SOCIO_UNAVAILABLE: Socio no encontrado.';
    END IF;

    v_eval := public.evaluate_socio_dispensation_eligibility(p_socio);
    IF (v_eval->>'elegibleParaDispensa')::boolean IS NOT TRUE THEN
        SELECT ARRAY(SELECT jsonb_array_elements_text(v_eval->'motivosRechazo')) INTO v_motivos;
        IF 'SOCIO_BLOQUEADO' = ANY(v_motivos) THEN
            RAISE EXCEPTION 'SOCIO_BLOQUEADO: El socio posee bloqueo preventivo o suspensión vigente.';
        ELSIF 'SIN_ADMISION_INSTITUCIONAL' = ANY(v_motivos) THEN
            RAISE EXCEPTION 'SIN_ADMISION_INSTITUCIONAL: El socio no cuenta con admisión institucional acreditada.';
        ELSIF 'REPROCANN_SIN_VERIFICAR' = ANY(v_motivos) THEN
            RAISE EXCEPTION 'REPROCANN_SIN_VERIFICAR: El certificado REPROCANN aún no fue verificado.';
        ELSIF 'REPROCANN_VENCIDO' = ANY(v_motivos) THEN
            RAISE EXCEPTION 'REPROCANN_VENCIDO: El certificado REPROCANN se encuentra vencido o sin fecha válida.';
        ELSIF 'DOCUMENTACION_INCOMPLETA' = ANY(v_motivos) THEN
            RAISE EXCEPTION 'DOCUMENTACION_INCOMPLETA: Faltan documentos obligatorios aprobados para dispensar.';
        ELSE
            RAISE EXCEPTION 'SOCIO_UNAVAILABLE';
        END IF;
    END IF;

    IF p_type = 'delivery' AND (
        s.envios_habilitados IS DISTINCT FROM true
        OR coalesce(btrim(p_address), '') = ''
        OR coalesce(btrim(p_city), '') = ''
    ) THEN
        RAISE EXCEPTION 'DELIVERY_DISABLED_OR_ADDRESS_MISSING';
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'EMPTY_ITEMS';
    END IF;

    FOR i IN SELECT * FROM public.order_stock_quantities(p_items) ORDER BY product_id LOOP
        SELECT * INTO p FROM public.products WHERE id = i.product_id;
        IF NOT FOUND OR p.activo IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'PRODUCT_UNAVAILABLE';
        END IF;
    END LOOP;
END;
$$;

COMMIT;
