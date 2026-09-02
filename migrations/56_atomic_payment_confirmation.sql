-- Migration 56: Atomic Payment Confirmation & Res. 800/2021 Legal Trigger
-- This migration adds an atomic RPC procedure for payment confirmation and a trigger enforcing legal limits.

-- 1. Create Stored Procedure for atomic payment registration & order status update
CREATE OR REPLACE FUNCTION public.confirm_order_and_payments(
    p_order_id UUID,
    p_target_status TEXT,
    p_payments JSONB,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
BEGIN
    -- Determine actor user id
    v_user_id := COALESCE(p_actor_id, auth.uid());

    -- 1. Fetch & lock order
    SELECT * INTO v_order
    FROM public.pedidos
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido con ID % no encontrado.', p_order_id;
    END IF;

    v_socio_id := v_order.socio_id;

    -- 2. Iterate and insert payment records
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
            v_monto := (v_payment->>'monto')::numeric;
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


-- 2. Create Trigger Function to enforce Resolution 800/2021 legal limits on public.pedidos
CREATE OR REPLACE FUNCTION public.check_resolution_800_limits()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_check_resolution_800_limits ON public.pedidos;
CREATE TRIGGER tr_check_resolution_800_limits
BEFORE INSERT OR UPDATE ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION public.check_resolution_800_limits();
