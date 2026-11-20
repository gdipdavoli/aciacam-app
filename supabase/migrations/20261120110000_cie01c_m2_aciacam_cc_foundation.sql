-- CIE-01C M2: Esquema inmutable aciacam_cc (feature flag enabled = false por defecto)
-- Operaciones nuevas desbloqueadas aunque el historial del socio esté pendiente de conciliación.
BEGIN;

CREATE SCHEMA IF NOT EXISTS aciacam_cc;
REVOKE ALL ON SCHEMA aciacam_cc FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS aciacam_cc.config (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled boolean NOT NULL DEFAULT false,
    periodo_corte varchar(7)
);
INSERT INTO aciacam_cc.config (singleton, enabled)
VALUES (true, false)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS aciacam_cc.cuentas_pedido (
    pedido_id uuid PRIMARY KEY REFERENCES public.pedidos(id) ON DELETE RESTRICT,
    socio_id uuid NOT NULL REFERENCES public.socios(id) ON DELETE RESTRICT,
    esperado_centavos bigint NOT NULL CHECK (esperado_centavos BETWEEN 0 AND 9007199254740991),
    fundamento jsonb NOT NULL CHECK (jsonb_typeof(fundamento) = 'object'),
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    created_by uuid NOT NULL REFERENCES auth.users(id),
    UNIQUE (pedido_id, socio_id)
);

