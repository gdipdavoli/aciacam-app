-- Critical guards only. Does not rerun historical stock adjustments.
BEGIN;
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.protect_socio_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND coalesce(public.get_my_role(),'') NOT IN ('admin','staff') THEN
        IF NEW.rol IS DISTINCT FROM OLD.rol OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
           OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.bloqueado IS DISTINCT FROM OLD.bloqueado THEN
            RAISE EXCEPTION 'No está permitido modificar permisos o identidad' USING ERRCODE='42501';
        END IF;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_socio_identity ON public.socios;
CREATE TRIGGER protect_socio_identity BEFORE UPDATE ON public.socios FOR EACH ROW EXECUTE FUNCTION app_private.protect_socio_identity();

CREATE TABLE IF NOT EXISTS public.order_confirmation_receipts (
    order_id uuid NOT NULL REFERENCES public.pedidos(id),
    request_hash text NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(order_id,request_hash)
);
ALTER TABLE public.order_confirmation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_confirmation_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.order_confirmation_receipts TO authenticated;
GRANT ALL ON public.order_confirmation_receipts TO service_role;
DROP POLICY IF EXISTS staff_read_receipts ON public.order_confirmation_receipts;
CREATE POLICY staff_read_receipts ON public.order_confirmation_receipts FOR SELECT TO authenticated
USING (public.get_my_role() IN ('admin','staff'));
DROP POLICY IF EXISTS staff_insert_receipts ON public.order_confirmation_receipts;
CREATE POLICY staff_insert_receipts ON public.order_confirmation_receipts FOR INSERT TO authenticated
WITH CHECK (public.get_my_role() IN ('admin','staff') AND actor_id=auth.uid());
CREATE OR REPLACE FUNCTION public.confirm_order_and_payments(
    p_order_id UUID,
    p_target_status TEXT,
    p_payments JSONB,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
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
$$;



REVOKE ALL ON FUNCTION public.confirm_order_and_payments(uuid,text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_order_and_payments(uuid,text,jsonb,uuid) TO authenticated,service_role;
COMMIT;
