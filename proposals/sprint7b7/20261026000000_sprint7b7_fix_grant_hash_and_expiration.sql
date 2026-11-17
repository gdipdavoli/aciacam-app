-- ==============================================================================
-- ACIACAM — SPRINT 7B.7.1
-- Migración Correctiva: Integridad Criptográfica LPCP-v2 y Control de Vencimientos
--
-- Principios:
-- 1. order_proposals.proposal_payload_hash es ESTRICTAMENTE INMUTABLE desde su creación.
-- 2. action_grants.approved_payload_hash contiene la huella de autorización del operador.
-- 3. Inmutabilidad de propuesta blindada contra sobreescritura accidental.
-- 4. Las propuestas vencidas (24h) no pueden ser aprobadas y se marcan formalmente como 'expired'.
-- ==============================================================================

-- 1. FORTALECER BLINDAJE DE INMUTABILIDAD EN public.order_proposals
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

    -- 1.1 Inmutabilidad estricta e incondicional de todos los campos que componen el payload canónico LPCP-v2
    IF NEW.proposal_payload_hash IS DISTINCT FROM OLD.proposal_payload_hash
       OR NEW.items IS DISTINCT FROM OLD.items
       OR NEW.target_socio_id IS DISTINCT FROM OLD.target_socio_id
       OR NEW.tipo_pedido IS DISTINCT FROM OLD.tipo_pedido
       OR NEW.motivo IS DISTINCT FROM OLD.motivo
       OR NEW.details IS DISTINCT FROM OLD.details
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
        RAISE EXCEPTION 'PROPOSAL_SNAPSHOT_IMMUTABLE: El payload canónico LPCP-v2 (items, socio, tipo, motivo, details, hash) es estrictamente inmutable' USING ERRCODE = '22023';
    END IF;

    -- 1.2 Si la propuesta ya tenía una autorización emitida o fue ejecutada, el snapshot completo es 100% inmutable
    IF OLD.status IN ('grant_issued', 'executed') OR OLD.grant_id IS NOT NULL THEN
        IF NEW.approved_catalogue_hash IS DISTINCT FROM OLD.approved_catalogue_hash THEN
            RAISE EXCEPTION 'PROPOSAL_SNAPSHOT_IMMUTABLE: No se puede modificar una propuesta que ya posee un ticket de autorización emitido o ejecutado' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 1.4 Transiciones permitidas desde estados terminales:
    IF OLD.status = 'executed' AND NEW.status IS DISTINCT FROM 'executed' THEN
        RAISE EXCEPTION 'PROPOSAL_TERMINAL_STATE: Una propuesta ejecutada no puede cambiar de estado' USING ERRCODE = '22023';
    END IF;

    IF OLD.status = 'rejected' AND NEW.status IS DISTINCT FROM 'rejected' THEN
        RAISE EXCEPTION 'PROPOSAL_TERMINAL_STATE: Una propuesta rechazada no puede cambiar de estado' USING ERRCODE = '22023';
    END IF;

    IF OLD.status = 'expired' AND NEW.status IS DISTINCT FROM 'expired' THEN
        RAISE EXCEPTION 'PROPOSAL_TERMINAL_STATE: Una propuesta vencida no puede cambiar de estado' USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_order_proposal_snapshot() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_order_proposal_snapshot_guard ON public.order_proposals;
CREATE TRIGGER tr_order_proposal_snapshot_guard
BEFORE UPDATE OR DELETE ON public.order_proposals
FOR EACH ROW EXECUTE FUNCTION public.protect_order_proposal_snapshot();

-- 2. CORRECCIÓN EN RPC TRANSACCIONAL: public.aprobar_propuesta_pedido
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
    v_actor_role text;
    v_actor_socio_id uuid;
    v_proposal public.order_proposals;
    v_grant public.action_grants;
    v_grant_id uuid;
    v_grant_hash text;
    v_now timestamptz := clock_timestamp();
