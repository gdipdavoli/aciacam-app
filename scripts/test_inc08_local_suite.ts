import assert from 'node:assert/strict';
import { exec, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

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

function runInProdRestoreRollback(sqlBody: string): string {
    const ux041 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261119150000_ux04_1_direct_delivery_from_active_states.sql'), 'utf8')
        .replace(/^BEGIN;/gm, '').replace(/^COMMIT;/gm, '');
    const inc08 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261120140000_inc08_dispensation_eligibility_separation.sql'), 'utf8')
        .replace(/^BEGIN;/gm, '').replace(/^COMMIT;/gm, '');
    const fullSql = `
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$auth$;
${ux041}
${inc08}
${sqlBody}
ROLLBACK;
`;
    return execSync('docker exec -i aciacam-pg17-restore-test psql -U postgres -d prod_ux04_restore_20261119 -v ON_ERROR_STOP=1 -t -A', {
        input: fullSql,
        encoding: 'utf8',
    });
}

console.log('=== INC-08 NON-RESTRICTIVE 3-OPERATION ELIGIBILITY, HISTORICAL & SECURITY SUITE ===');

test('INC08-PG-10: Modelo no restrictivo (3 operaciones, advertencias sin bloqueo, impedimentos confirmados, reconocimiento físico, histórico y permisos)', () => {
    const out = runInProdRestoreRollback(`
DO $$
DECLARE
    v_admin_auth uuid := gen_random_uuid();
    v_staff_auth uuid := gen_random_uuid();
    v_socio_auth uuid := gen_random_uuid();
    v_s_invited_nodoc uuid := gen_random_uuid();
    v_s_active_nodoc  uuid := gen_random_uuid();
    v_s_pend_rev      uuid := gen_random_uuid();
    v_s_exp           uuid := gen_random_uuid();
    v_s_rej           uuid := gen_random_uuid();
    v_s_blk           uuid := gen_random_uuid();
    v_prod_flor       uuid := gen_random_uuid();
    v_o1 uuid;
    v_o2 uuid;
    v_o_exp uuid;
    v_o_rej uuid;
    v_eval jsonb;
    v_res jsonb;
    v_stock_pre integer;
    v_exc_id uuid;
    v_cmd_hist uuid := gen_random_uuid();
BEGIN
    INSERT INTO auth.users (id, email, last_sign_in_at) VALUES
        (v_admin_auth, 'inc08_admin@test.invalid', now()),
        (v_staff_auth, 'inc08_staff@test.invalid', now()),
        (v_socio_auth, 'inc08_socio@test.invalid', now());

    INSERT INTO public.socios (id, auth_user_id, user_id, nombre, apellido, dni, email, rol, status, bloqueado, admision_institucional_estado, reprocann_estado, reprocann_fecha_vencimiento)
    VALUES
        (gen_random_uuid(), v_admin_auth, v_admin_auth, 'Admin', 'INC08', '55100100', 'inc08_admin@test.invalid', 'admin', 'active', false, 'admitido', 'aprobado', (current_date + 180)),
        (gen_random_uuid(), v_staff_auth, v_staff_auth, 'Staff', 'INC08', '55100109', 'inc08_staff@test.invalid', 'staff', 'active', false, 'admitido', 'aprobado', (current_date + 180)),
        (v_s_invited_nodoc, NULL, NULL, 'Socio', 'InvitedNoDoc', '55100101', 's_inv@test.invalid', 'socio', 'invited', false, 'admitido', NULL, NULL),
        (v_s_active_nodoc, v_socio_auth, v_socio_auth, 'Socio', 'ActiveNoDoc', '55100102', 'inc08_socio@test.invalid', 'socio', 'active', false, 'admitido', NULL, NULL),
        (v_s_pend_rev, NULL, NULL, 'Socio', 'PendRev', '55100103', 's_prev@test.invalid', 'socio', 'invited', false, 'admitido', NULL, NULL),
        (v_s_exp, NULL, NULL, 'Socio', 'ReproExp', '55100105', 's_exp@test.invalid', 'socio', 'invited', false, 'admitido', 'aprobado', (current_date - 1)),
        (v_s_rej, NULL, NULL, 'Socio', 'ReproRej', '55100107', 's_rej@test.invalid', 'socio', 'active', false, 'admitido', 'rechazado', NULL),
        (v_s_blk, NULL, NULL, 'Socio', 'Bloqueado', '55100106', 's_blk@test.invalid', 'socio', 'active', true, 'admitido', 'aprobado', (current_date + 180));

    PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

    -- Docs pendientes de revisión (sin vencimiento) para v_s_pend_rev; reprocann vencido confirmado para v_s_exp
    INSERT INTO public.documentos_socio (socio_id, tipo, archivo_path, verificacion_estado, fecha_emision, fecha_vencimiento, is_current)
    VALUES
        (v_s_pend_rev::text, 'reprocann', 'synthetic/r.pdf', 'pendiente', NULL, NULL, true),
        (v_s_pend_rev::text, 'consentimiento', 'synthetic/c.pdf', 'pendiente', NULL, NULL, true),
        (v_s_exp::text, 'reprocann', 'synthetic/exp.pdf', 'aprobado', (current_date - 400), (now() - interval '1 day'), true);

    INSERT INTO public.products (id, nombre, categoria, tipo, peso_gramos, precio, stock_disponible, activo)
    VALUES (v_prod_flor, 'Flor INC08', 'flores', 'flor', 10, 50000, 30, true);

    -- 1. Socio 'invited' sin documentos digitalizados -> NO bloquea pedido ni entrega; genera advertencias
    v_eval := public.get_socio_dispensation_eligibility(v_s_invited_nodoc);
    IF (v_eval->>'puedeSolicitar')::boolean IS NOT FALSE
       OR (v_eval->>'puedeRegistrarPedido')::boolean IS NOT TRUE
       OR (v_eval->>'puedeFinalizarDispensa')::boolean IS NOT TRUE
       OR (v_eval->>'requiereRegularizacion')::boolean IS NOT TRUE
       OR v_eval->>'accesoDigitalEstado' <> 'invitado'
       OR NOT ((v_eval->'advertenciasDocumentales') ? 'REPROCANN_NO_CARGADO')
       OR NOT ((v_eval->'advertenciasDocumentales') ? 'CONSENTIMIENTO_NO_CARGADO')
       OR NOT ((v_eval->'advertenciasDocumentales') ? 'DDJJ_NO_CARGADA')
       OR jsonb_array_length(v_eval->'bloqueosObligatorios') <> 0 THEN
        RAISE EXCEPTION 'Caso 1 inesperado: %', v_eval;
    END IF;

    SELECT stock_disponible INTO v_stock_pre FROM public.products WHERE id = v_prod_flor;
    INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
    VALUES (v_s_invited_nodoc, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid())
    RETURNING id INTO v_o1;
    PERFORM public.confirm_order_payment_command(gen_random_uuid(), v_o1, 'retirado', '[]'::jsonb, v_admin_auth);
    IF (SELECT stock_disponible FROM public.products WHERE id = v_prod_flor) <> (v_stock_pre - 1) THEN
        RAISE EXCEPTION 'Caso 1: stock debió descontar exactamente 1';
    END IF;

    -- 2. Socio 'active' sin documentos digitalizados -> puedeSolicitar=true y puede crear su pedido
    PERFORM set_config('request.jwt.claim.sub', v_socio_auth::text, true);
    v_eval := public.get_socio_dispensation_eligibility(v_s_active_nodoc);
    IF (v_eval->>'puedeSolicitar')::boolean IS NOT TRUE
       OR (v_eval->>'puedeRegistrarPedido')::boolean IS NOT TRUE
       OR (v_eval->>'puedeFinalizarDispensa')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Caso 2 inesperado: %', v_eval;
    END IF;
    INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
    VALUES (v_s_active_nodoc, 'retiro_sede', 'socio', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_socio_auth, gen_random_uuid())
    RETURNING id INTO v_o2;

    -- 3. Documento pendiente de verificación -> NO es tratado como vencido y permite finalizar
    PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);
    v_eval := public.get_socio_dispensation_eligibility(v_s_pend_rev);
    IF (v_eval->>'puedeFinalizarDispensa')::boolean IS NOT TRUE
       OR (v_eval->'bloqueosObligatorios') ? 'REPROCANN_VENCIDO_CONFIRMADO'
       OR NOT ((v_eval->'advertenciasDocumentales') ? 'REPROCANN_PENDIENTE_REVISION')
       OR NOT ((v_eval->'advertenciasDocumentales') ? 'CONSENTIMIENTO_PENDIENTE_REVISION') THEN
        RAISE EXCEPTION 'Caso 3 inesperado: %', v_eval;
    END IF;

    -- 4. REPROCANN vencido confirmado -> permite registrar pedido pero BLOQUEA finalización de entrega
    v_eval := public.get_socio_dispensation_eligibility(v_s_exp);
    IF (v_eval->>'puedeRegistrarPedido')::boolean IS NOT TRUE
       OR (v_eval->>'puedeFinalizarDispensa')::boolean IS NOT FALSE
       OR NOT ((v_eval->'bloqueosObligatorios') ? 'REPROCANN_VENCIDO_CONFIRMADO') THEN
        RAISE EXCEPTION 'Caso 4 inesperado: %', v_eval;
    END IF;
    INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
    VALUES (v_s_exp, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid())
    RETURNING id INTO v_o_exp;
    BEGIN
        PERFORM public.confirm_order_payment_command(gen_random_uuid(), v_o_exp, 'retirado', '[]'::jsonb, v_admin_auth);
        RAISE EXCEPTION 'Caso 4: finalización con REPROCANN_VENCIDO_CONFIRMADO debió fallar';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%REPROCANN_VENCIDO_CONFIRMADO%' THEN RAISE; END IF;
    END;

    -- 5. REPROCANN rechazado -> permite registrar pedido pero BLOQUEA finalización de entrega
    v_eval := public.get_socio_dispensation_eligibility(v_s_rej);
    IF (v_eval->>'puedeRegistrarPedido')::boolean IS NOT TRUE
       OR (v_eval->>'puedeFinalizarDispensa')::boolean IS NOT FALSE
       OR NOT ((v_eval->'bloqueosObligatorios') ? 'REPROCANN_RECHAZADO') THEN
        RAISE EXCEPTION 'Caso 5 inesperado: %', v_eval;
    END IF;
    INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
    VALUES (v_s_rej, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid())
    RETURNING id INTO v_o_rej;
    BEGIN
        PERFORM public.confirm_order_payment_command(gen_random_uuid(), v_o_rej, 'retirado', '[]'::jsonb, v_admin_auth);
        RAISE EXCEPTION 'Caso 5: finalización con REPROCANN_RECHAZADO debió fallar';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%REPROCANN_RECHAZADO%' THEN RAISE; END IF;
    END;

    -- 6. Socio bloqueado -> bloquea solicitar, registrar pedido y finalizar
    v_eval := public.get_socio_dispensation_eligibility(v_s_blk);
    IF (v_eval->>'puedeSolicitar')::boolean IS NOT FALSE
       OR (v_eval->>'puedeRegistrarPedido')::boolean IS NOT FALSE
       OR (v_eval->>'puedeFinalizarDispensa')::boolean IS NOT FALSE
       OR NOT ((v_eval->'bloqueosObligatorios') ? 'SOCIO_BLOQUEADO') THEN
        RAISE EXCEPTION 'Caso 6 inesperado: %', v_eval;
    END IF;
    BEGIN
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
        VALUES (v_s_blk, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid());
        RAISE EXCEPTION 'Caso 6: inserción para socio bloqueado debió fallar';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%SOCIO_BLOQUEADO%' THEN RAISE; END IF;
    END;

    -- 7. Reconocimiento físico limpia advertencias sin marcar documentos_socio como aprobado
    PERFORM public.register_legacy_document_recognition_command(gen_random_uuid(), v_s_invited_nodoc, 'consentimiento', 'Bibliorato 3 Folio 14', 'Consentimiento firmado en sede');
    PERFORM public.register_legacy_document_recognition_command(gen_random_uuid(), v_s_invited_nodoc, 'declaracion_jurada', 'Bibliorato 3 Folio 15', 'DDJJ firmada en sede');
    v_eval := public.get_socio_dispensation_eligibility(v_s_invited_nodoc);
    IF (v_eval->'advertenciasDocumentales') ? 'CONSENTIMIENTO_NO_CARGADO'
       OR (v_eval->'advertenciasDocumentales') ? 'DDJJ_NO_CARGADA'
       OR EXISTS (SELECT 1 FROM public.documentos_socio WHERE socio_id = v_s_invited_nodoc::text AND verificacion_estado = 'aprobado') THEN
        RAISE EXCEPTION 'Caso 7 inesperado: %', v_eval;
    END IF;

    -- 8. Entrega histórica con irregularidad: no descuenta stock ni duplica pagos + idempotente
    SELECT stock_disponible INTO v_stock_pre FROM public.products WHERE id = v_prod_flor;
    v_res := public.register_historical_dispensation_command(
        v_cmd_hist, v_s_exp, now() - interval '15 days',
        jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 2)),
        'Libro manuscrito pág 42 renglón 7',
        ARRAY['REPROCANN_VENCIDO_AL_REGISTRO', 'SIN_PEDIDO_PREVIO']
    );
    IF v_res->>'estadoRevision' <> 'observado' OR (v_res->>'reused')::boolean IS NOT FALSE THEN
        RAISE EXCEPTION 'Caso 8 inesperado: %', v_res;
    END IF;
    v_res := public.register_historical_dispensation_command(
        v_cmd_hist, v_s_exp, now() - interval '15 days',
        jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 2)),
        'Libro manuscrito pág 42 renglón 7',
        ARRAY['REPROCANN_VENCIDO_AL_REGISTRO', 'SIN_PEDIDO_PREVIO']
    );
    IF (v_res->>'reused')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Reintento histórico debe ser reused=true'; END IF;
    IF (SELECT stock_disponible FROM public.products WHERE id = v_prod_flor) <> v_stock_pre THEN
        RAISE EXCEPTION 'Caso 8: registro histórico no debe descontar stock';
    END IF;

    -- 9. Auditoría (append-only) y permisos
    v_exc_id := (public.grant_dispensation_exception_command(gen_random_uuid(), v_s_pend_rev, 'consentimiento', 'Respaldo documental en revisión sede', 'Acta-2026')->>'exceptionId')::uuid;
    BEGIN
        DELETE FROM public.dispensation_exceptions WHERE id = v_exc_id;
        RAISE EXCEPTION 'Debió impedir DELETE en dispensation_exceptions';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%INC08_APPEND_ONLY%' THEN RAISE; END IF; END;

    PERFORM set_config('request.jwt.claim.sub', v_staff_auth::text, true);
    BEGIN
        PERFORM public.grant_dispensation_exception_command(gen_random_uuid(), v_s_pend_rev, 'consentimiento', 'Staff no debe poder autorizar excepciones', 'Ref-3');
        RAISE EXCEPTION 'Debió rechazar excepción por staff';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%EXCEPTION_ADMIN_REQUIRED%' THEN RAISE; END IF; END;

    PERFORM set_config('request.jwt.claim.sub', v_socio_auth::text, true);
    BEGIN
        PERFORM public.register_historical_dispensation_command(gen_random_uuid(), v_s_active_nodoc, now() - interval '1 day', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 'Ref-4');
        RAISE EXCEPTION 'Debió rechazar a socio';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%UNAUTHORIZED%' THEN RAISE; END IF; END;

    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM public.evaluate_socio_dispensation_eligibility(v_s_invited_nodoc);
        RAISE EXCEPTION 'Authenticated no debe tener EXECUTE directo sobre evaluate_socio_dispensation_eligibility';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM public.get_socio_dispensation_eligibility(v_s_invited_nodoc);
        RAISE EXCEPTION 'Socio no debe consultar elegibilidad de otro socio';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%No autorizado%' THEN RAISE; END IF; END;
    RESET ROLE;
END $$;
SELECT 'PG17_INC08_NONRESTRICTIVE_OK';
`);
    assert.ok(out.includes('PG17_INC08_NONRESTRICTIVE_OK'));
});

async function runConcurrencyTest() {
    await testAsync('INC08-CONC: Finalización concurrente con REPROCANN_VENCIDO_CONFIRMADO rechaza ambas conexiones sin entregar ni descontar stock', async () => {
        const tempDb = 'inc08_conc_test';
        const ux041 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261119150000_ux04_1_direct_delivery_from_active_states.sql'), 'utf8').replace(/^BEGIN;/gm, '').replace(/^COMMIT;/gm, '');
        const inc08 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261120140000_inc08_dispensation_eligibility_separation.sql'), 'utf8').replace(/^BEGIN;/gm, '').replace(/^COMMIT;/gm, '');
        execSync(`docker exec -i aciacam-pg17-restore-test psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${tempDb} WITH (FORCE);" -c "CREATE DATABASE ${tempDb} TEMPLATE prod_ux04_restore_20261119;"`, { stdio: 'pipe' });
        try {
            const seed = execSync(`docker exec -i aciacam-pg17-restore-test psql -U postgres -d ${tempDb} -v ON_ERROR_STOP=1 -t -A`, {
                input: `
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$auth$;
${ux041}
${inc08}
DO $$
DECLARE
    v_admin uuid := '11111111-1111-4111-8111-111111111111';
    v_socio uuid := '22222222-2222-4222-8222-222222222222';
    v_prod  uuid := '33333333-3333-4333-8333-333333333333';
    v_ped   uuid := '44444444-4444-4444-8444-444444444444';
BEGIN
    INSERT INTO auth.users (id, email, last_sign_in_at) VALUES (v_admin, 'inc08_conc@test.invalid', now());
    INSERT INTO public.socios (id, auth_user_id, user_id, nombre, apellido, dni, email, rol, status, bloqueado, admision_institucional_estado)
    VALUES (gen_random_uuid(), v_admin, v_admin, 'Conc', 'Admin', '11000111', 'inc08_conc@test.invalid', 'admin', 'active', false, 'admitido');
    INSERT INTO public.socios (id, nombre, apellido, dni, email, rol, status, bloqueado, admision_institucional_estado, reprocann_estado, reprocann_fecha_vencimiento)
    VALUES (v_socio, 'Conc', 'Socio', '11000222', 'conc_s@test.invalid', 'socio', 'invited', false, 'admitido', 'aprobado', current_date - 1);
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    INSERT INTO public.products (id, nombre, categoria, tipo, peso_gramos, precio, stock_disponible, activo)
    VALUES (v_prod, 'Flor Conc', 'flores', 'flor', 10, 50000, 20, true);
    INSERT INTO public.pedidos (id, socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
    VALUES (v_ped, v_socio, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod, 'cantidad', 1)), 50000, v_admin, gen_random_uuid());
END $$;
SELECT 'INC08_CONC_SEED_OK';
`,
                encoding: 'utf8',
            });
            assert.ok(seed.includes('INC08_CONC_SEED_OK'));

            const tryFinalize = () =>
                execAsync(`docker exec -i aciacam-pg17-restore-test psql -U postgres -d ${tempDb} -v ON_ERROR_STOP=1 -t -A -c "SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true); SELECT public.confirm_order_payment_command(gen_random_uuid(), '44444444-4444-4444-8444-444444444444'::uuid, 'retirado', '[]'::jsonb, '11111111-1111-4111-8111-111111111111'::uuid);"`)
                    .then(() => ({ ok: true, err: '' }))
                    .catch((e) => ({ ok: false, err: String(e.stderr || e.message) }));

            const res = await Promise.all([tryFinalize(), tryFinalize()]);
            assert.equal(res.filter((r) => !r.ok && r.err.includes('REPROCANN_VENCIDO_CONFIRMADO')).length, 2);

            const after = execSync(`docker exec -i aciacam-pg17-restore-test psql -U postgres -d ${tempDb} -t -A -c "SELECT (SELECT stock_disponible FROM public.products WHERE id = '33333333-3333-4333-8333-333333333333') || '|' || (SELECT estado FROM public.pedidos WHERE id = '44444444-4444-4444-8444-444444444444');"`, { encoding: 'utf8' }).trim();
            assert.equal(after, '19|pendiente');
        } finally {
            execSync(`docker exec -i aciacam-pg17-restore-test psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS ${tempDb} WITH (FORCE);"`, { stdio: 'pipe' });
        }
    });

    console.log(`=== INC-08 SUITE COMPLETE: ${passed}/${passed} PASS ===`);
}

runConcurrencyTest().catch((err) => {
    console.error(err);
    process.exit(1);
});
