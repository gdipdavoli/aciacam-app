DO $$ BEGIN
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_admin') THEN CREATE ROLE supabase_admin; END IF;
END $$;
CREATE SCHEMA auth; CREATE SCHEMA app_private;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb, last_sign_in_at timestamptz, created_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(auth.jwt()->>'role',current_user::text) $$;
GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
SET check_function_bodies=off;
CREATE TABLE "public"."socios" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL,"orden_libro" int4,"acta_numero" int4,"debe" text,"fecha_ingreso_ong" date,"nombre" text,"apellido" text,"dni" text,"telefono" text,"fecha_nacimiento" date,"email" text,"reprocann_num_tramite" text,"reprocann_fecha_alta" date,"reprocann_estado" text,"reprocann_tipo" text,"medico_nombre" text,"medico_matricula" text,"diagnostico" text,"contrato_valor" int4,"contrato_estado" text,"localidad" text,"domicilio" text,"user_id" uuid,"password_set" bool DEFAULT false,"rol" text DEFAULT 'socio'::text NOT NULL,"created_by" uuid,"auth_user_id" uuid,"status" text DEFAULT 'ready_to_invite'::text NOT NULL,"invited_at" timestamptz,"invited_by" uuid,"terms_accepted_at" timestamptz,"terms_version" text DEFAULT 'v1'::text,"onboarding_completed_at" timestamptz,"envios_habilitados" bool DEFAULT false,"bloqueado" bool DEFAULT false,"motivo_bloqueo" text,"reprocann_fecha_vencimiento" date);
CREATE TABLE "public"."pickup_config" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"day_of_week" int4 NOT NULL,"start_time" time NOT NULL,"end_time" time NOT NULL,"capacity" int4 DEFAULT 1 NOT NULL,"active" bool DEFAULT true NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."pickup_slots" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"start_time" timestamptz NOT NULL,"end_time" timestamptz NOT NULL,"capacity" int4 DEFAULT 1 NOT NULL,"status" text DEFAULT 'active'::text NOT NULL,"source_config_id" uuid,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."audit_findings" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"finding_type" varchar NOT NULL,"domain" varchar NOT NULL,"severity" varchar NOT NULL,"socio_id" uuid,"entity_type" varchar,"entity_id" uuid,"title" varchar NOT NULL,"description" text,"expected_data" jsonb DEFAULT '{}'::jsonb,"observed_data" jsonb DEFAULT '{}'::jsonb,"evidence" jsonb DEFAULT '{}'::jsonb,"suggested_action" text,"dedup_key" varchar NOT NULL,"status" varchar DEFAULT 'OPEN'::character varying NOT NULL,"detected_at" timestamptz DEFAULT now() NOT NULL,"last_seen_at" timestamptz DEFAULT now() NOT NULL,"reviewed_by" uuid,"reviewed_at" timestamptz,"resolution_note" text,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."socio_invites" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"socio_id" uuid NOT NULL,"email" text NOT NULL,"token" text NOT NULL,"expires_at" timestamptz NOT NULL,"used_at" timestamptz,"created_at" timestamptz DEFAULT now(),"created_by" text,"sent_at" timestamptz,"consumed_at" timestamptz,"status" text,"email_status" text,"email_provider_id" text,"last_error" text);
CREATE TABLE "public"."pagos" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"socio_id" uuid,"fecha" date DEFAULT CURRENT_DATE,"concepto" text NOT NULL,"monto" numeric NOT NULL,"medio_de_pago" text,"notas" text,"created_at" timestamptz DEFAULT now(),"created_by" uuid,"pedido_id" uuid,"referencia" text);
CREATE TABLE "public"."communication_intents" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"socio_id" uuid NOT NULL,"action_type" text NOT NULL,"subject_type" text NOT NULL,"subject_reference" text NOT NULL,"dedup_key" text NOT NULL,"status" text DEFAULT 'PENDING'::text NOT NULL,"approval_state" text DEFAULT 'NONE'::text,"requires_approval" bool DEFAULT false,"test_mode" bool DEFAULT false,"metadata" jsonb DEFAULT '{}'::jsonb,"created_at" timestamptz DEFAULT now(),"updated_at" timestamptz DEFAULT now(),"reviewed_by" uuid,"reviewed_at" timestamptz,"review_notes" text);
CREATE TABLE "public"."notificaciones" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"socio_id" uuid NOT NULL,"titulo" text NOT NULL,"mensaje" text NOT NULL,"leido" bool DEFAULT false,"tipo" text DEFAULT 'general'::text,"metadata" jsonb DEFAULT '{}'::jsonb,"fecha_creacion" timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,"es_para_admin" bool DEFAULT false,"remitente_id" uuid,"parent_id" uuid,"estado" text DEFAULT 'abierto'::text,"es_informativo" bool DEFAULT false,"asignado_a" uuid,"oculto_para_socio" bool DEFAULT false);
CREATE TABLE "public"."products" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"nombre" text NOT NULL,"tipo" text NOT NULL,"descripcion" text,"categoria" text,"stock_disponible" int4 DEFAULT 0,"precio" numeric DEFAULT 0,"activo" bool DEFAULT true,"imagen" text,"created_at" timestamptz DEFAULT now(),"updated_at" timestamptz DEFAULT now(),"peso_gramos" numeric DEFAULT 10,"last_audit_note" text,"last_audit_order_id" uuid);
CREATE TABLE "public"."pedidos" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"socio_id" uuid,"tipo_pedido" text,"origen" text DEFAULT 'app'::text,"fecha_creacion" timestamptz DEFAULT now(),"estado" text DEFAULT 'pendiente'::text,"items" jsonb DEFAULT '[]'::jsonb,"observaciones" text,"direccion_entrega" text,"localidad" text,"fecha_retiro_preferida" date,"franja_horaria" text,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL,"slot_id" uuid,"requires_rescheduling" bool DEFAULT false NOT NULL,"archivado" bool DEFAULT false,"total" numeric DEFAULT 0,"metodo_pago" text DEFAULT 'efectivo'::text,"comprobante_pago" text,"ubicacion_gps" text,"entrega_estimada" text);
CREATE TABLE "public"."communication_delivery_attempts" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"intent_id" uuid NOT NULL,"channel" text NOT NULL,"status" text DEFAULT 'PENDING'::text NOT NULL,"attempt_number" int4 DEFAULT 1 NOT NULL,"provider" text NOT NULL,"provider_message_id" text,"error_code" text,"error_summary" text,"test_mode" bool DEFAULT false,"created_at" timestamptz DEFAULT now(),"completed_at" timestamptz);
CREATE TABLE "public"."profile_update_proposals" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"socio_id" uuid NOT NULL,"document_id" uuid NOT NULL,"extraction_id" uuid NOT NULL,"field_name" varchar NOT NULL,"target_column" varchar NOT NULL,"operation" varchar NOT NULL,"current_value" jsonb,"proposed_value" jsonb NOT NULL,"extraction_confidence" numeric,"source_reference" varchar,"status" varchar DEFAULT 'PENDING_REVIEW'::character varying NOT NULL,"source_extraction_status" varchar NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL,"reviewed_at" timestamptz,"reviewed_by" uuid,"review_notes" text);
CREATE TABLE "public"."cierres_mensuales" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"socio_id" uuid,"periodo" varchar NOT NULL,"numero_constancia" varchar NOT NULL,"fecha_generacion" timestamptz DEFAULT now() NOT NULL,"generado_por" uuid,"datos" jsonb NOT NULL,"hash_sha256" text NOT NULL,"estado" varchar DEFAULT 'emitido'::character varying NOT NULL,"fecha_anulacion" timestamptz,"motivo_anulacion" text,"anulado_por" uuid);
CREATE TABLE "public"."audit_logs" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"user_id" uuid,"actor_socio_id" uuid,"action" text NOT NULL,"entity_type" text NOT NULL,"entity_id" text NOT NULL,"details" jsonb NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."global_configs" ("key" text NOT NULL,"value" jsonb,"updated_at" timestamptz DEFAULT now());
CREATE TABLE "public"."documentos_socio" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"socio_id" text,"tipo" text,"archivo_path" text,"estado" text,"created_at" timestamptz DEFAULT now(),"verificacion_estado" text DEFAULT 'pendiente'::text NOT NULL,"verificacion_obs" text,"verificado_at" timestamptz,"verificado_por" text,"fecha_vencimiento" timestamptz,"uploaded_by" text,"recordatorios_enviados" int4 DEFAULT 0 NOT NULL,"ultimo_recordatorio_at" timestamptz,"fecha_emision" date,"monto" numeric,"observaciones" text,"user_id" uuid DEFAULT auth.uid(),"onboarding_document_id" uuid,"document_fingerprint" text,"onboarding_extraction_id" uuid,"version" int4 DEFAULT 1 NOT NULL,"supersedes_document_id" uuid,"is_current" bool DEFAULT true NOT NULL);
CREATE TABLE "public"."agent_events" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"event_type" text NOT NULL,"entity" text NOT NULL,"entity_id" uuid,"payload" jsonb NOT NULL,"status" text DEFAULT 'pending'::text,"created_at" timestamptz DEFAULT now());
CREATE TABLE "public"."agent_tasks" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"title" text NOT NULL,"description" text,"status" text DEFAULT 'pending'::text,"assigned_agent" text NOT NULL,"scheduled_for" timestamptz,"completed_at" timestamptz,"created_at" timestamptz DEFAULT now());
CREATE TABLE "public"."agent_runs" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"agent" text NOT NULL,"input" text NOT NULL,"output" text,"duration_ms" int4,"tokens_used" int4,"status" text DEFAULT 'success'::text,"created_at" timestamptz DEFAULT now());
CREATE TABLE "public"."order_confirmation_receipts" ("order_id" uuid NOT NULL,"request_hash" text NOT NULL,"actor_id" uuid NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."documentos_socio_versiones" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"documento_id" uuid NOT NULL,"socio_id" text NOT NULL,"datos" jsonb NOT NULL,"archived_at" timestamptz DEFAULT now() NOT NULL,"archived_by" uuid);
CREATE TABLE "public"."onboarding_applications" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"run_id" text,"status" text DEFAULT 'DRAFT'::text NOT NULL,"test_mode" bool DEFAULT true NOT NULL,"applicant_data" jsonb DEFAULT '{}'::jsonb NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."onboarding_documents" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"application_id" uuid NOT NULL,"document_type" text NOT NULL,"storage_path" text NOT NULL,"document_fingerprint" text NOT NULL,"extraction_status" text,"uploaded_at" timestamptz DEFAULT now() NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."onboarding_extractions" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"application_id" uuid NOT NULL,"document_id" uuid NOT NULL,"document_type" text NOT NULL,"document_fingerprint" text NOT NULL,"extractor_name" text NOT NULL,"extractor_version" text NOT NULL,"schema_version" text NOT NULL,"status" text NOT NULL,"structured_facts" jsonb DEFAULT '{}'::jsonb NOT NULL,"extracted_at" timestamptz DEFAULT now() NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."onboarding_proposals" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"application_id" uuid NOT NULL,"status" text DEFAULT 'AWAITING_REVIEW'::text NOT NULL,"test_mode" bool DEFAULT true NOT NULL,"proposal_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,"proposal_hash" text NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL,"approved_proposal_hash" text,"approved_at" timestamptz,"approved_by" text,"review_comment" text,"rejected_at" timestamptz,"rejected_by" text,"rejection_reason" text,"rejected_proposal_hash" text);
CREATE TABLE "public"."onboarding_review_events" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"proposal_id" uuid NOT NULL,"application_id" uuid NOT NULL,"actor_id" text NOT NULL,"proposal_hash" text NOT NULL,"decision" text NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."socio_clinical_profiles" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"socio_id" uuid NOT NULL,"diagnostico_literal" text NOT NULL,"medico_nombre" text NOT NULL,"medico_matricula" text NOT NULL,"medico_especialidad" text,"fecha_firma_consentimiento" date,"documento_fuente_id" uuid,"onboarding_extraction_id" uuid,"verified_at" timestamptz DEFAULT now() NOT NULL,"verified_by" text NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."onboarding_application_materializations" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"application_id" uuid NOT NULL,"proposal_id" uuid NOT NULL,"approved_proposal_hash" text NOT NULL,"socio_id" uuid NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"created_by" text NOT NULL);
CREATE TABLE "public"."onboarding_apply_attempts" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"application_id" uuid NOT NULL,"proposal_id" uuid NOT NULL,"step_name" text NOT NULL,"status" text NOT NULL,"error_code" text,"error_message" text,"attempt_number" int4 DEFAULT 1 NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."socio_reprocann_profiles" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"socio_id" uuid NOT NULL,"numero_tramite" text NOT NULL,"fecha_alta" date,"fecha_vencimiento" date,"tipo" text,"documento_fuente_id" uuid,"onboarding_extraction_id" uuid,"verification_status" text DEFAULT 'VERIFIED'::text NOT NULL,"verified_at" timestamptz DEFAULT now() NOT NULL,"verified_by" text NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL,"document_extraction_id" uuid);
CREATE TABLE "public"."onboarding_invite_attempts" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"application_id" uuid NOT NULL,"socio_id" uuid NOT NULL,"step_name" text NOT NULL,"status" text NOT NULL,"delivery_attempt_id" uuid,"error_code" text,"error_message" text,"attempt_number" int4 DEFAULT 1 NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL,"idempotency_key" text,"actor_id" uuid,"auth_user_id" uuid);
CREATE TABLE "public"."document_extractions" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"document_id" uuid,"socio_id" uuid,"document_type" varchar NOT NULL,"source_fingerprint" varchar,"extractor_name" varchar NOT NULL,"extractor_version" varchar NOT NULL,"schema_version" varchar NOT NULL,"status" varchar NOT NULL,"extracted_data" jsonb DEFAULT '{}'::jsonb NOT NULL,"warnings" jsonb DEFAULT '[]'::jsonb,"error_code" varchar,"extracted_at" timestamptz DEFAULT now() NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL,"document_fingerprint" text,"structured_facts" jsonb DEFAULT '{}'::jsonb NOT NULL,"raw_response" jsonb);
CREATE TABLE "public"."reprocann_renewal_applications" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"socio_id" uuid NOT NULL,"status" text DEFAULT 'STAGED'::text NOT NULL,"current_reprocann_profile_id" uuid,"current_document_id" uuid,"staging_document_path" text NOT NULL,"document_fingerprint" text NOT NULL,"mime_type" text NOT NULL,"file_size_bytes" int8 NOT NULL,"submitted_by" uuid,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."reprocann_renewal_review_events" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"proposal_id" uuid NOT NULL,"application_id" uuid NOT NULL,"actor_id" uuid NOT NULL,"proposal_hash" text NOT NULL,"decision" text NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."reprocann_renewal_proposals" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"renewal_application_id" uuid NOT NULL,"socio_id" uuid NOT NULL,"status" text DEFAULT 'AWAITING_REVIEW'::text NOT NULL,"proposal_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,"proposal_hash" text NOT NULL,"approved_proposal_hash" text,"approved_at" timestamptz,"approved_by" uuid,"rejected_at" timestamptz,"rejected_by" uuid,"rejection_reason" text,"review_comment" text,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL,"document_extraction_id" uuid);
CREATE TABLE "public"."reprocann_renewal_apply_events" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"proposal_id" uuid NOT NULL,"application_id" uuid NOT NULL,"socio_id" uuid NOT NULL,"actor_id" uuid NOT NULL,"event_type" text NOT NULL,"attempt_id" uuid NOT NULL,"proposal_hash" text NOT NULL,"materialized_document_id" uuid,"result_code" text,"error_code" text,"details" jsonb DEFAULT '{}'::jsonb NOT NULL,"created_at" timestamptz DEFAULT clock_timestamp() NOT NULL);
CREATE TABLE "public"."historical_reprocann_migration_proposals" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"socio_id" uuid NOT NULL,"status" text NOT NULL,"source_classification" text NOT NULL,"evidence_tier" text NOT NULL,"legacy_snapshot" jsonb NOT NULL,"document_snapshot" jsonb,"data_provenance" jsonb NOT NULL,"proposed_canonical_profile" jsonb NOT NULL,"diff" jsonb NOT NULL,"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,"proposal_hash" text NOT NULL,"source_state_hash" text NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"created_by" uuid,"reviewed_at" timestamptz,"reviewed_by" uuid,"review_comment" text,"approved_proposal_hash" text);
CREATE TABLE "public"."historical_reprocann_migration_review_events" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"proposal_id" uuid NOT NULL,"socio_id" uuid NOT NULL,"actor_id" uuid NOT NULL,"proposal_hash" text NOT NULL,"decision" text NOT NULL,"review_comment" text,"created_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE "public"."historical_reprocann_migration_apply_events" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"proposal_id" uuid NOT NULL,"socio_id" uuid NOT NULL,"actor_id" uuid NOT NULL,"proposal_hash" text NOT NULL,"event_type" text NOT NULL,"error_details" text,"created_at" timestamptz DEFAULT now() NOT NULL);
CREATE OR REPLACE FUNCTION public.get_last_sign_in(auth_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT last_sign_in_at FROM auth.users WHERE id = auth_id;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_onboarding_review_proposal(p_proposal_id uuid, p_action text, p_expected_proposal_hash text, p_actor_id text, p_rejection_reason text DEFAULT NULL::text, p_review_comment text DEFAULT NULL::text)
 RETURNS TABLE(proposal_id uuid, application_id uuid, new_status text, result_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_prop RECORD;
    v_app RECORD;
    v_action_clean TEXT;
    v_actor_clean TEXT;
    v_exp_hash_clean TEXT;
    v_reason_clean TEXT;
    v_comment_clean TEXT;
BEGIN
    -- 0. Normalización y validación estricta de inputs
    v_action_clean := UPPER(TRIM(COALESCE(p_action, '')));
    IF v_action_clean NOT IN ('APPROVE', 'REJECT') THEN
        RAISE EXCEPTION 'INVALID_REVIEW_ACTION: La accion debe ser APPROVE o REJECT.';
    END IF;

    v_actor_clean := TRIM(COALESCE(p_actor_id, ''));
    IF v_actor_clean = '' THEN
        RAISE EXCEPTION 'APPROVED_PROPOSAL_HASH_MISSING: El actor_id es obligatorio.';
    END IF;

    v_exp_hash_clean := TRIM(COALESCE(p_expected_proposal_hash, ''));
    IF v_exp_hash_clean = '' THEN
        RAISE EXCEPTION 'APPROVED_PROPOSAL_HASH_MISSING: expected_proposal_hash es obligatorio.';
    END IF;

    v_comment_clean := NULLIF(TRIM(COALESCE(p_review_comment, '')), '');

    -- 1. Lock y comprobación de existencia de Propuesta (FOR UPDATE - Orden Canónico 1)
    SELECT * INTO v_prop FROM public.onboarding_proposals WHERE id = p_proposal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROPOSAL_NOT_FOUND: La propuesta especificada no existe.';
    END IF;

    -- 2. Lock y comprobación de existencia de Solicitud (FOR UPDATE - Orden Canónico 2)
    SELECT * INTO v_app FROM public.onboarding_applications WHERE id = v_prop.application_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'APPLICATION_NOT_FOUND: La solicitud asociada no existe.';
    END IF;

    -- 3. Validaciones de Hash Fail-Closed
    IF v_prop.proposal_hash IS NULL THEN
        RAISE EXCEPTION 'APPROVED_PROPOSAL_HASH_MISSING: proposal_hash de la propuesta es nulo.';
    END IF;

    -- 4. Lógica de APPROVE
    IF v_action_clean = 'APPROVE' THEN
        -- Idempotencia y Verificación de Consistencia en Retry APPROVE (0 eventos nuevos)
        IF v_prop.status = 'APPROVED' THEN
            IF v_app.status <> 'APPROVED'
               OR v_prop.approved_proposal_hash IS NULL
               OR v_prop.approved_proposal_hash <> v_exp_hash_clean
               OR v_prop.proposal_hash <> v_exp_hash_clean
               OR v_prop.approved_at IS NULL
               OR v_prop.approved_by IS NULL
               OR TRIM(v_prop.approved_by) = '' THEN
                RAISE EXCEPTION 'REVIEW_STATE_INTEGRITY_MISMATCH: Inconsistencia de estado o linaje en propuesta/solicitud previamente aprobada.';
            END IF;

            IF v_prop.approved_by <> v_actor_clean
               OR v_prop.review_comment IS DISTINCT FROM v_comment_clean THEN
                RAISE EXCEPTION 'REVIEW_RETRY_MISMATCH: El actor o comentario del retry difiere de la aprobacion original.';
            END IF;

            RETURN QUERY SELECT v_prop.id, v_prop.application_id, 'APPROVED'::TEXT, 'IDEMPOTENT_RETRY'::TEXT;
            RETURN;
        END IF;

        -- Bloqueo de transiciones inválidas
        IF v_prop.status = 'REJECTED' THEN
            RAISE EXCEPTION 'INVALID_PROPOSAL_TRANSITION: No se permite aprobar una propuesta previamente rechazada.';
        ELSIF v_prop.status <> 'AWAITING_REVIEW' THEN
            RAISE EXCEPTION 'INVALID_PROPOSAL_TRANSITION: La propuesta no esta en estado AWAITING_REVIEW.';
        END IF;

        -- Guarda de Consistencia de Estado de Solicitud para Primera Aprobación
        IF v_app.status <> 'AWAITING_REVIEW' THEN
            RAISE EXCEPTION 'REVIEW_STATE_INTEGRITY_MISMATCH: La solicitud asociada no se encuentra en estado AWAITING_REVIEW.';
        END IF;

        -- Validación de coincidencia estricta de hash
        IF v_prop.proposal_hash <> v_exp_hash_clean THEN
            RAISE EXCEPTION 'APPROVED_CONTENT_MISMATCH: El proposal_hash actual no coincide con expected_proposal_hash.';
        END IF;

        -- Mutación Atómica de Propuesta, Solicitud y Evento de Auditoría (Primera Decisión)
        UPDATE public.onboarding_proposals
        SET status = 'APPROVED',
            approved_proposal_hash = v_prop.proposal_hash,
            approved_at = clock_timestamp(),
            approved_by = v_actor_clean,
            review_comment = v_comment_clean,
            updated_at = clock_timestamp()
        WHERE id = p_proposal_id;

        UPDATE public.onboarding_applications
        SET status = 'APPROVED',
            updated_at = clock_timestamp()
        WHERE id = v_prop.application_id;

        INSERT INTO public.onboarding_review_events (
            proposal_id,
            application_id,
            actor_id,
            proposal_hash,
            decision,
            created_at
        ) VALUES (
            v_prop.id,
            v_prop.application_id,
            v_actor_clean,
            v_prop.proposal_hash,
            'APPROVED',
            clock_timestamp()
        );

        RETURN QUERY SELECT v_prop.id, v_prop.application_id, 'APPROVED'::TEXT, 'SUCCESS'::TEXT;
        RETURN;
    END IF;

    -- 5. Lógica de REJECT
    IF v_action_clean = 'REJECT' THEN
        v_reason_clean := NULLIF(TRIM(COALESCE(p_rejection_reason, '')), '');
        IF v_reason_clean IS NULL THEN
            RAISE EXCEPTION 'REJECTION_REASON_REQUIRED: La razon de rechazo es obligatoria para la accion REJECT.';
        END IF;

        -- Idempotencia y Verificación de Consistencia en Retry REJECT (0 eventos nuevos)
        IF v_prop.status = 'REJECTED' THEN
            IF v_app.status <> 'REJECTED'
               OR v_prop.rejected_proposal_hash IS NULL
               OR v_prop.rejected_proposal_hash <> v_exp_hash_clean
               OR v_prop.proposal_hash <> v_exp_hash_clean
               OR v_prop.rejected_at IS NULL
               OR v_prop.rejected_by IS NULL
               OR TRIM(v_prop.rejected_by) = ''
               OR v_prop.rejection_reason IS NULL
               OR TRIM(v_prop.rejection_reason) = '' THEN
                RAISE EXCEPTION 'REVIEW_STATE_INTEGRITY_MISMATCH: Inconsistencia de estado o linaje en propuesta/solicitud previamente rechazada.';
            END IF;

            IF v_prop.rejected_by <> v_actor_clean
               OR v_prop.rejection_reason IS DISTINCT FROM v_reason_clean
               OR v_prop.review_comment IS DISTINCT FROM v_comment_clean THEN
                RAISE EXCEPTION 'REVIEW_RETRY_MISMATCH: El actor, razon de rechazo o comentario del retry difiere del rechazo original.';
            END IF;

            RETURN QUERY SELECT v_prop.id, v_prop.application_id, 'REJECTED'::TEXT, 'IDEMPOTENT_RETRY'::TEXT;
            RETURN;
        END IF;

        -- Bloqueo de transiciones inválidas
        IF v_prop.status = 'APPROVED' THEN
            RAISE EXCEPTION 'INVALID_PROPOSAL_TRANSITION: No se permite rechazar una propuesta previamente aprobada.';
        ELSIF v_prop.status <> 'AWAITING_REVIEW' THEN
            RAISE EXCEPTION 'INVALID_PROPOSAL_TRANSITION: La propuesta no esta en estado AWAITING_REVIEW.';
        END IF;

        -- Guarda de Consistencia de Estado de Solicitud para Primer Rechazo
        IF v_app.status <> 'AWAITING_REVIEW' THEN
            RAISE EXCEPTION 'REVIEW_STATE_INTEGRITY_MISMATCH: La solicitud asociada no se encuentra en estado AWAITING_REVIEW.';
        END IF;

        -- Validación de coincidencia estricta de hash
        IF v_prop.proposal_hash <> v_exp_hash_clean THEN
            RAISE EXCEPTION 'APPROVED_CONTENT_MISMATCH: El proposal_hash actual no coincide con expected_proposal_hash.';
        END IF;

        -- Mutación Atómica de Propuesta, Solicitud y Evento de Auditoría (Primera Decisión)
        UPDATE public.onboarding_proposals
        SET status = 'REJECTED',
            rejected_proposal_hash = v_prop.proposal_hash,
            rejected_at = clock_timestamp(),
            rejected_by = v_actor_clean,
            rejection_reason = v_reason_clean,
            review_comment = v_comment_clean,
            updated_at = clock_timestamp()
        WHERE id = p_proposal_id;

        UPDATE public.onboarding_applications
        SET status = 'REJECTED',
            updated_at = clock_timestamp()
        WHERE id = v_prop.application_id;

        INSERT INTO public.onboarding_review_events (
            proposal_id,
            application_id,
            actor_id,
            proposal_hash,
            decision,
            created_at
        ) VALUES (
            v_prop.id,
            v_prop.application_id,
            v_actor_clean,
            v_prop.proposal_hash,
            'REJECTED',
            clock_timestamp()
        );

        RETURN QUERY SELECT v_prop.id, v_prop.application_id, 'REJECTED'::TEXT, 'SUCCESS'::TEXT;
        RETURN;
    END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT rol FROM public.socios 
  WHERE auth_user_id = auth.uid() 
     OR user_id = auth.uid() 
  LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.socio_invite_status(i socio_invites)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
begin
  if i.consumed_at is not null then
    return 'consumed';
  end if;
  if i.expires_at < now() then
    return 'expired';
  end if;
  if i.sent_at is not null then
    return 'sent';
  end if;
  return 'created';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into public.socios (user_id, auth_user_id, email, rol)
  values (new.id, new.id::text, new.email, 'socio');
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_created_by()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.created_by := auth.uid();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_socio_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT id FROM public.socios 
  WHERE auth_user_id = auth.uid() 
     OR user_id = auth.uid() 
  LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_onboarding_apply_transaction(p_application_id uuid, p_actor_id uuid, p_promoted_docs jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(socio_id uuid, status_result text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
    v_app RECORD;
    v_prop RECORD;
    v_mat RECORD;
    v_snapshot JSONB;
    v_identidad_data JSONB;
    v_reprocann_data JSONB;
    v_clinico_data JSONB;
    v_applicant_nombre TEXT;
    v_applicant_apellido TEXT;
    v_applicant_dni TEXT;
    v_applicant_email TEXT;
    v_applicant_telefono TEXT;
    v_existing_socio_id UUID;
    v_socio_id UUID;
    v_doc RECORD;
    v_snap_doc JSONB;
    v_stg_doc RECORD;
    v_stg_ext RECORD;
    v_source_path TEXT;
    v_expected_prefix TEXT;
    v_existing_doc RECORD;
    v_promoted_doc_id UUID;
    v_reprocann_doc_id UUID := NULL;
    v_consent_doc_id UUID := NULL;
    v_reprocann_ext_id UUID := NULL;
    v_consent_ext_id UUID := NULL;
    v_existing_reprocann RECORD;
    v_existing_clinical RECORD;
    v_legacy_doc_tipo TEXT;
    v_doc_fecha_emision DATE := NULL;
    v_doc_fecha_vencimiento DATE := NULL;
BEGIN
    -- 1. Lock y validación de la solicitud
    SELECT app.* INTO v_app
    FROM public.onboarding_applications app
    WHERE app.id = p_application_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ONBOARDING_APPLICATION_NOT_FOUND: La solicitud % no existe.', p_application_id;
    END IF;

    IF v_app.status NOT IN ('APPROVED', 'APPLYING', 'APPLY_FAILED') THEN
        RAISE EXCEPTION 'ONBOARDING_APPLICATION_NOT_APPROVED: La solicitud % esta en estado %, debe estar APPROVED para aplicar.', p_application_id, v_app.status;
    END IF;

    -- 2. Transición defensiva a APPLYING si aún está en APPROVED
    IF v_app.status = 'APPROVED' THEN
        UPDATE public.onboarding_applications app
        SET status = 'APPLYING',
            updated_at = clock_timestamp()
        WHERE app.id = p_application_id;
    END IF;

    -- 3. Lock y validación de la propuesta aprobada
    SELECT prop.* INTO v_prop
    FROM public.onboarding_proposals prop
    WHERE prop.application_id = p_application_id AND prop.status = 'APPROVED'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ONBOARDING_PROPOSAL_NOT_APPROVED: No existe propuesta aprobada para la solicitud %.', p_application_id;
    END IF;

    IF v_prop.approved_proposal_hash IS NULL OR v_prop.approved_proposal_hash <> v_prop.proposal_hash THEN
        RAISE EXCEPTION 'APPROVED_PROPOSAL_HASH_MISMATCH: El approved_proposal_hash no coincide con proposal_hash.';
    END IF;

    -- 4. Fast-path de Idempotencia: Si ya existe materialización válida para esta solicitud
    SELECT m.* INTO v_mat
    FROM public.onboarding_application_materializations m
    WHERE m.application_id = p_application_id;

    IF FOUND THEN
        IF v_mat.proposal_id <> v_prop.id 
           OR v_mat.approved_proposal_hash <> v_prop.approved_proposal_hash THEN
            RAISE EXCEPTION 'MATERIALIZATION_INTEGRITY_MISMATCH: La materializacion existente difiere de la propuesta aprobada.';
        END IF;

        PERFORM 1 FROM public.socios s WHERE s.id = v_mat.socio_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'MATERIALIZATION_INTEGRITY_MISMATCH: El socio_id de la materializacion no existe en la base de datos.';
        END IF;

        socio_id := v_mat.socio_id;
        status_result := 'READY_FOR_INVITATION';
        RETURN NEXT;
        RETURN;
    END IF;

    -- 5. Extracción desde snapshot aprobado: LO APROBADO = LO MATERIALIZADO (Anti-TOCTOU)
    v_snapshot := v_prop.proposal_snapshot;
    v_identidad_data := v_snapshot->'identidad_administrativo';
    v_reprocann_data := v_snapshot->'reprocann';
    v_clinico_data := v_snapshot->'clinico_inicial';

    v_applicant_nombre := TRIM(v_identidad_data->>'nombre');
    v_applicant_apellido := TRIM(v_identidad_data->>'apellido');
    v_applicant_dni := TRIM(v_identidad_data->>'dni');
    v_applicant_email := TRIM(v_identidad_data->>'email');
    v_applicant_telefono := TRIM(v_identidad_data->>'telefono');

    IF v_applicant_nombre IS NULL OR v_applicant_nombre = ''
       OR v_applicant_apellido IS NULL OR v_applicant_apellido = ''
       OR v_applicant_dni IS NULL OR v_applicant_dni = ''
       OR v_applicant_email IS NULL OR v_applicant_email = ''
       OR v_applicant_telefono IS NULL OR v_applicant_telefono = '' THEN
        RAISE EXCEPTION 'ONBOARDING_APPLY_IDENTITY_INCOMPLETE: identidad aprobada incompleta en proposal_snapshot.';
    END IF;

    SELECT s.id INTO v_existing_socio_id FROM public.socios s WHERE s.dni = v_applicant_dni;
    IF FOUND THEN
        RAISE EXCEPTION 'SOCIO_ALREADY_EXISTS: El DNI % ya pertenece a un socio registrado.', v_applicant_dni;
    END IF;

    -- 6. Inserción del nuevo socio en public.socios (p_actor_id de tipo UUID)
    INSERT INTO public.socios (
        nombre,
        apellido,
        dni,
        email,
        telefono,
        status,
        rol,
        fecha_ingreso_ong,
        onboarding_completed_at,
        created_by
    ) VALUES (
        v_applicant_nombre,
        v_applicant_apellido,
        v_applicant_dni,
        v_applicant_email,
        v_applicant_telefono,
        'pending',
        'socio',
        CURRENT_DATE,
        clock_timestamp(),
        p_actor_id
    ) RETURNING id INTO v_socio_id;

    -- 7. Registrar linaje inmutable de materialización
    INSERT INTO public.onboarding_application_materializations (
        application_id,
        proposal_id,
        approved_proposal_hash,
        socio_id,
        created_by
    ) VALUES (
        p_application_id,
        v_prop.id,
        v_prop.approved_proposal_hash,
        v_socio_id,
        p_actor_id
    );

    -- 8. Inserción y validación estricta de documentos promovidos en public.documentos_socio (Trust Boundary SQL Guard)
    IF p_promoted_docs IS NOT NULL AND jsonb_array_length(p_promoted_docs) > 0 THEN
        FOR v_doc IN SELECT * FROM jsonb_to_recordset(p_promoted_docs) AS x(
            document_type TEXT,
            source_storage_path TEXT,
            storage_path TEXT,
            fingerprint TEXT,
            onboarding_document_id UUID,
            onboarding_extraction_id UUID
        ) LOOP
            v_source_path := COALESCE(v_doc.source_storage_path, v_doc.storage_path);

            -- 8a. Validación contra proposal_snapshot APROBADO
            v_snap_doc := v_snapshot->'documentos'->v_doc.document_type;
            IF v_snap_doc IS NULL THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_DOCUMENT_NOT_IN_SNAPSHOT: El documento % no esta en el proposal_snapshot aprobado.', v_doc.document_type;
            END IF;

            IF v_snap_doc->>'document_id' IS DISTINCT FROM v_doc.onboarding_document_id::TEXT THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_DOCUMENT_ID_MISMATCH: El document_id % no coincide con el snapshot aprobado.', v_doc.onboarding_document_id;
            END IF;

            IF v_snap_doc->>'storage_path' IS DISTINCT FROM v_source_path THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_DOCUMENT_STORAGE_MUTATED: El source_storage_path del documento % difiere del snapshot aprobado.', v_doc.document_type;
            END IF;

            IF v_snap_doc->>'fingerprint' IS DISTINCT FROM v_doc.fingerprint THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_DOCUMENT_FINGERPRINT_MUTATED: El fingerprint del documento % difiere del snapshot aprobado.', v_doc.document_type;
            END IF;

            -- 8b. Validación contra staging de documentos (public.onboarding_documents)
            SELECT d.* INTO v_stg_doc FROM public.onboarding_documents d WHERE d.id = v_doc.onboarding_document_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_DOCUMENT_NOT_FOUND: El documento % no existe.', v_doc.onboarding_document_id;
            END IF;

            IF v_stg_doc.application_id <> p_application_id THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_DOCUMENT_APPLICATION_MISMATCH: El documento % pertenece a otra solicitud.', v_doc.onboarding_document_id;
            END IF;

            IF v_stg_doc.document_type <> v_doc.document_type THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_DOCUMENT_TYPE_MISMATCH: El tipo de documento % difiere de %.', v_stg_doc.document_type, v_doc.document_type;
            END IF;

            IF v_stg_doc.storage_path IS DISTINCT FROM v_source_path THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_DOCUMENT_STORAGE_MUTATED: El storage_path fuente en staging difiere del valor promovido.';
            END IF;

            IF v_stg_doc.document_fingerprint IS DISTINCT FROM v_doc.fingerprint THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_DOCUMENT_FINGERPRINT_MUTATED: El fingerprint en staging difiere del valor promovido.';
            END IF;

            IF v_stg_doc.extraction_status <> 'EXTRACTED' THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_DOCUMENT_NOT_EXTRACTED: El documento % no esta en estado EXTRACTED.', v_doc.onboarding_document_id;
            END IF;

            -- 8c. Validación de la ruta destino promovida (socio_docs/{application_id}/{document_id}_{fingerprint}.<ext>)
            v_expected_prefix := 'socio_docs/' || p_application_id::TEXT || '/' || v_doc.onboarding_document_id::TEXT || '_' || v_doc.fingerprint;
            IF v_doc.storage_path NOT IN (
                v_expected_prefix || '.pdf',
                v_expected_prefix || '.jpg',
                v_expected_prefix || '.jpeg',
                v_expected_prefix || '.png',
                v_expected_prefix || '.webp'
            ) THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_FORGED_DESTINATION_PATH: El storage_path promovido % no coincide con el patron canonico %.', v_doc.storage_path, v_expected_prefix;
            END IF;

            -- 8d. Validación contra staging de extracciones (public.onboarding_extractions)
            SELECT e.* INTO v_stg_ext FROM public.onboarding_extractions e WHERE e.id = v_doc.onboarding_extraction_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_EXTRACTION_NOT_FOUND: La extraccion % no existe.', v_doc.onboarding_extraction_id;
            END IF;

            IF v_stg_ext.application_id <> p_application_id OR v_stg_ext.document_id <> v_doc.onboarding_document_id THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_EXTRACTION_MISMATCH: La extraccion % no corresponde a la solicitud/documento promovido.', v_doc.onboarding_extraction_id;
            END IF;

            IF v_stg_ext.document_type <> v_doc.document_type OR v_stg_ext.document_fingerprint <> v_doc.fingerprint THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_EXTRACTION_MUTATED: La extraccion % no coincide con el tipo/fingerprint del documento.', v_doc.onboarding_extraction_id;
            END IF;

            IF v_stg_ext.status <> 'EXTRACTED' THEN
                RAISE EXCEPTION 'ONBOARDING_APPLY_EXTRACTION_NOT_COMPLETED: La extraccion % no esta en estado EXTRACTED.', v_doc.onboarding_extraction_id;
            END IF;

            -- 8e. Mapeo determinístico de tipo canónico Onboarding -> tipo legacy public.documentos_socio y extracción de fechas
            v_doc_fecha_emision := NULL;
            v_doc_fecha_vencimiento := NULL;

            IF v_doc.document_type = 'CERTIFICADO_REPROCANN' THEN
                v_legacy_doc_tipo := 'reprocann';
                IF v_reprocann_data IS NOT NULL THEN
                    IF TRIM(v_reprocann_data->>'fecha_alta') IS NOT NULL AND TRIM(v_reprocann_data->>'fecha_alta') <> '' THEN
                        v_doc_fecha_emision := (v_reprocann_data->>'fecha_alta')::DATE;
                    END IF;
                    IF TRIM(v_reprocann_data->>'vencimiento') IS NOT NULL AND TRIM(v_reprocann_data->>'vencimiento') <> '' THEN
                        v_doc_fecha_vencimiento := (v_reprocann_data->>'vencimiento')::DATE;
                    END IF;
                END IF;
            ELSIF v_doc.document_type = 'CONSENTIMIENTO_INFORMADO' THEN
                v_legacy_doc_tipo := 'consentimiento';
                IF v_clinico_data IS NOT NULL THEN
                    IF TRIM(v_clinico_data->>'fecha_firma') IS NOT NULL AND TRIM(v_clinico_data->>'fecha_firma') <> '' THEN
                        v_doc_fecha_emision := (v_clinico_data->>'fecha_firma')::DATE;
                    END IF;
                END IF;
            ELSIF v_doc.document_type = 'DECLARACION_JURADA' THEN
                v_legacy_doc_tipo := 'declaracion_jurada';
            ELSIF v_doc.document_type = 'CONTRATO' THEN
                v_legacy_doc_tipo := 'contrato';
            ELSIF v_doc.document_type = 'RECETA' THEN
                v_legacy_doc_tipo := 'receta';
            ELSIF v_doc.document_type = 'DNI' THEN
                v_legacy_doc_tipo := 'dni';
            ELSE
                RAISE EXCEPTION 'ONBOARDING_APPLY_UNMAPPED_DOCUMENT_TYPE: El tipo % no tiene mapeo en public.documentos_socio.', v_doc.document_type;
            END IF;

            -- 8f. Registro de documento en public.documentos_socio
            --     verificacion_estado = 'aprobado' (catálogo legacy válido)
            --     estado = NULL (alineado con los 116 registros legacy en producción para no activar trigger P0001)
            SELECT ds.* INTO v_existing_doc 
            FROM public.documentos_socio ds
            WHERE ds.socio_id = v_socio_id::TEXT AND ds.tipo = v_legacy_doc_tipo AND ds.document_fingerprint = v_doc.fingerprint;

            IF v_existing_doc IS NULL THEN
                INSERT INTO public.documentos_socio (
                    socio_id,
                    tipo,
                    archivo_path,
                    estado,
                    verificacion_estado,
                    verificacion_obs,
                    verificado_at,
                    verificado_por,
                    uploaded_by,
                    onboarding_document_id,
                    document_fingerprint,
                    onboarding_extraction_id,
                    fecha_emision,
                    fecha_vencimiento
                ) VALUES (
                    v_socio_id::TEXT,
                    v_legacy_doc_tipo,
                    v_doc.storage_path,
                    NULL,
                    'aprobado',
                    'Documento de onboarding promovido e inspeccionado en snapshot aprobado.',
                    clock_timestamp(),
                    p_actor_id::TEXT,
                    p_actor_id::TEXT,
                    v_doc.onboarding_document_id,
                    v_doc.fingerprint,
                    v_doc.onboarding_extraction_id,
                    v_doc_fecha_emision,
                    v_doc_fecha_vencimiento
                ) RETURNING id INTO v_promoted_doc_id;
            ELSE
                v_promoted_doc_id := v_existing_doc.id;
            END IF;

            IF v_doc.document_type = 'CERTIFICADO_REPROCANN' THEN
                v_reprocann_doc_id := v_promoted_doc_id;
                v_reprocann_ext_id := v_doc.onboarding_extraction_id;
            ELSIF v_doc.document_type = 'CONSENTIMIENTO_INFORMADO' THEN
                v_consent_doc_id := v_promoted_doc_id;
                v_consent_ext_id := v_doc.onboarding_extraction_id;
            END IF;

        END LOOP;
    END IF;

    -- 9. Inserción de perfil REPROCANN en public.socio_reprocann_profiles desde snapshot APROBADO
    IF v_reprocann_data IS NOT NULL AND TRIM(v_reprocann_data->>'numero_tramite') IS NOT NULL AND TRIM(v_reprocann_data->>'numero_tramite') <> '' THEN
        SELECT srp.* INTO v_existing_reprocann 
        FROM public.socio_reprocann_profiles srp
        WHERE srp.socio_id = v_socio_id AND srp.numero_tramite = TRIM(v_reprocann_data->>'numero_tramite');

        IF v_existing_reprocann IS NULL THEN
            INSERT INTO public.socio_reprocann_profiles (
                socio_id,
                numero_tramite,
                fecha_alta,
                fecha_vencimiento,
                tipo,
                documento_fuente_id,
                onboarding_extraction_id,
                verification_status,
                verified_at,
                verified_by
            ) VALUES (
                v_socio_id,
                TRIM(v_reprocann_data->>'numero_tramite'),
                CASE WHEN TRIM(v_reprocann_data->>'fecha_alta') IS NOT NULL AND TRIM(v_reprocann_data->>'fecha_alta') <> '' THEN (v_reprocann_data->>'fecha_alta')::DATE ELSE NULL END,
                CASE WHEN TRIM(v_reprocann_data->>'vencimiento') IS NOT NULL AND TRIM(v_reprocann_data->>'vencimiento') <> '' THEN (v_reprocann_data->>'vencimiento')::DATE ELSE NULL END,
                NULLIF(TRIM(v_reprocann_data->>'tipo'), ''),
                v_reprocann_doc_id,
                v_reprocann_ext_id,
                'VERIFIED',
                clock_timestamp(),
                p_actor_id::TEXT
            );
        END IF;
    END IF;

    -- 10. Inserción de perfil clínico en public.socio_clinical_profiles desde snapshot APROBADO
    IF v_clinico_data IS NOT NULL AND TRIM(v_clinico_data->>'diagnostico') IS NOT NULL AND TRIM(v_clinico_data->>'diagnostico') <> '' THEN
        SELECT scp.* INTO v_existing_clinical 
        FROM public.socio_clinical_profiles scp
        WHERE scp.socio_id = v_socio_id;

        IF v_existing_clinical IS NULL THEN
            INSERT INTO public.socio_clinical_profiles (
                socio_id,
                diagnostico_literal,
                medico_nombre,
                medico_matricula,
                medico_especialidad,
                fecha_firma_consentimiento,
                documento_fuente_id,
                onboarding_extraction_id,
                verified_at,
                verified_by
            ) VALUES (
                v_socio_id,
                TRIM(v_clinico_data->>'diagnostico'),
                COALESCE(TRIM(v_clinico_data->>'medico_nombre'), 'DESCONOCIDO'),
                COALESCE(TRIM(v_clinico_data->>'medico_matricula'), 'DESCONOCIDA'),
                NULLIF(TRIM(v_clinico_data->>'medico_especialidad'), ''),
                CASE WHEN TRIM(v_clinico_data->>'fecha_firma') IS NOT NULL AND TRIM(v_clinico_data->>'fecha_firma') <> '' THEN (v_clinico_data->>'fecha_firma')::DATE ELSE NULL END,
                v_consent_doc_id,
                v_consent_ext_id,
                clock_timestamp(),
                p_actor_id::TEXT
            );
        END IF;
    END IF;

    -- 11. Transición final de estado a READY_FOR_INVITATION
    UPDATE public.onboarding_applications app
    SET status = 'READY_FOR_INVITATION',
        updated_at = clock_timestamp()
    WHERE app.id = p_application_id;

    socio_id := v_socio_id;
    status_result := 'READY_FOR_INVITATION';
    RETURN NEXT;
    RETURN;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_last_activity(auth_id uuid, socio_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  last_sign_in timestamptz;
  last_pedido timestamptz;
  last_terms timestamptz;
  result timestamptz;
BEGIN
  -- Obtener última conexión registrada
  IF auth_id IS NOT NULL THEN
    SELECT last_sign_in_at INTO last_sign_in FROM auth.users WHERE id = auth_id;
  END IF;

  -- Obtener fecha de aceptación de términos
  SELECT terms_accepted_at INTO last_terms FROM public.socios WHERE id = socio_id;

  -- Obtener la fecha del último pedido
  SELECT MAX(created_at) INTO last_pedido FROM public.pedidos WHERE public.pedidos.socio_id = get_last_activity.socio_id;

  -- Determinar el más reciente
  result := COALESCE(last_sign_in, '1970-01-01Z'::timestamptz);
  
  IF last_terms IS NOT NULL AND last_terms > result THEN
    result := last_terms;
  END IF;

  IF last_pedido IS NOT NULL AND last_pedido > result THEN
    result := last_pedido;
  END IF;

  IF result = '1970-01-01Z'::timestamptz THEN
    RETURN NULL;
  END IF;

  RETURN result;
END;
$function$
;
CREATE OR REPLACE FUNCTION app_private.prevent_reprocann_renewal_proposal_payload_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NEW.proposal_snapshot IS DISTINCT FROM OLD.proposal_snapshot OR NEW.proposal_hash IS DISTINCT FROM OLD.proposal_hash THEN
        RAISE EXCEPTION 'No se puede modificar proposal_snapshot/proposal_hash de una propuesta de renovacion existente';
    END IF;
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_auth_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT rol FROM public.socios 
  WHERE auth_user_id = auth.uid() 
     OR user_id = auth.uid() 
  LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.check_pedidos_update_only_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- If user is admin or staff, bypass all restrictions and allow any update
  IF public.get_my_role() IN ('admin', 'staff') THEN
    RETURN NEW;
  END IF;

  -- Verify ownership: the socio_id on the order must belong to the authenticated user
  IF NOT EXISTS (
    SELECT 1 FROM public.socios
    WHERE id = OLD.socio_id
    AND (auth_user_id = auth.uid() OR user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'No autorizado para modificar este pedido.';
  END IF;

  -- Ensure only 'estado' and 'updated_at' are being modified
  IF NEW.id IS DISTINCT FROM OLD.id OR
     NEW.socio_id IS DISTINCT FROM OLD.socio_id OR
     NEW.tipo_pedido IS DISTINCT FROM OLD.tipo_pedido OR
     NEW.origen IS DISTINCT FROM OLD.origen OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR
     NEW.items IS DISTINCT FROM OLD.items OR
     NEW.observaciones IS DISTINCT FROM OLD.observaciones OR
     NEW.direccion_entrega IS DISTINCT FROM OLD.direccion_entrega OR
     NEW.localidad IS DISTINCT FROM OLD.localidad OR
     NEW.fecha_retiro_preferida IS DISTINCT FROM OLD.fecha_retiro_preferida OR
     NEW.franja_horaria IS DISTINCT FROM OLD.franja_horaria OR
     NEW.ubicacion_gps IS DISTINCT FROM OLD.ubicacion_gps OR
     NEW.entrega_estimada IS DISTINCT FROM OLD.entrega_estimada OR
     NEW.archivado IS DISTINCT FROM OLD.archivado OR
     NEW.total IS DISTINCT FROM OLD.total OR
     NEW.metodo_pago IS DISTINCT FROM OLD.metodo_pago OR
     NEW.comprobante_pago IS DISTINCT FROM OLD.comprobante_pago OR
     NEW.slot_id IS DISTINCT FROM OLD.slot_id OR
     NEW.requires_rescheduling IS DISTINCT FROM OLD.requires_rescheduling
  THEN
    RAISE EXCEPTION 'Los socios sólo pueden modificar el estado de sus pedidos.';
  END IF;

  -- Enforce state transition checks:
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    -- A socio can only cancel orders in 'pendiente' or 'procesando'
    IF OLD.estado NOT IN ('pendiente', 'procesando', 'en_preparacion') THEN
      RAISE EXCEPTION 'No se puede cancelar un pedido en estado %', OLD.estado;
    END IF;
    -- A socio can only change the state to 'cancelado'
    IF NEW.estado <> 'cancelado' THEN
      RAISE EXCEPTION 'Los socios sólo pueden cancelar sus pedidos.';
    END IF;
  END IF;

  -- Auto-update updated_at timestamp
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION app_private.prevent_reprocann_renewal_review_events_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF current_setting('app.allow_test_cleanup', true) = 'true' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'No se permite modificar ni eliminar eventos del ledger de revision de renovaciones.';
END;
$function$
;
CREATE OR REPLACE FUNCTION app_private.prevent_reprocann_renewal_apply_events_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF current_setting('app.allow_test_cleanup', true) = 'true' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'No se permite modificar ni eliminar eventos del ledger de aplicacion de renovaciones.';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.log_product_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
    current_user_id uuid;
    socio_id uuid;
    payload jsonb;
    changes jsonb;
    old_data jsonb;
    new_data jsonb;
    action_type text;
    target_id text;
    v_note text;
    v_order_id uuid;
begin
    -- Determine User
    current_user_id := auth.uid();
    
    if current_user_id is not null then
        select id into socio_id from public.socios where user_id = current_user_id limit 1;
    end if;
    -- Determine Action and Data
    if (TG_OP = 'INSERT') then
        action_type := 'CREATE';
        target_id := NEW.id::text;
        new_data := to_jsonb(NEW);
        v_note := NEW.last_audit_note;
        v_order_id := NEW.last_audit_order_id;
        
        payload := jsonb_build_object(
            'before', null,
            'after', new_data,
            'changed', '[]'::jsonb,
            'note', v_note,
            'order_id', v_order_id
        );
    elsif (TG_OP = 'DELETE') then
        action_type := 'DELETE';
        target_id := OLD.id::text;
        old_data := to_jsonb(OLD);
        
        payload := jsonb_build_object(
            'before', old_data,
            'after', null,
            'changed', '[]'::jsonb,
            'note', 'Producto eliminado',
            'order_id', null
        );
    elsif (TG_OP = 'UPDATE') then
        action_type := 'UPDATE';
        target_id := NEW.id::text;
        old_data := to_jsonb(OLD);
        new_data := to_jsonb(NEW);
        v_note := NEW.last_audit_note;
        v_order_id := NEW.last_audit_order_id;
        
        -- Calculate Changed Keys
        select jsonb_object_agg(key, value) into changes
        from jsonb_each(new_data)
        where old_data->key is distinct from new_data->key;
        if changes is null then
            changes := '{}'::jsonb;
        end if;
        payload := jsonb_build_object(
            'before', old_data,
            'after', new_data,
            'changes', changes,
            'note', v_note,
            'order_id', v_order_id
        );
    end if;
    -- Insert Log (only if we have an authenticated user context)
    if current_user_id is not null then
        insert into public.audit_logs (
            user_id,
            actor_socio_id,
            action,
            entity_type,
            entity_id,
            details,
            created_at
        ) values (
            current_user_id,
            socio_id,
            action_type,
            'PRODUCT',
            target_id,
            payload,
            now()
        );
    end if;
    -- Return
    if (TG_OP = 'DELETE') then
        return OLD;
    else
        return NEW;
    end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION app_private.prevent_historical_migration_apply_events_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF current_setting('app.allow_test_cleanup', true) = 'true' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'No se permite modificar ni eliminar eventos del ledger de aplicacion historica.';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_historical_reprocann_migration_apply(p_proposal_id uuid, p_expected_proposal_hash text, p_actor_id uuid)
 RETURNS TABLE(proposal_id uuid, socio_id uuid, new_status text, canonical_profile_id uuid, result_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_proposal RECORD;
    v_socio RECORD;
    v_existing_profile RECORD;
    v_now TIMESTAMPTZ := now();
    v_profile_id UUID;
    v_doc_fuente_id UUID := NULL;
    v_doc_ext_id UUID := NULL;
    v_num_tramite TEXT;
    v_fecha_alta DATE := NULL;
    v_fecha_venc DATE := NULL;
    v_tipo TEXT;
BEGIN
    IF p_actor_id IS NULL THEN
        RAISE EXCEPTION 'p_actor_id_required';
    END IF;

    -- Lock proposal row with table alias hrmp
    SELECT hrmp.* INTO v_proposal
    FROM public.historical_reprocann_migration_proposals hrmp
    WHERE hrmp.id = p_proposal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'HISTORICAL_PROPOSAL_NOT_FOUND';
    END IF;

    IF v_proposal.proposal_hash <> p_expected_proposal_hash THEN
        RAISE EXCEPTION 'HISTORICAL_PROPOSAL_HASH_MISMATCH';
    END IF;

    -- Check Idempotency for COMPLETED proposals with table alias srp
    IF v_proposal.status = 'COMPLETED' THEN
        SELECT srp.id INTO v_profile_id
        FROM public.socio_reprocann_profiles srp
        WHERE srp.socio_id = v_proposal.socio_id;

        RETURN QUERY SELECT v_proposal.id, v_proposal.socio_id, 'COMPLETED'::TEXT, v_profile_id, 'IDEMPOTENT_RETRY'::TEXT;
        RETURN;
    END IF;

    IF v_proposal.status <> 'APPROVED' THEN
        RAISE EXCEPTION 'HISTORICAL_PROPOSAL_NOT_APPROVED: Proposal state is %', v_proposal.status;
    END IF;

    -- Lock socio row to avoid deadlocks (Lock order: proposal -> socio -> profile) with table alias s
    SELECT s.* INTO v_socio
    FROM public.socios s
    WHERE s.id = v_proposal.socio_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SOCIO_NOT_FOUND';
    END IF;

    -- Write STARTED ledger event
    INSERT INTO public.historical_reprocann_migration_apply_events (
        proposal_id, socio_id, actor_id, proposal_hash, event_type, created_at
    ) VALUES (
        v_proposal.id, v_proposal.socio_id, p_actor_id, v_proposal.proposal_hash, 'HISTORICAL_MIGRATION_APPLY_STARTED', v_now
    );

    -- Extract values from proposed_canonical_profile JSONB
    v_num_tramite := TRIM(v_proposal.proposed_canonical_profile->>'numero_tramite');
    IF v_proposal.proposed_canonical_profile->>'fecha_alta' IS NOT NULL AND TRIM(v_proposal.proposed_canonical_profile->>'fecha_alta') <> '' THEN
        v_fecha_alta := (v_proposal.proposed_canonical_profile->>'fecha_alta')::DATE;
    END IF;
    IF v_proposal.proposed_canonical_profile->>'fecha_vencimiento' IS NOT NULL AND TRIM(v_proposal.proposed_canonical_profile->>'fecha_vencimiento') <> '' THEN
        v_fecha_venc := (v_proposal.proposed_canonical_profile->>'fecha_vencimiento')::DATE;
    END IF;
    v_tipo := COALESCE(NULLIF(TRIM(v_proposal.proposed_canonical_profile->>'tipo'), ''), 'PACIENTE');

    -- Document source & extraction provenance IDs
    IF v_proposal.document_snapshot IS NOT NULL AND v_proposal.document_snapshot->>'document_id' IS NOT NULL THEN
        v_doc_fuente_id := (v_proposal.document_snapshot->>'document_id')::UUID;
    END IF;
    IF v_proposal.data_provenance IS NOT NULL AND v_proposal.data_provenance->>'document_extraction_id' IS NOT NULL THEN
        v_doc_ext_id := (v_proposal.data_provenance->>'document_extraction_id')::UUID;
    END IF;

    -- Check if canonical profile already exists with table alias srp
    SELECT srp.* INTO v_existing_profile
    FROM public.socio_reprocann_profiles srp
    WHERE srp.socio_id = v_proposal.socio_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_profile.numero_tramite = v_num_tramite THEN
            v_profile_id := v_existing_profile.id;
        ELSE
            RAISE EXCEPTION 'HISTORICAL_CANONICAL_CONFLICT: Canonical profile exists with different numero_tramite';
        END IF;
    ELSE
        -- Insert new canonical profile
        v_profile_id := gen_random_uuid();
        INSERT INTO public.socio_reprocann_profiles (
            id,
            socio_id,
            numero_tramite,
            fecha_alta,
            fecha_vencimiento,
            tipo,
            documento_fuente_id,
            document_extraction_id,
            verification_status,
            verified_at,
            verified_by,
            created_at,
            updated_at
        ) VALUES (
            v_profile_id,
            v_proposal.socio_id,
            v_num_tramite,
            v_fecha_alta,
            v_fecha_venc,
            v_tipo,
            v_doc_fuente_id,
            v_doc_ext_id,
            'VERIFIED',
            v_now,
            p_actor_id,
            v_now,
            v_now
        );
    END IF;

    -- Update proposal status to COMPLETED
    UPDATE public.historical_reprocann_migration_proposals
    SET status = 'COMPLETED'
    WHERE id = v_proposal.id;

    -- Write COMPLETED ledger event
    INSERT INTO public.historical_reprocann_migration_apply_events (
        proposal_id, socio_id, actor_id, proposal_hash, event_type, created_at
    ) VALUES (
        v_proposal.id, v_proposal.socio_id, p_actor_id, v_proposal.proposal_hash, 'HISTORICAL_MIGRATION_APPLY_COMPLETED', v_now
    );

    RETURN QUERY SELECT v_proposal.id, v_proposal.socio_id, 'COMPLETED'::TEXT, v_profile_id, 'SUCCESS'::TEXT;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.generate_cierre_correlativo()
 RETURNS character varying
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN 'CM-' || EXTRACT(YEAR FROM now())::text || '-' || lpad(nextval('public.cierres_correlativo_seq')::text, 6, '0');
END;
$function$
;
CREATE OR REPLACE FUNCTION app_private.protect_socio_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF auth.uid() IS NOT NULL AND coalesce(public.get_my_role(),'') NOT IN ('admin','staff') THEN
        IF NEW.rol IS DISTINCT FROM OLD.rol OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
           OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.bloqueado IS DISTINCT FROM OLD.bloqueado THEN
            RAISE EXCEPTION 'No está permitido modificar permisos o identidad' USING ERRCODE='42501';
        END IF;
    END IF;
    RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.confirm_order_and_payments(p_order_id uuid, p_target_status text, p_payments jsonb, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_order RECORD;
    v_payment JSONB;
    v_socio_id UUID;
    v_payment_id UUID;
    v_monto NUMERIC;
    v_medio_de_pago TEXT;
    v_concepto TEXT;
    v_referencia TEXT;
    v_user_id UUID;
    v_request_hash text;
    v_inserted integer;
BEGIN
    -- Determine actor user id
    v_user_id := auth.uid();
    IF v_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.socios WHERE (auth_user_id=v_user_id OR user_id=v_user_id) AND rol IN ('admin','staff')
    ) THEN RAISE EXCEPTION 'No autorizado para confirmar pagos' USING ERRCODE='42501'; END IF;
    IF p_payments IS NOT NULL AND jsonb_typeof(p_payments) <> 'array' THEN
        RAISE EXCEPTION 'Formato de pagos inválido';
    END IF;

    -- 1. Fetch & lock order
    SELECT * INTO v_order
    FROM public.pedidos
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido con ID % no encontrado.', p_order_id;
    END IF;

    v_socio_id := v_order.socio_id;
    -- Replaying an identical confirmation must not record another batch of payments.
    v_request_hash := encode(sha256(convert_to(jsonb_build_object('status',p_target_status,'payments',p_payments)::text,'UTF8')),'hex');
    INSERT INTO public.order_confirmation_receipts(order_id,request_hash,actor_id)
    VALUES(p_order_id,v_request_hash,v_user_id) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN RETURN jsonb_build_object('success',true,'replayed',true); END IF;

    -- 2. Iterate and insert payment records
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
            v_monto := (v_payment->>'monto')::numeric;
            IF v_monto IS NULL OR v_monto < 0 OR v_monto::text IN ('NaN','Infinity','-Infinity') THEN
                RAISE EXCEPTION 'Monto inválido';
            END IF;
            v_medio_de_pago := COALESCE(v_payment->>'medio_de_pago', 'efectivo');
            v_concepto := v_payment->>'concepto';
            v_referencia := v_payment->>'referencia';

            INSERT INTO public.pagos (
                socio_id,
                fecha,
                concepto,
                monto,
                medio_de_pago,
                pedido_id,
                referencia,
                created_by
            ) VALUES (
                v_socio_id,
                NOW(),
                v_concepto,
                v_monto,
                v_medio_de_pago,
                p_order_id,
                v_referencia,
                v_user_id
            ) RETURNING id INTO v_payment_id;

            -- Audit log for payment
            IF v_user_id IS NOT NULL THEN
                INSERT INTO public.audit_logs (
                    user_id,
                    action,
                    entity_type,
                    entity_id,
                    details,
                    created_at
                ) VALUES (
                    v_user_id,
                    'CREATE',
                    'PAYMENT',
                    v_payment_id::text,
                    jsonb_build_object(
                        'socio_id', v_socio_id,
                        'monto', v_monto,
                        'medio_de_pago', v_medio_de_pago,
                        'concepto', v_concepto,
                        'pedido_id', p_order_id
                    ),
                    NOW()
                );
            END IF;
        END LOOP;
    END IF;

    -- 3. Update Order status
    UPDATE public.pedidos
    SET estado = p_target_status
    WHERE id = p_order_id;

    -- Audit log for order status update
    IF v_user_id IS NOT NULL THEN
        INSERT INTO public.audit_logs (
            user_id,
            action,
            entity_type,
            entity_id,
            details,
            created_at
        ) VALUES (
            v_user_id,
            'UPDATE',
            'ORDER',
            p_order_id::text,
            jsonb_build_object(
                'previous_status', v_order.estado,
                'new_status', p_target_status
            ),
            NOW()
        );
    END IF;

    RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$function$
;
CREATE OR REPLACE FUNCTION app_private.prepare_monthly_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
     FROM public.pagos p WHERE p.socio_id=NEW.socio_id AND p.fecha>=(NEW.periodo || '-01')::date AND p.fecha<((NEW.periodo || '-01')::date + interval '1 month')::date)
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
END $function$
;
CREATE OR REPLACE FUNCTION app_private.audit_monthly_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.audit_logs(user_id,action,entity_type,entity_id,details)
  VALUES(auth.uid(),CASE WHEN TG_OP='INSERT' THEN 'CREATE' ELSE 'UPDATE' END,'CIERRE_MENSUAL',NEW.id::text,
    jsonb_build_object('periodo',NEW.periodo,'hash_sha256',NEW.hash_sha256,'estado',NEW.estado,'motivo',NEW.motivo_anulacion));
  RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION app_private.validate_reprocann_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.tipo='reprocann' AND NEW.verificacion_estado='aprobado' AND
     (TG_OP='INSERT' OR (NEW.archivo_path,NEW.fecha_emision,NEW.fecha_vencimiento,NEW.verificacion_estado)
       IS DISTINCT FROM (OLD.archivo_path,OLD.fecha_emision,OLD.fecha_vencimiento,OLD.verificacion_estado)) THEN
    IF NEW.archivo_path IS NULL OR NEW.fecha_emision IS NULL OR NEW.fecha_vencimiento IS NULL
       OR NEW.fecha_vencimiento::date<NEW.fecha_emision THEN
      RAISE EXCEPTION 'Confirmá archivo, fecha de emisión y vencimiento antes de aprobar';
    END IF;
  END IF;
  RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.confirm_order_delivery(p_order_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_order RECORD;
BEGIN
    SELECT * FROM public.pedidos 
    INTO v_order 
    WHERE id = p_order_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Pedido no encontrado');
    END IF;

    IF v_order.estado IN ('entregado', 'retirado', 'cancelado') THEN
        RETURN json_build_object('success', false, 'error', 'El pedido ya fue finalizado previamente');
    END IF;

    UPDATE public.pedidos
    SET estado = 'entregado'
    WHERE id = p_order_id;

    RETURN json_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.tr_check_and_adjust_stock_on_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_item JSONB;
    v_product_id UUID;
    v_qty INT;
    v_stock INT;
    v_prod_name TEXT;
BEGIN
    -- Case 1: Order is cancelled
    IF NEW.estado = 'cancelado' AND OLD.estado IS DISTINCT FROM 'cancelado' THEN
        -- Return stock if it was active
        IF OLD.items IS NOT NULL AND jsonb_array_length(OLD.items) > 0 THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(OLD.items) LOOP
                v_product_id := (v_item->>'productoId')::uuid;
                v_qty := (v_item->>'cantidad')::int;
                
                UPDATE public.products 
                SET stock_disponible = stock_disponible + v_qty,
                    last_audit_note = 'Devolución de stock por pedido cancelado',
                    last_audit_order_id = NEW.id
                WHERE id = v_product_id;
            END LOOP;
        END IF;
    
    -- Case 2: Order is reactivated from cancelled
    ELSIF OLD.estado = 'cancelado' AND NEW.estado IS DISTINCT FROM 'cancelado' THEN
        -- Deduct stock for the new items
        IF NEW.items IS NOT NULL AND jsonb_array_length(NEW.items) > 0 THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
                v_product_id := (v_item->>'productoId')::uuid;
                v_qty := (v_item->>'cantidad')::int;
                
                SELECT stock_disponible, nombre INTO v_stock, v_prod_name 
                FROM public.products WHERE id = v_product_id;
                
                IF v_stock IS NULL THEN
                    RAISE EXCEPTION 'El producto solicitado con ID % no existe.', v_product_id;
                END IF;
                
                IF v_stock < v_qty THEN
                    RAISE EXCEPTION 'Stock insuficiente para el producto "%". Solicitado: %, Disponible: %', v_prod_name, v_qty, v_stock;
                END IF;
                
                UPDATE public.products 
                SET stock_disponible = stock_disponible - v_qty,
                    last_audit_note = 'Descuento de stock por reactivación de pedido (' || NEW.estado || ')',
                    last_audit_order_id = NEW.id
                WHERE id = v_product_id;
            END LOOP;
        END IF;

    -- Case 3: Items are edited in an active order
    ELSIF OLD.items IS DISTINCT FROM NEW.items AND NEW.estado IS DISTINCT FROM 'cancelado' THEN
        -- Refund old items first
        IF OLD.items IS NOT NULL AND jsonb_array_length(OLD.items) > 0 THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(OLD.items) LOOP
                v_product_id := (v_item->>'productoId')::uuid;
                v_qty := (v_item->>'cantidad')::int;
                
                UPDATE public.products 
                SET stock_disponible = stock_disponible + v_qty,
                    last_audit_note = 'Ajuste de stock por modificación de items (reintegro)',
                    last_audit_order_id = NEW.id
                WHERE id = v_product_id;
            END LOOP;
        END IF;

        -- Charge new items
        IF NEW.items IS NOT NULL AND jsonb_array_length(NEW.items) > 0 THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
                v_product_id := (v_item->>'productoId')::uuid;
                v_qty := (v_item->>'cantidad')::int;
                
                SELECT stock_disponible, nombre INTO v_stock, v_prod_name 
                FROM public.products WHERE id = v_product_id;
                
                IF v_stock IS NULL THEN
                    RAISE EXCEPTION 'El producto solicitado con ID % no existe.', v_product_id;
                END IF;
                
                IF v_stock < v_qty THEN
                    RAISE EXCEPTION 'Stock insuficiente para el producto "%". Solicitado: %, Disponible: %', v_prod_name, v_qty, v_stock;
                END IF;
                
                UPDATE public.products 
                SET stock_disponible = stock_disponible - v_qty,
                    last_audit_note = 'Ajuste de stock por modificación de items (cargo)',
                    last_audit_order_id = NEW.id
                WHERE id = v_product_id;
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION app_private.prevent_onboarding_materialization_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id
       OR NEW.approved_proposal_hash IS DISTINCT FROM OLD.approved_proposal_hash
       OR NEW.socio_id IS DISTINCT FROM OLD.socio_id THEN
        RAISE EXCEPTION 'No se puede modificar el linaje inmutable de una materializacion de onboarding';
    END IF;
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.check_resolution_800_limits()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_item JSONB;
    v_product_id UUID;
    v_qty INT;
    v_peso_gramos NUMERIC;
    v_tipo TEXT;
    v_total_flores_gramos NUMERIC := 0;
    v_total_goteros_units INT := 0;
BEGIN
    -- Only check if items array is present
    IF NEW.items IS NOT NULL AND jsonb_array_length(NEW.items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
            v_product_id := (v_item->>'productoId')::uuid;
            v_qty := COALESCE((v_item->>'cantidad')::int, 0);

            IF v_product_id IS NOT NULL THEN
                SELECT tipo, COALESCE(peso_gramos, 1) INTO v_tipo, v_peso_gramos
                FROM public.products
                WHERE id = v_product_id;

                IF v_tipo = 'flor' THEN
                    v_total_flores_gramos := v_total_flores_gramos + (v_qty * v_peso_gramos);
                ELSIF v_tipo IN ('gotero', 'aceite') THEN
                    v_total_goteros_units := v_total_goteros_units + v_qty;
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- Validate legal limits (Resolution 800/2021)
    IF v_total_flores_gramos > 40 THEN
        RAISE EXCEPTION 'Excede los límites de la Res. 800/2021: El pedido contiene %g de flor seca (máximo permitido: 40g).', v_total_flores_gramos;
    END IF;

    IF v_total_goteros_units > 6 THEN
        RAISE EXCEPTION 'Excede los límites de la Res. 800/2021: El pedido contiene % unidades de gotero/aceite (máximo permitido: 6 unidades).', v_total_goteros_units;
    END IF;

    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.tr_check_and_deduct_stock_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_item JSONB;
    v_product_id UUID;
    v_qty INT;
    v_stock INT;
    v_prod_name TEXT;
BEGIN
    -- Only skip stock deduction if order is cancelled upon creation
    IF NEW.estado IS DISTINCT FROM 'cancelado' THEN
        IF NEW.items IS NOT NULL AND jsonb_array_length(NEW.items) > 0 THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
                v_product_id := (v_item->>'productoId')::uuid;
                v_qty := (v_item->>'cantidad')::int;
                
                -- Fetch current stock and product name
                SELECT stock_disponible, nombre INTO v_stock, v_prod_name 
                FROM public.products WHERE id = v_product_id;
                
                IF v_stock IS NULL THEN
                    RAISE EXCEPTION 'El producto solicitado con ID % no existe.', v_product_id;
                END IF;
                
                IF v_stock < v_qty THEN
                    RAISE EXCEPTION 'Stock insuficiente para el producto "%". Solicitado: %, Disponible: %', v_prod_name, v_qty, v_stock;
                END IF;
                
                -- Deduct stock and set audit details
                UPDATE public.products 
                SET stock_disponible = stock_disponible - v_qty,
                    last_audit_note = 'Descuento por nuevo pedido (' || NEW.estado || ')',
                    last_audit_order_id = NEW.id
                WHERE id = v_product_id;
            END LOOP;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION app_private.prevent_onboarding_proposal_payload_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.proposal_snapshot IS DISTINCT FROM OLD.proposal_snapshot
       OR NEW.proposal_hash IS DISTINCT FROM OLD.proposal_hash THEN
        RAISE EXCEPTION 'No se puede modificar application_id/proposal_snapshot/proposal_hash de una propuesta de onboarding existente';
    END IF;
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION app_private.apply_order_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_old jsonb := '[]';
    v_new jsonb := '[]';
    v_all jsonb;
    v_change record;
    v_staff boolean;
    v_privileged boolean;
BEGIN
    v_staff := EXISTS (SELECT 1 FROM public.socios WHERE (auth_user_id=auth.uid() OR user_id=auth.uid()) AND rol IN ('admin','staff'));
    v_privileged := coalesce(auth.jwt()->>'role','')='service_role'
        OR (auth.uid() IS NULL AND auth.jwt()->>'role' IS NULL AND session_user IN ('postgres','supabase_admin'));
    IF NOT v_privileged AND (auth.uid() IS NULL OR (NOT v_staff AND NOT EXISTS (
        SELECT 1 FROM public.socios WHERE id=NEW.socio_id AND (auth_user_id=auth.uid() OR user_id=auth.uid())
    ))) THEN RAISE EXCEPTION 'No autorizado para reservar stock' USING ERRCODE='42501'; END IF;
    IF TG_OP='UPDATE' AND NOT v_privileged AND NOT v_staff AND NEW.socio_id IS DISTINCT FROM OLD.socio_id THEN
        RAISE EXCEPTION 'No autorizado para cambiar el socio' USING ERRCODE='42501';
    END IF;
    IF TG_OP='UPDATE' AND OLD.estado IS DISTINCT FROM 'cancelado' THEN v_old:=coalesce(OLD.items,'[]'); END IF;
    IF NEW.estado IS DISTINCT FROM 'cancelado' THEN v_new:=coalesce(NEW.items,'[]'); END IF;
    IF jsonb_typeof(v_old)<>'array' OR jsonb_typeof(v_new)<>'array' THEN RAISE EXCEPTION 'Items inválidos'; END IF;
    v_all:=v_old||v_new;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_all) i WHERE
        coalesce(i->>'cantidad','') !~ '^[1-9][0-9]*$' OR
        coalesce(i->>'productoId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
        RAISE EXCEPTION 'Cada item requiere producto válido y cantidad entera positiva';
    END IF;

    -- Stable lock order prevents inverse-order deadlocks. Locks span validation
    -- and the update, so concurrent orders cannot spend the same stock.
    PERFORM p.id FROM public.products p WHERE p.id IN
        (SELECT (i->>'productoId')::uuid FROM jsonb_array_elements(v_all) i)
        ORDER BY p.id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_all) i WHERE NOT EXISTS
        (SELECT 1 FROM public.products p WHERE p.id=(i->>'productoId')::uuid)) THEN
        RAISE EXCEPTION 'Producto inexistente';
    END IF;

    FOR v_change IN
        SELECT id, sum(qty) AS delta FROM (
            SELECT (i->>'productoId')::uuid id, -(i->>'cantidad')::bigint qty FROM jsonb_array_elements(v_old) i
            UNION ALL
            SELECT (i->>'productoId')::uuid id, (i->>'cantidad')::bigint qty FROM jsonb_array_elements(v_new) i
        ) quantities GROUP BY id ORDER BY id
    LOOP
        IF v_change.delta=0 THEN CONTINUE; END IF;
        UPDATE public.products SET stock_disponible=stock_disponible-v_change.delta,
            last_audit_note=CASE WHEN NEW.estado='cancelado' THEN 'Devolución por cancelación de pedido' ELSE 'Reserva o ajuste de pedido' END,
            last_audit_order_id=NEW.id
        WHERE id=v_change.id AND stock_disponible-v_change.delta>=0;
        IF NOT FOUND THEN RAISE EXCEPTION 'Stock insuficiente para el producto %',v_change.id; END IF;
    END LOOP;
    RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION app_private.validate_document_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$
;
CREATE OR REPLACE FUNCTION app_private.archive_and_sync_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$
;
CREATE OR REPLACE FUNCTION app_private.prevent_onboarding_review_events_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    RAISE EXCEPTION 'IMMUTABLE_AUDIT_LEDGER: Los eventos de revisión de onboarding son inmutables y no se pueden modificar ni eliminar (OP: %).', TG_OP;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_reprocann_renewal_review_proposal(p_proposal_id uuid, p_action text, p_expected_proposal_hash text, p_actor_id uuid, p_rejection_reason text DEFAULT NULL::text, p_review_comment text DEFAULT NULL::text)
 RETURNS TABLE(proposal_id uuid, application_id uuid, new_status text, result_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_prop RECORD;
    v_app RECORD;
    v_action_clean TEXT;
    v_exp_hash_clean TEXT;
    v_reason_clean TEXT;
    v_comment_clean TEXT;
BEGIN
    -- 0. Normalización y validación estricta de inputs
    v_action_clean := UPPER(TRIM(COALESCE(p_action, '')));
    IF v_action_clean NOT IN ('APPROVE', 'REJECT') THEN
        RAISE EXCEPTION 'INVALID_REVIEW_ACTION: La accion debe ser APPROVE o REJECT.';
    END IF;

    IF p_actor_id IS NULL THEN
        RAISE EXCEPTION 'ACTOR_ID_REQUIRED: El actor_id (UUID) es obligatorio.';
    END IF;

    v_exp_hash_clean := TRIM(COALESCE(p_expected_proposal_hash, ''));
    IF v_exp_hash_clean = '' THEN
        RAISE EXCEPTION 'EXPECTED_PROPOSAL_HASH_REQUIRED: expected_proposal_hash es obligatorio.';
    END IF;

    v_comment_clean := NULLIF(TRIM(COALESCE(p_review_comment, '')), '');

    -- 1. Lock y comprobación de existencia de Propuesta (FOR UPDATE - Orden Canónico 1)
    SELECT * INTO v_prop FROM public.reprocann_renewal_proposals WHERE id = p_proposal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROPOSAL_NOT_FOUND: La propuesta de renovacion especificada no existe.';
    END IF;

    -- 2. Lock y comprobación de existencia de Solicitud (FOR UPDATE - Orden Canónico 2)
    SELECT * INTO v_app FROM public.reprocann_renewal_applications WHERE id = v_prop.renewal_application_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'APPLICATION_NOT_FOUND: La solicitud de renovacion asociada no existe.';
    END IF;

    -- 3. Validaciones de Hash Fail-Closed
    IF v_prop.proposal_hash IS NULL THEN
        RAISE EXCEPTION 'PROPOSAL_HASH_MISSING: proposal_hash de la propuesta es nulo.';
    END IF;

    -- 4. Lógica de APPROVE
    IF v_action_clean = 'APPROVE' THEN
        -- Idempotencia y Verificación de Consistencia en Retry APPROVE
        IF v_prop.status = 'APPROVED' THEN
            IF v_app.status <> 'APPROVED'
               OR v_prop.approved_proposal_hash IS NULL
               OR v_prop.approved_proposal_hash <> v_exp_hash_clean
               OR v_prop.proposal_hash <> v_exp_hash_clean
               OR v_prop.approved_at IS NULL
               OR v_prop.approved_by IS NULL THEN
                RAISE EXCEPTION 'REVIEW_STATE_INTEGRITY_MISMATCH: Inconsistencia de estado o linaje en propuesta/solicitud previamente aprobada.';
            END IF;

            IF v_prop.approved_by::uuid <> p_actor_id
               OR v_prop.review_comment IS DISTINCT FROM v_comment_clean THEN
                RAISE EXCEPTION 'REVIEW_RETRY_MISMATCH: El actor o comentario del retry difiere de la aprobacion original.';
            END IF;

            RETURN QUERY SELECT v_prop.id, v_prop.renewal_application_id, 'APPROVED'::TEXT, 'IDEMPOTENT_RETRY'::TEXT;
            RETURN;
        END IF;

        -- Bloqueo de transiciones inválidas / conflicto
        IF v_prop.status = 'REJECTED' THEN
            RAISE EXCEPTION 'REVIEW_ALREADY_FINALIZED: No se permite aprobar una propuesta de renovacion previamente rechazada.';
        ELSIF v_prop.status <> 'AWAITING_REVIEW' THEN
            RAISE EXCEPTION 'INVALID_PROPOSAL_TRANSITION: La propuesta no esta en estado AWAITING_REVIEW.';
        END IF;

        IF v_app.status <> 'AWAITING_REVIEW' THEN
            RAISE EXCEPTION 'REVIEW_STATE_INTEGRITY_MISMATCH: La solicitud asociada no se encuentra en estado AWAITING_REVIEW.';
        END IF;

        -- Validación de coincidencia estricta de hash
        IF v_prop.proposal_hash <> v_exp_hash_clean THEN
            RAISE EXCEPTION 'PROPOSAL_HASH_MISMATCH: El proposal_hash actual no coincide con expected_proposal_hash.';
        END IF;

        -- Mutación Atómica de Propuesta, Solicitud y Evento de Auditoría
        UPDATE public.reprocann_renewal_proposals
        SET status = 'APPROVED',
            approved_proposal_hash = v_prop.proposal_hash,
            approved_at = clock_timestamp(),
            approved_by = p_actor_id,
            review_comment = v_comment_clean,
            updated_at = clock_timestamp()
        WHERE id = p_proposal_id;

        UPDATE public.reprocann_renewal_applications
        SET status = 'APPROVED',
            updated_at = clock_timestamp()
        WHERE id = v_prop.renewal_application_id;

        INSERT INTO public.reprocann_renewal_review_events (
            proposal_id,
            application_id,
            actor_id,
            proposal_hash,
            decision,
            created_at
        ) VALUES (
            v_prop.id,
            v_prop.renewal_application_id,
            p_actor_id,
            v_prop.proposal_hash,
            'APPROVED',
            clock_timestamp()
        );

        RETURN QUERY SELECT v_prop.id, v_prop.renewal_application_id, 'APPROVED'::TEXT, 'SUCCESS'::TEXT;
        RETURN;
    END IF;

    -- 5. Lógica de REJECT
    IF v_action_clean = 'REJECT' THEN
        v_reason_clean := NULLIF(TRIM(COALESCE(p_rejection_reason, '')), '');
        IF v_reason_clean IS NULL THEN
            RAISE EXCEPTION 'REJECTION_REASON_REQUIRED: La razon de rechazo es obligatoria para la accion REJECT.';
        END IF;

        -- Idempotencia y Verificación de Consistencia en Retry REJECT
        IF v_prop.status = 'REJECTED' THEN
            IF v_app.status <> 'REJECTED'
               OR v_prop.proposal_hash <> v_exp_hash_clean
               OR v_prop.rejected_at IS NULL
               OR v_prop.rejected_by IS NULL
               OR v_prop.rejection_reason IS NULL THEN
                RAISE EXCEPTION 'REVIEW_STATE_INTEGRITY_MISMATCH: Inconsistencia de estado o linaje en propuesta/solicitud previamente rechazada.';
            END IF;

            IF v_prop.rejected_by::uuid <> p_actor_id
               OR v_prop.rejection_reason IS DISTINCT FROM v_reason_clean
               OR v_prop.review_comment IS DISTINCT FROM v_comment_clean THEN
                RAISE EXCEPTION 'REVIEW_RETRY_MISMATCH: El actor, razon de rechazo o comentario del retry difiere del rechazo original.';
            END IF;

            RETURN QUERY SELECT v_prop.id, v_prop.renewal_application_id, 'REJECTED'::TEXT, 'IDEMPOTENT_RETRY'::TEXT;
            RETURN;
        END IF;

        -- Bloqueo de transiciones inválidas / conflicto
        IF v_prop.status = 'APPROVED' THEN
            RAISE EXCEPTION 'REVIEW_ALREADY_FINALIZED: No se permite rechazar una propuesta de renovacion previamente aprobada.';
        ELSIF v_prop.status <> 'AWAITING_REVIEW' THEN
            RAISE EXCEPTION 'INVALID_PROPOSAL_TRANSITION: La propuesta no esta en estado AWAITING_REVIEW.';
        END IF;

        IF v_app.status <> 'AWAITING_REVIEW' THEN
            RAISE EXCEPTION 'REVIEW_STATE_INTEGRITY_MISMATCH: La solicitud asociada no se encuentra en estado AWAITING_REVIEW.';
        END IF;

        -- Validación de coincidencia estricta de hash
        IF v_prop.proposal_hash <> v_exp_hash_clean THEN
            RAISE EXCEPTION 'PROPOSAL_HASH_MISMATCH: El proposal_hash actual no coincide con expected_proposal_hash.';
        END IF;

        -- Mutación Atómica de Propuesta, Solicitud y Evento de Auditoría
        UPDATE public.reprocann_renewal_proposals
        SET status = 'REJECTED',
            rejected_at = clock_timestamp(),
            rejected_by = p_actor_id,
            rejection_reason = v_reason_clean,
            review_comment = v_comment_clean,
            updated_at = clock_timestamp()
        WHERE id = p_proposal_id;

        UPDATE public.reprocann_renewal_applications
        SET status = 'REJECTED',
            updated_at = clock_timestamp()
        WHERE id = v_prop.renewal_application_id;

        INSERT INTO public.reprocann_renewal_review_events (
            proposal_id,
            application_id,
            actor_id,
            proposal_hash,
            decision,
            created_at
        ) VALUES (
            v_prop.id,
            v_prop.renewal_application_id,
            p_actor_id,
            v_prop.proposal_hash,
            'REJECTED',
            clock_timestamp()
        );

        RETURN QUERY SELECT v_prop.id, v_prop.renewal_application_id, 'REJECTED'::TEXT, 'SUCCESS'::TEXT;
        RETURN;
    END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_reprocann_record_apply_event(p_proposal_id uuid, p_application_id uuid, p_socio_id uuid, p_actor_id uuid, p_event_type text, p_attempt_id uuid, p_proposal_hash text, p_result_code text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_event_id UUID := gen_random_uuid();
BEGIN
    INSERT INTO public.reprocann_renewal_apply_events (
        id, proposal_id, application_id, socio_id, actor_id,
        event_type, attempt_id, proposal_hash, result_code, error_code, details, created_at
    ) VALUES (
        v_event_id, p_proposal_id, p_application_id, p_socio_id, p_actor_id,
        p_event_type, p_attempt_id, p_proposal_hash, p_result_code, p_error_code, p_details, clock_timestamp()
    );
    RETURN v_event_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_reprocann_renewal_apply(p_proposal_id uuid, p_expected_proposal_hash text, p_actor_id uuid, p_canonical_storage_path text, p_verified_storage_fingerprint text, p_attempt_id uuid DEFAULT gen_random_uuid())
 RETURNS TABLE(proposal_id uuid, application_id uuid, socio_id uuid, new_document_id uuid, version integer, profile_id uuid, result_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_prop RECORD;
    v_app RECORD;
    v_socio RECORD;
    v_profile RECORD;
    v_ext RECORD;
    v_completed_event RECORD;
    v_old_doc RECORD;
    v_exp_hash_clean TEXT;
    v_path_clean TEXT;
    v_fingerprint_clean TEXT;
    v_extraction_id UUID;
    v_new_version INT;
    v_new_doc_id UUID;
    v_profile_id UUID;
    v_old_current_id UUID;
    v_old_curr_fingerprint TEXT;
    v_num_tramite TEXT;
    v_fecha_alta DATE;
    v_fecha_vencimiento DATE;
    v_tipo TEXT;
    v_snap_curr_fingerprint TEXT;
    v_act_curr_fingerprint TEXT;
    v_raw_str TEXT;
BEGIN
    -- 0. Normalización y validación estricta de inputs
    IF p_proposal_id IS NULL THEN
        RAISE EXCEPTION 'PROPOSAL_ID_REQUIRED: proposal_id es obligatorio.';
    END IF;

    IF p_actor_id IS NULL THEN
        RAISE EXCEPTION 'ACTOR_ID_REQUIRED: actor_id es obligatorio.';
    END IF;

    v_exp_hash_clean := TRIM(COALESCE(p_expected_proposal_hash, ''));
    IF v_exp_hash_clean = '' THEN
        RAISE EXCEPTION 'EXPECTED_PROPOSAL_HASH_REQUIRED: expected_proposal_hash es obligatorio.';
    END IF;

    v_path_clean := TRIM(COALESCE(p_canonical_storage_path, ''));
    IF v_path_clean = '' THEN
        RAISE EXCEPTION 'CANONICAL_STORAGE_PATH_REQUIRED: p_canonical_storage_path es obligatorio.';
    END IF;

    v_fingerprint_clean := TRIM(COALESCE(p_verified_storage_fingerprint, ''));
    IF v_fingerprint_clean = '' THEN
        RAISE EXCEPTION 'STORAGE_FINGERPRINT_REQUIRED: p_verified_storage_fingerprint es obligatorio.';
    END IF;

    -- ORDEN CANÓNICO DE LOCKS 1: Proposal (FOR UPDATE)
    SELECT rrp.* INTO v_prop FROM public.reprocann_renewal_proposals rrp WHERE rrp.id = p_proposal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROPOSAL_NOT_FOUND: La propuesta de renovacion especificada no existe.';
    END IF;

    -- ORDEN CANÓNICO DE LOCKS 2: Application (FOR UPDATE)
    SELECT rra.* INTO v_app FROM public.reprocann_renewal_applications rra WHERE rra.id = v_prop.renewal_application_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'APPLICATION_NOT_FOUND: La solicitud de renovacion asociada no existe.';
    END IF;

    -- VERIFICACIÓN DE IDEMPOTENCIA Y RETRY DE PROPOSAL FINALIZADA
    IF v_prop.status = 'COMPLETED' THEN
        IF v_app.status <> 'COMPLETED'
           OR v_prop.approved_proposal_hash IS DISTINCT FROM v_exp_hash_clean
           OR v_prop.proposal_hash <> v_exp_hash_clean THEN
            RAISE EXCEPTION 'APPLY_STATE_INTEGRITY_MISMATCH: Inconsistencia de estado o hash en propuesta previamente completada.';
        END IF;

        -- Buscar evento de materialización original
        SELECT rrae.* INTO v_completed_event
        FROM public.reprocann_renewal_apply_events rrae
        WHERE rrae.proposal_id = v_prop.id AND rrae.event_type = 'RENEWAL_APPLY_COMPLETED'
        ORDER BY rrae.created_at ASC LIMIT 1;

        IF FOUND AND v_completed_event.materialized_document_id IS NOT NULL THEN
            SELECT ds.* INTO v_old_doc FROM public.documentos_socio ds WHERE ds.id = v_completed_event.materialized_document_id;
            SELECT srp.id INTO v_profile_id FROM public.socio_reprocann_profiles srp WHERE srp.socio_id = v_prop.socio_id;

            RETURN QUERY SELECT v_prop.id, v_app.id, v_prop.socio_id, v_completed_event.materialized_document_id, COALESCE(v_old_doc.version, 1), v_profile_id, 'IDEMPOTENT_RETRY'::TEXT;
            RETURN;
        ELSE
            RAISE EXCEPTION 'APPLY_STATE_INTEGRITY_MISMATCH: No se encontro el evento de materializacion para la propuesta completada.';
        END IF;
    END IF;

    -- PRECONDICIONES DE ESTADO Y HASH
    IF v_prop.status <> 'APPROVED' THEN
        RAISE EXCEPTION 'INVALID_PROPOSAL_TRANSITION: La propuesta debe estar en estado APPROVED para ejecutarse APPLY.';
    END IF;

    IF v_app.status <> 'APPROVED' THEN
        RAISE EXCEPTION 'PROPOSAL_NOT_APPROVED: La solicitud asociada debe estar en estado APPROVED para ejecutarse APPLY.';
    END IF;

    IF v_prop.proposal_hash <> v_exp_hash_clean OR v_prop.approved_proposal_hash <> v_exp_hash_clean THEN
        RAISE EXCEPTION 'PROPOSAL_HASH_MISMATCH: El proposal_hash no coincide con expected_proposal_hash.';
    END IF;

    -- ORDEN CANÓNICO DE LOCKS 3: Socio (FOR UPDATE - MUTEX PRINCIPAL DE VERSIÓN)
    SELECT s.* INTO v_socio FROM public.socios s WHERE s.id = v_prop.socio_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SOCIO_NOT_FOUND: El socio especificado no existe.';
    END IF;

    -- ORDEN CANÓNICO DE LOCKS 4: Profile (FOR UPDATE)
    SELECT srp.* INTO v_profile FROM public.socio_reprocann_profiles srp WHERE srp.socio_id = v_prop.socio_id FOR UPDATE;

    -- ORDEN CANÓNICO DE LOCKS 5: Current Document(s) (FOR UPDATE)
    PERFORM ds.id FROM public.documentos_socio ds WHERE ds.socio_id = v_prop.socio_id::text AND ds.tipo = 'reprocann' FOR UPDATE;

    -- VALIDACIÓN DE LINAJE DE EXTRACCIÓN EXACTA
    v_extraction_id := v_prop.document_extraction_id;
    IF v_extraction_id IS NULL AND v_prop.proposal_snapshot IS NOT NULL THEN
        BEGIN
            v_extraction_id := (v_prop.proposal_snapshot->>'document_extraction_id')::uuid;
        EXCEPTION WHEN OTHERS THEN
            v_extraction_id := NULL;
        END;
    END IF;

    IF v_extraction_id IS NULL THEN
        RAISE EXCEPTION 'RENEWAL_EXTRACTION_LINEAGE_MISMATCH: La propuesta no contiene un document_extraction_id inmutable valido.';
    END IF;

    SELECT de.* INTO v_ext FROM public.document_extractions de WHERE de.id = v_extraction_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'RENEWAL_EXTRACTION_LINEAGE_MISMATCH: La extraccion especificada por la propuesta no existe en document_extractions.';
    END IF;

    IF v_ext.document_fingerprint <> v_fingerprint_clean OR v_ext.document_fingerprint <> v_app.document_fingerprint THEN
        RAISE EXCEPTION 'RENEWAL_EXTRACTION_LINEAGE_MISMATCH: El fingerprint de la extraccion no coincide con el documento de la propuesta.';
    END IF;

    -- CURRENT-STATE OCC (CURRENT STATE DRIFT CHECK)
    v_old_curr_fingerprint := '';
    IF v_profile.documento_fuente_id IS NOT NULL THEN
        SELECT COALESCE(ds.document_fingerprint, '') INTO v_old_curr_fingerprint
        FROM public.documentos_socio ds
        WHERE ds.id = v_profile.documento_fuente_id;
    END IF;

    v_snap_curr_fingerprint := v_prop.proposal_snapshot->>'current_state_fingerprint';
    IF v_snap_curr_fingerprint IS NOT NULL AND v_snap_curr_fingerprint <> '' THEN
        v_raw_str := COALESCE(v_profile.id::text, '') || '|' ||
                     COALESCE(v_profile.documento_fuente_id::text, v_app.current_document_id::text, '') || '|' ||
                     COALESCE(v_old_curr_fingerprint, '') || '|' ||
                     COALESCE(v_profile.numero_tramite, v_socio.reprocann_num_tramite, '') || '|' ||
                     COALESCE(v_profile.fecha_alta::text, v_socio.reprocann_fecha_alta::text, '') || '|' ||
                     COALESCE(v_profile.fecha_vencimiento::text, v_socio.reprocann_fecha_vencimiento::text, '') || '|' ||
                     COALESCE(v_profile.tipo, v_socio.reprocann_tipo, '') || '|' ||
                     COALESCE(v_profile.verification_status, '');

        v_act_curr_fingerprint := encode(sha256(v_raw_str::bytea), 'hex');

        IF v_act_curr_fingerprint <> v_snap_curr_fingerprint THEN
            RAISE EXCEPTION 'RENEWAL_CURRENT_STATE_DRIFT: El estado REPROCANN actual del socio ha cambiado respecto al snapshot aprobado.';
        END IF;
    END IF;

    -- PARSE FACTUAL DE LA PROPUESTA (COALESCE DE proposed_facts O SNAPSHOT ROOT)
    v_num_tramite := COALESCE(
        v_prop.proposal_snapshot->'proposed_facts'->>'numero_tramite',
        v_prop.proposal_snapshot->>'numero_tramite'
    );
    v_fecha_alta := COALESCE(
        (v_prop.proposal_snapshot->'proposed_facts'->>'fecha_alta')::date,
        (v_prop.proposal_snapshot->'proposed_facts'->>'fecha_emision')::date,
        (v_prop.proposal_snapshot->>'fecha_alta')::date
    );
    v_fecha_vencimiento := COALESCE(
        (v_prop.proposal_snapshot->'proposed_facts'->>'fecha_vencimiento')::date,
        (v_prop.proposal_snapshot->>'fecha_vencimiento')::date
    );
    v_tipo := COALESCE(
        v_prop.proposal_snapshot->'proposed_facts'->>'tipo',
        v_prop.proposal_snapshot->'proposed_facts'->>'categoria',
        v_prop.proposal_snapshot->>'tipo',
        'PACIENTE'
    );

    IF v_num_tramite IS NULL OR v_num_tramite = '' THEN
        RAISE EXCEPTION 'PROPOSAL_FACTS_INVALID: El numero_tramite de la propuesta no puede ser nulo.';
    END IF;

    -- CÁLCULO DE NUEVA VERSIÓN DOCUMENTAL
    SELECT COALESCE(MAX(ds.version), 0) + 1 INTO v_new_version
    FROM public.documentos_socio ds
    WHERE ds.socio_id = v_prop.socio_id::text AND ds.tipo = 'reprocann';

    -- SUPERSESIÓN ATÓMICA
    SELECT ds.id INTO v_old_current_id
    FROM public.documentos_socio ds
    WHERE ds.socio_id = v_prop.socio_id::text AND ds.tipo = 'reprocann' AND ds.is_current = true
    LIMIT 1;

    IF v_old_current_id IS NOT NULL THEN
        UPDATE public.documentos_socio ds
        SET is_current = false, updated_at = clock_timestamp()
        WHERE ds.id = v_old_current_id;
    END IF;

    v_new_doc_id := gen_random_uuid();
    INSERT INTO public.documentos_socio (
        id, socio_id, tipo, archivo_path, verificacion_estado,
        version, is_current, supersedes_document_id, document_fingerprint,
        fecha_emision, fecha_vencimiento
    ) VALUES (
        v_new_doc_id, v_prop.socio_id::text, 'reprocann', v_path_clean, 'aprobado',
        v_new_version, true, v_old_current_id, v_fingerprint_clean,
        v_fecha_alta,
        v_fecha_vencimiento
    );

    -- MATERIALIZACIÓN / UPSERT EN public.socio_reprocann_profiles
    IF v_profile.id IS NOT NULL THEN
        UPDATE public.socio_reprocann_profiles srp
        SET numero_tramite = v_num_tramite,
            fecha_alta = v_fecha_alta,
            fecha_vencimiento = v_fecha_vencimiento,
            tipo = v_tipo,
            documento_fuente_id = v_new_doc_id,
            document_extraction_id = v_extraction_id,
            verification_status = 'VERIFIED',
            verified_at = clock_timestamp(),
            verified_by = p_actor_id,
            updated_at = clock_timestamp()
        WHERE srp.id = v_profile.id
        RETURNING srp.id INTO v_profile_id;
    ELSE
        INSERT INTO public.socio_reprocann_profiles (
            socio_id, numero_tramite, fecha_alta, fecha_vencimiento, tipo,
            documento_fuente_id, document_extraction_id, verification_status,
            verified_at, verified_by
        ) VALUES (
            v_prop.socio_id, v_num_tramite, v_fecha_alta, v_fecha_vencimiento, v_tipo,
            v_new_doc_id, v_extraction_id, 'VERIFIED',
            clock_timestamp(), p_actor_id
        )
        RETURNING id INTO v_profile_id;
    END IF;

    -- ESTRATEGIA A: PROYECCIÓN TRANSMUTACIONAL EN public.socios (LEGACY_PROJECTION_ONLY)
    UPDATE public.socios s
    SET reprocann_num_tramite = v_num_tramite,
        reprocann_fecha_alta = v_fecha_alta,
        reprocann_fecha_vencimiento = v_fecha_vencimiento,
        reprocann_tipo = v_tipo,
        updated_at = clock_timestamp()
    WHERE s.id = v_prop.socio_id;

    -- ACTUALIZAR ESTADOS DE SOLICITUD Y PROPUESTA A COMPLETED
    UPDATE public.reprocann_renewal_proposals rrp
    SET status = 'COMPLETED', updated_at = clock_timestamp()
    WHERE rrp.id = v_prop.id;

    UPDATE public.reprocann_renewal_applications rra
    SET status = 'COMPLETED', updated_at = clock_timestamp()
    WHERE rra.id = v_app.id;

    -- REGISTRAR EVENTO COMPLETED EN LEDGER APPEND-ONLY
    INSERT INTO public.reprocann_renewal_apply_events (
        proposal_id, application_id, socio_id, actor_id,
        event_type, attempt_id, proposal_hash, materialized_document_id,
        result_code, created_at
    ) VALUES (
        v_prop.id, v_app.id, v_prop.socio_id, p_actor_id,
        'RENEWAL_APPLY_COMPLETED', p_attempt_id, v_prop.proposal_hash, v_new_doc_id,
        'COMPLETED', clock_timestamp()
    );

    RETURN QUERY SELECT v_prop.id, v_app.id, v_prop.socio_id, v_new_doc_id, v_new_version, v_profile_id, 'SUCCESS'::TEXT;
    RETURN;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_historical_reprocann_migration_review_proposal(p_proposal_id uuid, p_action text, p_expected_proposal_hash text, p_actor_id uuid, p_review_comment text DEFAULT NULL::text)
 RETURNS TABLE(proposal_id uuid, socio_id uuid, new_status text, proposal_hash text, reviewed_at timestamp with time zone, reviewed_by uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_proposal RECORD;
    v_new_status TEXT;
    v_now TIMESTAMPTZ := now();
BEGIN
    IF p_actor_id IS NULL THEN
        RAISE EXCEPTION 'p_actor_id_required';
    END IF;
    IF p_action IS NULL OR UPPER(p_action) NOT IN ('APPROVE', 'REJECT') THEN
        RAISE EXCEPTION 'invalid_action';
    END IF;

    SELECT * INTO v_proposal
    FROM public.historical_reprocann_migration_proposals
    WHERE id = p_proposal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'proposal_not_found';
    END IF;

    IF v_proposal.proposal_hash <> p_expected_proposal_hash THEN
        RAISE EXCEPTION 'PROPOSAL_HASH_MISMATCH';
    END IF;

    IF v_proposal.status <> 'AWAITING_REVIEW' THEN
        IF UPPER(p_action) = 'APPROVE' AND v_proposal.status = 'APPROVED' THEN
            RETURN QUERY SELECT v_proposal.id, v_proposal.socio_id, v_proposal.status, v_proposal.proposal_hash, v_proposal.reviewed_at, v_proposal.reviewed_by;
            RETURN;
        ELSIF UPPER(p_action) = 'REJECT' AND v_proposal.status = 'REJECTED' THEN
            RETURN QUERY SELECT v_proposal.id, v_proposal.socio_id, v_proposal.status, v_proposal.proposal_hash, v_proposal.reviewed_at, v_proposal.reviewed_by;
            RETURN;
        ELSE
            RAISE EXCEPTION 'PROPOSAL_NOT_AWAITING_REVIEW';
        END IF;
    END IF;

    IF UPPER(p_action) = 'APPROVE' THEN
        v_new_status := 'APPROVED';
    ELSE
        v_new_status := 'REJECTED';
    END IF;

    UPDATE public.historical_reprocann_migration_proposals
    SET status = v_new_status,
        reviewed_at = v_now,
        reviewed_by = p_actor_id,
        review_comment = p_review_comment,
        approved_proposal_hash = CASE WHEN v_new_status = 'APPROVED' THEN v_proposal.proposal_hash ELSE NULL END
    WHERE id = p_proposal_id;

    INSERT INTO public.historical_reprocann_migration_review_events (
        proposal_id, socio_id, actor_id, proposal_hash, decision, review_comment, created_at
    ) VALUES (
        v_proposal.id, v_proposal.socio_id, p_actor_id, v_proposal.proposal_hash, v_new_status, p_review_comment, v_now
    );

    RETURN QUERY SELECT v_proposal.id, v_proposal.socio_id, v_new_status, v_proposal.proposal_hash, v_now, p_actor_id;
END;
$function$
;
ALTER TABLE public."cierres_mensuales" ALTER COLUMN "numero_constancia" SET DEFAULT generate_cierre_correlativo();
ALTER TABLE public."documentos_socio" ADD CONSTRAINT "documentos_socio_pkey" PRIMARY KEY (id);
ALTER TABLE public."socios" ADD CONSTRAINT "socios_pkey" PRIMARY KEY (id);
ALTER TABLE public."socio_invites" ADD CONSTRAINT "socio_invites_pkey" PRIMARY KEY (id);
ALTER TABLE public."socio_invites" ADD CONSTRAINT "socio_invites_token_key" UNIQUE (token);
ALTER TABLE public."socios" ADD CONSTRAINT "socios_user_id_key" UNIQUE (user_id);
ALTER TABLE public."products" ADD CONSTRAINT "products_pkey" PRIMARY KEY (id);
ALTER TABLE public."socios" ADD CONSTRAINT "valid_roles" CHECK ((rol = ANY (ARRAY['socio'::text, 'staff'::text, 'admin'::text])));
ALTER TABLE public."pedidos" ADD CONSTRAINT "pedidos_tipo_pedido_check" CHECK ((tipo_pedido = ANY (ARRAY['retiro_sede'::text, 'delivery'::text])));
ALTER TABLE public."pedidos" ADD CONSTRAINT "pedidos_pkey" PRIMARY KEY (id);
ALTER TABLE public."audit_logs" ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id);
ALTER TABLE public."socios" ADD CONSTRAINT "socios_auth_user_id_key" UNIQUE (auth_user_id);
ALTER TABLE public."pickup_config" ADD CONSTRAINT "pickup_config_day_of_week_check" CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));
ALTER TABLE public."pickup_config" ADD CONSTRAINT "pickup_config_time_check" CHECK ((end_time > start_time));
ALTER TABLE public."pickup_config" ADD CONSTRAINT "pickup_config_pkey" PRIMARY KEY (id);
ALTER TABLE public."cierres_mensuales" ADD CONSTRAINT "cierres_mensuales_numero_constancia_key" UNIQUE (numero_constancia);
ALTER TABLE public."cierres_mensuales" ADD CONSTRAINT "cierres_mensuales_socio_id_periodo_key" UNIQUE (socio_id, periodo);
ALTER TABLE public."document_extractions" ADD CONSTRAINT "document_extractions_fingerprint_check" CHECK (((source_fingerprint)::text ~ '^[0-9a-f]{64}$'::text));
ALTER TABLE public."document_extractions" ADD CONSTRAINT "document_extractions_extracted_data_object_check" CHECK ((jsonb_typeof(extracted_data) = 'object'::text));
ALTER TABLE public."document_extractions" ADD CONSTRAINT "document_extractions_warnings_array_check" CHECK (((warnings IS NULL) OR (jsonb_typeof(warnings) = 'array'::text)));
ALTER TABLE public."document_extractions" ADD CONSTRAINT "document_extractions_pkey" PRIMARY KEY (id);
ALTER TABLE public."reprocann_renewal_proposals" ADD CONSTRAINT "reprocann_renewal_proposals_pkey" PRIMARY KEY (id);
ALTER TABLE public."pickup_slots" ADD CONSTRAINT "pickup_slots_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text, 'moved'::text])));
ALTER TABLE public."pickup_slots" ADD CONSTRAINT "pickup_slots_time_check" CHECK ((end_time > start_time));
ALTER TABLE public."pickup_slots" ADD CONSTRAINT "pickup_slots_pkey" PRIMARY KEY (id);
ALTER TABLE public."pedidos" ADD CONSTRAINT "pedidos_metodo_pago_check" CHECK ((metodo_pago = ANY (ARRAY['efectivo'::text, 'transferencia'::text])));
ALTER TABLE public."agent_events" ADD CONSTRAINT "agent_events_pkey" PRIMARY KEY (id);
ALTER TABLE public."agent_tasks" ADD CONSTRAINT "agent_tasks_pkey" PRIMARY KEY (id);
ALTER TABLE public."agent_runs" ADD CONSTRAINT "agent_runs_pkey" PRIMARY KEY (id);
ALTER TABLE public."documentos_socio" ADD CONSTRAINT "documentos_socio_tipo_check" CHECK ((tipo = ANY (ARRAY['dni'::text, 'reprocann'::text, 'consentimiento'::text, 'contrato'::text, 'declaracion_jurada'::text, 'declaracionJurada'::text])));
ALTER TABLE public."documentos_socio" ADD CONSTRAINT "documentos_socio_verificacion_estado_check" CHECK ((verificacion_estado = ANY (ARRAY['pendiente'::text, 'en_revision'::text, 'aprobado'::text, 'rechazado'::text])));
ALTER TABLE public."documentos_socio" ADD CONSTRAINT "unique_socio_tipo" UNIQUE (socio_id, tipo);
ALTER TABLE public."pagos" ADD CONSTRAINT "pagos_pkey" PRIMARY KEY (id);
ALTER TABLE public."notificaciones" ADD CONSTRAINT "notificaciones_pkey" PRIMARY KEY (id);
ALTER TABLE public."communication_intents" ADD CONSTRAINT "communication_intents_pkey" PRIMARY KEY (id);
ALTER TABLE public."communication_intents" ADD CONSTRAINT "communication_intents_dedup_key_key" UNIQUE (dedup_key);
ALTER TABLE public."communication_delivery_attempts" ADD CONSTRAINT "communication_delivery_attempts_pkey" PRIMARY KEY (id);
ALTER TABLE public."notificaciones" ADD CONSTRAINT "notificaciones_estado_check" CHECK ((estado = ANY (ARRAY['abierto'::text, 'pendiente'::text, 'cerrado'::text])));
ALTER TABLE public."global_configs" ADD CONSTRAINT "global_configs_pkey" PRIMARY KEY (key);
ALTER TABLE public."pedidos" ADD CONSTRAINT "pedidos_estado_check" CHECK ((estado = ANY (ARRAY['pendiente'::text, 'confirmado'::text, 'en_preparacion'::text, 'listo_para_retiro'::text, 'en_camino'::text, 'retirado'::text, 'entregado'::text, 'cancelado'::text])));
ALTER TABLE public."cierres_mensuales" ADD CONSTRAINT "cierres_mensuales_pkey" PRIMARY KEY (id);
ALTER TABLE public."audit_findings" ADD CONSTRAINT "audit_findings_domain_check" CHECK (((domain)::text = ANY ((ARRAY['STOCK'::character varying, 'PAYMENTS'::character varying, 'ORDERS'::character varying, 'DOCUMENTATION'::character varying, 'COMPLIANCE'::character varying, 'MONTHLY_CLOSE'::character varying])::text[])));
ALTER TABLE public."audit_findings" ADD CONSTRAINT "audit_findings_severity_check" CHECK (((severity)::text = ANY ((ARRAY['INFO'::character varying, 'LOW'::character varying, 'MEDIUM'::character varying, 'HIGH'::character varying, 'CRITICAL'::character varying])::text[])));
ALTER TABLE public."audit_findings" ADD CONSTRAINT "audit_findings_status_check" CHECK (((status)::text = ANY ((ARRAY['OPEN'::character varying, 'IN_REVIEW'::character varying, 'RESOLVED'::character varying, 'DISMISSED'::character varying])::text[])));
ALTER TABLE public."audit_findings" ADD CONSTRAINT "audit_findings_last_seen_check" CHECK ((last_seen_at >= detected_at));
ALTER TABLE public."audit_findings" ADD CONSTRAINT "audit_findings_pkey" PRIMARY KEY (id);
ALTER TABLE public."document_extractions" ADD CONSTRAINT "document_extractions_status_check" CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'PROCESSING'::character varying, 'EXTRACTED'::character varying, 'NEEDS_REVIEW'::character varying, 'UNSUPPORTED'::character varying, 'FAILED'::character varying])::text[])));
ALTER TABLE public."profile_update_proposals" ADD CONSTRAINT "profile_update_proposals_operation_check" CHECK (((operation)::text = ANY ((ARRAY['ADD'::character varying, 'CHANGE'::character varying])::text[])));
ALTER TABLE public."profile_update_proposals" ADD CONSTRAINT "profile_update_proposals_status_check" CHECK (((status)::text = ANY ((ARRAY['PENDING_REVIEW'::character varying, 'APPROVED'::character varying, 'REJECTED'::character varying, 'APPLIED'::character varying, 'CANCELLED'::character varying])::text[])));
ALTER TABLE public."profile_update_proposals" ADD CONSTRAINT "profile_update_proposals_source_ext_status_check" CHECK (((source_extraction_status)::text = ANY ((ARRAY['EXTRACTED'::character varying, 'NEEDS_REVIEW'::character varying])::text[])));
ALTER TABLE public."profile_update_proposals" ADD CONSTRAINT "profile_update_proposals_review_notes_check" CHECK (((review_notes IS NULL) OR (char_length(review_notes) <= 500)));
ALTER TABLE public."profile_update_proposals" ADD CONSTRAINT "profile_update_proposals_pkey" PRIMARY KEY (id);
ALTER TABLE public."communication_intents" ADD CONSTRAINT "chk_communication_intents_review_notes_length" CHECK (((review_notes IS NULL) OR (char_length(review_notes) <= 500)));
ALTER TABLE public."order_confirmation_receipts" ADD CONSTRAINT "order_confirmation_receipts_pkey" PRIMARY KEY (order_id, request_hash);
ALTER TABLE public."documentos_socio_versiones" ADD CONSTRAINT "documentos_socio_versiones_pkey" PRIMARY KEY (id);
ALTER TABLE public."onboarding_applications" ADD CONSTRAINT "onboarding_applications_pkey" PRIMARY KEY (id);
ALTER TABLE public."onboarding_documents" ADD CONSTRAINT "onboarding_documents_type_check" CHECK ((document_type = ANY (ARRAY['CERTIFICADO_REPROCANN'::text, 'CONSENTIMIENTO_INFORMADO'::text])));
ALTER TABLE public."onboarding_documents" ADD CONSTRAINT "onboarding_documents_extraction_status_check" CHECK (((extraction_status IS NULL) OR (extraction_status = ANY (ARRAY['EXTRACTED'::text, 'NEEDS_REVIEW'::text, 'FAILED'::text]))));
ALTER TABLE public."onboarding_documents" ADD CONSTRAINT "onboarding_documents_pkey" PRIMARY KEY (id);
ALTER TABLE public."onboarding_documents" ADD CONSTRAINT "onboarding_documents_identity_unique" UNIQUE (id, application_id, document_fingerprint, document_type);
ALTER TABLE public."onboarding_extractions" ADD CONSTRAINT "onboarding_extractions_status_check" CHECK ((status = ANY (ARRAY['EXTRACTED'::text, 'NEEDS_REVIEW'::text, 'FAILED'::text])));
ALTER TABLE public."onboarding_extractions" ADD CONSTRAINT "onboarding_extractions_pkey" PRIMARY KEY (id);
ALTER TABLE public."onboarding_proposals" ADD CONSTRAINT "onboarding_proposals_pkey" PRIMARY KEY (id);
ALTER TABLE public."onboarding_proposals" ADD CONSTRAINT "onboarding_proposals_status_check" CHECK ((status = ANY (ARRAY['AWAITING_REVIEW'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
ALTER TABLE public."onboarding_applications" ADD CONSTRAINT "onboarding_applications_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'STAGED'::text, 'EXTRACTED'::text, 'AWAITING_REVIEW'::text, 'APPROVED'::text, 'APPLYING'::text, 'APPLY_FAILED'::text, 'READY_FOR_INVITATION'::text, 'INVITING'::text, 'INVITE_FAILED'::text, 'COMPLETED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
ALTER TABLE public."socio_reprocann_profiles" ADD CONSTRAINT "socio_reprocann_profiles_pkey" PRIMARY KEY (id);
ALTER TABLE public."socio_reprocann_profiles" ADD CONSTRAINT "uq_socio_reprocann_tramite" UNIQUE (socio_id, numero_tramite);
ALTER TABLE public."socio_clinical_profiles" ADD CONSTRAINT "socio_clinical_profiles_pkey" PRIMARY KEY (id);
ALTER TABLE public."socio_clinical_profiles" ADD CONSTRAINT "uq_socio_clinical_profile" UNIQUE (socio_id);
ALTER TABLE public."documentos_socio" ADD CONSTRAINT "uq_documentos_socio_idempotency" UNIQUE (socio_id, tipo, document_fingerprint);
ALTER TABLE public."onboarding_application_materializations" ADD CONSTRAINT "onboarding_application_materializations_pkey" PRIMARY KEY (id);
ALTER TABLE public."onboarding_application_materializations" ADD CONSTRAINT "onboarding_application_materializations_application_id_key" UNIQUE (application_id);
ALTER TABLE public."onboarding_application_materializations" ADD CONSTRAINT "onboarding_application_materializations_socio_id_key" UNIQUE (socio_id);
ALTER TABLE public."onboarding_apply_attempts" ADD CONSTRAINT "onboarding_apply_attempts_step_check" CHECK ((step_name = ANY (ARRAY['STORAGE_COPY'::text, 'DB_TRANSACTION'::text])));
ALTER TABLE public."onboarding_apply_attempts" ADD CONSTRAINT "onboarding_apply_attempts_status_check" CHECK ((status = ANY (ARRAY['STARTED'::text, 'COMPLETED'::text, 'FAILED'::text])));
ALTER TABLE public."onboarding_apply_attempts" ADD CONSTRAINT "onboarding_apply_attempts_pkey" PRIMARY KEY (id);
ALTER TABLE public."onboarding_invite_attempts" ADD CONSTRAINT "onboarding_invite_attempts_pkey" PRIMARY KEY (id);
ALTER TABLE public."onboarding_review_events" ADD CONSTRAINT "onboarding_review_events_decision_check" CHECK ((decision = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text])));
ALTER TABLE public."onboarding_review_events" ADD CONSTRAINT "onboarding_review_events_actor_id_check" CHECK ((char_length(TRIM(BOTH FROM actor_id)) > 0));
ALTER TABLE public."onboarding_review_events" ADD CONSTRAINT "onboarding_review_events_proposal_hash_check" CHECK ((char_length(TRIM(BOTH FROM proposal_hash)) > 0));
ALTER TABLE public."onboarding_review_events" ADD CONSTRAINT "onboarding_review_events_pkey" PRIMARY KEY (id);
ALTER TABLE public."onboarding_review_events" ADD CONSTRAINT "onboarding_review_events_proposal_id_unique" UNIQUE (proposal_id);
ALTER TABLE public."onboarding_invite_attempts" ADD CONSTRAINT "onboarding_invite_attempts_step_check" CHECK ((step_name = ANY (ARRAY['AUTH_USER_LOOKUP_OR_CREATE'::text, 'EMAIL_DELIVERY'::text, 'PRECONDITION_VERIFICATION'::text, 'AUTH_RECONCILIATION'::text, 'AUTH_USER_INVITE'::text, 'DB_LINK_VINCULACION'::text, 'TERMINAL_VERIFICATION'::text])));
ALTER TABLE public."onboarding_invite_attempts" ADD CONSTRAINT "onboarding_invite_attempts_status_check" CHECK ((status = ANY (ARRAY['STARTED'::text, 'COMPLETED'::text, 'FAILED'::text, 'SKIPPED'::text])));
ALTER TABLE public."reprocann_renewal_applications" ADD CONSTRAINT "reprocann_renewal_applications_status_check" CHECK ((status = ANY (ARRAY['STAGED'::text, 'EXTRACTED'::text, 'AWAITING_REVIEW'::text, 'APPROVED'::text, 'APPLYING'::text, 'APPLY_FAILED'::text, 'COMPLETED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
ALTER TABLE public."reprocann_renewal_applications" ADD CONSTRAINT "reprocann_renewal_applications_pkey" PRIMARY KEY (id);
ALTER TABLE public."reprocann_renewal_review_events" ADD CONSTRAINT "reprocann_renewal_review_events_decision_check" CHECK ((decision = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text])));
ALTER TABLE public."reprocann_renewal_review_events" ADD CONSTRAINT "reprocann_renewal_review_events_pkey" PRIMARY KEY (id);
ALTER TABLE public."reprocann_renewal_review_events" ADD CONSTRAINT "uq_reprocann_renewal_review_events_proposal_id" UNIQUE (proposal_id);
ALTER TABLE public."reprocann_renewal_proposals" ADD CONSTRAINT "reprocann_renewal_proposals_status_check" CHECK ((status = ANY (ARRAY['AWAITING_REVIEW'::text, 'APPROVED'::text, 'APPLYING'::text, 'APPLY_FAILED'::text, 'COMPLETED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
ALTER TABLE public."reprocann_renewal_apply_events" ADD CONSTRAINT "reprocann_renewal_apply_events_type_check" CHECK ((event_type = ANY (ARRAY['RENEWAL_APPLY_STARTED'::text, 'RENEWAL_APPLY_COMPLETED'::text, 'RENEWAL_APPLY_FAILED'::text])));
ALTER TABLE public."reprocann_renewal_apply_events" ADD CONSTRAINT "reprocann_renewal_apply_events_pkey" PRIMARY KEY (id);
ALTER TABLE public."historical_reprocann_migration_proposals" ADD CONSTRAINT "historical_migration_proposals_status_check" CHECK ((status = ANY (ARRAY['AWAITING_REVIEW'::text, 'APPROVED'::text, 'REJECTED'::text, 'SUPERSEDED'::text, 'COMPLETED'::text])));
ALTER TABLE public."historical_reprocann_migration_proposals" ADD CONSTRAINT "historical_migration_proposals_classification_check" CHECK ((source_classification = ANY (ARRAY['ALREADY_CANONICAL'::text, 'AUTO_PROPOSABLE'::text, 'HUMAN_REVIEW_REQUIRED'::text, 'INSUFFICIENT_EVIDENCE'::text, 'CONFLICT'::text, 'NOT_APPLICABLE_NO_LEGACY_DATA'::text])));
ALTER TABLE public."historical_reprocann_migration_proposals" ADD CONSTRAINT "historical_migration_proposals_tier_check" CHECK ((evidence_tier = ANY (ARRAY['TIER_A'::text, 'TIER_B'::text, 'TIER_C'::text, 'TIER_D'::text, 'TIER_E'::text, 'TIER_NA'::text])));
ALTER TABLE public."historical_reprocann_migration_proposals" ADD CONSTRAINT "historical_reprocann_migration_proposals_pkey" PRIMARY KEY (id);
ALTER TABLE public."historical_reprocann_migration_proposals" ADD CONSTRAINT "historical_reprocann_migration_proposals_proposal_hash_key" UNIQUE (proposal_hash);
ALTER TABLE public."historical_reprocann_migration_review_events" ADD CONSTRAINT "historical_migration_review_events_decision_check" CHECK ((decision = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text])));
ALTER TABLE public."historical_reprocann_migration_review_events" ADD CONSTRAINT "historical_reprocann_migration_review_events_pkey" PRIMARY KEY (id);
ALTER TABLE public."historical_reprocann_migration_review_events" ADD CONSTRAINT "uq_historical_migration_review_events_proposal_id" UNIQUE (proposal_id);
ALTER TABLE public."historical_reprocann_migration_apply_events" ADD CONSTRAINT "historical_migration_apply_events_type_check" CHECK ((event_type = ANY (ARRAY['HISTORICAL_MIGRATION_APPLY_STARTED'::text, 'HISTORICAL_MIGRATION_APPLY_COMPLETED'::text, 'HISTORICAL_MIGRATION_APPLY_FAILED'::text])));
ALTER TABLE public."historical_reprocann_migration_apply_events" ADD CONSTRAINT "historical_reprocann_migration_apply_events_pkey" PRIMARY KEY (id);
ALTER TABLE public."socio_invites" ADD CONSTRAINT "socio_invites_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE CASCADE;
ALTER TABLE public."communication_delivery_attempts" ADD CONSTRAINT "communication_delivery_attempts_intent_id_fkey" FOREIGN KEY (intent_id) REFERENCES communication_intents(id);
ALTER TABLE public."document_extractions" ADD CONSTRAINT "document_extractions_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE RESTRICT;
ALTER TABLE public."pedidos" ADD CONSTRAINT "pedidos_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE CASCADE;
ALTER TABLE public."audit_logs" ADD CONSTRAINT "audit_logs_actor_socio_id_fkey" FOREIGN KEY (actor_socio_id) REFERENCES socios(id) ON DELETE SET NULL;
ALTER TABLE public."cierres_mensuales" ADD CONSTRAINT "cierres_mensuales_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE CASCADE;
ALTER TABLE public."pickup_slots" ADD CONSTRAINT "pickup_slots_source_config_id_fkey" FOREIGN KEY (source_config_id) REFERENCES pickup_config(id) ON DELETE SET NULL;
ALTER TABLE public."pedidos" ADD CONSTRAINT "pedidos_slot_id_fkey" FOREIGN KEY (slot_id) REFERENCES pickup_slots(id) ON DELETE SET NULL;
ALTER TABLE public."document_extractions" ADD CONSTRAINT "document_extractions_document_id_fkey" FOREIGN KEY (document_id) REFERENCES documentos_socio(id) ON DELETE RESTRICT;
ALTER TABLE public."pagos" ADD CONSTRAINT "pagos_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE CASCADE;
ALTER TABLE public."audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."socios" ADD CONSTRAINT "socios_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."socios" ADD CONSTRAINT "socios_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."socios" ADD CONSTRAINT "socios_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."pagos" ADD CONSTRAINT "pagos_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."notificaciones" ADD CONSTRAINT "notificaciones_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE CASCADE;
ALTER TABLE public."notificaciones" ADD CONSTRAINT "notificaciones_remitente_id_fkey" FOREIGN KEY (remitente_id) REFERENCES socios(id);
ALTER TABLE public."notificaciones" ADD CONSTRAINT "notificaciones_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES notificaciones(id) ON DELETE CASCADE;
ALTER TABLE public."communication_intents" ADD CONSTRAINT "communication_intents_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id);
ALTER TABLE public."notificaciones" ADD CONSTRAINT "notificaciones_asignado_a_fkey" FOREIGN KEY (asignado_a) REFERENCES socios(id);
ALTER TABLE public."pagos" ADD CONSTRAINT "pagos_pedido_id_fkey" FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE SET NULL;
ALTER TABLE public."profile_update_proposals" ADD CONSTRAINT "profile_update_proposals_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE RESTRICT;
ALTER TABLE public."profile_update_proposals" ADD CONSTRAINT "profile_update_proposals_document_id_fkey" FOREIGN KEY (document_id) REFERENCES documentos_socio(id) ON DELETE RESTRICT;
ALTER TABLE public."profile_update_proposals" ADD CONSTRAINT "profile_update_proposals_extraction_id_fkey" FOREIGN KEY (extraction_id) REFERENCES document_extractions(id) ON DELETE RESTRICT;
ALTER TABLE public."reprocann_renewal_proposals" ADD CONSTRAINT "reprocann_renewal_proposals_renewal_application_id_fkey" FOREIGN KEY (renewal_application_id) REFERENCES reprocann_renewal_applications(id) ON DELETE RESTRICT;
ALTER TABLE public."order_confirmation_receipts" ADD CONSTRAINT "order_confirmation_receipts_order_id_fkey" FOREIGN KEY (order_id) REFERENCES pedidos(id);
ALTER TABLE public."reprocann_renewal_proposals" ADD CONSTRAINT "reprocann_renewal_proposals_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE RESTRICT;
ALTER TABLE public."onboarding_documents" ADD CONSTRAINT "onboarding_documents_application_id_fkey" FOREIGN KEY (application_id) REFERENCES onboarding_applications(id) ON DELETE RESTRICT;
ALTER TABLE public."onboarding_extractions" ADD CONSTRAINT "onboarding_extractions_application_id_fkey" FOREIGN KEY (application_id) REFERENCES onboarding_applications(id) ON DELETE RESTRICT;
ALTER TABLE public."onboarding_extractions" ADD CONSTRAINT "onboarding_extractions_document_id_fkey" FOREIGN KEY (document_id) REFERENCES onboarding_documents(id) ON DELETE RESTRICT;
ALTER TABLE public."onboarding_extractions" ADD CONSTRAINT "onboarding_extractions_document_identity_fk" FOREIGN KEY (document_id, application_id, document_fingerprint, document_type) REFERENCES onboarding_documents(id, application_id, document_fingerprint, document_type) ON DELETE RESTRICT;
ALTER TABLE public."onboarding_proposals" ADD CONSTRAINT "onboarding_proposals_application_id_fkey" FOREIGN KEY (application_id) REFERENCES onboarding_applications(id) ON DELETE RESTRICT;
ALTER TABLE public."socio_reprocann_profiles" ADD CONSTRAINT "socio_reprocann_profiles_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE CASCADE;
ALTER TABLE public."socio_reprocann_profiles" ADD CONSTRAINT "socio_reprocann_profiles_documento_fuente_id_fkey" FOREIGN KEY (documento_fuente_id) REFERENCES documentos_socio(id);
ALTER TABLE public."socio_reprocann_profiles" ADD CONSTRAINT "socio_reprocann_profiles_onboarding_extraction_id_fkey" FOREIGN KEY (onboarding_extraction_id) REFERENCES onboarding_extractions(id);
ALTER TABLE public."socio_clinical_profiles" ADD CONSTRAINT "socio_clinical_profiles_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE CASCADE;
ALTER TABLE public."socio_clinical_profiles" ADD CONSTRAINT "socio_clinical_profiles_documento_fuente_id_fkey" FOREIGN KEY (documento_fuente_id) REFERENCES documentos_socio(id);
ALTER TABLE public."socio_clinical_profiles" ADD CONSTRAINT "socio_clinical_profiles_onboarding_extraction_id_fkey" FOREIGN KEY (onboarding_extraction_id) REFERENCES onboarding_extractions(id);
ALTER TABLE public."documentos_socio" ADD CONSTRAINT "documentos_socio_onboarding_document_id_fkey" FOREIGN KEY (onboarding_document_id) REFERENCES onboarding_documents(id);
ALTER TABLE public."documentos_socio" ADD CONSTRAINT "documentos_socio_onboarding_extraction_id_fkey" FOREIGN KEY (onboarding_extraction_id) REFERENCES onboarding_extractions(id);
ALTER TABLE public."onboarding_application_materializations" ADD CONSTRAINT "onboarding_application_materializations_application_id_fkey" FOREIGN KEY (application_id) REFERENCES onboarding_applications(id) ON DELETE RESTRICT;
ALTER TABLE public."onboarding_application_materializations" ADD CONSTRAINT "onboarding_application_materializations_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES onboarding_proposals(id);
ALTER TABLE public."onboarding_application_materializations" ADD CONSTRAINT "onboarding_application_materializations_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE RESTRICT;
ALTER TABLE public."onboarding_apply_attempts" ADD CONSTRAINT "onboarding_apply_attempts_application_id_fkey" FOREIGN KEY (application_id) REFERENCES onboarding_applications(id) ON DELETE CASCADE;
ALTER TABLE public."onboarding_apply_attempts" ADD CONSTRAINT "onboarding_apply_attempts_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES onboarding_proposals(id);
ALTER TABLE public."onboarding_invite_attempts" ADD CONSTRAINT "onboarding_invite_attempts_application_id_fkey" FOREIGN KEY (application_id) REFERENCES onboarding_applications(id) ON DELETE CASCADE;
ALTER TABLE public."onboarding_invite_attempts" ADD CONSTRAINT "onboarding_invite_attempts_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id);
ALTER TABLE public."onboarding_invite_attempts" ADD CONSTRAINT "onboarding_invite_attempts_delivery_attempt_id_fkey" FOREIGN KEY (delivery_attempt_id) REFERENCES communication_delivery_attempts(id);
ALTER TABLE public."onboarding_review_events" ADD CONSTRAINT "onboarding_review_events_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES onboarding_proposals(id) ON DELETE RESTRICT;
ALTER TABLE public."onboarding_review_events" ADD CONSTRAINT "onboarding_review_events_application_id_fkey" FOREIGN KEY (application_id) REFERENCES onboarding_applications(id) ON DELETE RESTRICT;
ALTER TABLE public."documentos_socio" ADD CONSTRAINT "documentos_socio_supersedes_document_id_fkey" FOREIGN KEY (supersedes_document_id) REFERENCES documentos_socio(id) ON DELETE SET NULL;
ALTER TABLE public."reprocann_renewal_applications" ADD CONSTRAINT "reprocann_renewal_applications_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE RESTRICT;
ALTER TABLE public."reprocann_renewal_applications" ADD CONSTRAINT "reprocann_renewal_application_current_reprocann_profile_id_fkey" FOREIGN KEY (current_reprocann_profile_id) REFERENCES socio_reprocann_profiles(id);
ALTER TABLE public."reprocann_renewal_applications" ADD CONSTRAINT "reprocann_renewal_applications_current_document_id_fkey" FOREIGN KEY (current_document_id) REFERENCES documentos_socio(id);
ALTER TABLE public."reprocann_renewal_review_events" ADD CONSTRAINT "reprocann_renewal_review_events_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES reprocann_renewal_proposals(id) ON DELETE RESTRICT;
ALTER TABLE public."reprocann_renewal_review_events" ADD CONSTRAINT "reprocann_renewal_review_events_application_id_fkey" FOREIGN KEY (application_id) REFERENCES reprocann_renewal_applications(id) ON DELETE RESTRICT;
ALTER TABLE public."socio_reprocann_profiles" ADD CONSTRAINT "socio_reprocann_profiles_document_extraction_id_fkey" FOREIGN KEY (document_extraction_id) REFERENCES document_extractions(id) ON DELETE RESTRICT;
ALTER TABLE public."reprocann_renewal_proposals" ADD CONSTRAINT "reprocann_renewal_proposals_document_extraction_id_fkey" FOREIGN KEY (document_extraction_id) REFERENCES document_extractions(id) ON DELETE RESTRICT;
ALTER TABLE public."reprocann_renewal_apply_events" ADD CONSTRAINT "reprocann_renewal_apply_events_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES reprocann_renewal_proposals(id) ON DELETE RESTRICT;
ALTER TABLE public."reprocann_renewal_apply_events" ADD CONSTRAINT "reprocann_renewal_apply_events_application_id_fkey" FOREIGN KEY (application_id) REFERENCES reprocann_renewal_applications(id) ON DELETE RESTRICT;
ALTER TABLE public."reprocann_renewal_apply_events" ADD CONSTRAINT "reprocann_renewal_apply_events_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE RESTRICT;
ALTER TABLE public."reprocann_renewal_apply_events" ADD CONSTRAINT "reprocann_renewal_apply_events_materialized_document_id_fkey" FOREIGN KEY (materialized_document_id) REFERENCES documentos_socio(id) ON DELETE RESTRICT;
ALTER TABLE public."historical_reprocann_migration_proposals" ADD CONSTRAINT "historical_reprocann_migration_proposals_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE CASCADE;
ALTER TABLE public."historical_reprocann_migration_review_events" ADD CONSTRAINT "historical_reprocann_migration_review_events_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES historical_reprocann_migration_proposals(id) ON DELETE RESTRICT;
ALTER TABLE public."historical_reprocann_migration_review_events" ADD CONSTRAINT "historical_reprocann_migration_review_events_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE RESTRICT;
ALTER TABLE public."historical_reprocann_migration_apply_events" ADD CONSTRAINT "historical_reprocann_migration_apply_events_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES historical_reprocann_migration_proposals(id) ON DELETE RESTRICT;
ALTER TABLE public."historical_reprocann_migration_apply_events" ADD CONSTRAINT "historical_reprocann_migration_apply_events_socio_id_fkey" FOREIGN KEY (socio_id) REFERENCES socios(id) ON DELETE RESTRICT;
GRANT ALL ON public."socios" TO service_role;
ALTER TABLE public."socios" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."pickup_config" TO service_role;
ALTER TABLE public."pickup_config" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."pickup_slots" TO service_role;
ALTER TABLE public."pickup_slots" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."audit_findings" TO service_role;
ALTER TABLE public."audit_findings" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."socio_invites" TO service_role;
ALTER TABLE public."socio_invites" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."pagos" TO service_role;
ALTER TABLE public."pagos" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."communication_intents" TO service_role;
ALTER TABLE public."communication_intents" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."notificaciones" TO service_role;
ALTER TABLE public."notificaciones" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."products" TO service_role;
ALTER TABLE public."products" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."pedidos" TO service_role;
ALTER TABLE public."pedidos" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."communication_delivery_attempts" TO service_role;
ALTER TABLE public."communication_delivery_attempts" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."profile_update_proposals" TO service_role;
ALTER TABLE public."profile_update_proposals" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."cierres_mensuales" TO service_role;
ALTER TABLE public."cierres_mensuales" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."audit_logs" TO service_role;
ALTER TABLE public."audit_logs" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."global_configs" TO service_role;
ALTER TABLE public."global_configs" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."documentos_socio" TO service_role;
ALTER TABLE public."documentos_socio" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."agent_events" TO service_role;
ALTER TABLE public."agent_events" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."agent_tasks" TO service_role;
ALTER TABLE public."agent_tasks" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."agent_runs" TO service_role;
ALTER TABLE public."agent_runs" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."order_confirmation_receipts" TO service_role;
ALTER TABLE public."order_confirmation_receipts" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."documentos_socio_versiones" TO service_role;
ALTER TABLE public."documentos_socio_versiones" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."onboarding_applications" TO service_role;
ALTER TABLE public."onboarding_applications" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."onboarding_documents" TO service_role;
ALTER TABLE public."onboarding_documents" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."onboarding_extractions" TO service_role;
ALTER TABLE public."onboarding_extractions" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."onboarding_proposals" TO service_role;
ALTER TABLE public."onboarding_proposals" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."onboarding_review_events" TO service_role;
ALTER TABLE public."onboarding_review_events" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."socio_clinical_profiles" TO service_role;
ALTER TABLE public."socio_clinical_profiles" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."onboarding_application_materializations" TO service_role;
ALTER TABLE public."onboarding_application_materializations" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."onboarding_apply_attempts" TO service_role;
ALTER TABLE public."onboarding_apply_attempts" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."socio_reprocann_profiles" TO service_role;
ALTER TABLE public."socio_reprocann_profiles" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."onboarding_invite_attempts" TO service_role;
ALTER TABLE public."onboarding_invite_attempts" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."document_extractions" TO service_role;
ALTER TABLE public."document_extractions" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."reprocann_renewal_applications" TO service_role;
ALTER TABLE public."reprocann_renewal_applications" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."reprocann_renewal_review_events" TO service_role;
ALTER TABLE public."reprocann_renewal_review_events" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."reprocann_renewal_proposals" TO service_role;
ALTER TABLE public."reprocann_renewal_proposals" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."reprocann_renewal_apply_events" TO service_role;
ALTER TABLE public."reprocann_renewal_apply_events" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."historical_reprocann_migration_proposals" TO service_role;
ALTER TABLE public."historical_reprocann_migration_proposals" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."historical_reprocann_migration_review_events" TO service_role;
ALTER TABLE public."historical_reprocann_migration_review_events" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."historical_reprocann_migration_apply_events" TO service_role;
ALTER TABLE public."historical_reprocann_migration_apply_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p_onboarding_applications_service_role_all" ON "public"."onboarding_applications" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_onboarding_documents_service_role_all" ON "public"."onboarding_documents" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_onboarding_extractions_service_role_all" ON "public"."onboarding_extractions" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_onboarding_proposals_service_role_all" ON "public"."onboarding_proposals" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_onboarding_applications_no_public_read" ON "public"."onboarding_applications" AS PERMISSIVE FOR SELECT TO "anon","authenticated" USING (false);
CREATE POLICY "p_onboarding_documents_no_public_read" ON "public"."onboarding_documents" AS PERMISSIVE FOR SELECT TO "anon","authenticated" USING (false);
CREATE POLICY "p_onboarding_extractions_no_public_read" ON "public"."onboarding_extractions" AS PERMISSIVE FOR SELECT TO "anon","authenticated" USING (false);
CREATE POLICY "p_onboarding_proposals_no_public_read" ON "public"."onboarding_proposals" AS PERMISSIVE FOR SELECT TO "anon","authenticated" USING (false);
CREATE POLICY "socios_own_orders" ON "public"."pedidos" AS PERMISSIVE FOR SELECT TO "public" USING ((socio_id IN ( SELECT socios.id
   FROM socios
  WHERE (socios.user_id = auth.uid()))));
CREATE POLICY "Admins and Staff can manage all pagos" ON "public"."pagos" AS PERMISSIVE FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM socios
  WHERE ((socios.user_id = auth.uid()) AND (socios.rol = ANY (ARRAY['admin'::text, 'staff'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM socios
  WHERE ((socios.user_id = auth.uid()) AND (socios.rol = ANY (ARRAY['admin'::text, 'staff'::text]))))));
CREATE POLICY "p_socio_reprocann_profiles_service_role_all" ON "public"."socio_reprocann_profiles" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_socio_clinical_profiles_service_role_all" ON "public"."socio_clinical_profiles" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_materializations_service_role_all" ON "public"."onboarding_application_materializations" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_apply_attempts_service_role_all" ON "public"."onboarding_apply_attempts" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_invite_attempts_service_role_all" ON "public"."onboarding_invite_attempts" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "Public can read active products" ON "public"."products" AS PERMISSIVE FOR SELECT TO "public" USING ((activo = true));
CREATE POLICY "Socios can view their own pagos" ON "public"."pagos" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((socio_id = ( SELECT socios.id
   FROM socios
  WHERE (socios.user_id = auth.uid())
 LIMIT 1)));
CREATE POLICY "p_document_extractions_service_role_all" ON "public"."document_extractions" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_reprocann_renewal_applications_service_role_all" ON "public"."reprocann_renewal_applications" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_reprocann_renewal_proposals_service_role_all" ON "public"."reprocann_renewal_proposals" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "notif_admin_full" ON "public"."notificaciones" AS PERMISSIVE FOR ALL TO "authenticated" USING ((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text]))) WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text])));
CREATE POLICY "Anyone can read global_configs" ON "public"."global_configs" AS PERMISSIVE FOR SELECT TO "public" USING (true);
CREATE POLICY "p_reprocann_renewal_review_events_service_role" ON "public"."reprocann_renewal_review_events" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "Staff and Admin can manage products" ON "public"."products" AS PERMISSIVE FOR ALL TO "public" USING ((get_auth_role() = ANY (ARRAY['admin'::text, 'staff'::text])));
CREATE POLICY "staff_admin_manage_orders" ON "public"."pedidos" AS PERMISSIVE FOR ALL TO "public" USING ((get_auth_role() = ANY (ARRAY['admin'::text, 'staff'::text])));
CREATE POLICY "admins_staff_can_insert_socios" ON "public"."socios" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM socios me
  WHERE ((me.user_id = auth.uid()) AND (me.rol = ANY (ARRAY['admin'::text, 'staff'::text]))))));
CREATE POLICY "admin_view_audit_logs" ON "public"."audit_logs" AS PERMISSIVE FOR SELECT TO "public" USING ((EXISTS ( SELECT 1
   FROM socios
  WHERE ((socios.user_id = auth.uid()) AND (socios.rol = 'admin'::text)))));
CREATE POLICY "allow_insert_audit_logs" ON "public"."audit_logs" AS PERMISSIVE FOR INSERT TO "public" WITH CHECK (true);
CREATE POLICY "notif_socio_read" ON "public"."notificaciones" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((socio_id IN ( SELECT socios.id
   FROM socios
  WHERE (socios.auth_user_id = auth.uid()))) OR (remitente_id IN ( SELECT socios.id
   FROM socios
  WHERE (socios.auth_user_id = auth.uid())))));
