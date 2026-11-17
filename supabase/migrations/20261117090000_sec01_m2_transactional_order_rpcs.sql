-- ============================================================================
-- SEC-01 FASE B.1 — PROPUESTA DE MIGRACIÓN M2 (LOCAL / NO EJECUTADA EN INTEGRATION)
-- Objetivo: RPCs transaccionales seguros, idempotencia de transiciones,
--           colaboración controlada de staff, cancelación de socio y cierre
--           de entrega con o sin pago inicial.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Tabla de idempotencia para transiciones administrativas de estado
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_transition_commands (
    command_id uuid PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL,
    target_status text NOT NULL,
    payload_hash text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_transition_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_transition_commands_service_only" ON public.order_transition_commands;
CREATE POLICY "order_transition_commands_service_only"
    ON public.order_transition_commands
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

REVOKE ALL ON TABLE public.order_transition_commands FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.order_transition_commands TO service_role;

CREATE OR REPLACE FUNCTION app_private.prevent_order_transition_command_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'ORDER_TRANSITION_COMMAND_IMMUTABLE' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS tr_order_transition_commands_immutable ON public.order_transition_commands;
CREATE TRIGGER tr_order_transition_commands_immutable
    BEFORE UPDATE OR DELETE ON public.order_transition_commands
    FOR EACH ROW
    EXECUTE FUNCTION app_private.prevent_order_transition_command_mutation();

-- ----------------------------------------------------------------------------
-- 2. RPC: transition_order_status_transaccional
--    Reemplaza los .update({ estado }) directos y la RPC inexistente confirm_order_delivery.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_order_status_transaccional(
    p_pedido_id uuid,
    p_target_status text,
    p_motivo text DEFAULT NULL,
    p_command_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_actor_socio_id uuid;
    v_actor_role text;
    v_order public.pedidos%ROWTYPE;
    v_updated public.pedidos%ROWTYPE;
    v_hash text;
    v_existing public.order_transition_commands%ROWTYPE;
    v_result jsonb;
    v_clean_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
    v_actor_socio_id := public.assert_order_actor(v_actor, true);

    SELECT lower(btrim(s.rol)) INTO v_actor_role
    FROM public.socios AS s
    WHERE s.id = v_actor_socio_id;

    IF p_pedido_id IS NULL OR p_target_status IS NULL OR p_target_status NOT IN (
        'pendiente', 'confirmado', 'en_preparacion', 'listo_para_retiro',
        'en_camino', 'retirado', 'entregado', 'cancelado'
    ) THEN
        RAISE EXCEPTION 'TRANSITION_PAYLOAD_INVALID: Parámetros de transición inválidos.' USING ERRCODE = '22023';
    END IF;

    IF p_command_id IS NOT NULL THEN
        v_hash := encode(sha256(convert_to(jsonb_build_object(
            'order_id', p_pedido_id,
            'actor_id', v_actor,
            'target_status', p_target_status,
            'motivo', v_clean_motivo
        )::text, 'UTF8')), 'hex');

        PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 0));

        SELECT * INTO v_existing
        FROM public.order_transition_commands AS c
        WHERE c.command_id = p_command_id;

        IF FOUND THEN
            IF v_existing.actor_id <> v_actor
               OR v_existing.order_id <> p_pedido_id
               OR v_existing.payload_hash <> v_hash THEN
                RAISE EXCEPTION 'TRANSITION_COMMAND_CONFLICT' USING ERRCODE = '22023';
            END IF;
            RETURN v_existing.result || jsonb_build_object('command_id', p_command_id, 'reused', true);
        END IF;
    END IF;

    SELECT * INTO v_order
    FROM public.pedidos
    WHERE id = p_pedido_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: Pedido no encontrado.' USING ERRCODE = '22023';
    END IF;

    IF v_order.estado = p_target_status THEN
        v_result := jsonb_build_object(
            'success', true,
            'already_in_status', true,
            'pedido', row_to_json(v_order)
        );
        IF p_command_id IS NOT NULL THEN
            INSERT INTO public.order_transition_commands(command_id, order_id, actor_id, target_status, payload_hash, result)
            VALUES (p_command_id, p_pedido_id, v_actor, p_target_status, v_hash, v_result);
            RETURN v_result || jsonb_build_object('command_id', p_command_id, 'reused', false);
        END IF;
        RETURN v_result;
    END IF;

    IF v_order.estado = 'en_camino' AND p_target_status = 'cancelado' THEN
        IF v_actor_role <> 'admin' THEN
            RAISE EXCEPTION 'CANCEL_EN_CAMINO_ADMIN_ONLY: Cancelar un pedido en camino requiere rol admin.' USING ERRCODE = '42501';
        END IF;
        IF v_clean_motivo IS NULL THEN
            RAISE EXCEPTION 'CANCEL_MOTIVE_REQUIRED: El motivo es obligatorio para cancelar un pedido en camino.' USING ERRCODE = '22023';
        END IF;
    END IF;

    UPDATE public.pedidos
    SET estado = p_target_status,
        motivo_admin = coalesce(v_clean_motivo, motivo_admin),
        updated_at = clock_timestamp()
    WHERE id = p_pedido_id
    RETURNING * INTO v_updated;

    IF v_order.created_by_user_id IS NOT NULL AND v_order.created_by_user_id <> v_actor THEN
        INSERT INTO public.audit_logs (
            user_id, actor_socio_id, action, entity_type, entity_id, details, created_at
        ) VALUES (
            v_actor,
            v_actor_socio_id,
            'COLLABORATIVE_ORDER_TRANSITION',
            'pedidos',
            p_pedido_id::text,
            jsonb_build_object(
                'previous_state', v_order.estado,
                'new_state', p_target_status,
                'created_by_user_id', v_order.created_by_user_id,
                'actor_user_id', v_actor,
                'actor_role', v_actor_role,
                'motivo', v_clean_motivo
            ),
            now()
        );
    END IF;

    v_result := jsonb_build_object(
        'success', true,
        'already_in_status', false,
        'pedido', row_to_json(v_updated)
    );

    IF p_command_id IS NOT NULL THEN
        INSERT INTO public.order_transition_commands(command_id, order_id, actor_id, target_status, payload_hash, result)
        VALUES (p_command_id, p_pedido_id, v_actor, p_target_status, v_hash, v_result);
        RETURN v_result || jsonb_build_object('command_id', p_command_id, 'reused', false);
    END IF;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_order_status_transaccional(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_order_status_transaccional(uuid, text, text, uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. RPC: cancelar_pedido_socio_transaccional
--    Permite al socio dueño cancelar su propio pedido en estados iniciales.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_pedido_socio_transaccional(
    p_pedido_id uuid,
    p_motivo text DEFAULT 'Cancelado por el socio'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_actor_socio_id uuid;
    v_order public.pedidos%ROWTYPE;
    v_updated public.pedidos%ROWTYPE;
    v_clean_motivo text := coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'Cancelado por el socio');
BEGIN
    v_actor_socio_id := public.assert_order_actor(v_actor, false);

    SELECT * INTO v_order
    FROM public.pedidos
    WHERE id = p_pedido_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: Pedido no encontrado.' USING ERRCODE = '22023';
    END IF;

    IF v_order.socio_id <> v_actor_socio_id THEN
        RAISE EXCEPTION 'SOCIO_ORDER_FORBIDDEN: No podés cancelar un pedido de otro socio.' USING ERRCODE = '42501';
    END IF;

    IF v_order.estado = 'cancelado' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_cancelled', true,
            'pedido', row_to_json(v_order)
        );
    END IF;

    IF v_order.estado NOT IN ('pendiente', 'confirmado') THEN
        RAISE EXCEPTION 'SOCIO_CANCEL_STATE_FORBIDDEN: Solo podés cancelar pedidos en estado pendiente o confirmado (actual: %).', v_order.estado
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.pedidos
    SET estado = 'cancelado',
        observaciones = CASE
            WHEN coalesce(btrim(observaciones), '') = '' THEN '[Cancelación socio] ' || v_clean_motivo
            ELSE observaciones || E'\n[Cancelación socio] ' || v_clean_motivo
        END,
        updated_at = clock_timestamp()
    WHERE id = p_pedido_id
    RETURNING * INTO v_updated;

    RETURN jsonb_build_object(
        'success', true,
        'already_cancelled', false,
        'pedido', row_to_json(v_updated)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_pedido_socio_transaccional(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido_socio_transaccional(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. RPC actualizada: confirm_order_payment_command
--    Permite p_payments = '[]'::jsonb (entrega/retiro sin pago inicial) y
--    valida coherencia retiro_sede->retirado / delivery->entregado.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_order_payment_command(
    p_command_id uuid,
    p_order_id uuid,
    p_target_status text,
    p_payments jsonb,
    p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_count bigint;
    v_role text;
    v_hash text;
    v_existing public.order_payment_commands%ROWTYPE;
    v_order public.pedidos%ROWTYPE;
    v_payments jsonb := coalesce(p_payments, '[]'::jsonb);
    v_result jsonb;
BEGIN
    IF v_actor IS NULL OR (p_actor_id IS NOT NULL AND p_actor_id <> v_actor) THEN
        RAISE EXCEPTION 'PAYMENT_ACTOR_UNAUTHORIZED' USING ERRCODE = '42501';
    END IF;

    SELECT count(*), max(lower(btrim(s.rol))) INTO v_count, v_role
    FROM public.socios AS s
    WHERE s.auth_user_id = v_actor
      AND s.status = 'active'
      AND s.bloqueado IS NOT TRUE;

    IF v_count <> 1 OR v_role IS NULL OR v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'PAYMENT_ROLE_UNAUTHORIZED' USING ERRCODE = '42501';
    END IF;

    IF p_command_id IS NULL OR p_order_id IS NULL
       OR p_target_status IS NULL OR p_target_status NOT IN ('entregado', 'retirado') THEN
        RAISE EXCEPTION 'PAYMENT_COMMAND_INVALID' USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_payments) <> 'array' THEN
        RAISE EXCEPTION 'PAYMENT_PAYLOAD_INVALID' USING ERRCODE = '22023';
    END IF;

    v_hash := encode(sha256(convert_to(jsonb_build_object(
        'order_id', p_order_id,
        'actor_id', v_actor,
        'target_status', p_target_status,
        'payments', v_payments
    )::text, 'UTF8')), 'hex');

    PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 0));

    SELECT * INTO v_existing
    FROM public.order_payment_commands AS c
    WHERE c.command_id = p_command_id;

    IF FOUND THEN
        IF v_existing.actor_id <> v_actor
           OR v_existing.order_id <> p_order_id
           OR v_existing.payload_hash <> v_hash THEN
            RAISE EXCEPTION 'PAYMENT_COMMAND_CONFLICT' USING ERRCODE = '22023';
        END IF;
        RETURN v_existing.result || jsonb_build_object('command_id', p_command_id, 'reused', true);
    END IF;

    SELECT * INTO v_order
    FROM public.pedidos AS p
    WHERE p.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND' USING ERRCODE = '22023';
    END IF;

    IF v_order.estado IN ('entregado', 'retirado', 'cancelado') THEN
        RAISE EXCEPTION 'PAYMENT_ORDER_ALREADY_FINALIZED' USING ERRCODE = '22023';
    END IF;

    -- Nota de despliegue gradual (SEC-01 B.3):
    -- La restricción estricta de modalidad (retiro_sede -> retirado, delivery -> entregado)
    -- se activa en M1 (tr_a_order_state_machine) luego de desplegar el frontend compatible,
    -- para garantizar 100% compatibilidad de M2 con bebb663 durante la ventana de transición.
    v_result := public.confirm_order_and_payments(p_order_id, p_target_status, v_payments, v_actor);
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'PAYMENT_CONFIRMATION_FAILED';
    END IF;

    INSERT INTO public.order_payment_commands(command_id, order_id, actor_id, payload_hash, result)
    VALUES (p_command_id, p_order_id, v_actor, v_hash, v_result);

    RETURN v_result || jsonb_build_object('command_id', p_command_id, 'reused', false);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. RPC actualizada: confirmar_pedido_administrativo_transaccional
--    Habilita trabajo colaborativo entre staff autorizado con auditoría explícita.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirmar_pedido_administrativo_transaccional(
    p_pedido_id uuid,
    p_motivo text DEFAULT 'Confirmación administrativa de pedido'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_actor_user_id uuid := auth.uid();
    v_actor_role text := NULL;
    v_actor_socio_id uuid := NULL;
    v_order record;
    v_updated_order record;
BEGIN
    v_actor_socio_id := public.assert_order_actor(v_actor_user_id, true);

    SELECT lower(btrim(s.rol)) INTO v_actor_role
    FROM public.socios AS s
    WHERE s.id = v_actor_socio_id;

    SELECT * INTO v_order
    FROM public.pedidos
    WHERE id = p_pedido_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: Pedido no encontrado' USING ERRCODE = '22023';
    END IF;

    IF v_order.estado = 'confirmado' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_confirmed', true,
            'pedido', row_to_json(v_order)
        );
    END IF;

    IF v_order.estado <> 'pendiente' THEN
        RAISE EXCEPTION 'INVALID_STATE_TRANSITION: No se puede confirmar un pedido en estado ''%''. Solo se permite confirmar pedidos en estado ''pendiente''.', v_order.estado
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.pedidos
    SET estado = 'confirmado',
        motivo_admin = coalesce(p_motivo, motivo_admin),
        updated_at = clock_timestamp()
    WHERE id = p_pedido_id
    RETURNING * INTO v_updated_order;

    IF v_order.created_by_user_id IS NOT NULL AND v_order.created_by_user_id <> v_actor_user_id THEN
        INSERT INTO public.audit_logs (
            user_id, actor_socio_id, action, entity_type, entity_id, details, created_at
        ) VALUES (
            v_actor_user_id,
            v_actor_socio_id,
            'COLLABORATIVE_ORDER_CONFIRM',
            'pedidos',
            p_pedido_id::text,
            jsonb_build_object(
                'created_by_user_id', v_order.created_by_user_id,
                'actor_user_id', v_actor_user_id,
                'actor_role', v_actor_role,
                'motivo', p_motivo
            ),
            now()
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'already_confirmed', false,
        'pedido', row_to_json(v_updated_order)
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. RPC actualizada: cancelar_pedido_administrativo_transaccional
--    Habilita trabajo colaborativo entre staff autorizado; mantiene en_camino->cancelado
--    reservado estrictamente a admin con motivo obligatorio.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_pedido_administrativo_transaccional(
    p_pedido_id uuid,
    p_motivo text DEFAULT 'Cancelación institucional de pedido'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_actor_user_id uuid := auth.uid();
    v_actor_role text := NULL;
    v_actor_socio_id uuid := NULL;
    v_order record;
    v_updated_order record;
BEGIN
    v_actor_socio_id := public.assert_order_actor(v_actor_user_id, true);

    SELECT lower(btrim(s.rol)) INTO v_actor_role
    FROM public.socios AS s
    WHERE s.id = v_actor_socio_id;

    IF coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'CANCEL_MOTIVE_REQUIRED: El motivo de cancelación administrativa es obligatorio' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_order
    FROM public.pedidos
    WHERE id = p_pedido_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: Pedido no encontrado' USING ERRCODE = '22023';
    END IF;

    IF v_order.estado = 'cancelado' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_cancelled', true,
            'pedido', row_to_json(v_order)
        );
    END IF;

    IF v_order.estado IN ('retirado', 'entregado') THEN
        RAISE EXCEPTION 'INVALID_STATE_TRANSITION: No se puede cancelar un pedido en estado terminal ''%''.', v_order.estado
            USING ERRCODE = '22023';
    END IF;

    IF v_order.estado = 'en_camino' AND v_actor_role <> 'admin' THEN
        RAISE EXCEPTION 'CANCEL_EN_CAMINO_ADMIN_ONLY: Cancelar un pedido en camino está reservado a rol admin.'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.pedidos
    SET estado = 'cancelado',
        motivo_admin = p_motivo,
        updated_at = clock_timestamp()
    WHERE id = p_pedido_id
    RETURNING * INTO v_updated_order;

    IF v_order.created_by_user_id IS NOT NULL AND v_order.created_by_user_id <> v_actor_user_id THEN
        INSERT INTO public.audit_logs (
            user_id, actor_socio_id, action, entity_type, entity_id, details, created_at
        ) VALUES (
            v_actor_user_id,
            v_actor_socio_id,
            'COLLABORATIVE_ORDER_CANCEL',
            'pedidos',
            p_pedido_id::text,
            jsonb_build_object(
                'previous_state', v_order.estado,
                'created_by_user_id', v_order.created_by_user_id,
                'actor_user_id', v_actor_user_id,
                'actor_role', v_actor_role,
                'motivo', p_motivo
            ),
            now()
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'already_cancelled', false,
        'pedido', row_to_json(v_updated_order)
    );
END;
$$;

COMMIT;
