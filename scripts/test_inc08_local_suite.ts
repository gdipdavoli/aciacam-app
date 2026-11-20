import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let passed = 0;
function test(name: string, fn: () => void) {
    fn();
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

console.log('=== INC-08 HABILITACIÓN DISPENSA VS ACCESO DIGITAL SUITE ===');

test('INC08-PG-PROD: Matriz completa de 10 casos (invitación pendiente, sin usuario digital, admisión, REPROCANN vencido/sin verificar, bloqueo, docs, digital activo sin habilitación, operador y límites) + stock e idempotencia', () => {
    const out = runInProdRestoreRollback(`
DO $$
DECLARE
    v_admin_auth uuid := gen_random_uuid();
    v_socio_auth uuid := gen_random_uuid();
    v_s_invited uuid := gen_random_uuid();
    v_s_no_auth uuid := gen_random_uuid();
    v_s_no_adm uuid := gen_random_uuid();
    v_s_exp uuid := gen_random_uuid();
    v_s_unver uuid := gen_random_uuid();
    v_s_blk uuid := gen_random_uuid();
    v_s_nodoc uuid := gen_random_uuid();
    v_s_act_inh uuid := gen_random_uuid();
    v_prod_flor uuid := gen_random_uuid();
    v_o1 uuid;
    v_o2 uuid;
    v_cmd uuid := gen_random_uuid();
    v_eval jsonb;
    v_stock_pre integer;
BEGIN
    INSERT INTO auth.users (id, email, last_sign_in_at) VALUES
        (v_admin_auth, 'inc08_admin@test.invalid', now()),
        (v_socio_auth, 'inc08_socio@test.invalid', now());

    INSERT INTO public.socios (id, auth_user_id, user_id, nombre, apellido, dni, email, rol, status, bloqueado, admision_institucional_estado, reprocann_fecha_vencimiento)
    VALUES
        (gen_random_uuid(), v_admin_auth, v_admin_auth, 'Admin', 'INC08', '55100100', 'inc08_admin@test.invalid', 'admin', 'active', false, 'admitido', (current_date + 180)),
        (v_s_invited, NULL, NULL, 'Socio', 'InvitedOK', '55100101', 's_inv@test.invalid', 'socio', 'invited', false, 'admitido', (current_date + 180)),
        (v_s_no_auth, NULL, NULL, 'Socio', 'NoAuthOK', '55100102', 's_noauth@test.invalid', 'socio', 'pending', false, 'admitido', (current_date + 180)),
        (v_s_no_adm, NULL, NULL, 'Socio', 'NoAdm', '55100103', 's_noadm@test.invalid', 'socio', 'invited', false, 'pendiente', (current_date + 180)),
        (v_s_exp, NULL, NULL, 'Socio', 'ReproExp', '55100104', 's_exp@test.invalid', 'socio', 'invited', false, 'admitido', (current_date - 1)),
        (v_s_unver, NULL, NULL, 'Socio', 'ReproUnver', '55100105', 's_unv@test.invalid', 'socio', 'invited', false, 'admitido', (current_date + 180)),
        (v_s_blk, NULL, NULL, 'Socio', 'Bloqueado', '55100106', 's_blk@test.invalid', 'socio', 'active', true, 'admitido', (current_date + 180)),
        (v_s_nodoc, NULL, NULL, 'Socio', 'SinDocs', '55100107', 's_nodoc@test.invalid', 'socio', 'invited', false, 'admitido', (current_date + 180)),
        (v_s_act_inh, v_socio_auth, v_socio_auth, 'Socio', 'ActivoInhab', '55100108', 'inc08_socio@test.invalid', 'socio', 'active', false, 'pendiente', (current_date + 180));

    PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

    -- Cargar docs aprobados para los casos que corresponden (con fecha_emision requerida por validate_reprocann_approval)
    INSERT INTO public.documentos_socio (socio_id, tipo, archivo_path, verificacion_estado, fecha_emision, fecha_vencimiento, is_current)
    SELECT id::text, t.tipo, 'synthetic/doc.pdf',
           CASE WHEN id = v_s_unver AND t.tipo = 'reprocann' THEN 'pendiente' ELSE 'aprobado' END,
           (current_date - 30),
           CASE WHEN id = v_s_exp AND t.tipo = 'reprocann' THEN (now() - interval '1 day') ELSE (now() + interval '180 days') END,
           true
    FROM public.socios s
    CROSS JOIN (VALUES ('reprocann'), ('declaracion_jurada'), ('consentimiento')) AS t(tipo)
    WHERE s.id IN (v_s_invited, v_s_no_auth, v_s_no_adm, v_s_exp, v_s_unver, v_s_blk)
       OR (s.id = v_s_nodoc AND t.tipo = 'reprocann'); -- v_s_nodoc sin DDJJ ni consentimiento

    INSERT INTO public.products (id, nombre, categoria, tipo, peso_gramos, precio, stock_disponible, activo)
    VALUES (v_prod_flor, 'Flor INC08', 'flores', 'flor', 10, 50000, 30, true);

    PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

    -- 1. Socio admitido y habilitado con invitación pendiente ('invited') -> PERMITIDO + finalización + stock + idempotencia
    v_eval := public.get_socio_dispensation_eligibility(v_s_invited);
    IF (v_eval->>'elegibleParaDispensa')::boolean IS NOT TRUE OR (v_eval->>'accesoDigitalEstado') <> 'invitado' THEN
        RAISE EXCEPTION 'Evaluación inesperada para v_s_invited: %', v_eval;
    END IF;
    INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
    VALUES (v_s_invited, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 2)), 100000, v_admin_auth, gen_random_uuid())
    RETURNING id INTO v_o1;
    PERFORM public.confirm_order_payment_command(v_cmd, v_o1, 'retirado', '[]'::jsonb, v_admin_auth);
    PERFORM public.confirm_order_payment_command(v_cmd, v_o1, 'retirado', '[]'::jsonb, v_admin_auth); -- idempotente

    -- 2. Socio admitido y habilitado sin usuario digital -> PERMITIDO + cancelación restituye stock
    SELECT stock_disponible INTO v_stock_pre FROM public.products WHERE id = v_prod_flor;
    INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
    VALUES (v_s_no_auth, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid())
    RETURNING id INTO v_o2;
    UPDATE public.pedidos SET estado = 'cancelado' WHERE id = v_o2;
    IF (SELECT stock_disponible FROM public.products WHERE id = v_prod_flor) <> v_stock_pre THEN
        RAISE EXCEPTION 'Cancelación no restituyó stock';
    END IF;

    -- 3. Rechazos obligatorios
    BEGIN
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
        VALUES (v_s_no_adm, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid());
        RAISE EXCEPTION 'Debió rechazar sin admisión';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%SIN_ADMISION_INSTITUCIONAL%' THEN RAISE; END IF; END;

    BEGIN
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
        VALUES (v_s_exp, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid());
        RAISE EXCEPTION 'Debió rechazar REPROCANN vencido';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%REPROCANN_VENCIDO%' THEN RAISE; END IF; END;

    BEGIN
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
        VALUES (v_s_unver, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid());
        RAISE EXCEPTION 'Debió rechazar REPROCANN sin verificar';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%REPROCANN_SIN_VERIFICAR%' THEN RAISE; END IF; END;

    BEGIN
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
        VALUES (v_s_blk, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid());
        RAISE EXCEPTION 'Debió rechazar bloqueado';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%SOCIO_BLOQUEADO%' THEN RAISE; END IF; END;

    BEGIN
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
        VALUES (v_s_nodoc, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid());
        RAISE EXCEPTION 'Debió rechazar documentación incompleta';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%DOCUMENTACION_INCOMPLETA%' THEN RAISE; END IF; END;

    BEGIN
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
        VALUES (v_s_act_inh, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid());
        RAISE EXCEPTION 'Debió rechazar usuario digital activo pero sin habilitación institucional/documental';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%SIN_ADMISION_INSTITUCIONAL%' THEN RAISE; END IF; END;

    -- 9. Operador sin permisos (socio)
    PERFORM set_config('request.jwt.claim.sub', v_socio_auth::text, true);
    BEGIN
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
        VALUES (v_s_invited, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_socio_auth, gen_random_uuid());
        RAISE EXCEPTION 'Debió rechazar operador sin permisos';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%ORDER_ORIGIN_FORBIDDEN%' THEN RAISE; END IF; END;

    -- 10. Socio habilitado que supera límite Res. 800/2021 (5 x 10g = 50g > 40g)
    PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);
    BEGIN
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
        VALUES (v_s_invited, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 5)), 250000, v_admin_auth, gen_random_uuid());
        RAISE EXCEPTION 'Debió rechazar por límite de 40g';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%Res. 800/2021%' THEN RAISE; END IF; END;
END $$;
SELECT 'PG17_INC08_ALL_10_OK';
`);
    assert.ok(out.includes('PG17_INC08_ALL_10_OK'));
});

console.log(`=== INC-08 SUITE COMPLETE: ${passed}/${passed} PASS ===`);
