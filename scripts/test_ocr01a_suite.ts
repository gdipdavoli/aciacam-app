import assert from 'node:assert/strict';
import {
    LEGACY_SOCIO_DRAFT_KEY,
    applyProposalToSocioForm,
    compareIdentityWithTarget,
    consolidateDocumentExtractions,
    extractDataFromDocumentText,
    extractTextFromPdfBufferAsync,
    getScopedSocioDraftKey,
    migrateAndLoadScopedDraft,
    sanitizeSocioDraft,
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

    // 10. Migración segura de borrador legacy v4 eliminando datos clínicos y de procedencia
    await test('OCR-01A.10: Migración de aciacam_new_socio_draft_v4 elimina datos clínicos y preserva datos administrativos', () => {
        const mem = new Map<string, string>();
        const storage = {
            getItem: (k: string) => mem.get(k) ?? null,
            setItem: (k: string, v: string) => { mem.set(k, v); },
            removeItem: (k: string) => { mem.delete(k); },
        };
        mem.set(LEGACY_SOCIO_DRAFT_KEY, JSON.stringify({
            nombre: 'Lucía',
            apellido: 'Sintética',
            dni: '33444555',
            email: 'lucia@example.com',
            medicoNombre: 'Dr. Secreto',
            medicoMatricula: 'MN 99999',
            diagnosticoPrincipal: 'Dolor crónico confidencial',
            fieldTraceability: { diagnosticoPrincipal: { evidenceSnippet: 'texto clínico sensible' } },
        }));

        const res = migrateAndLoadScopedDraft(storage, 'admin-1');
        assert.equal(res.migratedFromLegacy, true);
        assert.equal(res.strippedClinicalData, true);
        assert.equal(mem.has(LEGACY_SOCIO_DRAFT_KEY), false);
        assert.equal(res.pendingDraft?.nombre, 'Lucía');
        assert.equal(res.pendingDraft?.dni, '33444555');
        assert.equal(res.pendingDraft?.medicoNombre, undefined);
        assert.equal(res.pendingDraft?.medicoMatricula, undefined);
        assert.equal(res.pendingDraft?.diagnosticoPrincipal, undefined);
        assert.equal(res.pendingDraft?.fieldTraceability, undefined);

        const scopedRaw = mem.get(getScopedSocioDraftKey('admin-1')!)!;
        assert.equal(scopedRaw.includes('Secreto'), false);
        assert.equal(scopedRaw.includes('Dolor'), false);
        assert.equal(scopedRaw.includes('evidenceSnippet'), false);
    });

    // 11. Aislamiento de borradores entre usuarios administrativos
    await test('OCR-01A.11: Borradores aislados por usuario administrativo', () => {
        const mem = new Map<string, string>();
        const storage = {
            getItem: (k: string) => mem.get(k) ?? null,
            setItem: (k: string, v: string) => { mem.set(k, v); },
            removeItem: (k: string) => { mem.delete(k); },
        };
        const { draft } = sanitizeSocioDraft({ nombre: 'Carlos', apellido: 'Uno', dni: '22333444' });
        mem.set(getScopedSocioDraftKey('admin-A')!, JSON.stringify(draft));

        const resA = migrateAndLoadScopedDraft(storage, 'admin-A');
        const resB = migrateAndLoadScopedDraft(storage, 'admin-B');
        assert.equal(resA.pendingDraft?.nombre, 'Carlos');
        assert.equal(resB.pendingDraft, null);
    });

    // 12. Aplicación explícita bloquea documento de otra persona y aplica si coincide
    await test('OCR-01A.12: applyProposalToSocioForm valida identidad antes de aplicar campos', () => {
        const currentForm = { nombre: 'Ana', apellido: 'Pérez', dni: '30111222', numeroTramite: '', camposExtraidos: [] as string[] };
        const otherPerson = { nombre: 'Jorge', apellido: 'Gómez', dni: '40999888', numeroTramite: '998877' };
        const blockedRes = applyProposalToSocioForm(currentForm, otherPerson, { todayStr: '2026-11-20' });
        assert.equal(blockedRes.blocked, true);
        assert.deepEqual(blockedRes.appliedFields, []);
        assert.equal(blockedRes.formData.numeroTramite, '');

        const samePerson = { nombre: 'Ana', apellido: 'Pérez', dni: '30111222', numeroTramite: '556677', medicoNombre: 'Dr. Test' };
        const okRes = applyProposalToSocioForm(currentForm, samePerson, { todayStr: '2026-11-20' });
        assert.equal(okRes.blocked, false);
        assert.equal(okRes.formData.numeroTramite, '556677');
        assert.equal((okRes.formData as any).medicoNombre, 'Dr. Test');
        assert.ok(okRes.appliedFields.includes('numeroTramite'));
    });

    console.log(`=== OCR-01A SUITE COMPLETE: ${passed}/${passed} PASS ===`);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