CREATE POLICY "notif_socio_insert" ON "public"."notificaciones" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((es_para_admin = true) AND (remitente_id IN ( SELECT socios.id
   FROM socios
  WHERE (socios.auth_user_id = auth.uid())))));
CREATE POLICY "Admins and Staff can manage global_configs" ON "public"."global_configs" AS PERMISSIVE FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM socios
  WHERE (((socios.user_id = auth.uid()) OR (socios.auth_user_id = auth.uid())) AND (socios.rol = ANY (ARRAY['admin'::text, 'staff'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM socios
  WHERE (((socios.user_id = auth.uid()) OR (socios.auth_user_id = auth.uid())) AND (socios.rol = ANY (ARRAY['admin'::text, 'staff'::text]))))));
CREATE POLICY "p_reprocann_renewal_apply_events_service_role" ON "public"."reprocann_renewal_apply_events" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_doc_extractions_service_role_all" ON "public"."document_extractions" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_doc_extractions_no_public_read" ON "public"."document_extractions" AS PERMISSIVE FOR SELECT TO "anon","authenticated" USING (false);
CREATE POLICY "p_historical_migration_proposals_service_role" ON "public"."historical_reprocann_migration_proposals" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_historical_migration_review_events_service_role" ON "public"."historical_reprocann_migration_review_events" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "Admin and Staff Manage Socios" ON "public"."socios" AS PERMISSIVE FOR ALL TO "authenticated" USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'staff'::text])) OR (get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text]))));
CREATE POLICY "p_profile_proposals_service_role_all" ON "public"."profile_update_proposals" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "p_profile_proposals_no_public_read" ON "public"."profile_update_proposals" AS PERMISSIVE FOR SELECT TO "anon","authenticated" USING (false);
CREATE POLICY "p_historical_migration_apply_events_service_role" ON "public"."historical_reprocann_migration_apply_events" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "Admin/Staff can manage pickup_config" ON "public"."pickup_config" AS PERMISSIVE FOR ALL TO "public" USING ((EXISTS ( SELECT 1
   FROM socios
  WHERE ((socios.user_id = auth.uid()) AND (socios.rol = ANY (ARRAY['admin'::text, 'staff'::text]))))));
CREATE POLICY "Admin/Staff can manage pickup_slots" ON "public"."pickup_slots" AS PERMISSIVE FOR ALL TO "public" USING ((EXISTS ( SELECT 1
   FROM socios
  WHERE ((socios.user_id = auth.uid()) AND (socios.rol = ANY (ARRAY['admin'::text, 'staff'::text]))))));
CREATE POLICY "Socios can view active slots" ON "public"."pickup_slots" AS PERMISSIVE FOR SELECT TO "public" USING ((status = 'active'::text));
CREATE POLICY "Socios can update their own orders" ON "public"."pedidos" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM socios
  WHERE ((socios.id = pedidos.socio_id) AND (socios.user_id = auth.uid())))));
