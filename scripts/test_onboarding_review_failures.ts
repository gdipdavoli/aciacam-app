import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { proxyAgentCoreResponse } from '../app/lib/agent/agent-core-response';

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

  await runTestCase('01. upstream 500 JSON preserva status y payload', async () => {
    const upstream = new Response(JSON.stringify({ detail: 'RPC failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
    const response = await proxyAgentCoreResponse(upstream);
    const body = await readJson(response);
    assert.strictEqual(response.status, 500);
    assert.strictEqual(body.detail, 'RPC failed');
  });

  await runTestCase('02. upstream 500 text/plain no filtra SyntaxError', async () => {
    const upstream = new Response('Internal Server Error', {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    });
    const response = await proxyAgentCoreResponse(upstream);
    const body = await readJson(response);
    assert.strictEqual(response.status, 500);
    assert.strictEqual(body.error, 'Internal Server Error');
    assert.strictEqual(String(body.error).includes('Unexpected token'), false);
  });

  await runTestCase('03. upstream 401 text/plain preserva status', async () => {
    const upstream = new Response('Servicio no autenticado.', {
      status: 401,
      headers: { 'content-type': 'text/plain' },
    });
    const response = await proxyAgentCoreResponse(upstream);
    const body = await readJson(response);
    assert.strictEqual(response.status, 401);
    assert.strictEqual(body.error, 'Servicio no autenticado.');
  });

  await runTestCase('04. upstream malformed JSON queda controlado', async () => {
    const upstream = new Response('{"broken":', {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
    const response = await proxyAgentCoreResponse(upstream);
    const body = await readJson(response);
    assert.strictEqual(response.status, 500);
    assert.strictEqual(body.error, 'Agent Core devolvió una respuesta JSON inválida.');
    assert.strictEqual(String(body.detail).includes('Unexpected'), true);
  });

  await runTestCase('05. upstream 200 JSON exitoso pasa intacto', async () => {
    const upstream = new Response(JSON.stringify({ status: 'APPROVED' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const response = await proxyAgentCoreResponse(upstream);
    const body = await readJson(response);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.status, 'APPROVED');
  });

  await runTestCase('06. rutas onboarding no usan agentCoreResponse.json directo', () => {
    const approveRoute = fs.readFileSync(
      path.join(appDir, 'app', 'api', 'agent', 'inbox', 'onboarding-proposals', '[id]', 'approve', 'route.ts'),
      'utf-8'
    );
    const rejectRoute = fs.readFileSync(
      path.join(appDir, 'app', 'api', 'agent', 'inbox', 'onboarding-proposals', '[id]', 'reject', 'route.ts'),
      'utf-8'
    );
    assert.strictEqual(approveRoute.includes('proxyAgentCoreResponse(agentCoreResponse)'), true);
    assert.strictEqual(rejectRoute.includes('proxyAgentCoreResponse(agentCoreResponse)'), true);
    assert.strictEqual(approveRoute.includes('agentCoreResponse.json()'), false);
    assert.strictEqual(rejectRoute.includes('agentCoreResponse.json()'), false);
  });

  await runTestCase('07. failed APPROVE no cierra ni refresca como éxito fuera de 409', () => {
    const pageCode = fs.readFileSync(
      path.join(appDir, 'app', '(dashboard)', 'admin', 'inbox', 'page.tsx'),
      'utf-8'
    );
    const handlerStart = pageCode.indexOf('const handleConfirmAction = async');
    assert.strictEqual(handlerStart >= 0, true);
    const handlerCode = pageCode.slice(handlerStart, pageCode.indexOf('  if (authLoading)', handlerStart));
    const catchBlock = handlerCode.slice(handlerCode.indexOf('} catch (err: unknown)'));
    assert.strictEqual(catchBlock.includes("apiErr?.status === 409"), true);
    assert.strictEqual(catchBlock.includes("toast.success('Propuesta de onboarding aprobada"), false);
    assert.strictEqual(catchBlock.includes("toast.success('Propuesta de onboarding rechazada"), false);
  });

  await runTestCase('08. inbox-client no usa res.json en errores', () => {
    const clientCode = fs.readFileSync(path.join(appDir, 'app', 'lib', 'inbox-client.ts'), 'utf-8');
    assert.strictEqual(clientCode.includes('await res.text()'), true);
    assert.strictEqual(clientCode.includes('await res.json()'), false);
    assert.strictEqual(clientCode.includes('new InboxApiError'), true);
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
