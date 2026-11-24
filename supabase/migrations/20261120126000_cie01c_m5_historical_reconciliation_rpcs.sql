-- CIE-01C M5: Conciliación histórica dinámica, registro auditado de revisiones y aportes posteriores al corte sobre dispensas históricas.
-- Migración estrictamente incremental sobre M1-M4 (no modifica M1-M4 aplicadas en Integration).

BEGIN;

CREATE TABLE IF NOT EXISTS aciacam_cc.revisiones_historicas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lote text NOT NULL CHECK (lote IN ('impago_con_importe', 'posibles_duplicados', 'sin_importe_con_pago', 'sin_importe_sin_pago')),
    fecha_corte date NOT NULL,
    pedido_id uuid REFERENCES public.pedidos(id) ON DELETE RESTRICT,
    socio_id uuid REFERENCES public.socios(id) ON DELETE RESTRICT,
    accion text NOT NULL CHECK (accion IN ('observacion', 'confirmar_saldo_apertura', 'confirmar_duplicado', 'descartar_duplicado', 'diferir_revision')),
    saldo_confirmado_centavos bigint CHECK (saldo_confirmado_centavos IS NULL OR saldo_confirmado_centavos BETWEEN -9007199254740991 AND 9007199254740991),
    motivo text NOT NULL CHECK (length(btrim(motivo)) >= 5),
    evidencia text NOT NULL CHECK (length(btrim(evidencia)) >= 3),
    actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_cc_rev_hist_corte ON aciacam_cc.revisiones_historicas (fecha_corte, created_at DESC);

DROP TRIGGER IF EXISTS cc_immutable_rev_hist ON aciacam_cc.revisiones_historicas;
CREATE TRIGGER cc_immutable_rev_hist
    BEFORE UPDATE OR DELETE ON aciacam_cc.revisiones_historicas
    FOR EACH ROW EXECUTE FUNCTION aciacam_cc.reject_mutation();