CREATE POLICY "Admin and Staff Manage Orders" ON "public"."pedidos" AS PERMISSIVE FOR ALL TO "public" USING ((EXISTS ( SELECT 1
   FROM socios
  WHERE ((socios.user_id = auth.uid()) AND (socios.rol = ANY (ARRAY['admin'::text, 'staff'::text]))))));
CREATE POLICY "Staff and Admin can manage all socios" ON "public"."socios" AS PERMISSIVE FOR ALL TO "public" USING ((get_auth_role() = ANY (ARRAY['admin'::text, 'staff'::text]))) WITH CHECK ((get_auth_role() = ANY (ARRAY['admin'::text, 'staff'::text])));
CREATE POLICY "Users can see own data" ON "public"."socios" AS PERMISSIVE FOR SELECT TO "public" USING ((auth.uid() = user_id));
CREATE POLICY "staff_read_receipts" ON "public"."order_confirmation_receipts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text])));
CREATE POLICY "staff_insert_receipts" ON "public"."order_confirmation_receipts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text])) AND (actor_id = auth.uid())));
CREATE POLICY "Socios pueden ver sus propios pagos" ON "public"."pagos" AS PERMISSIVE FOR SELECT TO "public" USING ((auth.uid() IN ( SELECT socios.auth_user_id
   FROM socios
  WHERE (socios.id = pagos.socio_id))));
