-- ==============================================================================
-- ACIACAM APP — SPRINT 7B.3.3
-- Migración preparada para idempotencia de creación de pedidos, deduplicación temprana,
-- consolidación determinista de ítems, aislamiento de operadores y política de confirmación.
--
-- ADVERTENCIA OBLIGATORIA:
-- Este script ha sido preparado y documentado para revisión técnica y del DBA.
-- NO APLICAR EN NINGUNA BASE DE DATOS (Integration o Producción) sin previa autorización.
-- Compatible con el esquema base de Sprint 5 (20261008020000_integration_base_dependencies.sql).
-- ==============================================================================

-- 1. Columna de clave de idempotencia en public.pedidos
ALTER TABLE public.pedidos
ADD COLUMN IF NOT EXISTS idempotency_key uuid;

-- 2. Índice único para garantizar a nivel de motor SQL la no duplicidad de pedidos por clave de idempotencia
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_idempotency_key 
ON public.pedidos (idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- 3. Columnas de aislamiento por operador creador (P0) y huella determinista canónica (P1)
-- Compatibilidad retroactiva: Ambas columnas son NULLABLE, por lo que filas preexistentes no son afectadas.
ALTER TABLE public.pedidos
ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.pedidos
ADD COLUMN IF NOT EXISTS idempotency_payload_hash text;

-- 4. Columna de motivo u origen de la operación administrativa
ALTER TABLE public.pedidos
ADD COLUMN IF NOT EXISTS motivo_admin text;

-- 5. Función de auditoría automática de transiciones de estado de pedidos
CREATE OR REPLACE FUNCTION public.fn_audit_pedido_estado_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_actor_socio_id uuid := NULL;
BEGIN
    -- Intentar resolver el socio_id del actor autenticado si existe sesión
    IF v_user_id IS NOT NULL THEN
        SELECT s.id INTO v_actor_socio_id
        FROM public.socios AS s
        WHERE s.auth_user_id = v_user_id
        ORDER BY CASE lower(btrim(s.rol)) WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END
        LIMIT 1;
    END IF;

    -- Auditar únicamente transiciones efectivas de estado
    IF (TG_OP = 'UPDATE' AND OLD.estado IS DISTINCT FROM NEW.estado) THEN
        INSERT INTO public.audit_logs (
            user_id,
            actor_socio_id,
            action,
            entity_type,
            entity_id,
            details,
            created_at
        ) VALUES (
            v_user_id,
            v_actor_socio_id,
            CASE 
                WHEN NEW.estado = 'confirmado' THEN 'ADMIN_ORDER_CONFIRM'
                WHEN NEW.estado = 'cancelado' THEN 'ORDER_CANCEL'
                ELSE 'ORDER_STATUS_UPDATE'
            END,
            'pedidos',
            NEW.id::text,
            jsonb_build_object(
                'previous_state', OLD.estado,
                'new_state', NEW.estado,
                'socio_id', NEW.socio_id,
                'tipo_pedido', NEW.tipo_pedido,
                'motivo_admin', NEW.motivo_admin,
                'updated_at', now()
            ),
            now()
        );
    END IF;

    RETURN NEW;
END;
$$;

-- Permisos del trigger function
REVOKE ALL ON FUNCTION public.fn_audit_pedido_estado_transition() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_audit_pedido_estado_transition() TO authenticated;

-- 6. Trigger sobre public.pedidos para trazabilidad de estados
DROP TRIGGER IF EXISTS tr_pedidos_audit_estado ON public.pedidos;
CREATE TRIGGER tr_pedidos_audit_estado
AFTER UPDATE OF estado ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION public.fn_audit_pedido_estado_transition();

-- 7. Función RPC atómica para creación administrativa con deduplicación temprana y consolidación de ítems
-- NOTA DE SEGURIDAD SPRINT 7B.3.3:
-- 1. El actor se obtiene EXCLUSIVAMENTE de auth.uid().
-- 2. Consolidación de ítems: Agrupa productos repetidos, suma cantidades y ordena determinísticamente.
-- 3. Concurrencia real: Se adquiere un advisory lock transaccional sobre la clave de idempotencia.
-- 4. Huella canónica determinista: Calcula SHA-256 sobre la representación consolidada.
-- 5. Deduplicación temprana (P1.1): Si la operación ya existe, se devuelve antes de validar estados variables.
-- 6. Solo si no existe: Valida cumplimiento documental, socio activo, catálogo y reserva stock atómicamente.
DROP FUNCTION IF EXISTS public.crear_pedido_administrativo_transaccional(uuid, jsonb, text, text, uuid, text, text, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.crear_pedido_administrativo_transaccional(
    p_socio_id uuid,
    p_items jsonb,
    p_tipo_pedido text,
    p_motivo text,
    p_idempotency_key uuid DEFAULT NULL,
    p_direccion_entrega text DEFAULT NULL,
    p_localidad text DEFAULT NULL,
    p_observaciones text DEFAULT NULL,
    p_fecha_retiro text DEFAULT NULL,
    p_franja_horaria text DEFAULT NULL,
    p_slot_id uuid DEFAULT NULL,
    p_es_sobreturno boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_user_id uuid := auth.uid();
    v_actor_role text := NULL;
    v_actor_socio_id uuid := NULL;
    v_target_socio record;
    v_existing_order record;
    v_new_order record;
    v_item record;
    v_prod record;
    v_consolidated_items jsonb := '[]'::jsonb;
    v_canonical_payload jsonb;
    v_hash text;
    v_audit_details jsonb;
    v_slot record;
    v_slot_reservations integer;
BEGIN
    -- 1. Autenticar y autorizar al operador (JWT real obligatorio)
    IF v_actor_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Sesión no autenticada' USING ERRCODE = '42501';
    END IF;

    SELECT lower(btrim(s.rol)), s.id INTO v_actor_role, v_actor_socio_id
    FROM public.socios AS s
    WHERE s.auth_user_id = v_actor_user_id
    ORDER BY CASE lower(btrim(s.rol)) WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END
    LIMIT 1;

    IF v_actor_role IS NULL OR v_actor_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'FORBIDDEN: Requiere rol administrativo (admin o staff) para invocar esta función' USING ERRCODE = '42501';
    END IF;

    -- 2. Validar estructura de la solicitud
    IF p_socio_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_SOCIO_ID: Debe especificar un identificador de socio destinatario válido' USING ERRCODE = '22023';
    END IF;

    IF p_motivo IS NULL OR length(btrim(p_motivo)) = 0 THEN
        RAISE EXCEPTION 'MISSING_ORDER_MOTIVE: El motivo de la operación administrativa es obligatorio' USING ERRCODE = '22023';
    END IF;

    IF p_tipo_pedido NOT IN ('retiro_sede', 'delivery') THEN
        RAISE EXCEPTION 'INVALID_ORDER_TYPE: El tipo de pedido debe ser retiro_sede o delivery' USING ERRCODE = '22023';
    END IF;

    IF p_tipo_pedido = 'delivery' THEN
        IF p_direccion_entrega IS NULL OR length(btrim(p_direccion_entrega)) = 0 
           OR p_localidad IS NULL OR length(btrim(p_localidad)) = 0 THEN
            RAISE EXCEPTION 'MISSING_DELIVERY_ADDRESS: Dirección y localidad obligatorias para modalidad delivery' USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'EMPTY_ITEMS: El pedido debe contener al menos un producto' USING ERRCODE = '22023';
    END IF;

    -- Validar formato estructural de cada ítem de entrada
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
        IF jsonb_typeof(v_item.value) <> 'object' 
           OR (v_item.value->>'productoId' IS NULL AND v_item.value->>'id' IS NULL)
           OR (v_item.value->>'cantidad' IS NULL AND v_item.value->>'quantity' IS NULL) THEN
            RAISE EXCEPTION 'INVALID_PRODUCT_PAYLOAD: Cada ítem debe contener productoId y cantidad' USING ERRCODE = '22023';
        END IF;

        BEGIN
            PERFORM (coalesce(v_item.value->>'productoId', v_item.value->>'id'))::uuid;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'INVALID_PRODUCT_ID: Identificador de producto debe ser un UUID válido' USING ERRCODE = '22023';
        END;

        IF (coalesce(v_item.value->>'cantidad', v_item.value->>'quantity'))::numeric <= 0 
           OR (coalesce(v_item.value->>'cantidad', v_item.value->>'quantity'))::numeric > 2147483647
           OR (coalesce(v_item.value->>'cantidad', v_item.value->>'quantity'))::numeric <> trunc((coalesce(v_item.value->>'cantidad', v_item.value->>'quantity'))::numeric) THEN
            RAISE EXCEPTION 'INVALID_QUANTITY: Cada producto debe tener una cantidad entera mayor a cero' USING ERRCODE = '22023';
        END IF;
    END LOOP;

    -- Consolidación de ítems (Sprint 7B.3.3 - P1.2):
    -- Agrupar productos repetidos, sumar cantidades y ordenar determinísticamente por UUID de producto
    -- Utiliza exactamente la misma representación para huella canónica y persistencia.
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'productoId', sub.prod_id::text,
            'cantidad', sub.total_qty
        ) ORDER BY sub.prod_id
    ), '[]'::jsonb)
    INTO v_consolidated_items
    FROM (
        SELECT 
            (coalesce(x->>'productoId', x->>'id'))::uuid AS prod_id,
            sum((coalesce(x->>'cantidad', x->>'quantity'))::bigint) AS total_qty
        FROM jsonb_array_elements(p_items) AS x
        GROUP BY (coalesce(x->>'productoId', x->>'id'))::uuid
    ) AS sub;

    -- Validar límites compatibles con triggers de Sprint 5
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_consolidated_items) LOOP
        IF (v_item.value->>'cantidad')::bigint > 2147483647 THEN
            RAISE EXCEPTION 'ORDER_QUANTITY_INVALID: La cantidad total consolidada excede el límite permitido' USING ERRCODE = '22023';
        END IF;
    END LOOP;

    -- 3. Adquirir el advisory lock de idempotencia (serialización concurrente)
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
    END IF;

    -- 4. Construir la huella canónica determinista completa usando los ítems consolidados
    v_canonical_payload := jsonb_build_object(
        'actor_user_id', v_actor_user_id::text,
        'socio_id', p_socio_id::text,
        'tipo_pedido', lower(btrim(p_tipo_pedido)),
        'items', v_consolidated_items,
        'motivo_admin', btrim(coalesce(p_motivo, '')),
        'direccion_entrega', lower(btrim(coalesce(CASE WHEN p_tipo_pedido = 'delivery' THEN p_direccion_entrega ELSE '' END, ''))),
        'localidad', lower(btrim(coalesce(CASE WHEN p_tipo_pedido = 'delivery' THEN p_localidad ELSE '' END, ''))),
        'fecha_retiro', btrim(coalesce(CASE WHEN p_tipo_pedido = 'retiro_sede' THEN p_fecha_retiro ELSE '' END, '')),
        'franja_horaria', btrim(coalesce(CASE WHEN p_tipo_pedido = 'retiro_sede' THEN p_franja_horaria ELSE '' END, '')),
        'slot_id', coalesce(p_slot_id::text, ''),
        'es_sobreturno', p_es_sobreturno,
        'observaciones', btrim(coalesce(p_observaciones, ''))
    );

    v_hash := encode(sha256(convert_to(v_canonical_payload::text, 'UTF8')), 'hex');

    -- 5 & 6. Buscar operación existente y resolver DEDUPLICACIÓN TEMPRANA (Sprint 7B.3.3 - P1.1)
    -- Si existe, comprobar actor y huella, y devolver resultado deduplicado SIN evaluar
    -- socio bloqueado ni productos desactivados con posterioridad a la creación original.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing_order 
        FROM public.pedidos 
        WHERE idempotency_key = p_idempotency_key 
        LIMIT 1;

        IF FOUND THEN
            -- Aislamiento de operador (P0): Si otro operador intenta reusar la clave
            IF v_existing_order.created_by_user_id IS DISTINCT FROM v_actor_user_id THEN
                RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Clave de idempotencia ya utilizada' USING ERRCODE = '23505';
            END IF;

            -- Huella canónica completa (P1): Ante cualquier diferencia en parámetros
            IF v_existing_order.idempotency_payload_hash IS DISTINCT FROM v_hash THEN
                RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Clave de idempotencia ya utilizada con diferentes parámetros' USING ERRCODE = '23505';
            END IF;

            -- Deduplicación exitosa garantizada: no evalúa estado posterior ni crea nuevo pedido
            RETURN jsonb_build_object(
                'success', true,
                'deduplicated', true,
                'pedido', row_to_json(v_existing_order)
            );
        END IF;
    END IF;

    -- 7. SOLO SI NO EXISTE: Validar cumplimiento documental, socio activo, catálogo y stock
    -- A. Validar socio destinatario
    SELECT * INTO v_target_socio FROM public.socios WHERE id = p_socio_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SOCIO_NOT_FOUND: Socio destinatario no encontrado' USING ERRCODE = '22023';
    END IF;

    IF v_target_socio.status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'STATUS_INACTIVE: Operación no permitida: el socio no se encuentra en estado activo' USING ERRCODE = '22023';
    END IF;

    IF v_target_socio.bloqueado = true THEN
        RAISE EXCEPTION 'SOCIO_BLOCKED: Operación no permitida: socio bloqueado. %', coalesce(v_target_socio.motivo_bloqueo, 'Consulte con administración.') USING ERRCODE = '22023';
    END IF;

    IF p_tipo_pedido = 'delivery' AND v_target_socio.envios_habilitados IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'DELIVERY_DISABLED: Operación no permitida: los envíos a domicilio no están habilitados para este socio' USING ERRCODE = '22023';
    END IF;

    -- B. Validar existencia y disponibilidad en catálogo de cada producto consolidado
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_consolidated_items) LOOP
        SELECT id, nombre, activo, stock_disponible INTO v_prod
        FROM public.products
        WHERE id = (v_item.value->>'productoId')::uuid;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Producto solicitado no existe en el catálogo: %', v_item.value->>'productoId' USING ERRCODE = '22023';
        END IF;

        IF v_prod.activo IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'PRODUCT_INACTIVE: El producto no se encuentra disponible para dispensa: %', v_prod.nombre USING ERRCODE = '22023';
        END IF;
    END LOOP;

    -- B.1 Control transaccional de cupos de retiro (pickup_slots con bloqueo FOR UPDATE)
    IF p_tipo_pedido = 'retiro_sede' AND p_slot_id IS NOT NULL THEN
        SELECT * INTO v_slot 
        FROM public.pickup_slots 
        WHERE id = p_slot_id 
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'SLOT_NOT_FOUND: El turno de retiro especificado no existe' USING ERRCODE = '22023';
        END IF;

        IF v_slot.status != 'active' THEN
            RAISE EXCEPTION 'SLOT_UNAVAILABLE: El turno de retiro seleccionado no se encuentra activo (estado: %)', v_slot.status USING ERRCODE = '22023';
        END IF;

        SELECT count(*) INTO v_slot_reservations
        FROM public.pedidos
        WHERE slot_id = p_slot_id
          AND estado != 'cancelado';

        IF v_slot_reservations >= v_slot.capacity THEN
            RAISE EXCEPTION 'SLOT_CAPACITY_EXCEEDED: No quedan cupos disponibles para el turno de retiro seleccionado (capacidad: %, reservados: %). La asignación de sobreturnos excepcionales se encuentra temporalmente deshabilitada.',
                v_slot.capacity, v_slot_reservations USING ERRCODE = '22023';
        END IF;
    END IF;

    -- C. Insertar pedido inicialmente en estado 'pendiente' con los ítems consolidados
    --    El trigger tr_check_and_deduct_stock_on_insert() validará y reservará stock en esta misma transacción
    INSERT INTO public.pedidos (
        socio_id,
        items,
        tipo_pedido,
        origen,
        estado,
        observaciones,
        direccion_entrega,
        localidad,
        fecha_retiro_preferida,
        franja_horaria,
        slot_id,
        idempotency_key,
        motivo_admin,
        created_by_user_id,
        idempotency_payload_hash
    ) VALUES (
        p_socio_id,
        v_consolidated_items,
        p_tipo_pedido,
        'admin',
        'pendiente',
        p_observaciones,
        CASE WHEN p_tipo_pedido = 'delivery' THEN p_direccion_entrega ELSE NULL END,
        CASE WHEN p_tipo_pedido = 'delivery' THEN p_localidad ELSE NULL END,
        CASE WHEN p_tipo_pedido = 'retiro_sede' THEN p_fecha_retiro ELSE NULL END,
        CASE WHEN p_tipo_pedido = 'retiro_sede' THEN p_franja_horaria ELSE NULL END,
        p_slot_id,
        p_idempotency_key,
        p_motivo,
        v_actor_user_id,
        v_hash
    )
    RETURNING * INTO v_new_order;

    -- D. Registrar auditoría única obligatoria en la misma transacción atómica
    v_audit_details := jsonb_build_object(
        'target_socio_id', p_socio_id,
        'tipo_pedido', p_tipo_pedido,
        'motivo', p_motivo,
        'idempotency_key', p_idempotency_key,
        'idempotency_payload_hash', v_hash,
        'actor_role', v_actor_role,
        'slot_id', p_slot_id,
        'es_sobreturno', false,
        'created_at', now()
    );

    INSERT INTO public.audit_logs (
        user_id,
        actor_socio_id,
        action,
        entity_type,
        entity_id,
        details,
        created_at
    ) VALUES (
        v_actor_user_id,
        v_actor_socio_id,
        'ADMIN_ORDER_CREATE',
        'pedidos',
        v_new_order.id::text,
        v_audit_details,
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'deduplicated', false,
        'pedido', row_to_json(v_new_order)
    );
