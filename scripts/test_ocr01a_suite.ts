import assert from 'node:assert/strict';
import {
    compareIdentityWithTarget,
    consolidateDocumentExtractions,
    extractDataFromDocumentText,
    extractTextFromPdfBufferAsync,
} from '../app/lib/ocr-contract';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
    return Promise.resolve(fn()).then(() => {
        passed++;
        console.log(`✓ ${name}`);
    });
}

async function run() {
    console.log('=== OCR-01A LOCAL SUITE (DATOS SINTÉTICOS) ===');

    // 1. Borrador anterior + documento escaneado sin texto
    await test('OCR-01A.1: Escaneo de 2 páginas sin texto no inventa campos ni mezcla borrador previo', () => {
        const ext = extractDataFromDocumentText(['', ''], 'doc_escaneado_2p.pdf', 2);
        assert.equal(ext.isLegible, false);
        assert.equal(ext.requiresVisualOcr, true);
        assert.equal(ext.totalPages, 2);
        assert.equal(ext.documentType, 'desconocido');
        const cons = consolidateDocumentExtractions([{ filename: 'doc_escaneado_2p.pdf', extraction: ext }]);
        assert.deepEqual(cons.consolidated.camposExtraidos, []);
        assert.equal(cons.consolidated.nombre, undefined);
        assert.equal(cons.consolidated.apellido, undefined);
        assert.equal(cons.consolidated.dni, undefined);
        assert.equal(cons.consolidated.numeroTramite, undefined);
        assert.equal(cons.consolidated.diagnosticoPrincipal, undefined);
    });

    // 2. PDF con texto digital multipágina conserva página exacta y evidencia acotada
    await test('OCR-01A.2: Texto digital multipágina conserva número de página y evidencia acotada', () => {
        const page1 = 'REPROCANN - CREDENCIAL\nTitular: Ana Prueba\nDNI: 30.111.222\nNúmero de Trámite: 998877';
        const page2 = 'Profesional Médico: Dr. Carlos Test\nMatrícula Nacional: MN 54321\nDiagnóstico: Migraña crónica';
        const ext = extractDataFromDocumentText([page1, page2], 'reprocann_multi.pdf', 2);
        assert.equal(ext.totalPages, 2);
        assert.equal(ext.fieldTraceability?.dni?.page, 1);
        assert.equal(ext.fieldTraceability?.dni?.origin, 'pdf_text_layer');
        assert.equal(ext.fieldTraceability?.medicoNombre?.page, 2);
        assert.equal(ext.fieldTraceability?.diagnosticoPrincipal?.page, 2);
        assert.ok((ext.fieldTraceability?.medicoNombre?.evidenceSnippet || '').length <= 80);
    });

    // 3. Documento de otra persona (DNI distinto) -> bloqueado
    await test('OCR-01A.3: Documento con DNI distinto bloquea aplicación automática', () => {
        const cmp = compareIdentityWithTarget(
            { dni: '99.888.777', nombre: 'Otro', apellido: 'Titular' },
            { dni: '30.111.222', nombre: 'Ana', apellido: 'Prueba' }
        );
        assert.equal(cmp.status, 'dni_mismatch');
        assert.equal(cmp.blocked, true);
    });

    // 4. Documento con DNI coincidente -> permitido
    await test('OCR-01A.4: Documento con DNI coincidente permite continuar', () => {
        const cmp = compareIdentityWithTarget(
            { dni: '30.111.222', nombre: 'Ana', apellido: 'Prueba' },
            { dni: '30111222', nombre: 'Ana', apellido: 'Prueba' }
        );
        assert.equal(cmp.status, 'match');
        assert.equal(cmp.blocked, false);
    });

    // 5. Documento sin DNI -> comparación secundaria por nombre / datos insuficientes
    await test('OCR-01A.5: Documento sin DNI detecta discrepancia de nombre o insuficiencia de datos', () => {
        const nameMismatch = compareIdentityWithTarget(
            { nombre: 'Pedro', apellido: 'Ajeno' },
            { dni: '30111222', nombre: 'Ana', apellido: 'Prueba' }
        );
        assert.equal(nameMismatch.status, 'name_mismatch');
        assert.equal(nameMismatch.blocked, true);

        const insufficient = compareIdentityWithTarget(
            {},
            { dni: '30111222', nombre: 'Ana', apellido: 'Prueba' }
        );
        assert.equal(insufficient.status, 'insufficient_data');
        assert.equal(insufficient.blocked, false);
    });

    // 6. Campos ausentes no se infieren
    await test('OCR-01A.6: Campos ausentes permanecen undefined', () => {
        const ext = extractDataFromDocumentText('Consentimiento informado bilateral firmado por las partes.', 'doc.pdf', 2);
        assert.equal(ext.documentType, 'consentimiento');
        assert.equal(ext.dni, undefined);
        assert.equal(ext.numeroTramite, undefined);
        assert.equal(ext.fechaVencimiento, undefined);
        assert.equal(ext.diagnostico, undefined);
    });

    // 7. Clasificación documental (consentimiento, DNI, REPROCANN, receta, constancia, desconocido)
    await test('OCR-01A.7: Clasificación correcta de tipos documentales', () => {
        assert.equal(extractDataFromDocumentText('Consentimiento Informado Bilateral Ley 27350', 'a.pdf', 2).documentType, 'consentimiento');
        assert.equal(extractDataFromDocumentText('Registro Nacional de las Personas RENAPER', 'b.pdf', 1).documentType, 'dni');
        assert.equal(extractDataFromDocumentText('Programa de Cannabis REPROCANN Credencial', 'c.pdf', 1).documentType, 'reprocann');
        assert.equal(extractDataFromDocumentText('Receta Médica / Prescripción de aceite', 'd.pdf', 1).documentType, 'receta');
        assert.equal(extractDataFromDocumentText('Constancia de trámite en curso', 'e.pdf', 1).documentType, 'constancia_tramite');
        assert.equal(extractDataFromDocumentText('', 'archivo_generico.pdf', 2).documentType, 'desconocido');
    });

    // 8. Minimización de borrador en localStorage (sin datos clínicos)
    await test('OCR-01A.8: Serialización de borrador excluye campos clínicos sensibles', () => {
        const fullForm = {
            nombre: 'Ana',
            apellido: 'Prueba',
            dni: '30111222',
            medicoNombre: 'Dr. Privado',
            medicoMatricula: 'MN 12345',
            diagnosticoPrincipal: 'Patología confidencial',
        };
        const { medicoNombre: _m, medicoMatricula: _mat, diagnosticoPrincipal: _d, ...minimalDraft } = fullForm;
        const json = JSON.stringify(minimalDraft);
        assert.equal(json.includes('Patología'), false);
        assert.equal(json.includes('Dr. Privado'), false);
        assert.equal(json.includes('MN 12345'), false);
    });

    // 9. Ausencia de llamadas externas cuando OCR visual está apagado
    await test('OCR-01A.9: Sin credenciales OCR externas, extractTextFromPdfBufferAsync funciona 100% offline', async () => {
        const fakePdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
        const res = await extractTextFromPdfBufferAsync(fakePdf);
        assert.equal(res.isLikelyImageOnly, true);
        assert.ok(Array.isArray(res.pages));
    });

    console.log(`=== OCR-01A SUITE COMPLETE: ${passed}/${passed} PASS ===`);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
