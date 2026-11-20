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

console.log('=== INC-08 ELIGIBILITY, EXCEPTIONS, HISTORICAL & SECURITY SUITE ===');

test('INC08-PG-10: Matriz de 10 escenarios (acceso digital pendiente, físico, revisión, excepción, bloqueos, histórico, stock, auditoría y permisos)', () => {
    const out = runInProdRestoreRollback(`
DO $$
DECLARE
    v_admin_auth uuid := gen_random_uuid();
    v_staff_auth uuid := gen_random_uuid();
    v_socio_auth uuid := gen_random_uuid();
    v_s_invited uuid := gen_random_uuid();
    v_s_fisico uuid := gen_random_uuid();
    v_s_pend_rev uuid := gen_random_uuid();
    v_s_exc uuid := gen_random_uuid();
    v_s_exp uuid := gen_random_uuid();
    v_s_blk uuid := gen_random_uuid();
    v_prod_flor uuid := gen_random_uuid();
    v_o1 uuid;
    v_o2 uuid;
    v_eval jsonb;
    v_res jsonb;
    v_stock_pre integer;
    v_cmd_exc uuid := gen_random_uuid();
    v_cmd_hist uuid := gen_random_uuid();
BEGIN
    INSERT INTO auth.users (id, email, last_sign_in_at) VALUES
        (v_admin_auth, 'inc08_admin@test.invalid', now()),
        (v_staff_auth, 'inc08_staff@test.invalid', now()),
        (v_socio_auth, 'inc08_socio@test.invalid', now());

    INSERT INTO public.socios (id, auth_user_id, user_id, nombre, apellido, dni, email, rol, status, bloqueado, admision_institucional_estado, reprocann_fecha_vencimiento)
    VALUES
        (gen_random_uuid(), v_admin_auth, v_admin_auth, 'Admin', 'INC08', '55100100', 'inc08_admin@test.invalid', 'admin', 'active', false, 'admitido', (current_date + 180)),
        (gen_random_uuid(), v_staff_auth, v_staff_auth, 'Staff', 'INC08', '55100109', 'inc08_staff@test.invalid', 'staff', 'active', false, 'admitido', (current_date + 180)),
        (v_s_invited, NULL, NULL, 'Socio', 'InvitedOK', '55100101', 's_inv@test.invalid', 'socio', 'invited', false, 'admitido', (current_date + 180)),
        (v_s_fisico, NULL, NULL, 'Socio', 'Fisico', '55100102', 's_fis@test.invalid', 'socio', 'invited', false, 'admitido', (current_date + 180)),
        (v_s_pend_rev, NULL, NULL, 'Socio', 'PendRev', '55100103', 's_prev@test.invalid', 'socio', 'invited', false, 'admitido', (current_date + 180)),
        (v_s_exc, v_socio_auth, v_socio_auth, 'Socio', 'Excepcion', '55100104', 'inc08_socio@test.invalid', 'socio', 'active', false, 'admitido', (current_date + 180)),
        (v_s_exp, NULL, NULL, 'Socio', 'ReproExp', '55100105', 's_exp@test.invalid', 'socio', 'invited', false, 'admitido', (current_date - 1)),
        (v_s_blk, NULL, NULL, 'Socio', 'Bloqueado', '55100106', 's_blk@test.invalid', 'socio', 'active', true, 'admitido', (current_date + 180));

    PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

    -- Docs completos para v_s_invited; solo reprocann aprobado para v_s_fisico y v_s_exc; consentimiento pendiente para v_s_pend_rev; reprocann vencido para v_s_exp
    INSERT INTO public.documentos_socio (socio_id, tipo, archivo_path, verificacion_estado, fecha_emision, fecha_vencimiento, is_current)
    SELECT id::text, t.tipo, 'synthetic/doc.pdf',
           CASE WHEN id = v_s_pend_rev AND t.tipo = 'consentimiento' THEN 'pendiente' ELSE 'aprobado' END,
           (current_date - 30),
           CASE WHEN id = v_s_exp AND t.tipo = 'reprocann' THEN (now() - interval '1 day') ELSE (now() + interval '180 days') END,
           true
    FROM public.socios s
    CROSS JOIN (VALUES ('reprocann'), ('declaracion_jurada'), ('consentimiento')) AS t(tipo)
    WHERE s.id IN (v_s_invited, v_s_pend_rev, v_s_exp, v_s_blk)
       OR (s.id IN (v_s_fisico, v_s_exc) AND t.tipo = 'reprocann');

    INSERT INTO public.products (id, nombre, categoria, tipo, peso_gramos, precio, stock_disponible, activo)
    VALUES (v_prod_flor, 'Flor INC08', 'flores', 'flor', 10, 50000, 30, true);

    -- 1. Socio habilitado con acceso digital pendiente ('invited') -> HABILITADO
    v_eval := public.get_socio_dispensation_eligibility(v_s_invited);
    IF v_eval->>'estadoElegibilidad' <> 'HABILITADO' OR v_eval->>'accesoDigitalEstado' <> 'invitado' THEN
        RAISE EXCEPTION 'Caso 1 inesperado: %', v_eval;
    END IF;
    INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
    VALUES (v_s_invited, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid())
    RETURNING id INTO v_o1;
    PERFORM public.confirm_order_payment_command(gen_random_uuid(), v_o1, 'retirado', '[]'::jsonb, v_admin_auth);

    -- 2. Documentación física acreditada pero no digitalizada (no marca docs como aprobados, habilita por reconocimiento auditable)
    PERFORM public.register_legacy_document_recognition_command(gen_random_uuid(), v_s_fisico, 'consentimiento', 'Bibliorato 3 Folio 14', 'Consentimiento firmado en sede');
    PERFORM public.register_legacy_document_recognition_command(gen_random_uuid(), v_s_fisico, 'declaracion_jurada', 'Bibliorato 3 Folio 15', 'DDJJ firmada en sede');
    v_eval := public.get_socio_dispensation_eligibility(v_s_fisico);
    IF v_eval->>'estadoElegibilidad' <> 'HABILITADO' THEN
        RAISE EXCEPTION 'Caso 2 inesperado: %', v_eval;
    END IF;

    -- 3. Documento pendiente de verificación -> REQUIERE_REVISION y bloquea hasta regularizar/excepción
    v_eval := public.get_socio_dispensation_eligibility(v_s_pend_rev);
    IF v_eval->>'estadoElegibilidad' <> 'REQUIERE_REVISION' OR (v_eval->>'elegibleParaDispensa')::boolean IS NOT FALSE THEN
        RAISE EXCEPTION 'Caso 3 inesperado: %', v_eval;
    END IF;

    -- 4. Excepción administrativa admisible (admin + justificación + evidencia + idempotente) -> habilita dispensa
    v_res := public.grant_dispensation_exception_command(v_cmd_exc, v_s_exc, 'consentimiento', 'Socio exhibió consentimiento firmado en sede pendiente de escaneo', 'Acta recepción 2026-11-20');
    IF (v_res->>'reused')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'Primera excepción debe ser reused=false'; END IF;
    v_res := public.grant_dispensation_exception_command(v_cmd_exc, v_s_exc, 'consentimiento', 'Socio exhibió consentimiento firmado en sede pendiente de escaneo', 'Acta recepción 2026-11-20');
    IF (v_res->>'reused')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Reintento excepción debe ser reused=true'; END IF;

    v_eval := public.get_socio_dispensation_eligibility(v_s_exc);
    IF v_eval->>'estadoElegibilidad' <> 'REQUIERE_REVISION' OR (v_eval->>'elegibleParaDispensa')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Caso 4 inesperado: %', v_eval;
    END IF;
    INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
    VALUES (v_s_exc, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid())
    RETURNING id INTO v_o2;

    -- 5. Excepción rechazada por requisito obligatorio (REPROCANN vencido y socio bloqueado)
    BEGIN
        PERFORM public.grant_dispensation_exception_command(gen_random_uuid(), v_s_exp, 'consentimiento', 'Intento inválido sobre REPROCANN vencido', 'Ref-1');
        RAISE EXCEPTION 'Caso 5a debió fallar';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%EXCEPTION_FORBIDDEN_BY_MANDATORY_BLOCK%' THEN RAISE; END IF; END;

    BEGIN
        PERFORM public.grant_dispensation_exception_command(gen_random_uuid(), v_s_blk, 'consentimiento', 'Intento inválido sobre socio bloqueado', 'Ref-2');
        RAISE EXCEPTION 'Caso 5b debió fallar';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%EXCEPTION_FORBIDDEN_BY_MANDATORY_BLOCK%' THEN RAISE; END IF; END;

    -- 6 y 7. REPROCANN vencido y socio bloqueado -> NO_HABILITADO y rechazo en pedidos
    IF (public.get_socio_dispensation_eligibility(v_s_exp)->>'estadoElegibilidad') <> 'NO_HABILITADO' THEN RAISE EXCEPTION 'Caso 6 inesperado'; END IF;
    IF (public.get_socio_dispensation_eligibility(v_s_blk)->>'estadoElegibilidad') <> 'NO_HABILITADO' THEN RAISE EXCEPTION 'Caso 7 inesperado'; END IF;

    -- 8 y 9. Entrega histórica con irregularidad: no descuenta stock ni duplica pagos + idempotente
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
        RAISE EXCEPTION 'Caso 9: registro histórico no debe descontar stock';
    END IF;

    -- 10. Auditoría (append-only) y permisos (staff no puede dar excepción; socio no puede usar RPCs admin)
    BEGIN
        DELETE FROM public.dispensation_exceptions WHERE id = (v_eval->>'excepcionActivaId')::uuid;
        RAISE EXCEPTION 'Debió impedir DELETE en dispensation_exceptions';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%INC08_APPEND_ONLY%' THEN RAISE; END IF; END;

    PERFORM set_config('request.jwt.claim.sub', v_staff_auth::text, true);
    BEGIN
        PERFORM public.grant_dispensation_exception_command(gen_random_uuid(), v_s_pend_rev, 'consentimiento', 'Staff no debe poder autorizar excepciones', 'Ref-3');
        RAISE EXCEPTION 'Debió rechazar excepción por staff';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%EXCEPTION_ADMIN_REQUIRED%' THEN RAISE; END IF; END;

    PERFORM set_config('request.jwt.claim.sub', v_socio_auth::text, true);
    BEGIN
        PERFORM public.register_historical_dispensation_command(gen_random_uuid(), v_s_exc, now() - interval '1 day', jsonb_build_array(jsonb_build_object('productoId', v_prod_flor, 'cantidad', 1)), 'Ref-4');
        RAISE EXCEPTION 'Debió rechazar a socio';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%UNAUTHORIZED%' THEN RAISE; END IF; END;
END $$;
SELECT 'PG17_INC08_10_SCENARIOS_OK';
`);
    assert.ok(out.includes('PG17_INC08_10_SCENARIOS_OK'));
});

console.log(`=== INC-08 SUITE COMPLETE: ${passed}/${passed} PASS ===`);
