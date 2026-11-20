-- INC-08: Habilitación institucional/documental independiente del acceso digital,
-- con reconocimientos físicos auditables, excepciones administrativas controladas y registro histórico de entregas.
BEGIN;

-- 1. Campos independientes de admisión institucional en public.socios (sin alterar socios.status digital)
ALTER TABLE public.socios
    ADD COLUMN IF NOT EXISTS admision_institucional_estado text NOT NULL DEFAULT 'pendiente'
        CHECK (admision_institucional_estado IN ('pendiente', 'admitido', 'rechazado', 'suspendido')),
    ADD COLUMN IF NOT EXISTS admision_institucional_at timestamptz,
    ADD COLUMN IF NOT EXISTS admision_institucional_por uuid;

-- Backfill conservador: solo acredita admisión cuando existe evidencia registral previa verificable
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

-- 2. Reconocimientos auditables de documentación física histórica (prohibido para REPROCANN; no marca docs como aprobados)
CREATE TABLE IF NOT EXISTS public.socio_document_legacy_recognitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    command_id uuid NOT NULL UNIQUE,
    socio_id uuid NOT NULL REFERENCES public.socios(id) ON DELETE RESTRICT,
    requisito text NOT NULL CHECK (requisito IN ('admision_institucional', 'consentimiento', 'declaracion_jurada', 'contrato')),
    referencia_fisica text NOT NULL CHECK (length(btrim(referencia_fisica)) >= 3),
    observaciones text,
    reconocido_por uuid NOT NULL REFERENCES auth.users(id),
    reconocido_at timestamptz NOT NULL DEFAULT now(),
    revocado_at timestamptz,
    revocado_por uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_legacy_recognitions_socio_req
    ON public.socio_document_legacy_recognitions (socio_id, requisito)
    WHERE revocado_at IS NULL;

ALTER TABLE public.socio_document_legacy_recognitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.socio_document_legacy_recognitions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.socio_document_legacy_recognitions TO authenticated;

DROP POLICY IF EXISTS legacy_recognitions_staff_read ON public.socio_document_legacy_recognitions;
CREATE POLICY legacy_recognitions_staff_read ON public.socio_document_legacy_recognitions
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'staff'));

-- 3. Excepciones administrativas controladas (solo para requisitos con regularización diferida admisible)
CREATE TABLE IF NOT EXISTS public.dispensation_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    command_id uuid NOT NULL UNIQUE,
    socio_id uuid NOT NULL REFERENCES public.socios(id) ON DELETE RESTRICT,
    requisito_pendiente text NOT NULL CHECK (requisito_pendiente IN (
        'admision_institucional',
        'consentimiento',
        'declaracion_jurada',
        'contrato'
    )),
    justificacion text NOT NULL CHECK (length(btrim(justificacion)) >= 10),
    evidencia_referencia text NOT NULL CHECK (length(btrim(evidencia_referencia)) >= 3),
    autorizado_por uuid NOT NULL REFERENCES auth.users(id),
    autorizado_rol text NOT NULL CHECK (autorizado_rol = 'admin'),
    fecha_decision timestamptz NOT NULL DEFAULT now(),
    vence_el date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 2),
    usos_maximos integer NOT NULL DEFAULT 1 CHECK (usos_maximos = 1),
    pedido_id uuid UNIQUE REFERENCES public.pedidos(id) ON DELETE RESTRICT,
    consumida_at timestamptz,
    consumida_por uuid REFERENCES auth.users(id),
    estado_regularizacion text NOT NULL DEFAULT 'pendiente' CHECK (estado_regularizacion IN ('pendiente', 'regularizada', 'vencida', 'revocada')),
    regularizada_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_dispensation_exceptions_socio_active
    ON public.dispensation_exceptions (socio_id, vence_el)
    WHERE estado_regularizacion = 'pendiente';

ALTER TABLE public.dispensation_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dispensation_exceptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dispensation_exceptions TO authenticated;

DROP POLICY IF EXISTS dispensation_exceptions_staff_read ON public.dispensation_exceptions;
CREATE POLICY dispensation_exceptions_staff_read ON public.dispensation_exceptions
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'staff'));

