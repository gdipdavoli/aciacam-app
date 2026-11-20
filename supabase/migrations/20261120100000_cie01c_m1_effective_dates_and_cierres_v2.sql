-- CIE-01C M1: Fecha efectiva de entrega, cierres_periodo y versionado compatible de cierres_mensuales (v2 sin datos clínicos)
BEGIN;

-- 1. Fecha efectiva de entrega en pedidos (nunca inferida retroactivamente desde created_at)
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS fecha_entrega_efectiva timestamptz;

CREATE OR REPLACE FUNCTION app_private.set_pedido_fecha_entrega_efectiva()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW.estado IN ('entregado', 'retirado')
       AND (OLD.estado IS DISTINCT FROM NEW.estado)
       AND NEW.fecha_entrega_efectiva IS NULL THEN
        NEW.fecha_entrega_efectiva := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_z_pedidos_set_fecha_entrega_efectiva ON public.pedidos;
CREATE TRIGGER tr_z_pedidos_set_fecha_entrega_efectiva
    BEFORE UPDATE ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION app_private.set_pedido_fecha_entrega_efectiva();

-- 2. Cierres administrativos por período
CREATE TABLE IF NOT EXISTS public.cierres_periodo (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    periodo varchar(7) NOT NULL UNIQUE CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    estado varchar(20) NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'validado', 'cerrado', 'anulado')),
    resumen_totales jsonb NOT NULL DEFAULT '{}'::jsonb,
    hallazgos jsonb NOT NULL DEFAULT '[]'::jsonb,
    command_id uuid UNIQUE,
    cerrado_por uuid,
    cerrado_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cierres_periodo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cierres_periodo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cierres_periodo TO authenticated;

DROP POLICY IF EXISTS cierres_periodo_read ON public.cierres_periodo;
CREATE POLICY cierres_periodo_read ON public.cierres_periodo
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS cierres_periodo_write ON public.cierres_periodo;

