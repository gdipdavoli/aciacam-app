import assert from 'node:assert/strict';
import { exec, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
    canDisplayDefinitiveGlobalBalance,
    formatCentavosAr,
    isValidPeriodo,
} from '../app/lib/cierres/cierre-service';

const execAsync = promisify(exec);

let passed = 0;
function test(name: string, fn: () => void) {
    fn();
    passed++;
    console.log(`✓ ${name}`);
}

async function testAsync(name: string, fn: () => Promise<void>) {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
}

function loadMigrationsSql(): string {
    const m1 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261120100000_cie01c_m1_effective_dates_and_cierres_v2.sql'), 'utf8')
        .replace(/^BEGIN;/gm, '')
        .replace(/^COMMIT;/gm, '');
    const m2 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261120110000_cie01c_m2_aciacam_cc_foundation.sql'), 'utf8')
        .replace(/^BEGIN;/gm, '')
        .replace(/^COMMIT;/gm, '');
    const m3 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261120120000_cie01c_m3_sec01_bridge_and_cierre_rpcs.sql'), 'utf8')
        .replace(/^BEGIN;/gm, '')
        .replace(/^COMMIT;/gm, '');
    return `${m1}\n${m2}\n${m3}`;
}

function runSqlInRollbackTransaction(dbName: string, sqlBody: string): string {
    const migrations = loadMigrationsSql();
    const fullSql = `
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$auth$;
${migrations}
${sqlBody}
ROLLBACK;
`;
    return execSync(`docker exec -i aciacam-pg17-restore-test psql -U postgres -d ${dbName} -v ON_ERROR_STOP=1 -t -A`, {
        input: fullSql,
        encoding: 'utf8',
    });
}

