-- ============================================================================
-- SEC-01 FASE B.1 — PROPUESTA DE MIGRACIÓN M1 (LOCAL / NO EJECUTADA EN INTEGRATION)
-- Objetivo: Máquina de estados canónica en public.pedidos + guarda terminal en stock
-- Orden de ejecución de triggers BEFORE UPDATE en public.pedidos (alfabético):
--   1. tr_a_order_state_machine       (app_private.enforce_order_state_machine)
--   2. tr_order_operator_guard        (public.enforce_order_operator)
--   3. tr_pedidos_enforce_slot_capacity (public.fn_pedidos_enforce_slot_capacity)
--   4. tr_pedidos_update_stock        (app_private.tr_check_and_adjust_stock_on_update)
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION app_private.enforce_order_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_role text := NULL;
    v_is_privileged boolean := false;
    v_is_terminal boolean := OLD.estado IN ('entregado', 'retirado', 'cancelado');
    v_valid boolean := false;
BEGIN
    v_is_privileged := coalesce(auth.jwt()->>'role', '') = 'service_role'
        OR (v_actor IS NULL AND auth.jwt()->>'role' IS NULL AND session_user IN ('postgres', 'supabase_admin'));

    IF v_actor IS NOT NULL THEN
        SELECT lower(btrim(s.rol)) INTO v_role
        FROM public.socios AS s
        WHERE s.auth_user_id = v_actor
        ORDER BY CASE lower(btrim(s.rol)) WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END
        LIMIT 1;
    END IF;

    -- 1. Campos estructurales inmutables en cualquier estado
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.socio_id IS DISTINCT FROM OLD.socio_id
       OR NEW.tipo_pedido IS DISTINCT FROM OLD.tipo_pedido
       OR NEW.origen IS DISTINCT FROM OLD.origen
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.idempotency_payload_hash IS DISTINCT FROM OLD.idempotency_payload_hash THEN
        RAISE EXCEPTION 'ORDER_IMMUTABLE_FIELD: No está permitido modificar identidad, socio, tipo, origen o claves de creación del pedido.'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Protección estricta de estados terminales (entregado, retirado, cancelado)
    -- Solo se permiten actualizaciones administrativas no operativas: archivado, updated_at, observaciones, motivo_admin.
    IF v_is_terminal THEN
        IF NEW.estado IS DISTINCT FROM OLD.estado
           OR NEW.items IS DISTINCT FROM OLD.items
           OR NEW.direccion_entrega IS DISTINCT FROM OLD.direccion_entrega
           OR NEW.localidad IS DISTINCT FROM OLD.localidad
           OR NEW.fecha_retiro_preferida IS DISTINCT FROM OLD.fecha_retiro_preferida
           OR NEW.franja_horaria IS DISTINCT FROM OLD.franja_horaria
           OR NEW.slot_id IS DISTINCT FROM OLD.slot_id
           OR NEW.entrega_estimada IS DISTINCT FROM OLD.entrega_estimada
           OR NEW.ubicacion_gps IS DISTINCT FROM OLD.ubicacion_gps THEN
            RAISE EXCEPTION 'ORDER_TERMINAL_IMMUTABLE: Un pedido en estado terminal "%" no admite cambios de estado, ítems ni logística.', OLD.estado
                USING ERRCODE = '22023';
        END IF;
        RETURN NEW;
    END IF;

    -- 3. Si no hay cambio de estado, permitir edición de ítems/logística en estados no terminales
    IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
        RETURN NEW;
    END IF;

    -- 4. Matriz canónica de transiciones permitidas
    v_valid := CASE OLD.estado
        WHEN 'pendiente' THEN NEW.estado IN ('confirmado', 'en_preparacion', 'cancelado')
        WHEN 'confirmado' THEN NEW.estado IN ('en_preparacion', 'listo_para_retiro', 'en_camino', 'retirado', 'entregado', 'cancelado')
        WHEN 'en_preparacion' THEN NEW.estado IN ('confirmado', 'listo_para_retiro', 'en_camino', 'cancelado')
        WHEN 'listo_para_retiro' THEN NEW.estado IN ('retirado', 'en_camino', 'en_preparacion', 'cancelado')
        WHEN 'en_camino' THEN NEW.estado IN ('entregado', 'en_preparacion', 'cancelado')
        ELSE false
    END;

    IF NOT v_valid THEN
        RAISE EXCEPTION 'INVALID_STATE_TRANSITION: Transición no permitida de "%" a "%".', OLD.estado, NEW.estado
            USING ERRCODE = '22023';
    END IF;

    -- 5. Coherencia estricta de modalidad en estados de cierre físico
    IF NEW.estado = 'retirado' AND NEW.tipo_pedido <> 'retiro_sede' THEN
        RAISE EXCEPTION 'INVALID_ORDER_TYPE_FOR_STATUS: Un pedido "%" debe finalizar en "entregado", no en "retirado".', NEW.tipo_pedido
            USING ERRCODE = '22023';
    END IF;

    IF NEW.estado = 'entregado' AND NEW.tipo_pedido <> 'delivery' THEN
        RAISE EXCEPTION 'INVALID_ORDER_TYPE_FOR_STATUS: Un pedido "%" debe finalizar en "retirado", no en "entregado".', NEW.tipo_pedido
            USING ERRCODE = '22023';
    END IF;

    -- 6. Excepción sensible: cancelar un pedido ya despachado 'en_camino' queda reservado a 'admin'
    IF OLD.estado = 'en_camino' AND NEW.estado = 'cancelado' THEN
        IF NOT v_is_privileged AND coalesce(v_role, '') <> 'admin' THEN
            RAISE EXCEPTION 'ADMIN_EXCEPTION_REQUIRED: Solo un administrador puede cancelar un pedido ya despachado en camino.'
                USING ERRCODE = '42501';
        END IF;
        IF coalesce(btrim(NEW.motivo_admin), '') = '' THEN
            RAISE EXCEPTION 'CANCEL_MOTIVE_REQUIRED: La cancelación excepcional de un pedido en camino requiere motivo_admin.'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.enforce_order_state_machine() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_a_order_state_machine ON public.pedidos;
