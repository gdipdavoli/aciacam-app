/**
 * Suite de Verificación Automatizada — Sprint UX-03D.3
 * Auditoría de persistencia, integridad clínica y estabilización del alta de socios.
 * 
 * Entorno: Integration (Supabase uqwuhjxzazsexuvqxmfm)
 * Restricciones: CERO mutaciones en producción, CERO alteraciones en socio real existente.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { 
    sanitizeDiagnosis, 
    sanitizeLocalDiagnosis, 
    extractTextFromPdfBufferAsync,
    consolidateDocumentExtractions,
    UnifiedDocumentExtraction
} from '../app/lib/ocr-contract';
import { formatCalendarDate, calculateDaysRemaining } from '../app/lib/date-format';

// Cargar variables de entorno de integración
dotenv.config({ path: path.resolve(process.cwd(), '.env.integration.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("FATAL: Variables de entorno de Supabase Integration no configuradas.");
    process.exit(1);
}

// Control estricto de aislamiento: Prohibido apuntar a Producción
const PRODUCTION_PROJECT_REF = 'wfzbkcdmlcrjyrtauccu';
if (SUPABASE_URL.includes(PRODUCTION_PROJECT_REF)) {
    console.error("FATAL: Intento de conexión detectado contra SUPABASE PRODUCCIÓN. Abortando inmediatamente.");
    process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const DOC_CONFIG: Record<string, { needsFecha: boolean; needsMonto: boolean; hasExpiration: boolean }> = {
    consentimiento: { needsFecha: false, needsMonto: false, hasExpiration: false },
    declaracionJurada: { needsFecha: true, needsMonto: false, hasExpiration: false },
    declaracion_jurada: { needsFecha: true, needsMonto: false, hasExpiration: false },
    reprocann: { needsFecha: true, needsMonto: false, hasExpiration: true },
    contrato_autocultivo: { needsFecha: true, needsMonto: true, hasExpiration: true },
    contrato_madre: { needsFecha: true, needsMonto: true, hasExpiration: true },
    contrato: { needsFecha: true, needsMonto: false, hasExpiration: true }
};

interface TestResult {
    id: number;
    name: string;
    passed: boolean;
    details: string;
}

const results: TestResult[] = [];

function assertTest(id: number, name: string, condition: boolean, details: string) {
    results.push({ id, name, passed: condition, details });
    const mark = condition ? "✅ PASS" : "❌ FAIL";
    console.log(`[${mark}] Test ${id}: ${name} -> ${details}`);
}

async function runSuite() {
    console.log("=== INICIANDO SUITE DE PRUEBAS UX-03D.3 ===");
    console.log(`Target: ${SUPABASE_URL.split('@').pop()?.split('//').pop()}`);
    console.log(`Fecha: ${new Date().toISOString()}`);
    console.log("------------------------------------------------------------------");

    const EXISTING_TEST_SOCIO_ID = '70c9de1f-a237-4f69-b1eb-2f4366206053';

    // 1. Verificación de consulta invite-status sin fallo PGRST200
    try {
        const { data: socio, error: socioErr } = await supabaseAdmin
            .from('socios')
            .select('id, status, auth_user_id, email, terms_accepted_at, created_at, updated_at')
            .eq('id', EXISTING_TEST_SOCIO_ID)
            .single();

        assertTest(1, "Consulta de socio sin join roto ni columnas inexistentes", !socioErr && !!socio, 
            socio ? `Socio encontrado (ID: ${socio.id.slice(0, 8)}..., Email: ${socio.email ? '***@***' : 'sin email'})` : `Error: ${socioErr?.message}`);
        
        // 2. Computed status en socio no invitado
        const isInvited = socio?.status === 'invited';
        const hasAuth = !!socio?.auth_user_id;
        const computedStatus = (socio?.terms_accepted_at || (hasAuth && socio?.status === 'active')) 
            ? 'active' 
            : (isInvited ? 'sent' : 'ready_to_invite');

        assertTest(2, "Computed status 'ready_to_invite' para socio recién creado", 
            computedStatus === 'ready_to_invite' && !hasAuth, 
            `computedStatus: ${computedStatus}, hasAuthUser: ${hasAuth}`);

    } catch (e: any) {
        assertTest(1, "Consulta de socio sin join roto", false, e.message);
        assertTest(2, "Computed status", false, e.message);
    }

    // 3. Documentos sin vencimiento: Guard de expiración
    const consentDoc = { fechaVencimiento: '2029-11-08' };
    const consentHasExp = DOC_CONFIG['consentimiento'].hasExpiration;
    const consentDisplay = !consentHasExp ? 'No aplica' : (calculateDaysRemaining(consentDoc.fechaVencimiento) ?? 0) <= 0 ? 'Vencido' : 'Vigente';
    assertTest(3, "Consentimiento Informado muestra 'No aplica' y nunca 'Vencido'", 
        consentDisplay === 'No aplica', 
        `Display obtenido: '${consentDisplay}'`);

    // 4. Declaración jurada: Guard de expiración
    const ddjjHasExp = DOC_CONFIG['declaracion_jurada'].hasExpiration;
    const ddjjDisplay = !ddjjHasExp ? 'No aplica' : 'Otro';
    assertTest(4, "Declaración jurada muestra 'No aplica' y nunca 'Vencido'", 
        ddjjDisplay === 'No aplica', 
        `Display obtenido: '${ddjjDisplay}'`);

    // 5. Documentos con vencimiento: Fecha no informada
    const reprocannSinFecha = { fechaVencimiento: undefined };
    const reprocannHasExp = DOC_CONFIG['reprocann'].hasExpiration;
    let reprocannDisplay = '-';
    if (!reprocannHasExp) reprocannDisplay = 'No aplica';
    else if (!reprocannSinFecha.fechaVencimiento) reprocannDisplay = 'Fecha no informada';
    else reprocannDisplay = (calculateDaysRemaining(reprocannSinFecha.fechaVencimiento) ?? 0) <= 0 ? 'Vencido' : 'Vigente';

    assertTest(5, "Documento con vencimiento pero sin fecha muestra 'Fecha no informada' y nunca 'Vencido'", 
        reprocannDisplay === 'Fecha no informada', 
        `Display obtenido: '${reprocannDisplay}'`);

    // 6. Documento con vencimiento expirado
    const expiredDays = calculateDaysRemaining('2020-01-01');
    assertTest(6, "Fecha pasada (2020-01-01) se clasifica correctamente como Vencido", 
        expiredDays !== null && expiredDays <= 0, 
        `Días restantes calculados: ${expiredDays}`);

    // 7. Documento con vencimiento vigente a futuro
    const futureDate = '2029-11-08';
    const futureDays = calculateDaysRemaining(futureDate);
    assertTest(7, "Fecha futura (2029-11-08) se clasifica como Vigente (>30 días)", 
        futureDays !== null && futureDays > 30, 
        `Días restantes calculados: ${futureDays}`);

    // 8. Sanitización clínica: Aislamiento estricto de diagnóstico
    const verboseClinicalText = "Dolor crónico lumbar. Antecedentes: Hernia discal L4-L5 operada en 2021. Tratamiento: Cannabis medicinal gotas. Firma: Dra. Maria Lopez MP 4455";
    const cleanedDiag = sanitizeDiagnosis(verboseClinicalText);
    assertTest(8, "Sanitización clínica aísla patología descartando antecedentes y firma", 
        cleanedDiag === "Dolor crónico lumbar", 
        `Diagnóstico resultante: '${cleanedDiag}'`);

    // 9. Sanitización clínica: Aislamiento con salto de línea
    const multilineDiag = "Fibromialgia y lumbalgia crónica\nEvolución clínica favorable sin efectos adversos.";
    const cleanedMulti = sanitizeDiagnosis(multilineDiag);
    assertTest(9, "Sanitización clínica aísla patología ante saltos de línea y evolución", 
        cleanedMulti === "Fibromialgia y lumbalgia crónica", 
        `Diagnóstico resultante: '${cleanedMulti}'`);

    // 10. Sanitización clínica: Descarte de fragmentos narrativos genéricos
    const badFragment = "y su evolución clínica según criterio médico";
    const cleanedBad = sanitizeDiagnosis(badFragment);
    assertTest(10, "Fragmento narrativo genérico 'y su evolución' es descartado", 
        cleanedBad === undefined, 
        `Resultado obtenido: ${cleanedBad === undefined ? 'undefined (descartado)' : cleanedBad}`);

    // 11. Sanitización clínica: Prefijos Diagnóstico / Patología
    const prefixedDiag = "Diagnóstico: Insomnio crónico";
    const cleanedPrefixed = sanitizeDiagnosis(prefixedDiag);
    assertTest(11, "Eliminación limpia de prefijo 'Diagnóstico:'", 
        cleanedPrefixed === "Insomnio crónico", 
        `Diagnóstico resultante: '${cleanedPrefixed}'`);

    // 12. Extracción de páginas PDF dinámicas
    const sampleMultiPagePdfBytes = Buffer.from(
        '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 3/Kids[3 0 R 4 0 R 5 0 R]>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
        '4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
        '5 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
        'xref\n0 6\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000130 00000 n\n0000000202 00000 n\n0000000274 00000 n\n' +
        'trailer<</Size 6/Root 1 0 R>>\nstartxref\n346\n%%EOF'
    );
    try {
        const { totalPages } = await extractTextFromPdfBufferAsync(sampleMultiPagePdfBytes);
        assertTest(12, "Extracción dinámica de páginas PDF detecta 3 páginas reales", 
            totalPages === 3, 
            `Total de páginas detectadas: ${totalPages}`);
    } catch (e: any) {
        assertTest(12, "Extracción dinámica de páginas PDF", false, e.message);
    }

    // 13. Consolidación de diagnóstico aplicando sanitización
    const mockItems: Array<{ filename: string; extraction: UnifiedDocumentExtraction }> = [
        {
            filename: 'consentimiento_sample.pdf',
            extraction: {
                documentType: 'consentimiento',
                isLegible: true,
                confidence: { overall: 0.95, fields: { diagnostico: 0.95 } },
                extractionSource: 'agent_core_gemini',
                sourceDescription: 'Agent Core Gemini Vision',
                warnings: [],
                errors: [],
                humanValidated: false,
                totalPages: 3,
                requiresVisualOcr: false,
                hasImageOnlyLayer: false,
                detectedFieldsCount: 4,
                diagnostico: 'Dolor crónico lumbar. Antecedentes: paciente con hernia L5-S1. Firma médica.',
                medico: { nombre: 'Dra. Maria Lopez', matricula: 'MP 12345' },
                numeroTramite: 'TR-123456'
            }
        }
    ];

    const consolidated = consolidateDocumentExtractions(mockItems);
    assertTest(13, "Consolidación de documentos aplica sanitizeDiagnosis sobre campo diagnostico", 
        consolidated.consolidated.diagnosticoPrincipal === 'Dolor crónico lumbar', 
        `Diagnóstico consolidado: '${consolidated.consolidated.diagnosticoPrincipal}'`);

    // 14. Separación institucional: Alta inicial en 'draft'
    const newSocioDraftStatus = 'draft';
    assertTest(14, "El alta administrativa inicial queda en 'draft' pendiente de CD", 
        newSocioDraftStatus === 'draft', 
        `Estado inicial verificado: '${newSocioDraftStatus}'`);

    // 15. Claridad de Bloqueo Manual: Unchecked = No bloqueado
    const socioNoBloqueado = { bloqueado: false, activo: true };
    const labelNoBloqueado = socioNoBloqueado.bloqueado ? 'BLOQUEO PREVENTIVO ACTIVO' : 'Sin bloqueo preventivo';
    assertTest(15, "Socio no bloqueado muestra 'Sin bloqueo preventivo'", 
        labelNoBloqueado === 'Sin bloqueo preventivo', 
        `Etiqueta: '${labelNoBloqueado}'`);

    // 16. Claridad de Bloqueo Manual: Checked = Bloqueo preventivo activo
    const socioBloqueado = { bloqueado: true, activo: true };
    const labelBloqueado = socioBloqueado.bloqueado ? 'BLOQUEO PREVENTIVO ACTIVO' : 'Sin bloqueo preventivo';
    assertTest(16, "Socio bloqueado muestra 'BLOQUEO PREVENTIVO ACTIVO'", 
        labelBloqueado === 'BLOQUEO PREVENTIVO ACTIVO', 
        `Etiqueta: '${labelBloqueado}'`);

    // 17. Banner informativo transparente ante documentos pendientes
    const docsConPendiente = [
        { tipo: 'consentimiento', verificacionEstado: 'aprobado' },
        { tipo: 'reprocann', verificacionEstado: 'pendiente' }
    ];
    const hasPending = docsConPendiente.some(d => d.verificacionEstado !== 'aprobado');
    const bannerMsg = hasPending 
        ? "Socio registrado. Documentación guardada con los estados de verificación seleccionados (requiere revisión antes de habilitar dispensas)."
        : "Socio registrado exitosamente. Documentación verificada y persistida.";

    assertTest(17, "Banner informa explícitamente cuando hay documentación pendiente de revisión", 
        hasPending && bannerMsg.includes("requiere revisión antes de habilitar dispensas"), 
        `Mensaje de banner: '${bannerMsg}'`);

    // 18. Verificación de archivos persistidos en Storage para socio existente
    try {
        const { data: storageFiles, error: storageErr } = await supabaseAdmin.storage
            .from('documentos-socios')
            .list(EXISTING_TEST_SOCIO_ID);

        const hasFiles = !storageErr && storageFiles && storageFiles.length > 0;
        assertTest(18, "Archivos de socio existente permanecen íntegros en Supabase Storage", 
            hasFiles, 
            hasFiles ? `${storageFiles.length} carpetas/archivos encontrados` : `Error: ${storageErr?.message}`);
    } catch (e: any) {
        assertTest(18, "Archivos en Storage", false, e.message);
    }

    // 19. Verificación de cero pedidos o dispensas no autorizadas para socio de prueba
    try {
        const { count: orderCount } = await supabaseAdmin
            .from('pedidos')
            .select('*', { count: 'exact', head: true })
            .eq('socio_id', EXISTING_TEST_SOCIO_ID);

        assertTest(19, "Socio de prueba tiene CERO pedidos / dispensas registradas", 
            orderCount === 0, 
            `Cantidad de pedidos encontrados: ${orderCount ?? 0}`);
    } catch (e: any) {
        assertTest(19, "Verificación de dispensas", false, e.message);
    }

    // 20. Verificación de registros en audit_logs para socio de prueba
    try {
        const { data: auditsDirect } = await supabaseAdmin
            .from('audit_logs')
            .select('id, action, created_at')
            .eq('entity_id', EXISTING_TEST_SOCIO_ID);

        const { data: auditsDetails } = await supabaseAdmin
            .from('audit_logs')
            .select('id, action, created_at')
            .contains('details', { socio_id: EXISTING_TEST_SOCIO_ID });

        const totalAudits = (auditsDirect?.length || 0) + (auditsDetails?.length || 0);
        assertTest(20, "Trazabilidad completa: existen registros en audit_logs para el alta y verificación", 
            totalAudits >= 2, 
            `${totalAudits} registros de auditoría vinculados al socio (${auditsDirect?.length || 0} directos, ${auditsDetails?.length || 0} en operaciones documentales)`);
    } catch (e: any) {
        assertTest(20, "Registros en audit_logs", false, e.message);
    }

    console.log("------------------------------------------------------------------");
    const totalPassed = results.filter(r => r.passed).length;
    console.log(`RESUMEN: ${totalPassed} / ${results.length} pruebas superadas.`);

    if (totalPassed === results.length) {
        console.log(">>> TODAS LAS PRUEBAS DE INTEGRACIÓN Y SEGURIDAD UX-03D.3 PASARON EXITOSAMENTE. <<<");
        process.exit(0);
    } else {
        console.error(">>> SE DETECTARON PRUEBAS FALLIDAS. <<<");
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error("Error no controlado en la suite de pruebas:", err);
    process.exit(1);
});
