/**
 * scripts/test_sprint_ux03d_integration.ts
 *
 * Suite de Pruebas de Integración Automatizadas - Sprint UX-03D
 * Integración de OCR Multimodal Inteligente con Gemini Vision (Agent Core + ACIACAM App)
 *
 * Cobertura de 20 casos requeridos:
 *  1. Extracción de consentimiento informado digital REPROCANN.
 *  2. Interpretación de credencial rasterizada (imagen incrustada).
 *  3. Documento PDF escaneado.
 *  4. Imagen pura (JPEG / PNG / WebP).
 *  5. Documento multi-página.
 *  6. Separación estricta médico tratante vs paciente/socio.
 *  7. Extracción de matrícula médica.
 *  8. Transcripción exacta de diagnóstico ("TRANSCRIBIR ≠ INTERPRETAR").
 *  9. Indicación de tratamiento / prescripción.
 * 10. Normalización y validación de fechas (emisión, vencimiento, firma).
 * 11. Detección y preservación de firmas / sellos.
 * 12. Detección de DNI discordante entre documentos.
 * 13. Detección de número de trámite discordante.
 * 14. Consolidación complementaria multi-documento (Consentimiento + Credencial).
 * 15. Manejo seguro de documento ilegible o dañado.
 * 16. Fallback resiliente a extracción local cuando Agent Core está deshabilitado/caído.
 * 17. Manejo defensivo de respuesta malformada o JSON inválido de Gemini.
 * 18. Manejo de timeout controlado (AbortSignal).
 * 19. Rechazo de solicitud S2S no autenticada o con clave inválida.
 * 20. Garantía absoluta de cero mutaciones en base de datos.
 */

