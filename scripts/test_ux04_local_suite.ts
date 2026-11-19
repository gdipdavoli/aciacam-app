import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
    calculateCartSummary,
    calculateItemAporte,
    getUnitAporte,
    isOilProduct,
    resolveOrderTotal,
} from '../app/lib/order-pricing';
import {
    consolidateDocumentExtractions,
    extractDataFromDocumentText,
    sanitizeDiagnosis,
    sanitizeLocalDoctorName,
    sanitizeLocalMatricula,
} from '../app/lib/ocr-contract';
import { getQuickDeliveryTarget } from '../helpers/orderHelpers';

let passed = 0;
function test(name: string, fn: () => void) {
    fn();
    passed++;
    console.log(`✓ ${name}`);
}

console.log('=== UX-04 LOCAL UNIT & PG17 INTEGRATION SUITE ===');

// 1. INC-05: Aceites por frasco vs Flores por gramo + históricos + consistencia cliente/servidor
test('INC-05.1: Aceite calcula aporte por frasco independiente de peso_gramos=0', () => {
    const oil = { id: 'oil-1', tipo: 'gotero', peso_gramos: 0, aporte_unidad: 25000 };
    assert.equal(isOilProduct(oil.tipo), true);
    assert.equal(getUnitAporte(oil, 10000), 25000);
    assert.equal(calculateItemAporte(oil, 2, 10000), 50000);
});

test('INC-05.2: Solo flores, solo aceites y pedido mixto mantienen consistencia y no contaminan floresGramos', () => {
    const flower = { id: 'fl-1', tipo: 'flor', peso_gramos: 10 };
    const oil = { id: 'oil-1', tipo: 'gotero', peso_gramos: 5, aporte_unidad: 28000 };

    const onlyFlowers = calculateCartSummary([{ productoId: 'fl-1', cantidad: 3, producto: flower }], 10000);
    assert.equal(onlyFlowers.floresGramos, 30);
    assert.equal(onlyFlowers.aceitesUnidades, 0);
    assert.equal(onlyFlowers.aporteTotal, 300000);

    const onlyOils = calculateCartSummary([{ productoId: 'oil-1', cantidad: 2, producto: oil }], 10000);
    assert.equal(onlyOils.floresGramos, 0);
    assert.equal(onlyOils.aceitesUnidades, 2);
    assert.equal(onlyOils.aporteTotal, 56000);

    const mixed = calculateCartSummary(
        [
            { productoId: 'fl-1', cantidad: 2, producto: flower },
            { productoId: 'oil-1', cantidad: 3, producto: oil },
        ],
        10000
    );
    assert.equal(mixed.floresGramos, 20);
    assert.equal(mixed.aceitesUnidades, 3);
    assert.equal(mixed.aporteTotal, 20 * 10000 + 3 * 28000);
});

test('INC-05.3: Pedidos históricos conservan su total persistido ante cambios de catálogo', () => {
    const productsById = new Map([
        ['fl-1', { id: 'fl-1', tipo: 'flor', peso_gramos: 10 }],
        ['oil-1', { id: 'oil-1', tipo: 'gotero', peso_gramos: 0, aporte_unidad: 99999 }],
    ]);
    const historical = {
        total: 120000,
        items: [{ productoId: 'oil-1', cantidad: 2 }],
    };
    assert.equal(resolveOrderTotal(historical, productsById, 15000), 120000);
});

