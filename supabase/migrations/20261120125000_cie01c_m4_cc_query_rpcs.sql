-- CIE-01C M4: RPCs de consulta de solo lectura para listado global de saldos pendientes e historial de movimientos
-- Incremental e idempotente sobre M3 (sin modificar M1, M2 ni M3 aplicadas en Integration).

BEGIN;

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

CREATE OR REPLACE FUNCTION public.get_cc_config_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, aciacam_cc
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_cfg record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
    SELECT enabled, periodo_corte INTO v_cfg FROM aciacam_cc.config WHERE singleton = true;
    RETURN jsonb_build_object(
        'enabled', COALESCE(v_cfg.enabled, false),
        'periodoCorte', v_cfg.periodo_corte
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cc_config_status() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_cc_config_status() TO authenticated;

COMMIT;
