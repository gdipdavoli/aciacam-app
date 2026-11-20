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

function runSqlInProdRestoreRollback(sqlBody: string): string {
    const ux041 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261119150000_ux04_1_direct_delivery_from_active_states.sql'), 'utf8')
        .replace(/^BEGIN;/gm, '')
        .replace(/^COMMIT;/gm, '');
    const fullSql = `
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$auth$;
${ux041}
${sqlBody}
ROLLBACK;
`;
    return execSync('docker exec -i aciacam-pg17-restore-test psql -U postgres -d prod_ux04_restore_20261119 -v ON_ERROR_STOP=1 -t -A', {
        input: fullSql,
        encoding: 'utf8',
    });
}

console.log('=== INC-07 DISPENSA DIRECTA LOCAL SUITE ===');

test('INC07-U1: Formulario dispensa directa incluye localidad, modal transaccional y no silencia errores', () => {
    const newPage = fs.readFileSync(path.resolve(__dirname, '../app/(dashboard)/admin/orders/new/page.tsx'), 'utf8');
    const storeService = fs.readFileSync(path.resolve(__dirname, '../services/storeService.ts'), 'utf8');

    assert.ok(newPage.includes('localidad'), 'Debe capturar localidad para delivery');
    assert.ok(newPage.includes('idempotency_key: createIdempotencyKeyRef.current'), 'Debe preservar idempotency_key en creación');
    assert.ok(newPage.includes('confirmOrderAndPayments'), 'Debe finalizar mediante comando transaccional existente');
    assert.ok(newPage.includes('PaymentRegistrationModal'), 'Debe usar PaymentRegistrationModal');
    assert.ok(newPage.includes('pendingOrder') && newPage.includes('handleCancelPendingOrder'), 'Debe proteger y recuperar pedido pendiente antes de editar carrito/modalidad');
    assert.ok(newPage.includes('Reintentar Finalización'), 'Debe permitir reintentar sin duplicar');
    assert.ok(!storeService.includes('if (!updateErr && updated) {\r\n                return mapPedidoFromDB(updated);\r\n            }\r\n        }\r\n\r\n        return mapPedidoFromDB(data);'), 'createPedido no debe silenciar updateErr');
    assert.ok(storeService.includes('if (updateErr || !updated)'), 'createPedido debe lanzar error si falla actualización post-insert');
});

