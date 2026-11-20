import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
    canDisplayDefinitiveGlobalBalance,
    formatCentavosAr,
    isValidPeriodo,
} from '../app/lib/cierres/cierre-service';

let passed = 0;
function test(name: string, fn: () => void) {
    fn();
    passed++;
    console.log(`✓ ${name}`);
}

function runSqlInRollbackTransaction(sqlBody: string): string {
    const ux04Prereq = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261119120000_ux04_product_aporte_unidad.sql'), 'utf8')
        .replace(/^BEGIN;/gm, '')
        .replace(/^COMMIT;/gm, '');
    const m1 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261120100000_cie01c_m1_effective_dates_and_cierres_v2.sql'), 'utf8')
        .replace(/^BEGIN;/gm, '')
        .replace(/^COMMIT;/gm, '');
    const m2 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261120110000_cie01c_m2_aciacam_cc_foundation.sql'), 'utf8')
        .replace(/^BEGIN;/gm, '')
        .replace(/^COMMIT;/gm, '');
    const m3 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261120120000_cie01c_m3_sec01_bridge_and_cierre_rpcs.sql'), 'utf8')
        .replace(/^BEGIN;/gm, '')
        .replace(/^COMMIT;/gm, '');

    const fullSql = `
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$auth$;
${ux04Prereq}
${m1}
${m2}
${m3}
${sqlBody}
ROLLBACK;
`;
    return execSync('docker exec -i aciacam-pg17-restore-test psql -U postgres -d prod_ux04_restore_20261119 -v ON_ERROR_STOP=1 -t -A', {
        input: fullSql,
        encoding: 'utf8',
    });
}

console.log('=== CIE-01C UNIT & PG17 TRANSACTIONAL SUITE ===');

test('CIE1C-U1: Validación de períodos, formato de centavos y regla de saldo definitivo', () => {
    assert.equal(isValidPeriodo('2026-11'), true);
    assert.equal(isValidPeriodo('2026-13'), false);
    assert.equal(formatCentavosAr(2500000), '$25.000');
    assert.equal(formatCentavosAr(-500000), '-$5.000');
    assert.equal(formatCentavosAr(null), 'Pendiente de conciliación');
    assert.equal(canDisplayDefinitiveGlobalBalance('nueva'), true);
    assert.equal(canDisplayDefinitiveGlobalBalance('conciliada'), true);
    assert.equal(canDisplayDefinitiveGlobalBalance('pendiente_conciliacion'), false);
});

