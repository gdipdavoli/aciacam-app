import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
    calculateCartSummary,
    calculateItemAporte,
    getUnitAporte,
    resolveOrderTotal,
} from '../app/lib/order-pricing';

let passed = 0;
function test(name: string, fn: () => void) {
    fn();
    passed++;
    console.log(`✓ ${name}`);
}

console.log('=== HOTFIX FLORES APORTE FIJO POR PRESENTACIÓN SUITE ===');

const santanesia5 = {
    id: '3d6f4cea-af6a-4ca7-b5cf-5c6321461930',
    tipo: 'flor',
    peso_gramos: 5,
    aporte_unidad: 65000,
    precio: 0,
};

const santanesia10 = {
    id: 'fd45b80d-2745-472a-9af8-9d16ca8d5f31',
    tipo: 'flor',
    peso_gramos: 10,
    aporte_unidad: 125000,
    precio: 0,
};

const florLegacySinAporte = {
    id: '308e9f4f-3c7b-4972-8eb8-7067f3a56bbc',
    tipo: 'flor',
    peso_gramos: 10,
    aporte_unidad: null,
    precio: 0,
};

const aceiteQ1 = {
    id: '3eb07b58-04e3-4e25-80b3-f0008472d3ff',
    tipo: 'gotero',
    peso_gramos: 0,
    aporte_unidad: 25000,
    precio: 0,
};

test('HF-01: Santanesia 5g ($65.000) y 10g ($125.000) usan aporte fijo independiente de aporte_por_gramo', () => {
    assert.equal(getUnitAporte(santanesia5, 10000), 65000);
    assert.equal(getUnitAporte(santanesia10, 10000), 125000);
    assert.equal(calculateItemAporte(santanesia5, 2, 10000), 130000);
    assert.equal(calculateItemAporte(santanesia10, 1, 10000), 125000);
});

test('HF-02: Flor sin aporte_unidad configurado mantiene fallback peso_gramos * aporte_por_gramo', () => {
    assert.equal(getUnitAporte(florLegacySinAporte, 10000), 100000);
    assert.equal(calculateItemAporte(florLegacySinAporte, 2, 10000), 200000);
});

test('HF-03: Carrito mixto (flores con aporte fijo + aceite) mantiene floresGramos reales y aceitesUnidades', () => {
    const summary = calculateCartSummary(
        [
            { productoId: santanesia5.id, cantidad: 1, producto: santanesia5 },
            { productoId: santanesia10.id, cantidad: 1, producto: santanesia10 },
            { productoId: aceiteQ1.id, cantidad: 2, producto: aceiteQ1 },
        ],
        10000
    );
    assert.equal(summary.floresGramos, 15);
    assert.equal(summary.aceitesUnidades, 2);
    assert.equal(summary.aporteTotal, 65000 + 125000 + 50000);
});

test('HF-04: Pedidos históricos conservan order.total y precioUnitario ante cambios de aporte_unidad', () => {
    const map = new Map<string, any>([
        [santanesia5.id, santanesia5],
        [santanesia10.id, santanesia10],
    ]);
    assert.equal(resolveOrderTotal({ total: 50000, items: [{ productoId: santanesia5.id, cantidad: 1 }] }, map, 10000), 50000);
    assert.equal(resolveOrderTotal({ total: null, items: [{ productoId: santanesia10.id, cantidad: 1, precioUnitario: 100000 }] }, map, 10000), 100000);
    assert.equal(resolveOrderTotal({ total: null, items: [{ productoId: santanesia10.id, cantidad: 1 }] }, map, 10000), 125000);
});

