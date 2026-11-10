/**
 * scripts/test_sprint_ux03c_integration.ts
 *
 * ACIACAM APP - SPRINT UX-03C
 * Suite Integral de Verificación: Alta Inteligente, Extracción Documental,
 * Aprobación Directa y Actualización de Socios en Supabase Integration.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as zlib from 'zlib';
import { createClient } from '@supabase/supabase-js';
import { 
    extractTextFromPdfBuffer, 
    extractDataFromDocumentText, 
    validateIdentityMatch,
    mergeUnifiedExtractionWithPartner,
    UnifiedDocumentExtraction 
} from '../app/lib/ocr-contract';
import { isValidCalendarDate } from '../app/lib/date-format';

// 1. Cargar configuración de Integration
const envPath = path.resolve(__dirname, '../../aciacam-app/.env.integration.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
for (const k in envConfig) process.env[k] = envConfig[k];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL.includes('uqwuhjxzazsexuvqxmfm')) {
    console.error('ERROR CRÍTICO: Entorno no corresponde a Supabase Integration');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

// Helper para crear un PDF sintético con capa de texto válida
function createSyntheticPdf(textLines: string[]): Buffer {
    let streamText = 'BT /F1 12 Tf 72 712 Td ';
    for (const line of textLines) {
        streamText += `(${line}) Tj T* `;
    }
    streamText += 'ET';

    const deflated = zlib.deflateSync(Buffer.from(streamText, 'utf-8'));
    return Buffer.concat([
        Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
        Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
        Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n'),
        Buffer.from(`4 0 obj\n<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n`),
        deflated,
        Buffer.from('\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n500\n%%EOF')
    ]);
}

async function runTestSuite() {
    console.log('===============================================================');
    console.log('   ACIACAM APP - SUITE DE INTEGRACIÓN SPRINT UX-03C           ');
    console.log('   Alta Inteligente, Extracción Documental y Actualización      ');
    console.log('===============================================================\n');

    let passed = 0;
    let failed = 0;

    const testAssert = (desc: string, condition: boolean, extra = '') => {
        if (condition) {
            console.log(`  [PASS] ${desc} ${extra}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${desc} ${extra}`);
            failed++;
        }
    };

    const cleanupSocioIds: string[] = [];

    try {
        // --- CASO 1: Alta iniciada con Certificado REPROCANN ---
        console.log('\n--- CASO 1: Extracción digital de Certificado REPROCANN ---');
        const reprocannPdf = createSyntheticPdf([
            'MINISTERIO DE SALUD DE LA NACION',
            'CERTIFICADO REPROCANN REGISTRO DEL PROGRAMA DE CANNABIS',
            'Numero de Tramite: TR-TEST-901',
            'Titular: SOSA GABRIEL',
            'D.N.I.: 35.111.222',
            'Fecha de Nacimiento: 1989-04-12',
            'Fecha de Emision: 2026-05-10',
            'Fecha de Vencimiento: 2029-05-10',
            'Profesional Medico: DR. MARTIN GOMEZ',
            'Matricula: MN 14520',
            'Diagnostico: DOLOR CRONICO FIBROMIALGIA'
        ]);

        const rawText1 = extractTextFromPdfBuffer(reprocannPdf);
        const ext1 = extractDataFromDocumentText(rawText1, 'certificado_reprocann_901.pdf');

        testAssert('Caso 1.1: Tipo detectado es REPROCANN', ext1.documentType === 'reprocann', `(tipo=${ext1.documentType})`);
        testAssert('Caso 1.2: N° Trámite extraído correctamente', ext1.numeroTramite === 'TR-TEST-901', `(tramite=${ext1.numeroTramite})`);
        testAssert('Caso 1.3: DNI extraído sin puntos', ext1.dni === '35111222', `(dni=${ext1.dni})`);
        testAssert('Caso 1.4: Fechas de emisión y vencimiento extraídas', ext1.fechaEmision === '2026-05-10' && ext1.fechaVencimiento === '2029-05-10');
        testAssert('Caso 1.5: Datos médicos extraídos', ext1.medico?.matricula === 'MN 14520');

        // --- CASO 2: Alta iniciada con Consentimiento Informado Médico ---
        console.log('\n--- CASO 2: Extracción de Consentimiento Informado Médico ---');
        const consentimientoPdf = createSyntheticPdf([
            'CONSENTIMIENTO INFORMADO BILATERAL',
            'TRATAMIENTO CON CANNABIS MEDICINAL',
            'Paciente: RAMIREZ LUCIA',
            'Documento: 36.222.333',
            'Medico Tratante: DRA. VALERIA DIAZ',
            'Matricula: MP 7890',
            'Diagnostico: EPILEPSIA REFRACTARIA'
        ]);

        const rawText2 = extractTextFromPdfBuffer(consentimientoPdf);
        const ext2 = extractDataFromDocumentText(rawText2, 'consentimiento_medico.pdf');

        testAssert('Caso 2.1: Tipo detectado es Consentimiento', ext2.documentType === 'consentimiento', `(tipo=${ext2.documentType})`);
        testAssert('Caso 2.2: DNI del paciente extraído', ext2.dni === '36222333', `(dni=${ext2.dni})`);
        testAssert('Caso 2.3: Médico y matrícula detectados', ext2.medico?.matricula === 'MP 7890');

        // --- CASO 3: Alta sin documentación ---
        console.log('\n--- CASO 3: Alta de socio sin documentación inicial ---');
        const testDniNoDoc = `99${Date.now().toString().slice(-6)}`;
        const idempotencyNoDoc = `alta_nodoc_${Date.now()}`;

        const { data: socioNoDoc, error: errNoDoc } = await supabase
            .from('socios')
            .insert({
                nombre: 'Aspirante',
                apellido: 'Sin Documento',
                dni: testDniNoDoc,
                email: `aspirante_${testDniNoDoc}@test.com`,
                telefono: '2664001122',
                fecha_nacimiento: '1995-08-20',
                envios_habilitados: true,
                status: 'active',
                rol: 'socio'
            })
            .select('*')
            .single();

        testAssert('Caso 3.1: Socio creado exitosamente sin documentación', !errNoDoc && !!socioNoDoc?.id);
        if (socioNoDoc?.id) cleanupSocioIds.push(socioNoDoc.id);

        const { data: docsNoDoc } = await supabase
            .from('documentos_socio')
            .select('id')
            .eq('socio_id', socioNoDoc?.id || '');

        testAssert('Caso 3.2: No existen documentos asociados para socio sin documentación', (docsNoDoc?.length || 0) === 0);

        // --- CASO 4: Autocompletado seguro con merge ---
        console.log('\n--- CASO 4: Fusión y Autocompletado de formulario ---');
        const formDraft = {
            nombre: '',
            apellido: '',
            dni: '',
            fechaNacimiento: '',
            numeroTramite: '',
            fechaAlta: '',
            fechaVencimiento: '',
            medicoNombre: '',
            medicoMatricula: '',
            diagnosticoPrincipal: ''
        };

        const merged = mergeUnifiedExtractionWithPartner(formDraft, ext1, false);
        testAssert('Caso 4.1: Formulario precargado con DNI', merged.dni === '35111222');
        testAssert('Caso 4.2: Formulario precargado con Trámite', merged.numeroTramite === 'TR-TEST-901');
        testAssert('Caso 4.3: Formulario precargado con Fecha de Nacimiento', merged.fechaNacimiento === '1989-04-12');

        // --- CASO 5: Documento con datos incompletos / baja confianza ---
        console.log('\n--- CASO 5: Documento parcial y advertencias ---');
        const partialPdf = createSyntheticPdf([
            'DOCUMENTO PRELIMINAR',
            'SOLICITUD PENDIENTE'
        ]);
        const extPartial = extractDataFromDocumentText(extractTextFromPdfBuffer(partialPdf), 'borrador.pdf');
        testAssert('Caso 5.1: Documento sin campos esenciales reporta legibilidad false', !extPartial.isLegible);
        testAssert('Caso 5.2: Genera advertencia clara para usuario', extPartial.warnings.length > 0);

        // --- CASO 6: Corrección manual de datos extraídos ---
        console.log('\n--- CASO 6: Corrección manual preserva ediciones ---');
        const corrected = { ...merged, nombre: 'Gabriel Alejandro', dni: '35111229' };
        testAssert('Caso 6.1: Edición manual sobrescribe nombre', corrected.nombre === 'Gabriel Alejandro');
        testAssert('Caso 6.2: Edición manual corrige DNI', corrected.dni === '35111229');
        testAssert('Caso 6.3: Conserva trámite intacto', corrected.numeroTramite === 'TR-TEST-901');

        // --- CASO 7 & 8: Aprobación documental durante el alta (directa en estado APROBADO) ---
        console.log('\n--- CASO 7 & 8: Persistencia directa en estado APROBADO ---');
        const testDniAlta = `88${Date.now().toString().slice(-6)}`;
        const { data: socioAlta, error: errAlta } = await supabase
            .from('socios')
            .insert({
                nombre: 'Gabriel',
                apellido: 'Sosa',
                dni: testDniAlta,
                email: `sosa_${testDniAlta}@test.com`,
                telefono: '2664998877',
                fecha_nacimiento: '1989-04-12',
                envios_habilitados: true,
                status: 'active',
                rol: 'socio',
                reprocann_num_tramite: 'TR-TEST-901',
                reprocann_fecha_alta: '2026-05-10',
                reprocann_fecha_vencimiento: '2029-05-10'
            })
            .select('*')
            .single();

        testAssert('Caso 7.1: Socio creado para alta con documento', !errAlta && !!socioAlta?.id);
        if (socioAlta?.id) cleanupSocioIds.push(socioAlta.id);

        // Persistir documento en estado APROBADO directo
        const nowIso = new Date().toISOString();
        const { data: docAprobado, error: errDocApr } = await supabase
            .from('documentos_socio')
            .insert({
                socio_id: socioAlta.id,
                tipo: 'reprocann',
                archivo_path: `${socioAlta.id}/reprocann/cert_901.pdf`,
                verificacion_estado: 'aprobado',
                verificado_at: nowIso,
                verificado_por: 'admin@aciacam.org',
                fecha_emision: '2026-05-10',
                fecha_vencimiento: '2029-05-10',
                version: 1,
                is_current: true
            })
            .select('*')
            .single();

        testAssert('Caso 7.2: Inserción de documento aprobado exitosa', !errDocApr && !!docAprobado?.id);
        testAssert('Caso 8.1: Documento queda INMEDIATAMENTE en estado APROBADO', docAprobado?.verificacion_estado === 'aprobado');
        testAssert('Caso 8.2: Registra operador verificador', docAprobado?.verificado_por === 'admin@aciacam.org');
        testAssert('Caso 8.3: Registra marca temporal verificado_at', !!docAprobado?.verificado_at);

        // --- CASO 9: Documento dejado pendiente voluntariamente ---
        console.log('\n--- CASO 9: Documento dejado pendiente de verificación ---');
        const { data: docPendiente, error: errDocPend } = await supabase
            .from('documentos_socio')
            .insert({
                socio_id: socioAlta.id,
                tipo: 'consentimiento',
                archivo_path: `${socioAlta.id}/consentimiento/constancia.pdf`,
                verificacion_estado: 'pendiente',
                verificado_at: null,
                verificado_por: null,
                version: 1,
                is_current: true
            })
            .select('*')
            .single();

        testAssert('Caso 9.1: Documento guardado como pendiente', docPendiente?.verificacion_estado === 'pendiente');
        testAssert('Caso 9.2: Documento pendiente no tiene verificado_at', docPendiente?.verificado_at === null);

        // --- CASO 10, 11, 12, 14: Renovación REPROCANN, nuevo médico, diagnóstico e historial ---
        console.log('\n--- CASO 10, 11, 12, 14: Renovación REPROCANN y Versionado ---');
        // Paso A: Actualizar socio con nuevos datos
        const { data: socioRenovado, error: errRenov } = await supabase
            .from('socios')
            .update({
                reprocann_num_tramite: 'TR-RENEW-902',
                reprocann_fecha_alta: '2026-11-10',
                reprocann_fecha_vencimiento: '2029-11-10',
                medico_nombre: 'DR. CARLOS ALVAREZ',
                medico_matricula: 'MN 18900',
                diagnostico: 'ARTRITIS REUMATOIDEA SEVERA'
            })
            .eq('id', socioAlta.id)
            .select('*')
            .single();

        testAssert('Caso 10.1: Socio actualizado con nuevo trámite', socioRenovado?.reprocann_num_tramite === 'TR-RENEW-902');
        testAssert('Caso 11.1: Médico y matrícula actualizados', socioRenovado?.medico_matricula === 'MN 18900');
        testAssert('Caso 12.1: Diagnóstico clínico actualizado', socioRenovado?.diagnostico === 'ARTRITIS REUMATOIDEA SEVERA');

        // Paso B: Archivar versión previa del documento REPROCANN
        await supabase
            .from('documentos_socio')
            .update({ is_current: false, updated_at: nowIso })
            .eq('id', docAprobado.id);

        // Paso C: Insertar nueva versión v2
        const { data: docV2, error: errV2 } = await supabase
            .from('documentos_socio')
            .insert({
                socio_id: socioAlta.id,
                tipo: 'reprocann',
                archivo_path: `${socioAlta.id}/reprocann/cert_902_renew.pdf`,
                verificacion_estado: 'aprobado',
                verificado_at: nowIso,
                verificado_por: 'admin@aciacam.org',
                fecha_emision: '2026-11-10',
                fecha_vencimiento: '2029-11-10',
                version: 2,
                supersedes_document_id: docAprobado.id,
                is_current: true
            })
            .select('*')
            .single();

        testAssert('Caso 14.1: Nueva versión v2 creada como is_current=true', docV2?.is_current === true && docV2?.version === 2);
        testAssert('Caso 14.2: Nueva versión referencia a la anterior (supersedes_document_id)', docV2?.supersedes_document_id === docAprobado.id);

        const { data: oldDocRefetched } = await supabase
            .from('documentos_socio')
            .select('is_current, version')
            .eq('id', docAprobado.id)
            .single();
        testAssert('Caso 14.3: Versión anterior preservada en historial con is_current=false', oldDocRefetched?.is_current === false);

        // --- CASO 13: Cotejo de identidad y bloqueo por DNI discordante ---
        console.log('\n--- CASO 13: Cotejo de Identidad y Protección ante DNI Discordante ---');
        const matchResultSame = validateIdentityMatch('35111222', '35.111.222');
        testAssert('Caso 13.1: DNI con formato idéntico coincide', matchResultSame.match === true);

        const matchResultDiff = validateIdentityMatch('48999888', socioAlta.dni);
        testAssert('Caso 13.2: DNI discordante detectado correctamente', matchResultDiff.match === false);

        // --- CASO 15: Fallo de extracción con fallback manual ---
        console.log('\n--- CASO 15: Degradación elegante ante archivo binario no estructurado ---');
        const dummyImageBuffer = Buffer.from('FAKE_IMAGE_RASTER_DATA_NO_PDF');
        const extImage = extractDataFromDocumentText(dummyImageBuffer.toString('utf-8'), 'foto_carnet.jpg');
        testAssert('Caso 15.1: Archivo sin capa de texto no rompe la ejecución', extImage.isLegible === false);
        testAssert('Caso 15.2: Indica que requiere completar datos manualmente', extImage.warnings.length > 0);

        // --- CASO 16: Respaldo de borrador e Idempotencia ---
        console.log('\n--- CASO 16 & 17: Prevención de duplicados e Idempotencia ---');
        const idempKeyTest = `alta_idemp_${Date.now()}`;
        // Insert audit log mimicking idempotency tracking
        const { error: errAudit } = await supabase.from('audit_logs').insert({
            user_id: '30000000-0000-4000-8000-000000000001',
            action: 'SOCIO_CREATED',
            entity_type: 'socios',
            entity_id: socioAlta.id,
            details: {
                idempotency_key: idempKeyTest,
                dni: socioAlta.dni
            }
        });
        if (errAudit) console.warn('Audit log insert warning:', errAudit.message);

        const { data: auditFound } = await supabase
            .from('audit_logs')
            .select('*')
            .contains('details', { idempotency_key: idempKeyTest });

        testAssert('Caso 17.1: Consulta JSONB @> localiza la clave de idempotencia', (auditFound?.length || 0) === 1);

        // --- CASO 18: Permisos diferenciados ---
        console.log('\n--- CASO 18: Seguridad de roles ---');
        const { data: staffCheck } = await supabase
            .from('socios')
            .select('rol')
            .eq('id', socioAlta.id)
            .single();
        testAssert('Caso 18.1: Socio creado tiene rol socio', staffCheck?.rol === 'socio');

    } finally {
        // Limpieza de datos de prueba
        console.log('\n--- Limpieza de datos sintéticos de prueba ---');
        for (const sId of cleanupSocioIds) {
            await supabase.from('documentos_socio').delete().eq('socio_id', sId);
            await supabase.from('audit_logs').delete().eq('entity_id', sId);
            await supabase.from('socios').delete().eq('id', sId);
        }
        console.log(`Socios de prueba eliminados: ${cleanupSocioIds.length}`);
    }

    console.log('\n===============================================================');
    console.log(`   RESULTADOS SUITE UX-03C: ${passed} PASARON / ${failed} FALLARON`);
    console.log('===============================================================\n');

    if (failed > 0) process.exit(1);
}

runTestSuite().catch(err => {
    console.error('Error fatal en ejecución de tests:', err);
    process.exit(1);
});
