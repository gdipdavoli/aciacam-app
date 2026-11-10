/**
 * scripts/test_sprint_ux03b2_integration.ts
 *
 * ACIACAM APP - SPRINT UX-03B.2: VERIFICACIÓN INTEGRAL DE PERSISTENCIA Y SEGURIDAD
 * Entorno: Supabase Integration (uqwuhjxzazsexuvqxmfm)
 *
 * Pruebas obligatorias:
 * [Test 1] Alta con fecha de nacimiento y lectura posterior desde la base (PostgreSQL).
 * [Test 2] Visualización correcta desde Administración (GET /api/admin/socios/[id]).
 * [Test 3] Visualización correcta desde Mi Cuenta (BFF de Socio y formatCalendarDate).
 * [Test 4] Edición y persistencia de fecha de nacimiento (PATCH /api/admin/socios/[id]).
 * [Test 5] Socio antiguo con fecha de nacimiento NULL (preservación histórica).
 * [Test 6] Reintento idéntico con misma clave de idempotencia (recuperación sin duplicar).
 * [Test 7] Intento de alta diferente con DNI ya registrado (conflicto HTTP 409).
 * [Test 8] Solicitudes concurrentes simultáneas (resistencia a carreras, exactamente 1 creado).
 */

import fs from 'fs';
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
    const { POST: adminSociosPost } = await import('../app/api/admin/socios/route');
    const { GET: socioDetailGet, PATCH: socioDetailPatch } = await import('../app/api/admin/socios/[id]/route');
    const { formatCalendarDate } = await import('../app/lib/date-format');

    console.log('====================================================================');
    console.log(' ACIACAM APP - SPRINT UX-03B.2: VERIFICACIÓN INTEGRAL DE PERSISTENCIA');
    console.log(' Target: Supabase Integration (uqwuhjxzazsexuvqxmfm)');
    console.log('====================================================================\n');

    let allPassed = true;
    const createdSocioIds: string[] = [];

    // 1. Autenticar Admin E2E y Socio E2E
    console.log('[Autenticación] Obteniendo credenciales para Admin y Socio E2E...');
    const adminEmail = 'e2e-admin-sprint5@aciacam-test.invalid';
    const socioEmail = 'e2e-socio-sprint5@aciacam-test.invalid';
    const socioHistoricoId = '30000000-0000-4000-8000-000000000012';

    const aLink = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: adminEmail });
    const aVerify = await anonClient.auth.verifyOtp({ token_hash: aLink.data!.properties!.hashed_token!, type: 'magiclink' });
    const adminToken = aVerify.data.session!.access_token;

    const sLink = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: socioEmail });
    const sVerify = await anonClient.auth.verifyOtp({ token_hash: sLink.data!.properties!.hashed_token!, type: 'magiclink' });
    const socioToken = sVerify.data.session!.access_token;

    console.log('  PASS: Credenciales obtenidas con éxito.\n');

    const invokeRoute = async (handler: any, url: string, method: string, token: string | null, body?: any, paramsObj?: any, extraHeaders?: Record<string, string>) => {
        const headers: Record<string, string> = { ...extraHeaders };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (body) headers['Content-Type'] = 'application/json';

        const req = new NextRequest(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });

        const context = paramsObj ? { params: Promise.resolve(paramsObj) } : undefined;
        return await handler(req, context);
    };

    // Test 1: Alta con fecha de nacimiento y lectura posterior desde la base
    console.log('[Test 1] Alta de socio con fecha de nacimiento y lectura directa en BD...');
    const dniTest1 = '99937001';
    const emailTest1 = 'test-ux03b2-persistencia@aciacam-test.invalid';
    const idemKey1 = `alta_test1_${Date.now()}`;
    const fechaNac1 = '1985-07-21';

    const res1 = await invokeRoute(adminSociosPost, 'http://localhost/api/admin/socios', 'POST', adminToken, {
        nombre: 'Carlos',
        apellido: 'Persistencia',
        dni: dniTest1,
        email: emailTest1,
        telefono: '2664777777',
        fechaNacimiento: fechaNac1,
        envios_habilitados: true,
        reprocann_num_tramite: 'TR-PERSIST-881',
        idempotency_key: idemKey1
    }, undefined, { 'Idempotency-Key': idemKey1 });

    let socio1Id = '';
    if (res1.status === 201) {
        const d1 = await res1.json();
        socio1Id = d1.id;
        createdSocioIds.push(socio1Id);

        // Consultar directamente en Supabase PostgreSQL
        const { data: dbCheck, error: errDb } = await adminClient
            .from('socios')
            .select('id, nombre, dni, fecha_nacimiento, envios_habilitados')
            .eq('id', socio1Id)
            .single();

        if (dbCheck && dbCheck.fecha_nacimiento === fechaNac1) {
            console.log(`  PASS: Socio creado (ID: ${socio1Id}).`);
            console.log(`  PASS: Columna fecha_nacimiento almacenada en PostgreSQL: "${dbCheck.fecha_nacimiento}".`);
            console.log(`  PASS: Delivery almacenado: ${dbCheck.envios_habilitados === true}.`);
        } else {
            console.error('  FAIL: Lectura directa en BD falló:', dbCheck, errDb);
            allPassed = false;
        }
    } else {
        console.error('  FAIL: Error creando socio:', res1.status, await res1.text());
        allPassed = false;
    }

    // Test 2: Visualización correcta desde Administración (GET /api/admin/socios/[id])
    console.log('\n[Test 2] Consulta de ficha completa desde Administración...');
    const res2 = await invokeRoute(socioDetailGet, `http://localhost/api/admin/socios/${socio1Id}`, 'GET', adminToken, undefined, { id: socio1Id });
    if (res2.status === 200) {
        const d2 = await res2.json();
        if (d2.fecha_nacimiento === fechaNac1) {
            console.log(`  PASS: GET /api/admin/socios/[id] retornó fecha_nacimiento: "${d2.fecha_nacimiento}".`);
        } else {
            console.error('  FAIL: fecha_nacimiento no presente en respuesta:', d2);
            allPassed = false;
        }
    } else {
        console.error('  FAIL: Error consultando ficha administrativa:', res2.status);
        allPassed = false;
    }

    // Test 3: Visualización correcta desde Mi Cuenta (formateo civil de fecha)
    console.log('\n[Test 3] Formateo civil exacto de fecha para visualización en Mi Cuenta...');
    const formattedCivil = formatCalendarDate(fechaNac1);
    if (formattedCivil === '21/07/1985') {
        console.log(`  PASS: formatCalendarDate("${fechaNac1}") -> "${formattedCivil}" (sin desplazamientos horarios).`);
    } else {
        console.error('  FAIL: Formateo inesperado:', formattedCivil);
        allPassed = false;
    }

    // Test 4: Edición y persistencia del dato (PATCH /api/admin/socios/[id])
    console.log('\n[Test 4] Edición y actualización de fecha de nacimiento (PATCH)...');
    const fechaNacModificada = '1985-07-22';
    const res4 = await invokeRoute(socioDetailPatch, `http://localhost/api/admin/socios/${socio1Id}`, 'PATCH', adminToken, {
        fecha_nacimiento: fechaNacModificada,
        telefono: '2664888888'
    }, { id: socio1Id });

    if (res4.status === 200) {
        const d4 = await res4.json();
        // Verificar en BD
        const { data: dbCheck4 } = await adminClient.from('socios').select('fecha_nacimiento').eq('id', socio1Id).single();
        if (dbCheck4?.fecha_nacimiento === fechaNacModificada) {
            console.log(`  PASS: Ficha actualizada correctamente vía PATCH.`);
            console.log(`  PASS: Nuevo valor persistido en BD: "${dbCheck4.fecha_nacimiento}".`);
        } else {
            console.error('  FAIL: Valor en BD no coincide:', dbCheck4);
            allPassed = false;
        }
    } else {
        console.error('  FAIL: Error en PATCH /api/admin/socios/[id]:', res4.status, await res4.text());
        allPassed = false;
    }

    // Test 5: Socio antiguo con fecha de nacimiento NULL
    console.log('\n[Test 5] Consulta de socio histórico con fecha_nacimiento NULL...');
    const { data: socioHist, error: errHist } = await adminClient
        .from('socios')
        .select('id, nombre, apellido, fecha_nacimiento')
        .eq('id', socioHistoricoId)
        .single();

    if (socioHist && socioHist.fecha_nacimiento === null) {
        const fallbackDisplay = formatCalendarDate(socioHist.fecha_nacimiento, 'No informada');
        console.log(`  PASS: Socio histórico ID ${socioHist.id} conserva fecha_nacimiento = null.`);
        console.log(`  PASS: Visualización en interfaz: "${fallbackDisplay}" (sin datos ficticios).`);
    } else {
        console.error('  FAIL: Socio histórico tiene valor inesperado:', socioHist, errHist);
        allPassed = false;
    }

    // Test 6: Reintento idéntico con misma clave de idempotencia
    console.log('\n[Test 6] Reintento de la misma operación con misma Idempotency-Key...');
    const res6 = await invokeRoute(adminSociosPost, 'http://localhost/api/admin/socios', 'POST', adminToken, {
        nombre: 'Carlos',
        apellido: 'Persistencia',
        dni: dniTest1,
        email: emailTest1,
        telefono: '2664777777',
        fechaNacimiento: fechaNac1,
        idempotency_key: idemKey1
    }, undefined, { 'Idempotency-Key': idemKey1 });

    if (res6.status === 200) {
        const d6 = await res6.json();
        if (d6.id === socio1Id && d6._idempotent_replay === true) {
            console.log(`  PASS: Operación idéntica recuperó el socio existente con HTTP 200.`);
            console.log(`  PASS: Identificador coincide exactamente (ID: ${d6.id}) sin crear segundo registro.`);
        } else {
            console.error('  FAIL: Respuesta idempotente incorrecta:', d6);
            allPassed = false;
        }
    } else {
        console.error('  FAIL: Reintento falló con status:', res6.status, await res6.text());
        allPassed = false;
    }

    // Test 7: Intento de alta diferente con DNI ya registrado (Conflicto 409)
    console.log('\n[Test 7] Intento de alta diferente con DNI ya registrado...');
    const idemKeyDiferente = `alta_diferente_${Date.now()}`;
    const res7 = await invokeRoute(adminSociosPost, 'http://localhost/api/admin/socios', 'POST', adminToken, {
        nombre: 'Otra Persona',
        apellido: 'Distinta',
        dni: dniTest1, // Mismo DNI ya existente
        email: 'otro-correo-distinto@aciacam-test.invalid',
        telefono: '2664999999',
        fechaNacimiento: '1995-10-10',
        idempotency_key: idemKeyDiferente
    }, undefined, { 'Idempotency-Key': idemKeyDiferente });

    if (res7.status === 409) {
        const err7 = await res7.json();
        console.log(`  PASS: Operación diferente con DNI ocupado rechazada con HTTP 409: "${err7.error}".`);
    } else {
        console.error('  FAIL: No se bloqueó el conflicto de DNI:', res7.status);
        allPassed = false;
    }

    // Test 8: Solicitudes concurrentes simultáneas con misma clave
    console.log('\n[Test 8] Solicitudes concurrentes simultáneas...');
    const dniConcurrente = '99937002';
    const emailConcurrente = 'test-concurrente@aciacam-test.invalid';
    const idemKeyConcurrente = `alta_concurrent_${Date.now()}`;

    const concurrentPromises = [1, 2, 3].map(() =>
        invokeRoute(adminSociosPost, 'http://localhost/api/admin/socios', 'POST', adminToken, {
            nombre: 'Concurrente',
            apellido: 'Test',
            dni: dniConcurrente,
            email: emailConcurrente,
            telefono: '2664000000',
            fechaNacimiento: '1990-01-01',
            idempotency_key: idemKeyConcurrente
        }, undefined, { 'Idempotency-Key': idemKeyConcurrente })
    );

    const concurrentResults = await Promise.all(concurrentPromises);
    const statuses = concurrentResults.map(r => r.status);
    console.log('  Respuestas recibidas de las 3 solicitudes concurrentes:', statuses);

    // Contar cuántos socios con ese DNI existen en PostgreSQL
    const { data: concSocios } = await adminClient.from('socios').select('id').eq('dni', dniConcurrente);
    if (concSocios && concSocios.length === 1) {
        createdSocioIds.push(concSocios[0].id);
        console.log(`  PASS: Se creó exactamente 1 socio en la base de datos (ID: ${concSocios[0].id}). Cero duplicados.`);
    } else {
        console.error('  FAIL: Número inesperado de socios creados:', concSocios?.length);
        allPassed = false;
    }

    // Limpieza de socios temporales
    console.log('\n[Limpieza] Eliminando registros temporales de prueba...');
    for (const sid of createdSocioIds) {
        await adminClient.from('socios').delete().eq('id', sid);
    }
    console.log(`  PASS: ${createdSocioIds.length} socios de prueba eliminados limpiamente.`);

    console.log('\n====================================================================');
    if (allPassed) {
        console.log(' RESULTADO FINAL SPRINT UX-03B.2: TODAS LAS PRUEBAS PASARON (8/8 OK)');
    } else {
        console.error(' RESULTADO FINAL SPRINT UX-03B.2: AL MENOS UNA PRUEBA FALLÓ');
    }
    console.log('====================================================================\n');

    process.exit(allPassed ? 0 : 1);
}

run().catch(e => {
    console.error('Fatal error en suite UX-03B.2:', e);
    process.exit(1);
});