-- 3. Evolución compatible de public.cierres_mensuales (reemisión tras anulación + schema_version v2)
ALTER TABLE public.cierres_mensuales
    ADD COLUMN IF NOT EXISTS cierre_periodo_id uuid REFERENCES public.cierres_periodo(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS command_id uuid UNIQUE,
    ADD COLUMN IF NOT EXISTS estado_conciliacion text NOT NULL DEFAULT 'pendiente_conciliacion';

ALTER TABLE public.cierres_mensuales
    DROP CONSTRAINT IF EXISTS cierres_mensuales_socio_id_periodo_key;

CREATE UNIQUE INDEX IF NOT EXISTS cierres_mensuales_socio_periodo_emitido_uniq
    ON public.cierres_mensuales (socio_id, periodo)
    WHERE estado = 'emitido';

-- 4. Actualizar trigger prepare_monthly_close manteniendo intactos históricos v1, privilegios mínimos (SECURITY DEFINER + search_path seguro) y v2 sin datos clínicos
CREATE OR REPLACE FUNCTION app_private.prepare_monthly_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_socio public.socios;
    v_start timestamptz;
    v_end timestamptz;
    v_orders jsonb;
    v_payments jsonb;
    v_next_version integer;
    v_schema_ver integer := COALESCE(NEW.schema_version, 1);
    v_pie_legal text := 'Los importes consignados corresponden exclusivamente a aportes voluntarios destinados al sostenimiento del programa de cultivo solidario desarrollado por la Asociación Civil para la Investigación y el Acceso del Cannabis Medicinal (ACIACAM), en cumplimiento de su Estatuto Social, de la Ley 27.350, su Decreto Reglamentario 883/2020, la Resolución MS 800/2021 y demás normativa aplicable. Dichos aportes no constituyen precio de venta ni contraprestación comercial por los productos dispensados.';
BEGIN
    IF auth.uid() IS NULL OR COALESCE(public.get_my_role(), '') NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Anulá la constancia; no se elimina';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - ARRAY['estado', 'fecha_anulacion', 'motivo_anulacion', 'anulado_por'])
           IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['estado', 'fecha_anulacion', 'motivo_anulacion', 'anulado_por'])
           OR OLD.estado <> 'emitido'
           OR NEW.estado <> 'anulado'
           OR nullif(trim(NEW.motivo_anulacion), '') IS NULL THEN
            RAISE EXCEPTION 'Solo se permite anular una constancia emitida con motivo';
        END IF;
        NEW.fecha_anulacion := now();
        NEW.anulado_por := auth.uid();
        RETURN NEW;
    END IF;

    IF NEW.periodo !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Período inválido';
    END IF;

    v_start := (NEW.periodo || '-01')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires';
    v_end := ((NEW.periodo || '-01')::date + interval '1 month')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires';

    SELECT * INTO STRICT v_socio FROM public.socios WHERE id = NEW.socio_id;

    SELECT COALESCE(max(version), 0) + 1
    INTO v_next_version
    FROM public.cierres_mensuales
    WHERE socio_id = NEW.socio_id AND periodo = NEW.periodo;

    NEW.version := GREATEST(COALESCE(NEW.version, 1), v_next_version);
    NEW.schema_version := v_schema_ver;

    IF v_schema_ver >= 2 THEN
        -- Si el caller (confirm_period_close_command) ya armó datos v2 enriquecidos con cuenta corriente, evitar consultas redundantes y solo asegurar 'version'
        IF NEW.datos IS NOT NULL AND NEW.datos <> '{}'::jsonb AND (NEW.datos ? 'resumen_cuenta') THEN
            IF NOT (NEW.datos ? 'version') THEN
                NEW.datos := jsonb_set(NEW.datos, '{version}', to_jsonb(NEW.version), true);
            END IF;
        ELSE
            -- En v2 se usa fecha_entrega_efectiva (si existe) y se excluye diagnosticoPrincipal
            SELECT
                (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'pedidoId', p.id,
                    'fecha', COALESCE(p.fecha_entrega_efectiva, p.updated_at),
                    'items', p.items,
                    'total', p.total,
                    'operador', 'Sistema ACIACAM'
                ) ORDER BY COALESCE(p.fecha_entrega_efectiva, p.updated_at), p.id), '[]'::jsonb)
                 FROM public.pedidos p
                 WHERE p.socio_id = NEW.socio_id
                   AND p.estado IN ('entregado', 'retirado')
                   AND p.fecha_entrega_efectiva IS NOT NULL
                   AND p.fecha_entrega_efectiva >= v_start
                   AND p.fecha_entrega_efectiva < v_end),
                (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'pagoId', p.id,
                    'pedidoId', p.pedido_id,
                    'fecha', p.fecha,
                    'concepto', p.concepto,
                    'medioDePago', p.medio_de_pago,
                    'referencia', p.referencia,
                    'monto', p.monto
                ) ORDER BY p.fecha, p.id), '[]'::jsonb)
                 FROM public.pagos p
                 WHERE p.socio_id = NEW.socio_id
                   AND p.fecha >= (NEW.periodo || '-01')::date
                   AND p.fecha < ((NEW.periodo || '-01')::date + interval '1 month')::date)
            INTO v_orders, v_payments;

            NEW.datos := jsonb_build_object(
                'schema_version', 2,
                'version', NEW.version,
                'socio', jsonb_build_object(
                    'id', v_socio.id,
                    'nombre', v_socio.nombre,
                    'apellido', v_socio.apellido,
                    'dni', v_socio.dni,
                    'email', v_socio.email,
                    'ordenLibro', to_jsonb(v_socio)->>'orden_libro',
                    'actaNumero', to_jsonb(v_socio)->>'acta_numero',
                    'reprocann', jsonb_build_object(
                        'numeroTramite', v_socio.reprocann_num_tramite,
                        'fechaAlta', v_socio.reprocann_fecha_alta,
                        'fechaVencimiento', v_socio.reprocann_fecha_vencimiento,
                        'tipo', v_socio.reprocann_tipo,
                        'estado', to_jsonb(v_socio)->>'reprocann_estado'
                    )
                ),
                'resumen_cuenta', jsonb_build_object(
                    'estado_historico', COALESCE(NEW.estado_conciliacion, 'pendiente_conciliacion'),
                    'saldo_inicial_centavos', NULL,
                    'saldo_corriente_periodo_centavos', NULL,
                    'saldo_final_definitivo_centavos', NULL
                ),
                'dispensas', v_orders,
                'aportes', v_payments,
                'bonificaciones_ajustes', '[]'::jsonb,
                'version_pie_legal', 2,
                'pie_legal', v_pie_legal
            );
        END IF;
    ELSE
        -- Compatibilidad estricta v1
        SELECT
            (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'pedidoId', p.id,
                'fecha', p.created_at,
                'items', p.items,
                'operador', 'Sistema ACIACAM'
            ) ORDER BY p.created_at, p.id), '[]'::jsonb)
             FROM public.pedidos p
             WHERE p.socio_id = NEW.socio_id
               AND p.estado IN ('entregado', 'retirado')
               AND p.created_at >= v_start
               AND p.created_at < v_end),
            (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'fecha', p.fecha,
                'concepto', p.concepto,
                'medioDePago', p.medio_de_pago,
                'referencia', p.referencia,
                'monto', p.monto
            ) ORDER BY p.fecha, p.id), '[]'::jsonb)
             FROM public.pagos p
             WHERE p.socio_id = NEW.socio_id
               AND p.fecha >= (NEW.periodo || '-01')::date
               AND p.fecha < ((NEW.periodo || '-01')::date + interval '1 month')::date)
        INTO v_orders, v_payments;

        NEW.datos := jsonb_build_object(
            'socio', jsonb_build_object(
                'id', v_socio.id,
                'nombre', v_socio.nombre,
                'apellido', v_socio.apellido,
                'dni', v_socio.dni,
                'email', v_socio.email,
                'diagnosticoPrincipal', v_socio.diagnostico,
                'reprocann', jsonb_build_object(
                    'numeroTramite', v_socio.reprocann_num_tramite,
                    'fechaAlta', v_socio.reprocann_fecha_alta,
                    'fechaVencimiento', v_socio.reprocann_fecha_vencimiento,
                    'tipo', v_socio.reprocann_tipo,
                    'estado', to_jsonb(v_socio)->>'reprocann_estado'
                )
            ),
            'dispensas', v_orders,
            'aportes', v_payments,
            'version_pie_legal', 1,
            'pie_legal', v_pie_legal
        );
    END IF;

    NEW.hash_sha256 := encode(sha256(convert_to(NEW.datos::text, 'UTF8')), 'hex');
    NEW.generado_por := auth.uid();
    NEW.fecha_generacion := now();
    NEW.estado := 'emitido';
    NEW.fecha_anulacion := NULL;
    NEW.motivo_anulacion := NULL;
    NEW.anulado_por := NULL;
    RETURN NEW;
END;
$$;

COMMIT;