CREATE OR REPLACE FUNCTION app_private.guard_inc08_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'INC08_APPEND_ONLY: No se permite eliminar registros auditados.' USING ERRCODE = '55000';
    END IF;
    IF TG_TABLE_NAME = 'socio_document_legacy_recognitions' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.command_id IS DISTINCT FROM OLD.command_id
           OR NEW.socio_id IS DISTINCT FROM OLD.socio_id
           OR NEW.requisito IS DISTINCT FROM OLD.requisito
           OR NEW.referencia_fisica IS DISTINCT FROM OLD.referencia_fisica
           OR NEW.reconocido_por IS DISTINCT FROM OLD.reconocido_por
           OR NEW.reconocido_at IS DISTINCT FROM OLD.reconocido_at THEN
            RAISE EXCEPTION 'INC08_APPEND_ONLY: Solo se permite revocar un reconocimiento histórico.' USING ERRCODE = '55000';
        END IF;
    ELSIF TG_TABLE_NAME = 'dispensation_exceptions' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.command_id IS DISTINCT FROM OLD.command_id
           OR NEW.socio_id IS DISTINCT FROM OLD.socio_id
           OR NEW.requisito_pendiente IS DISTINCT FROM OLD.requisito_pendiente
           OR NEW.justificacion IS DISTINCT FROM OLD.justificacion
           OR NEW.evidencia_referencia IS DISTINCT FROM OLD.evidencia_referencia
           OR NEW.autorizado_por IS DISTINCT FROM OLD.autorizado_por
           OR NEW.fecha_decision IS DISTINCT FROM OLD.fecha_decision
           OR (OLD.pedido_id IS NOT NULL AND NEW.pedido_id IS DISTINCT FROM OLD.pedido_id) THEN
            RAISE EXCEPTION 'INC08_APPEND_ONLY: Solo se permite consumir una vez o actualizar seguimiento de regularización.' USING ERRCODE = '55000';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_inc08_legacy_recognitions_immutable ON public.socio_document_legacy_recognitions;
CREATE TRIGGER tr_inc08_legacy_recognitions_immutable
    BEFORE UPDATE OR DELETE ON public.socio_document_legacy_recognitions
    FOR EACH ROW EXECUTE FUNCTION app_private.guard_inc08_append_only();

DROP TRIGGER IF EXISTS tr_inc08_dispensation_exceptions_immutable ON public.dispensation_exceptions;
CREATE TRIGGER tr_inc08_dispensation_exceptions_immutable
    BEFORE UPDATE OR DELETE ON public.dispensation_exceptions
    FOR EACH ROW EXECUTE FUNCTION app_private.guard_inc08_append_only();

-- 4. Registro histórico independiente de entregas ya ocurridas (no descuenta stock ni duplica pagos/límites)
CREATE TABLE IF NOT EXISTS public.historical_dispensation_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    command_id uuid NOT NULL UNIQUE,
    socio_id uuid NOT NULL REFERENCES public.socios(id) ON DELETE RESTRICT,
    fecha_entrega_real timestamptz NOT NULL,
    fecha_registracion timestamptz NOT NULL DEFAULT now(),
    operador_id uuid NOT NULL REFERENCES auth.users(id),
    items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
    evidencia_entrega text NOT NULL CHECK (length(btrim(evidencia_entrega)) >= 3),
    estado_documental_snapshot jsonb NOT NULL,
    irregularidades text[] NOT NULL DEFAULT '{}'::text[],
    estado_revision text NOT NULL DEFAULT 'pendiente_revision' CHECK (estado_revision IN ('pendiente_revision', 'conciliado', 'observado')),
    pedido_conciliado_id uuid REFERENCES public.pedidos(id) ON DELETE RESTRICT,
    notas_revision text,
    revisado_por uuid REFERENCES auth.users(id),
    revisado_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_historical_dispensations_socio
    ON public.historical_dispensation_records (socio_id, fecha_entrega_real DESC);

ALTER TABLE public.historical_dispensation_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.historical_dispensation_records FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.historical_dispensation_records TO authenticated;

DROP POLICY IF EXISTS historical_dispensations_staff_read ON public.historical_dispensation_records;
CREATE POLICY historical_dispensations_staff_read ON public.historical_dispensation_records
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'staff'));

