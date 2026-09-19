-- No backfill: only future order changes are affected.
BEGIN;
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC,anon,authenticated;

-- A narrow, non-API trigger owns the inventory mutation. Members retain no
-- direct UPDATE privilege over products; ownership is checked before bypassing RLS.
CREATE OR REPLACE FUNCTION app_private.apply_order_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
END $$;
REVOKE ALL ON FUNCTION app_private.apply_order_stock() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS tr_pedidos_insert_stock ON public.pedidos;
DROP TRIGGER IF EXISTS tr_pedidos_update_stock ON public.pedidos;
CREATE TRIGGER tr_pedidos_insert_stock BEFORE INSERT ON public.pedidos FOR EACH ROW EXECUTE FUNCTION app_private.apply_order_stock();
CREATE TRIGGER tr_pedidos_update_stock BEFORE UPDATE ON public.pedidos FOR EACH ROW EXECUTE FUNCTION app_private.apply_order_stock();
COMMIT;
