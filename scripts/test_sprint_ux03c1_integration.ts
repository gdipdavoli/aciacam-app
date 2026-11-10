/**
 * scripts/test_sprint_ux03c1_integration.ts
 *
 * Suite Integral de Verificación Automatizada - Sprint UX-03C.1
 * Valida extracción digital multi-página, diferenciación entre consentimiento y credencial,
 * protección de timestamps de firma digital, consolidación multi-documento y resiliencia ante errores.
 */

import { 
    extractTextFromPdfBufferAsync, 
    extractDataFromDocumentText, 
    consolidateDocumentExtractions,
    validateIdentityMatch,
    UnifiedDocumentExtraction 
} from '../app/lib/ocr-contract';
import * as zlib from 'zlib';

function createSyntheticPdf(pagesText: string[]): Uint8Array {
    let objId = 1;
    const objects: { id: number; content: string }[] = [];

    const catalogId = objId++;
    const pagesId = objId++;

    const pageIds: number[] = [];
    const contentIds: number[] = [];

    for (let i = 0; i < pagesText.length; i++) {
        pageIds.push(objId++);
        contentIds.push(objId++);
    }

    objects.push({
        id: catalogId,
        content: `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
    });

    objects.push({
        id: pagesId,
        content: `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pagesText.length} >>`
    });

    for (let i = 0; i < pagesText.length; i++) {
        const text = pagesText[i];
        const escaped = text
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)')
            .replace(/á/g, '\\341')
            .replace(/é/g, '\\351')
            .replace(/í/g, '\\355')
            .replace(/ó/g, '\\363')
            .replace(/ú/g, '\\372')
            .replace(/ñ/g, '\\361')
            .replace(/Á/g, '\\301')
            .replace(/É/g, '\\311')
            .replace(/Í/g, '\\315')
            .replace(/Ó/g, '\\323')
            .replace(/Ú/g, '\\332')
            .replace(/Ñ/g, '\\321')
            .replace(/°/g, '\\260');

        const lines = escaped.split('\n');
        let streamBody = 'BT /F1 10 Tf 50 750 Td ';
        for (const line of lines) {
            streamBody += `(${line}) Tj 0 -15 Td `;
        }
        streamBody += 'ET';

        objects.push({
            id: pageIds[i],
            content: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> >> >> >>`
        });

        objects.push({
            id: contentIds[i],
            content: `<< /Length ${Buffer.byteLength(streamBody, 'utf-8')} >>\nstream\n${streamBody}\nendstream`
        });
    }

    let pdfStr = '%PDF-1.4\n';
    const xrefOffsets = [0];

    for (const obj of objects) {
        xrefOffsets.push(pdfStr.length);
        pdfStr += `${obj.id} 0 obj\n${obj.content}\nendobj\n`;
    }

    const startXref = pdfStr.length;
    pdfStr += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
        pdfStr += `${String(xrefOffsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdfStr += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${startXref}\n%%EOF`;

    const buf = Buffer.from(pdfStr, 'utf-8');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function createCompressedPdf(text: string): Uint8Array {
    const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const lines = escaped.split('\n');
    let streamBody = 'BT /F1 10 Tf 50 750 Td ';
    for (const line of lines) {
        streamBody += `(${line}) Tj 0 -15 Td `;
    }
    streamBody += 'ET';

    const compressedStream = zlib.deflateSync(Buffer.from(streamBody, 'utf-8'));

    const header = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj\n4 0 obj\n<< /Filter /FlateDecode /Length ' + compressedStream.length + ' >>\nstream\n';
    const footer = '\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000266 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n500\n%%EOF';

    const buf = Buffer.concat([
        Buffer.from(header, 'utf-8'),
        compressedStream,
        Buffer.from(footer, 'utf-8')
    ]);

    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function runTestSuite() {
    console.log('===============================================================');
    console.log('ACIACAM APP - SPRINT UX-03C.1 TEST SUITE INTEGRAL');
    console.log('===============================================================\n');

    let passed = 0;
    let failed = 0;

    const assert = (condition: boolean, title: string, details?: string) => {
        if (condition) {
            console.log(`  [PASS] ${title}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${title}`);
            if (details) console.error(`         Detalle: ${details}`);
            failed++;
        }
    };

    // -------------------------------------------------------------
    // CASO A: Consentimiento informado digital de 3 páginas
    // -------------------------------------------------------------
    console.log('--- CASO A: Consentimiento informado digital de 3 páginas ---');
    const consentPages = [
        `REPUBLICA ARGENTINA - PODER EJECUTIVO NACIONAL
MINISTERIO DE SALUD DE LA NACION
PROGRAMA NACIONAL PARA EL ESTUDIO Y LA INVESTIGACION DEL USO MEDICINAL DE LA PLANTA DE CANNABIS
REPROCANN - REGISTRO DEL PROGRAMA DE CANNABIS
CONSENTIMIENTO INFORMADO PARA TRATAMIENTO CON CANNABIS CON FINES MEDICINALES
N° de Solicitud: TR-2024-8849201
DATOS DEL PACIENTE:
Apellido y Nombre: DIP DAVOLI, GIULIANO
D.N.I.: 38.456.789
Fecha de Nacimiento: 15/08/1994
Domicilio: Av. Illia 450, San Luis, San Luis`,

        `DATOS DEL PROFESIONAL MEDICO TRATANTE:
Profesional Médico: Dr. Carlos Alberto Martinez
Matrícula: MN 145920
Especialidad: Medicina General
INFORMACION CLINICA:
Diagnóstico: Dolor neuropático crónico refractario
Plan terapéutico: Aceite CBD full spectrum`,

        `FIRMA Y CERTIFICACION:
Firmado digitalmente el 12/03/2024 15:42:19 por MARTINEZ CARLOS ALBERTO
Validez de la firma digital: Verificada por Autoridad Certificante Raíz de la República Argentina.
El paciente declara haber comprendido los alcances del consentimiento.`
    ];

    const consentPdfBytes = createSyntheticPdf(consentPages);
    const resA = await extractTextFromPdfBufferAsync(consentPdfBytes);
    const extA = extractDataFromDocumentText(resA.text, 'consentimiento_informado_reprocann.pdf', resA.totalPages);

    assert(resA.totalPages === 3, 'Caso A.1: Detecta exactamente 3 páginas en consentimiento', `Total páginas: ${resA.totalPages}`);
    assert(extA.documentType === 'consentimiento', 'Caso A.2: Tipo de documento detectado como consentimiento', `Tipo: ${extA.documentType}`);
    assert(extA.isLegible === true, 'Caso A.3: Capa de texto digital es plenamente legible');
    assert(extA.titular?.nombre === 'GIULIANO' && extA.titular?.apellido === 'DIP DAVOLI', 'Caso A.4: Titular extraído correctamente (Nombre y Apellido)', `${JSON.stringify(extA.titular)}`);
    assert(extA.dni === '38456789', 'Caso A.5: DNI normalizado a 8 dígitos', `DNI: ${extA.dni}`);
    assert(extA.fechaNacimiento === '1994-08-15', 'Caso A.6: Fecha de nacimiento en formato YYYY-MM-DD', `Nac: ${extA.fechaNacimiento}`);
    assert(extA.numeroTramite === 'TR-2024-8849201', 'Caso A.7: Número de trámite extraído', `Trámite: ${extA.numeroTramite}`);
    assert(Boolean(extA.medico?.nombre?.includes('Carlos Alberto Martinez')), 'Caso A.8: Nombre del médico tratante extraído', `Médico: ${extA.medico?.nombre}`);
    assert(extA.medico?.matricula === 'MN 145920', 'Caso A.9: Matrícula médica extraída', `Mat: ${extA.medico?.matricula}`);
    assert(Boolean(extA.diagnostico?.includes('Dolor neuropático')), 'Caso A.10: Diagnóstico clínico extraído', `Diag: ${extA.diagnostico}`);
    assert(extA.fechaVencimiento === undefined, 'Caso A.11: No confunde firma digital con fecha de vencimiento REPROCANN', `Vencimiento: ${extA.fechaVencimiento}`);
    assert(extA.warnings.some(w => w.includes('firma digital')), 'Caso A.12: Emite advertencia explícita sobre firma digital detectada');

    // -------------------------------------------------------------
    // CASO B: Credencial REPROCANN con imagen rasterizada incrustada
    // -------------------------------------------------------------
    console.log('\n--- CASO B: Credencial REPROCANN con imagen rasterizada incrustada ---');
    // En las credenciales oficiales, el texto digital es únicamente el membrete
    const credentialPages = [
        `REPUBLICA ARGENTINA - PODER EJECUTIVO NACIONAL
MINISTERIO DE SALUD
CERTIFICADO DE INSCRIPCION AL REPROCANN`
    ];

    const credentialPdfBytes = createSyntheticPdf(credentialPages);
    const resB = await extractTextFromPdfBufferAsync(credentialPdfBytes);
    const extB = extractDataFromDocumentText(resB.text, 'credencial_reprocann_paciente.pdf', resB.totalPages);

    assert(resB.totalPages === 1, 'Caso B.1: Credencial es de 1 página', `Páginas: ${resB.totalPages}`);
    assert(extB.requiresVisualOcr === true, 'Caso B.2: Detecta bandera requiresVisualOcr = true');
    assert(extB.isLegible === false, 'Caso B.3: No declara éxito falso de lectura digital');
    assert(extB.dni === undefined, 'Caso B.4: No inventa datos inexistentes en capa de texto');
    assert(extB.warnings.some(w => w.includes('imagen rasterizada incrustada')), 'Caso B.5: Emite advertencia instructiva sobre carnet con imagen');

    // -------------------------------------------------------------
    // CASO C: Ambos documentos juntos (Consentimiento + Credencial)
    // -------------------------------------------------------------
    console.log('\n--- CASO C: Consolidación Multi-Documento (Consentimiento + Credencial) ---');
    const multiItems = [
        { filename: 'consentimiento_informado.pdf', extraction: extA },
        { filename: 'credencial_carnet.pdf', extraction: extB }
    ];

    const consolidation = consolidateDocumentExtractions(multiItems);
    const c = consolidation.consolidated;

    assert(c.nombre === 'GIULIANO', 'Caso C.1: Preserva nombre de paciente desde consentimiento');
    assert(c.apellido === 'DIP DAVOLI', 'Caso C.2: Preserva apellido de paciente');
    assert(c.dni === '38456789', 'Caso C.3: Preserva DNI sin pérdida');
    assert(c.fechaNacimiento === '1994-08-15', 'Caso C.4: Preserva fecha de nacimiento');
    assert(c.numeroTramite === 'TR-2024-8849201', 'Caso C.5: Preserva número de trámite');
    assert(Boolean(c.medicoNombre?.includes('Carlos Alberto Martinez')), 'Caso C.6: Preserva médico tratante');
    assert(c.medicoMatricula === 'MN 145920', 'Caso C.7: Preserva matrícula médica');
    assert(Boolean(c.diagnosticoPrincipal?.includes('Dolor neuropático')), 'Caso C.8: Preserva diagnóstico');
    assert(consolidation.conflicts.length === 0, 'Caso C.9: No genera falsos conflictos por la credencial rasterizada');
    assert(consolidation.documentSummaries.length === 2, 'Caso C.10: Genera desglose independiente de 2 documentos');
    assert(consolidation.documentSummaries[0].detectedFields.length >= 6, 'Caso C.11: Detalla campos detectados del consentimiento');
    assert(consolidation.documentSummaries[1].requiresVisualOcr === true, 'Caso C.12: Marca credencial con requerimiento de OCR visual');

    // -------------------------------------------------------------
    // CASO D: PDF con texto comprimido / FlateDecode estándar
    // -------------------------------------------------------------
    console.log('\n--- CASO D: PDF con compresión FlateDecode estándar ---');
    const compressedPdfBytes = createCompressedPdf(`MINISTERIO DE SALUD - REPROCANN
Solicitud de Inscripcion: TR-2025-112233
Titular: GOMEZ, MARIA ELENA
DNI: 30.123.456
Nacido el: 22/04/1983
Vigencia hasta: 10/11/2028`);

    const resD = await extractTextFromPdfBufferAsync(compressedPdfBytes);
    const extD = extractDataFromDocumentText(resD.text, 'certificado_comprimido.pdf', resD.totalPages);

    assert(extD.isLegible === true, 'Caso D.1: Capa de texto comprimida decodificada exitosamente');
    assert(extD.numeroTramite === 'TR-2025-112233', 'Caso D.2: Trámite extraído de stream comprimido', `Trámite: ${extD.numeroTramite}`);
    assert(extD.dni === '30123456', 'Caso D.3: DNI extraído de stream comprimido', `DNI: ${extD.dni}`);
    assert(extD.titular?.nombre === 'MARIA ELENA' && extD.titular?.apellido === 'GOMEZ', 'Caso D.4: Titular extraído correctamente', `${JSON.stringify(extD.titular)}`);
    assert(extD.fechaVencimiento === '2028-11-10', 'Caso D.5: Fecha de vencimiento válida extraída de certificado', `Venc: ${extD.fechaVencimiento}`);

    // -------------------------------------------------------------
    // CASO E: PDF malformado o corrupto (resiliencia y gracia ante fallas)
    // -------------------------------------------------------------
    console.log('\n--- CASO E: Resiliencia ante PDF malformado o corrupto ---');
    const corruptBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0xfe, 0xaa, 0xbb]);
    let noCrash = true;
    let resE: any;

    try {
        resE = await extractTextFromPdfBufferAsync(corruptBytes);
    } catch (e) {
        noCrash = false;
    }

    assert(noCrash === true, 'Caso E.1: No lanza excepción no controlada ante bytes corruptos');
    const extE = extractDataFromDocumentText(resE?.text || '', 'archivo_corrupto.pdf', resE?.totalPages || 0);
    assert(extE.isLegible === false, 'Caso E.2: Marca documento corrupto como no legible');
    assert(extE.warnings.length > 0, 'Caso E.3: Provee advertencia instructiva al operador');

    // -------------------------------------------------------------
    // BALANCE FINAL
    // -------------------------------------------------------------
    console.log('\n===============================================================');
    console.log(`BALANCE FINAL DE PRUEBAS: ${passed} EXITOSAS, ${failed} FALLIDAS`);
    console.log('===============================================================');

    if (failed > 0) {
        console.error('ALERTA: Se detectaron fallas en la suite de pruebas.');
        process.exit(1);
    } else {
        console.log('DICTAMEN: Todas las pruebas estructurales y funcionales resultaron SATISFACTORIAS.');
        process.exit(0);
    }
}

runTestSuite().catch(err => {
    console.error('Fallo fatal en runner de pruebas:', err);
    process.exit(1);
});
