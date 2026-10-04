import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { proxyAgentCoreResponse } from '../app/lib/agent/agent-core-response';
import { applyOnboardingProposal } from '../app/lib/inbox-client';

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

async function readJson(response: Response): Promise<any> {
  return response.json();
}

async function main() {
  const appDir = process.cwd();

  // 1. Verificar estructura y contrato de la ruta BFF de apply
  await runTestCase('01. apply route existe y esta configurado correctamente', () => {
    const applyRoutePath = path.join(
      appDir,
      'app',
      'api',
      'agent',
      'inbox',
      'onboarding-proposals',
      '[id]',
      'apply',
      'route.ts'
    );
    assert.strictEqual(fs.existsSync(applyRoutePath), true);
    const code = fs.readFileSync(applyRoutePath, 'utf-8');

    assert.strictEqual(code.includes("getDelegatedBffContext(request, ['admin'])"), true);
    assert.strictEqual(code.includes('/api/v1/inbox/onboarding-proposals/'), true);
    assert.strictEqual(code.includes('/apply'), true);
    assert.strictEqual(code.includes('proxyAgentCoreResponse(agentCoreResponse)'), true);
    assert.strictEqual(code.includes('body: JSON.stringify({})'), true);
  });

  // 2. Simulacion de respuestas upstream del Core en proxyAgentCoreResponse
  await runTestCase('02. proxyAgentCoreResponse maneja upstream 200 JSON', async () => {
    const upstreamBody = {
      proposal_id: 'b6efd5a7-e8a7-4d1b-998e-1f60cad093ed',
      application_id: '04fa3b7c-4c95-4da7-a9ed-5f2bcf4fccf6',
      socio_id: 'e56d5f7b-5130-4a27-8380-46ae93485a31',
      application_status: 'READY_FOR_INVITATION',
      materialized: true,
      idempotent: false,
      promoted_document_count: 2,
    };
    const upstream = new Response(JSON.stringify(upstreamBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const res = await proxyAgentCoreResponse(upstream);
    const body = await readJson(res);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.application_status, 'READY_FOR_INVITATION');
    assert.strictEqual(body.materialized, true);
    assert.strictEqual(body.promoted_document_count, 2);
  });

  await runTestCase('03. proxyAgentCoreResponse maneja upstream 400 JSON', async () => {
    const upstream = new Response(JSON.stringify({ detail: 'Peticion invalida' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
    const res = await proxyAgentCoreResponse(upstream);
    const body = await readJson(res);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.detail, 'Peticion invalida');
  });

  await runTestCase('04. proxyAgentCoreResponse maneja upstream 401 JSON', async () => {
    const upstream = new Response(JSON.stringify({ detail: 'Servicio no autenticado.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
    const res = await proxyAgentCoreResponse(upstream);
    const body = await readJson(res);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(body.detail, 'Servicio no autenticado.');
  });

  await runTestCase('05. proxyAgentCoreResponse maneja upstream 403 JSON', async () => {
    const upstream = new Response(JSON.stringify({ detail: 'Rol no autorizado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
    const res = await proxyAgentCoreResponse(upstream);
    const body = await readJson(res);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.detail, 'Rol no autorizado');
  });

  await runTestCase('06. proxyAgentCoreResponse maneja upstream 404 JSON', async () => {
    const upstream = new Response(JSON.stringify({ detail: 'Propuesta no encontrada' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
    const res = await proxyAgentCoreResponse(upstream);
    const body = await readJson(res);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(body.detail, 'Propuesta no encontrada');
  });

  await runTestCase('07. proxyAgentCoreResponse maneja upstream 422 JSON', async () => {
    const upstream = new Response(JSON.stringify({ detail: [{ loc: ['body'], msg: 'field required' }] }), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    });
    const res = await proxyAgentCoreResponse(upstream);
    const body = await readJson(res);
    assert.strictEqual(res.status, 422);
    assert.strictEqual(Array.isArray(body.detail), true);
  });

  await runTestCase('08. proxyAgentCoreResponse maneja upstream 500 text/plain (no rompe JSON parser)', async () => {
    const upstream = new Response('Internal Server Error (Database connection failed)', {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    });
    const res = await proxyAgentCoreResponse(upstream);
    const body = await readJson(res);
    assert.strictEqual(res.status, 500);
    assert.strictEqual(body.error, 'Internal Server Error (Database connection failed)');
    assert.strictEqual(body.upstream_status, 500);
  });

  // 3. Client fetch simulation para inbox-client
  await runTestCase('09. applyOnboardingProposal llama a la URL y m&#there;todo correctos', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedMethod = '';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || 'GET';
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
      const res: any = await applyOnboardingProposal('b6efd5a7-e8a7-4d1b-998e-1f60cad093ed');
      assert.strictEqual(capturedUrl, '/api/agent/inbox/onboarding-proposals/b6efd5a7-e8a7-4d1b-998e-1f60cad093ed/apply');
      assert.strictEqual(capturedMethod, 'POST');
      assert.strictEqual(res.application_status, 'READY_FOR_INVITATION');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log('=====================================================================');
  console.log('SUMMARY: TOTAL TESTS: ' + testCount + ' | PASS: ' + passCount + ' | FAIL: ' + (testCount - passCount));
  console.log('=====================================================================');
  if (passCount !== testCount) {
    process.exit(1);
  }
}
main().catch((err) => {
  console.error('Unhandled error in test runner:', err);
  process.exit(1);
});
