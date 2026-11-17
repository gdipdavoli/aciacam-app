-- Sprint 5 acceptance fix: allow socio order stock reservation through the
-- trigger only, without granting direct product UPDATE to socios.
BEGIN;

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.tr_check_and_deduct_stock_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_delta record;
    v_stock integer;
    v_actor uuid := auth.uid();
    v_role text;
BEGIN
    SELECT lower(btrim(s.rol)) INTO v_role
    FROM public.socios AS s
    WHERE s.auth_user_id = v_actor
    ORDER BY CASE lower(btrim(s.rol)) WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END
    LIMIT 1;

    IF coalesce(v_role, '') NOT IN ('admin', 'staff') AND NOT EXISTS (
        SELECT 1
        FROM public.socios AS s
        WHERE s.id = NEW.socio_id
          AND s.auth_user_id = v_actor
    ) THEN
        RAISE EXCEPTION 'ORDER_STOCK_UNAUTHORIZED' USING ERRCODE = '42501';
    END IF;

    IF NEW.estado IS DISTINCT FROM 'cancelado' THEN
        FOR v_delta IN
            SELECT q.product_id, q.quantity
            FROM public.order_stock_quantities(NEW.items) AS q
            ORDER BY q.product_id
        LOOP
            SELECT p.stock_disponible INTO v_stock
            FROM public.products AS p
            WHERE p.id = v_delta.product_id
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

CREATE OR REPLACE FUNCTION app_private.tr_check_and_adjust_stock_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_delta record;
    v_stock integer;
    v_actor uuid := auth.uid();
    v_role text;
BEGIN
    SELECT lower(btrim(s.rol)) INTO v_role
    FROM public.socios AS s
    WHERE s.auth_user_id = v_actor
    ORDER BY CASE lower(btrim(s.rol)) WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END
    LIMIT 1;

    IF coalesce(v_role, '') NOT IN ('admin', 'staff') AND NOT EXISTS (
        SELECT 1
        FROM public.socios AS s
        WHERE s.id = NEW.socio_id
          AND s.auth_user_id = v_actor
    ) THEN
        RAISE EXCEPTION 'ORDER_STOCK_UNAUTHORIZED' USING ERRCODE = '42501';
    END IF;
    IF coalesce(v_role, '') NOT IN ('admin', 'staff')
       AND NEW.socio_id IS DISTINCT FROM OLD.socio_id THEN
        RAISE EXCEPTION 'ORDER_STOCK_UNAUTHORIZED' USING ERRCODE = '42501';
    END IF;

    IF OLD.items IS NOT DISTINCT FROM NEW.items
       AND (OLD.estado = 'cancelado') IS NOT DISTINCT FROM (NEW.estado = 'cancelado') THEN
        RETURN NEW;
    END IF;

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
        FROM public.products AS p
        WHERE p.id = v_delta.product_id
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

DROP TRIGGER IF EXISTS tr_pedidos_insert_stock ON public.pedidos;
CREATE TRIGGER tr_pedidos_insert_stock
BEFORE INSERT ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION app_private.tr_check_and_deduct_stock_on_insert();

DROP TRIGGER IF EXISTS tr_pedidos_update_stock ON public.pedidos;
CREATE TRIGGER tr_pedidos_update_stock
BEFORE UPDATE ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION app_private.tr_check_and_adjust_stock_on_update();

REVOKE ALL ON FUNCTION public.order_stock_quantities(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.tr_check_and_deduct_stock_on_insert() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.tr_check_and_adjust_stock_on_update() FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.tr_check_and_deduct_stock_on_insert();
DROP FUNCTION IF EXISTS public.tr_check_and_adjust_stock_on_update();

COMMIT;