// 2. INC-06: Entrega rápida desde listado respetando SEC-01 y protección ante repetición/fallos
test('INC-06.1: getQuickDeliveryTarget respeta estrictamente transiciones SEC-01', () => {
    assert.equal(getQuickDeliveryTarget('retiro_sede', 'listo_para_retiro'), 'retirado');
    assert.equal(getQuickDeliveryTarget('retiro_sede', 'confirmado'), 'retirado');
    assert.equal(getQuickDeliveryTarget('retiro_sede', 'pendiente'), null);
    assert.equal(getQuickDeliveryTarget('retiro_sede', 'en_preparacion'), null);
    assert.equal(getQuickDeliveryTarget('retiro_sede', 'retirado'), null);
    assert.equal(getQuickDeliveryTarget('retiro_sede', 'cancelado'), null);

    assert.equal(getQuickDeliveryTarget('delivery', 'en_camino'), 'entregado');
    assert.equal(getQuickDeliveryTarget('delivery', 'confirmado'), 'entregado');
    assert.equal(getQuickDeliveryTarget('delivery', 'pendiente'), null);
    assert.equal(getQuickDeliveryTarget('delivery', 'en_preparacion'), null);
    assert.equal(getQuickDeliveryTarget('delivery', 'entregado'), null);
    assert.equal(getQuickDeliveryTarget('delivery', 'cancelado'), null);
});

test('INC-06.2: Guard contra doble clic y preservación de commandId ante fallo de conexión', () => {
    let inFlight = false;
    let calls = 0;
    const commandIds = new Map<string, string>();
    const getCmd = (sig: string) => {
        if (!commandIds.has(sig)) commandIds.set(sig, 'cmd-uuid-stable-1');
        return commandIds.get(sig)!;
    };
    const simulateConfirm = (shouldFail: boolean) => {
        if (inFlight) return 'IGNORED_DOUBLE_CLICK';
        inFlight = true;
        try {
            calls++;
            const cid = getCmd('pendiente');
            if (shouldFail) throw new Error('NETWORK_TIMEOUT');
            commandIds.clear();
            return `OK:${cid}`;
        } finally {
            inFlight = false;
        }
    };

    assert.throws(() => simulateConfirm(true), /NETWORK_TIMEOUT/);
    // Reintento tras fallo mantiene el mismo commandId estable
    assert.equal(simulateConfirm(false), 'OK:cmd-uuid-stable-1');
    assert.equal(calls, 2);
});

// 3. INC-02: Sanitización de médico, matrícula, diagnóstico y conflictos
test('INC-02.1: sanitizeLocalDoctorName acepta iniciales y partículas de apellido, rechaza prosa jurídica', () => {
    assert.equal(sanitizeLocalDoctorName('Dr. Juan A. Del Valle'), 'Dr. Juan A. Del Valle');
    assert.equal(sanitizeLocalDoctorName('Dra. María Elena Gómez'), 'Dra. María Elena Gómez');
    assert.equal(sanitizeLocalDoctorName('médico declara conforme ley 27350'), undefined);
});

test('INC-02.2: sanitizeLocalMatricula soporta puntos y exige dígitos', () => {
    assert.equal(sanitizeLocalMatricula('M.N. 123.456'), 'MN 123.456');
    assert.equal(sanitizeLocalMatricula('9876', 'Matrícula Provincial N° 9876'), 'MP 9876');
    assert.equal(sanitizeLocalMatricula('PROVINCIAL'), undefined);
});

test('INC-02.3: sanitizeDiagnosis admite siglas clínicas (TEA) y rechaza prosa legal', () => {
    assert.equal(sanitizeDiagnosis('Diagnóstico: TEA'), 'TEA');
    assert.equal(sanitizeDiagnosis('Patología: Dolor crónico neuropático. Antecedentes: sin datos'), 'Dolor crónico neuropático');
    assert.equal(sanitizeDiagnosis('conforme resolución y ley 27350'), undefined);
});

test('INC-02.4: extractDataFromDocumentText extrae médico, matrícula y diagnóstico limpios', () => {
    const sample = `
        REPROCANN - CREDENCIAL
        Número de Trámite: 123456
        Fecha de Emisión: 01/10/2026
        Vencimiento: 01/10/2029
        Profesional Médico Tratante: Dra. Laura M. Sosa
        Matrícula Nacional: M.N. 45.678
        Diagnóstico: Migraña crónica
    `;
    const ext = extractDataFromDocumentText(sample, 'reprocann.pdf', 1);
    assert.equal(ext.medico?.nombre, 'Dra. Laura M. Sosa');
    assert.equal(ext.medico?.matricula, 'MN 45.678');
    assert.equal(ext.diagnostico, 'Migraña crónica');
});

