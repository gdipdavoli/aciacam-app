import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { formatSocioName, formatDniMasked, formatSocioDisplay, getStatusLabel } from '../app/lib/socio-format';
import { AdminInboxItem, CommunicationIntentInboxDetail } from '../types/inbox';

/**
 * scripts/test_admin_inbox.ts
 *
 * Test suite para verificar el nuevo contrato de Admin Inbox en aciacam-app.
 * Modulo desacoplado, 0 mutaciones en DB.
 */

let testCount = 0;
let passCount = 0;

async function runTestCase(name: string, fn: () => Promise<void> | void) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log('[PASS] ' + name);
  } catch (err: unknown) {
    console.error('[FAIL] ' + name + ':', err);
  }
}

async function main() {
  console.log('======================================================================');
  console.log('ACIACAM Admin Inbox Contract & UX Verification Suite');
  console.log('======================================================================');

  const appDir = path.resolve(__dirname, '..');
  const inboxComponentDir = path.join(appDir, 'app', 'components', 'admin', 'inbox');
  const detailComponentDir = path.join(inboxComponentDir, 'details');

  // 1. Verificar existencia de los componentes principales
  await runTestCase('01. Inbox components exist', () => {
    assert.strictEqual(fs.existsSync(path.join(inboxComponentDir, 'InboxItemCard.tsx')), true);
    assert.strictEqual(fs.existsSync(path.join(inboxComponentDir, 'InboxDetailDrawer.tsx')), true);
    assert.strictEqual(fs.existsSync(path.join(inboxComponentDir, 'SocioDetailSection.tsx')), true);
    assert.strictEqual(fs.existsSync(path.join(detailComponentDir, 'CommunicationIntentDetail.tsx')), true);
  });

  // 2. Socio completo y formateo de DNI enmascarado
  await runTestCase('02. Formateo de socio completo (Nombre Apellido · DNI ••••1234)', () => {
    const socio = {
      id: 'socio-uuid-123',
      nombre: 'Carlos',
      apellido: 'Gómez',
      dni_masked: '••••5678',
    };
    assert.strictEqual(formatSocioName(socio), 'Carlos Gómez');
    assert.strictEqual(formatDniMasked(socio.dni_masked), 'DNI ••••5678');
    assert.strictEqual(formatSocioDisplay(socio), 'Carlos Gómez · DNI ••••5678');
  });

  // 3. Socio con datos parciales
  await runTestCase('03. Degradación elegante con datos parciales de socio', () => {
    const soloNombre = { id: 's1', nombre: 'María', apellido: '', dni_masked: '••••1111' };
    assert.strictEqual(formatSocioDisplay(soloNombre), 'María · DNI ••••1111');

    const soloApellido = { id: 's2', nombre: null, apellido: 'Fernández', dni_masked: '••••2222' };
    assert.strictEqual(formatSocioDisplay(soloApellido), 'Fernández · DNI ••••2222');

    const soloDni = { id: 's3', nombre: null, apellido: null, dni_masked: '••••3333' };
    assert.strictEqual(formatSocioDisplay(soloDni), 'DNI ••••3333');

    const dniConPrefijo = { id: 's4', nombre: 'Ana', apellido: 'López', dni_masked: 'DNI ••••4444' };
    assert.strictEqual(formatSocioDisplay(dniConPrefijo), 'Ana López · DNI ••••4444');
  });

  // 4. Item sin socio
  await runTestCase('04. Manejo elegante de item sin socio (socio: null)', () => {
    assert.strictEqual(formatSocioName(null), '');
    assert.strictEqual(formatDniMasked(null), '');
    assert.strictEqual(formatSocioDisplay(null), null);
    assert.strictEqual(formatSocioDisplay(undefined), null);
  });

  // 5. Mapeo de estados en español sin alterar valores canónicos
  await runTestCase('05. Etiquetas de estados canónicos en español', () => {
    assert.strictEqual(getStatusLabel('AWAITING_APPROVAL'), 'Pendiente de aprobación');
    assert.strictEqual(getStatusLabel('PENDING'), 'Pendiente de aprobación');
    assert.strictEqual(getStatusLabel('APPROVED'), 'Aprobada');
    assert.strictEqual(getStatusLabel('DELIVERING'), 'Enviando');
    assert.strictEqual(getStatusLabel('SENT'), 'Enviada');
    assert.strictEqual(getStatusLabel('FAILED'), 'Falló el envío');
    assert.strictEqual(getStatusLabel('IN_REVIEW'), 'En revisión');
  });

  // 6. Socio visible en InboxItemCard y no usar UUID como identidad principal
  await runTestCase('06. InboxItemCard incluye el socio formateado y oculta UUID principal', () => {
    const cardCode = fs.readFileSync(path.join(inboxComponentDir, 'InboxItemCard.tsx'), 'utf-8');
    assert.strictEqual(cardCode.includes('formatSocioDisplay(item.socio)'), true);
    assert.strictEqual(cardCode.includes('<span>{socioDisplay}</span>'), true);
  });

  // 7. Socio visible en Drawer
  await runTestCase('07. InboxDetailDrawer incluye sección dedicada SocioDetailSection', () => {
    const drawerCode = fs.readFileSync(path.join(inboxComponentDir, 'InboxDetailDrawer.tsx'), 'utf-8');
    assert.strictEqual(drawerCode.includes('<SocioDetailSection socio={detail.socio || item.socio} />'), true);
  });

  // 8. CommunicationIntent preparada (prepared: true)
  await runTestCase('08. CommunicationIntent preparada muestra COMUNICACIÓN A ENVIAR y autorizar', () => {
    const detailCode = fs.readFileSync(path.join(detailComponentDir, 'CommunicationIntentDetail.tsx'), 'utf-8');
    assert.strictEqual(detailCode.includes('isPrepared = detail.prepared === true'), true);
    assert.strictEqual(detailCode.includes('Comunicación a enviar'), true);
    assert.strictEqual(detailCode.includes('Destinatario'), true);
    assert.strictEqual(detailCode.includes('Asunto'), true);
    assert.strictEqual(detailCode.includes('Mensaje Completo'), true);
    assert.strictEqual(detailCode.includes('Autorizar / Aprobar'), true);
  });

  // 9. CommunicationIntent legacy (prepared: false) - Fail Closed en UI
  await runTestCase('9. CommunicationIntent legacy no permite aprobación en UI (fail-closed)', () => {
    const detailCode = fs.readFileSync(path.join(detailComponentDir, 'CommunicationIntentDetail.tsx'), 'utf-8');
    assert.strictEqual(detailCode.includes('Comunicación histórica sin contenido preparado'), true);
    assert.strictEqual(detailCode.includes('Esta intención no contiene un mensaje preparado y no puede autorizarse para envío.'), true);
    assert.strictEqual(detailCode.includes('disabled'), true);
    assert.strictEqual(detailCode.includes('No disponible para envío'), true);
  });

  // 10. Mensaje largo con scroll y break-words en drawer
  await runTestCase('10. Mensaje largo estructurado con max-h-64 overflow-y-auto y whitespace-pre-wrap', () => {
    const detailCode = fs.readFileSync(path.join(detailComponentDir, 'CommunicationIntentDetail.tsx'), 'utf-8');
    assert.strictEqual(detailCode.includes('max-h-64 overflow-y-auto'), true);
    assert.strictEqual(detailCode.includes('whitespace-pre-wrap'), true);
    assert.strictEqual(detailCode.includes('break-words'), true);
  });

  console.log('======================================================================');
  console.log('SUMMARY: TOTAL TESTS: ' + testCount + ' | PASS: ' + passCount + ' | FAIL: ' + (testCount - passCount));
  console.log('======================================================================');

  if (passCount !== testCount) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled error in test runner:', err);
  process.exit(1);
});
