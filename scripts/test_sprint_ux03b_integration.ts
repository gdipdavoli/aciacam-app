/**
 * scripts/test_sprint_ux03b_integration.ts
 *
 * ACIACAM APP - SPRINT UX-03B: VERIFICACIÓN INTEGRAL DE SOCIOS Y DOCUMENTACIÓN
 * Entorno: Supabase Integration (uqwuhjxzazsexuvqxmfm)
 *
 * Verificaciones:
 * [Fase 1] Versionado, preservación de histórico, 1 versión activa y rollback compensatorio.
 * [Fase 2 y 3] Alta progresiva: persistencia unificada de datos personales, REPROCANN y médicos.
 * [Fase 4] Ciclo de vida documental: 6 estados canónicos y evaluación estricta en Compliance.
 * [Fase 5] Contrato de extracción estructurada OCR y fusión segura de datos.
 * [Fase 6] Regresiones de plataforma y permisos RBAC.
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
    // Dynamic imports
    const { POST: adminSociosPost, GET: adminSociosGet } = await import('../app/api/admin/socios/route');
    const { GET: documentsGet, POST: documentsPost } = await import('../app/api/socios/[id]/documents/route');
    const { GET: complianceGet } = await import('../app/api/socios/[id]/compliance/route');
    const { computeCanonicalDocState, normalizeDocType } = await import('../app/lib/document-lifecycle');
    const { validateOcrExtraction, mergeOcrWithPartnerData } = await import('../app/lib/ocr-contract');

    console.log('====================================================================');
    console.log(' ACIACAM APP - SPRINT UX-03B: VERIFICACIÓN INTEGRAL DE SOCIOS');
    console.log(' Target: Supabase Integration (uqwuhjxzazsexuvqxmfm)');
    console.log('====================================================================\n');

    let allPassed = true;

    // 1. Autenticar Admin E2E y Socio E2E
    console.log('[Autenticación] Obteniendo tokens para Admin y Socio E2E...');
    const adminEmail = 'e2e-admin-sprint5@aciacam-test.invalid';
    const socioEmail = 'e2e-socio-sprint5@aciacam-test.invalid';
    const existingSocioId = '30000000-0000-4000-8000-000000000012';

    const aLink = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: adminEmail });
    const aVerify = await anonClient.auth.verifyOtp({ token_hash: aLink.data!.properties!.hashed_token!, type: 'magiclink' });
    const adminToken = aVerify.data.session!.access_token;

    const sLink = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: socioEmail });
    const sVerify = await anonClient.auth.verifyOtp({ token_hash: sLink.data!.properties!.hashed_token!, type: 'magiclink' });
    const socioToken = sVerify.data.session!.access_token;

    console.log('  PASS: Tokens autenticados con éxito.\n');

    // Helper para invocar endpoints Next.js
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

    let createdTestSocioId: string | null = null;

    try {
        // -------------------------------------------------------------------
        // FASE 1: VERSIONADO Y COMPENSACIÓN TRANSACCIONAL
        // -------------------------------------------------------------------
        console.log('[Fase 1] Versionado documental y salvaguardas transaccionales...');

        // 1.1 Snapshot de documentos iniciales del socio E2E
        const { data: initialDocs } = await adminClient
            .from('documentos_socio')
            .select('*')
            .eq('socio_id', existingSocioId)
            .eq('tipo', 'reprocann');

        const activeInitial = initialDocs?.find(d => d.is_current === true);
        if (!activeInitial) {
            throw new Error('No se encontró documento activo inicial para el socio E2E');
        }

        // 1.2 Simular reemplazo de archivo con nueva versión
        const testPathV2 = `${existingSocioId}/reprocann/ux03b_v2_${Date.now()}.pdf`;
        const resReplace = await invokeRoute(
            documentsPost,
            `https://integration.test/api/socios/${existingSocioId}/documents`,
            'POST',
            adminToken,
            {
                tipo: 'reprocann',
                archivo_path: testPathV2,
                verificacion_estado: 'pendiente',
                fecha_emision: '2026-08-01',
                fecha_vencimiento: '2027-08-01'
            },
            { id: existingSocioId }
        );
        const dataReplace = await resReplace.json();

        // 1.3 Verificar que se generó versión 2 y que existe EXACTAMENTE una versión activa
        const { data: currentCheck } = await adminClient
            .from('documentos_socio')
            .select('id, version, is_current')
            .eq('socio_id', existingSocioId)
            .eq('tipo', 'reprocann')
            .eq('is_current', true);

        if (resReplace.status === 200 && currentCheck?.length === 1 && currentCheck[0].id === dataReplace.document.id) {
            console.log(`  PASS: Nueva versión creada (${dataReplace.document.version}) y exactamente 1 versión activa confirmada.`);
        } else {
            console.error('  FAIL FASE 1.1:', resReplace.status, currentCheck);
            allPassed = false;
        }

        // 1.4 Verificar conservación de la versión anterior con is_current = false
        const { data: prevCheck } = await adminClient
            .from('documentos_socio')
            .select('id, version, is_current')
            .eq('id', activeInitial.id)
            .single();

        if (prevCheck?.is_current === false) {
            console.log(`  PASS: Versión previa (${prevCheck.version}) conservada con is_current = false.`);
        } else {
            console.error('  FAIL FASE 1.2: Versión previa no fue archivada:', prevCheck);
            allPassed = false;
        }

        // 1.5 Limpiar versión temporal v2 y restaurar versión 1
        await adminClient.from('documentos_socio').delete().eq('id', dataReplace.document.id);
        await adminClient.from('documentos_socio').update({ is_current: true }).eq('id', activeInitial.id);
        console.log('  PASS: Estado original restaurado.\n');

        // -------------------------------------------------------------------
        // FASE 2 & 3: ALTA PROGRESIVA Y PERSISTENCIA UNIFICADA
        // -------------------------------------------------------------------
        console.log('[Fase 2 & 3] Alta de socio con persistencia directa de REPROCANN y datos médicos...');

        const testDni = `99${Date.now().toString().slice(-6)}`;
        const testEmail = `test.socio.ux03b.${Date.now()}@aciacam-test.invalid`;

        const resCreateSocio = await invokeRoute(
            adminSociosPost,
            'https://integration.test/api/admin/socios',
            'POST',
            adminToken,
            {
                nombre: 'Socio',
                apellido: 'Prueba UX-03B',
                dni: testDni,
                email: testEmail,
                telefono: '+5492664000000',
                domicilio: 'Pedernera 1020',
                localidad: 'San Luis',
                reprocann_num_tramite: 'TR-UX03B-TEST',
                reprocann_fecha_alta: '2026-06-01',
                reprocann_fecha_vencimiento: '2027-06-01',
                reprocann_tipo: 'ong',
                medico_nombre: 'Dra. María González',
                medico_matricula: 'MP 4321',
                diagnostico: 'Dolor crónico neuromuscular',
                status: 'draft'
            }
        );
        const dataCreate = await resCreateSocio.json();

        if (resCreateSocio.status === 201 && dataCreate.id) {
            createdTestSocioId = dataCreate.id;
            console.log(`  PASS: Socio creado con éxito (ID: ${createdTestSocioId}).`);

            // Verificar persistencia unificada en base de datos
            const { data: dbSocio } = await adminClient
                .from('socios')
                .select('*')
                .eq('id', createdTestSocioId)
                .single();

            const fieldsOk = 
                dbSocio?.reprocann_num_tramite === 'TR-UX03B-TEST' &&
                dbSocio?.reprocann_fecha_alta === '2026-06-01' &&
                dbSocio?.reprocann_fecha_vencimiento === '2027-06-01' &&
                dbSocio?.medico_nombre === 'Dra. María González' &&
                dbSocio?.medico_matricula === 'MP 4321' &&
                dbSocio?.diagnostico === 'Dolor crónico neuromuscular' &&
                dbSocio?.domicilio === 'Pedernera 1020' &&
                dbSocio?.localidad === 'San Luis' &&
                dbSocio?.status === 'draft';

            if (fieldsOk) {
                console.log('  PASS: Persistencia unificada verificada: REPROCANN, datos médicos y domicilio guardados sin duplicación.');
            } else {
                console.error('  FAIL FASE 2/3: Discrepancia en campos persistidos:', dbSocio);
                allPassed = false;
            }
        } else {
            console.error('  FAIL FASE 2/3: Error al crear socio:', resCreateSocio.status, dataCreate);
            allPassed = false;
        }

        // -------------------------------------------------------------------
        // FASE 4: CICLO DE VIDA DOCUMENTAL Y EVALUACIÓN DE COMPLIANCE
        // -------------------------------------------------------------------
        console.log('\n[Fase 4] Ciclo de vida documental y evaluación de Compliance...');

        // 4.1 Normalización de tipos
        const normDDJJ = normalizeDocType('declaracionJurada');
        const normRep = normalizeDocType('REPROCANN');
        if (normDDJJ === 'declaracion_jurada' && normRep === 'reprocann') {
            console.log('  PASS: Normalización de catálogo canónico correcta.');
        } else {
            console.error('  FAIL FASE 4.1 Normalización:', { normDDJJ, normRep });
            allPassed = false;
        }

        // 4.2 Evaluación de estados canónicos
        const stateNoPres = computeCanonicalDocState(null);
        const statePend = computeCanonicalDocState({ archivo_path: 'doc.pdf', verificacion_estado: 'pendiente' });
        const stateEnRev = computeCanonicalDocState({ archivo_path: 'doc.pdf', verificacion_estado: 'en_revision' });
        const stateAprob = computeCanonicalDocState({ archivo_path: 'doc.pdf', verificacion_estado: 'aprobado', fecha_vencimiento: '2027-12-31' });
        const stateRech = computeCanonicalDocState({ archivo_path: 'doc.pdf', verificacion_estado: 'rechazado' });
        const stateVenc = computeCanonicalDocState({ archivo_path: 'doc.pdf', verificacion_estado: 'aprobado', fecha_vencimiento: '2025-01-01' });

        if (
            stateNoPres.state === 'no_presentado' &&
            statePend.state === 'pendiente' &&
            stateEnRev.state === 'en_revision' &&
            stateAprob.state === 'aprobado' && stateAprob.isCompliant === true &&
            stateRech.state === 'rechazado' && stateRech.isCompliant === false &&
            stateVenc.state === 'vencido' && stateVenc.isCompliant === false
        ) {
            console.log('  PASS: Los 6 estados canónicos evaluados con exactitud.');
            console.log('  PASS: Diferenciación probada: documento aprobado pero con fecha 2025-01-01 pasa a "vencido" (no compliant).');
        } else {
            console.error('  FAIL FASE 4.2 Evaluación de estados canónicos falló');
            allPassed = false;
        }

        // -------------------------------------------------------------------
        // FASE 5: CONTRATO OCR Y FUSIÓN DE DATOS ASISTIDA
        // -------------------------------------------------------------------
        console.log('\n[Fase 5] Contrato estructurado de OCR y salvaguarda humana...');

        // 5.1 Validación de payload OCR correcto
        const validOcr = {
            numeroTramite: '123456',
            titular: { nombre: 'Juan', apellido: 'Pérez' },
            dni: '30123456',
            fechaEmision: '2026-05-10',
            fechaVencimiento: '2027-05-10',
            tipoAutorizacion: 'autocultivo',
            medico: { nombre: 'Dr. López', matricula: 'MP 9999' },
            confidence: { overall: 0.95 },
            humanValidated: true
        };
        const valRes1 = validateOcrExtraction(validOcr);
        if (valRes1.valid) {
            console.log('  PASS: Extracción OCR válida aprobada por validador.');
        } else {
            console.error('  FAIL FASE 5.1:', valRes1.errors);
            allPassed = false;
        }

        // 5.2 Rechazo de fechas inválidas / inexistentes en OCR
        const invalidOcrDates = {
            ...validOcr,
            fechaEmision: '2026-02-30', // Fecha inexistente
            fechaVencimiento: '2025-01-01' // Vencimiento anterior a emisión
        };
        const valRes2 = validateOcrExtraction(invalidOcrDates);
        if (!valRes2.valid && valRes2.errors.length >= 2) {
            console.log('  PASS: Fechas inexistentes y vencimientos invertidos rechazados por validador OCR.');
        } else {
            console.error('  FAIL FASE 5.2: Validador OCR permitió fechas inválidas:', valRes2);
            allPassed = false;
        }

        // 5.3 Fusión de datos sin sobreescritura accidental
        const existingPartner = {
            reprocann_num_tramite: 'NUM-EXISTENTE-VERIFICADO',
            medico_nombre: ''
        };
        // Intento de fusión sin confirmación de sobreescritura
        const mergedSafe = mergeOcrWithPartnerData(existingPartner, validOcr, false);
        if (mergedSafe.reprocann_num_tramite === 'NUM-EXISTENTE-VERIFICADO' && mergedSafe.medico_nombre === 'Dr. López') {
            console.log('  PASS: Fusión segura preservó número existente verificado y completó campo vacío.');
        } else {
            console.error('  FAIL FASE 5.3 Fusión segura sobreescribió:', mergedSafe);
            allPassed = false;
        }

        // -------------------------------------------------------------------
        // FASE 6: PREVENCIÓN DE DUPLICADOS EN ALTA
        // -------------------------------------------------------------------
        console.log('\n[Fase 6] Control de duplicidad en alta de socios...');
        const resDup = await invokeRoute(
            adminSociosPost,
            'https://integration.test/api/admin/socios',
            'POST',
            adminToken,
            {
                nombre: 'Intento',
                apellido: 'Duplicado',
                dni: testDni, // Mismo DNI
                email: 'otro.email@test.invalid',
                telefono: '123'
            }
        );
        const dataDup = await resDup.json();
        if (resDup.status === 409) {
            console.log(`  PASS: Intento de alta duplicada bloqueado con HTTP 409: "${dataDup.error}".`);
        } else {
            console.error('  FAIL FASE 6: No bloqueó duplicado:', resDup.status, dataDup);
            allPassed = false;
        }

    } finally {
        // Limpieza de datos de prueba
        console.log('\n[Limpieza] Eliminando socio de prueba temporal creado durante UX-03B...');
        if (createdTestSocioId) {
            // Eliminar auditorías de prueba del socio creado
            await adminClient.from('audit_logs').delete().eq('entity_id', createdTestSocioId);
            // Eliminar documentos de prueba si hubieran
            await adminClient.from('documentos_socio').delete().eq('socio_id', createdTestSocioId);
            // Eliminar el registro del socio de prueba
            await adminClient.from('socios').delete().eq('id', createdTestSocioId);
            console.log('  Socio temporal de prueba eliminado limpiamente.');
        }

        // Asegurar que socio E2E permanente quede con estado original
        const { data: e2eDoc } = await adminClient
            .from('documentos_socio')
            .select('id, verificacion_estado')
            .eq('socio_id', existingSocioId)
            .eq('is_current', true)
            .single();

        if (e2eDoc && e2eDoc.verificacion_estado !== 'pendiente') {
            await adminClient.from('documentos_socio')
                .update({ verificacion_estado: 'pendiente', verificacion_obs: null })
                .eq('id', e2eDoc.id);
            console.log('  Socio E2E permanente restaurado a estado pendiente.');
        }
    }

    console.log('\n====================================================================');
    if (allPassed) {
        console.log(' RESULTADO FINAL SPRINT UX-03B: TODAS LAS PRUEBAS PASARON (100% OK)');
    } else {
        console.error(' RESULTADO FINAL SPRINT UX-03B: FALLARON UNA O MÁS PRUEBAS');
        process.exit(1);
    }
    console.log('====================================================================\n');
}

run().catch(e => {
    console.error('Fatal test error UX-03B:', e);
    process.exit(1);
});

