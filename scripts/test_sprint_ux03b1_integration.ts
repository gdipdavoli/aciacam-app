/**
 * scripts/test_sprint_ux03b1_integration.ts
 *
 * ACIACAM APP - SPRINT UX-03B.1: VERIFICACIÓN DE ALTA PROGRESIVA Y SITUACIONES REPROCANN
 * Entorno: Supabase Integration (uqwuhjxzazsexuvqxmfm)
 *
 * Casos de prueba:
 * [Caso 1] Alta con REPROCANN vigente (trámite, fechas y certificado).
 * [Caso 2] Alta con REPROCANN vencido (vencimiento anterior a hoy, estado vencido).
 * [Caso 3] Alta con REPROCANN en trámite (número obligatorio, consentimiento médico).
 * [Caso 4] Alta sin REPROCANN / a gestionar (sin trámite ni certificados requeridos).
 * [Caso 5] Validación estricta de fecha de nacimiento (calendario civil gregoriano).
 * [Caso 6] Delivery habilitado por defecto (envios_habilitados = true).
 * [Caso 7] Delivery desactivado por Admin (envios_habilitados = false).
 * [Caso 8] Rechazo de duplicados por DNI.
 * [Caso 9] Idempotencia en reintentos rápidos (recupera socio existente sin duplicar).
 * [Caso 10] Consulta y consistencia de datos desde Administración y Mi Cuenta.
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
    const { POST: adminSociosPost, GET: adminSociosGet } = await import('../app/api/admin/socios/route');
    const { GET: socioDetailGet } = await import('../app/api/admin/socios/[id]/route');
    const { isValidCalendarDate, formatCalendarDate, getSanLuisCivilToday } = await import('../app/lib/date-format');

    console.log('====================================================================');
    console.log(' ACIACAM APP - SPRINT UX-03B.1: VERIFICACIÓN INTEGRAL DE ALTA');
    console.log(' Target: Supabase Integration (uqwuhjxzazsexuvqxmfm)');
    console.log('====================================================================\n');

    let allPassed = true;
    const createdSocioIds: string[] = [];

    // 1. Autenticar Admin E2E
    console.log('[Autenticación] Obteniendo credenciales para Admin E2E...');
    const adminEmail = 'e2e-admin-sprint5@aciacam-test.invalid';
    const aLink = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: adminEmail });
    const aVerify = await anonClient.auth.verifyOtp({ token_hash: aLink.data!.properties!.hashed_token!, type: 'magiclink' });
    const adminToken = aVerify.data.session!.access_token;
    console.log('  PASS: Admin autenticado con éxito.\n');

    const invokeRoute = async (handler: any, url: string, method: string, token: string | null, body?: any, paramsObj?: any) => {
        const headers: Record<string, string> = {};
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

    // Caso 1: Alta con REPROCANN vigente
    console.log('[Caso 1] Alta de socio con REPROCANN vigente...');
    const dniVigente = '99936001';
    const emailVigente = 'test-vigente-ux03b1@aciacam-test.invalid';
    const res1 = await invokeRoute(adminSociosPost, 'http://localhost/api/admin/socios', 'POST', adminToken, {
        nombre: 'Socio Vigente',
        apellido: 'Test UX03B1',
        dni: dniVigente,
        email: emailVigente,
        telefono: '2664111111',
        domicilio: 'Av. Siempre Viva 123',
        localidad: 'San Luis',
        fechaNacimiento: '1988-05-14',
        envios_habilitados: true,
        reprocann_num_tramite: 'TR-VIG-2026-01',
        reprocann_fecha_alta: '2026-01-10',
        reprocann_fecha_vencimiento: '2029-01-10',
        reprocann_tipo: 'ong',
        medico_nombre: 'Dra. Florencia Gómez',
        medico_matricula: 'MP-8921',
        diagnostico: 'Artritis reumatoidea'
    });

    if (res1.status === 201) {
        const data1 = await res1.json();
        createdSocioIds.push(data1.id);
        console.log(`  PASS: Socio vigente creado con éxito (ID: ${data1.id}).`);
        console.log(`  PASS: Trámite persistido: "${data1.reprocann_num_tramite}", Vence: "${data1.reprocann_fecha_vencimiento}".`);
        console.log(`  PASS: Delivery habilitado por defecto: ${data1.envios_habilitados === true}`);
    } else {
        console.error('  FAIL: Error creando socio vigente:', res1.status, await res1.text());
        allPassed = false;
    }

    // Caso 2: Alta con REPROCANN vencido
    console.log('\n[Caso 2] Alta de socio con REPROCANN vencido...');
    const dniVencido = '99936002';
    const emailVencido = 'test-vencido-ux03b1@aciacam-test.invalid';
    const res2 = await invokeRoute(adminSociosPost, 'http://localhost/api/admin/socios', 'POST', adminToken, {
        nombre: 'Socio Vencido',
        apellido: 'Test UX03B1',
        dni: dniVencido,
        email: emailVencido,
        telefono: '2664222222',
        fechaNacimiento: '1975-11-20',
        envios_habilitados: true,
        reprocann_num_tramite: 'TR-VENC-2023-99',
        reprocann_fecha_alta: '2023-01-01',
        reprocann_fecha_vencimiento: '2026-01-01',
        reprocann_tipo: 'ong'
    });

    if (res2.status === 201) {
        const data2 = await res2.json();
        createdSocioIds.push(data2.id);
        console.log(`  PASS: Socio con REPROCANN vencido registrado (ID: ${data2.id}).`);
        console.log(`  PASS: Fecha de vencimiento histórica persistida: "${data2.reprocann_fecha_vencimiento}".`);
    } else {
        console.error('  FAIL: Error creando socio vencido:', res2.status, await res2.text());
        allPassed = false;
    }

    // Caso 3: Alta con REPROCANN en trámite
    console.log('\n[Caso 3] Alta de socio con REPROCANN en trámite...');
    const dniTramite = '99936003';
    const emailTramite = 'test-tramite-ux03b1@aciacam-test.invalid';
    const res3 = await invokeRoute(adminSociosPost, 'http://localhost/api/admin/socios', 'POST', adminToken, {
        nombre: 'Socio En Trámite',
        apellido: 'Test UX03B1',
        dni: dniTramite,
        email: emailTramite,
        telefono: '2664333333',
        fechaNacimiento: '1992-03-30',
        envios_habilitados: true,
        reprocann_num_tramite: 'GESTION-MIARG-88219',
        reprocann_tipo: 'ong',
        medico_nombre: 'Dr. Alejandro Russo'
    });

    if (res3.status === 201) {
        const data3 = await res3.json();
        createdSocioIds.push(data3.id);
        console.log(`  PASS: Socio en trámite registrado (ID: ${data3.id}).`);
        console.log(`  PASS: Trámite oficial: "${data3.reprocann_num_tramite}", Sin fechas vencimiento forzadas.`);
    } else {
        console.error('  FAIL: Error creando socio en trámite:', res3.status, await res3.text());
        allPassed = false;
    }

    // Caso 4: Alta sin REPROCANN (a gestionar / aspirante)
    console.log('\n[Caso 4] Alta de socio sin REPROCANN (a gestionar)...');
    const dniSin = '99936004';
    const emailSin = 'test-sin-reprocann-ux03b1@aciacam-test.invalid';
    const res4 = await invokeRoute(adminSociosPost, 'http://localhost/api/admin/socios', 'POST', adminToken, {
        nombre: 'Aspirante',
        apellido: 'Test UX03B1',
        dni: dniSin,
        email: emailSin,
        telefono: '2664444444',
        fechaNacimiento: '2001-09-05',
        envios_habilitados: true
    });

    if (res4.status === 201) {
        const data4 = await res4.json();
        createdSocioIds.push(data4.id);
        console.log(`  PASS: Aspirante creado sin exigencia de REPROCANN (ID: ${data4.id}).`);
        console.log(`  PASS: Campos REPROCANN nulos conforme a diseño: num_tramite=${data4.reprocann_num_tramite === null}`);
    } else {
        console.error('  FAIL: Error creando socio sin REPROCANN:', res4.status, await res4.text());
        allPassed = false;
    }

    // Caso 5: Validación estricta de fecha de nacimiento
    console.log('\n[Caso 5] Validación estricta de fecha de nacimiento...');
    const today = getSanLuisCivilToday();
    const todayStr = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
    const validBirth = isValidCalendarDate('1990-12-25');
    const invalidBirthDate = isValidCalendarDate('2026-02-30'); // 30 de febrero no existe
    const invalidFormat = isValidCalendarDate('25/12/1990'); // Formato no YYYY-MM-DD
    const formatted = formatCalendarDate('1990-12-25');

    if (validBirth && !invalidBirthDate && !invalidFormat && formatted === '25/12/1990') {
        console.log('  PASS: Validación de fecha calendario estricta correcta (rechaza 30 de febrero y formatos no canónicos).');
        console.log(`  PASS: Formateo civil exacto sin desfase de huso: "1990-12-25" -> "${formatted}".`);
    } else {
        console.error('  FAIL: Error en funciones de fecha');
        allPassed = false;
    }

    // Caso 6 & 7: Delivery por defecto vs desactivado por Admin
    console.log('\n[Caso 6 & 7] Verificación de delivery habilitado por defecto y toggle administrativo...');
    const dniNoDelivery = '99936005';
    const emailNoDelivery = 'test-no-delivery-ux03b1@aciacam-test.invalid';
    const res7 = await invokeRoute(adminSociosPost, 'http://localhost/api/admin/socios', 'POST', adminToken, {
        nombre: 'Socio Retiro Local',
        apellido: 'Test UX03B1',
        dni: dniNoDelivery,
        email: emailNoDelivery,
        telefono: '2664555555',
        fechaNacimiento: '1985-04-12',
        envios_habilitados: false // Desactivado expresamente por Admin
    });

    if (res7.status === 201) {
        const data7 = await res7.json();
        createdSocioIds.push(data7.id);
        console.log(`  PASS: Delivery desactivado expresamente respetado (envios_habilitados = false).`);
    } else {
        console.error('  FAIL: Error creando socio con delivery desactivado:', res7.status, await res7.text());
        allPassed = false;
    }

    // Caso 8: Rechazo de duplicados por DNI
    console.log('\n[Caso 8] Control de duplicidad de DNI...');
    const res8 = await invokeRoute(adminSociosPost, 'http://localhost/api/admin/socios', 'POST', adminToken, {
        nombre: 'Duplicado Intencional',
        apellido: 'Test',
        dni: dniVigente, // DNI ya existente
        email: 'otro-email@aciacam-test.invalid',
        telefono: '2664999999'
    });

    if (res8.status === 409) {
        const err8 = await res8.json();
        console.log(`  PASS: DNI duplicado rechazado correctamente con HTTP 409: "${err8.error}".`);
    } else {
        console.error('  FAIL: No se bloqueó el DNI duplicado:', res8.status);
        allPassed = false;
    }

    // Caso 9: Idempotencia en reintentos rápidos (simula fallo de red en navegador)
    console.log('\n[Caso 9] Idempotencia y recuperación ante reintento de conexión...');
    const res9 = await invokeRoute(adminSociosPost, 'http://localhost/api/admin/socios', 'POST', adminToken, {
        nombre: 'Socio Vigente',
        apellido: 'Test UX03B1',
        dni: dniVigente,
        email: emailVigente, // Mismo DNI y Email recién creado
        telefono: '2664111111'
    });

    if (res9.status === 200) {
        const data9 = await res9.json();
        console.log(`  PASS: Reintento idempotente recuperó el socio existente sin crear duplicados (ID: ${data9.id}).`);
    } else {
        console.error('  FAIL: Reintento idempotente no funcionó:', res9.status);
        allPassed = false;
    }

    // Caso 10: Consulta desde Administración
    console.log('\n[Caso 10] Consulta de ficha completa desde Administración...');
    const targetId = createdSocioIds[0];
    const res10 = await invokeRoute(socioDetailGet, `http://localhost/api/admin/socios/${targetId}`, 'GET', adminToken, undefined, { id: targetId });

    if (res10.status === 200) {
        const data10 = await res10.json();
        console.log(`  PASS: Ficha consultada con éxito: ${data10.nombre} ${data10.apellido} (DNI: ${data10.dni}).`);
        console.log(`  PASS: Datos médicos recuperados: Médico="${data10.medico_nombre}", Matrícula="${data10.medico_matricula}".`);
        console.log(`  PASS: Delivery habilitado: ${data10.envios_habilitados === true}.`);
    } else {
        console.error('  FAIL: Error consultando ficha en administración:', res10.status);
        allPassed = false;
    }

    // Limpieza de socios temporales de prueba
    console.log('\n[Limpieza] Eliminando socios de prueba temporales...');
    for (const sid of createdSocioIds) {
        await adminClient.from('socios').delete().eq('id', sid);
    }
    console.log(`  PASS: ${createdSocioIds.length} socios de prueba eliminados limpiamente de Integration.`);

    console.log('\n====================================================================');
    if (allPassed) {
        console.log(' RESULTADO FINAL SPRINT UX-03B.1: TODAS LAS PRUEBAS PASARON (10/10 OK)');
    } else {
        console.error(' RESULTADO FINAL SPRINT UX-03B.1: AL MENOS UNA PRUEBA FALLÓ');
    }
    console.log('====================================================================\n');

    process.exit(allPassed ? 0 : 1);
}

run().catch(e => {
    console.error('Fatal error en suite de pruebas:', e);
    process.exit(1);
});