CREATE POLICY "Admin y Staff pueden gestionar todos los pagos" ON "public"."pagos" AS PERMISSIVE FOR ALL TO "public" USING ((( SELECT socios.rol
   FROM socios
  WHERE (socios.auth_user_id = auth.uid())) = ANY (ARRAY['admin'::text, 'staff'::text])));
CREATE POLICY "Socio can update own record" ON "public"."socios" AS PERMISSIVE FOR UPDATE TO "public" USING (((auth.uid() = auth_user_id) OR (auth.uid() = user_id)));
CREATE POLICY "invite_owner_read" ON "public"."socio_invites" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text])) OR (EXISTS ( SELECT 1
   FROM socios s
  WHERE ((s.id = socio_invites.socio_id) AND ((s.auth_user_id = auth.uid()) OR (s.user_id = auth.uid())))))));
CREATE POLICY "Admin/Staff Manage Socios" ON "public"."socios" AS PERMISSIVE FOR ALL TO "authenticated" USING ((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text])));
CREATE POLICY "Admin/Staff Manage Orders" ON "public"."pedidos" AS PERMISSIVE FOR ALL TO "authenticated" USING ((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text])));
CREATE POLICY "Socios can create their own orders" ON "public"."pedidos" AS PERMISSIVE FOR INSERT TO "public" WITH CHECK ((EXISTS ( SELECT 1
   FROM socios
  WHERE ((socios.id = pedidos.socio_id) AND ((socios.auth_user_id = auth.uid()) OR (socios.user_id = auth.uid()))))));
