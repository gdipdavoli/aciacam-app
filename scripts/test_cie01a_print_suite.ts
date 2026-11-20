import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    buildConstanciaPrintHtml,
    selectPreferredCierre,
} from '../app/lib/cierres/constancia-print';

let passed = 0;
function test(name: string, fn: () => void) {
    fn();
    passed++;
    console.log(`✓ ${name}`);
}

console.log('=== CIE-01A PRINT & CIERRE SELECTION SUITE ===');

test('CIE-01A.1: selectPreferredCierre prioriza emitido sobre anulado y maneja múltiples filas', () => {
    const rows = [
        { id: 'c1', estado: 'anulado', fecha_generacion: '2026-11-18T10:00:00Z' },
        { id: 'c2', estado: 'emitido', fecha_generacion: '2026-11-19T10:00:00Z' },
    ];
    assert.equal(selectPreferredCierre(rows)?.id, 'c2');

    const onlyAnnulled = [
        { id: 'c1', estado: 'anulado', fecha_generacion: '2026-11-18T10:00:00Z' },
        { id: 'c3', estado: 'anulado', fecha_generacion: '2026-11-19T12:00:00Z' },
    ];
    assert.equal(selectPreferredCierre(onlyAnnulled)?.id, 'c3');
    assert.equal(selectPreferredCierre([]), null);
});

test('CIE-01A.2: Constancia emitida usa snapshot histórico sin recalcular e incluye encabezado A4', () => {
    const html = buildConstanciaPrintHtml({
        periodo: '2026-11',
        numeroConstancia: 'CIE-2026-0001',
        fechaGeneracion: '2026-11-20T12:00:00Z',
        hashSha256: 'abc123sha256',
        estado: 'emitido',
        isEmitted: true,
        datos: {
            socio: { nombre: 'Ana', apellido: 'Sintética', dni: '30111222', numeroSocio: '101' },
            dispensas: [
                { pedidoId: '12345678-aaaa-bbbb-cccc-000000000001', fecha: '2026-11-05T14:00:00Z', items: [{ cantidad: 2, productoNombre: 'Flores A' }], operador: 'Admin' }
            ],
            aportes: [
                { fecha: '2026-11-05', concepto: 'Aporte Flores A', medioDePago: 'transferencia_galicia', referencia: 'OP-99', monto: 25000 }
            ],
            pie_legal: 'Pie legal institucional.',
        },
    });
    assert.ok(html.includes('@page'));
    assert.ok(html.includes('size: A4 portrait'));
    assert.ok(html.includes('CONSTANCIA OFICIAL EMITIDA'));
    assert.ok(html.includes('CIE-2026-0001'));
    assert.ok(html.includes('abc123sha256'));
    assert.ok(html.includes('2x Flores A'));
    assert.ok(html.includes('25.000'));
    assert.ok(html.includes('Pie legal institucional.'));
});

test('CIE-01A.3: Vista previa no emitida se identifica explícitamente como borrador sin congelar', () => {
    const html = buildConstanciaPrintHtml({
        periodo: '2026-11',
        numeroConstancia: 'PRE-VISTA',
        fechaGeneracion: '2026-11-20T12:00:00Z',
        hashSha256: 'SIN CONGELAR (Pendiente de emisión)',
        estado: 'emitido',
        isEmitted: false,
        datos: { socio: { nombre: 'Ana', apellido: 'Prueba' }, dispensas: [], aportes: [] },
    });
    assert.ok(html.includes('VISTA PREVIA NO EMITIDA'));
    assert.ok(html.includes('SIN CONGELAR'));
});

test('CIE-01A.4: Constancia sin movimientos renderiza estado vacío limpio y total $0', () => {
    const html = buildConstanciaPrintHtml({
        periodo: '2026-11',
        numeroConstancia: 'CIE-2026-0002',
        fechaGeneracion: '2026-11-20T12:00:00Z',
        hashSha256: 'def456',
        estado: 'emitido',
        isEmitted: true,
        datos: { socio: { nombre: 'Sin', apellido: 'Movimientos' }, dispensas: [], aportes: [] },
    });
    assert.ok(html.includes('No se registraron dispensas en este período.'));
    assert.ok(html.includes('No se registraron aportes económicos en este período.'));
    assert.ok(html.includes('Total Aportado: $0'));
});

test('CIE-01A.5: Documento multipágina e importes negativos formateados correctamente', () => {
    const dispensas = Array.from({ length: 35 }, (_, i) => ({
        pedidoId: `ped-${String(i).padStart(5, '0')}`,
        fecha: '2026-11-10T10:00:00Z',
        items: [{ cantidad: 1, productoNombre: `Variedad ${i + 1}` }],
    }));
    const aportes = [
        { fecha: '2026-11-10', concepto: 'Aporte inicial', medioDePago: 'efectivo', monto: 20000 },
        { fecha: '2026-11-11', concepto: 'Reversión parcial', medioDePago: 'efectivo', monto: -5000 },
    ];
    const html = buildConstanciaPrintHtml({
        periodo: '2026-11',
        numeroConstancia: 'CIE-2026-0003',
        fechaGeneracion: '2026-11-20T12:00:00Z',
        hashSha256: 'ghi789',
        estado: 'emitido',
        isEmitted: true,
        datos: { socio: { nombre: 'Multi', apellido: 'Página' }, dispensas, aportes },
    });
    assert.ok(html.includes('display: table-header-group'));
    assert.ok(html.includes('Variedad 35'));
    assert.ok(html.includes('-$5.000'));
    assert.ok(html.includes('Total Aportado: $15.000'));
});

test('CIE-01A.6: Escapa payloads HTML/XSS y pagos/page.tsx no anida impresión en .no-print', () => {
    const html = buildConstanciaPrintHtml({
        periodo: '2026-11',
        numeroConstancia: 'CIE-XSS',
        fechaGeneracion: '2026-11-20T12:00:00Z',
        hashSha256: 'xyz',
        estado: 'anulado',
        isEmitted: true,
        motivoAnulacion: '<script>alert(1)</script>',
        fechaAnulacion: '2026-11-20T12:05:00Z',
        datos: { socio: { nombre: '<b>Test</b>', apellido: 'User' }, dispensas: [], aportes: [] },
    });
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('DOCUMENTO ANULADO'));

    const pagosSrc = fs.readFileSync(path.resolve(__dirname, '../app/(dashboard)/admin/pagos/page.tsx'), 'utf8');
    assert.equal(pagosSrc.includes('no-print'), false);
    assert.equal(pagosSrc.includes('cierre-printable-area'), false);
});

console.log(`=== CIE-01A SUITE COMPLETE: ${passed}/${passed} PASS ===`);