CREATE TRIGGER tr_a_order_state_machine
BEFORE UPDATE ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION app_private.enforce_order_state_machine();

-- Defensa en profundidad dentro del trigger de stock
CREATE OR REPLACE FUNCTION app_private.tr_check_and_adjust_stock_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_delta record;
    v_stock integer;
    v_actor uuid := auth.uid();
    v_role text;
    v_privileged boolean;
BEGIN
    v_privileged := coalesce(auth.jwt()->>'role', '') = 'service_role'
        OR (v_actor IS NULL AND auth.jwt()->>'role' IS NULL AND session_user IN ('postgres', 'supabase_admin'));

    IF NOT v_privileged THEN
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
    END IF;

    -- Guarda terminal absoluta: jamás restituir ni descontar stock desde estados terminales
    IF OLD.estado IN ('entregado', 'retirado', 'cancelado')
       AND (NEW.estado IS DISTINCT FROM OLD.estado OR NEW.items IS DISTINCT FROM OLD.items) THEN
        RAISE EXCEPTION 'ORDER_STOCK_TERMINAL_LOCKED: No se permite alterar stock desde estado terminal "%".', OLD.estado
            USING ERRCODE = '22023';
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
$function$;

REVOKE ALL ON FUNCTION app_private.tr_check_and_adjust_stock_on_update() FROM PUBLIC, anon, authenticated, service_role;

-- 3. Auditoría de sobrescrituras de observaciones, motivo_admin y archivado sin cambio de estado
CREATE OR REPLACE FUNCTION app_private.fn_audit_pedido_notes_and_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_actor_socio_id uuid := NULL;
BEGIN
    IF OLD.estado IS NOT DISTINCT FROM NEW.estado
       AND (
           OLD.observaciones IS DISTINCT FROM NEW.observaciones
           OR OLD.motivo_admin IS DISTINCT FROM NEW.motivo_admin
           OR OLD.archivado IS DISTINCT FROM NEW.archivado
       ) THEN
        IF v_actor IS NOT NULL THEN
            SELECT s.id INTO v_actor_socio_id
            FROM public.socios AS s
            WHERE s.auth_user_id = v_actor
            ORDER BY CASE lower(btrim(s.rol)) WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END
            LIMIT 1;
        END IF;

        INSERT INTO public.audit_logs (
            user_id, actor_socio_id, action, entity_type, entity_id, details, created_at
        ) VALUES (
            v_actor,
            v_actor_socio_id,
            'ORDER_NOTES_OR_ARCHIVE_UPDATE',
            'pedidos',
            NEW.id::text,
            jsonb_build_object(
                'estado', NEW.estado,
                'previous_observaciones', OLD.observaciones,
                'new_observaciones', NEW.observaciones,
                'previous_motivo_admin', OLD.motivo_admin,
                'new_motivo_admin', NEW.motivo_admin,
                'previous_archivado', OLD.archivado,
                'new_archivado', NEW.archivado
            ),
            now()
        );
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.fn_audit_pedido_notes_and_archive() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_pedidos_audit_notes_and_archive ON public.pedidos;
CREATE TRIGGER tr_pedidos_audit_notes_and_archive
    AFTER UPDATE ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION app_private.fn_audit_pedido_notes_and_archive();

COMMIT;
