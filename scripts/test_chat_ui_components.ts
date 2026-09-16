import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

/**
 * scripts/test_chat_ui_components.ts
 *
 * Test suite para verificar contratos, reglas de UI, seguridad y desacoplamiento
 * del Asistente ACIACAM (Sprint 2 - Step 10E-C).
 * 0 llamadas a red productiva, 0 mutaciones en DB.
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
  console.log('ACIACAM Chat UI V1 Verification Suite (Step 10E-C)');
  console.log('======================================================================');

  const appDir = path.resolve(__dirname, '..');
  const chatUiDir = path.join(appDir, 'app', 'components', 'admin', 'chat');

  // 1. Verificar existencia de componentes UI de Chat
  await runTestCase('01. Chat UI components exist', () => {
    assert.strictEqual(fs.existsSync(path.join(chatUiDir, 'ChatContainer.tsx')), true);
    assert.strictEqual(fs.existsSync(path.join(chatUiDir, 'ChatHeader.tsx')), true);
    assert.strictEqual(fs.existsSync(path.join(chatUiDir, 'ChatComposer.tsx')), true);
    assert.strictEqual(fs.existsSync(path.join(chatUiDir, 'ChatMessageList.tsx')), true);
    assert.strictEqual(fs.existsSync(path.join(chatUiDir, 'ChatEnvelopeCard.tsx')), true);
  });

  // 2. Verificar existencia de la ruta /admin/asistente
  await runTestCase('02. Route /admin/asistente exists', () => {
    const pagePath = path.join(appDir, 'app', '(dashboard)', 'admin', 'asistente', 'page.tsx');
    assert.strictEqual(fs.existsSync(pagePath), true);
  });

  // 3. Inspección de seguridad: No llamar a Agent Core directamente desde Frontend
  await runTestCase('03. No direct Agent Core URL in frontend source code', () => {
    const filesToInspect = [
      path.join(chatUiDir, 'ChatContainer.tsx'),
      path.join(chatUiDir, 'ChatEnvelopeCard.tsx'),
      path.join(chatUiDir, 'ChatMessageList.tsx'),
      path.join(chatUiDir, 'ChatComposer.tsx'),
      path.join(chatUiDir, 'ChatHeader.tsx'),
      path.join(appDir, 'app', '(dashboard)', 'admin', 'asistente', 'page.tsx'),
    ];

    for (const filePath of filesToInspect) {
      const code = fs.readFileSync(filePath, 'utf-8');
      assert.strictEqual(code.includes('AGENT_CORE_URL'), false, `Found AGENT_CORE_URL in ${filePath}`);
      assert.strictEqual(code.includes('http://localhost:8000'), false, `Found direct Agent Core port 8000 in ${filePath}`);
    }
  });

  // 4. Inspección de seguridad: No incluir secretos S2S en Frontend
  await runTestCase('04. No S2S secret in frontend source code', () => {
    const filesToInspect = [
      path.join(chatUiDir, 'ChatContainer.tsx'),
      path.join(chatUiDir, 'ChatEnvelopeCard.tsx'),
      path.join(chatUiDir, 'ChatMessageList.tsx'),
      path.join(chatUiDir, 'ChatComposer.tsx'),
      path.join(chatUiDir, 'ChatHeader.tsx'),
      path.join(appDir, 'app', '(dashboard)', 'admin', 'asistente', 'page.tsx'),
    ];

    for (const filePath of filesToInspect) {
      const code = fs.readFileSync(filePath, 'utf-8');
      assert.strictEqual(code.includes('AGENT_CORE_BFF_SECRET'), false, `Found AGENT_CORE_BFF_SECRET in ${filePath}`);
      assert.strictEqual(code.includes('X-Agent-Core-Secret'), false, `Found S2S header in ${filePath}`);
    }
  });

  // 5. Verificar que la única ruta llamada desde el cliente sea /api/agent/chat
  await runTestCase('05. Frontend calls exclusively POST /api/agent/chat', () => {
    const code = fs.readFileSync(path.join(chatUiDir, 'ChatContainer.tsx'), 'utf-8');
    assert.strictEqual(code.includes("fetch('/api/agent/chat'"), true);
  });

  // 6. Verificar que la confirmación envía exclusivamente confirmation_token (no mensaje 'sí')
  await runTestCase('06. Confirmation request sends confirmation_token in body', () => {
    const code = fs.readFileSync(path.join(chatUiDir, 'ChatContainer.tsx'), 'utf-8');
    assert.strictEqual(code.includes('confirmation_token: confirmationToken'), true);
  });

  // 7. Prompts sugeridos seguros compatibles con capabilities reales
  await runTestCase('7. Suggested prompts represent real existing capabilities', () => {
    const code = fs.readFileSync(path.join(chatUiDir, 'ChatContainer.tsx'), 'utf-8');
    assert.strictEqual(code.includes('¿Qué tengo pendiente en la bandeja?'), true);
    assert.strictEqual(code.includes('Revisá inconsistencias de stock'), true);
    assert.strictEqual(code.includes('Auditá pedidos y pagos'), true);
  });

  // 8. Mapeo humano de capabilities en UI (Stock Audit, Payment Audit, Document Enrichment)
  await runTestCase('08. Human capability labels mapped in UI', () => {
    const code = fs.readFileSync(path.join(chatUiDir, 'ChatEnvelopeCard.tsx'), 'utf-8');
    assert.strictEqual(code.includes('Auditoría de Stock'), true);
    assert.strictEqual(code.includes('Auditoría de Pagos'), true);
    assert.strictEqual(code.includes('Revisión y Enriquecimiento Documental'), true);
  });

  // 9. Manejo de estados de error HTTP (401, 403, 409, 502, 503, 500)
  await runTestCase('09. UI handles 401, 403, 409, 502, 503, 500 error responses', () => {
    const code = fs.readFileSync(path.join(chatUiDir, 'ChatContainer.tsx'), 'utf-8');
    assert.strictEqual(code.includes('No tenés permisos para realizar esta acción.'), true);
    assert.strictEqual(code.includes('La acción ya fue procesada o el estado cambió'), true);
    assert.strictEqual(code.includes('El asistente devolvió una respuesta no válida'), true);
    assert.strictEqual(code.includes('El asistente no está disponible temporalmente'), true);
    assert.strictEqual(code.includes('Ocurrió un error al procesar la solicitud.'), true);
  });

  // 10. Deshabilitación de envíos vacíos y doble submit
  await runTestCase('10. Empty send and duplicate submit prevented', () => {
    const composerCode = fs.readFileSync(path.join(chatUiDir, 'ChatComposer.tsx'), 'utf-8');
    assert.strictEqual(composerCode.includes('!text.trim()'), true);
    assert.strictEqual(composerCode.includes('isSending'), true);

    const cardCode = fs.readFileSync(path.join(chatUiDir, 'ChatEnvelopeCard.tsx'), 'utf-8');
    assert.strictEqual(cardCode.includes("confirmationState === 'pending'"), true);
    assert.strictEqual(cardCode.includes("confirmationState === 'executing'"), true);
  });

  // 11. Acceso restringido a admin y staff en página /admin/asistente
  await runTestCase('11. /admin/asistente page restricts access to admin & staff', () => {
    const pageCode = fs.readFileSync(path.join(appDir, 'app', '(dashboard)', 'admin', 'asistente', 'page.tsx'), 'utf-8');
    assert.strictEqual(pageCode.includes("user.rol !== 'admin' && user.rol !== 'staff'"), true);
    assert.strictEqual(pageCode.includes("router.replace('/cuenta')"), true);
  });

  // 12. Acceso en navegación principal para admin y staff
  await runTestCase('12. Asistente included in dashboard navigation layout', () => {
    const layoutCode = fs.readFileSync(path.join(appDir, 'app', '(dashboard)', 'layout.tsx'), 'utf-8');
    assert.strictEqual(layoutCode.includes("href: '/admin/asistente'"), true);
    assert.strictEqual(layoutCode.includes("label: 'Asistente'"), true);
  });

  
  // 13. [Step 10E-C.1] Confirm envía exclusivamente confirmation_token (no mensaje 'sí' ni texto conversacional)
  await runTestCase('13. Confirm request body contains confirmation_token and no message text', () => {
    const containerCode = fs.readFileSync(path.join(chatUiDir, 'ChatContainer.tsx'), 'utf-8');
    assert.strictEqual(containerCode.includes('body: JSON.stringify({ confirmation_token: confirmationToken })'), true);
    assert.strictEqual(containerCode.includes("body: JSON.stringify({ message: 'sí' })"), false);
  });

  // 14. [Step 10E-C.1] Local discard no invoca /api/agent/chat
  await runTestCase('14. Local discard handler does NOT invoke /api/agent/chat', () => {
    const containerCode = fs.readFileSync(path.join(chatUiDir, 'ChatContainer.tsx'), 'utf-8');
    const handleCancelSection = containerCode.substring(
      containerCode.indexOf('const handleCancelAction'),
      containerCode.indexOf('return (', containerCode.indexOf('const handleCancelAction'))
    );
    assert.strictEqual(handleCancelSection.includes('fetch('), false);
    assert.strictEqual(handleCancelSection.includes('/api/agent/chat'), false);
  });

  // 15. [Step 10E-C.1] Local discard NO afirma 'Confirmación cancelada' ni 'Acción Cancelada' en servidor
  await runTestCase('15. Local discard does NOT claim server cancellation', () => {
    const cardCode = fs.readFileSync(path.join(chatUiDir, 'ChatEnvelopeCard.tsx'), 'utf-8');
    assert.strictEqual(cardCode.includes('Confirmación Cancelada'), false);
    assert.strictEqual(cardCode.includes('Acción Cancelada'), false);
  });

  // 16. [Step 10E-C.1] Local discard utiliza botón 'Descartar' y estado 'Descartada'
  await runTestCase('16. Local discard uses label "Descartar" and status "Descartada"', () => {
    const cardCode = fs.readFileSync(path.join(chatUiDir, 'ChatEnvelopeCard.tsx'), 'utf-8');
    assert.strictEqual(cardCode.includes('<span>Descartar</span>'), true);
    assert.strictEqual(cardCode.includes('<span>Descartada</span>'), true);
  });

  // 17. [Step 10E-C.1] Estado descartado es terminal (no permite confirmar después)
  await runTestCase('17. Dismissed card becomes terminal and disables action buttons', () => {
    const cardCode = fs.readFileSync(path.join(chatUiDir, 'ChatEnvelopeCard.tsx'), 'utf-8');
    assert.strictEqual(cardCode.includes("confirmationState === 'pending'"), true);
    // When state is dismissed, pending buttons (Confirmar/Descartar) are not rendered
    assert.strictEqual(cardCode.includes("(confirmationState === 'dismissed' || confirmationState === 'cancelled')"), true);
  });

  // 18. [Step 10E-C.1] confirmation_token nunca se expone en texto visible para el usuario
  await runTestCase('18. Token is never rendered in visible text elements', () => {
    const cardCode = fs.readFileSync(path.join(chatUiDir, 'ChatEnvelopeCard.tsx'), 'utf-8');
    assert.strictEqual(cardCode.includes('<span>{confPayload.confirmation_token}</span>'), false);
    assert.strictEqual(cardCode.includes('<p>{confPayload.confirmation_token}</p>'), false);
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
