-- ==============================================================================
-- ACIACAM APP — SPRINT 7B.5 (ETAPA 2)
-- Migración Candidata: Persistencia Duradera de Propuestas (order_proposals)
-- y Operación Transaccional Única de Cancelación Administrativa
--
-- ADVERTENCIA OBLIGATORIA:
-- Este script es exclusivamente para revisión técnica y pruebas locales controladas.
-- NO APLICAR EN SUPABASE INTEGRATION NI EN PRODUCCIÓN SIN PREVIA AUTORIZACIÓN.
-- Compatible con migraciones de Sprint 5, Sprint 7B.3 y Sprint 7B.4.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- PREFLIGHT FAIL-FAST: Verificación de dependencias de Sprint 7B.4 y Sprint 5
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.action_grants') IS NULL THEN
        RAISE EXCEPTION 'PREFLIGHT_FAIL: La tabla public.action_grants (Sprint 7B.4) no está instalada.';
    END IF;

    IF to_regprocedure('public.assert_order_actor(uuid,boolean)') IS NULL
       OR to_regprocedure('public.assert_order_business(uuid,jsonb,text,text,text)') IS NULL
       OR to_regprocedure('public.order_grant_hash(uuid,uuid,jsonb,text,text,jsonb)') IS NULL
       OR to_regprocedure('public.order_catalogue_hash(jsonb)') IS NULL
       OR to_regprocedure('public.revoke_order_grant(uuid,text)') IS NULL THEN
        RAISE EXCEPTION 'PREFLIGHT_FAIL: Dependencias funcionales de Sprint 7B.4 faltantes en la base de datos.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pedidos' AND column_name = 'idempotency_key'
    ) THEN
        RAISE EXCEPTION 'PREFLIGHT_FAIL: La columna public.pedidos.idempotency_key no existe.';
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 1. TABLA DDL: public.order_proposals
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_proposals (
    proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_socio_id uuid NOT NULL REFERENCES public.socios(id),
    actor_auth_user_id uuid REFERENCES auth.users(id),
    solicitante_tipo text NOT NULL CHECK (solicitante_tipo IN ('agente', 'operador', 'socio')),
    solicitante_nombre text NOT NULL,
    tipo_pedido text NOT NULL CHECK (tipo_pedido IN ('retiro_sede', 'delivery')),
    items jsonb NOT NULL,
    motivo text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    validation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    proposal_payload_hash text NOT NULL CHECK (proposal_payload_hash ~ '^[0-9a-f]{64}$'),
    approved_catalogue_hash text NOT NULL CHECK (approved_catalogue_hash ~ '^[0-9a-f]{64}$'),
    idempotency_key uuid NOT NULL UNIQUE,
    status text NOT NULL CHECK (status IN ('pending_review', 'grant_issued', 'executed', 'rejected', 'expired')) DEFAULT 'pending_review',
    grant_id uuid REFERENCES public.action_grants(grant_id),
    pedido_id uuid REFERENCES public.pedidos(id),
    rejection_reason text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '24 hours'),
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_order_proposals_status_created
ON public.order_proposals (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_proposals_hash
ON public.order_proposals (proposal_payload_hash);

CREATE INDEX IF NOT EXISTS idx_order_proposals_socio
ON public.order_proposals (target_socio_id);

CREATE INDEX IF NOT EXISTS idx_order_proposals_grant
ON public.order_proposals (grant_id)
WHERE grant_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. BLINDAJE DE INMUTABILIDAD Y TRANSICIONES DE ESTADO DE PROPUESTAS
-- Invariante: Una propuesta modificada NO puede conservar una aprobación anterior.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_order_proposal_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'PROPOSAL_HISTORY_IMMUTABLE: Las propuestas no pueden ser eliminadas' USING ERRCODE = '22023';
    END IF;

    -- Si la propuesta ya tenía una autorización emitida o fue ejecutada, el snapshot es 100% inmutable
    IF OLD.status IN ('grant_issued', 'executed') OR OLD.grant_id IS NOT NULL THEN
        IF ROW(NEW.proposal_id, NEW.target_socio_id, NEW.tipo_pedido, NEW.items, NEW.details, NEW.proposal_payload_hash, NEW.approved_catalogue_hash, NEW.idempotency_key, NEW.created_at)
           IS DISTINCT FROM ROW(OLD.proposal_id, OLD.target_socio_id, OLD.tipo_pedido, OLD.items, OLD.details, OLD.proposal_payload_hash, OLD.approved_catalogue_hash, OLD.idempotency_key, OLD.created_at) THEN
            RAISE EXCEPTION 'PROPOSAL_SNAPSHOT_IMMUTABLE: No se puede modificar una propuesta que ya posee un ticket de autorización emitido o ejecutado' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Si se modifican los ítems o parámetros sustanciales mientras está en pending_review,
    -- es estrictamente ilegal conservar o asignar un grant_id previo (debe re-aprobarse desde cero)
    IF OLD.status = 'pending_review' AND (NEW.proposal_payload_hash IS DISTINCT FROM OLD.proposal_payload_hash OR NEW.items IS DISTINCT FROM OLD.items) THEN
        IF NEW.grant_id IS NOT NULL AND NEW.grant_id IS NOT DISTINCT FROM OLD.grant_id THEN
            RAISE EXCEPTION 'PROPOSAL_TAMPERED_GRANT_FORBIDDEN: Una propuesta modificada no puede conservar un grant previo' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Transiciones permitidas desde estados terminales:
    IF OLD.status = 'executed' AND NEW.status IS DISTINCT FROM 'executed' THEN
        RAISE EXCEPTION 'PROPOSAL_TERMINAL_STATE: Una propuesta ejecutada no puede cambiar de estado' USING ERRCODE = '22023';
    END IF;

    IF OLD.status = 'rejected' AND NEW.status IS DISTINCT FROM 'rejected' THEN
        RAISE EXCEPTION 'PROPOSAL_TERMINAL_STATE: Una propuesta rechazada no puede cambiar de estado' USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_order_proposal_snapshot() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_order_proposal_snapshot_guard ON public.order_proposals;
CREATE TRIGGER tr_order_proposal_snapshot_guard
BEFORE UPDATE OR DELETE ON public.order_proposals
FOR EACH ROW EXECUTE FUNCTION public.protect_order_proposal_snapshot();

-- ------------------------------------------------------------------------------
-- 3. RLS Y PERMISOS MÍNIMOS EN public.order_proposals
-- ------------------------------------------------------------------------------
ALTER TABLE public.order_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_proposals FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_read_order_proposal(p_target_socio_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_role text;
    v_socio_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN false;
    END IF;

    SELECT lower(btrim(s.rol)), s.id INTO v_role, v_socio_id
    FROM public.socios s
    WHERE s.auth_user_id = v_uid
      AND s.status = 'active'
      AND s.bloqueado IS NOT TRUE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    IF v_role IN ('admin', 'staff') THEN
        RETURN true;
    END IF;

    IF v_socio_id = p_target_socio_id THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_read_order_proposal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_order_proposal(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS rls_order_proposals_select ON public.order_proposals;
CREATE POLICY rls_order_proposals_select ON public.order_proposals
FOR SELECT TO authenticated
USING (
    public.can_read_order_proposal(target_socio_id)
);

GRANT SELECT ON public.order_proposals TO authenticated;
GRANT ALL ON public.order_proposals TO service_role;

-- ------------------------------------------------------------------------------
-- 4. RPC TRANSACCIONAL: public.crear_propuesta_pedido
-- Registra una propuesta en estado pending_review de forma idempotente y segura
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_propuesta_pedido(
    p_socio_id uuid,
    p_items jsonb,
    p_tipo_pedido text,
    p_motivo text,
    p_idempotency_key uuid,
    p_solicitante_tipo text DEFAULT 'agente',
    p_solicitante_nombre text DEFAULT 'Agent Core',
    p_details jsonb DEFAULT '{}'::jsonb,
    p_validation jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_user_id uuid := auth.uid();
    v_target_socio public.socios;
    v_existing public.order_proposals;
    v_proposal public.order_proposals;
    v_payload_hash text;
    v_cat_hash text;
    v_actor_socio uuid;
BEGIN
    -- 1. Validar parámetros obligatorios
    IF p_socio_id IS NULL OR p_idempotency_key IS NULL OR coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'PROPOSAL_INPUT_INVALID: socio_id, idempotency_key y motivo son obligatorios' USING ERRCODE = '22023';
    END IF;

    IF p_tipo_pedido NOT IN ('retiro_sede', 'delivery') THEN
        RAISE EXCEPTION 'INVALID_ORDER_TYPE: El tipo de pedido debe ser retiro_sede o delivery' USING ERRCODE = '22023';
    END IF;

    IF p_solicitante_tipo NOT IN ('agente', 'operador', 'socio') THEN
        RAISE EXCEPTION 'INVALID_PROPOSER_TYPE: solicitante_tipo inválido' USING ERRCODE = '22023';
    END IF;

    -- 2. Validar reglas de negocio del pedido mediante assert_order_business
    PERFORM public.assert_order_business(
        p_socio_id,
        p_items,
        p_tipo_pedido,
        p_details->>'direccion_entrega',
        p_details->>'localidad'
    );

    -- 3. Serialización de concurrencia mediante advisory lock de idempotencia
    PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

    -- 4. Calcular huella canónica LPCP-v2 y huella de catálogo
    v_payload_hash := public.order_grant_hash(
        coalesce(v_actor_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
        p_socio_id,
        p_items,
        p_tipo_pedido,
        p_motivo,
        p_details
    );
    v_cat_hash := public.order_catalogue_hash(p_items);

    -- 5. Deduplicación determinista por clave de idempotencia
    SELECT * INTO v_existing
    FROM public.order_proposals
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.proposal_payload_hash IS DISTINCT FROM v_payload_hash
           OR v_existing.target_socio_id IS DISTINCT FROM p_socio_id THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Clave de idempotencia ya utilizada con diferentes parámetros' USING ERRCODE = '23505';
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'deduplicated', true,
            'proposal', row_to_json(v_existing)
        );
    END IF;

    -- 6. Insertar la nueva propuesta persistida
    INSERT INTO public.order_proposals (
        proposal_id,
        target_socio_id,
        actor_auth_user_id,
        solicitante_tipo,
        solicitante_nombre,
        tipo_pedido,
        items,
        motivo,
        details,
        validation_snapshot,
        proposal_payload_hash,
        approved_catalogue_hash,
        idempotency_key,
        status,
        created_at,
        updated_at,
        expires_at
    ) VALUES (
        gen_random_uuid(),
        p_socio_id,
        v_actor_user_id,
        p_solicitante_tipo,
        p_solicitante_nombre,
        p_tipo_pedido,
        p_items,
        p_motivo,
        p_details,
        p_validation,
        v_payload_hash,
        v_cat_hash,
        p_idempotency_key,
        'pending_review',
        clock_timestamp(),
        clock_timestamp(),
        clock_timestamp() + interval '24 hours'
    )
    RETURNING * INTO v_proposal;

    -- 7. Registrar en auditoría
    IF v_actor_user_id IS NOT NULL THEN
        SELECT id INTO v_actor_socio FROM public.socios WHERE auth_user_id = v_actor_user_id LIMIT 1;
    END IF;

    INSERT INTO public.audit_logs (
        user_id,
        actor_socio_id,
        action,
        entity_type,
        entity_id,
        details,
        created_at
    ) VALUES (
        v_actor_user_id,
        v_actor_socio,
        'ORDER_PROPOSAL_CREATED',
        'order_proposals',
        v_proposal.proposal_id::text,
        jsonb_build_object(
            'proposal_id', v_proposal.proposal_id,
            'target_socio_id', p_socio_id,
            'idempotency_key', p_idempotency_key,
            'payload_hash', v_payload_hash,
            'solicitante_tipo', p_solicitante_tipo
        ),
        clock_timestamp()
    );

    RETURN jsonb_build_object(
        'success', true,
        'deduplicated', false,
        'proposal', row_to_json(v_proposal)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.crear_propuesta_pedido(uuid, jsonb, text, text, uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_propuesta_pedido(uuid, jsonb, text, text, uuid, text, text, jsonb, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. RPC TRANSACCIONAL: public.aprobar_propuesta_pedido
-- Un operador humano (staff/admin) autoriza explícitamente una propuesta,
-- emitiendo el ticket de autorización action_grants con TTL de 120 segundos.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aprobar_propuesta_pedido(
    p_proposal_id uuid,
    p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_user_id uuid := auth.uid();
    v_actor_socio uuid;
    v_proposal public.order_proposals;
    v_grant public.action_grants;
    v_grant_id uuid;
    v_grant_hash text;
    v_now timestamptz := clock_timestamp();
BEGIN
    -- 1. Autorización estricta del operador humano (requiere rol admin o staff activo)
    v_actor_socio := public.assert_order_actor(v_actor_user_id, true);

    IF p_proposal_id IS NULL OR p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'GRANT_INPUT_INVALID: Identificador de propuesta y clave de idempotencia obligatorios' USING ERRCODE = '22023';
    END IF;

    -- 2. Adquirir advisory lock para serializar aprobaciones concurrentes
    PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

    -- 3. Bloqueo pesimista de la propuesta
    SELECT * INTO v_proposal
    FROM public.order_proposals
    WHERE proposal_id = p_proposal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROPOSAL_NOT_FOUND: Propuesta de pedido no encontrada' USING ERRCODE = '22023';
    END IF;

    -- 4. Control estricto de caducidad de la propuesta
    IF v_now >= v_proposal.expires_at THEN
        UPDATE public.order_proposals
        SET status = 'expired', updated_at = v_now
        WHERE proposal_id = p_proposal_id;

        RAISE EXCEPTION 'PROPOSAL_EXPIRED: La propuesta ha superado su ventana de revisión de 24h y se encuentra vencida' USING ERRCODE = '42501';
    END IF;

    -- 5. Control de estados permitidos y deduplicación idempotente
    IF v_proposal.status = 'grant_issued' THEN
        SELECT * INTO v_grant FROM public.action_grants WHERE grant_id = v_proposal.grant_id;
        IF FOUND AND v_grant.idempotency_key = p_idempotency_key THEN
            RETURN jsonb_build_object(
                'success', true,
                'already_approved', true,
                'grant_id', v_grant.grant_id,
                'proposal_id', v_proposal.proposal_id,
                'expires_at', v_grant.expires_at
            );
        END IF;

        RAISE EXCEPTION 'PROPOSAL_ALREADY_APPROVED: La propuesta ya posee una autorización emitida' USING ERRCODE = '23505';
    END IF;

    IF v_proposal.status <> 'pending_review' THEN
        RAISE EXCEPTION 'PROPOSAL_INVALID_STATE: No se puede aprobar una propuesta en estado ''%''', v_proposal.status USING ERRCODE = '22023';
    END IF;

    -- 6. Verificación de catálogo inmutable: el catálogo no debe haber cambiado desde que la propuesta fue creada
    IF public.order_catalogue_hash(v_proposal.items) IS DISTINCT FROM v_proposal.approved_catalogue_hash THEN
        RAISE EXCEPTION 'APPROVED_CATALOGUE_CHANGED: El catálogo de productos cambió desde la creación de la propuesta' USING ERRCODE = '22023';
    END IF;

    -- 7. Calcular huella canónica del grant con el operador humano real
    v_grant_hash := public.order_grant_hash(
        v_actor_user_id,
        v_proposal.target_socio_id,
        v_proposal.items,
        v_proposal.tipo_pedido,
        v_proposal.motivo,
        v_proposal.details
    );

    v_grant_id := gen_random_uuid();

    -- 8. Emisión del ticket de autorización delegada en action_grants (TTL estricto de 120s)
    INSERT INTO public.action_grants (
        grant_id,
        operator_auth_user_id,
        target_socio_id,
        action,
        approved_payload_hash,
        idempotency_key,
        status,
        issued_at,
        expires_at,
        approved_catalogue_hash
    ) VALUES (
        v_grant_id,
        v_actor_user_id,
        v_proposal.target_socio_id,
        'execute_order',
        v_grant_hash,
        p_idempotency_key,
        'issued',
        v_now,
        v_now + interval '120 seconds',
        v_proposal.approved_catalogue_hash
    )
    RETURNING * INTO v_grant;

    -- 9. Actualizar estado de la propuesta
    UPDATE public.order_proposals
    SET status = 'grant_issued',
        grant_id = v_grant_id,
        proposal_payload_hash = v_grant_hash,
        updated_at = v_now
    WHERE proposal_id = p_proposal_id;

    -- 10. Auditoría de aprobación humana
    INSERT INTO public.audit_logs (
        user_id,
        actor_socio_id,
        action,
        entity_type,
        entity_id,
        details,
        created_at
    ) VALUES (
        v_actor_user_id,
        v_actor_socio,
        'ORDER_PROPOSAL_APPROVED',
        'order_proposals',
        p_proposal_id::text,
        jsonb_build_object(
            'proposal_id', p_proposal_id,
            'grant_id', v_grant_id,
            'idempotency_key', p_idempotency_key,
            'expires_at', v_grant.expires_at,
            'target_socio_id', v_proposal.target_socio_id
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'already_approved', false,
        'proposal_id', p_proposal_id,
        'grant_id', v_grant_id,
        'expires_at', v_grant.expires_at,
        'correlation_id', v_grant.correlation_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.aprobar_propuesta_pedido(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprobar_propuesta_pedido(uuid, uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. RPC TRANSACCIONAL: public.rechazar_propuesta_pedido
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rechazar_propuesta_pedido(
    p_proposal_id uuid,
    p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_user_id uuid := auth.uid();
    v_actor_socio uuid;
    v_proposal public.order_proposals;
    v_now timestamptz := clock_timestamp();
BEGIN
    v_actor_socio := public.assert_order_actor(v_actor_user_id, true);

    IF p_proposal_id IS NULL OR coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'REJECT_INPUT_INVALID: Identificador de propuesta y motivo de rechazo son obligatorios' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_proposal
    FROM public.order_proposals
    WHERE proposal_id = p_proposal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROPOSAL_NOT_FOUND: Propuesta de pedido no encontrada' USING ERRCODE = '22023';
    END IF;

    IF v_proposal.status = 'rejected' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_rejected', true,
            'proposal_id', p_proposal_id,
            'rejection_reason', v_proposal.rejection_reason
        );
    END IF;

    IF v_proposal.status = 'executed' THEN
        RAISE EXCEPTION 'PROPOSAL_ALREADY_EXECUTED: No se puede rechazar una propuesta que ya fue ejecutada' USING ERRCODE = '22023';
    END IF;

    -- Si la propuesta tenía un grant emitido, revocarlo en action_grants
    IF v_proposal.grant_id IS NOT NULL THEN
        PERFORM public.revoke_order_grant(v_proposal.grant_id, p_motivo);
    END IF;

    UPDATE public.order_proposals
    SET status = 'rejected',
        rejection_reason = p_motivo,
        updated_at = v_now
    WHERE proposal_id = p_proposal_id;

    INSERT INTO public.audit_logs (
        user_id,
        actor_socio_id,
        action,
        entity_type,
        entity_id,
        details,
        created_at
    ) VALUES (
        v_actor_user_id,
        v_actor_socio,
        'ORDER_PROPOSAL_REJECTED',
        'order_proposals',
        p_proposal_id::text,
        jsonb_build_object(
            'proposal_id', p_proposal_id,
            'motivo', p_motivo,
            'grant_id', v_proposal.grant_id
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'already_rejected', false,
        'proposal_id', p_proposal_id,
        'status', 'rejected',
        'rejection_reason', p_motivo
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rechazar_propuesta_pedido(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rechazar_propuesta_pedido(uuid, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 7. SINCRONIZACIÓN AUTOMÁTICA DE EJECUCIÓN (action_grants -> order_proposals)
-- Cuando action_grants pasa a 'executed', la propuesta vinculada transiciona a 'executed'
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sync_proposal_on_grant_executed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'executed' AND (OLD.status IS DISTINCT FROM 'executed' OR OLD.pedido_id IS DISTINCT FROM NEW.pedido_id) THEN
        UPDATE public.order_proposals
        SET status = 'executed',
            pedido_id = NEW.pedido_id,
            updated_at = clock_timestamp()
        WHERE grant_id = NEW.grant_id;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sync_proposal_on_grant_executed() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_sync_proposal_on_grant_executed ON public.action_grants;
CREATE TRIGGER tr_sync_proposal_on_grant_executed
AFTER UPDATE OF status, pedido_id ON public.action_grants
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_proposal_on_grant_executed();

-- ------------------------------------------------------------------------------
-- 8. OPERACIÓN TRANSACCIONAL ÚNICA DE CANCELACIÓN ADMINISTRATIVA
-- Elimina toda necesidad de fallback en código cliente.
-- Garantiza bloqueo pesimista (FOR UPDATE), idempotencia estricta,
-- restitución atómica de stock y registro en audit_logs.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_pedido_administrativo_transaccional(
    p_pedido_id uuid,
    p_motivo text DEFAULT 'Cancelación institucional de pedido'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_user_id uuid := auth.uid();
    v_actor_role text := NULL;
    v_actor_socio_id uuid := NULL;
    v_order record;
    v_updated_order record;
BEGIN
    -- 1. Validar autenticación de sesión del staff/admin (JWT real obligatorio)
    v_actor_socio_id := public.assert_order_actor(v_actor_user_id, true);

    SELECT lower(btrim(s.rol)) INTO v_actor_role
    FROM public.socios AS s
    WHERE s.id = v_actor_socio_id;

    IF coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'CANCEL_MOTIVE_REQUIRED: El motivo de cancelación administrativa es obligatorio' USING ERRCODE = '22023';
    END IF;

    -- 2. Bloqueo pesimista de fila (FOR UPDATE) para prevenir carreras concurrentes
    SELECT * INTO v_order 
    FROM public.pedidos 
    WHERE id = p_pedido_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: Pedido no encontrado' USING ERRCODE = '22023';
    END IF;

    -- 3. Aislamiento de operadores: Un operador staff no puede cancelar pedidos de otro staff,
    -- salvo que posea rol 'admin'.
    IF v_order.created_by_user_id IS NOT NULL 
       AND v_order.created_by_user_id <> v_actor_user_id 
       AND v_actor_role <> 'admin' THEN
        RAISE EXCEPTION 'CANCEL_FORBIDDEN_FOREIGN_OPERATOR: La cancelación de este pedido está reservada a su creador o a un administrador' USING ERRCODE = '42501';
    END IF;

    -- 4. Idempotencia: Si ya está cancelado, retornar confirmación sin reajustar stock
    IF v_order.estado = 'cancelado' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_cancelled', true,
            'pedido', row_to_json(v_order)
        );
    END IF;

    -- 5. Control de estados terminales o en tránsito no cancelables
    IF v_order.estado IN ('retirado', 'entregado', 'en_camino') THEN
        RAISE EXCEPTION 'INVALID_STATE_TRANSITION: No se puede cancelar un pedido en estado ''%''. Los pedidos despachados en camino, retirados o entregados requieren protocolo de devolución física antes de anularse.', v_order.estado USING ERRCODE = '22023';
    END IF;

    -- 6. Transición canónica a 'cancelado'.
    -- Triggers vinculados que actúan de forma atómica:
    -- - tr_pedidos_update_stock (app_private.tr_check_and_adjust_stock_on_update) restituye existencias.
    -- - tr_pedidos_audit_estado (public.fn_audit_pedido_estado_transition) registra ORDER_CANCEL.
    UPDATE public.pedidos
    SET estado = 'cancelado',
        motivo_admin = p_motivo,
        updated_at = clock_timestamp()
    WHERE id = p_pedido_id
    RETURNING * INTO v_updated_order;

    RETURN jsonb_build_object(
        'success', true,
        'already_cancelled', false,
        'pedido', row_to_json(v_updated_order)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_pedido_administrativo_transaccional(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido_administrativo_transaccional(uuid, text) TO authenticated;

COMMIT;