CREATE POLICY "Socios can view their own orders" ON "public"."pedidos" AS PERMISSIVE FOR SELECT TO "public" USING ((EXISTS ( SELECT 1
   FROM socios
  WHERE ((socios.id = pedidos.socio_id) AND ((socios.auth_user_id = auth.uid()) OR (socios.user_id = auth.uid()))))));
CREATE POLICY "Socio can read own record" ON "public"."socios" AS PERMISSIVE FOR SELECT TO "public" USING (((auth.uid() = auth_user_id) OR (auth.uid() = user_id)));
CREATE POLICY "Socios can update their own notification threads" ON "public"."notificaciones" AS PERMISSIVE FOR UPDATE TO "public" USING ((auth.uid() IN ( SELECT socios.auth_user_id
   FROM socios
  WHERE (socios.id = notificaciones.socio_id)))) WITH CHECK ((auth.uid() IN ( SELECT socios.auth_user_id
   FROM socios
  WHERE (socios.id = notificaciones.socio_id))));
CREATE POLICY "invite_owner_consume" ON "public"."socio_invites" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM socios s
  WHERE ((s.id = socio_invites.socio_id) AND ((s.auth_user_id = auth.uid()) OR (s.user_id = auth.uid())))))) WITH CHECK (((status = 'consumed'::text) AND (consumed_at IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM socios s
  WHERE ((s.id = socio_invites.socio_id) AND ((s.auth_user_id = auth.uid()) OR (s.user_id = auth.uid())))))));