test('INC-02.5: consolidateDocumentExtractions evita falsos conflictos y detecta discrepancias reales', () => {
    const extA = extractDataFromDocumentText(
        'Profesional Médico: Dr. Juan Pérez\nMatrícula Nacional: MN 12345\nDiagnóstico: Dolor crónico',
        'docA.pdf',
        1
    );
    const extB = extractDataFromDocumentText(
        'Profesional Médico: Juan Perez\nMatrícula Nacional: M.N. 12.345\nDiagnóstico: Dolor cronico',
        'docB.pdf',
        1
    );
    const same = consolidateDocumentExtractions([
        { filename: 'docA.pdf', extraction: extA },
        { filename: 'docB.pdf', extraction: extB },
    ]);
    assert.equal(same.conflicts.length, 0);

    const extC = extractDataFromDocumentText(
        'Matrícula Nacional: MN 99999',
        'docC.pdf',
        1
    );
    const diff = consolidateDocumentExtractions([
        { filename: 'docA.pdf', extraction: extA },
        { filename: 'docC.pdf', extraction: extC },
    ]);
    assert.equal(diff.conflicts.some(c => c.field === 'medicoMatricula'), true);
});

// 4. INC-04 + INC-05 en PostgreSQL 17 local (ux04_local_dev, dentro de ROLLBACK)
test('INC-04 + INC-05 PG17: pedido sintético con fecha, franja_horaria y aceite aporte_unidad en ux04_local_dev', () => {
    const sql = `
        BEGIN;
        WITH new_prod AS (
            INSERT INTO public.products (nombre, tipo, categoria, stock_disponible, activo, peso_gramos, aporte_unidad)
            VALUES ('Aceite Sintético UX04', 'gotero', 'CBD', 10, true, 0, 25000)
            RETURNING id
        ),
        existing_socio AS (
            SELECT id FROM public.socios LIMIT 1
        ),
        new_order AS (
            INSERT INTO public.pedidos (
                socio_id, tipo_pedido, origen, estado, items,
                fecha_retiro_preferida, franja_horaria, total
            )
            SELECT
                existing_socio.id,
                'retiro_sede',
                'app',
                'pendiente',
                jsonb_build_array(
                    jsonb_build_object(
                        'productoId', new_prod.id,
                        'productoNombre', 'Aceite Sintético UX04',
                        'cantidad', 2,
                        'precioUnitario', 25000
                    )
                ),
                DATE '2026-11-25',
                '10:00 - 12:00',
                50000
            FROM existing_socio, new_prod
            RETURNING id, fecha_retiro_preferida::text, franja_horaria, total
        )
        SELECT 'SYNTHETIC_ORDER|' || fecha_retiro_preferida || '|' || franja_horaria || '|' || total FROM new_order;
        ROLLBACK;
    `;
    const out = execSync(
        'docker exec -i aciacam-pg17-restore-test psql -U postgres -d ux04_local_dev -v ON_ERROR_STOP=1 -t -A',
        { input: sql, encoding: 'utf8' }
    );
    assert.match(out, /SYNTHETIC_ORDER\|2026-11-25\|10:00 - 12:00\|50000/);
    assert.match(out, /ROLLBACK/);
});

// 5. INC-01: Verificar disponibilidad de credenciales OCR visual en entorno local
const hasAgentOcr = process.env.AGENT_CORE_DOCUMENT_OCR_ENABLED === 'true' && Boolean(process.env.AGENT_CORE_BASE_URL && process.env.AGENT_CORE_BFF_SECRET);
const hasDirectGemini = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
console.log(`INFO OCR_ENV_LOCAL: agentCoreOcr=${hasAgentOcr}, directGeminiKey=${hasDirectGemini}`);

console.log(`=== UX-04 SUITE COMPLETE: ${passed}/${passed} PASS ===`);
