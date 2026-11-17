-- Incremental RPC boundary hardening. No data backfill or historical payment changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_order_and_payments(
    p_order_id uuid, p_target_status text, p_payments jsonb,
    p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_profile_count bigint;
    v_role text;
    v_order record;
    v_payment jsonb;
    v_payment_id uuid;
    v_monto numeric;
    v_medio text;
    v_concepto text;
BEGIN
    IF v_user_id IS NULL OR (p_actor_id IS NOT NULL AND p_actor_id <> v_user_id) THEN
        RAISE EXCEPTION 'PAYMENT_ACTOR_UNAUTHORIZED' USING ERRCODE = '42501';
    END IF;
    -- Same canonical identity boundary as getDelegatedBffContext, without fallbacks.
    SELECT count(*), max(lower(btrim(s.rol))) INTO v_profile_count, v_role
    FROM public.socios AS s WHERE s.auth_user_id = v_user_id;
    IF v_profile_count <> 1 OR v_role NOT IN ('admin', 'staff') OR v_role IS NULL THEN
        RAISE EXCEPTION 'PAYMENT_ROLE_UNAUTHORIZED' USING ERRCODE = '42501';
    END IF;
    IF p_payments IS NOT NULL AND jsonb_typeof(p_payments) <> 'array' THEN
        RAISE EXCEPTION 'PAYMENT_PAYLOAD_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_order FROM public.pedidos AS p WHERE p.id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
    END IF;

    FOR v_payment IN SELECT value FROM jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) LOOP
        IF jsonb_typeof(v_payment) <> 'object' OR v_payment->>'monto' IS NULL THEN
            RAISE EXCEPTION 'PAYMENT_AMOUNT_INVALID' USING ERRCODE = '22023';
        END IF;
        v_monto := (v_payment->>'monto')::numeric;
        -- Zero is an existing bonification flow; do not remove that domain behavior.
        IF v_monto < 0 OR v_monto::text IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION 'PAYMENT_AMOUNT_INVALID' USING ERRCODE = '22023';
        END IF;
        v_medio := coalesce(v_payment->>'medio_de_pago', 'efectivo');
        v_concepto := v_payment->>'concepto';
        INSERT INTO public.pagos(socio_id, fecha, concepto, monto, medio_de_pago,
                                pedido_id, referencia, created_by)
        VALUES (v_order.socio_id, now(), v_concepto, v_monto, v_medio,
                p_order_id, v_payment->>'referencia', v_user_id)
        RETURNING id INTO v_payment_id;
        INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, details, created_at)
        VALUES (v_user_id, 'CREATE', 'PAYMENT', v_payment_id::text,
                jsonb_build_object('socio_id', v_order.socio_id, 'monto', v_monto,
                    'medio_de_pago', v_medio, 'concepto', v_concepto, 'pedido_id', p_order_id), now());
    END LOOP;

    UPDATE public.pedidos SET estado = p_target_status WHERE id = p_order_id;
    INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, details, created_at)
    VALUES (v_user_id, 'UPDATE', 'ORDER', p_order_id::text,
        jsonb_build_object('previous_status', v_order.estado, 'new_status', p_target_status), now());
    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_order_and_payments(uuid,text,jsonb,uuid)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_order_and_payments(uuid,text,jsonb,uuid)
TO authenticated;
COMMIT;
