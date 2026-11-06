import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

const localEnvPath = 'c:/Users/gdipd/Documents/Proyectos/aciacam-app/.env.integration.local';
if (fs.existsSync(localEnvPath)) {
    const envVars = dotenv.parse(fs.readFileSync(localEnvPath));
    for (const k in envVars) {
        process.env[k] = envVars[k];
    }
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

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
    // Dynamic import route handlers after env vars are populated
    const { GET: socioAdminGet } = await import('../app/api/admin/socios/[id]/route');
    const { GET: byUserGet } = await import('../app/api/admin/socios/by-user/route');
    const { GET: complianceGet } = await import('../app/api/socios/[id]/compliance/route');
    const { GET: documentsGet } = await import('../app/api/socios/[id]/documents/route');
    const { GET: signedUrlGet } = await import('../app/api/docs/signed-url/route');

    console.log('====================================================================');
    console.log(' ACIACAM APP - SPRINT UX-03A.1: VERIFICACIÓN INTEGRAL');
    console.log(' Target: Supabase Integration (uqwuhjxzazsexuvqxmfm)');
    console.log('====================================================================\n');

    let allPassed = true;

    // 1. Autenticar Socio E2E y Admin E2E
    console.log('[Fase 1] Autenticando Socio y Admin E2E...');
    const socioEmail = 'e2e-socio-sprint5@aciacam-test.invalid';
    const adminEmail = 'e2e-admin-sprint5@aciacam-test.invalid';

    const sLink = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: socioEmail });
    const sVerify = await anonClient.auth.verifyOtp({ token_hash: sLink.data!.properties!.hashed_token!, type: 'magiclink' });
    const socioToken = sVerify.data.session!.access_token;
    const socioAuthUser = sVerify.data.session!.user;

    const aLink = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: adminEmail });
    const aVerify = await anonClient.auth.verifyOtp({ token_hash: aLink.data!.properties!.hashed_token!, type: 'magiclink' });
    const adminToken = aVerify.data.session!.access_token;
    const adminAuthUser = aVerify.data.session!.user;

    console.log(`  PASS: Socio Auth ID: ${socioAuthUser.id}`);
    console.log(`  PASS: Admin Auth ID: ${adminAuthUser.id}`);

    // Consultar IDs en public.socios
    const { data: socioDb } = await adminClient
        .from('socios')
        .select('id, reprocann_num_tramite, reprocann_fecha_vencimiento')
        .eq('auth_user_id', socioAuthUser.id)
        .single();

    const { data: adminDb } = await adminClient
        .from('socios')
        .select('id')
        .eq('auth_user_id', adminAuthUser.id)
        .single();

    if (!socioDb || !adminDb) {
        console.error('  FAIL: No se encontraron los registros en public.socios');
        process.exit(1);
    }

    const socioId = socioDb.id;
    const adminId = adminDb.id;
    console.log(`  PASS: Socio public.socios ID: ${socioId}`);
    console.log(`  PASS: Admin public.socios ID: ${adminId}`);

    // --- TEST 1: Socio consulta su propia ficha en /api/admin/socios/[id] (HTTP 200) ---
    console.log('\n[Test 1] Socio consulta su propia ficha en /api/admin/socios/[id]...');
    const req1 = new NextRequest(`http://localhost:3000/api/admin/socios/${socioId}`, {
        headers: { Authorization: `Bearer ${socioToken}` }
    });
    const res1 = await socioAdminGet(req1, { params: Promise.resolve({ id: socioId }) });
    if (res1.status === 200) {
        console.log('  PASS: Socio pudo consultar su propia ficha (HTTP 200).');
    } else {
        console.error(`  FAIL: Socio consultando su ficha dio HTTP ${res1.status}`);
        allPassed = false;
    }

    // --- TEST 2: Socio intenta consultar ficha ajena (Admin) en /api/admin/socios/[id] (HTTP 403) ---
    console.log('\n[Test 2] Socio intenta consultar ficha ajena (Admin) en /api/admin/socios/[id]...');
    const req2 = new NextRequest(`http://localhost:3000/api/admin/socios/${adminId}`, {
        headers: { Authorization: `Bearer ${socioToken}` }
    });
    const res2 = await socioAdminGet(req2, { params: Promise.resolve({ id: adminId }) });
    if (res2.status === 403) {
        console.log('  PASS: Consulta de ficha ajena bloqueada con HTTP 403 Forbidden.');
    } else {
        console.error(`  FAIL: Esperado HTTP 403, recibido HTTP ${res2.status}`);
        allPassed = false;
    }

    // --- TEST 3: Admin consulta ficha de socio en /api/admin/socios/[id] (HTTP 200) ---
    console.log('\n[Test 3] Admin consulta ficha de socio en /api/admin/socios/[id]...');
    const req3 = new NextRequest(`http://localhost:3000/api/admin/socios/${socioId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    const res3 = await socioAdminGet(req3, { params: Promise.resolve({ id: socioId }) });
    if (res3.status === 200) {
        console.log('  PASS: Admin consultó la ficha del socio con HTTP 200.');
    } else {
        console.error(`  FAIL: Admin consultando socio dio HTTP ${res3.status}`);
        allPassed = false;
    }

    // --- TEST 4 & 5: Trámite 'E2E-SOCIA-REF' y Vencimiento '2027-08-01' en el payload ---
    console.log('\n[Test 4 & 5] Verificación de campos REPROCANN en el payload de la API...');
    const payloadSocio = await res1.json();
    if (payloadSocio.reprocann_num_tramite === 'E2E-SOCIA-REF') {
        console.log(`  PASS: reprocann_num_tramite recuperado con éxito: "${payloadSocio.reprocann_num_tramite}"`);
    } else {
        console.error(`  FAIL: reprocann_num_tramite esperado "E2E-SOCIA-REF", recibido "${payloadSocio.reprocann_num_tramite}"`);
        allPassed = false;
    }

    if (payloadSocio.reprocann_fecha_vencimiento === '2027-08-01') {
        console.log(`  PASS: reprocann_fecha_vencimiento recuperado con éxito: "${payloadSocio.reprocann_fecha_vencimiento}"`);
    } else {
        console.error(`  FAIL: reprocann_fecha_vencimiento esperado "2027-08-01", recibido "${payloadSocio.reprocann_fecha_vencimiento}"`);
        allPassed = false;
    }

    // Verificar documentos adjuntos en el payload
    if (Array.isArray(payloadSocio.documentos) && payloadSocio.documentos.length > 0) {
        console.log(`  PASS: Documentos embebidos en la ficha (${payloadSocio.documentos.length} documentos encontrados).`);
    } else {
        console.error('  FAIL: No se encontraron documentos embebidos en la respuesta');
        allPassed = false;
    }

    // --- TEST 6 & 7: Compliance Status - Diferenciación explícita de estados ---
    console.log('\n[Test 6 & 7] Verificación de Compliance Status (no tilde verde para pendiente)...');
    const compReq = new NextRequest(`http://localhost:3000/api/socios/${socioId}/compliance`, {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    const compRes = await complianceGet(compReq, { params: Promise.resolve({ id: socioId }) });
    if (compRes.status !== 200) {
        console.error(`  FAIL: Compliance API respondió con HTTP ${compRes.status}`);
        allPassed = false;
    } else {
        const comp = await compRes.json();

        // 1. REPROCANN debe estar en documentos_presentes
        if (comp.documentos_presentes.includes('reprocann')) {
            console.log('  PASS: REPROCANN está en documentos_presentes (documento cargado).');
        } else {
            console.error('  FAIL: REPROCANN no figura en documentos_presentes');
            allPassed = false;
        }

        // 2. REPROCANN NO debe estar en documentos_aprobados (porque su verificacion_estado es pendiente)
        if (!comp.documentos_aprobados.includes('reprocann')) {
            console.log('  PASS: REPROCANN NO está en documentos_aprobados (estado pendiente).');
        } else {
            console.error('  FAIL: REPROCANN figura erróneamente en documentos_aprobados!');
            allPassed = false;
        }

        // 3. Detalle de REPROCANN debe indicar estado presentado_pendiente
        if (comp.detalle?.reprocann?.estado === 'presentado_pendiente') {
            console.log('  PASS: Detalle de REPROCANN tiene estado "presentado_pendiente".');
        } else {
            console.error(`  FAIL: Estado en detalle esperado "presentado_pendiente", recibido "${comp.detalle?.reprocann?.estado}"`);
            allPassed = false;
        }

        // 4. Compliance global NO debe ser completo (faltan aprobaciones)
        if (comp.completo === false) {
            console.log('  PASS: Compliance completo es false (no da falso positivo de cumplimiento).');
        } else {
            console.error('  FAIL: Compliance completo es true indebidamente!');
            allPassed = false;
        }
    }

    // --- TEST 8: Documentos API segura (/api/socios/[id]/documents) ---
    console.log('\n[Test 8] Verificación de API segura de documentos (/api/socios/[id]/documents)...');
    // 8.1 Socio consultando sus propios documentos
    const docsReq = new NextRequest(`http://localhost:3000/api/socios/${socioId}/documents`, {
        headers: { Authorization: `Bearer ${socioToken}` }
    });
    const docsRes = await documentsGet(docsReq, { params: Promise.resolve({ id: socioId }) });
    if (docsRes.status === 200) {
        const docsList = await docsRes.json();
        console.log(`  PASS: Socio recuperó sus documentos vía BFF (${docsList.length} registros).`);
    } else {
        console.error(`  FAIL: Socio consultando sus documentos dio HTTP ${docsRes.status}`);
        allPassed = false;
    }

    // 8.2 Socio consultando documentos de otro socio -> HTTP 403
    const docsSpoofReq = new NextRequest(`http://localhost:3000/api/socios/${adminId}/documents`, {
        headers: { Authorization: `Bearer ${socioToken}` }
    });
    const docsSpoofRes = await documentsGet(docsSpoofReq, { params: Promise.resolve({ id: adminId }) });
    if (docsSpoofRes.status === 403) {
        console.log('  PASS: Socio bloqueado al consultar documentos de otro socio (HTTP 403).');
    } else {
        console.error(`  FAIL: Esperado HTTP 403, recibido HTTP ${docsSpoofRes.status}`);
        allPassed = false;
    }

    // --- TEST 9: Signed URLs segura (/api/docs/signed-url) ---
    console.log('\n[Test 9] Verificación de URLs firmadas (/api/docs/signed-url)...');
    const { data: sampleDoc } = await adminClient
        .from('documentos_socio')
        .select('archivo_path')
        .eq('socio_id', socioId)
        .not('archivo_path', 'is', null)
        .limit(1)
        .single();

    if (sampleDoc?.archivo_path) {
        // 9.1 Socio solicitando URL para su propio archivo
        const urlReq = new NextRequest(`http://localhost:3000/api/docs/signed-url?path=${encodeURIComponent(sampleDoc.archivo_path)}`, {
            headers: { Authorization: `Bearer ${socioToken}` }
        });
        const urlRes = await signedUrlGet(urlReq);
        if (urlRes.status === 200) {
            const urlData = await urlRes.json();
            if (urlData.signedUrl && urlData.signedUrl.includes('token=')) {
                console.log('  PASS: Socio generó URL firmada para su propio documento con éxito.');
            } else {
                console.error('  FAIL: signedUrl no devuelta en payload');
                allPassed = false;
            }
        } else {
            console.error(`  FAIL: Socio solicitando signed-url dio HTTP ${urlRes.status}`);
            allPassed = false;
        }

        // 9.2 Socio intentando solicitar URL para archivo de OTRO socio -> HTTP 403
        const { data: otherDoc } = await adminClient
            .from('documentos_socio')
            .select('archivo_path')
            .neq('socio_id', socioId)
            .not('archivo_path', 'is', null)
            .limit(1)
            .single();

        if (otherDoc?.archivo_path) {
            const spoofUrlReq = new NextRequest(`http://localhost:3000/api/docs/signed-url?path=${encodeURIComponent(otherDoc.archivo_path)}`, {
                headers: { Authorization: `Bearer ${socioToken}` }
            });
            const spoofUrlRes = await signedUrlGet(spoofUrlReq);
            if (spoofUrlRes.status === 403) {
                console.log('  PASS: Intento de socio de firmar URL ajena bloqueado con HTTP 403 Forbidden.');
            } else {
                console.error(`  FAIL: Esperado HTTP 403, recibido HTTP ${spoofUrlRes.status}`);
                allPassed = false;
            }
        }

        // 9.2b Path traversal attempt -> HTTP 400
        const traversalReq = new NextRequest(`http://localhost:3000/api/docs/signed-url?path=..%2F..%2Fsecrets.env`, {
            headers: { Authorization: `Bearer ${socioToken}` }
        });
        const traversalRes = await signedUrlGet(traversalReq);
        if (traversalRes.status === 400) {
            console.log('  PASS: Intento de path traversal bloqueado con HTTP 400 Bad Request.');
        } else {
            console.error(`  FAIL: Esperado HTTP 400, recibido HTTP ${traversalRes.status}`);
            allPassed = false;
        }

        // 9.3 Admin solicitando URL para cualquier socio -> HTTP 200
        const adminUrlReq = new NextRequest(`http://localhost:3000/api/docs/signed-url?path=${encodeURIComponent(sampleDoc.archivo_path)}`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        const adminUrlRes = await signedUrlGet(adminUrlReq);
        if (adminUrlRes.status === 200) {
            console.log('  PASS: Admin puede firmar URL de documento de socio (HTTP 200).');
        } else {
            console.error(`  FAIL: Admin firmando URL dio HTTP ${adminUrlRes.status}`);
            allPassed = false;
        }
    } else {
        console.log('  NOTE: No sample document path found for signed url test.');
    }

    // --- TEST 10: /api/admin/socios/by-user (usado en AuthContext y login) ---
    console.log('\n[Test 10] Verificación de /api/admin/socios/by-user...');
    const byUserReq = new NextRequest(`http://localhost:3000/api/admin/socios/by-user?id=${socioAuthUser.id}`, {
        headers: { Authorization: `Bearer ${socioToken}` }
    });
    const byUserRes = await byUserGet(byUserReq);
    if (byUserRes.status === 200) {
        const byUserData = await byUserRes.json();
        if (byUserData.id === socioId && Array.isArray(byUserData.documentos)) {
            console.log(`  PASS: /by-user devolvió socio con documentos embebidos (${byUserData.documentos.length}).`);
        } else {
            console.error('  FAIL: /by-user respuesta inválida o sin documentos');
            allPassed = false;
        }
    } else {
        console.error(`  FAIL: /by-user dio HTTP ${byUserRes.status}`);
        allPassed = false;
    }

    console.log('\n====================================================================');
    if (allPassed) {
        console.log(' RESULTADO FINAL SPRINT UX-03A.1: TODAS LAS PRUEBAS PASARON (10/10 OK)');
    } else {
        console.log(' RESULTADO FINAL SPRINT UX-03A.1: SE DETECTARON ERRORES');
        process.exit(1);
    }
    console.log('====================================================================');
}

run().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
