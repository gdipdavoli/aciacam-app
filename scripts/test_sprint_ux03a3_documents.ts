/**
 * scripts/test_sprint_ux03a3_documents.ts
 *
 * ACIACAM APP - SPRINT UX-03A.3: VERIFICACIÓN DEL FLUJO DOCUMENTAL
 * Entorno: Supabase Integration (uqwuhjxzazsexuvqxmfm)
 *
 * Pruebas:
 * 1. Admin puede revisar y aprobar un documento pendiente.
 * 2. Staff puede realizar únicamente acciones autorizadas.
 * 3. Socio no puede aprobar su propio documento (403 Forbidden).
 * 4. Socio no puede modificar documentos ajenos (403 Forbidden).
 * 5. Admin puede consultar el historial documental y versiones.
 * 6. Documento aprobado se refleja en /api/socios/[id]/compliance como 'aprobado'.
 * 7. Documento rechazado se refleja en /api/socios/[id]/compliance como 'rechazado' (no aprobado).
 * 8. Conservación de versiones históricas (supersedes_document_id e is_current).
 * 9. Pedidos, stock y perfil continúan funcionando.
 * 10. Bloqueo de escrituras directas del cliente anon/autenticado (permission denied).
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

const envPath = 'c:/Users/gdipd/Documents/Proyectos/aciacam-app/.env.integration.local';
if (fs.existsSync(envPath)) {
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    console.error('Faltan variables de entorno para Supabase Integration');
    process.exit(1);
}

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

async function run() {
    // Dynamic imports
    const { GET: documentsGet, POST: documentsPost } = await import('../app/api/socios/[id]/documents/route');
    const { GET: complianceGet } = await import('../app/api/socios/[id]/compliance/route');
    const { GET: socioAdminGet } = await import('../app/api/admin/socios/[id]/route');

    console.log('====================================================================');
    console.log(' ACIACAM APP - SPRINT UX-03A.3: VERIFICACIÓN DOCUMENTAL');
    console.log(' Target: Supabase Integration (uqwuhjxzazsexuvqxmfm)');
    console.log('====================================================================\n');

    let allPassed = true;

    // 1. Autenticar usuarios de prueba
    console.log('[Fase 1] Autenticando Admin E2E, Staff E2E y Socio E2E...');
    const adminEmail = 'e2e-admin-sprint5@aciacam-test.invalid';
    const staffEmail = 'e2e-staff-b-sprint5@aciacam-test.invalid';
    const socioEmail = 'e2e-socio-sprint5@aciacam-test.invalid';
    const socioId = '30000000-0000-4000-8000-000000000012';
    const otherSocioId = '797390f8-0952-45d3-9bf6-4e9ec0482d57';

    const aLink = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: adminEmail });
    const aVerify = await anonClient.auth.verifyOtp({ token_hash: aLink.data!.properties!.hashed_token!, type: 'magiclink' });
    const adminToken = aVerify.data.session!.access_token;

    const stLink = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: staffEmail });
    const stVerify = await anonClient.auth.verifyOtp({ token_hash: stLink.data!.properties!.hashed_token!, type: 'magiclink' });
    const staffToken = stVerify.data.session!.access_token;

    const sLink = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: socioEmail });
    const sVerify = await anonClient.auth.verifyOtp({ token_hash: sLink.data!.properties!.hashed_token!, type: 'magiclink' });
    const socioToken = sVerify.data.session!.access_token;

    console.log('  PASS: Tokens de autenticación obtenidos para Admin, Staff y Socio.\n');

    // Helper para invocar endpoints Next.js
    const invokeRoute = async (handler: any, url: string, method: string, token: string | null, body?: any, paramsObj: any = { id: socioId }) => {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (body) headers['Content-Type'] = 'application/json';

        const req = new NextRequest(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });

        const context = { params: Promise.resolve(paramsObj) };
        return await handler(req, context);
    };

    // Snapshot inicial del documento para restauración
    const { data: initialDoc } = await adminClient
        .from('documentos_socio')
        .select('*')
        .eq('socio_id', socioId)
        .eq('tipo', 'reprocann')
        .eq('is_current', true)
        .maybeSingle();

    try {
        // TEST 1: Admin puede revisar y aprobar un documento pendiente
        console.log('[Test 1] Admin revisa y aprueba REPROCANN con fechas...');
        const resAdminApprove = await invokeRoute(
            documentsPost,
            `https://integration.test/api/socios/${socioId}/documents`,
            'POST',
            adminToken,
            {
                tipo: 'reprocann',
                verificacion_estado: 'aprobado',
                verificacion_obs: 'Aprobado por Admin E2E en test UX-03A.3',
                fecha_emision: '2026-08-01',
                fecha_vencimiento: '2027-08-01',
                numero_tramite: 'E2E-SOCIA-REF'
            }
        );
        const dataAdminApprove = await resAdminApprove.json();
        if (resAdminApprove.status === 200 && dataAdminApprove.success && dataAdminApprove.document.verificacion_estado === 'aprobado') {
            console.log('  PASS: Admin aprobó documento correctamente (HTTP 200).');
        } else {
            console.error('  FAIL Test 1:', resAdminApprove.status, dataAdminApprove);
            allPassed = false;
        }

        // TEST 2: Staff puede realizar acciones autorizadas
        console.log('[Test 2] Staff actualiza notas de verificación autorizadas...');
        const resStaffUpdate = await invokeRoute(
            documentsPost,
            `https://integration.test/api/socios/${socioId}/documents`,
            'POST',
            staffToken,
            {
                tipo: 'reprocann',
                verificacion_obs: 'Observación añadida por Staff E2E',
                fecha_emision: '2026-08-01',
                fecha_vencimiento: '2027-08-01'
            }
        );
        const dataStaffUpdate = await resStaffUpdate.json();
        if (resStaffUpdate.status === 200 && dataStaffUpdate.success) {
            console.log('  PASS: Staff pudo actualizar observaciones correctamente (HTTP 200).');
        } else {
            console.error('  FAIL Test 2:', resStaffUpdate.status, dataStaffUpdate);
            allPassed = false;
        }

        // TEST 3: Socio no puede aprobar su propio documento
        console.log('[Test 3] Socio intenta auto-aprobar su propio documento (debe ser rechazado)...');
        const resSocioApprove = await invokeRoute(
            documentsPost,
            `https://integration.test/api/socios/${socioId}/documents`,
            'POST',
            socioToken,
            {
                tipo: 'reprocann',
                verificacion_estado: 'aprobado'
            }
        );
        const dataSocioApprove = await resSocioApprove.json();
        if (resSocioApprove.status === 403) {
            console.log(`  PASS: Auto-aprobación de socio rechazada con HTTP 403: "${dataSocioApprove.error}".`);
        } else {
            console.error('  FAIL Test 3: Socio pudo auto-aprobar o no devolvió 403:', resSocioApprove.status, dataSocioApprove);
            allPassed = false;
        }

        // TEST 4: Socio no puede modificar documentos ajenos
        console.log('[Test 4] Socio intenta modificar documentos de otro socio (debe ser rechazado)...');
        const resSocioOther = await invokeRoute(
            documentsPost,
            `https://integration.test/api/socios/${otherSocioId}/documents`,
            'POST',
            socioToken,
            {
                tipo: 'reprocann',
                observaciones: 'Intento de escritura ajena'
            },
            { id: otherSocioId }
        );
        const dataSocioOther = await resSocioOther.json();
        if (resSocioOther.status === 403) {
            console.log(`  PASS: Modificación a socio ajeno bloqueada con HTTP 403: "${dataSocioOther.error}".`);
        } else {
            console.error('  FAIL Test 4: No bloqueó socio ajeno:', resSocioOther.status, dataSocioOther);
            allPassed = false;
        }

        // TEST 5: Admin puede consultar historial y versiones
        console.log('[Test 5] Admin consulta historial documental...');
        const resAdminHistory = await invokeRoute(
            documentsGet,
            `https://integration.test/api/socios/${socioId}/documents?tipo=reprocann`,
            'GET',
            adminToken
        );
        const dataAdminHistory = await resAdminHistory.json();
        if (resAdminHistory.status === 200 && Array.isArray(dataAdminHistory) && dataAdminHistory.length > 0) {
            console.log(`  PASS: Historial recuperado (${dataAdminHistory.length} documento/s, current version ${dataAdminHistory[0].version}).`);
        } else {
            console.error('  FAIL Test 5:', resAdminHistory.status, dataAdminHistory);
            allPassed = false;
        }

        // TEST 6: Documento aprobado se refleja en Compliance
        console.log('[Test 6] Verificación en API Compliance de documento aprobado...');
        const resComplianceApprove = await invokeRoute(
            complianceGet,
            `https://integration.test/api/socios/${socioId}/compliance`,
            'GET',
            adminToken
        );
        const dataComplianceApprove = await resComplianceApprove.json();
        if (resComplianceApprove.status === 200 && dataComplianceApprove.detalle?.reprocann?.estado === 'aprobado') {
            console.log('  PASS: Compliance refleja REPROCANN como "aprobado".');
        } else {
            console.error('  FAIL Test 6:', resComplianceApprove.status, dataComplianceApprove.detalle?.reprocann);
            allPassed = false;
        }

        // TEST 7: Documento rechazado no aparece como aprobado en Compliance
        console.log('[Test 7] Admin rechaza documento y se verifica en Compliance...');
        await invokeRoute(
            documentsPost,
            `https://integration.test/api/socios/${socioId}/documents`,
            'POST',
            adminToken,
            {
                tipo: 'reprocann',
                verificacion_estado: 'rechazado',
                verificacion_obs: 'Documento observado por prueba de rechazo'
            }
        );
        const resComplianceReject = await invokeRoute(
            complianceGet,
            `https://integration.test/api/socios/${socioId}/compliance`,
            'GET',
            adminToken
        );
        const dataComplianceReject = await resComplianceReject.json();
        if (resComplianceReject.status === 200 && dataComplianceReject.detalle?.reprocann?.estado === 'rechazado') {
            console.log('  PASS: Compliance refleja REPROCANN como "rechazado" (no aprobado).');
        } else {
            console.error('  FAIL Test 7:', resComplianceReject.status, dataComplianceReject.detalle?.reprocann);
            allPassed = false;
        }

        // TEST 8: Conservación del versionado al subir un nuevo archivo
        console.log('[Test 8] Versionado: reemplazo con nuevo archivo genera versión 2 conservando versión 1...');
        const dummyPath = `${socioId}/reprocann/dummy_v2_${Date.now()}.pdf`;
        const resNewVersion = await invokeRoute(
            documentsPost,
            `https://integration.test/api/socios/${socioId}/documents`,
            'POST',
            adminToken,
            {
                tipo: 'reprocann',
                archivo_path: dummyPath,
                verificacion_estado: 'pendiente',
                fecha_emision: '2026-08-01',
                fecha_vencimiento: '2027-08-01'
            }
        );
        const dataNewVersion = await resNewVersion.json();
        if (resNewVersion.status === 200 && dataNewVersion.document.version >= 2 && dataNewVersion.document.is_current === true) {
            // Verificar que la versión anterior quedó con is_current = false
            const { data: previousDocs } = await adminClient
                .from('documentos_socio')
                .select('id, version, is_current')
                .eq('socio_id', socioId)
                .eq('tipo', 'reprocann')
                .order('version', { ascending: false });

            const hasInactivePrevious = previousDocs && previousDocs.some((d: any) => d.is_current === false);
            if (hasInactivePrevious) {
                console.log(`  PASS: Versión incrementada a ${dataNewVersion.document.version} y versión previa conservada con is_current=false.`);
            } else {
                console.error('  FAIL Test 8: No se encontró versión anterior con is_current=false');
                allPassed = false;
            }

            // Cleanup the dummy v2 test row and restore initial doc as current
            await adminClient.from('documentos_socio').delete().eq('id', dataNewVersion.document.id);
            if (initialDoc) {
                await adminClient.from('documentos_socio').update({ is_current: true }).eq('id', initialDoc.id);
            }
        } else {
            console.error('  FAIL Test 8:', resNewVersion.status, dataNewVersion);
            allPassed = false;
        }

        // TEST 9: Pedidos, stock y perfil de socio continúan funcionando
        console.log('[Test 9] Regresión: Pedidos, stock y perfil...');
        const resSocioProfile = await invokeRoute(
            socioAdminGet,
            `https://integration.test/api/admin/socios/${socioId}`,
            'GET',
            adminToken
        );
        const dataSocioProfile = await resSocioProfile.json();

        const { data: pedidosCheck, error: pErr } = await adminClient.from('pedidos').select('id').limit(2);
        const { data: stockCheck, error: sErr } = await adminClient.from('products').select('id').limit(2);

        if (resSocioProfile.status === 200 && dataSocioProfile.id === socioId && !pErr && !sErr) {
            console.log(`  PASS: Perfil recuperado (${dataSocioProfile.nombre} ${dataSocioProfile.apellido}), pedidos (${pedidosCheck?.length}) y stock (${stockCheck?.length}) operativos.`);
        } else {
            console.error('  FAIL Test 9: Regresión detectada:', resSocioProfile.status, pErr, sErr);
            allPassed = false;
        }

        // TEST 10: Escrituras directas desde el navegador denegadas por seguridad
        console.log('[Test 10] Cero exposición: escrituras directas desde cliente denegadas por Postgres...');
        const authedUserClient = createClient(SUPABASE_URL, ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${adminToken}` } }
        });

        const { error: directErr } = await authedUserClient
            .from('documentos_socio')
            .update({ verificacion_obs: 'intento directo' })
            .eq('socio_id', socioId);

        if (directErr && (directErr.message.includes('permission denied') || directErr.code === '42501')) {
            console.log(`  PASS: Escritura directa bloqueada por base de datos: "${directErr.message}".`);
        } else {
            console.error('  FAIL Test 10: Se permitió escritura directa o error inesperado:', directErr);
            allPassed = false;
        }

    } finally {
        // Restauración del estado del documento de prueba en Integration
        console.log('\n[Limpieza] Restaurando estado original de pruebas en Integration...');
        if (initialDoc) {
            await adminClient
                .from('documentos_socio')
                .update({
                    verificacion_estado: initialDoc.verificacion_estado,
                    verificacion_obs: initialDoc.verificacion_obs,
                    verificado_at: initialDoc.verificado_at,
                    verificado_por: initialDoc.verificado_por,
                    fecha_emision: initialDoc.fecha_emision,
                    fecha_vencimiento: initialDoc.fecha_vencimiento,
                    is_current: true,
                    version: initialDoc.version
                })
                .eq('id', initialDoc.id);
            console.log('  Estado documental restaurado con éxito.');
        }
    }

    console.log('====================================================================');
    if (allPassed) {
        console.log(' RESULTADO FINAL SPRINT UX-03A.3: TODAS LAS PRUEBAS PASARON (10/10 OK)');
    } else {
        console.error(' RESULTADO FINAL SPRINT UX-03A.3: FALLARON UNA O MÁS PRUEBAS');
        process.exit(1);
    }
    console.log('====================================================================\n');
}

run().catch(e => {
    console.error('Fatal test error:', e);
    process.exit(1);
});