END;
$$;

-- Permisos de ejecución para creación transaccional
REVOKE ALL ON FUNCTION public.crear_pedido_administrativo_transaccional(uuid, jsonb, text, text, uuid, text, text, text, text, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_pedido_administrativo_transaccional(uuid, jsonb, text, text, uuid, text, text, text, text, text, uuid, boolean) TO authenticated;

-- 8. Función RPC atómica para confirmación administrativa con bloqueo de fila y política de autorización
-- NOTA DE SEGURIDAD SPRINT 7B.3.3:
-- 1. El actor se obtiene EXCLUSIVAMENTE de auth.uid().
-- 2. La auditoría se realiza automáticamente y de forma única a través del trigger tr_pedidos_audit_estado.
-- 3. POLÍTICA DE CONFIRMACIÓN (P1.3): La confirmación queda reservada al creador del pedido
--    (created_by_user_id = auth.uid()) o a un usuario con rol 'admin'. Un operador staff no creador es rechazado.
CREATE OR REPLACE FUNCTION public.confirmar_pedido_administrativo_transaccional(
    p_pedido_id uuid,
    p_motivo text DEFAULT 'Confirmación administrativa de pedido'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_user_id uuid := auth.uid();
    v_actor_role text := NULL;
    v_actor_socio_id uuid := NULL;
    v_order record;
    v_updated_order record;
BEGIN
    -- A. Resolver y validar autorización del staff (JWT real obligatorio)
    IF v_actor_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Sesión no autenticada' USING ERRCODE = '42501';
    END IF;

    SELECT lower(btrim(s.rol)), s.id INTO v_actor_role, v_actor_socio_id
    FROM public.socios AS s
    WHERE s.auth_user_id = v_actor_user_id
    ORDER BY CASE lower(btrim(s.rol)) WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END
    LIMIT 1;

    IF v_actor_role IS NULL OR v_actor_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'FORBIDDEN: Requiere rol administrativo (admin o staff)' USING ERRCODE = '42501';
    END IF;

    -- B. Bloqueo pesimista de fila (FOR UPDATE) para evitar carreras de confirmación/cancelación
    SELECT * INTO v_order 
    FROM public.pedidos 
    WHERE id = p_pedido_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: Pedido no encontrado' USING ERRCODE = '22023';
    END IF;

    -- C. POLÍTICA ADMINISTRATIVA DE CONFIRMACIÓN (Sprint 7B.3.3 - P1.3):
    -- Regla canónica de autorización:
    -- La confirmación de un pedido administrativo en estado 'pendiente' está reservada al operador
    -- que lo creó (created_by_user_id = auth.uid()) o a cualquier operador con rol 'admin'.
    -- Un operador con rol 'staff' no puede confirmar un pedido iniciado por otro operador.
    IF v_order.created_by_user_id IS NOT NULL 
       AND v_order.created_by_user_id <> v_actor_user_id 
       AND v_actor_role <> 'admin' THEN
        RAISE EXCEPTION 'CONFIRM_FORBIDDEN_FOREIGN_OPERATOR: La confirmación de este pedido está reservada a su creador o a un administrador' USING ERRCODE = '42501';
    END IF;

    -- Idempotencia si ya está confirmado
    IF v_order.estado = 'confirmado' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_confirmed', true,
            'pedido', row_to_json(v_order)
        );
    END IF;

    -- Solo permitir transición autorizada desde 'pendiente'
    IF v_order.estado <> 'pendiente' THEN
        RAISE EXCEPTION 'INVALID_STATE_TRANSITION: No se puede confirmar un pedido en estado ''%''. Solo se permite confirmar pedidos en estado ''pendiente''.', v_order.estado USING ERRCODE = '22023';
    END IF;

    -- D. Transicionar estado a 'confirmado'
    --    Al actualizar 'estado', el trigger tr_pedidos_audit_estado se dispara de forma atómica
    --    registrando la acción ADMIN_ORDER_CONFIRM con auth.uid() en public.audit_logs exactamente una vez.
    UPDATE public.pedidos
    SET estado = 'confirmado',
        motivo_admin = coalesce(p_motivo, motivo_admin),
        updated_at = now()
    WHERE id = p_pedido_id
    RETURNING * INTO v_updated_order;

    RETURN jsonb_build_object(
        'success', true,
        'already_confirmed', false,
        'pedido', row_to_json(v_updated_order)
    );
END;
$$;

-- Permisos de ejecución para confirmación transaccional
REVOKE ALL ON FUNCTION public.confirmar_pedido_administrativo_transaccional(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_pedido_administrativo_transaccional(uuid, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 9. TRIGGER DE INTEGRIDAD TRANSACCIONAL DE CUPOS (DEFENSA EN PROFUNDIDAD)
-- ------------------------------------------------------------------------------
-- Garantiza que NINGUNA ruta de inserción o actualización (incluyendo inserciones directas
-- legacy desde /api/pedidos o scripts administrativos) pueda sobrepasar la capacidad
-- de un turno de retiro de agenda sin control concurrente (FOR UPDATE).
CREATE OR REPLACE FUNCTION public.fn_pedidos_enforce_slot_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_slot record;
    v_slot_reservations integer;
BEGIN
    -- 1. Si no tiene slot_id asignado o se está cancelando el pedido, permitir inmediatamente
    IF NEW.slot_id IS NULL OR NEW.estado = 'cancelado' THEN
        RETURN NEW;
    END IF;

    -- 2. En UPDATE, si slot_id no cambió y el pedido ya no estaba cancelado, no recontar ni bloquear
    IF TG_OP = 'UPDATE' AND OLD.slot_id IS NOT DISTINCT FROM NEW.slot_id AND OLD.estado != 'cancelado' THEN
        RETURN NEW;
    END IF;

    -- 3. Bloqueo exclusivo sobre el slot para serializar todas las reservas concurrentes
    SELECT * INTO v_slot 
    FROM public.pickup_slots 
    WHERE id = NEW.slot_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SLOT_NOT_FOUND: El turno de retiro especificado no existe' USING ERRCODE = '22023';
    END IF;

    IF v_slot.status != 'active' THEN
        RAISE EXCEPTION 'SLOT_UNAVAILABLE: El turno de retiro seleccionado no se encuentra activo (estado: %)', v_slot.status USING ERRCODE = '22023';
    END IF;

    -- 4. Contar pedidos activos en este slot, excluyendo el propio pedido en caso de UPDATE
    SELECT count(*) INTO v_slot_reservations
    FROM public.pedidos
    WHERE slot_id = NEW.slot_id
      AND estado != 'cancelado'
      AND (TG_OP = 'INSERT' OR id != NEW.id);

    -- 5. Control estricto de capacidad (sobreturnos excepcionales deshabilitados en esta fase)
    IF v_slot_reservations >= v_slot.capacity THEN
        RAISE EXCEPTION 'SLOT_CAPACITY_EXCEEDED: No quedan cupos disponibles para el turno de retiro seleccionado (capacidad: %, reservados: %). La asignación de sobreturnos excepcionales se encuentra temporalmente deshabilitada.',
            v_slot.capacity, v_slot_reservations
            USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_pedidos_enforce_slot_capacity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pedidos_enforce_slot_capacity() TO authenticated, service_role;

DROP TRIGGER IF EXISTS tr_pedidos_enforce_slot_capacity ON public.pedidos;
CREATE TRIGGER tr_pedidos_enforce_slot_capacity
BEFORE INSERT OR UPDATE OF slot_id, estado ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION public.fn_pedidos_enforce_slot_capacity();