CREATE TABLE IF NOT EXISTS aciacam_cc.aportes_historicos_posteriores (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    command_id uuid NOT NULL UNIQUE,
    pedido_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE RESTRICT,
    socio_id uuid NOT NULL REFERENCES public.socios(id) ON DELETE RESTRICT,
    pago_id uuid NOT NULL UNIQUE REFERENCES public.pagos(id) ON DELETE RESTRICT,
    centavos bigint NOT NULL CHECK (centavos > 0 AND centavos <= 9007199254740991),
    medio text NOT NULL CHECK (medio IN ('efectivo', 'transferencia_galicia', 'transferencia', 'mercadopago')),
    referencia text,
    motivo text NOT NULL CHECK (length(btrim(motivo)) >= 3),
    created_by uuid NOT NULL REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

DROP TRIGGER IF EXISTS cc_immutable_aportes_hist_post ON aciacam_cc.aportes_historicos_posteriores;
CREATE TRIGGER cc_immutable_aportes_hist_post
    BEFORE UPDATE OR DELETE ON aciacam_cc.aportes_historicos_posteriores
    FOR EACH ROW EXECUTE FUNCTION aciacam_cc.reject_mutation();

ALTER TABLE aciacam_cc.revisiones_historicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE aciacam_cc.aportes_historicos_posteriores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON aciacam_cc.revisiones_historicas, aciacam_cc.aportes_historicos_posteriores FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_cc_historical_reconciliation_batches(
    p_fecha_corte date DEFAULT DATE '2026-12-01'
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
    v_corte date := COALESCE(p_fecha_corte, DATE '2026-12-01');
    v_corte_ts timestamptz := (v_corte::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires');
    v_impago_cnt integer := 0;
    v_impago_ars numeric := 0;
    v_dup_grupos_cnt integer := 0;
    v_sin_imp_con_pago_cnt integer := 0;
    v_sin_imp_con_pago_ars numeric := 0;
    v_sin_imp_sin_pago_cnt integer := 0;
    v_socios_rev_cnt integer := 0;
    v_revisiones jsonb;
BEGIN
    IF v_actor IS NULL OR v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;

    WITH p_agg AS (
        SELECT pg.pedido_id, count(*) AS pagos_cnt, COALESCE(sum(pg.monto), 0) AS pagado_ars
        FROM public.pagos pg
        WHERE pg.pedido_id IS NOT NULL
        GROUP BY pg.pedido_id
    ),
    e AS (
        SELECT p.id, p.socio_id, COALESCE(p.total, 0) AS total,
               COALESCE(pa.pagos_cnt, 0) AS pagos_cnt,
               COALESCE(pa.pagado_ars, 0) AS pagado_ars
        FROM public.pedidos p
        LEFT JOIN p_agg pa ON pa.pedido_id = p.id
        WHERE p.estado IN ('entregado', 'retirado')
          AND p.created_at < v_corte_ts
    )
    SELECT
        count(*) FILTER (WHERE total > 0 AND pagado_ars < total)::integer,
        COALESCE(sum(total - pagado_ars) FILTER (WHERE total > 0 AND pagado_ars < total), 0),
        count(*) FILTER (WHERE total = 0 AND pagos_cnt > 0)::integer,
        COALESCE(sum(pagado_ars) FILTER (WHERE total = 0 AND pagos_cnt > 0), 0),
        count(*) FILTER (WHERE total = 0 AND pagos_cnt = 0)::integer,
        count(DISTINCT socio_id) FILTER (WHERE total = 0 OR pagado_ars <> total)::integer
    INTO v_impago_cnt, v_impago_ars, v_sin_imp_con_pago_cnt, v_sin_imp_con_pago_ars, v_sin_imp_sin_pago_cnt, v_socios_rev_cnt
    FROM e;

    SELECT count(*)::integer INTO v_dup_grupos_cnt
    FROM (
        SELECT pg.socio_id, pg.pedido_id, pg.monto
        FROM public.pagos pg
        WHERE pg.created_at < v_corte_ts
        GROUP BY pg.socio_id, pg.pedido_id, pg.monto
        HAVING count(*) > 1
    ) d;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'lote', r.lote,
        'fechaCorte', r.fecha_corte,
        'pedidoId', r.pedido_id,
        'socioId', r.socio_id,
        'accion', r.accion,
        'saldoConfirmadoCentavos', r.saldo_confirmado_centavos::text,
        'motivo', r.motivo,
        'evidencia', r.evidencia,
        'actor', r.actor_auth_user_id,
        'fecha', r.created_at
    ) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_revisiones
    FROM (
        SELECT * FROM aciacam_cc.revisiones_historicas
        WHERE fecha_corte = v_corte
        ORDER BY created_at DESC
        LIMIT 50
    ) r;

    RETURN jsonb_build_object(
        'fechaCorte', v_corte,
        'lotes', jsonb_build_object(
            'impagoConImporte', jsonb_build_object('cantidad', v_impago_cnt, 'montoArs', v_impago_ars),
            'posiblesDuplicados', jsonb_build_object('grupos', v_dup_grupos_cnt),
            'sinImporteConPago', jsonb_build_object('cantidad', v_sin_imp_con_pago_cnt, 'pagosArs', v_sin_imp_con_pago_ars),
            'sinImporteSinPago', jsonb_build_object('cantidad', v_sin_imp_sin_pago_cnt),
            'sociosRequierenRevision', v_socios_rev_cnt
        ),
        'revisiones', v_revisiones
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cc_historical_reconciliation_batches(date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_cc_historical_reconciliation_batches(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_cc_historical_review(
    p_lote text,
    p_fecha_corte date,
    p_accion text,
    p_motivo text,
    p_evidencia text,
    p_pedido_id uuid DEFAULT NULL,
    p_socio_id uuid DEFAULT NULL,
    p_saldo_confirmado_centavos bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, aciacam_cc
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_role text := lower(btrim(COALESCE(public.get_my_role(), '')));
    v_id uuid;
    v_ts timestamptz;
BEGIN
    IF v_actor IS NULL OR v_role <> 'admin' THEN
        RAISE EXCEPTION 'CC_ADMIN_REQUERIDO' USING ERRCODE = '42501';
    END IF;
    IF p_accion = 'confirmar_saldo_apertura' AND p_saldo_confirmado_centavos IS NULL THEN
        RAISE EXCEPTION 'CC_SALDO_CONFIRMADO_REQUERIDO' USING ERRCODE = '22023';
    END IF;

    INSERT INTO aciacam_cc.revisiones_historicas (
        lote, fecha_corte, pedido_id, socio_id, accion, saldo_confirmado_centavos, motivo, evidencia, actor_auth_user_id
    ) VALUES (
        p_lote, COALESCE(p_fecha_corte, DATE '2026-12-01'), p_pedido_id, p_socio_id, p_accion, p_saldo_confirmado_centavos, btrim(p_motivo), btrim(p_evidencia), v_actor
    )
    RETURNING id, created_at INTO v_id, v_ts;

    RETURN jsonb_build_object(
        'id', v_id,
        'lote', p_lote,
        'fechaCorte', COALESCE(p_fecha_corte, DATE '2026-12-01'),
        'accion', p_accion,
        'actor', v_actor,
        'fecha', v_ts
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_cc_historical_review(text, date, text, text, text, uuid, uuid, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_cc_historical_review(text, date, text, text, text, uuid, uuid, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_historical_post_cutoff_aporte(
    p_command_id uuid,
    p_pedido_id uuid,
    p_centavos bigint,
    p_medio text,
    p_referencia text DEFAULT NULL,
    p_motivo text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, aciacam_cc
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_role text := lower(btrim(COALESCE(public.get_my_role(), '')));
    v_cfg record;
    v_existing aciacam_cc.aportes_historicos_posteriores%ROWTYPE;
    v_ped record;
    v_corte_ts timestamptz;
    v_pago_id uuid;
    v_hist_id uuid;
BEGIN
    IF v_actor IS NULL OR v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
    SELECT enabled, periodo_corte INTO v_cfg FROM aciacam_cc.config WHERE singleton = true;
    IF COALESCE(v_cfg.enabled, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'CC_NO_HABILITADA' USING ERRCODE = '55000';
    END IF;

    SELECT * INTO v_existing FROM aciacam_cc.aportes_historicos_posteriores WHERE command_id = p_command_id;
    IF FOUND THEN
        RETURN jsonb_build_object('id', v_existing.id, 'pagoId', v_existing.pago_id, 'pedidoId', v_existing.pedido_id, 'reused', true);
    END IF;

    IF p_centavos IS NULL OR p_centavos <= 0 THEN
        RAISE EXCEPTION 'CC_MONTO_INVALIDO' USING ERRCODE = '22023';
    END IF;
    IF p_medio IN ('transferencia', 'transferencia_galicia') AND length(btrim(COALESCE(p_referencia, ''))) < 2 THEN
        RAISE EXCEPTION 'CC_REFERENCIA_REQUERIDA' USING ERRCODE = '22023';
    END IF;

    SELECT id, socio_id, estado, created_at INTO v_ped FROM public.pedidos WHERE id = p_pedido_id;
    IF NOT FOUND OR v_ped.estado NOT IN ('entregado', 'retirado') THEN
        RAISE EXCEPTION 'CC_PEDIDO_HISTORICO_INVALIDO' USING ERRCODE = '22023';
    END IF;

    v_corte_ts := ((COALESCE(v_cfg.periodo_corte, '2026-12') || '-01')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires');
    IF v_ped.created_at >= v_corte_ts THEN
        RAISE EXCEPTION 'CC_USAR_CC_COMMAND_POST_CORTE' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.pagos (socio_id, fecha, concepto, monto, medio_de_pago, pedido_id, referencia, created_by)
    VALUES (
        v_ped.socio_id,
        (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
        'Aporte posterior al corte sobre dispensa histórica',
        round((p_centavos::numeric / 100.0), 2),
        p_medio,
        p_pedido_id,
        NULLIF(btrim(COALESCE(p_referencia, '')), ''),
        v_actor
    )
    RETURNING id INTO v_pago_id;

    INSERT INTO aciacam_cc.aportes_historicos_posteriores (
        command_id, pedido_id, socio_id, pago_id, centavos, medio, referencia, motivo, created_by
    ) VALUES (
        p_command_id, p_pedido_id, v_ped.socio_id, v_pago_id, p_centavos, p_medio, NULLIF(btrim(COALESCE(p_referencia, '')), ''), btrim(p_motivo), v_actor
    )
    RETURNING id INTO v_hist_id;

    RETURN jsonb_build_object('id', v_hist_id, 'pagoId', v_pago_id, 'pedidoId', p_pedido_id, 'reused', false);
END;
$$;

REVOKE ALL ON FUNCTION public.record_historical_post_cutoff_aporte(uuid, uuid, bigint, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_historical_post_cutoff_aporte(uuid, uuid, bigint, text, text, text) TO authenticated;

COMMIT;
