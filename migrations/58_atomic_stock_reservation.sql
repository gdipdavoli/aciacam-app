-- Incremental hardening only: no backfill, historical balance repair or new state policy.
BEGIN;

CREATE OR REPLACE FUNCTION public.order_stock_quantities(p_items jsonb)
RETURNS TABLE(product_id uuid, quantity bigint)
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_item jsonb;
    v_quantity numeric;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'ORDER_ITEMS_INVALID' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
        IF jsonb_typeof(v_item) <> 'object'
           OR v_item->>'productoId' IS NULL
           OR v_item->>'cantidad' IS NULL THEN
            RAISE EXCEPTION 'ORDER_ITEM_INVALID' USING ERRCODE = '22023';
        END IF;
        -- Validate before integer conversion: PostgreSQL numeric casts can round.
        v_quantity := (v_item->>'cantidad')::numeric;
        IF v_quantity <= 0 OR v_quantity > 2147483647
           OR v_quantity <> trunc(v_quantity)
           OR v_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION 'ORDER_QUANTITY_INVALID' USING ERRCODE = '22023';
        END IF;
        PERFORM (v_item->>'productoId')::uuid;
    END LOOP;
    RETURN QUERY
        SELECT (item.value->>'productoId')::uuid,
               sum((item.value->>'cantidad')::bigint)::bigint
        FROM jsonb_array_elements(p_items) AS item(value)
        GROUP BY (item.value->>'productoId')::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.tr_check_and_deduct_stock_on_insert()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_delta record;
    v_stock integer;
BEGIN
    IF NEW.estado IS DISTINCT FROM 'cancelado' THEN
        -- All writers acquire product locks in the same UUID order.
        FOR v_delta IN
            SELECT q.product_id, q.quantity
            FROM public.order_stock_quantities(NEW.items) AS q
            ORDER BY q.product_id
        LOOP
            SELECT p.stock_disponible INTO v_stock
            FROM public.products AS p WHERE p.id = v_delta.product_id
            FOR UPDATE;
            IF NOT FOUND OR v_stock IS NULL THEN
                RAISE EXCEPTION 'ORDER_PRODUCT_UNAVAILABLE: %', v_delta.product_id;
            END IF;
            IF v_stock < v_delta.quantity THEN
                RAISE EXCEPTION 'ORDER_STOCK_INSUFFICIENT: %', v_delta.product_id;
            END IF;
            UPDATE public.products AS p
            SET stock_disponible = v_stock::bigint - v_delta.quantity,
                last_audit_note = 'Descuento por nuevo pedido (' || NEW.estado || ')',
                last_audit_order_id = NEW.id
            WHERE p.id = v_delta.product_id;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tr_check_and_adjust_stock_on_update()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_delta record;
    v_stock integer;
BEGIN
    IF OLD.items IS NOT DISTINCT FROM NEW.items
       AND (OLD.estado = 'cancelado') IS NOT DISTINCT FROM (NEW.estado = 'cancelado') THEN
        RETURN NEW;
    END IF;
    -- Net deltas retain migration 53 cancellation/reactivation semantics.
    -- Do not silently reinterpret whether a delivered order may be cancelled.
    FOR v_delta IN
        SELECT coalesce(n.product_id, o.product_id) AS product_id,
               coalesce(n.quantity, 0) - coalesce(o.quantity, 0) AS quantity
        FROM public.order_stock_quantities(
            CASE WHEN OLD.estado = 'cancelado' THEN '[]'::jsonb ELSE OLD.items END
        ) AS o
        FULL JOIN public.order_stock_quantities(
            CASE WHEN NEW.estado = 'cancelado' THEN '[]'::jsonb ELSE NEW.items END
        ) AS n ON n.product_id = o.product_id
        WHERE coalesce(n.quantity, 0) <> coalesce(o.quantity, 0)
        ORDER BY coalesce(n.product_id, o.product_id)
    LOOP
        SELECT p.stock_disponible INTO v_stock
        FROM public.products AS p WHERE p.id = v_delta.product_id
        FOR UPDATE;
        IF NOT FOUND OR v_stock IS NULL THEN
            RAISE EXCEPTION 'ORDER_PRODUCT_UNAVAILABLE: %', v_delta.product_id;
        END IF;
        IF v_delta.quantity > 0 AND v_stock < v_delta.quantity THEN
            RAISE EXCEPTION 'ORDER_STOCK_INSUFFICIENT: %', v_delta.product_id;
        END IF;
        UPDATE public.products AS p
        SET stock_disponible = v_stock::bigint - v_delta.quantity,
            last_audit_note = 'Ajuste neto por pedido (' || NEW.estado || ')',
            last_audit_order_id = NEW.id
        WHERE p.id = v_delta.product_id;
    END LOOP;
    RETURN NEW;
END;
$$;

-- Existing trigger bindings are retained; never rerun migration 49's backfill.
COMMIT;
