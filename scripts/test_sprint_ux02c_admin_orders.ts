import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const env = dotenv.parse(fs.readFileSync('c:/Users/gdipd/Documents/Proyectos/aciacam-app/.env.integration.local'));
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_URL.includes('uqwuhjxzazsexuvqxmfm')) {
    console.error('Guard fail: Not integration');
    process.exit(1);
}

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

async function main() {
    console.log('====================================================================');
    console.log(' ACIACAM APP - SPRINT UX-02C: VERIFICACIÓN DE VISIBILIDAD DE PEDIDOS');
    console.log(' Target: Supabase Integration (uqwuhjxzazsexuvqxmfm)');
    console.log('====================================================================\n');

    let allPassed = true;

    // 1. Static Contract Checks in storeService.ts
    console.log('[Test 1] Verificación estática de storeService.ts...');
    const storeServiceCode = fs.readFileSync(path.resolve(__dirname, '../services/storeService.ts'), 'utf8');
    
    if (storeServiceCode.includes("from('pedidos')\n            .select('*, socio:socios(*)')") ||
        storeServiceCode.includes("from('pedidos').select('*, socio:socios(*)')")) {
        console.error('  FAIL: getAllPedidos still contains forbidden join socio:socios(*)');
        allPassed = false;
    } else {
        console.log('  PASS: getAllPedidos does NOT contain join on socios table.');
    }

    if (storeServiceCode.includes("from('pagos')\n            .select('*, socio:socios(*)')") ||
        storeServiceCode.includes("from('pagos').select('*, socio:socios(*)')")) {
        console.error('  FAIL: getAllPagos still contains forbidden join socio:socios(*)');
        allPassed = false;
    } else {
        console.log('  PASS: getAllPagos does NOT contain join on socios table.');
    }

    // 2. Authenticate as Admin
    console.log('\n[Test 2] Autenticación como Administrador en Integration...');
    const adminEmail = 'e2e-admin-sprint5@aciacam-test.invalid';
    const aLink = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: adminEmail });
    const aVerify = await anonClient.auth.verifyOtp({ token_hash: aLink.data!.properties!.hashed_token!, type: 'magiclink' });
    const adminToken = aVerify.data.session!.access_token;

    const adminUserClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${adminToken}` } }
    });
    console.log('  PASS: Admin autenticado con ID:', aVerify.data.session!.user.id);

    // 3. Query Pedidos exactly as StoreService.getAllPedidos does
    console.log('\n[Test 3] Ejecución de getAllPedidos como Administrador autenticado...');
    let query = adminUserClient
        .from('pedidos')
        .select('*')
        .order('created_at', { ascending: false })
        .or('archivado.is.null,archivado.eq.false');

    const { data: pedidos, error: pedidosErr } = await query;
    if (pedidosErr) {
        console.error('  FAIL: Query error en pedidos:', pedidosErr);
        allPassed = false;
    } else {
        console.log(`  PASS: Consulta exitosa sin errores RLS. Total de pedidos recuperados: ${pedidos.length}`);
    }

    // 4. Verify the two manual test orders exist and are visible
    console.log('\n[Test 4] Verificación de los pedidos creados en prueba manual del socio...');
    const expectedOrderIds = [
        'aab850d5-b311-427e-8e0f-de3413883c12',
        'e2941f70-3edb-46a3-a5b4-91cadcf3a12c'
    ];

    for (const orderId of expectedOrderIds) {
        const found = (pedidos || []).find((p: any) => p.id === orderId);
        if (!found) {
            console.error(`  FAIL: Pedido manual ${orderId} no encontrado en la lista de pedidos del admin!`);
            allPassed = false;
        } else {
            console.log(`  PASS: Pedido ${orderId} visible para admin:`);
            console.log(`        - Estado: ${found.estado}`);
            console.log(`        - Origen: ${found.origen}`);
            console.log(`        - Socio ID: ${found.socio_id}`);
            console.log(`        - Fecha: ${found.created_at}`);
            console.log(`        - Items: ${JSON.stringify(found.items)}`);
        }
    }

    // 5. Query Pagos exactly as StoreService.getAllPagos does
    console.log('\n[Test 5] Ejecución de getAllPagos como Administrador autenticado...');
    const { data: pagos, error: pagosErr } = await adminUserClient
        .from('pagos')
        .select('*')
        .order('fecha', { ascending: false });

    if (pagosErr) {
        console.error('  FAIL: Query error en pagos:', pagosErr);
        allPassed = false;
    } else {
        console.log(`  PASS: Consulta de pagos exitosa sin error 42501. Registros: ${pagos.length}`);
    }

    // 6. Verify Stock remaining
    console.log('\n[Test 6] Verificación de integridad de stock en Integration...');
    const { data: pLola } = await adminClient.from('products').select('*').eq('id', 'de29c0bb-1af0-490c-984f-71ece331ec35').single();
    const { data: pE2E } = await adminClient.from('products').select('*').eq('id', '30000000-0000-4000-8000-000000000021').single();
    
    console.log(`  - Producto Lola (de29c0bb): stock_disponible = ${pLola?.stock_disponible} (audit note: "${pLola?.last_audit_note}")`);
    console.log(`  - Producto E2E (30000000): stock_disponible = ${pE2E?.stock_disponible} (audit note: "${pE2E?.last_audit_note}")`);

    if (pLola?.last_audit_order_id === 'aab850d5-b311-427e-8e0f-de3413883c12' &&
        pE2E?.last_audit_order_id === 'e2941f70-3edb-46a3-a5b4-91cadcf3a12c') {
        console.log('  PASS: Descuentos de stock debidamente vinculados a los pedidos creados en la prueba manual.');
    } else {
        console.error('  FAIL: Inconsistencia en auditoría de stock!');
        allPassed = false;
    }

    console.log('\n====================================================================');
    if (allPassed) {
        console.log(' RESULTADO FINAL SPRINT UX-02C: TODO OK (VERIFICACIÓN EXITOSA)');
    } else {
        console.log(' RESULTADO FINAL SPRINT UX-02C: FALLOS DETECTADOS');
        process.exit(1);
    }
    console.log('====================================================================');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

