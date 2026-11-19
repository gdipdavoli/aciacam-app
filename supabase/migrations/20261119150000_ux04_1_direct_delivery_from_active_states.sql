-- UX-04.1: Entrega directa atómica desde estados activos ('pendiente', 'en_preparacion')
-- Mantiene intacto el trigger tr_a_order_state_machine, las firmas SEC-01, RLS y permisos.
-- Si el pedido está en 'pendiente' o 'en_preparacion', realiza la transición intermedia canónica
-- a 'confirmado' (con auditoría explícita) dentro de la misma transacción antes de finalizar en 'retirado'/'entregado'.

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

    -- Validar coherencia de modalidad antes de cualquier transición intermedia
    IF p_target_status = 'retirado' AND v_order.tipo_pedido <> 'retiro_sede' THEN
        RAISE EXCEPTION 'INVALID_ORDER_TYPE_FOR_STATUS: Un pedido "%" debe finalizar en "entregado", no en "retirado".', v_order.tipo_pedido
            USING ERRCODE = '22023';
    END IF;

    IF p_target_status = 'entregado' AND v_order.tipo_pedido <> 'delivery' THEN
        RAISE EXCEPTION 'INVALID_ORDER_TYPE_FOR_STATUS: Un pedido "%" debe finalizar en "retirado", no en "entregado".', v_order.tipo_pedido
            USING ERRCODE = '22023';
    END IF;

    -- Recorrido atómico seguro dentro de la misma transacción respetando tr_a_order_state_machine:
    -- pendiente / en_preparacion -> confirmado -> retirado / entregado
    IF v_order.estado IN ('pendiente', 'en_preparacion') THEN
        UPDATE public.pedidos
        SET estado = 'confirmado',
            updated_at = clock_timestamp()
        WHERE id = p_order_id;

        INSERT INTO public.audit_logs (
            user_id,
            action,
            entity_type,
            entity_id,
            details,
            created_at
        ) VALUES (
            v_actor,
            'UPDATE',
            'ORDER',
            p_order_id::text,
            jsonb_build_object(
                'previous_status', v_order.estado,
                'new_status', 'confirmado',
                'via', 'direct_delivery_auto_confirm'
            ),
            clock_timestamp()
        );
    END IF;

    v_result := public.confirm_order_and_payments(p_order_id, p_target_status, v_payments, v_actor);
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'PAYMENT_CONFIRMATION_FAILED';
    END IF;

    INSERT INTO public.order_payment_commands(command_id, order_id, actor_id, payload_hash, result)
    VALUES (p_command_id, p_order_id, v_actor, v_hash, v_result);

    RETURN v_result || jsonb_build_object('command_id', p_command_id, 'reused', false);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_order_payment_command(uuid,uuid,text,jsonb,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_order_payment_command(uuid,uuid,text,jsonb,uuid) TO authenticated;
