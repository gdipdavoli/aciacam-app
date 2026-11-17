BEGIN;
CREATE OR REPLACE FUNCTION app_private.fill_legacy_order_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
IF NEW.created_by_user_id IS NULL THEN
    NEW.created_by_user_id := auth.uid();
END IF;
RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.fill_legacy_order_actor() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS tr_0_legacy_order_actor ON public.pedidos;
CREATE TRIGGER tr_0_legacy_order_actor BEFORE INSERT ON public.pedidos
FOR EACH ROW EXECUTE FUNCTION app_private.fill_legacy_order_actor();
REVOKE ALL ON public.order_transition_commands FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.order_transition_commands TO service_role;
DO $$
BEGIN
  IF to_regprocedure('public.check_pedidos_update_only_status()') IS NOT NULL THEN
    CREATE OR REPLACE FUNCTION public.check_pedidos_update_only_status()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    AS $fn$
    BEGIN
      -- Permitir únicamente cuando se ejecuta dentro de una RPC SECURITY DEFINER confiable (owned by postgres/supabase_admin)
      IF current_user IN ('postgres', 'supabase_admin') THEN
        RETURN NEW;
      END IF;
      IF public.get_my_role() IN ('admin', 'staff') THEN
        RETURN NEW;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.socios
        WHERE id = OLD.socio_id AND (auth_user_id = auth.uid() OR user_id = auth.uid())
      ) THEN
        RAISE EXCEPTION 'No autorizado para modificar este pedido.';
      END IF;
      IF NEW.id IS DISTINCT FROM OLD.id OR
         NEW.socio_id IS DISTINCT FROM OLD.socio_id OR
         NEW.tipo_pedido IS DISTINCT FROM OLD.tipo_pedido OR
         NEW.origen IS DISTINCT FROM OLD.origen OR
         NEW.created_at IS DISTINCT FROM OLD.created_at OR
         NEW.items IS DISTINCT FROM OLD.items OR
         NEW.observaciones IS DISTINCT FROM OLD.observaciones OR
         NEW.direccion_entrega IS DISTINCT FROM OLD.direccion_entrega OR
         NEW.localidad IS DISTINCT FROM OLD.localidad OR
         NEW.fecha_retiro_preferida IS DISTINCT FROM OLD.fecha_retiro_preferida OR
         NEW.franja_horaria IS DISTINCT FROM OLD.franja_horaria OR
         NEW.slot_id IS DISTINCT FROM OLD.slot_id OR
         NEW.entrega_estimada IS DISTINCT FROM OLD.entrega_estimada OR
         NEW.ubicacion_gps IS DISTINCT FROM OLD.ubicacion_gps OR
         NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR
         NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
         NEW.motivo_admin IS DISTINCT FROM OLD.motivo_admin OR
         NEW.archivado IS DISTINCT FROM OLD.archivado THEN
        RAISE EXCEPTION 'Los socios sólo pueden modificar el estado de sus pedidos.';
      END IF;
      RETURN NEW;
    END;
    $fn$;
  END IF;
END $$;
COMMIT;