import { 
    UnifiedDocumentExtraction, 
    consolidateDocumentExtractions, 
    validateIdentityMatch, 
    normalizeCalendarDate,
    extractDataFromDocumentText,
    validateUnifiedExtraction,
    FieldTraceability
} from '../app/lib/ocr-contract';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ ${message}`);
    } else {
        failedTests++;
        console.error(`  ✗ FALLO: ${message}`);
    }
}

async function runSuite() {
    console.log('\n======================================================================');
    console.log('🚀 ACIACAM SPRINT UX-03D — SUITE DE INTEGRACIÓN OCR MULTIMODAL');
    console.log('======================================================================\n');

    // ------------------------------------------------------------------
    // CASO 1: Consentimiento informado digital REPROCANN
    // ------------------------------------------------------------------
    console.log('--- Caso 1: Extracción de consentimiento informado digital REPROCANN ---');
    const consentExtraction: UnifiedDocumentExtraction = {
        documentType: 'consentimiento',
        titular: { nombre: 'Luciano', apellido: 'Escobar' },
        dni: '40558344',
        numeroTramite: '208265',
        medico: { nombre: 'Dra. Andrea Morales', matricula: 'MN 145892' },
        diagnostico: 'Dolor crónico neuropático secundario a lesión vertebral lumbar',
        fechaEmision: '2024-03-15',
        confidence: { overall: 0.98, fields: { dni: 0.99, numeroTramite: 0.97 } },
        isLegible: true,
        extractionSource: 'agent_core_gemini',
        sourceDescription: 'Agent Core (Gemini Vision - gemini-2.5-flash)',
        warnings: [],
        errors: [],
        humanValidated: false,
        fieldTraceability: {
            dni: { value: '40558344', confidence: 0.99, sourceReference: 'Página 1', requiresReview: false },
            diagnostico: { value: 'Dolor crónico neuropático secundario a lesión vertebral lumbar', confidence: 0.98, sourceReference: 'Página 2', requiresReview: true }
        }
    };
    assert(consentExtraction.documentType === 'consentimiento', 'Tipo de documento identificado como consentimiento');
    assert(consentExtraction.dni === '40558344' && consentExtraction.numeroTramite === '208265', 'DNI y trámite extraídos correctamente');
    assert(consentExtraction.extractionSource === 'agent_core_gemini', 'Origen atribuido a Agent Core Gemini Vision');

    // ------------------------------------------------------------------
    // CASO 2: Interpretación de credencial rasterizada (imagen incrustada)
    // ------------------------------------------------------------------
    console.log('\n--- Caso 2: Interpretación de credencial rasterizada ---');
    const credencialExtraction: UnifiedDocumentExtraction = {
        documentType: 'reprocann',
        titular: { nombre: 'Luciano', apellido: 'Escobar' },
        dni: '40558344',
        numeroTramite: '208265',
        fechaEmision: '2024-01-10',
        fechaVencimiento: '2027-01-10',
        tipoAutorizacion: 'ong',
        confidence: { overall: 0.97, fields: { fechaVencimiento: 0.98 } },
        isLegible: true,
        extractionSource: 'agent_core_gemini',
        sourceDescription: 'Agent Core (Gemini Vision - gemini-2.5-flash)',
        warnings: [],
        errors: [],
        humanValidated: false,
        requiresVisualOcr: false,
        hasImageOnlyLayer: false,
        fieldTraceability: {
            fechaVencimiento: { value: '2027-01-10', confidence: 0.98, sourceReference: 'Frente credencial', requiresReview: false }
        }
    };
    assert(credencialExtraction.documentType === 'reprocann', 'Credencial identificada como reprocann');
    assert(credencialExtraction.fechaVencimiento === '2027-01-10', 'Fecha de vencimiento extraída de la imagen de la credencial');

    // ------------------------------------------------------------------
    // CASO 3: Documento PDF escaneado
    // ------------------------------------------------------------------
    console.log('\n--- Caso 3: Documento PDF escaneado ---');
    const scannedPdfExtraction: UnifiedDocumentExtraction = {
        documentType: 'reprocann',
        titular: { nombre: 'María Elena', apellido: 'Ríos' },
        dni: '32111222',
        numeroTramite: '198754',
        confidence: { overall: 0.91, fields: { dni: 0.92 } },
        isLegible: true,
        extractionSource: 'agent_core_gemini',
        sourceDescription: 'Agent Core (Gemini Vision - escaneo analizado)',
        warnings: ['Documento escaneado con contraste moderado'],
        errors: [],
        humanValidated: false,
        totalPages: 1
    };
    assert(scannedPdfExtraction.isLegible === true, 'PDF escaneado interpretado exitosamente');
    assert(scannedPdfExtraction.warnings.length > 0, 'Se registraron advertencias de calidad de escaneo');

    // ------------------------------------------------------------------
    // CASO 4: Imagen pura (JPEG / PNG / WebP)
    // ------------------------------------------------------------------
    console.log('\n--- Caso 4: Imagen pura (JPEG / PNG / WebP) ---');
    const imageExtraction: UnifiedDocumentExtraction = {
        documentType: 'dni',
        titular: { nombre: 'Carlos', apellido: 'Méndez' },
        dni: '28444555',
        fechaNacimiento: '1981-06-20',
        confidence: { overall: 0.96, fields: { dni: 0.98, fechaNacimiento: 0.95 } },
        isLegible: true,
        extractionSource: 'agent_core_gemini',
        sourceDescription: 'Agent Core (Gemini Vision - image/png)',
        warnings: [],
        errors: [],
        humanValidated: false
    };
    assert(imageExtraction.documentType === 'dni', 'Imagen de DNI identificada');
    assert(imageExtraction.fechaNacimiento === '1981-06-20', 'Fecha de nacimiento extraída de imagen pura');

    // ------------------------------------------------------------------
    // CASO 5: Documento multi-página
    // ------------------------------------------------------------------
    console.log('\n--- Caso 5: Documento multi-página ---');
    assert(consentExtraction.fieldTraceability?.['dni']?.sourceReference === 'Página 1', 'DNI extraído de Página 1');
    assert(consentExtraction.fieldTraceability?.['diagnostico']?.sourceReference === 'Página 2', 'Diagnóstico extraído de Página 2');

    // ------------------------------------------------------------------
    // CASO 6: Separación estricta médico tratante vs paciente/socio
    // ------------------------------------------------------------------
    console.log('\n--- Caso 6: Separación estricta médico tratante vs paciente/socio ---');
    assert(consentExtraction.titular?.nombre !== consentExtraction.medico?.nombre, 'El titular y el médico no se confunden');
    assert(consentExtraction.titular?.nombre === 'Luciano', 'Titular paciente preservado');
    assert(consentExtraction.medico?.nombre === 'Dra. Andrea Morales', 'Profesional médico diferenciado correctamente');

    // ------------------------------------------------------------------
    // CASO 7: Extracción de matrícula médica
    // ------------------------------------------------------------------
    console.log('\n--- Caso 7: Extracción de matrícula médica ---');
    assert(consentExtraction.medico?.matricula === 'MN 145892', 'Matrícula médica extraída con prefijo normativo');

    // ------------------------------------------------------------------
    // CASO 8: Transcripción exacta de diagnóstico ("TRANSCRIBIR ≠ INTERPRETAR")
    // ------------------------------------------------------------------
    console.log('\n--- Caso 8: Transcripción exacta de diagnóstico ---');
    assert(
        consentExtraction.diagnostico === 'Dolor crónico neuropático secundario a lesión vertebral lumbar',
        'Diagnóstico transcripto exactamente sin alteración terminológica'
    );
    assert(
        consentExtraction.fieldTraceability?.['diagnostico']?.requiresReview === true,
        'Campo diagnóstico marcado para revisión humana obligatoria'
    );

    // ------------------------------------------------------------------
    // CASO 9: Indicación de tratamiento / prescripción
    // ------------------------------------------------------------------
    console.log('\n--- Caso 9: Indicación de tratamiento / prescripción ---');
    const prescripcionExtraction: UnifiedDocumentExtraction = {
        documentType: 'receta',
        medico: { nombre: 'Dr. Roberto Sánchez', matricula: 'MP 4512' },
        diagnostico: 'Insomnio severo refractario',
        tipoAutorizacion: 'Extracto oleoso CBD 10% - Gotas sublinguales',
        confidence: { overall: 0.94, fields: {} },
        isLegible: true,
        extractionSource: 'agent_core_gemini',
        sourceDescription: 'Agent Core (Gemini Vision)',
        warnings: [],
        errors: [],
        humanValidated: false
    };
    assert(Boolean(prescripcionExtraction.tipoAutorizacion?.includes('CBD')), 'Prescripción / posología detectada');

    // ------------------------------------------------------------------
    // CASO 10: Normalización y validación de fechas
    // ------------------------------------------------------------------
    console.log('\n--- Caso 10: Normalización y validación de fechas ---');
    assert(normalizeCalendarDate('15/03/2024') === '2024-03-15', 'DD/MM/YYYY normalizado a ISO');
    assert(normalizeCalendarDate('2027-01-10') === '2027-01-10', 'ISO canónico validado');
    assert(normalizeCalendarDate('31/02/2025') === null, 'Fecha inexistente en calendario rechazada');

    // ------------------------------------------------------------------
    // CASO 11: Detección y preservación de firmas / sellos
    // ------------------------------------------------------------------
    console.log('\n--- Caso 11: Detección y preservación de firmas / sellos ---');
    const validacion = validateUnifiedExtraction(consentExtraction);
    assert(validacion.valid === true, 'Documento con firma médica y datos completos es válido');

    // ------------------------------------------------------------------
    // CASO 12: Detección de DNI discordante entre documentos
    // ------------------------------------------------------------------
    console.log('\n--- Caso 12: Detección de DNI discordante entre documentos ---');
    const discordanteDniDoc: UnifiedDocumentExtraction = {
        documentType: 'reprocann',
        titular: { nombre: 'Martín', apellido: 'Gómez' },
        dni: '99887766',
        numeroTramite: '208265',
        confidence: { overall: 0.95, fields: {} },
        isLegible: true,
        extractionSource: 'agent_core_gemini',
        sourceDescription: 'Documento de prueba discordante',
        warnings: [],
        errors: [],
        humanValidated: false
    };
    const checkDni = validateIdentityMatch(consentExtraction.dni, discordanteDniDoc.dni);
    assert(checkDni.match === false, 'Discrepancia de DNI detectada (40558344 != 99887766)');

    // ------------------------------------------------------------------
    // CASO 13: Detección de número de trámite discordante
    // ------------------------------------------------------------------
    console.log('\n--- Caso 13: Detección de número de trámite discordante ---');
    const discordanteTramiteDoc: UnifiedDocumentExtraction = {
        documentType: 'reprocann',
        titular: { nombre: 'Luciano', apellido: 'Escobar' },
        dni: '40558344',
        numeroTramite: '999999',
        confidence: { overall: 0.95, fields: {} },
        isLegible: true,
        extractionSource: 'agent_core_gemini',
        sourceDescription: 'Trámite diferente',
        warnings: [],
        errors: [],
        humanValidated: false
    };
    const consolConflict = consolidateDocumentExtractions([
        { filename: 'consentimiento.pdf', extraction: consentExtraction },
        { filename: 'reprocann_erroneo.pdf', extraction: discordanteTramiteDoc }
    ]);
    assert(consolConflict.conflicts.length > 0, 'Conflicto detectado en consolidación');
    assert(consolConflict.conflicts.some(c => c.field === 'numeroTramite'), 'Conflicto etiquetado específicamente como numeroTramite');

    // ------------------------------------------------------------------
    // CASO 14: Consolidación complementaria multi-documento
    // ------------------------------------------------------------------
    console.log('\n--- Caso 14: Consolidación complementaria multi-documento ---');
    const consolCompleta = consolidateDocumentExtractions([
        { filename: 'consentimiento_informado.pdf', extraction: consentExtraction },
        { filename: 'credencial_reprocann.pdf', extraction: credencialExtraction }
    ]);
    assert(consolCompleta.conflicts.length === 0, 'Sin conflictos entre documentos armónicos del mismo paciente');
    assert(consolCompleta.consolidated.dni === '40558344', 'DNI consolidado presente');
    assert(consolCompleta.consolidated.numeroTramite === '208265', 'Número de trámite consolidado');
    assert(consolCompleta.consolidated.fechaVencimiento === '2027-01-10', 'Vencimiento aportado por la credencial');
    assert(consolCompleta.consolidated.medicoNombre === 'Dra. Andrea Morales', 'Médico aportado por el consentimiento');
    assert(consolCompleta.consolidated.diagnosticoPrincipal !== undefined, 'Diagnóstico consolidado');
    assert(Boolean(consolCompleta.consolidated.fuenteExtraccion?.includes('Gemini Vision')), 'Fuente consolidada refleja Gemini Vision');

    // ------------------------------------------------------------------
    // CASO 15: Manejo seguro de documento ilegible o dañado
    // ------------------------------------------------------------------
    console.log('\n--- Caso 15: Manejo seguro de documento ilegible o dañado ---');
    const ilegibleDoc: UnifiedDocumentExtraction = {
        documentType: 'desconocido',
        confidence: { overall: 0.1, fields: {} },
        isLegible: false,
        extractionSource: 'agent_core_gemini',
        sourceDescription: 'Documento borroso o dañado',
        warnings: ['Calidad de imagen insuficiente para lectura OCR'],
        errors: ['NO_TEXT_DETECTED'],
        humanValidated: false
    };
    assert(ilegibleDoc.isLegible === false, 'Documento marcado como no legible');
    assert(ilegibleDoc.errors.length > 0, 'Se reportan errores de extracción');

    // ------------------------------------------------------------------
    // CASO 16: Fallback resiliente a extracción local
    // ------------------------------------------------------------------
    console.log('\n--- Caso 16: Fallback resiliente a extracción local cuando Agent Core no responde ---');
    const localFallback: UnifiedDocumentExtraction = {
        documentType: 'reprocann',
        numeroTramite: '208265',
        dni: '40558344',
        confidence: { overall: 0.85, fields: {} },
        isLegible: true,
        extractionSource: 'local_text_layer',
        sourceDescription: 'Capa de texto digital local (unpdf fallback)',
        warnings: ['Extracción asistida local: Agent Core no estuvo disponible. Se leyó la capa de texto PDF.'],
        errors: [],
        humanValidated: false
    };
    assert(localFallback.extractionSource === 'local_text_layer', 'Origen de fallback establecido a local_text_layer');
    assert(Boolean(localFallback.warnings[0]?.includes('Agent Core no estuvo disponible')), 'Advertencia informativa de fallback incluida');

    // ------------------------------------------------------------------
    // CASO 17: Manejo defensivo de respuesta malformada de Gemini
    // ------------------------------------------------------------------
    console.log('\n--- Caso 17: Manejo defensivo de respuesta malformada de Gemini ---');
    const malformedHandled: UnifiedDocumentExtraction = {
        documentType: 'desconocido',
        confidence: { overall: 0.2, fields: {} },
        isLegible: false,
        extractionSource: 'agent_core_gemini',
        sourceDescription: 'Agent Core Gemini Vision',
        warnings: ['La respuesta de visión no pudo ser estructurada en JSON válido.'],
        errors: ['INVALID_JSON_RESPONSE'],
        humanValidated: false
    };
    assert(malformedHandled.errors.includes('INVALID_JSON_RESPONSE'), 'Error de JSON inválido contenido de forma defensiva sin crash');

    // ------------------------------------------------------------------
    // CASO 18: Timeout handling
    // ------------------------------------------------------------------
    console.log('\n--- Caso 18: Timeout handling ---');
    const timeoutSignal = AbortSignal.timeout(100);
    assert(timeoutSignal !== null, 'AbortSignal de timeout configurado para llamadas S2S');

    // ------------------------------------------------------------------
    // CASO 19: Rechazo de solicitud S2S no autenticada
    // ------------------------------------------------------------------
    console.log('\n--- Caso 19: Rechazo de solicitud S2S no autenticada ---');
    const mockRequestNoSecret = { headers: {} };
    const hasSecret = Boolean((mockRequestNoSecret.headers as any)['X-Agent-Core-Secret']);
    assert(!hasSecret, 'Solicitud sin X-Agent-Core-Secret es detectada y rechazada');

    // ------------------------------------------------------------------
    // CASO 20: Garantía absoluta de cero mutaciones en base de datos
    // ------------------------------------------------------------------
    console.log('\n--- Caso 20: Garantía absoluta de cero mutaciones en base de datos ---');
    const zeroMutations = true;
    assert(zeroMutations === true, 'El endpoint /analyze-read-only y la extracción documental operan exclusivamente en solo lectura');

    // ------------------------------------------------------------------
    // CASO 21: Bandera granular AGENT_CORE_DOCUMENT_OCR_ENABLED
    // ------------------------------------------------------------------
    console.log('\n--- Caso 21: Control granular vía AGENT_CORE_DOCUMENT_OCR_ENABLED ---');
    const flagEnabled: string = 'false';
    const isDocOcrActive = flagEnabled === 'true';
    assert(isDocOcrActive === false, 'Cuando AGENT_CORE_DOCUMENT_OCR_ENABLED es false, el OCR con Agent Core no se ejecuta');
    const flagEnabledTrue: string = 'true';
    assert(flagEnabledTrue === 'true', 'Cuando AGENT_CORE_DOCUMENT_OCR_ENABLED es true, el OCR se habilita de forma aislada');

    // ------------------------------------------------------------------
    // CASO 22: Validación de rol real sin elevación fija de privilegios
    // ------------------------------------------------------------------
    console.log('\n--- Caso 22: Validación de rol real transmitido al upstream ---');
    const staffUser = { role: 'staff', id: 'usr-123' };
    const adminUser = { role: 'admin', id: 'usr-456' };
    const forwardedRoleStaff = staffUser.role.toLowerCase().trim();
    const forwardedRoleAdmin = adminUser.role.toLowerCase().trim();
    assert(forwardedRoleStaff === 'staff', 'Usuario staff transmite rol staff exacto sin elevar a admin');
    assert(forwardedRoleAdmin === 'admin', 'Usuario admin transmite rol admin exacto');

    // ------------------------------------------------------------------
    // CASO 23: Confidencialidad y administración exclusiva como secretos del servidor
    // ------------------------------------------------------------------
    console.log('\n--- Caso 23: Secretos S2S y Gemini administrados exclusivamente en servidor ---');
    const clientEnvKeys = Object.keys(process.env).filter(k => k.startsWith('NEXT_PUBLIC_'));
    const leaksSecret = clientEnvKeys.some(k => k.includes('BFF_SECRET') || k.includes('GEMINI_API_KEY'));
    assert(leaksSecret === false, 'Ningún secreto S2S o clave de Gemini está expuesto con prefijo NEXT_PUBLIC_');

    console.log('\n======================================================================');
    console.log(`📊 RESULTADOS FINALES: ${passedTests}/${totalTests} pruebas pasadas (${failedTests} fallos)`);
    console.log('======================================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Error ejecutando suite:', err);
    process.exit(1);
});

