-- ==============================================================================
-- ACIACAM APP — SPRINT 7B.4 (ETAPA 3.3)
-- Migración preparada: Ejecución con Autorización Delegada (Agent Core),
-- Canonicalización LPCP-v2, Checkout Transaccional de Socios y Blindaje PostgREST.
--
-- ADVERTENCIA OBLIGATORIA:
-- Este script ha sido preparado para revisión técnica y aprobación institucional.
-- NO APLICAR EN SUPABASE (PRODUCCIÓN NI INTEGRACIÓN) SIN PREVIA AUTORIZACIÓN.
-- Compatible con migraciones de Sprint 5 y Sprint 7B.3.
-- ==============================================================================

BEGIN;

-- Abort rather than reconcile an unknown prior installation.
DO $$ BEGIN
    IF to_regclass('public.action_grants') IS NOT NULL THEN
        RAISE EXCEPTION 'PREFLIGHT_ACTION_GRANTS_ALREADY_EXISTS';
    END IF;
    IF to_regprocedure('public.assert_order_actor(uuid,boolean)') IS NOT NULL
       OR to_regprocedure('public.assert_order_business(uuid,jsonb,text,text,text)') IS NOT NULL
       OR to_regprocedure('public.lpcp_frame(text)') IS NOT NULL
       OR to_regclass('public.idx_socios_order_actor_unique') IS NOT NULL THEN
        RAISE EXCEPTION 'PREFLIGHT_RESERVED_OBJECT_COLLISION';
    END IF;
    IF to_regprocedure('public.order_stock_quantities(jsonb)') IS NULL
       OR to_regprocedure('public.confirmar_pedido_administrativo_transaccional(uuid,text)') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.pedidos'::regclass
                     AND tgname='tr_pedidos_insert_stock' AND tgenabled IN ('O','A')
                     AND tgfoid=to_regprocedure('app_private.tr_check_and_deduct_stock_on_insert()'))
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.pedidos'::regclass
                     AND tgname='tr_pedidos_update_stock' AND tgenabled IN ('O','A')
                     AND tgfoid=to_regprocedure('app_private.tr_check_and_adjust_stock_on_update()'))
       OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.pedidos'::regclass AND relrowsecurity) THEN
        RAISE EXCEPTION 'PREFLIGHT_7B3_STOCK_DEPENDENCY_MISSING';
    END IF;
    IF EXISTS (SELECT 1 FROM public.socios WHERE auth_user_id IS NOT NULL
               GROUP BY auth_user_id HAVING count(*) <> 1) THEN
        RAISE EXCEPTION 'PREFLIGHT_AMBIGUOUS_IDENTITY';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_socios_order_actor_unique ON public.socios(auth_user_id) WHERE auth_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assert_order_actor(p_actor uuid,p_staff boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.socios; n integer;
BEGIN
    SELECT count(*) INTO n FROM public.socios WHERE auth_user_id=p_actor;
    IF p_actor IS NULL OR n<>1 THEN RAISE EXCEPTION 'ORDER_ACTOR_INVALID' USING ERRCODE='42501'; END IF;
    SELECT * INTO s FROM public.socios WHERE auth_user_id=p_actor FOR SHARE;
    IF s.status IS DISTINCT FROM 'active' OR s.bloqueado IS TRUE
       OR (p_staff AND coalesce(lower(btrim(s.rol)),'') NOT IN ('admin','staff')) THEN
        RAISE EXCEPTION 'ORDER_ACTOR_FORBIDDEN' USING ERRCODE='42501';
    END IF;
    RETURN s.id;
END $$;
REVOKE ALL ON FUNCTION public.assert_order_actor(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.assert_order_business(p_socio uuid,p_items jsonb,p_type text,p_address text,p_city text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.socios; i record; p public.products;
BEGIN
    IF p_type IS NULL OR p_type NOT IN ('delivery','retiro_sede') THEN RAISE EXCEPTION 'INVALID_ORDER_TYPE'; END IF;
    SELECT * INTO s FROM public.socios WHERE id=p_socio FOR SHARE;
    IF NOT FOUND OR s.status IS DISTINCT FROM 'active' OR s.bloqueado IS TRUE THEN RAISE EXCEPTION 'SOCIO_UNAVAILABLE'; END IF;
    IF p_type='delivery' AND (s.envios_habilitados IS DISTINCT FROM true
       OR coalesce(btrim(p_address),'')='' OR coalesce(btrim(p_city),'')='') THEN
        RAISE EXCEPTION 'DELIVERY_DISABLED_OR_ADDRESS_MISSING';
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'EMPTY_ITEMS'; END IF;
    FOR i IN SELECT * FROM public.order_stock_quantities(p_items) ORDER BY product_id LOOP
        -- Stock58 owns product locking after the slot lock; do not invert that order.
        SELECT * INTO p FROM public.products WHERE id=i.product_id;
        IF NOT FOUND OR p.activo IS DISTINCT FROM true THEN RAISE EXCEPTION 'PRODUCT_UNAVAILABLE'; END IF;
    END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.assert_order_business(uuid,jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

-- ------------------------------------------------------------------------------
-- 0. PREÁMBULO DDL: COLUMNAS E ÍNDICES DE IDEMPOTENCIA Y AUDITORÍA EN PUBLIC.PEDIDOS
-- ------------------------------------------------------------------------------
-- Garantiza que las columnas requeridas por las RPCs existan en la tabla pedidos
-- de forma puramente incremental, idempotente y retrocompatible.
ALTER TABLE public.pedidos
ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_idempotency_key
ON public.pedidos (idempotency_key)
WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.pedidos
ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.pedidos
ADD COLUMN IF NOT EXISTS idempotency_payload_hash text;

ALTER TABLE public.pedidos
ADD COLUMN IF NOT EXISTS motivo_admin text;
-- 1. FUNCIÓN DE CANONICALIZACIÓN CON LONGITUD PREFIJADA (LPCP-v2)
-- ------------------------------------------------------------------------------
-- Formato determinista: "<octet_length>:<text>;" compatible bit-a-bit con TypeScript
CREATE OR REPLACE FUNCTION public.lpcp_frame(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT octet_length(s)::text || ':' || s || ';' FROM (
      SELECT normalize(btrim(coalesce(p_text,''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), NFC) AS s
    ) AS t;
$$;

-- ------------------------------------------------------------------------------
-- 2. TABLA DDL DE PERSISTENCIA DE ACTION GRANTS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.action_grants (
    grant_id uuid PRIMARY KEY,
    operator_auth_user_id uuid NOT NULL REFERENCES auth.users(id),
    target_socio_id uuid NOT NULL REFERENCES public.socios(id),
    action text NOT NULL DEFAULT 'execute_order' CHECK(action='execute_order'),
    approved_payload_hash text NOT NULL CHECK(approved_payload_hash ~ '^[0-9a-f]{64}$'),
    idempotency_key uuid NOT NULL,
    status text NOT NULL CHECK (status IN ('issued', 'executed', 'revoked')),
    pedido_id uuid REFERENCES public.pedidos(id),
    execution_result jsonb,
    error_detail text,
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    executed_at timestamptz,
    revoked_at timestamptz,
    revoked_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
    ,correlation_id uuid NOT NULL DEFAULT gen_random_uuid()
    ,CHECK(expires_at>issued_at AND expires_at-issued_at<=interval '120 seconds')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_action_grants_idempotency_key
ON public.action_grants(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_action_grants_status_expires
ON public.action_grants(status, expires_at);

-- BLINDAJE CONTRA EXPOSICIÓN POSTGREST:
-- Habilitar RLS estricto y revocar acceso público, anónimo y autenticado
ALTER TABLE public.action_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.action_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.action_grants TO service_role;

-- ------------------------------------------------------------------------------
-- 3. RPC TRANSACCIONAL DE EJECUCIÓN CON AUTORIZACIÓN DELEGADA (PRIVILEGIADA)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ejecutar_pedido_con_autorizacion_delegada(
    p_grant_id uuid,
    p_idempotency_key uuid,
    p_socio_id uuid,
    p_items jsonb,
    p_tipo_pedido text,
    p_motivo text,
    p_direccion_entrega text DEFAULT NULL,
    p_localidad text DEFAULT NULL,
    p_fecha_retiro text DEFAULT NULL,
    p_franja_horaria text DEFAULT NULL,
    p_slot_id uuid DEFAULT NULL,
    p_observaciones text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_grant record;
    v_operator record;
    v_target_socio record;
    v_new_order record;
    v_item record;
    v_prod record;
    v_slot record;
    v_slot_reservations integer;
    v_consolidated_items jsonb := '[]'::jsonb;
    v_consolidated_items_str text := '';
    v_canonical_string text;
    v_computed_hash text;
    v_previous_sub text := current_setting('request.jwt.claim.sub',true);
    v_previous_role text := current_setting('request.jwt.claim.role',true);
BEGIN
    -- 1. Serializar accesos concurrentes sobre este grant_id
    PERFORM pg_advisory_xact_lock(hashtextextended(p_grant_id::text, 0));

    -- 2. Bloquear la fila del grant para lectura/escritura atómica
    SELECT * INTO v_grant
    FROM public.action_grants
    WHERE grant_id = p_grant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'GRANT_NOT_FOUND: El ticket de autorización delegada no existe' USING ERRCODE = '22023';
    END IF;
    IF v_grant.action <> 'execute_order' OR p_idempotency_key IS DISTINCT FROM v_grant.idempotency_key THEN
        RAISE EXCEPTION 'GRANT_SCOPE_MISMATCH' USING ERRCODE='42501';
    END IF;

    -- 3. Consolidación determinista de ítems
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'EMPTY_ITEMS: El pedido debe contener al menos un producto' USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'productoId', sub.prod_id::text,
            'cantidad', sub.total_qty
        ) ORDER BY sub.prod_id
    ), '[]'::jsonb),
    coalesce(string_agg(
        sub.prod_id::text || ':' || sub.total_qty::text,
        ',' ORDER BY sub.prod_id
    ), '')
    INTO v_consolidated_items, v_consolidated_items_str
    FROM (
        SELECT
            (coalesce(x->>'productoId', x->>'id'))::uuid AS prod_id,
            sum((coalesce(x->>'cantidad', x->>'quantity'))::bigint) AS total_qty
        FROM jsonb_array_elements(p_items) AS x
        GROUP BY (coalesce(x->>'productoId', x->>'id'))::uuid
    ) AS sub;

    -- 4. Construcción de huella canónica determinista (LPCP-v2)
    v_canonical_string :=
        public.lpcp_frame('LPCP-v2') ||
        public.lpcp_frame(v_grant.operator_auth_user_id::text) ||
        public.lpcp_frame(p_socio_id::text) ||
        public.lpcp_frame(lower(btrim(p_tipo_pedido))) ||
        public.lpcp_frame(v_consolidated_items_str) ||
        public.lpcp_frame(btrim(coalesce(p_motivo, ''))) ||
        public.lpcp_frame(coalesce(CASE WHEN p_tipo_pedido = 'delivery' THEN p_direccion_entrega ELSE '' END, '')) ||
        public.lpcp_frame(coalesce(CASE WHEN p_tipo_pedido = 'delivery' THEN p_localidad ELSE '' END, '')) ||
        public.lpcp_frame(btrim(coalesce(CASE WHEN lower(btrim(p_tipo_pedido)) = 'retiro_sede' THEN p_fecha_retiro ELSE '' END, ''))) ||
        public.lpcp_frame(btrim(coalesce(CASE WHEN lower(btrim(p_tipo_pedido)) = 'retiro_sede' THEN p_franja_horaria ELSE '' END, ''))) ||
        public.lpcp_frame(coalesce(p_slot_id::text, '')) ||
        public.lpcp_frame(btrim(coalesce(p_observaciones, '')));

    v_computed_hash := encode(sha256(convert_to(v_canonical_string, 'UTF8')), 'hex');

    -- 5. INTEGRIDAD DE PARÁMETROS OBLIGATORIA (Evaluada SIEMPRE, incluso en recuperaciones)
    IF v_computed_hash IS DISTINCT FROM v_grant.approved_payload_hash THEN
        RAISE EXCEPTION 'PAYLOAD_HASH_MISMATCH: Los parámetros recibidos difieren de los autorizados en el grant' USING ERRCODE = '22023';
    END IF;

    IF p_socio_id IS DISTINCT FROM v_grant.target_socio_id THEN
        RAISE EXCEPTION 'SOCIO_MISMATCH: El socio destinatario difiere del aprobado en el grant' USING ERRCODE = '22023';
    END IF;

    -- 6. CONTROL DE REVOCACIÓN PREVIA O POSTERIOR
    -- Una autorización revocada NO permite nuevas ejecuciones ni revela IDs de pedidos previos.
    -- Los pedidos ya ejecutados conservan su historial y deben ser consultados mediante endpoints
    -- autenticados de pedidos (/api/pedidos o /api/admin/pedidos/[id]), no a través de un grant revocado.
    IF v_grant.status = 'revoked' OR v_grant.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'GRANT_REVOKED: El ticket de autorización delegada fue revocado (%s)',
            coalesce(v_grant.revoked_reason, 'Sin motivo especificado') USING ERRCODE = '42501';
    END IF;

    -- 7. RECUPERACIÓN DE GRANT YA EJECUTADO (Incluso después de vencido now() > v_grant.expires_at)
    IF v_grant.status = 'executed' THEN
        IF v_grant.idempotency_key IS DISTINCT FROM p_idempotency_key THEN
            RAISE EXCEPTION 'GRANT_ALREADY_CONSUMED: El ticket de autorización delegada ya fue consumido por otra operación con distinta clave' USING ERRCODE = '23505';
        END IF;

        SELECT * INTO v_new_order
        FROM public.pedidos
        WHERE id = v_grant.pedido_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'ORDER_NOT_FOUND: El pedido original asociado a este grant (%) no fue encontrado en la base de datos', v_grant.pedido_id USING ERRCODE = '22023';
        END IF;

        IF v_new_order.socio_id IS DISTINCT FROM v_grant.target_socio_id THEN
            RAISE EXCEPTION 'ORDER_SOCIO_MISMATCH: Inconsistencia crítica: el pedido existente pertenece a un socio distinto al autorizado' USING ERRCODE = '22023';
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'deduplicated', true,
            'pedido_id', v_grant.pedido_id,
            'idempotency_key', p_idempotency_key,
            'execution_result', v_grant.execution_result,
            'pedido', row_to_json(v_new_order)
        );
    END IF;

    -- 8. CONTROL DE EXPIRACIÓN ESTRICTA PARA NUEVA EJECUCIÓN
    IF clock_timestamp() >= v_grant.expires_at OR clock_timestamp() < v_grant.issued_at THEN
        RAISE EXCEPTION 'GRANT_EXPIRED: El ticket de autorización delegada ha expirado a las %', v_grant.expires_at USING ERRCODE = '42501';
    END IF;

    PERFORM public.assert_order_actor(v_grant.operator_auth_user_id,true);
    PERFORM public.assert_order_business(p_socio_id,v_consolidated_items,p_tipo_pedido,p_direccion_entrega,p_localidad);
    -- 9. VERIFICACIÓN DEL OPERADOR EN TIEMPO DE EJECUCIÓN
    SELECT s.id, lower(btrim(s.rol)) as rol, s.status, s.bloqueado
    INTO v_operator
    FROM public.socios AS s
    WHERE s.auth_user_id = v_grant.operator_auth_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'OPERATOR_NOT_FOUND: El operador no existe en la nómina de socios' USING ERRCODE = '42501';
    END IF;

    IF v_operator.bloqueado = true THEN
        RAISE EXCEPTION 'OPERATOR_REVOKED: El operador se encuentra bloqueado administrativamente' USING ERRCODE = '42501';
    END IF;

    IF v_operator.status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'OPERATOR_REVOKED: El operador no se encuentra activo (estado: %)', v_operator.status USING ERRCODE = '42501';
    END IF;

    IF v_operator.rol NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'OPERATOR_NOT_PERMITTED: El operador carece de rol administrativo (rol: %)', v_operator.rol USING ERRCODE = '42501';
    END IF;

    -- 10. Validar socio destinatario en base de datos
    SELECT * INTO v_target_socio FROM public.socios WHERE id = p_socio_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SOCIO_NOT_FOUND: Socio destinatario no encontrado' USING ERRCODE = '22023';
    END IF;
    IF v_target_socio.status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'STATUS_INACTIVE: El socio no se encuentra en estado activo' USING ERRCODE = '22023';
    END IF;
    IF v_target_socio.bloqueado = true THEN
        RAISE EXCEPTION 'SOCIO_BLOCKED: Socio destinatario bloqueado' USING ERRCODE = '22023';
    END IF;

    -- 10.1 Control transaccional de cupos de retiro (pickup_slots con bloqueo FOR UPDATE)
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
            RAISE EXCEPTION 'SLOT_CAPACITY_EXCEEDED: No quedan cupos disponibles para el turno de retiro seleccionado (capacidad: %, reservados: %)',
                v_slot.capacity, v_slot_reservations USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Slot first, then products in Stock58 UUID order. Freeze approved catalogue data.
    PERFORM 1 FROM public.products WHERE id IN (SELECT product_id FROM public.order_stock_quantities(v_consolidated_items)) ORDER BY id FOR UPDATE;
    IF public.order_catalogue_hash(v_consolidated_items) IS DISTINCT FROM v_grant.approved_catalogue_hash THEN
        RAISE EXCEPTION 'APPROVED_CATALOGUE_CHANGED' USING ERRCODE='22023';
    END IF;
    IF clock_timestamp() >= v_grant.expires_at THEN
        RAISE EXCEPTION 'GRANT_EXPIRED' USING ERRCODE='42501';
    END IF;
    -- 11. Contextualizar auth.uid() en la transacción
    PERFORM set_config('request.jwt.claim.sub', v_grant.operator_auth_user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    -- 12. Insertar pedido preservando al operador humano real
    INSERT INTO public.pedidos (
        socio_id,
        items,
        tipo_pedido,
        origen,
        estado,
        idempotency_key,
        created_by_user_id,
        idempotency_payload_hash,
        motivo_admin,
        direccion_entrega,
        localidad,
        fecha_retiro_preferida,
        franja_horaria,
        slot_id,
        observaciones
    ) VALUES (
        p_socio_id,
        v_consolidated_items,
        p_tipo_pedido,
        'admin',
        'pendiente',
        p_idempotency_key,
        v_grant.operator_auth_user_id,
        v_computed_hash,
        p_motivo,
        CASE WHEN lower(btrim(p_tipo_pedido)) = 'delivery' THEN p_direccion_entrega ELSE NULL END,
        CASE WHEN lower(btrim(p_tipo_pedido)) = 'delivery' THEN p_localidad ELSE NULL END,
        CASE WHEN lower(btrim(p_tipo_pedido)) = 'retiro_sede' THEN p_fecha_retiro ELSE NULL END,
        CASE WHEN lower(btrim(p_tipo_pedido)) = 'retiro_sede' THEN p_franja_horaria ELSE NULL END,
        p_slot_id,
        p_observaciones
    )
    RETURNING * INTO v_new_order;

    -- 13. Registrar en audit_logs
    INSERT INTO public.audit_logs (
        user_id,
        actor_socio_id,
        action,
        entity_type,
        entity_id,
        details,
        created_at
    ) VALUES (
        v_grant.operator_auth_user_id,
        v_operator.id,
        'AGENT_DELEGATED_ORDER_EXECUTION',
        'pedidos',
        v_new_order.id::text,
        jsonb_build_object(
            'grant_id', p_grant_id,
            'idempotency_key', p_idempotency_key,
            'socio_id', p_socio_id,
            'items', v_consolidated_items,
            'tipo_pedido', p_tipo_pedido,
            'created_by_user_id', v_grant.operator_auth_user_id,
            'executed_via', 'PedidosTool',
            'correlation_id', v_grant.correlation_id
        ),
        now()
    );

    -- 14. Actualizar estado del grant a 'executed'
    UPDATE public.action_grants
    SET status = 'executed',
        pedido_id = v_new_order.id,
        execution_result = jsonb_build_object(
            'pedido_id', v_new_order.id,
            'estado', v_new_order.estado,
            'deduplicated', false
        ),
        executed_at = now(),
        updated_at = now()
    WHERE grant_id = p_grant_id;

    PERFORM set_config('request.jwt.claim.sub',coalesce(v_previous_sub,''),true);
    PERFORM set_config('request.jwt.claim.role',coalesce(v_previous_role,''),true);

    RETURN jsonb_build_object(
        'success', true,
        'deduplicated', false,
        'pedido_id', v_new_order.id,
        'estado', v_new_order.estado,
        'idempotency_key', p_idempotency_key,
        'pedido', row_to_json(v_new_order)
    );
END;
$$;

-- Permisos mínimos: Denegado a PostgREST directo (anon/authenticated)
REVOKE ALL ON FUNCTION public.ejecutar_pedido_con_autorizacion_delegada(uuid, uuid, uuid, jsonb, text, text, text, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ejecutar_pedido_con_autorizacion_delegada(uuid, uuid, uuid, jsonb, text, text, text, text, text, text, uuid, text) TO service_role;

-- ------------------------------------------------------------------------------
-- 4. RPC TRANSACCIONAL DE CHECKOUT DE SOCIOS (STAGE 3.3)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_pedido_socio_transaccional(
    p_idempotency_key uuid,
    p_items jsonb,
    p_tipo_pedido text,
    p_direccion_entrega text DEFAULT NULL,
    p_localidad text DEFAULT NULL,
    p_fecha_retiro text DEFAULT NULL,
    p_franja_horaria text DEFAULT NULL,
    p_slot_id uuid DEFAULT NULL,
    p_observaciones text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_user_id uuid := auth.uid();
    v_socio record;
    v_slot record;
    v_slot_reservations integer;
    v_existing_order record;
    v_new_order record;
    v_item record;
    v_prod record;
    v_qty_numeric numeric;
    v_consolidated_items jsonb := '[]'::jsonb;
    v_consolidated_items_str text := '';
    v_canonical_string text;
    v_computed_hash text;
BEGIN
    -- 1. Autenticar socio (JWT real obligatorio)
    IF v_actor_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Sesión no autenticada' USING ERRCODE = '42501';
    END IF;
    PERFORM public.assert_order_actor(v_actor_user_id,false);

    -- 2. Resolver socio titular
    SELECT * INTO v_socio
    FROM public.socios
    WHERE auth_user_id = v_actor_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SOCIO_NOT_FOUND: Socio no registrado' USING ERRCODE = '42501';
    END IF;

    IF v_socio.bloqueado = true THEN
        RAISE EXCEPTION 'SOCIO_BLOCKED: Operación no permitida: socio bloqueado. %', coalesce(v_socio.motivo_bloqueo, 'Consulte con administración.') USING ERRCODE = '22023';
    END IF;

    IF v_socio.status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'STATUS_INACTIVE: Operación no permitida: el socio no se encuentra en estado activo' USING ERRCODE = '22023';
    END IF;

    -- 3. Validar estructura de la solicitud
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY: Clave de idempotencia obligatoria para checkout de socios' USING ERRCODE = '22023';
    END IF;

    IF p_tipo_pedido NOT IN ('retiro_sede', 'delivery') THEN
        RAISE EXCEPTION 'INVALID_ORDER_TYPE: El tipo de pedido debe ser retiro_sede o delivery' USING ERRCODE = '22023';
    END IF;

    IF p_tipo_pedido = 'delivery' THEN
        IF v_socio.envios_habilitados IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'DELIVERY_DISABLED: Operación no permitida: los envíos a domicilio no están habilitados para este socio' USING ERRCODE = '22023';
        END IF;
        IF p_direccion_entrega IS NULL OR length(btrim(p_direccion_entrega)) = 0
           OR p_localidad IS NULL OR length(btrim(p_localidad)) = 0 THEN
            RAISE EXCEPTION 'MISSING_DELIVERY_ADDRESS: Dirección y localidad obligatorias para modalidad delivery' USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'EMPTY_ITEMS: El pedido debe contener al menos un producto' USING ERRCODE = '22023';
    END IF;

    -- Validar formato estructural y cuantitativo de cada ítem
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

        BEGIN
            v_qty_numeric := (coalesce(v_item.value->>'cantidad', v_item.value->>'quantity'))::numeric;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'INVALID_QUANTITY: La cantidad debe ser un número entero mayor a cero' USING ERRCODE = '22023';
        END;

        IF v_qty_numeric <= 0
           OR v_qty_numeric > 2147483647
           OR v_qty_numeric <> trunc(v_qty_numeric)
           OR (coalesce(v_item.value->>'cantidad', v_item.value->>'quantity'))::text IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION 'INVALID_QUANTITY: Cada producto debe tener una cantidad entera mayor a cero' USING ERRCODE = '22023';
        END IF;
    END LOOP;

    -- Consolidación determinista de ítems
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'productoId', sub.prod_id::text,
            'cantidad', sub.total_qty
        ) ORDER BY sub.prod_id
    ), '[]'::jsonb),
    coalesce(string_agg(
        sub.prod_id::text || ':' || sub.total_qty::text,
        ',' ORDER BY sub.prod_id
    ), '')
    INTO v_consolidated_items, v_consolidated_items_str
    FROM (
        SELECT
            (coalesce(x->>'productoId', x->>'id'))::uuid AS prod_id,
            sum((coalesce(x->>'cantidad', x->>'quantity'))::bigint) AS total_qty
        FROM jsonb_array_elements(p_items) AS x
        GROUP BY (coalesce(x->>'productoId', x->>'id'))::uuid
    ) AS sub;

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_consolidated_items) LOOP
        IF (v_item.value->>'cantidad')::bigint > 2147483647 THEN
            RAISE EXCEPTION 'ORDER_QUANTITY_INVALID: La cantidad total consolidada excede el límite permitido' USING ERRCODE = '22023';
        END IF;
    END LOOP;

    -- 4. Adquirir advisory lock transaccional de idempotencia
    PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

    -- 5. Construir huella canónica determinista LPCP-v2-SOCIO
    v_canonical_string :=
        public.lpcp_frame('LPCP-v2-SOCIO') ||
        public.lpcp_frame(v_socio.id::text) ||
        public.lpcp_frame(lower(btrim(p_tipo_pedido))) ||
        public.lpcp_frame(v_consolidated_items_str) ||
        public.lpcp_frame(coalesce(CASE WHEN p_tipo_pedido = 'delivery' THEN p_direccion_entrega ELSE '' END, '')) ||
        public.lpcp_frame(coalesce(CASE WHEN p_tipo_pedido = 'delivery' THEN p_localidad ELSE '' END, '')) ||
        public.lpcp_frame(btrim(coalesce(CASE WHEN lower(btrim(p_tipo_pedido)) = 'retiro_sede' THEN p_fecha_retiro ELSE '' END, ''))) ||
        public.lpcp_frame(btrim(coalesce(CASE WHEN lower(btrim(p_tipo_pedido)) = 'retiro_sede' THEN p_franja_horaria ELSE '' END, ''))) ||
        public.lpcp_frame(coalesce(p_slot_id::text, '')) ||
        public.lpcp_frame(btrim(coalesce(p_observaciones, '')));

    v_computed_hash := encode(sha256(convert_to(v_canonical_string, 'UTF8')), 'hex');

    -- 6. Buscar pedido existente con la misma clave de idempotencia
    SELECT * INTO v_existing_order
    FROM public.pedidos
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
        -- CERO FUGA DE DATOS INTER-SOCIO:
        IF v_existing_order.socio_id IS DISTINCT FROM v_socio.id THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Clave de idempotencia ya utilizada' USING ERRCODE = '23505';
        END IF;

        -- DETECCIÓN DE CONFLICTO DE PARÁMETROS:
        IF v_existing_order.idempotency_payload_hash IS DISTINCT FROM v_computed_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Clave de idempotencia ya utilizada con diferentes parámetros' USING ERRCODE = '23505';
        END IF;

        -- RECUPERACIÓN TRANSPARENTE TRAS TIMEOUT:
        RETURN jsonb_build_object(
            'success', true,
            'deduplicated', true,
            'pedido', row_to_json(v_existing_order)
        );
    END IF;

    PERFORM public.assert_order_business(v_socio.id,v_consolidated_items,p_tipo_pedido,p_direccion_entrega,p_localidad);
    -- 7. Validar catálogo
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

    -- 7.1 Control transaccional de cupos de retiro (pickup_slots con bloqueo FOR UPDATE)
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
            RAISE EXCEPTION 'SLOT_CAPACITY_EXCEEDED: No quedan cupos disponibles para el turno de retiro seleccionado (capacidad: %, reservados: %)',
                v_slot.capacity, v_slot_reservations USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 8. Insertar pedido con origen 'app'
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
        created_by_user_id,
        idempotency_payload_hash
    ) VALUES (
        v_socio.id,
        v_consolidated_items,
        p_tipo_pedido,
        'app',
        'pendiente',
        p_observaciones,
        CASE WHEN lower(btrim(p_tipo_pedido)) = 'delivery' THEN p_direccion_entrega ELSE NULL END,
        CASE WHEN lower(btrim(p_tipo_pedido)) = 'delivery' THEN p_localidad ELSE NULL END,
        CASE WHEN lower(btrim(p_tipo_pedido)) = 'retiro_sede' THEN p_fecha_retiro ELSE NULL END,
        CASE WHEN lower(btrim(p_tipo_pedido)) = 'retiro_sede' THEN p_franja_horaria ELSE NULL END,
        p_slot_id,
        p_idempotency_key,
        v_actor_user_id,
        v_computed_hash
    )
    RETURNING * INTO v_new_order;

    -- 9. Registrar auditoría
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
        v_socio.id,
        'SOCIO_CHECKOUT_ORDER_CREATED',
        'pedidos',
        v_new_order.id::text,
        jsonb_build_object(
            'idempotency_key', p_idempotency_key,
            'tipo_pedido', p_tipo_pedido,
            'items_count', jsonb_array_length(v_consolidated_items),
            'created_by_user_id', v_actor_user_id
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'deduplicated', false,
        'pedido', row_to_json(v_new_order)
    );
END;
$$;

-- Permisos checkout socios: Solo authenticated, revocado a anon
REVOKE ALL ON FUNCTION public.crear_pedido_socio_transaccional(uuid, jsonb, text, text, text, text, text, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crear_pedido_socio_transaccional(uuid, jsonb, text, text, text, text, text, uuid, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. SINCRONIZACIÓN Y BLINDAJE DE RPC ADMINISTRATIVA (Sprint 7B.3 / 7B.4)
-- ------------------------------------------------------------------------------
-- Incorpora validación y control transaccional de cupos de retiro (FOR UPDATE)
-- y control estricto de sobreturnos administrativos autorizados (p_es_sobreturno).
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

    PERFORM public.assert_order_actor(v_actor_user_id,true);
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

    -- Consolidación de ítems: Agrupar productos repetidos, sumar cantidades y ordenar determinísticamente
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

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_consolidated_items) LOOP
        IF (v_item.value->>'cantidad')::bigint > 2147483647 THEN
            RAISE EXCEPTION 'ORDER_QUANTITY_INVALID: La cantidad total consolidada excede el límite permitido' USING ERRCODE = '22023';
        END IF;
    END LOOP;

    -- 3. Adquirir el advisory lock de idempotencia (serialización concurrente)
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
    END IF;

    -- 4. Construir huella canónica determinista
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

    -- 5. Deduplicación temprana por clave de idempotencia
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing_order
        FROM public.pedidos
        WHERE idempotency_key = p_idempotency_key
        LIMIT 1;

        IF FOUND THEN
            IF v_existing_order.created_by_user_id IS DISTINCT FROM v_actor_user_id THEN
                RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Clave de idempotencia ya utilizada' USING ERRCODE = '23505';
            END IF;

            IF v_existing_order.idempotency_payload_hash IS DISTINCT FROM v_hash THEN
                RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Clave de idempotencia ya utilizada con diferentes parámetros' USING ERRCODE = '23505';
            END IF;

            RETURN jsonb_build_object(
                'success', true,
                'deduplicated', true,
                'pedido', row_to_json(v_existing_order)
            );
        END IF;
    END IF;

    -- 6. Validar socio destinatario
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

    PERFORM public.assert_order_business(p_socio_id,v_consolidated_items,p_tipo_pedido,p_direccion_entrega,p_localidad);
    -- Validar catálogo
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

    -- Validar turno y cupos transaccionales (pickup_slots FOR UPDATE)
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

    -- Insertar pedido
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

    -- Registrar auditoría
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

REVOKE ALL ON FUNCTION public.crear_pedido_administrativo_transaccional(uuid, jsonb, text, text, uuid, text, text, text, text, text, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crear_pedido_administrativo_transaccional(uuid, jsonb, text, text, uuid, text, text, text, text, text, uuid, boolean) TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. TRIGGER DE INTEGRIDAD TRANSACCIONAL DE CUPOS (DEFENSA EN PROFUNDIDAD)
-- ------------------------------------------------------------------------------
-- Garantiza que NINGUNA ruta de inserción o actualización (incluso inserciones directas
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

COMMIT;