BEGIN
    -- 1. Validar parámetros obligatorios y contexto de autenticación
    IF p_proposal_id IS NULL OR p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'APPROVAL_INPUT_INVALID: proposal_id e idempotency_key son obligatorios' USING ERRCODE = '22023';
    END IF;

    IF v_actor_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Se requiere un usuario autenticado para emitir un ticket de autorización' USING ERRCODE = '42501';
    END IF;

    -- Validar rol de operador (admin o staff) activo
    SELECT lower(btrim(rol)), id INTO v_actor_role, v_actor_socio_id
    FROM public.socios
    WHERE auth_user_id = v_actor_user_id
      AND status = 'active'
      AND bloqueado IS NOT TRUE;

    IF v_actor_role NOT IN ('admin', 'staff') OR v_actor_role IS NULL THEN
        RAISE EXCEPTION 'ACTOR_FORBIDDEN: Solo administradores y operadores autorizados pueden emitir tickets de autorización' USING ERRCODE = '42501';
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

    -- 4. Control estricto de caducidad de la propuesta (24 horas)
    IF v_now >= v_proposal.expires_at THEN
        RAISE EXCEPTION 'PROPOSAL_EXPIRED: La propuesta ha superado su ventana de revisión de 24h y se encuentra vencida' USING ERRCODE = '42501';
    END IF;

    -- 5. Control de estados permitidos, deduplicación idempotente y renovación atómica
    IF v_proposal.status = 'grant_issued' THEN
        SELECT * INTO v_grant FROM public.action_grants WHERE grant_id = v_proposal.grant_id;
        IF FOUND AND v_grant.idempotency_key = p_idempotency_key THEN
            -- Si se reintenta con la misma clave de idempotencia:
            -- Si el grant sigue vigente, retornar deduplicado
            IF v_now < v_grant.expires_at THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'already_approved', true,
                    'grant_id', v_grant.grant_id,
                    'proposal_id', v_proposal.proposal_id,
                    'expires_at', v_grant.expires_at,
                    'proposal_payload_hash', v_proposal.proposal_payload_hash,
                    'approved_payload_hash', v_grant.approved_payload_hash
                );
            ELSE
                -- Si el grant previo ya venció, impedir reuso de la misma clave
                RAISE EXCEPTION 'GRANT_EXPIRED: El ticket previo expiró. Para renovar se requiere una nueva clave de idempotencia' USING ERRCODE = '42501';
            END IF;
        END IF;

        -- Si se presenta una NUEVA clave de idempotencia:
        -- Permitir renovación atómica si y solo si el grant previo ya expiró
        IF FOUND AND v_now >= v_grant.expires_at THEN
            NULL; -- Procede atómicamente a emitir el nuevo grant
        ELSE
            RAISE EXCEPTION 'PROPOSAL_ALREADY_APPROVED: La propuesta ya posee una autorización emitida y vigente' USING ERRCODE = '23505';
        END IF;
    ELSIF v_proposal.status <> 'pending_review' THEN
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

    -- 9. Actualizar estado de la propuesta PRESERVANDO su proposal_payload_hash original
    UPDATE public.order_proposals
    SET status = 'grant_issued',
        grant_id = v_grant_id,
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
        v_actor_socio_id,
        'ORDER_PROPOSAL_APPROVED',
        'order_proposals',
        p_proposal_id::text,
        jsonb_build_object(
            'grant_id', v_grant_id,
            'operator_auth_user_id', v_actor_user_id,
            'target_socio_id', v_proposal.target_socio_id,
            'approved_payload_hash', v_grant_hash,
            'proposal_payload_hash', v_proposal.proposal_payload_hash,
            'expires_at', v_grant.expires_at,
            'idempotency_key', p_idempotency_key
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'already_approved', false,
        'grant_id', v_grant_id,
        'proposal_id', p_proposal_id,
        'expires_at', v_grant.expires_at,
        'proposal_payload_hash', v_proposal.proposal_payload_hash,
        'approved_payload_hash', v_grant_hash
    );
END;
$$;

REVOKE ALL ON FUNCTION public.aprobar_propuesta_pedido(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprobar_propuesta_pedido(uuid, uuid) TO authenticated, service_role;

-- 3. RPC PARA MARCAR MASIVAMENTE PROPUESTAS VENCIDAS DE FORMA SEGURA
CREATE OR REPLACE FUNCTION public.marcar_propuestas_vencidas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count integer := 0;
    v_role text;
BEGIN
    -- 1. Control estricto de identidad y permisos: rechazar anónimos y socios comunes
    IF auth.role() = 'authenticated' THEN
        SELECT lower(btrim(rol)) INTO v_role
        FROM public.socios
        WHERE auth_user_id = auth.uid()
          AND status = 'active'
          AND bloqueado IS NOT TRUE;

        IF v_role NOT IN ('admin', 'staff') OR v_role IS NULL THEN
            RAISE EXCEPTION 'ACTOR_FORBIDDEN: Se requiere rol administrativo para ejecutar mantenimiento de propuestas' USING ERRCODE = '42501';
        END IF;
    ELSIF auth.role() IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Acceso no autenticado o no autorizado para mantenimiento de propuestas' USING ERRCODE = '42501';
    END IF;

    -- 2. Marcar como vencidas propuestas pendientes o con grant expirado que superaron las 24 horas
    UPDATE public.order_proposals
    SET status = 'expired',
        updated_at = clock_timestamp()
    WHERE status IN ('pending_review', 'grant_issued')
      AND pedido_id IS NULL
      AND expires_at <= clock_timestamp()
      AND (
          grant_id IS NULL 
          OR EXISTS (
              SELECT 1 FROM public.action_grants g 
              WHERE g.grant_id = order_proposals.grant_id 
                AND g.expires_at <= clock_timestamp()
          )
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.marcar_propuestas_vencidas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_propuestas_vencidas() TO authenticated, service_role;