test('CIE1C-PG1: Feature flag apagado por defecto, entrega sin aporte, aporte completo, parcial, posterior, bonificación, reversión, anti-duplicación y cierres v2', () => {
    const output = runSqlInRollbackTransaction(`
SET LOCAL client_min_messages = warning;
DO $$
DECLARE
    v_admin_auth uuid := gen_random_uuid();
    v_socio_auth uuid := gen_random_uuid();
    v_hist_auth uuid := gen_random_uuid();
    v_admin_id uuid := gen_random_uuid();
    v_socio_id uuid := gen_random_uuid();
    v_hist_id uuid := gen_random_uuid();
    v_prod_id uuid := gen_random_uuid();
    v_order_no_pay uuid := gen_random_uuid();
    v_order_partial uuid := gen_random_uuid();
    v_order_hist_new uuid := gen_random_uuid();
    v_cmd_1 uuid := gen_random_uuid();
    v_cmd_2 uuid := gen_random_uuid();
    v_cmd_3 uuid := gen_random_uuid();
    v_cmd_4 uuid := gen_random_uuid();
    v_cmd_5 uuid := gen_random_uuid();
    v_cmd_6 uuid := gen_random_uuid();
    v_cmd_cierre uuid := gen_random_uuid();
    v_res jsonb;
    v_mov_id uuid;
    v_saldo bigint;
    v_flag boolean;
    v_cierre_id uuid;
    v_cierre_rec record;
    v_pagos_count integer;
    v_aportes_count integer;
BEGIN
    -- 1. Verificar que aciacam_cc.config.enabled inicia en false
    SELECT enabled INTO v_flag FROM aciacam_cc.config WHERE singleton = true;
    IF v_flag IS NOT FALSE THEN
        RAISE EXCEPTION 'Feature flag debe iniciar desactivado';
    END IF;

    -- Crear usuarios y socios sintéticos en auth.users + public.socios
    INSERT INTO auth.users (id, email, last_sign_in_at)
    VALUES
        (v_admin_auth, 'cie1c_admin@test.invalid', now()),
        (v_socio_auth, 'cie1c_socio@test.invalid', now()),
        (v_hist_auth, 'cie1c_hist@test.invalid', now());

    INSERT INTO public.socios (id, auth_user_id, user_id, nombre, apellido, dni, email, rol, status, bloqueado, diagnostico)
    VALUES
        (v_admin_id, v_admin_auth, v_admin_auth, 'Admin', 'CIE01C', '99000111', 'cie1c_admin@test.invalid', 'admin', 'active', false, 'N/A'),
        (v_socio_id, v_socio_auth, v_socio_auth, 'Socio', 'Nuevo', '99000222', 'cie1c_socio@test.invalid', 'socio', 'active', false, 'Patologia Privada Test'),
        (v_hist_id, v_hist_auth, v_hist_auth, 'Socio', 'Historico', '99000333', 'cie1c_hist@test.invalid', 'socio', 'active', false, 'Patologia Privada Test');

    INSERT INTO public.products (id, nombre, categoria, tipo, peso_gramos, aporte_unidad, precio, stock_disponible, activo)
    VALUES (v_prod_id, 'Aceite CIE01C', 'aceites', 'aceite', 0, 25000, 25000, 100, true);

    -- Simular socio histórico con pago previo no conciliado
    INSERT INTO public.pagos (socio_id, fecha, concepto, monto, medio_de_pago, created_by)
    VALUES (v_hist_id, '2026-10-15', 'Pago histórico previo', 10000, 'efectivo', v_admin_auth);

    -- Activar flag solo dentro de la transacción de prueba
    UPDATE aciacam_cc.config SET enabled = true;

    -- Simular sesión autenticada de admin
    PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_auth, 'role', 'authenticated')::text, true);

    -- Crear pedidos sintéticos
    INSERT INTO public.pedidos (id, socio_id, tipo_pedido, estado, total, items)
    VALUES
        (v_order_no_pay, v_socio_id, 'retiro_sede', 'pendiente', 25000, jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'productoNombre', 'Aceite CIE01C', 'cantidad', 1, 'precioUnitario', 25000))),
        (v_order_partial, v_socio_id, 'retiro_sede', 'pendiente', 50000, jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'productoNombre', 'Aceite CIE01C', 'cantidad', 2, 'precioUnitario', 25000))),
        (v_order_hist_new, v_hist_id, 'retiro_sede', 'pendiente', 25000, jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'productoNombre', 'Aceite CIE01C', 'cantidad', 1, 'precioUnitario', 25000)));

    -- A. Entrega sin aporte inicial + reintento idempotente
    v_res := public.confirm_order_payment_command(v_cmd_1, v_order_no_pay, 'retirado', '[]'::jsonb, v_admin_auth);
    IF (v_res->>'reused')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'Debe ser reused=false'; END IF;
    v_res := public.confirm_order_payment_command(v_cmd_1, v_order_no_pay, 'retirado', '[]'::jsonb, v_admin_auth);
    IF (v_res->>'reused')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Reintento debe ser reused=true'; END IF;

    SELECT saldo_centavos INTO v_saldo FROM aciacam_cc.saldos_pedido WHERE pedido_id = v_order_no_pay;
    IF v_saldo <> 2500000 THEN RAISE EXCEPTION 'Saldo esperado 2500000, obtenido %', v_saldo; END IF;

    -- B. Entrega con aporte parcial (20000 de 50000) + verificación anti-duplicación pagos vs aportes
    v_res := public.confirm_order_payment_command(
        v_cmd_2, v_order_partial, 'retirado',
        jsonb_build_array(jsonb_build_object('monto', 20000, 'medio_de_pago', 'efectivo', 'concepto', 'Aporte parcial')),
        v_admin_auth
    );
    SELECT count(*) INTO v_pagos_count FROM public.pagos WHERE pedido_id = v_order_partial;
    SELECT count(*) INTO v_aportes_count FROM aciacam_cc.aportes WHERE pedido_id = v_order_partial;
    IF v_pagos_count <> 1 OR v_aportes_count <> 1 THEN
        RAISE EXCEPTION 'Doble contabilización detectada: pagos=% aportes=%', v_pagos_count, v_aportes_count;
    END IF;
    SELECT saldo_centavos INTO v_saldo FROM aciacam_cc.saldos_pedido WHERE pedido_id = v_order_partial;
    IF v_saldo <> 3000000 THEN RAISE EXCEPTION 'Saldo parcial esperado 3000000, obtenido %', v_saldo; END IF;

    -- C. Aporte posterior (15000) + bonificación (5000) + reversión de bonificación
    v_res := aciacam_cc.command(v_cmd_3, jsonb_build_object(
        'operacion', 'aportar', 'pedidoId', v_order_partial, 'centavos', 1500000, 'medio', 'transferencia_galicia', 'referencia', 'TRF-123', 'motivo', 'Pago posterior'
    ));
    IF (v_res->>'saldoCentavos')::bigint <> 1500000 THEN RAISE EXCEPTION 'Saldo tras pago posterior incorrecto'; END IF;

    v_res := aciacam_cc.command(v_cmd_4, jsonb_build_object(
        'operacion', 'bonificar', 'pedidoId', v_order_partial, 'centavos', 500000, 'motivo', 'Bonificación aprobada'
    ));
    v_mov_id := (v_res->>'movimientoId')::uuid;
    IF (v_res->>'saldoCentavos')::bigint <> 1000000 THEN RAISE EXCEPTION 'Saldo tras bonificación incorrecto'; END IF;

    v_res := aciacam_cc.command(v_cmd_5, jsonb_build_object(
        'operacion', 'revertir', 'pedidoId', v_order_partial, 'movimientoId', v_mov_id, 'motivo', 'Error en bonificación'
    ));
    IF (v_res->>'saldoCentavos')::bigint <> 1500000 THEN RAISE EXCEPTION 'Saldo tras reversión incorrecto'; END IF;

    -- D. Socio con historial pendiente puede operar normalmente sin saldo global definitivo
    v_res := public.confirm_order_payment_command(v_cmd_6, v_order_hist_new, 'retirado', '[]'::jsonb, v_admin_auth);
    v_res := public.get_socio_cuenta_corriente_summary(v_hist_id);
    IF (v_res->>'estadoHistorico') <> 'pendiente_conciliacion'
       OR (v_res->>'saldoCorrienteDesdeCorteCentavos')::bigint <> 2500000
       OR (v_res->>'saldoGlobalDefinitivoCentavos') IS NOT NULL THEN
        RAISE EXCEPTION 'Resumen de socio histórico incorrecto: %', v_res;
    END IF;

    -- E. Cierre mensual por período v2 (idempotente, excluye diagnosticoPrincipal, permite anulación y reemisión)
    v_res := public.confirm_period_close_command(v_cmd_cierre, to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM'), v_admin_auth);
    IF (v_res->>'reused')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'Primer cierre debe ser reused=false'; END IF;
    v_res := public.confirm_period_close_command(v_cmd_cierre, to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM'), v_admin_auth);
    IF (v_res->>'reused')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Reintento cierre debe ser reused=true'; END IF;

    SELECT * INTO v_cierre_rec FROM public.cierres_mensuales
    WHERE socio_id = v_socio_id AND estado = 'emitido' LIMIT 1;
    IF (v_cierre_rec.datos->'socio' ? 'diagnosticoPrincipal') THEN
        RAISE EXCEPTION 'Constancia v2 NO debe incluir diagnosticoPrincipal';
    END IF;

    -- Anular y reemitir constancia v2
    UPDATE public.cierres_mensuales SET estado = 'anulado', motivo_anulacion = 'Rectificación de prueba' WHERE id = v_cierre_rec.id;
    INSERT INTO public.cierres_mensuales (socio_id, periodo, schema_version, estado_conciliacion)
    VALUES (v_socio_id, v_cierre_rec.periodo, 2, 'nueva')
    RETURNING id INTO v_cierre_id;

    SELECT * INTO v_cierre_rec FROM public.cierres_mensuales WHERE id = v_cierre_id;
    IF v_cierre_rec.version <> 2 OR v_cierre_rec.estado <> 'emitido' THEN
        RAISE EXCEPTION 'Reemisión falló: version=% estado=%', v_cierre_rec.version, v_cierre_rec.estado;
    END IF;

    -- Fallo a mitad de transacción (subtransacción implícita) no debe dejar efectos parciales
    DECLARE
        v_count_before integer;
        v_count_after integer;
        v_err text;
    BEGIN
        SELECT count(*) INTO v_count_before FROM aciacam_cc.movimientos WHERE socio_id = v_socio_id;
        BEGIN
            PERFORM aciacam_cc.command(gen_random_uuid(), jsonb_build_object(
                'operacion', 'aportar', 'pedidoId', v_order_partial, 'centavos', 500000, 'medio', 'efectivo', 'motivo', 'Fallo forzado'
            ));
            RAISE EXCEPTION 'FORCED_MID_TX_ABORT';
        EXCEPTION WHEN OTHERS THEN
            v_err := SQLERRM;
        END;
        IF v_err NOT LIKE '%FORCED_MID_TX_ABORT%' THEN
            RAISE EXCEPTION 'Excepción inesperada en prueba mid-tx: %', v_err;
        END IF;
        SELECT count(*) INTO v_count_after FROM aciacam_cc.movimientos WHERE socio_id = v_socio_id;
        IF v_count_after <> v_count_before THEN
            RAISE EXCEPTION 'Rollback parcial falló: antes=% después=%', v_count_before, v_count_after;
        END IF;
    END;

END $$;
SELECT 'PG17_CIE01C_ALL_ASSERTIONS_OK';
`);
    assert.ok(output.includes('PG17_CIE01C_ALL_ASSERTIONS_OK'));
});

console.log(`=== CIE-01C SUITE COMPLETE: ${passed}/${passed} PASS ===`);