test('HF-05: PG17 (prod_ux04_restore_20261119) aporte_unidad en flor + pedidos + aportes completo/parcial/pendiente + stock por presentación', () => {
    const ux04Aporte = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261119120000_ux04_product_aporte_unidad.sql'), 'utf8');
    const ux041 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261119150000_ux04_1_direct_delivery_from_active_states.sql'), 'utf8')
        .replace(/^BEGIN;/gm, '').replace(/^COMMIT;/gm, '');
    const out = execSync(
        'docker exec -i aciacam-pg17-restore-test psql -U postgres -d prod_ux04_restore_20261119 -v ON_ERROR_STOP=1 -t -A',
        {
            input: `
BEGIN;
${ux04Aporte}
${ux041}
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$auth$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $auth$
    SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$auth$;

DO $$
DECLARE
    v_admin uuid := gen_random_uuid();
    v_socio uuid := gen_random_uuid();
    v_flor5 uuid := gen_random_uuid();
    v_flor10 uuid := gen_random_uuid();
    v_o_comp uuid;
    v_o_parc uuid;
    v_o_pend uuid;
BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_admin, 'hf_adm@test.invalid');
    INSERT INTO public.socios (id, auth_user_id, user_id, nombre, apellido, dni, email, rol, status, bloqueado)
    VALUES
        (gen_random_uuid(), v_admin, v_admin, 'HF', 'Admin', '91000100', 'hf_adm@test.invalid', 'admin', 'active', false),
        (v_socio, NULL, NULL, 'HF', 'Socio', '91000101', 'hf_soc@test.invalid', 'socio', 'active', false);

    INSERT INTO public.products (id, nombre, categoria, tipo, peso_gramos, precio, aporte_unidad, stock_disponible, activo)
    VALUES
        (v_flor5, 'Santanesia 5G HF', '90% Sativa', 'flor', 5, 0, 65000, 20, true),
        (v_flor10, 'Santanesia 10G HF', '90% Sativa', 'flor', 10, 0, 125000, 15, true);

    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

    -- Aporte completo (5g = 65000)
    INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
    VALUES (v_socio, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_flor5, 'cantidad', 1, 'precioUnitario', 65000)), 65000, v_admin, gen_random_uuid())
    RETURNING id INTO v_o_comp;
    PERFORM public.confirm_order_payment_command(gen_random_uuid(), v_o_comp, 'retirado', jsonb_build_array(jsonb_build_object('monto', 65000, 'metodo_pago', 'efectivo', 'concepto', 'Dispensa')), v_admin);

    -- Aporte parcial (10g = 125000, pago 50000)
    INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
    VALUES (v_socio, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_flor10, 'cantidad', 1, 'precioUnitario', 125000)), 125000, v_admin, gen_random_uuid())
    RETURNING id INTO v_o_parc;
    PERFORM public.confirm_order_payment_command(gen_random_uuid(), v_o_parc, 'retirado', jsonb_build_array(jsonb_build_object('monto', 50000, 'metodo_pago', 'transferencia', 'concepto', 'Dispensa')), v_admin);

    -- Aporte pendiente (5g = 65000, sin pago inicial)
    INSERT INTO public.pedidos (socio_id, tipo_pedido, origen, estado, items, total, created_by_user_id, idempotency_key)
    VALUES (v_socio, 'retiro_sede', 'admin', 'pendiente', jsonb_build_array(jsonb_build_object('productoId', v_flor5, 'cantidad', 1, 'precioUnitario', 65000)), 65000, v_admin, gen_random_uuid())
    RETURNING id INTO v_o_pend;
    PERFORM public.confirm_order_payment_command(gen_random_uuid(), v_o_pend, 'retirado', '[]'::jsonb, v_admin);

    IF (SELECT stock_disponible FROM public.products WHERE id = v_flor5) <> 18
       OR (SELECT stock_disponible FROM public.products WHERE id = v_flor10) <> 14 THEN
        RAISE EXCEPTION 'Stock inesperado tras dispensas';
    END IF;
END $$;
SELECT 'HOTFIX_PG17_OK';
ROLLBACK;
`,
            encoding: 'utf8',
        }
    );
    assert.ok(out.includes('HOTFIX_PG17_OK'));
});

console.log(`=== HOTFIX SUITE COMPLETE: ${passed}/${passed} PASS ===`);
