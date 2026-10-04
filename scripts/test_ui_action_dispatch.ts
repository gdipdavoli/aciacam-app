import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { executeOnboardingAction } from '../app/lib/inbox-client';

let testCount = 0;
let passCount = 0;

async function runTestCase(name: string, fn: () => Promise<void> | void) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log('[PASS] ' + name);
  } catch (err: unknown) {
    console.error('[FAIl] ' + name + ':', err);
  }
}

async function main() {
  const appDir = process.cwd();

  // 1. Verificar que page.tsx contiene handler dedicado para actionType === 'apply'
  await runTestCase('01. page.tsx contiene handler dedicado para apply', () => {
    const pagePath = path.join(appDir, 'app', '(dashboard)', 'admin', 'inbox', 'page.tsx');
    assert.strictEqual(fs.existsSync(pagePath), true);
    const code = fs.readFileSync(pagePath, 'utf-8');
    assert.strictEqual(code.includes("if (actionType === 'apply')"), true);
    assert.strictEqual(code.includes("executeOnboardingAction(targetItem.source_id, 'apply', '')"), true);
  });

  // 2. Verificar que InboxDetailDrawer conecta onApply
  await runTestCase('02. InboxDetailDrawer componente conecta onApply a callback onRequestAction', () => {
    const drawerPath = path.join(appDir, 'app', 'components', 'admin', 'inbox', 'InboxDetailDrawer.tsx');
    const code = fs.readFileSync(drawerPath, 'utf-8');
    assert.strictEqual(code.includes("onRequestAction('apply', item, detail)"), true);
  });

  // 3. Ejerciciar executeOnboardingAction con action = 'apply'
  await runTestCase('03. executeOnboardingAction(b6efd5a7-..., apply) despacha exactamente un POST', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody = '';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      callCount++;
      capturedUrl = String(input);
      capturedMethod = init?.method || 'GET';
      capturedBody = String(init?.body || '');
      return new Response(
        JSON.stringify({
          proposal_id: 'b6efd5a7-e8a7-4d1b-998e-1f60cad093ed',
          application_id: '04fa3b7c-4c95-4da7-a9ed-5f2bcf4fccf6',
          socio_id: 'e56d5f7b-5130-4a27-8380-46ae93485a31',
          application_status: 'READY_FOR_INVITATION',
          materialized: true,
          idempotent: false,
          promoted_document_count: 2,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;

    try {
      const res: any = await executeOnboardingAction(
        'b6efd5a7-e8a7-4d1b-998e-1f60cad093ed',
        'apply',
        '',
        undefined,
        undefined
      );
      assert.strictEqual(callCount, 1);
      assert.strictEqual(capturedUrl, '/api/agent/inbox/onboarding-proposals/b6efd5a7-e8a7-4d1b-998e-1f60cad093ed/apply');
      assert.strictEqual(capturedMethod, 'POST');
      assert.strictEqual(capturedBody, '{}');
      assert.strictEqual(res.application_status, 'READY_FOR_INVITATION');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log('=====================================================================');
  console.log('SUMMARY : TOTAL TESTS: ' + testCount + ' | PASS: ' + passCount + ' | FAIL: ' + (testCount - passCount));
  console.log('=====================================================================');
  if (passCount !== testCount) {
    process.exit(1);
  }
}
main().catch((err) => {
  console.error('Unhandled error in test runner:', err);
  process.exit(1);
});