CREATE POLICY "Permitir lectura global de configuraciones" ON "public"."global_configs" AS PERMISSIVE FOR SELECT TO "public" USING (true);
CREATE POLICY "Permitir edición a admin y staff" ON "public"."global_configs" AS PERMISSIVE FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM socios
  WHERE ((socios.id = auth.uid()) AND ((socios.rol = 'admin'::text) OR (socios.rol = 'staff'::text))))));
CREATE POLICY "document_owner_or_staff" ON "public"."documentos_socio" AS PERMISSIVE FOR ALL TO "authenticated" USING (((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text])) OR (EXISTS ( SELECT 1
   FROM socios s
  WHERE (((s.id)::text = documentos_socio.socio_id) AND ((s.auth_user_id = auth.uid()) OR (s.user_id = auth.uid()))))))) WITH CHECK (((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text])) OR (EXISTS ( SELECT 1
   FROM socios s
  WHERE (((s.id)::text = documentos_socio.socio_id) AND ((s.auth_user_id = auth.uid()) OR (s.user_id = auth.uid())))))));
CREATE POLICY "Socios can update own orders status" ON "public"."pedidos" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM socios
  WHERE ((socios.id = pedidos.socio_id) AND ((socios.auth_user_id = auth.uid()) OR (socios.user_id = auth.uid())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM socios
  WHERE ((socios.id = pedidos.socio_id) AND ((socios.auth_user_id = auth.uid()) OR (socios.user_id = auth.uid()))))));