async function runSuite() {
    console.log('=== CIE-01C UNIT, INTEGRATION-SCHEMA PG17, RLS & CONCURRENCY SUITE ===');

    test('CIE1C-U1: Validación de períodos, formato de centavos y regla de saldo definitivo', () => {
        assert.equal(isValidPeriodo('2026-11'), true);
        assert.equal(isValidPeriodo('2026-13'), false);
        assert.equal(formatCentavosAr(2500000), '$25.000');
        assert.equal(formatCentavosAr(-500000), '-$5.000');
        assert.equal(formatCentavosAr(null), 'Pendiente de conciliación');
        assert.equal(canDisplayDefinitiveGlobalBalance('pendiente_conciliacion'), false);
        assert.equal(canDisplayDefinitiveGlobalBalance('conciliada'), true);
        assert.equal(canDisplayDefinitiveGlobalBalance('nueva'), true);
    });

    test('CIE1C-PG-INT: Compatibilidad exacta con Integration restaurado (flag off/on, pagos, normalización, cierres v1/v2 y rollback)', () => {
        const output = runSqlInRollbackTransaction('integration_restored_validation', `
DO $$
DECLARE
    v_admin_auth uuid := gen_random_uuid();
    v_socio_auth uuid := gen_random_uuid();
    v_hist_auth uuid := gen_random_uuid();
    v_hist_empty_auth uuid := gen_random_uuid();
    v_admin_id uuid := gen_random_uuid();
    v_socio_id uuid := gen_random_uuid();
    v_hist_id uuid := gen_random_uuid();
    v_hist_empty_id uuid := gen_random_uuid();
    v_prod_id uuid := gen_random_uuid();
    v_order_flag_off uuid := gen_random_uuid();
    v_order_no_pay uuid := gen_random_uuid();
    v_order_partial uuid := gen_random_uuid();
    v_order_hist_new uuid := gen_random_uuid();
    v_cmd_off uuid := gen_random_uuid();
    v_cmd_1 uuid := gen_random_uuid();
    v_cmd_2 uuid := gen_random_uuid();
    v_cmd_3 uuid := gen_random_uuid();
    v_cmd_4 uuid := gen_random_uuid();
    v_cmd_5 uuid := gen_random_uuid();
    v_cmd_cierre uuid := gen_random_uuid();
    v_res jsonb;
    v_flag boolean;
    v_saldo bigint;
    v_pagos_count integer;
    v_aportes_count integer;
    v_mov_id uuid;
    v_medio_norm text;
    v_estado_hist text;
    v_saldo_glob bigint;
    v_cierre_id uuid;
    v_cierre_rec public.cierres_mensuales%ROWTYPE;
    v_err text;
    v_count_before integer;
    v_count_after integer;
BEGIN
    -- 1. Feature flag inicia en false
    SELECT enabled INTO v_flag FROM aciacam_cc.config WHERE singleton = true;
    IF v_flag IS NOT FALSE THEN
        RAISE EXCEPTION 'Feature flag debe iniciar desactivado';
    END IF;

    INSERT INTO auth.users (id, email, last_sign_in_at)
    VALUES
        (v_admin_auth, 'cie1c_admin@test.invalid', now()),
        (v_socio_auth, 'cie1c_socio@test.invalid', now()),
        (v_hist_auth, 'cie1c_hist@test.invalid', now()),
        (v_hist_empty_auth, 'cie1c_hist_empty@test.invalid', now());

    INSERT INTO public.socios (id, auth_user_id, nombre, apellido, dni, email, rol, status, bloqueado, diagnostico, created_at)
    VALUES
        (v_admin_id, v_admin_auth, 'Admin', 'CIE01C', '99000111', 'cie1c_admin@test.invalid', 'admin', 'active', false, 'N/A', now()),
        (v_socio_id, v_socio_auth, 'Socio', 'Nuevo', '99000222', 'cie1c_socio@test.invalid', 'socio', 'active', false, 'Patologia Privada Test', now() + interval '1 second'),
        (v_hist_id, v_hist_auth, 'Socio', 'Historico', '99000333', 'cie1c_hist@test.invalid', 'socio', 'active', false, 'Patologia Privada Test', now() - interval '30 days'),
        (v_hist_empty_id, v_hist_empty_auth, 'Socio', 'HistoricoSinRegistros', '99000444', 'cie1c_hist_empty@test.invalid', 'socio', 'active', false, 'Patologia Privada Test', now() - interval '30 days');

    INSERT INTO public.products (id, nombre, categoria, tipo, peso_gramos, precio, stock_disponible, activo)
    VALUES (v_prod_id, 'Aceite CIE01C', 'aceites', 'aceite', 0, 25000, 100, true);

    INSERT INTO public.pagos (socio_id, fecha, concepto, monto, medio_de_pago, created_by)
    VALUES (v_hist_id, '2026-10-15', 'Pago histórico previo', 10000, 'Transferencia', v_admin_auth);

    -- Socio histórico sin registros digitales NO debe clasificarse como 'nueva' ni tener saldo global 0
    SELECT estado_historico, saldo_global_definitivo_centavos INTO v_estado_hist, v_saldo_glob
    FROM aciacam_cc.estado_cuenta_socio WHERE socio_id = v_hist_empty_id;
    IF v_estado_hist <> 'pendiente_conciliacion' OR v_saldo_glob IS NOT NULL THEN
        RAISE EXCEPTION 'Socio histórico sin registros digitales mal clasificado: % / %', v_estado_hist, v_saldo_glob;
    END IF;

    PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_auth, 'role', 'authenticated')::text, true);

    INSERT INTO public.pedidos (id, socio_id, tipo_pedido, estado, total, items)
    VALUES
        (v_order_flag_off, v_socio_id, 'retiro_sede', 'pendiente', 25000, jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'productoNombre', 'Aceite CIE01C', 'cantidad', 1, 'precioUnitario', 25000))),
        (v_order_no_pay, v_socio_id, 'retiro_sede', 'pendiente', 25000, jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'productoNombre', 'Aceite CIE01C', 'cantidad', 1, 'precioUnitario', 25000))),
        (v_order_partial, v_socio_id, 'retiro_sede', 'pendiente', 50000, jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'productoNombre', 'Aceite CIE01C', 'cantidad', 2, 'precioUnitario', 25000))),
        (v_order_hist_new, v_hist_id, 'retiro_sede', 'pendiente', 25000, jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'productoNombre', 'Aceite CIE01C', 'cantidad', 1, 'precioUnitario', 25000)));

    -- 2. Con flag en FALSE, confirm_order_payment_command preserva circuito clásico sin escribir en aciacam_cc
    v_res := public.confirm_order_payment_command(v_cmd_off, v_order_flag_off, 'retirado', jsonb_build_array(jsonb_build_object('monto', 25000, 'medio_de_pago', 'efectivo', 'concepto', 'Pago flag off')), v_admin_auth);
    IF EXISTS (SELECT 1 FROM aciacam_cc.cuentas_pedido WHERE pedido_id = v_order_flag_off) THEN
        RAISE EXCEPTION 'Con flag OFF no debe sincronizar aciacam_cc';
    END IF;

    -- Activar flag solo dentro de la transacción de prueba
    UPDATE aciacam_cc.config SET enabled = true;

    -- 3. Entrega sin aporte inicial + reintento idempotente
    v_res := public.confirm_order_payment_command(v_cmd_1, v_order_no_pay, 'retirado', '[]'::jsonb, v_admin_auth);
    IF (v_res->>'reused')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'Debe ser reused=false'; END IF;
    v_res := public.confirm_order_payment_command(v_cmd_1, v_order_no_pay, 'retirado', '[]'::jsonb, v_admin_auth);
    IF (v_res->>'reused')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Reintento debe ser reused=true'; END IF;

    SELECT saldo_centavos INTO v_saldo FROM aciacam_cc.saldos_pedido WHERE pedido_id = v_order_no_pay;
    IF v_saldo <> 2500000 THEN RAISE EXCEPTION 'Saldo esperado 2500000, obtenido %', v_saldo; END IF;

    -- 4. Entrega con aporte parcial + normalización de 'Transferencia' -> 'transferencia' (NO Galicia)
    v_res := public.confirm_order_payment_command(
        v_cmd_2, v_order_partial, 'retirado',
        jsonb_build_array(jsonb_build_object('monto', 20000, 'medio_de_pago', 'Transferencia', 'referencia', 'GEN-01', 'concepto', 'Aporte parcial')),
        v_admin_auth
    );
    SELECT medio INTO v_medio_norm FROM aciacam_cc.aportes WHERE pedido_id = v_order_partial;
    IF v_medio_norm <> 'transferencia' THEN
        RAISE EXCEPTION 'Transferencia genérica debe normalizarse a transferencia, no %', v_medio_norm;
    END IF;
    SELECT count(*) INTO v_pagos_count FROM public.pagos WHERE pedido_id = v_order_partial;
    SELECT count(*) INTO v_aportes_count FROM aciacam_cc.aportes WHERE pedido_id = v_order_partial;
    IF v_pagos_count <> 1 OR v_aportes_count <> 1 THEN
        RAISE EXCEPTION 'Doble contabilización detectada: pagos=% aportes=%', v_pagos_count, v_aportes_count;
    END IF;

    -- 5. Aporte posterior + bonificación + reversión + validación UUID controlado
    BEGIN
        PERFORM aciacam_cc.command(gen_random_uuid(), jsonb_build_object('operacion', 'aportar', 'pedidoId', 'no-es-uuid', 'centavos', 100, 'medio', 'efectivo', 'motivo', 'Test'));
        RAISE EXCEPTION 'Debió fallar con CC_COMANDO_INVALIDO';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%CC_COMANDO_INVALIDO%' THEN RAISE; END IF;
    END;

    v_res := aciacam_cc.command(v_cmd_3, jsonb_build_object(
        'operacion', 'aportar', 'pedidoId', v_order_partial, 'centavos', 1500000, 'medio', 'transferencia_galicia', 'referencia', 'TRF-123', 'motivo', 'Pago posterior'
    ));
    v_res := aciacam_cc.command(v_cmd_4, jsonb_build_object(
        'operacion', 'bonificar', 'pedidoId', v_order_partial, 'centavos', 500000, 'motivo', 'Bonificación prueba'
    ));
    v_mov_id := (v_res->>'movimientoId')::uuid;
    v_res := aciacam_cc.command(v_cmd_5, jsonb_build_object(
        'operacion', 'revertir', 'pedidoId', v_order_partial, 'movimientoId', v_mov_id, 'motivo', 'Reversión bonificación'
    ));
    SELECT saldo_centavos INTO v_saldo FROM aciacam_cc.saldos_pedido WHERE pedido_id = v_order_partial;
    IF v_saldo <> 1500000 THEN RAISE EXCEPTION 'Saldo tras reversión esperado 1500000, obtenido %', v_saldo; END IF;

    -- 6. Socio histórico pendiente: opera normalmente pero mantiene saldo_global_definitivo = NULL
    PERFORM public.confirm_order_payment_command(gen_random_uuid(), v_order_hist_new, 'retirado', '[]'::jsonb, v_admin_auth);
    SELECT estado_historico, saldo_global_definitivo_centavos INTO v_estado_hist, v_saldo_glob
    FROM aciacam_cc.estado_cuenta_socio WHERE socio_id = v_hist_id;
    IF v_estado_hist <> 'pendiente_conciliacion' OR v_saldo_glob IS NOT NULL THEN
        RAISE EXCEPTION 'Histórico pendiente no debe tener saldo global definitivo: % / %', v_estado_hist, v_saldo_glob;
    END IF;

    -- 7. Cierre v1 compatible + cierre v2 por período + conflicto de idempotencia + anulación y reemisión
    INSERT INTO public.cierres_mensuales (socio_id, periodo, schema_version)
    VALUES (v_hist_id, '2026-09', 1) RETURNING id INTO v_cierre_id;
    SELECT * INTO v_cierre_rec FROM public.cierres_mensuales WHERE id = v_cierre_id;
    IF NOT (v_cierre_rec.datos->'socio' ? 'diagnosticoPrincipal') THEN
        RAISE EXCEPTION 'Constancia v1 debe conservar compatibilidad de esquema';
    END IF;

    v_res := public.confirm_period_close_command(v_cmd_cierre, to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM'), v_admin_auth);
    IF (v_res->>'reused')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'Cierre nuevo debe ser reused=false'; END IF;
    v_res := public.confirm_period_close_command(v_cmd_cierre, to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM'), v_admin_auth);
    IF (v_res->>'reused')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Reintento cierre debe ser reused=true'; END IF;

    BEGIN
        PERFORM public.confirm_period_close_command(v_cmd_cierre, '2026-01', v_admin_auth);
        RAISE EXCEPTION 'Debió fallar con CIERRE_COMMAND_CONFLICT';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%CIERRE_COMMAND_CONFLICT%' THEN RAISE; END IF;
    END;

    SELECT * INTO v_cierre_rec FROM public.cierres_mensuales
    WHERE socio_id = v_socio_id AND periodo = to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') AND estado = 'emitido' LIMIT 1;
    IF (v_cierre_rec.datos->'socio' ? 'diagnosticoPrincipal') THEN
        RAISE EXCEPTION 'Constancia v2 NO debe incluir diagnosticoPrincipal';
    END IF;

    UPDATE public.cierres_mensuales SET estado = 'anulado', motivo_anulacion = 'Rectificación' WHERE id = v_cierre_rec.id;
    INSERT INTO public.cierres_mensuales (socio_id, periodo, schema_version, estado_conciliacion)
    VALUES (v_socio_id, v_cierre_rec.periodo, 2, 'nueva') RETURNING id INTO v_cierre_id;
    SELECT * INTO v_cierre_rec FROM public.cierres_mensuales WHERE id = v_cierre_id;
    IF v_cierre_rec.version <> 2 OR v_cierre_rec.estado <> 'emitido' THEN
        RAISE EXCEPTION 'Reemisión falló: version=% estado=%', v_cierre_rec.version, v_cierre_rec.estado;
    END IF;

    -- 8. Rollback completo ante fallo transaccional
    SELECT count(*) INTO v_count_before FROM aciacam_cc.movimientos WHERE socio_id = v_socio_id;
    BEGIN
        PERFORM aciacam_cc.command(gen_random_uuid(), jsonb_build_object(
            'operacion', 'aportar', 'pedidoId', v_order_partial, 'centavos', 500000, 'medio', 'efectivo', 'motivo', 'Fallo forzado'
        ));
        RAISE EXCEPTION 'FORCED_MID_TX_ABORT';
    EXCEPTION WHEN OTHERS THEN
        v_err := SQLERRM;
    END;
    IF v_err NOT LIKE '%FORCED_MID_TX_ABORT%' THEN RAISE EXCEPTION 'Error inesperado: %', v_err; END IF;
    SELECT count(*) INTO v_count_after FROM aciacam_cc.movimientos WHERE socio_id = v_socio_id;
    IF v_count_after <> v_count_before THEN
        RAISE EXCEPTION 'Rollback parcial falló';
    END IF;
END $$;
SELECT 'PG17_INTEGRATION_COMPAT_OK';
`);
        assert.ok(output.includes('PG17_INTEGRATION_COMPAT_OK'));
    });

    test('CIE1C-SEC-RLS: Privilegios mínimos, RLS y aislamiento por rol (socio, staff, admin)', () => {
        const output = runSqlInRollbackTransaction('integration_restored_validation', `
DO $$
DECLARE
    v_admin_auth uuid := gen_random_uuid();
    v_staff_auth uuid := gen_random_uuid();
    v_socio_auth uuid := gen_random_uuid();
    v_other_auth uuid := gen_random_uuid();
    v_socio_id uuid := gen_random_uuid();
    v_other_id uuid := gen_random_uuid();
    v_res jsonb;
BEGIN
    INSERT INTO auth.users (id, email, last_sign_in_at) VALUES
        (v_admin_auth, 'sec_admin@test.invalid', now()),
        (v_staff_auth, 'sec_staff@test.invalid', now()),
        (v_socio_auth, 'sec_socio@test.invalid', now()),
        (v_other_auth, 'sec_other@test.invalid', now());

    INSERT INTO public.socios (id, auth_user_id, nombre, apellido, dni, email, rol, status, bloqueado) VALUES
        (gen_random_uuid(), v_admin_auth, 'Admin', 'Sec', '88000111', 'sec_admin@test.invalid', 'admin', 'active', false),
        (gen_random_uuid(), v_staff_auth, 'Staff', 'Sec', '88000222', 'sec_staff@test.invalid', 'staff', 'active', false),
        (v_socio_id, v_socio_auth, 'Socio', 'Sec', '88000333', 'sec_socio@test.invalid', 'socio', 'active', false),
        (v_other_id, v_other_auth, 'Other', 'Sec', '88000444', 'sec_other@test.invalid', 'socio', 'active', false);

    UPDATE aciacam_cc.config SET enabled = true;

    -- Simular rol authenticated como SOCIO
    PERFORM set_config('request.jwt.claim.sub', v_socio_auth::text, true);
    SET LOCAL ROLE authenticated;

    -- 1. Socio no puede acceder al esquema aciacam_cc
    BEGIN
        PERFORM count(*) FROM aciacam_cc.movimientos;
        RAISE EXCEPTION 'Socio no debe poder leer aciacam_cc.movimientos';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- 2. Socio no puede mutar public.cierres_periodo ni llamar confirm_period_close_command
    BEGIN
        INSERT INTO public.cierres_periodo (periodo) VALUES ('2026-11');
        RAISE EXCEPTION 'Authenticated no debe tener INSERT directo en cierres_periodo';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        PERFORM public.confirm_period_close_command(gen_random_uuid(), '2026-11', v_socio_auth);
        RAISE EXCEPTION 'Socio no debe poder cerrar período';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%CIERRE_UNAUTHORIZED%' THEN RAISE; END IF;
    END;

    -- 3. Socio no puede leer cuenta corriente de otro socio, pero sí la propia
    BEGIN
        PERFORM public.get_socio_cuenta_corriente_summary(v_other_id);
        RAISE EXCEPTION 'Socio no debe ver cuenta corriente ajena';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%No autorizado%' THEN RAISE; END IF;
    END;
    v_res := public.get_socio_cuenta_corriente_summary(v_socio_id);
    IF (v_res->>'found')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Socio debe poder leer su propia cuenta corriente';
    END IF;

    -- 4. Staff no puede ejecutar operaciones exclusivas de admin ni insertar directo en cierres_periodo
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', v_staff_auth::text, true);
    SET LOCAL ROLE authenticated;

    BEGIN
        INSERT INTO public.cierres_periodo (periodo) VALUES ('2026-11');
        RAISE EXCEPTION 'Staff tampoco debe tener INSERT directo en cierres_periodo';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        PERFORM public.cc_command(gen_random_uuid(), jsonb_build_object(
            'operacion', 'bonificar', 'pedidoId', gen_random_uuid(), 'centavos', 100, 'motivo', 'Test staff'
        ));
        RAISE EXCEPTION 'Staff no debe poder bonificar';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%CC_ADMIN_REQUERIDO%' THEN RAISE; END IF;
    END;

    RESET ROLE;
END $$;
SELECT 'PG17_SEC_RLS_OK';
`);
        assert.ok(output.includes('PG17_SEC_RLS_OK'));
    });

    await testAsync('CIE1C-CONC: Concurrencia real en 2 conexiones paralelas (entregas y cierre de período)', async () => {
        const tempDb = 'cie01c_conc_test';
        const migrations = loadMigrationsSql();
        execSync(`docker exec -i aciacam-pg17-restore-test psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${tempDb} WITH (FORCE);" -c "CREATE DATABASE ${tempDb} TEMPLATE integration_restored_validation;"`, { stdio: 'pipe' });
        try {
            const idsRaw = execSync(`docker exec -i aciacam-pg17-restore-test psql -U postgres -d ${tempDb} -v ON_ERROR_STOP=1 -t -A`, {
                input: `
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$auth$;
${migrations}
UPDATE aciacam_cc.config SET enabled = true;
DO $$
DECLARE
    v_admin_auth uuid := '11111111-1111-4111-8111-111111111111';
    v_socio_id uuid := '22222222-2222-4222-8222-222222222222';
    v_prod_id uuid := '33333333-3333-4333-8333-333333333333';
    v_order_id uuid := '44444444-4444-4444-8444-444444444444';
BEGIN
    INSERT INTO auth.users (id, email, last_sign_in_at) VALUES (v_admin_auth, 'conc_admin@test.invalid', now());
    INSERT INTO public.socios (id, auth_user_id, nombre, apellido, dni, email, rol, status, bloqueado)
    VALUES (gen_random_uuid(), v_admin_auth, 'Conc', 'Admin', '77000111', 'conc_admin@test.invalid', 'admin', 'active', false);
    INSERT INTO public.socios (id, nombre, apellido, dni, email, rol, status, bloqueado)
    VALUES (v_socio_id, 'Conc', 'Socio', '77000222', 'conc_socio@test.invalid', 'socio', 'active', false);
    INSERT INTO public.products (id, nombre, categoria, tipo, peso_gramos, precio, stock_disponible, activo)
    VALUES (v_prod_id, 'Aceite Conc', 'aceites', 'aceite', 0, 10000, 50, true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);
    INSERT INTO public.pedidos (id, socio_id, tipo_pedido, estado, total, items)
    VALUES (v_order_id, v_socio_id, 'retiro_sede', 'pendiente', 10000, jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'productoNombre', 'Aceite Conc', 'cantidad', 1, 'precioUnitario', 10000)));
END $$;
SELECT 'CONC_SEED_OK';
`,
                encoding: 'utf8',
            });
            assert.ok(idsRaw.includes('CONC_SEED_OK'));

            // 1. Dos entregas concurrentes sobre el mismo pedido con distinto command_id
            const runConcurrentOrder = (cmdId: string) =>
                execAsync(`docker exec -i aciacam-pg17-restore-test psql -U postgres -d ${tempDb} -v ON_ERROR_STOP=1 -t -A -c "SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true); SELECT public.confirm_order_payment_command('${cmdId}'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, 'retirado', '[]'::jsonb, '11111111-1111-4111-8111-111111111111'::uuid);"`)
                    .then(() => ({ ok: true, err: '' }))
                    .catch((e) => ({ ok: false, err: String(e.stderr || e.message) }));

            const orderResults = await Promise.all([
                runConcurrentOrder('aaaa1111-1111-4111-8111-111111111111'),
                runConcurrentOrder('aaaa2222-2222-4222-8222-222222222222'),
            ]);
            assert.equal(orderResults.filter((r) => r.ok).length, 1);
            assert.equal(orderResults.filter((r) => !r.ok && r.err.includes('PAYMENT_ORDER_ALREADY_FINALIZED')).length, 1);

            // 2. Dos cierres concurrentes sobre el mismo período con distinto command_id
            const runConcurrentClose = (cmdId: string) =>
                execAsync(`docker exec -i aciacam-pg17-restore-test psql -U postgres -d ${tempDb} -v ON_ERROR_STOP=1 -t -A -c "SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true); SELECT public.confirm_period_close_command('${cmdId}'::uuid, '2026-11', '11111111-1111-4111-8111-111111111111'::uuid);"`)
                    .then(() => ({ ok: true, err: '' }))
                    .catch((e) => ({ ok: false, err: String(e.stderr || e.message) }));

            const closeResults = await Promise.all([
                runConcurrentClose('bbbb1111-1111-4111-8111-111111111111'),
                runConcurrentClose('bbbb2222-2222-4222-8222-222222222222'),
            ]);
            assert.equal(closeResults.filter((r) => r.ok).length, 1);
            assert.equal(closeResults.filter((r) => !r.ok && r.err.includes('CIERRE_PERIODO_YA_CERRADO')).length, 1);
        } finally {
            execSync(`docker exec -i aciacam-pg17-restore-test psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS ${tempDb} WITH (FORCE);"`, { stdio: 'pipe' });
        }
    });

    console.log(`=== CIE-01C SUITE COMPLETE: ${passed}/${passed} PASS ===`);
}

runSuite().catch((err) => {
    console.error(err);
    process.exit(1);
});