-- 5. Función centralizada de evaluación no restrictiva: separa solicitud, registro administrativo y finalización
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
    v_consent_doc record;
    v_ddjj_doc record;
    v_contrato_estado text := NULL;
    v_repro_vencimiento date := NULL;
    v_repro_vencido_confirmado boolean := false;
    v_repro_rechazado boolean := false;
    v_repro_verificado boolean := false;
    v_admision_rec boolean := false;
    v_consent_rec boolean := false;
    v_ddjj_rec boolean := false;
    v_contrato_rec boolean := false;
    v_bloqueado boolean := false;
    v_bloqueos text[] := ARRAY[]::text[];
    v_advertencias text[] := ARRAY[]::text[];
    v_puede_solicitar boolean := false;
    v_puede_registrar boolean := false;
    v_puede_finalizar boolean := false;
    v_inconsistencia_repro boolean := false;
BEGIN
    SELECT * INTO v_socio FROM public.socios WHERE id = p_socio_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'found', false,
            'puedeSolicitar', false,
            'puedeRegistrarPedido', false,
            'puedeFinalizarDispensa', false,
            'bloqueosObligatorios', ARRAY['SOCIO_NO_ENCONTRADO'],
            'advertenciasDocumentales', ARRAY[]::text[],
            'requiereRegularizacion', false,
            'fuentesVerificadas', '{}'::jsonb
        );
    END IF;

    -- A. Acceso digital (completamente independiente de la dispensa)
    v_acceso_digital := CASE
        WHEN v_socio.bloqueado IS TRUE OR v_socio.status = 'suspended' THEN 'deshabilitado'
        WHEN v_socio.status = 'active' AND v_socio.auth_user_id IS NOT NULL THEN 'activado'
        WHEN v_socio.status = 'invited' THEN 'invitado'
        WHEN v_socio.status = 'ready_to_invite' THEN 'invitacion_pendiente'
        ELSE 'sin_invitacion'
    END;

    -- B. Bloqueo / suspensión obligatoria
    v_bloqueado := COALESCE(v_socio.bloqueado, false)
        OR v_socio.status = 'suspended'
        OR v_socio.admision_institucional_estado IN ('rechazado', 'suspendido');
    IF v_bloqueado THEN
        v_bloqueos := array_append(v_bloqueos, 'SOCIO_BLOQUEADO');
    END IF;

    -- C. Fuentes documentales reales
    SELECT d.verificacion_estado, d.fecha_vencimiento, d.archivo_path
    INTO v_repro_doc
    FROM public.documentos_socio d
    WHERE d.socio_id = p_socio_id::text AND d.is_current IS NOT FALSE AND lower(btrim(d.tipo)) = 'reprocann'
    ORDER BY d.version DESC NULLS LAST, d.created_at DESC LIMIT 1;

    SELECT r.verification_status, r.fecha_vencimiento
    INTO v_repro_prof
    FROM public.socio_reprocann_profiles r
    WHERE r.socio_id = p_socio_id
    ORDER BY r.updated_at DESC LIMIT 1;

    v_repro_verificado := COALESCE(v_repro_doc.verificacion_estado = 'aprobado', false)
        OR (upper(COALESCE(v_repro_prof.verification_status, '')) = 'VERIFIED');

    v_repro_vencimiento := COALESCE(
        v_repro_prof.fecha_vencimiento,
        v_socio.reprocann_fecha_vencimiento,
        v_repro_doc.fecha_vencimiento::date
    );

    -- Solo es vencimiento confirmado si existe fecha conocida < hoy_ART; ausencia de archivo NO equivale a vencimiento
    v_repro_vencido_confirmado := (v_repro_vencimiento IS NOT NULL AND v_repro_vencimiento < v_today);
    v_repro_rechazado := (lower(btrim(COALESCE(v_socio.reprocann_estado, ''))) = 'rechazado')
        OR COALESCE(v_repro_doc.verificacion_estado = 'rechazado', false);

    IF v_repro_rechazado THEN
        v_bloqueos := array_append(v_bloqueos, 'REPROCANN_RECHAZADO');
    ELSIF v_repro_vencido_confirmado THEN
        v_bloqueos := array_append(v_bloqueos, 'REPROCANN_VENCIDO_CONFIRMADO');
    END IF;

    -- Reconocimientos físicos existentes
    SELECT
        EXISTS (SELECT 1 FROM public.socio_document_legacy_recognitions r WHERE r.socio_id = p_socio_id AND r.requisito = 'admision_institucional' AND r.revocado_at IS NULL),
        EXISTS (SELECT 1 FROM public.socio_document_legacy_recognitions r WHERE r.socio_id = p_socio_id AND r.requisito = 'consentimiento' AND r.revocado_at IS NULL),
        EXISTS (SELECT 1 FROM public.socio_document_legacy_recognitions r WHERE r.socio_id = p_socio_id AND r.requisito = 'declaracion_jurada' AND r.revocado_at IS NULL),
        EXISTS (SELECT 1 FROM public.socio_document_legacy_recognitions r WHERE r.socio_id = p_socio_id AND r.requisito = 'contrato' AND r.revocado_at IS NULL)
    INTO v_admision_rec, v_consent_rec, v_ddjj_rec, v_contrato_rec;

    SELECT d.verificacion_estado, d.archivo_path INTO v_consent_doc
    FROM public.documentos_socio d
    WHERE d.socio_id = p_socio_id::text AND d.is_current IS NOT FALSE AND lower(btrim(d.tipo)) = 'consentimiento'
    ORDER BY d.version DESC NULLS LAST, d.created_at DESC LIMIT 1;

    SELECT d.verificacion_estado, d.archivo_path INTO v_ddjj_doc
    FROM public.documentos_socio d
    WHERE d.socio_id = p_socio_id::text AND d.is_current IS NOT FALSE AND lower(btrim(d.tipo)) IN ('declaracion_jurada', 'declaracionjurada')
    ORDER BY d.version DESC NULLS LAST, d.created_at DESC LIMIT 1;

    IF lower(btrim(COALESCE(v_socio.reprocann_tipo, ''))) IN ('autocultivo', 'vinculado_ong') THEN
        SELECT d.verificacion_estado INTO v_contrato_estado
        FROM public.documentos_socio d
        WHERE d.socio_id = p_socio_id::text AND d.is_current IS NOT FALSE
          AND lower(btrim(d.tipo)) IN ('contrato_autocultivo', 'contrato_madre', 'contrato')
        ORDER BY d.version DESC NULLS LAST, d.created_at DESC LIMIT 1;
    END IF;

    -- D. Advertencias documentales subsanables (NO bloquean solicitud, registro ni finalización)
    IF v_repro_doc.archivo_path IS NULL AND v_repro_prof.verification_status IS NULL THEN
        v_advertencias := array_append(v_advertencias, 'REPROCANN_NO_CARGADO');
    ELSIF NOT v_repro_verificado THEN
        v_advertencias := array_append(v_advertencias, 'REPROCANN_PENDIENTE_REVISION');
    END IF;

    v_inconsistencia_repro := (lower(btrim(COALESCE(v_socio.reprocann_estado, ''))) IN ('vigente', 'activo') AND v_repro_vencido_confirmado)
        OR (lower(btrim(COALESCE(v_socio.reprocann_estado, ''))) IN ('vigente', 'activo') AND v_repro_doc.archivo_path IS NULL AND v_repro_prof.verification_status IS NULL);
    IF v_inconsistencia_repro THEN
        v_advertencias := array_append(v_advertencias, 'DATOS_INCONSISTENTES_REPROCANN');
    END IF;

    IF v_socio.admision_institucional_estado <> 'admitido' AND NOT v_admision_rec THEN
        v_advertencias := array_append(v_advertencias, 'ADMISION_PENDIENTE_REGULARIZACION');
    END IF;

    IF COALESCE(v_consent_doc.verificacion_estado = 'aprobado', false) IS NOT TRUE AND NOT v_consent_rec THEN
        v_advertencias := array_append(v_advertencias, CASE WHEN v_consent_doc.archivo_path IS NOT NULL THEN 'CONSENTIMIENTO_PENDIENTE_REVISION' ELSE 'CONSENTIMIENTO_NO_CARGADO' END);
    END IF;

    IF COALESCE(v_ddjj_doc.verificacion_estado = 'aprobado', false) IS NOT TRUE AND NOT v_ddjj_rec THEN
        v_advertencias := array_append(v_advertencias, CASE WHEN v_ddjj_doc.archivo_path IS NOT NULL THEN 'DDJJ_PENDIENTE_REVISION' ELSE 'DDJJ_NO_CARGADA' END);
    END IF;

    IF lower(btrim(COALESCE(v_socio.reprocann_tipo, ''))) IN ('autocultivo', 'vinculado_ong')
       AND COALESCE(v_contrato_estado = 'aprobado', false) IS NOT TRUE AND NOT v_contrato_rec THEN
        v_advertencias := array_append(v_advertencias, 'CONTRATO_NO_CARGADO');
    END IF;

    -- E. Separación explícita de las 3 operaciones
    v_puede_solicitar := NOT v_bloqueado AND (v_socio.auth_user_id IS NOT NULL OR v_socio.status = 'active');
    v_puede_registrar := NOT v_bloqueado;
    v_puede_finalizar := (cardinality(v_bloqueos) = 0);

    RETURN jsonb_build_object(
        'found', true,
        'socioId', p_socio_id,
        'puedeSolicitar', v_puede_solicitar,
        'puedeRegistrarPedido', v_puede_registrar,
        'puedeFinalizarDispensa', v_puede_finalizar,
        'accesoDigitalEstado', v_acceso_digital,
        'bloqueosObligatorios', v_bloqueos,
        'advertenciasDocumentales', v_advertencias,
        'requiereRegularizacion', (cardinality(v_advertencias) > 0),
        'fuentesVerificadas', jsonb_build_object(
            'reprocann', CASE
                WHEN v_repro_rechazado THEN 'rechazado'
                WHEN v_repro_vencido_confirmado THEN 'vencido_confirmado'
                WHEN v_repro_verificado THEN 'verificado_vigente'
                WHEN v_repro_doc.archivo_path IS NOT NULL THEN 'pendiente_revision'
                ELSE 'no_cargado'
            END,
            'reprocannVencimiento', v_repro_vencimiento,
            'admision', CASE WHEN v_socio.admision_institucional_estado = 'admitido' THEN 'acreditada' WHEN v_admision_rec THEN 'fisico_verificado' ELSE 'pendiente_regularizacion' END,
            'consentimiento', CASE WHEN v_consent_doc.verificacion_estado = 'aprobado' THEN 'verificado' WHEN v_consent_rec THEN 'fisico_verificado' WHEN v_consent_doc.archivo_path IS NOT NULL THEN 'pendiente_revision' ELSE 'no_cargado' END,
            'declaracion_jurada', CASE WHEN v_ddjj_doc.verificacion_estado = 'aprobado' THEN 'verificado' WHEN v_ddjj_rec THEN 'fisico_verificado' WHEN v_ddjj_doc.archivo_path IS NOT NULL THEN 'pendiente_revision' ELSE 'no_cargado' END,
            'inconsistenciaReprocann', v_inconsistencia_repro
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_socio_dispensation_eligibility(uuid) FROM PUBLIC, anon, authenticated, service_role;

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
        SELECT 1 FROM public.socios s WHERE s.id = p_socio_id AND (s.auth_user_id = v_actor OR NULLIF(to_jsonb(s)->>'user_id', '')::uuid = v_actor)
    ) THEN
        RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
    RETURN public.evaluate_socio_dispensation_eligibility(p_socio_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_socio_dispensation_eligibility(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_socio_dispensation_eligibility(uuid) TO authenticated;

-- 6. RPCs auditadas e idempotentes: reconocimiento físico, excepción administrativa y registro histórico
CREATE OR REPLACE FUNCTION public.register_legacy_document_recognition_command(
    p_command_id uuid,
    p_socio_id uuid,
    p_requisito text,
    p_referencia_fisica text,
    p_observaciones text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_role text := lower(btrim(COALESCE(public.get_my_role(), '')));
    v_existing public.socio_document_legacy_recognitions%ROWTYPE;
    v_created public.socio_document_legacy_recognitions%ROWTYPE;
BEGIN
    IF v_actor IS NULL OR v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Requiere rol administrativo.' USING ERRCODE = '42501';
    END IF;
    IF p_command_id IS NULL OR p_socio_id IS NULL OR p_requisito NOT IN ('admision_institucional', 'consentimiento', 'declaracion_jurada', 'contrato')
       OR length(btrim(COALESCE(p_referencia_fisica, ''))) < 3 THEN
        RAISE EXCEPTION 'LEGACY_RECOGNITION_INVALID' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 808));
    SELECT * INTO v_existing FROM public.socio_document_legacy_recognitions WHERE command_id = p_command_id;
    IF FOUND THEN
        RETURN jsonb_build_object('recognitionId', v_existing.id, 'reused', true);
    END IF;

    INSERT INTO public.socio_document_legacy_recognitions (command_id, socio_id, requisito, referencia_fisica, observaciones, reconocido_por)
    VALUES (p_command_id, p_socio_id, p_requisito, btrim(p_referencia_fisica), p_observaciones, v_actor)
    RETURNING * INTO v_created;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details, created_at)
    VALUES (v_actor, 'CREATE', 'LEGACY_DOC_RECOGNITION', v_created.id::text,
        jsonb_build_object('commandId', p_command_id, 'socioId', p_socio_id, 'requisito', p_requisito, 'referenciaFisica', p_referencia_fisica), now());

    RETURN jsonb_build_object('recognitionId', v_created.id, 'reused', false);
END;
$$;

REVOKE ALL ON FUNCTION public.register_legacy_document_recognition_command(uuid, uuid, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.register_legacy_document_recognition_command(uuid, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.grant_dispensation_exception_command(
    p_command_id uuid,
    p_socio_id uuid,
    p_requisito_pendiente text,
    p_justificacion text,
    p_evidencia_referencia text,
    p_vence_el date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_role text := lower(btrim(COALESCE(public.get_my_role(), '')));
    v_eval jsonb;
    v_bloqueos text[];
    v_existing public.dispensation_exceptions%ROWTYPE;
    v_created public.dispensation_exceptions%ROWTYPE;
BEGIN
    IF v_actor IS NULL OR v_role <> 'admin' THEN
        RAISE EXCEPTION 'EXCEPTION_ADMIN_REQUIRED: Solo un administrador puede autorizar excepciones.' USING ERRCODE = '42501';
    END IF;
    IF p_command_id IS NULL OR p_socio_id IS NULL
       OR p_requisito_pendiente NOT IN ('admision_institucional', 'consentimiento', 'declaracion_jurada', 'contrato')
       OR length(btrim(COALESCE(p_justificacion, ''))) < 10
       OR length(btrim(COALESCE(p_evidencia_referencia, ''))) < 3
       OR (p_vence_el IS NOT NULL AND p_vence_el > ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 7)) THEN
        RAISE EXCEPTION 'EXCEPTION_PARAMS_INVALID: Justificación (>=10 caracteres), evidencia, requisito admisible y vigencia máx 7 días requeridos.' USING ERRCODE = '22023';
    END IF;

    v_eval := public.evaluate_socio_dispensation_eligibility(p_socio_id);
    SELECT ARRAY(SELECT jsonb_array_elements_text(v_eval->'bloqueosObligatorios')) INTO v_bloqueos;
    IF cardinality(v_bloqueos) > 0 THEN
        RAISE EXCEPTION 'EXCEPTION_FORBIDDEN_BY_MANDATORY_BLOCK: No se admite excepción ante bloqueos obligatorios (%).', array_to_string(v_bloqueos, ', ') USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 809));
    SELECT * INTO v_existing FROM public.dispensation_exceptions WHERE command_id = p_command_id;
    IF FOUND THEN
        RETURN jsonb_build_object('exceptionId', v_existing.id, 'reused', true);
    END IF;

    INSERT INTO public.dispensation_exceptions (
        command_id, socio_id, requisito_pendiente, justificacion, evidencia_referencia,
        autorizado_por, autorizado_rol, vence_el
    ) VALUES (
        p_command_id, p_socio_id, p_requisito_pendiente, btrim(p_justificacion), btrim(p_evidencia_referencia),
        v_actor, 'admin', COALESCE(p_vence_el, ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 2))
    )
    RETURNING * INTO v_created;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details, created_at)
    VALUES (v_actor, 'CREATE', 'DISPENSATION_EXCEPTION', v_created.id::text,
        jsonb_build_object('commandId', p_command_id, 'socioId', p_socio_id, 'requisito', p_requisito_pendiente, 'justificacion', p_justificacion, 'evidencia', p_evidencia_referencia), now());

    RETURN jsonb_build_object('exceptionId', v_created.id, 'reused', false);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_dispensation_exception_command(uuid, uuid, text, text, text, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.grant_dispensation_exception_command(uuid, uuid, text, text, text, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_dispensation_exception_command(
    p_exception_id uuid,
    p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_role text := lower(btrim(COALESCE(public.get_my_role(), '')));
BEGIN
    IF v_actor IS NULL OR v_role <> 'admin' THEN
        RAISE EXCEPTION 'EXCEPTION_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF p_exception_id IS NULL OR length(btrim(COALESCE(p_motivo, ''))) < 5 THEN
        RAISE EXCEPTION 'EXCEPTION_REVOKE_INVALID' USING ERRCODE = '22023';
    END IF;
    UPDATE public.dispensation_exceptions
    SET estado_regularizacion = 'revocada'
    WHERE id = p_exception_id AND estado_regularizacion = 'pendiente' AND pedido_id IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'EXCEPTION_NOT_REVOCABLE' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details, created_at)
    VALUES (v_actor, 'UPDATE', 'DISPENSATION_EXCEPTION', p_exception_id::text, jsonb_build_object('estado', 'revocada', 'motivo', p_motivo), now());
    RETURN jsonb_build_object('exceptionId', p_exception_id, 'estado', 'revocada');
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_dispensation_exception_command(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_dispensation_exception_command(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_historical_dispensation_command(
    p_command_id uuid,
    p_socio_id uuid,
    p_fecha_entrega_real timestamptz,
    p_items jsonb,
    p_evidencia_entrega text,
    p_irregularidades text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_role text := lower(btrim(COALESCE(public.get_my_role(), '')));
    v_existing public.historical_dispensation_records%ROWTYPE;
    v_created public.historical_dispensation_records%ROWTYPE;
    v_snapshot jsonb;
BEGIN
    IF v_actor IS NULL OR v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Requiere rol administrativo.' USING ERRCODE = '42501';
    END IF;
    IF p_command_id IS NULL OR p_socio_id IS NULL OR p_fecha_entrega_real IS NULL
       OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0
       OR length(btrim(COALESCE(p_evidencia_entrega, ''))) < 3 THEN
        RAISE EXCEPTION 'HISTORICAL_DISPENSATION_INVALID' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 810));
    SELECT * INTO v_existing FROM public.historical_dispensation_records WHERE command_id = p_command_id;
    IF FOUND THEN
        RETURN jsonb_build_object('historicalRecordId', v_existing.id, 'estadoRevision', v_existing.estado_revision, 'reused', true);
    END IF;

    v_snapshot := public.evaluate_socio_dispensation_eligibility(p_socio_id);

    INSERT INTO public.historical_dispensation_records (
        command_id, socio_id, fecha_entrega_real, operador_id, items,
        evidencia_entrega, estado_documental_snapshot, irregularidades, estado_revision
    ) VALUES (
        p_command_id, p_socio_id, p_fecha_entrega_real, v_actor, p_items,
        btrim(p_evidencia_entrega), v_snapshot, COALESCE(p_irregularidades, '{}'::text[]),
        CASE WHEN COALESCE(cardinality(p_irregularidades), 0) > 0 OR (v_snapshot->>'elegibleParaDispensa')::boolean IS NOT TRUE THEN 'observado' ELSE 'pendiente_revision' END
    )
    RETURNING * INTO v_created;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details, created_at)
    VALUES (v_actor, 'CREATE', 'HISTORICAL_DISPENSATION', v_created.id::text,
        jsonb_build_object('commandId', p_command_id, 'socioId', p_socio_id, 'fechaEntregaReal', p_fecha_entrega_real, 'irregularidades', v_created.irregularidades), now());

    RETURN jsonb_build_object('historicalRecordId', v_created.id, 'estadoRevision', v_created.estado_revision, 'reused', false);
END;
$$;

REVOKE ALL ON FUNCTION public.register_historical_dispensation_command(uuid, uuid, timestamptz, jsonb, text, text[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.register_historical_dispensation_command(uuid, uuid, timestamptz, jsonb, text, text[]) TO authenticated;

-- 7. Actualizar assert_order_business: permite solicitud y registro administrativo salvo bloqueo operativo/suspensión;
-- los impedimentos confirmados de finalización (p.ej. REPROCANN vencido confirmado) se controlan al finalizar la entrega.
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
BEGIN
    IF p_type IS NULL OR p_type NOT IN ('delivery', 'retiro_sede') THEN
        RAISE EXCEPTION 'INVALID_ORDER_TYPE';
    END IF;

    SELECT * INTO s FROM public.socios WHERE id = p_socio FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SOCIO_UNAVAILABLE: Socio no encontrado.';
    END IF;

    v_eval := public.evaluate_socio_dispensation_eligibility(p_socio);
    IF (v_eval->>'puedeRegistrarPedido')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'SOCIO_BLOQUEADO: El socio posee bloqueo preventivo o suspensión vigente.';
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

-- 7b. Control obligatorio al finalizar entrega/retiro (impide finalizar si hay bloqueo o REPROCANN vencido/rechazado confirmado)
CREATE OR REPLACE FUNCTION app_private.enforce_finalization_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_eval jsonb;
    v_bloqueos text[];
BEGIN
    IF NEW.estado IN ('entregado', 'retirado') AND OLD.estado IS DISTINCT FROM NEW.estado AND NEW.socio_id IS NOT NULL THEN
        v_eval := public.evaluate_socio_dispensation_eligibility(NEW.socio_id);
        IF (v_eval->>'puedeFinalizarDispensa')::boolean IS NOT TRUE THEN
            SELECT ARRAY(SELECT jsonb_array_elements_text(v_eval->'bloqueosObligatorios')) INTO v_bloqueos;
            IF 'SOCIO_BLOQUEADO' = ANY(v_bloqueos) THEN
                RAISE EXCEPTION 'SOCIO_BLOQUEADO: No se puede finalizar dispensa con bloqueo preventivo o suspensión.';
            ELSIF 'REPROCANN_RECHAZADO' = ANY(v_bloqueos) THEN
                RAISE EXCEPTION 'REPROCANN_RECHAZADO: El trámite REPROCANN figura rechazado.';
            ELSIF 'REPROCANN_VENCIDO_CONFIRMADO' = ANY(v_bloqueos) THEN
                RAISE EXCEPTION 'REPROCANN_VENCIDO_CONFIRMADO: El certificado REPROCANN tiene vencimiento confirmado anterior a hoy.';
            ELSE
                RAISE EXCEPTION 'DISPENSATION_FINALIZATION_BLOCKED';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.enforce_finalization_eligibility() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_b_inc08_finalization_eligibility ON public.pedidos;
CREATE TRIGGER tr_b_inc08_finalization_eligibility
    BEFORE UPDATE ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION app_private.enforce_finalization_eligibility();

-- 8. Consumo atómico de excepción única al insertar pedido
CREATE OR REPLACE FUNCTION app_private.consume_dispensation_exception_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
    v_exc_id uuid;
BEGIN
    IF NEW.estado = 'cancelado' OR NEW.socio_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT e.id INTO v_exc_id
    FROM public.dispensation_exceptions e
    WHERE e.socio_id = NEW.socio_id
      AND e.estado_regularizacion = 'pendiente'
      AND e.vence_el >= v_today
      AND e.pedido_id IS NULL
    ORDER BY e.fecha_decision DESC
    LIMIT 1
    FOR UPDATE;

    IF v_exc_id IS NOT NULL THEN
        UPDATE public.dispensation_exceptions
        SET pedido_id = NEW.id,
            consumida_at = now(),
            consumida_por = COALESCE(auth.uid(), NEW.created_by_user_id)
        WHERE id = v_exc_id AND pedido_id IS NULL;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.consume_dispensation_exception_on_order() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_z_inc08_consume_exception ON public.pedidos;
CREATE TRIGGER tr_z_inc08_consume_exception
    AFTER INSERT ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION app_private.consume_dispensation_exception_on_order();

COMMIT;