CREATE POLICY "cierre_read" ON "public"."cierres_mensuales" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text])) OR (EXISTS ( SELECT 1
   FROM socios s
  WHERE ((s.id = cierres_mensuales.socio_id) AND ((s.auth_user_id = auth.uid()) OR (s.user_id = auth.uid())))))));
CREATE POLICY "cierre_create" ON "public"."cierres_mensuales" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text])));
CREATE POLICY "cierre_update" ON "public"."cierres_mensuales" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text]))) WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text])));
CREATE POLICY "document_history_read" ON "public"."documentos_socio_versiones" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((get_my_role() = ANY (ARRAY['admin'::text, 'staff'::text])) OR (EXISTS ( SELECT 1
   FROM socios s
  WHERE (((s.id)::text = documentos_socio_versiones.socio_id) AND ((s.auth_user_id = auth.uid()) OR (s.user_id = auth.uid())))))));
CREATE TRIGGER protect_socio_identity BEFORE UPDATE ON public.socios FOR EACH ROW EXECUTE FUNCTION app_private.protect_socio_identity();
CREATE TRIGGER validate_document_change BEFORE INSERT OR DELETE OR UPDATE ON public.documentos_socio FOR EACH ROW EXECUTE FUNCTION app_private.validate_document_change();
CREATE TRIGGER tr_check_resolution_800_limits BEFORE INSERT OR UPDATE ON public.pedidos FOR EACH ROW EXECUTE FUNCTION check_resolution_800_limits();
CREATE TRIGGER trg_socios_set_created_by BEFORE INSERT ON public.socios FOR EACH ROW EXECUTE FUNCTION set_created_by();
CREATE TRIGGER tr_check_pedidos_update_only_status BEFORE UPDATE ON public.pedidos FOR EACH ROW EXECUTE FUNCTION check_pedidos_update_only_status();
CREATE TRIGGER tr_audit_products_insert AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION log_product_changes();
CREATE TRIGGER tr_audit_products_update AFTER UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION log_product_changes();
CREATE TRIGGER tr_audit_products_delete AFTER DELETE ON public.products FOR EACH ROW EXECUTE FUNCTION log_product_changes();
CREATE TRIGGER tr_pedidos_insert_stock BEFORE INSERT ON public.pedidos FOR EACH ROW EXECUTE FUNCTION app_private.apply_order_stock();
CREATE TRIGGER tr_pedidos_update_stock BEFORE UPDATE ON public.pedidos FOR EACH ROW EXECUTE FUNCTION app_private.apply_order_stock();
CREATE TRIGGER prepare_monthly_close BEFORE INSERT OR DELETE OR UPDATE ON public.cierres_mensuales FOR EACH ROW EXECUTE FUNCTION app_private.prepare_monthly_close();
CREATE TRIGGER audit_monthly_close AFTER INSERT OR UPDATE ON public.cierres_mensuales FOR EACH ROW EXECUTE FUNCTION app_private.audit_monthly_close();
CREATE TRIGGER validate_reprocann_approval BEFORE INSERT OR UPDATE ON public.documentos_socio FOR EACH ROW EXECUTE FUNCTION app_private.validate_reprocann_approval();
CREATE TRIGGER archive_and_sync_document AFTER INSERT OR UPDATE ON public.documentos_socio FOR EACH ROW EXECUTE FUNCTION app_private.archive_and_sync_document();
CREATE TRIGGER trg_prevent_onboarding_materialization_mutation BEFORE UPDATE ON public.onboarding_application_materializations FOR EACH ROW EXECUTE FUNCTION app_private.prevent_onboarding_materialization_mutation();
CREATE TRIGGER trg_prevent_onboarding_proposal_payload_mutation BEFORE UPDATE ON public.onboarding_proposals FOR EACH ROW EXECUTE FUNCTION app_private.prevent_onboarding_proposal_payload_mutation();
CREATE TRIGGER trg_prevent_onboarding_review_events_mutation BEFORE DELETE OR UPDATE ON public.onboarding_review_events FOR EACH ROW EXECUTE FUNCTION app_private.prevent_onboarding_review_events_mutation();
CREATE TRIGGER trg_prevent_reprocann_renewal_proposal_payload_mutation BEFORE UPDATE ON public.reprocann_renewal_proposals FOR EACH ROW EXECUTE FUNCTION app_private.prevent_reprocann_renewal_proposal_payload_mutation();
CREATE TRIGGER trg_prevent_reprocann_renewal_review_events_mutation BEFORE DELETE OR UPDATE ON public.reprocann_renewal_review_events FOR EACH ROW EXECUTE FUNCTION app_private.prevent_reprocann_renewal_review_events_mutation();
CREATE TRIGGER trg_prevent_reprocann_renewal_apply_events_mutation BEFORE DELETE OR UPDATE ON public.reprocann_renewal_apply_events FOR EACH ROW EXECUTE FUNCTION app_private.prevent_reprocann_renewal_apply_events_mutation();
CREATE TRIGGER trg_prevent_historical_migration_apply_events_mutation BEFORE DELETE OR UPDATE ON public.historical_reprocann_migration_apply_events FOR EACH ROW EXECUTE FUNCTION app_private.prevent_historical_migration_apply_events_mutation();

