-- CIE-01C M3: Puente atómico SEC-01/UX-04 -> aciacam_cc (activo solo si aciacam_cc.config.enabled = true)
-- + RPCs de cierres por período idempotentes y consulta de estado de cuenta corriente
BEGIN;

-- 1. Sincronización atómica e idempotente de entrega/pagos hacia aciacam_cc (anti-duplicación vía legacy_pago_id)
CREATE OR REPLACE FUNCTION app_private.sync_order_delivery_to_cc(
    p_command_id uuid,
    p_order_id uuid,
    p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, aciacam_cc
AS $$
DECLARE
    v_enabled boolean := false;
    v_order public.pedidos%ROWTYPE;
    v_expected_centavos bigint;
    v_line integer := 1;
    v_pago record;
    v_aporte_id uuid;
    v_cargo_exists boolean;
BEGIN
    SELECT enabled INTO v_enabled FROM aciacam_cc.config WHERE singleton = true;
    IF NOT COALESCE(v_enabled, false) THEN
        RETURN;
    END IF;

    SELECT * INTO v_order FROM public.pedidos WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.socio_id IS NULL THEN
        RETURN;
    END IF;

    v_expected_centavos := GREATEST(0, round(COALESCE(v_order.total, 0) * 100)::bigint);

    INSERT INTO aciacam_cc.cuentas_pedido (pedido_id, socio_id, esperado_centavos, fundamento, created_by)
    VALUES (
        p_order_id,
        v_order.socio_id,
        v_expected_centavos,
        jsonb_build_object('source', 'confirm_order_payment_command', 'total_ars', COALESCE(v_order.total, 0), 'items', COALESCE(v_order.items, '[]'::jsonb)),
        p_actor_id
    )
    ON CONFLICT (pedido_id) DO NOTHING;

    SELECT EXISTS (SELECT 1 FROM aciacam_cc.movimientos WHERE pedido_id = p_order_id AND tipo = 'cargo')
    INTO v_cargo_exists;

    IF v_expected_centavos > 0 AND NOT v_cargo_exists THEN
        INSERT INTO aciacam_cc.movimientos (pedido_id, socio_id, tipo, signo, centavos, motivo, command_id, linea, created_by)
        VALUES (p_order_id, v_order.socio_id, 'cargo', 1, v_expected_centavos, 'Cargo por entrega de pedido #' || left(p_order_id::text, 8), p_command_id, 0, p_actor_id)
        ON CONFLICT (command_id, linea) DO NOTHING;
    END IF;

    -- Enlazar cada pago registrado en public.pagos para este pedido sin duplicar (legacy_pago_id UNIQUE)
    FOR v_pago IN
        SELECT pg.*
        FROM public.pagos pg
        WHERE pg.pedido_id = p_order_id
          AND pg.monto > 0
          AND NOT EXISTS (SELECT 1 FROM aciacam_cc.aportes a WHERE a.legacy_pago_id = pg.id)
        ORDER BY pg.created_at, pg.id
    LOOP
        INSERT INTO aciacam_cc.aportes (pedido_id, socio_id, legacy_pago_id, centavos, medio, referencia, created_by)
        VALUES (
            p_order_id,
            v_order.socio_id,
            v_pago.id,
            round(v_pago.monto * 100)::bigint,
            CASE
                WHEN lower(btrim(COALESCE(v_pago.medio_de_pago, ''))) IN ('efectivo', 'transferencia_galicia', 'transferencia', 'mercadopago')
                    THEN lower(btrim(v_pago.medio_de_pago))
                WHEN lower(btrim(COALESCE(v_pago.medio_de_pago, ''))) LIKE '%galicia%' THEN 'transferencia_galicia'
                WHEN lower(btrim(COALESCE(v_pago.medio_de_pago, ''))) LIKE '%mercadopago%' THEN 'mercadopago'
                WHEN lower(btrim(COALESCE(v_pago.medio_de_pago, ''))) LIKE '%transfer%' THEN 'transferencia'
                ELSE 'efectivo'
            END,
            v_pago.referencia,
            COALESCE(v_pago.created_by, p_actor_id)
        )
        ON CONFLICT (legacy_pago_id) DO NOTHING
        RETURNING id INTO v_aporte_id;

        IF v_aporte_id IS NOT NULL THEN
            INSERT INTO aciacam_cc.movimientos (pedido_id, socio_id, tipo, signo, centavos, motivo, command_id, linea, pago_id, created_by)
            VALUES (
                p_order_id,
                v_order.socio_id,
                'pago',
                -1,
                round(v_pago.monto * 100)::bigint,
                COALESCE(nullif(btrim(v_pago.concepto), ''), 'Aporte registrado en entrega'),
                p_command_id,
                v_line,
                v_aporte_id,
                COALESCE(v_pago.created_by, p_actor_id)
            )
            ON CONFLICT (command_id, linea) DO NOTHING;
            v_line := v_line + 1;
        END IF;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION app_private.sync_order_delivery_to_cc(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 2. Actualizar confirm_order_payment_command preservando firma, seguridad y comportamiento UX-04.1/SEC-01
CREATE OR REPLACE FUNCTION public.confirm_order_payment_command(
    p_command_id uuid,
    p_order_id uuid,
    p_target_status text,
    p_payments jsonb,
    p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_count bigint;
    v_role text;
    v_hash text;
    v_existing public.order_payment_commands%ROWTYPE;
    v_order public.pedidos%ROWTYPE;
    v_payments jsonb := coalesce(p_payments, '[]'::jsonb);
    v_result jsonb;
BEGIN
    IF v_actor IS NULL OR (p_actor_id IS NOT NULL AND p_actor_id <> v_actor) THEN
        RAISE EXCEPTION 'PAYMENT_ACTOR_UNAUTHORIZED' USING ERRCODE = '42501';
    END IF;

    SELECT count(*), max(lower(btrim(s.rol))) INTO v_count, v_role
    FROM public.socios AS s
    WHERE s.auth_user_id = v_actor
      AND s.status = 'active'
      AND s.bloqueado IS NOT TRUE;

    IF v_count <> 1 OR v_role IS NULL OR v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'PAYMENT_ROLE_UNAUTHORIZED' USING ERRCODE = '42501';
    END IF;

    IF p_command_id IS NULL OR p_order_id IS NULL
       OR p_target_status IS NULL OR p_target_status NOT IN ('entregado', 'retirado') THEN
        RAISE EXCEPTION 'PAYMENT_COMMAND_INVALID' USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_payments) <> 'array' THEN
        RAISE EXCEPTION 'PAYMENT_PAYLOAD_INVALID' USING ERRCODE = '22023';
    END IF;

    v_hash := encode(sha256(convert_to(jsonb_build_object(
        'order_id', p_order_id,
        'actor_id', v_actor,
        'target_status', p_target_status,
        'payments', v_payments
    )::text, 'UTF8')), 'hex');

    PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 0));

    SELECT * INTO v_existing
    FROM public.order_payment_commands AS c
    WHERE c.command_id = p_command_id;

    IF FOUND THEN
        IF v_existing.actor_id <> v_actor
           OR v_existing.order_id <> p_order_id
           OR v_existing.payload_hash <> v_hash THEN
            RAISE EXCEPTION 'PAYMENT_COMMAND_CONFLICT' USING ERRCODE = '22023';
        END IF;
        RETURN v_existing.result || jsonb_build_object('command_id', p_command_id, 'reused', true);
    END IF;

    SELECT * INTO v_order
    FROM public.pedidos AS p
    WHERE p.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND' USING ERRCODE = '22023';
    END IF;

    IF v_order.estado IN ('entregado', 'retirado', 'cancelado') THEN
        RAISE EXCEPTION 'PAYMENT_ORDER_ALREADY_FINALIZED' USING ERRCODE = '22023';
    END IF;

    IF p_target_status = 'retirado' AND v_order.tipo_pedido <> 'retiro_sede' THEN
        RAISE EXCEPTION 'INVALID_ORDER_TYPE_FOR_STATUS: Un pedido "%" debe finalizar en "entregado", no en "retirado".', v_order.tipo_pedido
            USING ERRCODE = '22023';
    END IF;

    IF p_target_status = 'entregado' AND v_order.tipo_pedido <> 'delivery' THEN
        RAISE EXCEPTION 'INVALID_ORDER_TYPE_FOR_STATUS: Un pedido "%" debe finalizar en "retirado", no en "entregado".', v_order.tipo_pedido
            USING ERRCODE = '22023';
    END IF;

    IF v_order.estado IN ('pendiente', 'en_preparacion') THEN
        UPDATE public.pedidos
        SET estado = 'confirmado',
            updated_at = clock_timestamp()
        WHERE id = p_order_id;

        INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details, created_at)
        VALUES (
            v_actor, 'UPDATE', 'ORDER', p_order_id::text,
            jsonb_build_object('previous_status', v_order.estado, 'new_status', 'confirmado', 'via', 'direct_delivery_auto_confirm'),
            clock_timestamp()
        );
    END IF;

    v_result := public.confirm_order_and_payments(p_order_id, p_target_status, v_payments, v_actor);
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'PAYMENT_CONFIRMATION_FAILED';
    END IF;

    -- Sincronización con libro inmutable (no-op si aciacam_cc.config.enabled = false)
    PERFORM app_private.sync_order_delivery_to_cc(p_command_id, p_order_id, v_actor);

    INSERT INTO public.order_payment_commands(command_id, order_id, actor_id, payload_hash, result)
    VALUES (p_command_id, p_order_id, v_actor, v_hash, v_result);

    RETURN v_result || jsonb_build_object('command_id', p_command_id, 'reused', false);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_order_payment_command(uuid,uuid,text,jsonb,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_order_payment_command(uuid,uuid,text,jsonb,uuid) TO authenticated;

-- 3. RPCs de consulta de cuenta corriente y confirmación idempotente de cierre mensual v2 por período
CREATE OR REPLACE FUNCTION public.get_socio_cuenta_corriente_summary(p_socio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, aciacam_cc
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_role text := lower(btrim(COALESCE(public.get_my_role(), '')));
    v_row record;
    v_orders jsonb;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
    IF v_role NOT IN ('admin', 'staff') AND NOT EXISTS (
        SELECT 1 FROM public.socios s WHERE s.id = p_socio_id AND (s.auth_user_id = v_actor OR NULLIF(to_jsonb(s)->>'user_id', '')::uuid = v_actor)
    ) THEN
        RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_row FROM aciacam_cc.estado_cuenta_socio WHERE socio_id = p_socio_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'pedidoId', sp.pedido_id,
        'esperadoCentavos', sp.esperado_centavos::text,
        'saldoCentavos', sp.saldo_centavos::text
    ) ORDER BY cp.created_at DESC), '[]'::jsonb)
    INTO v_orders
    FROM aciacam_cc.saldos_pedido sp
    JOIN aciacam_cc.cuentas_pedido cp ON cp.pedido_id = sp.pedido_id
    WHERE sp.socio_id = p_socio_id;

    RETURN jsonb_build_object(
        'found', true,
        'socioId', v_row.socio_id,
        'estadoHistorico', v_row.estado_historico,
        'saldoCorrienteDesdeCorteCentavos', v_row.saldo_corriente_desde_corte_centavos::text,
        'saldoAperturaCentavos', CASE WHEN v_row.saldo_apertura_centavos IS NULL THEN NULL ELSE v_row.saldo_apertura_centavos::text END,
        'saldoGlobalDefinitivoCentavos', CASE WHEN v_row.saldo_global_definitivo_centavos IS NULL THEN NULL ELSE v_row.saldo_global_definitivo_centavos::text END,
        'pedidos', v_orders
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_socio_cuenta_corriente_summary(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_socio_cuenta_corriente_summary(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_period_close_command(
    p_command_id uuid,
    p_periodo text,
    p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, aciacam_cc
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_role text := lower(btrim(COALESCE(public.get_my_role(), '')));
    v_existing public.cierres_periodo%ROWTYPE;
    v_cierre_periodo_id uuid;
    v_start timestamptz;
    v_end timestamptz;
    v_socio_id uuid;
    v_emitted_count integer := 0;
    v_estado_hist text;
    v_saldo_corr bigint;
    v_saldo_glob bigint;
    v_saldo_ini bigint;
    v_dispensas jsonb;
    v_aportes jsonb;
    v_bonif jsonb;
    v_socio_rec public.socios%ROWTYPE;
    v_datos_v2 jsonb;
    v_pie_legal text := 'Los importes consignados corresponden exclusivamente a aportes voluntarios destinados al sostenimiento del programa de cultivo solidario desarrollado por la Asociación Civil para la Investigación y el Acceso del Cannabis Medicinal (ACIACAM), en cumplimiento de su Estatuto Social, de la Ley 27.350, su Decreto Reglamentario 883/2020, la Resolución MS 800/2021 y demás normativa aplicable. Dichos aportes no constituyen precio de venta ni contraprestación comercial por los productos dispensados.';
BEGIN
    IF v_actor IS NULL OR (p_actor_id IS NOT NULL AND p_actor_id <> v_actor) OR v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'CIERRE_UNAUTHORIZED' USING ERRCODE = '42501';
    END IF;
    IF p_command_id IS NULL OR p_periodo IS NULL OR p_periodo !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'CIERRE_PARAMS_INVALID' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 909));
    SELECT * INTO v_existing FROM public.cierres_periodo WHERE command_id = p_command_id;
    IF FOUND THEN
        IF v_existing.periodo IS DISTINCT FROM p_periodo OR v_existing.cerrado_por IS DISTINCT FROM v_actor THEN
            RAISE EXCEPTION 'CIERRE_COMMAND_CONFLICT' USING ERRCODE = '22023';
        END IF;
        RETURN jsonb_build_object(
            'cierrePeriodoId', v_existing.id,
            'periodo', v_existing.periodo,
            'estado', v_existing.estado,
            'reused', true
        );
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('cierre_periodo:' || p_periodo, 910));

    IF EXISTS (SELECT 1 FROM public.cierres_periodo WHERE periodo = p_periodo AND estado = 'cerrado') THEN
        RAISE EXCEPTION 'CIERRE_PERIODO_YA_CERRADO' USING ERRCODE = '22023';
    END IF;

    v_start := (p_periodo || '-01')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires';
    v_end := ((p_periodo || '-01')::date + interval '1 month')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires';

    INSERT INTO public.cierres_periodo (periodo, estado, command_id, cerrado_por, cerrado_at)
    VALUES (p_periodo, 'cerrado', p_command_id, v_actor, now())
    ON CONFLICT (periodo) DO UPDATE
        SET estado = 'cerrado', command_id = p_command_id, cerrado_por = v_actor, cerrado_at = now()
    RETURNING id INTO v_cierre_periodo_id;

    FOR v_socio_id IN
        SELECT DISTINCT socio_id FROM (
            SELECT p.socio_id FROM public.pedidos p
            WHERE p.socio_id IS NOT NULL AND p.estado IN ('entregado', 'retirado')
              AND p.fecha_entrega_efectiva >= v_start AND p.fecha_entrega_efectiva < v_end
            UNION
            SELECT pg.socio_id FROM public.pagos pg
            WHERE pg.socio_id IS NOT NULL
              AND pg.fecha >= (p_periodo || '-01')::date AND pg.fecha < ((p_periodo || '-01')::date + interval '1 month')::date
            UNION
            SELECT m.socio_id FROM aciacam_cc.movimientos m
            WHERE m.created_at >= v_start AND m.created_at < v_end
        ) t
    LOOP
        IF EXISTS (SELECT 1 FROM public.cierres_mensuales cm WHERE cm.socio_id = v_socio_id AND cm.periodo = p_periodo AND cm.estado = 'emitido') THEN
            CONTINUE;
        END IF;

        SELECT * INTO STRICT v_socio_rec FROM public.socios WHERE id = v_socio_id;
        SELECT estado_historico, saldo_corriente_desde_corte_centavos, saldo_global_definitivo_centavos
        INTO v_estado_hist, v_saldo_corr, v_saldo_glob
        FROM aciacam_cc.estado_cuenta_socio WHERE socio_id = v_socio_id;

        SELECT NULLIF((cm.datos->'resumen_cuenta'->>'saldo_final_definitivo_centavos'), '')::bigint
        INTO v_saldo_ini
        FROM public.cierres_mensuales cm
        WHERE cm.socio_id = v_socio_id AND cm.periodo < p_periodo AND cm.estado = 'emitido'
        ORDER BY cm.periodo DESC, cm.version DESC
        LIMIT 1;

        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'pedidoId', p.id, 'fecha', p.fecha_entrega_efectiva, 'items', p.items, 'total', p.total, 'operador', 'Sistema ACIACAM'
        ) ORDER BY p.fecha_entrega_efectiva, p.id), '[]'::jsonb)
        INTO v_dispensas
        FROM public.pedidos p
        WHERE p.socio_id = v_socio_id AND p.estado IN ('entregado', 'retirado')
          AND p.fecha_entrega_efectiva >= v_start AND p.fecha_entrega_efectiva < v_end;

        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'pagoId', pg.id, 'pedidoId', pg.pedido_id, 'fecha', pg.fecha, 'concepto', pg.concepto,
            'medioDePago', pg.medio_de_pago, 'referencia', pg.referencia, 'monto', pg.monto
        ) ORDER BY pg.fecha, pg.id), '[]'::jsonb)
        INTO v_aportes
        FROM public.pagos pg
        WHERE pg.socio_id = v_socio_id
          AND pg.fecha >= (p_periodo || '-01')::date AND pg.fecha < ((p_periodo || '-01')::date + interval '1 month')::date;

        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'movimientoId', m.id, 'pedidoId', m.pedido_id, 'tipo', m.tipo, 'signo', m.signo,
            'centavos', m.centavos::text, 'motivo', m.motivo, 'fecha', m.created_at, 'revierteId', m.revierte_id
        ) ORDER BY m.created_at, m.id), '[]'::jsonb)
        INTO v_bonif
        FROM aciacam_cc.movimientos m
        WHERE m.socio_id = v_socio_id AND m.tipo IN ('bonificacion', 'ajuste', 'reversion')
          AND m.created_at >= v_start AND m.created_at < v_end;

        v_datos_v2 := jsonb_build_object(
            'schema_version', 2,
            'socio', jsonb_build_object(
                'id', v_socio_rec.id, 'nombre', v_socio_rec.nombre, 'apellido', v_socio_rec.apellido,
                'dni', v_socio_rec.dni, 'email', v_socio_rec.email,
                'ordenLibro', to_jsonb(v_socio_rec)->>'orden_libro',
                'actaNumero', to_jsonb(v_socio_rec)->>'acta_numero',
                'reprocann', jsonb_build_object(
                    'numeroTramite', v_socio_rec.reprocann_num_tramite,
                    'fechaAlta', v_socio_rec.reprocann_fecha_alta,
                    'fechaVencimiento', v_socio_rec.reprocann_fecha_vencimiento,
                    'tipo', v_socio_rec.reprocann_tipo,
                    'estado', to_jsonb(v_socio_rec)->>'reprocann_estado'
                )
            ),
            'resumen_cuenta', jsonb_build_object(
                'estado_historico', COALESCE(v_estado_hist, 'pendiente_conciliacion'),
                'saldo_inicial_centavos', v_saldo_ini,
                'saldo_corriente_desde_corte_centavos', v_saldo_corr,
                'saldo_final_definitivo_centavos', v_saldo_glob
            ),
            'dispensas', v_dispensas,
            'aportes', v_aportes,
            'bonificaciones_ajustes', v_bonif,
            'version_pie_legal', 2,
            'pie_legal', v_pie_legal
        );

        INSERT INTO public.cierres_mensuales (
            socio_id, periodo, cierre_periodo_id, schema_version, estado_conciliacion, datos
        ) VALUES (
            v_socio_id, p_periodo, v_cierre_periodo_id, 2, COALESCE(v_estado_hist, 'pendiente_conciliacion'), v_datos_v2
        );
        v_emitted_count := v_emitted_count + 1;
    END LOOP;

    UPDATE public.cierres_periodo
    SET resumen_totales = jsonb_build_object('constancias_emitidas', v_emitted_count)
    WHERE id = v_cierre_periodo_id;

    RETURN jsonb_build_object(
        'cierrePeriodoId', v_cierre_periodo_id,
        'periodo', p_periodo,
        'estado', 'cerrado',
        'constanciasEmitidas', v_emitted_count,
        'reused', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_period_close_command(uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_period_close_command(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cc_command(p_command_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, aciacam_cc
AS $$
    SELECT aciacam_cc.command(p_command_id, p_payload);
$$;

REVOKE ALL ON FUNCTION public.cc_command(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cc_command(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_cc_pending_accounts(
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, aciacam_cc
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_role text := lower(btrim(COALESCE(public.get_my_role(), '')));
    v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
    v_offset integer := GREATEST(0, COALESCE(p_offset, 0));
    v_rows jsonb;
BEGIN
    IF v_actor IS NULL OR v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(row_obj), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT jsonb_build_object(
            'pedidoId', sp.pedido_id,
            'socioId', sp.socio_id,
            'socioNombre', trim(COALESCE(s.apellido, '') || ', ' || COALESCE(s.nombre, '')),
            'estadoEntrega', p.estado,
            'esperadoCentavos', sp.esperado_centavos::text,
            'saldoCentavos', sp.saldo_centavos::text,
            'fechaPedido', p.created_at
        ) AS row_obj
        FROM aciacam_cc.saldos_pedido sp
        JOIN aciacam_cc.cuentas_pedido cp ON cp.pedido_id = sp.pedido_id
        JOIN public.pedidos p ON p.id = sp.pedido_id
        LEFT JOIN public.socios s ON s.id = sp.socio_id
        WHERE sp.saldo_centavos > 0
        ORDER BY cp.created_at DESC, sp.pedido_id DESC
        LIMIT v_limit OFFSET v_offset
    ) q;

    RETURN jsonb_build_object('cuentas', v_rows, 'limit', v_limit, 'offset', v_offset);
END;
$$;

REVOKE ALL ON FUNCTION public.get_cc_pending_accounts(integer, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_cc_pending_accounts(integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_socio_cuenta_corriente_movements(
    p_socio_id uuid,
    p_pedido_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, aciacam_cc
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_role text := lower(btrim(COALESCE(public.get_my_role(), '')));
    v_rows jsonb;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
    IF v_role NOT IN ('admin', 'staff') AND NOT EXISTS (
        SELECT 1 FROM public.socios s WHERE s.id = p_socio_id AND (s.auth_user_id = v_actor OR NULLIF(to_jsonb(s)->>'user_id', '')::uuid = v_actor)
    ) THEN
        RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', m.id,
        'pedidoId', m.pedido_id,
        'socioId', m.socio_id,
        'tipo', m.tipo,
        'signo', m.signo,
        'centavos', m.centavos::text,
        'motivo', m.motivo,
        'fecha', m.created_at,
        'responsable', m.created_by,
        'revierteId', m.revierte_id,
        'aporteId', m.pago_id,
        'medio', a.medio,
        'referencia', a.referencia,
        'conciliada', EXISTS (SELECT 1 FROM aciacam_cc.conciliaciones c WHERE c.aporte_id = a.id)
    ) ORDER BY m.created_at ASC, m.id ASC), '[]'::jsonb)
    INTO v_rows
    FROM aciacam_cc.movimientos m
    LEFT JOIN aciacam_cc.aportes a ON a.id = m.pago_id
    WHERE m.socio_id = p_socio_id
      AND (p_pedido_id IS NULL OR m.pedido_id = p_pedido_id);

    RETURN jsonb_build_object('socioId', p_socio_id, 'movimientos', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_socio_cuenta_corriente_movements(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_socio_cuenta_corriente_movements(uuid, uuid) TO authenticated;

COMMIT;