test('INC07-PG-PROD: Dispensa directa (completo, parcial, sin aporte), recuperación/cancelación, errores no exitosos, idempotencia y permisos en copia de Producción', () => {
    const out = runSqlInProdRestoreRollback(`
DO $$
DECLARE
    v_admin_auth uuid := gen_random_uuid();
    v_socio_auth uuid := gen_random_uuid();
    v_blocked_auth uuid := gen_random_uuid();
    v_admin_id uuid := gen_random_uuid();
    v_socio_id uuid := gen_random_uuid();
    v_blocked_id uuid := gen_random_uuid();
    v_prod_id uuid := gen_random_uuid();
    v_idem_retiro uuid := gen_random_uuid();
    v_idem_deliv uuid := gen_random_uuid();
    v_cmd_retiro uuid := gen_random_uuid();
    v_cmd_deliv uuid := gen_random_uuid();
    v_res jsonb;
    v_order_retiro uuid;
    v_order_deliv uuid;
    v_stock_after integer;
    v_pagos_count integer;
    v_orders_count integer;
BEGIN
    INSERT INTO auth.users (id, email, last_sign_in_at) VALUES
        (v_admin_auth, 'inc07_admin@test.invalid', now()),
        (v_socio_auth, 'inc07_socio@test.invalid', now()),
        (v_blocked_auth, 'inc07_blocked@test.invalid', now());

    INSERT INTO public.socios (id, auth_user_id, user_id, nombre, apellido, dni, email, rol, status, bloqueado, envios_habilitados, domicilio, localidad)
    VALUES
        (v_admin_id, v_admin_auth, v_admin_auth, 'Admin', 'INC07', '66000111', 'inc07_admin@test.invalid', 'admin', 'active', false, true, 'Sede 1', 'CABA'),
        (v_socio_id, v_socio_auth, v_socio_auth, 'Socio', 'Activo', '66000222', 'inc07_socio@test.invalid', 'socio', 'active', false, true, 'Av. Siempre Viva 742', 'La Plata'),
        (v_blocked_id, v_blocked_auth, v_blocked_auth, 'Socio', 'Bloqueado', '66000333', 'inc07_blocked@test.invalid', 'socio', 'active', true, false, 'Calle 1', 'CABA');

    INSERT INTO public.products (id, nombre, categoria, tipo, peso_gramos, precio, stock_disponible, activo)
    VALUES (v_prod_id, 'Flor INC07', 'flores', 'flor', 5, 50000, 20, true);

    -- Cambiar a sesión admin
    PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

    -- 1. Validación socio bloqueado en INSERT directo
    BEGIN
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
        VALUES (v_blocked_id, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid());
        RAISE EXCEPTION 'Debió rechazar socio bloqueado';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%SOCIO_UNAVAILABLE%' THEN RAISE; END IF;
    END;

    -- 2. Validación delivery sin localidad debe fallar
    BEGIN
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, direccion_entrega, localidad, items, total, created_by_user_id, idempotency_key)
        VALUES (v_socio_id, 'delivery', 'admin', 'pendiente', 'Av. Siempre Viva 742', NULL, jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid());
        RAISE EXCEPTION 'Debió exigir localidad en delivery';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%DELIVERY_DISABLED_OR_ADDRESS_MISSING%' THEN RAISE; END IF;
    END;

    -- 3. Dispensa directa retiro_sede sin pedido previo + colisión idempotente (23505 no duplica pedido ni stock)
    INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
    VALUES (v_socio_id, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'cantidad', 2)), 100000, v_admin_auth, v_idem_retiro)
    RETURNING id INTO v_order_retiro;

    BEGIN
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
        VALUES (v_socio_id, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'cantidad', 2)), 100000, v_admin_auth, v_idem_retiro);
        RAISE EXCEPTION 'Debió rechazar duplicado por idempotency_key';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    -- 4. Permisos: un socio no puede ejecutar confirm_order_payment_command
    PERFORM set_config('request.jwt.claim.sub', v_socio_auth::text, true);
    BEGIN
        PERFORM public.confirm_order_payment_command(v_cmd_retiro, v_order_retiro, 'retirado', '[]'::jsonb, v_socio_auth);
        RAISE EXCEPTION 'Debió rechazar a socio sin rol admin/staff';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%PAYMENT_ROLE_UNAUTHORIZED%' THEN RAISE; END IF;
    END;

    PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

    -- Finalización atómica + reintento idempotente (no duplica pagos)
    v_res := public.confirm_order_payment_command(
        v_cmd_retiro, v_order_retiro, 'retirado',
        jsonb_build_array(jsonb_build_object('monto', 100000, 'medio_de_pago', 'efectivo', 'concepto', 'Aporte sede')),
        v_admin_auth
    );
    IF (v_res->>'reused')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'Primer cobro debe ser reused=false'; END IF;

    v_res := public.confirm_order_payment_command(
        v_cmd_retiro, v_order_retiro, 'retirado',
        jsonb_build_array(jsonb_build_object('monto', 100000, 'medio_de_pago', 'efectivo', 'concepto', 'Aporte sede')),
        v_admin_auth
    );
    IF (v_res->>'reused')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Reintento cobro debe ser reused=true'; END IF;

    -- 5. Dispensa directa delivery con localidad + aporte parcial (20000 de 50000)
    INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, direccion_entrega, localidad, items, total, created_by_user_id, idempotency_key)
    VALUES (v_socio_id, 'delivery', 'admin', 'pendiente', 'Av. Siempre Viva 742', 'La Plata', jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'cantidad', 1)), 50000, v_admin_auth, v_idem_deliv)
    RETURNING id INTO v_order_deliv;

    v_res := public.confirm_order_payment_command(
        v_cmd_deliv, v_order_deliv, 'entregado',
        jsonb_build_array(jsonb_build_object('monto', 20000, 'medio_de_pago', 'transferencia_galicia', 'referencia', 'INC07-TRF', 'concepto', 'Aporte parcial delivery')),
        v_admin_auth
    );

    -- 6. Dispensa directa SIN aporte inicial ('[]')
    DECLARE
        v_order_no_pay uuid;
        v_order_cancel uuid;
        v_stock_before_cancel integer;
    BEGIN
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
        VALUES (v_socio_id, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'cantidad', 1)), 50000, v_admin_auth, gen_random_uuid())
        RETURNING id INTO v_order_no_pay;

        -- Simular error de finalización (estado destino incompatible con retiro_sede): pedido NO queda finalizado
        BEGIN
            PERFORM public.confirm_order_payment_command(gen_random_uuid(), v_order_no_pay, 'entregado', '[]'::jsonb, v_admin_auth);
            RAISE EXCEPTION 'Debió fallar con INVALID_ORDER_TYPE_FOR_STATUS';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM NOT LIKE '%INVALID_ORDER_TYPE_FOR_STATUS%' THEN RAISE; END IF;
        END;
        IF (SELECT estado FROM public.pedidos WHERE id = v_order_no_pay) <> 'pendiente' THEN
            RAISE EXCEPTION 'Pedido tras error no debe quedar finalizado';
        END IF;

        -- Recuperar y finalizar sin aporte inicial
        PERFORM public.confirm_order_payment_command(gen_random_uuid(), v_order_no_pay, 'retirado', '[]'::jsonb, v_admin_auth);

        -- 7. Crear pedido pendiente tras error y cancelarlo antes de editar carrito -> stock debe restituirse
        SELECT stock_disponible INTO v_stock_before_cancel FROM public.products WHERE id = v_prod_id;
        INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
        VALUES (v_socio_id, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'cantidad', 3)), 150000, v_admin_auth, gen_random_uuid())
        RETURNING id INTO v_order_cancel;
        UPDATE public.pedidos SET estado = 'cancelado' WHERE id = v_order_cancel;
        IF (SELECT stock_disponible FROM public.products WHERE id = v_prod_id) <> v_stock_before_cancel THEN
            RAISE EXCEPTION 'Cancelación de pedido pendiente no restituyó stock';
        END IF;
    END;

    -- Verificar stock (20 - 2 - 1 - 1 = 16), cantidad de pedidos activos/finalizados no cancelados (3) y pagos (2)
    SELECT stock_disponible INTO v_stock_after FROM public.products WHERE id = v_prod_id;
    SELECT count(*) INTO v_orders_count FROM public.pedidos WHERE socio_id = v_socio_id AND estado <> 'cancelado';
    SELECT count(*) INTO v_pagos_count FROM public.pagos WHERE socio_id = v_socio_id;
    IF v_stock_after <> 16 OR v_orders_count <> 3 OR v_pagos_count <> 2 THEN
        RAISE EXCEPTION 'Conteo inconsistente: stock=% pedidos=% pagos=%', v_stock_after, v_orders_count, v_pagos_count;
    END IF;
END $$;
SELECT 'PG17_INC07_PROD_OK';
`);
    assert.ok(out.includes('PG17_INC07_PROD_OK'));
});

console.log(`=== INC-07 SUITE COMPLETE: ${passed}/${passed} PASS ===`);
