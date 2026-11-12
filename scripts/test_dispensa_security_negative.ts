/**
 * scripts/test_dispensa_security_negative.ts
 *
 * Prueba de seguridad negativa para operaciones de pedidos y dispensas.
 * Utiliza exclusivamente un socio sintético desechable que es eliminado al finalizar.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.integration.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !serviceKey || !anonKey) {
    console.error('Faltan credenciales de Supabase');
    process.exit(1);
}

if (url.includes('wfzbkcdmlcrjyrtauccu')) {
    console.error('ABORT! Target es Producción!');
    process.exit(1);
}

const supabaseAdmin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const clientAnon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

async function runNegativeTests() {
    console.log('=== PRUEBAS NEGATIVAS DE AUTORIZACIÓN DE PEDIDOS / DISPENSAS ===');
    console.log('Target:', url);

    // 1. Obtener producto activo para el pedido sintético
    const { data: products } = await supabaseAdmin.from('products').select('id, nombre, stock_disponible').eq('activo', true).limit(1);
    if (!products || products.length === 0) {
        console.error('No se encontró ningún producto activo para pruebas');
        process.exit(1);
    }
    const testProduct = products[0];
    const testItems = [{ productoId: testProduct.id, cantidad: 1, productoNombre: testProduct.nombre }];

    // 2. Autenticar como Admin E2E para obtener JWT real
    const adminEmail = 'e2e-admin-sprint5@aciacam-test.invalid';
    const { data: adminLink, error: lErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: adminEmail
    });
    if (lErr || !adminLink?.properties?.email_otp) {
        console.error('No se pudo generar OTP para admin E2E:', lErr);
        process.exit(1);
    }

    const { data: adminSession, error: sErr } = await clientAnon.auth.verifyOtp({
        email: adminEmail,
        token: adminLink.properties.email_otp,
        type: 'email'
    });

    if (sErr || !adminSession?.session) {
        console.error('Fallo login admin E2E:', sErr);
        process.exit(1);
    }

    const adminToken = adminSession.session.access_token;
    const adminUserId = adminSession.session.user.id;

    // Cliente autenticado con JWT real del operador admin
    const clientAdmin = createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${adminToken}` } }
    });

    const SYNTHETIC_DNI = '99999991';
    let syntheticSocioId: string | null = null;
    let syntheticOrderId: string | null = null;

    try {
        // Limpieza previa
        await supabaseAdmin.from('socios').delete().eq('dni', SYNTHETIC_DNI);

        // --- ESCENARIO 1: Socio en estado 'draft' (Alta preliminar sin CD) ---
        const { data: sDraft, error: errDraft } = await supabaseAdmin.from('socios').insert({
            nombre: 'Sintético',
            apellido: 'Borrador',
            dni: SYNTHETIC_DNI,
            email: 'sintetico.draft@aciacam-test.invalid',
            status: 'draft',
            bloqueado: false
        }).select().single();

        if (errDraft || !sDraft) throw new Error('Fallo al crear socio borrador: ' + errDraft?.message);
        syntheticSocioId = sDraft.id;

        // Intentar crear pedido con operador autenticado
        const { data: oDraft, error: oDraftErr } = await clientAdmin.from('pedidos').insert({
            socio_id: sDraft.id,
            items: testItems,
            tipo_pedido: 'retiro_sede',
            origen: 'admin',
            estado: 'pendiente',
            created_by_user_id: adminUserId
        }).select().single();

        const draftBlocked = !!oDraftErr && oDraftErr.message.includes('SOCIO_UNAVAILABLE');
        console.log(`[${draftBlocked ? 'PASS' : 'FAIL'}] Escenario 1: Socio en 'draft' es bloqueado por trigger tr_order_operator_guard:`, draftBlocked ? 'RECHAZADO (SOCIO_UNAVAILABLE)' : oDraftErr?.message);

        // --- ESCENARIO 2: Socio 'active' pero con 'bloqueado: true' (Bloqueo Preventivo) ---
        await supabaseAdmin.from('socios').update({ status: 'active', bloqueado: true, motivo_bloqueo: 'Prueba preventiva' }).eq('id', sDraft.id);

        const { data: oBlocked, error: oBlockedErr } = await clientAdmin.from('pedidos').insert({
            socio_id: sDraft.id,
            items: testItems,
            tipo_pedido: 'retiro_sede',
            origen: 'admin',
            estado: 'pendiente',
            created_by_user_id: adminUserId
        }).select().single();

        const blockPreventivoSuccess = !!oBlockedErr && oBlockedErr.message.includes('SOCIO_UNAVAILABLE');
        console.log(`[${blockPreventivoSuccess ? 'PASS' : 'FAIL'}] Escenario 2: Socio bloqueado preventivamente es bloqueado por trigger:`, blockPreventivoSuccess ? 'RECHAZADO (SOCIO_UNAVAILABLE)' : oBlockedErr?.message);

        // --- ESCENARIO 3: Socio 'active', 'bloqueado: false', PERO con REPROCANN pendiente y compliance incompleto ---
        await supabaseAdmin.from('socios').update({
            status: 'active',
            bloqueado: false,
            motivo_bloqueo: null,
            reprocann_num_tramite: '123456',
            reprocann_fecha_vencimiento: '2029-01-01'
        }).eq('id', sDraft.id);

        // Crear documento reprocann pero en estado 'pendiente' en documentos_socio
        await supabaseAdmin.from('documentos_socio').insert({
            socio_id: sDraft.id,
            tipo: 'reprocann',
            verificacion_estado: 'pendiente',
            is_current: true
        });

        // Intentar crear pedido en la base de datos
        const { data: oPendingDoc, error: oPendingDocErr } = await clientAdmin.from('pedidos').insert({
            socio_id: sDraft.id,
            items: testItems,
            tipo_pedido: 'retiro_sede',
            origen: 'admin',
            estado: 'pendiente',
            created_by_user_id: adminUserId
        }).select().single();

        if (oPendingDoc) syntheticOrderId = oPendingDoc.id;

        const isAllowedByCurrentDB = !oPendingDocErr && !!oPendingDoc;
        console.log(`[VULNERABILIDAD TÉCNICA DEMOSTRADA] Escenario 3: Socio 'active' con REPROCANN 'pendiente' y sin Acta CD:`);
        console.log(`  -> ¿Fue permitido el pedido por el trigger DB actual? ${isAllowedByCurrentDB ? 'SÍ (VULNERABLE)' : 'NO (BLOQUEADO)'}`);
        if (oPendingDocErr) console.log('  -> Mensaje de error DB:', oPendingDocErr.message);

        // Si se permitió, intentar confirmar pedido administrativamente
        if (oPendingDoc) {
            const { data: rpcRes, error: rpcErr } = await clientAdmin.rpc('confirmar_pedido_administrativo_transaccional', {
                p_pedido_id: oPendingDoc.id,
                p_motivo: 'Confirmación de prueba negativa'
            });

            console.log(`  -> ¿Fue confirmada la dispensa por la función SQL? ${!rpcErr && rpcRes?.success ? 'SÍ (VULNERABLE)' : 'NO (BLOQUEADO)'}`);
            if (rpcErr) console.log('  -> Error de confirmación:', rpcErr.message);
        }

    } finally {
        // Limpieza de datos sintéticos
        if (syntheticOrderId) {
            await supabaseAdmin.from('pedidos').delete().eq('id', syntheticOrderId);
        }
        if (syntheticSocioId) {
            await supabaseAdmin.from('documentos_socio').delete().eq('socio_id', syntheticSocioId);
            await supabaseAdmin.from('socios').delete().eq('id', syntheticSocioId);
        }
        console.log('Limpieza completada: socio y pedido sintético eliminados.');
    }
}

runNegativeTests().catch(console.error);
