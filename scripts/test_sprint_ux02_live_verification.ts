import * as fs from 'fs';
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

async function run() {
    console.log('====================================================================');
    console.log(' ACIACAM APP - SPRINT UX-02B: VERIFICACIÓN INTEGRAL DE PEDIDOS Y STOCK');
    console.log(' Destination: Supabase Integration (uqwuhjxzazsexuvqxmfm)');
    console.log('====================================================================\n');

    let allPassed = true;

    // 1. Obtener tokens legítimos para Socio y Admin
    console.log('[Paso 1] Autenticando usuarios de prueba en Supabase Integration...');
    const socioEmail = 'e2e-socio-sprint5@aciacam-test.invalid';
    const adminEmail = 'e2e-admin-sprint5@aciacam-test.invalid';

    const sLink = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: socioEmail });
    const sVerify = await anonClient.auth.verifyOtp({ token_hash: sLink.data!.properties!.hashed_token!, type: 'magiclink' });
    const socioToken = sVerify.data.session!.access_token;
    const socioAuthUser = sVerify.data.session!.user;

    const aLink = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: adminEmail });
    const aVerify = await anonClient.auth.verifyOtp({ token_hash: aLink.data!.properties!.hashed_token!, type: 'magiclink' });
    const adminToken = aVerify.data.session!.access_token;

    const socioClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${socioToken}` } }
    });

    const adminUserClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${adminToken}` } }
    });

    console.log('  -> Socio autenticado:', socioAuthUser.id);
    console.log('  -> Admin autenticado:', aVerify.data.session!.user.id);

    // 2. Resolver socio en DB
    const { data: socioDb } = await adminClient
        .from('socios')
        .select('*')
        .eq('auth_user_id', socioAuthUser.id)
        .single();

    // 3. Obtener producto y stock inicial
    const productId = '30000000-0000-4000-8000-000000000021';
    const { data: prodInit } = await adminClient.from('products').select('*').eq('id', productId).single();
    const initialStock = prodInit.stock_disponible;
    console.log(`\n[Paso 2] Producto seleccionado: '${prodInit.nombre}' | Stock inicial: ${initialStock}`);

    // 4. Crear pedido desde la sesión del Socio (2 unidades)
    console.log('\n[Paso 3] Creando pedido desde el cliente autenticado como Socio (2 unidades)...');
    const idempotencyKey = (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : '11223344-5566-4778-899a-aabbccddeeff');
    const orderPayload = {
        socio_id: socioDb.id,
        items: [{ productoId: productId, cantidad: 2 }],
        tipo_pedido: 'retiro_sede',
        origen: 'app',
        estado: 'pendiente',
        observaciones: 'Prueba Sprint UX-02B',
        created_by_user_id: socioAuthUser.id,
        idempotency_key: idempotencyKey
    };

    const { data: newOrder, error: orderErr } = await socioClient
        .from('pedidos')
        .insert(orderPayload)
        .select()
        .single();

    const orderCreated = !orderErr && newOrder?.id;
    console.log(`  -> Pedido ID: ${newOrder?.id || 'NINGUNO'} | Error: ${orderErr?.message || 'null'} -> ${orderCreated ? 'PASS' : 'FAIL'}`);
    if (!orderCreated) allPassed = false;

    // 5. Verificar visibilidad en el panel administrativo
    console.log('\n[Paso 4] Verificando visibilidad del pedido para el Administrador...');
    const { data: adminOrderView, error: adminViewErr } = await adminUserClient
        .from('pedidos')
        .select('*')
        .eq('id', newOrder?.id)
        .maybeSingle();

    const orderVisibleToAdmin = !adminViewErr && adminOrderView?.id === newOrder?.id;
    console.log(`  -> Pedido visible para Admin: ${orderVisibleToAdmin ? 'PASS' : 'FAIL'}`);
    if (!orderVisibleToAdmin) allPassed = false;

    // 6. Verificar descuento exacto de stock
    console.log('\n[Paso 5] Verificando descuento exacto de stock en PostgreSQL...');
    const { data: prodAfterOrder } = await adminClient.from('products').select('stock_disponible').eq('id', productId).single();
    const stockDeducted = prodAfterOrder.stock_disponible === initialStock - 2;
    console.log(`  -> Stock disponible tras pedido: ${prodAfterOrder.stock_disponible} (Esperado: ${initialStock - 2}) -> ${stockDeducted ? 'PASS' : 'FAIL'}`);
    if (!stockDeducted) allPassed = false;

    // 7. Comprobar que reintentos con la misma idempotency_key NO generan duplicados
    console.log('\n[Paso 6] Verificando protección contra reintentos (misma idempotency_key)...');
    const { data: dupOrder, error: dupErr } = await socioClient
        .from('pedidos')
        .insert(orderPayload)
        .select()
        .single();

    const duplicateBlocked = dupErr?.code === '23505';
    console.log(`  -> Reintento duplicado rechazado por PostgreSQL (23505): ${duplicateBlocked ? 'PASS' : 'FAIL'}`);
    if (!duplicateBlocked) allPassed = false;

    // 8. Cancelar pedido mediante operador autorizado (Admin)
    console.log('\n[Paso 7] Cancelando pedido mediante operador autorizado (Admin)...');
    const { data: cancelRes, error: cancelErr } = await adminUserClient
        .from('pedidos')
        .update({ estado: 'cancelado', motivo_admin: 'Cancelación autorizada de verificación E2E' })
        .eq('id', newOrder?.id)
        .select();

    const cancelSuccess = !cancelErr && cancelRes?.[0]?.estado === 'cancelado';
    console.log(`  -> Estado del pedido tras cancelación: ${cancelRes?.[0]?.estado} -> ${cancelSuccess ? 'PASS' : 'FAIL'}`);
    if (!cancelSuccess) allPassed = false;

    // 9. Verificar restitución exacta de stock
    console.log('\n[Paso 8] Verificando restitución automática y exacta del stock en PostgreSQL...');
    const { data: prodAfterCancel } = await adminClient.from('products').select('stock_disponible').eq('id', productId).single();
    const stockRestored = prodAfterCancel.stock_disponible === initialStock;
    console.log(`  -> Stock disponible tras cancelación: ${prodAfterCancel.stock_disponible} (Esperado: ${initialStock}) -> ${stockRestored ? 'PASS' : 'FAIL'}`);
    if (!stockRestored) allPassed = false;

    // 10. Limpieza del pedido de prueba
    console.log('\n[Paso 9] Limpieza segura del registro de prueba...');
    await adminClient.from('pedidos').delete().eq('id', newOrder?.id);
    console.log('  -> Pedido de prueba eliminado correctamente.');

    console.log('\n====================================================================');
    if (allPassed) {
        console.log('  DICTAMEN: GO (TODAS LAS VERIFICACIONES OPERATIVAS SUPERADAS)');
    } else {
        console.log('  DICTAMEN: NO-GO (FALLAS DETECTADAS EN EL FLUJO)');
    }
    console.log('====================================================================\n');

    if (!allPassed) process.exit(1);
}

run().catch(err => {
    console.error('Unhandled verification error:', err);
    process.exit(1);
});