CREATE TABLE IF NOT EXISTS aciacam_cc.aportes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id uuid NOT NULL,
    socio_id uuid NOT NULL,
    legacy_pago_id uuid UNIQUE REFERENCES public.pagos(id) ON DELETE RESTRICT,
    centavos bigint NOT NULL CHECK (centavos BETWEEN 1 AND 9007199254740991),
    medio text NOT NULL CHECK (medio IN ('efectivo', 'transferencia_galicia', 'mercadopago')),
    referencia text,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    created_by uuid NOT NULL REFERENCES auth.users(id),
    FOREIGN KEY (pedido_id, socio_id) REFERENCES aciacam_cc.cuentas_pedido(pedido_id, socio_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS aciacam_cc.movimientos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id uuid NOT NULL,
    socio_id uuid NOT NULL,
    tipo text NOT NULL CHECK (tipo IN ('cargo', 'pago', 'bonificacion', 'ajuste', 'reversion')),
    signo smallint NOT NULL CHECK (signo IN (-1, 1)),
    centavos bigint NOT NULL CHECK (centavos BETWEEN 1 AND 9007199254740991),
    motivo text NOT NULL CHECK (length(btrim(motivo)) > 0),
    command_id uuid NOT NULL,
    linea integer NOT NULL CHECK (linea >= 0),
    pago_id uuid UNIQUE REFERENCES aciacam_cc.aportes(id) ON DELETE RESTRICT,
    revierte_id uuid UNIQUE REFERENCES aciacam_cc.movimientos(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    created_by uuid NOT NULL REFERENCES auth.users(id),
    FOREIGN KEY (pedido_id, socio_id) REFERENCES aciacam_cc.cuentas_pedido(pedido_id, socio_id) ON DELETE RESTRICT,
    UNIQUE (command_id, linea),
    CHECK ((tipo = 'cargo' AND signo = 1) OR (tipo IN ('pago', 'bonificacion') AND signo = -1) OR tipo IN ('ajuste', 'reversion')),
    CHECK ((tipo = 'reversion') = (revierte_id IS NOT NULL)),
    CHECK ((tipo = 'pago') = (pago_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS cc_un_cargo_por_pedido
    ON aciacam_cc.movimientos (pedido_id)
    WHERE tipo = 'cargo';

CREATE INDEX IF NOT EXISTS cc_movimientos_socio_pedido
    ON aciacam_cc.movimientos (socio_id, pedido_id, created_at);

CREATE TABLE IF NOT EXISTS aciacam_cc.commands (
    id uuid PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES auth.users(id),
    payload jsonb NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE IF NOT EXISTS aciacam_cc.conciliaciones (
    aporte_id uuid PRIMARY KEY REFERENCES aciacam_cc.aportes(id) ON DELETE RESTRICT,
    referencia text NOT NULL CHECK (length(btrim(referencia)) > 0),
    created_by uuid NOT NULL REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

-- Declaración de cobertura obligatoria para aprobar saldos históricos de apertura
CREATE TABLE IF NOT EXISTS aciacam_cc.conciliaciones_historicas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    socio_id uuid NOT NULL UNIQUE REFERENCES public.socios(id) ON DELETE RESTRICT,
    periodo_desde varchar(7) NOT NULL CHECK (periodo_desde ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    periodo_hasta varchar(7) NOT NULL CHECK (periodo_hasta ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    fuentes_revisadas text[] NOT NULL CHECK (cardinality(fuentes_revisadas) > 0),
    alcance text NOT NULL CHECK (length(btrim(alcance)) >= 10),
    limitaciones text NOT NULL CHECK (length(btrim(limitaciones)) > 0),
    saldo_apertura_centavos bigint NOT NULL CHECK (saldo_apertura_centavos BETWEEN -9007199254740991 AND 9007199254740991),
    responsable_relevamiento text NOT NULL CHECK (length(btrim(responsable_relevamiento)) > 0),
    aprobado_por uuid NOT NULL REFERENCES auth.users(id),
    aprobado_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE OR REPLACE FUNCTION aciacam_cc.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'CC_APPEND_ONLY' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS cc_immutable_movimientos ON aciacam_cc.movimientos;
CREATE TRIGGER cc_immutable_movimientos
    BEFORE UPDATE OR DELETE ON aciacam_cc.movimientos
    FOR EACH ROW EXECUTE FUNCTION aciacam_cc.reject_mutation();

DROP TRIGGER IF EXISTS cc_immutable_cuentas ON aciacam_cc.cuentas_pedido;
CREATE TRIGGER cc_immutable_cuentas
    BEFORE UPDATE OR DELETE ON aciacam_cc.cuentas_pedido
    FOR EACH ROW EXECUTE FUNCTION aciacam_cc.reject_mutation();

DROP TRIGGER IF EXISTS cc_immutable_aportes ON aciacam_cc.aportes;
CREATE TRIGGER cc_immutable_aportes
    BEFORE UPDATE OR DELETE ON aciacam_cc.aportes
    FOR EACH ROW EXECUTE FUNCTION aciacam_cc.reject_mutation();

DROP TRIGGER IF EXISTS cc_immutable_commands ON aciacam_cc.commands;
CREATE TRIGGER cc_immutable_commands
    BEFORE UPDATE OR DELETE ON aciacam_cc.commands
    FOR EACH ROW EXECUTE FUNCTION aciacam_cc.reject_mutation();

DROP TRIGGER IF EXISTS cc_immutable_conciliaciones ON aciacam_cc.conciliaciones;
CREATE TRIGGER cc_immutable_conciliaciones
    BEFORE UPDATE OR DELETE ON aciacam_cc.conciliaciones
    FOR EACH ROW EXECUTE FUNCTION aciacam_cc.reject_mutation();

DROP TRIGGER IF EXISTS cc_immutable_conc_hist ON aciacam_cc.conciliaciones_historicas;
CREATE TRIGGER cc_immutable_conc_hist
    BEFORE UPDATE OR DELETE ON aciacam_cc.conciliaciones_historicas
    FOR EACH ROW EXECUTE FUNCTION aciacam_cc.reject_mutation();

-- Saldos por pedido y saldos separados del socio (corriente vs histórico)
CREATE OR REPLACE VIEW aciacam_cc.saldos_pedido WITH (security_invoker = true) AS
SELECT
    c.pedido_id,
    c.socio_id,
    c.esperado_centavos,
    CASE
        WHEN c.esperado_centavos = 0 OR count(m.id) FILTER (WHERE m.tipo = 'cargo') = 1
            THEN COALESCE(sum(m.centavos::numeric * m.signo), 0)::bigint
        ELSE NULL
    END AS saldo_centavos
FROM aciacam_cc.cuentas_pedido c
LEFT JOIN aciacam_cc.movimientos m
    ON m.pedido_id = c.pedido_id AND m.socio_id = c.socio_id
GROUP BY c.pedido_id, c.socio_id, c.esperado_centavos;

CREATE OR REPLACE VIEW aciacam_cc.saldos_socio_corriente WITH (security_invoker = true) AS
SELECT
    socio_id,
    COALESCE(sum(saldo_centavos), 0)::bigint AS saldo_corriente_desde_corte_centavos
FROM aciacam_cc.saldos_pedido
GROUP BY socio_id;

CREATE OR REPLACE VIEW aciacam_cc.estado_cuenta_socio WITH (security_invoker = true) AS
SELECT
    s.id AS socio_id,
    COALESCE(sc.saldo_corriente_desde_corte_centavos, 0)::bigint AS saldo_corriente_desde_corte_centavos,
    CASE
        WHEN ch.id IS NOT NULL THEN 'conciliada'
        WHEN EXISTS (SELECT 1 FROM public.pagos pg WHERE pg.socio_id = s.id AND NOT EXISTS (SELECT 1 FROM aciacam_cc.aportes a WHERE a.legacy_pago_id = pg.id))
          OR EXISTS (SELECT 1 FROM public.pedidos pe WHERE pe.socio_id = s.id AND pe.estado IN ('entregado', 'retirado') AND NOT EXISTS (SELECT 1 FROM aciacam_cc.cuentas_pedido cp WHERE cp.pedido_id = pe.id))
            THEN 'pendiente_conciliacion'
        ELSE 'nueva'
    END AS estado_historico,
    ch.saldo_apertura_centavos,
    CASE
        WHEN ch.id IS NOT NULL THEN (ch.saldo_apertura_centavos + COALESCE(sc.saldo_corriente_desde_corte_centavos, 0))::bigint
        WHEN NOT EXISTS (SELECT 1 FROM public.pagos pg WHERE pg.socio_id = s.id AND NOT EXISTS (SELECT 1 FROM aciacam_cc.aportes a WHERE a.legacy_pago_id = pg.id))
         AND NOT EXISTS (SELECT 1 FROM public.pedidos pe WHERE pe.socio_id = s.id AND pe.estado IN ('entregado', 'retirado') AND NOT EXISTS (SELECT 1 FROM aciacam_cc.cuentas_pedido cp WHERE cp.pedido_id = pe.id))
            THEN COALESCE(sc.saldo_corriente_desde_corte_centavos, 0)::bigint
        ELSE NULL
    END AS saldo_global_definitivo_centavos
FROM public.socios s
LEFT JOIN aciacam_cc.saldos_socio_corriente sc ON sc.socio_id = s.id
LEFT JOIN aciacam_cc.conciliaciones_historicas ch ON ch.socio_id = s.id;

ALTER TABLE aciacam_cc.config ENABLE ROW LEVEL SECURITY;
ALTER TABLE aciacam_cc.cuentas_pedido ENABLE ROW LEVEL SECURITY;
ALTER TABLE aciacam_cc.aportes ENABLE ROW LEVEL SECURITY;
ALTER TABLE aciacam_cc.movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE aciacam_cc.commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE aciacam_cc.conciliaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE aciacam_cc.conciliaciones_historicas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA aciacam_cc FROM PUBLIC, anon, authenticated, service_role;

-- Frontera segura SECURITY DEFINER para comandos de cuenta corriente
CREATE OR REPLACE FUNCTION aciacam_cc.actor()
RETURNS TABLE (socio_id uuid, rol text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'CC_IDENTIDAD_INVALIDA' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT s.id, lower(btrim(s.rol))
    FROM public.socios s
    WHERE s.auth_user_id = auth.uid()
      AND s.status = 'active'
      AND s.bloqueado IS NOT TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CC_IDENTIDAD_INVALIDA' USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION aciacam_cc.command(p_command_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, aciacam_cc
AS $$
DECLARE
    a record;
    o record;
    c record;
    old_cmd record;
    target record;
    op text := p_payload->>'operacion';
    order_id uuid := (p_payload->>'pedidoId')::uuid;
    value bigint;
    direction smallint;
    current_balance bigint;
    receipt uuid;
    legacy_pago uuid;
    movement uuid;
    response jsonb;
    reason text := btrim(p_payload->>'motivo');
    v_medio text;
    v_ref text;
BEGIN
    SELECT * INTO a FROM aciacam_cc.actor();
    IF a.rol IS NULL OR a.rol NOT IN ('staff', 'admin') THEN
        RAISE EXCEPTION 'CC_ROL_DENEGADO' USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE((SELECT enabled FROM aciacam_cc.config WHERE singleton), false) THEN
        RAISE EXCEPTION 'CC_NO_HABILITADA';
    END IF;
    IF p_command_id IS NULL OR order_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
       OR op IS NULL OR op NOT IN ('abrir', 'aportar', 'bonificar', 'ajustar', 'revertir', 'conciliar')
       OR reason IS NULL OR length(reason) = 0 OR length(reason) > 2000 THEN
        RAISE EXCEPTION 'CC_COMANDO_INVALIDO';
    END IF;
    IF op IN ('bonificar', 'ajustar', 'revertir', 'conciliar') AND a.rol <> 'admin' THEN
        RAISE EXCEPTION 'CC_ADMIN_REQUERIDO' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 617));
    SELECT * INTO old_cmd FROM aciacam_cc.commands WHERE id = p_command_id;
    IF FOUND THEN
        IF old_cmd.actor_id <> auth.uid() OR old_cmd.payload <> p_payload THEN
            RAISE EXCEPTION 'CC_IDEMPOTENCIA_CONFLICTO';
        END IF;
        RETURN old_cmd.result || jsonb_build_object('reused', true);
    END IF;

    SELECT * INTO o FROM public.pedidos WHERE id = order_id FOR UPDATE;
    IF NOT FOUND OR o.socio_id IS NULL THEN
        RAISE EXCEPTION 'CC_PEDIDO_INVALIDO';
    END IF;
    IF o.estado NOT IN ('listo_para_retiro', 'en_camino', 'entregado', 'retirado') THEN
        RAISE EXCEPTION 'CC_ESTADO_NO_ADMITIDO';
    END IF;

    SELECT * INTO c FROM aciacam_cc.cuentas_pedido WHERE pedido_id = order_id FOR UPDATE;

    IF op = 'abrir' THEN
        IF FOUND THEN RAISE EXCEPTION 'CC_CUENTA_EXISTENTE'; END IF;
        IF jsonb_typeof(p_payload->'esperadoCentavos') IS DISTINCT FROM 'number' OR (p_payload->>'esperadoCentavos') !~ '^[0-9]+$' THEN
            RAISE EXCEPTION 'CC_IMPORTE_INVALIDO';
        END IF;
        value := (p_payload->>'esperadoCentavos')::bigint;
        IF value NOT BETWEEN 0 AND 9007199254740991 OR jsonb_typeof(p_payload->'fundamento') IS DISTINCT FROM 'object' OR p_payload->'fundamento' = '{}'::jsonb THEN
            RAISE EXCEPTION 'CC_FUNDAMENTO_REQUERIDO';
        END IF;
        INSERT INTO aciacam_cc.cuentas_pedido (pedido_id, socio_id, esperado_centavos, fundamento, created_by)
        VALUES (order_id, o.socio_id, value, p_payload->'fundamento', auth.uid());
        IF value > 0 THEN
            INSERT INTO aciacam_cc.movimientos (pedido_id, socio_id, tipo, signo, centavos, motivo, command_id, linea, created_by)
            VALUES (order_id, o.socio_id, 'cargo', 1, value, reason, p_command_id, 0, auth.uid())
            RETURNING id INTO movement;
        END IF;
    ELSE
        IF c.pedido_id IS NULL THEN RAISE EXCEPTION 'CC_ESPERADO_DESCONOCIDO'; END IF;
        IF c.socio_id <> o.socio_id THEN RAISE EXCEPTION 'CC_SOCIO_INCONSISTENTE'; END IF;

        SELECT saldo_centavos INTO current_balance FROM aciacam_cc.saldos_pedido WHERE pedido_id = order_id;
        IF current_balance IS NULL THEN RAISE EXCEPTION 'CC_LIBRO_INCOMPLETO'; END IF;

        IF op IN ('aportar', 'bonificar', 'ajustar') THEN
            IF jsonb_typeof(p_payload->'centavos') IS DISTINCT FROM 'number' OR (p_payload->>'centavos') !~ '^[0-9]+$' THEN
                RAISE EXCEPTION 'CC_IMPORTE_INVALIDO';
            END IF;
            value := (p_payload->>'centavos')::bigint;
            IF value NOT BETWEEN 1 AND 9007199254740991 THEN RAISE EXCEPTION 'CC_IMPORTE_INVALIDO'; END IF;

            direction := -1;
            IF op = 'ajustar' THEN
                IF (p_payload->>'signo') IS NULL OR (p_payload->>'signo') NOT IN ('1', '-1') THEN
                    RAISE EXCEPTION 'CC_SIGNO_INVALIDO';
                END IF;
                direction := (p_payload->>'signo')::smallint;
            END IF;

            IF current_balance + value * direction < 0 THEN
                RAISE EXCEPTION 'CC_SUPERA_SALDO';
            END IF;

            IF op = 'aportar' THEN
                v_medio := p_payload->>'medio';
                v_ref := nullif(btrim(p_payload->>'referencia'), '');
                IF v_medio IS NULL OR v_medio NOT IN ('efectivo', 'transferencia_galicia', 'mercadopago') THEN
                    RAISE EXCEPTION 'CC_MEDIO_INVALIDO';
                END IF;
                IF v_medio <> 'efectivo' AND v_ref IS NULL THEN
                    RAISE EXCEPTION 'CC_REFERENCIA_REQUERIDA';
                END IF;

                -- Registrar en public.pagos y enlazar 1:1 en aciacam_cc.aportes (anti-duplicación)
                INSERT INTO public.pagos (socio_id, fecha, concepto, monto, medio_de_pago, pedido_id, referencia, created_by)
                VALUES (o.socio_id, CURRENT_DATE, reason, round((value::numeric / 100.0), 2), v_medio, order_id, v_ref, auth.uid())
                RETURNING id INTO legacy_pago;

                INSERT INTO aciacam_cc.aportes (pedido_id, socio_id, legacy_pago_id, centavos, medio, referencia, created_by)
                VALUES (order_id, o.socio_id, legacy_pago, value, v_medio, v_ref, auth.uid())
                RETURNING id INTO receipt;
            END IF;

            INSERT INTO aciacam_cc.movimientos (pedido_id, socio_id, tipo, signo, centavos, motivo, command_id, linea, pago_id, created_by)
            VALUES (
                order_id, o.socio_id,
                CASE op WHEN 'aportar' THEN 'pago' WHEN 'bonificar' THEN 'bonificacion' ELSE 'ajuste' END,
                direction, value, reason, p_command_id, 0, receipt, auth.uid()
            )
            RETURNING id INTO movement;
        ELSIF op = 'revertir' THEN
            SELECT * INTO target
            FROM aciacam_cc.movimientos
            WHERE id = (p_payload->>'movimientoId')::uuid AND pedido_id = order_id AND socio_id = o.socio_id;

            IF NOT FOUND OR target.tipo NOT IN ('pago', 'bonificacion', 'ajuste') THEN
                RAISE EXCEPTION 'CC_REVERSION_INVALIDA';
            END IF;
            IF EXISTS (SELECT 1 FROM aciacam_cc.movimientos WHERE revierte_id = target.id) THEN
                RAISE EXCEPTION 'CC_YA_REVERTIDO';
            END IF;
            IF current_balance - target.centavos * target.signo < 0 THEN
                RAISE EXCEPTION 'CC_SUPERA_SALDO';
            END IF;

            INSERT INTO aciacam_cc.movimientos (pedido_id, socio_id, tipo, signo, centavos, motivo, command_id, linea, revierte_id, created_by)
            VALUES (order_id, o.socio_id, 'reversion', -target.signo, target.centavos, reason, p_command_id, 0, target.id, auth.uid())
            RETURNING id INTO movement;
        ELSIF op = 'conciliar' THEN
            SELECT * INTO target FROM aciacam_cc.aportes WHERE id = (p_payload->>'aporteId')::uuid AND pedido_id = order_id AND socio_id = o.socio_id;
            IF NOT FOUND OR target.medio = 'efectivo' OR nullif(btrim(p_payload->>'referencia'), '') IS NULL
               OR EXISTS (SELECT 1 FROM aciacam_cc.movimientos m JOIN aciacam_cc.movimientos r ON r.revierte_id = m.id WHERE m.pago_id = target.id) THEN
                RAISE EXCEPTION 'CC_CONCILIACION_INVALIDA';
            END IF;
            INSERT INTO aciacam_cc.conciliaciones (aporte_id, referencia, created_by)
            VALUES (target.id, btrim(p_payload->>'referencia'), auth.uid());
        END IF;
    END IF;

    SELECT jsonb_build_object(
        'pedidoId', pedido_id,
        'socioId', socio_id,
        'saldoCentavos', saldo_centavos::text,
        'movimientoId', movement,
        'aporteId', receipt,
        'legacyPagoId', legacy_pago
    )
    INTO response
    FROM aciacam_cc.saldos_pedido
    WHERE pedido_id = order_id;

    INSERT INTO aciacam_cc.commands (id, actor_id, payload, result)
    VALUES (p_command_id, auth.uid(), p_payload, response);

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details, created_at)
    VALUES (
        auth.uid(),
        'CREATE',
        'CUENTA_CORRIENTE',
        order_id::text,
        jsonb_build_object('commandId', p_command_id, 'operacion', op, 'payload', p_payload, 'result', response),
        transaction_timestamp()
    );

    RETURN response || jsonb_build_object('reused', false);
END;
$$;

REVOKE ALL ON FUNCTION aciacam_cc.actor() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION aciacam_cc.command(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION aciacam_cc.command(uuid, jsonb) TO authenticated;

COMMIT;
