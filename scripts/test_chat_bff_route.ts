import { NextRequest } from 'next/server';
import assert from 'node:assert';
import { POST } from '../app/api/agent/chat/route';

/**
 * scripts/test_chat_bff_route.ts
 *
 * Suite de pruebas completas de hardening y contratos del BFF de Chat (Sprint 2 - Step 10E-B.3).
 * Sin any en el código de prueba. 0 llamadas a red productiva, 0 mutaciones en DB.
 */

const originalFetch = global.fetch;

let testCount = 0;
let passCount = 0;

async function runTestCase(name: string, fn: () => Promise<void>) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log('[PASS] ' + name);
  } catch (err: unknown) {
    console.error('[FAIL] ' + name + ':', err);
  }
}

async function runTests() {
  console.log('======================================================================');
  console.log('Next.js Chat BFF Hardening & Contract Validation Tests (Step 10E-B.3)');
  console.log('======================================================================');

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://wfzbkcdmlcrjyrtauccu.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fake-anon-key-12345';
  process.env.AGENT_CORE_URL = 'http://localhost:8000';
  process.env.AGENT_CORE_BFF_SECRET = 'fake-bff-secret-12345';

  const futureExpiresAt = Math.floor(Date.now() / 1000) + 3600;

  function createAuthHeaders(userId = 'auth-user-123') {
    const mockSession = {
      access_token: 'fake-access-token-' + userId,
      refresh_token: 'fake-refresh-token-' + userId,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: futureExpiresAt,
      user: {
        id: userId,
        email: userId + '@test.com',
        aud: 'authenticated',
        role: 'authenticated',
      },
    };
    const sessionJson = JSON.stringify(mockSession);
    const base64url = Buffer.from(sessionJson)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return {
      cookie: 'sb-wfzbkcdmlcrjyrtauccu-auth-token=base64-' + base64url,
    };
  }

  const defaultAuthHeaders = createAuthHeaders('auth-user-123');

  const validEnvelope = {
    request_id: '11111111-1111-1111-1111-111111111111',
    intent: 'QUERY_INBOX',
    payload: {
      items: [{ id: 'item-1', title: 'Test Inbox Item' }],
      total_count: 1,
    },
    human_message: 'Se encontraron 1 ítems en Admin Inbox',
    requires_confirmation: false,
    requires_clarification: false,
  };

  function setupMockFetch(options?: {
    userId?: string;
    userEmail?: string;
    socios?: Array<{ id: string; rol: string }>;
    chatStatus?: number;
    chatBody?: unknown;
    chatHandler?: (url: string) => Response;
    onSociosQuery?: (url: string) => void;
  }) {
    const userId = options?.userId ?? 'auth-user-123';
    const userEmail = options?.userEmail ?? (userId + '@test.com');
    const sociosList = options?.socios ?? [{ id: 'socio-123', rol: 'socio' }];

    global.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: userId, email: userEmail }), { status: 200 });
      }
      if (u.includes('/rest/v1/socios')) {
        if (options?.onSociosQuery) {
          options.onSociosQuery(u);
        }
        return new Response(JSON.stringify(sociosList), { status: 200 });
      }
      if (u.includes('/api/v1/chat/message')) {
        if (options?.chatHandler) {
          return options.chatHandler(u);
        }
        const status = options?.chatStatus ?? 200;
        const body = options?.chatBody ?? validEnvelope;
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        return new Response(bodyStr, { status });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof global.fetch;
  }

  // -------------------------------------------------------------------------
  // 1. PRUEBAS DE AUTENTICACIÓN Y ROLES CANÓNICOS (1 - 5)
  // -------------------------------------------------------------------------

  await runTestCase('01. Unauthenticated request returns 401', async () => {
    setupMockFetch();
    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'Hola' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 401);
  });

  await runTestCase('02. Canonical admin session succeeds via auth_user_id', async () => {
    let queriedFilter = '';
    const adminHeaders = createAuthHeaders('auth-user-admin');
    setupMockFetch({
      userId: 'auth-user-admin',
      userEmail: 'admin@test.com',
      socios: [{ id: 'socio-admin', rol: 'admin' }],
      onSociosQuery: (u) => { queriedFilter = u; },
    });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ message: 'Consulta admin' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(queriedFilter.includes('auth_user_id=eq.'), true);
    assert.strictEqual(queriedFilter.includes('or='), false);
  });

  await runTestCase('03. Canonical staff session succeeds', async () => {
    const staffHeaders = createAuthHeaders('auth-user-staff');
    setupMockFetch({
      userId: 'auth-user-staff',
      userEmail: 'staff@test.com',
      socios: [{ id: 'socio-staff', rol: 'staff' }],
    });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: staffHeaders,
      body: JSON.stringify({ message: 'Consulta staff' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
  });

  await runTestCase('04. Canonical socio session succeeds', async () => {
    setupMockFetch({
      userId: 'auth-user-123',
      socios: [{ id: 'socio-123', rol: 'socio' }],
    });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Consulta socio' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
  });

  await runTestCase('05. Invalid role in DB returns 403 without echoing raw role', async () => {
    const hackerHeaders = createAuthHeaders('auth-user-hacker');
    setupMockFetch({
      userId: 'auth-user-hacker',
      socios: [{ id: 'socio-hacker', rol: 'SUPER_SECRET_HACKER_ROLE' }],
    });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: hackerHeaders,
      body: JSON.stringify({ message: 'Consulta' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 403);
    const json = (await res.json()) as { error: string };
    assert.strictEqual(json.error, 'El usuario autenticado no posee un rol habilitado para el asistente');
    assert.strictEqual(JSON.stringify(json).includes('SUPER_SECRET_HACKER_ROLE'), false);
  });

  // -------------------------------------------------------------------------
  // 2. PRUEBAS DE SEGURIDAD DE BODY E INYECCIÓN DE AUTORIDAD (06 - 08)
  // -------------------------------------------------------------------------

  await runTestCase('06. Body attempting role injection returns 400 Bad Request', async () => {
    setupMockFetch();
    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Hola', role: 'admin' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await runTestCase('07. Body attempting actor_id injection returns 400 Bad Request', async () => {
    setupMockFetch();
    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Hola', actor_id: 'hacked-actor-id' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await runTestCase('08. Body attempting socio_id injection returns 400 Bad Request', async () => {
    setupMockFetch();
    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Hola', socio_id: 'hacked-socio-id' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  // -------------------------------------------------------------------------
  // 3. DISCRIMINACIÓN ESTRUCTURAL ESTRICTA EN HTTP 200 Y FLAGS (09 - 14)
  // -------------------------------------------------------------------------

  await runTestCase('09. Valid HTTP 200 QUERY_INBOX response passes structurally', async () => {
    setupMockFetch({ chatStatus: 200, chatBody: validEnvelope });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Consulta' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
  });

  await runTestCase('10. HTTP 200 QUERY_INBOX with ErrorPayload is REJECTED (502)', async () => {
    const errorPayloadEnvelope = {
      ...validEnvelope,
      intent: 'QUERY_INBOX',
      payload: {
        error_code: 'FAKE_ERROR',
        message: 'fake error message',
      },
    };
    setupMockFetch({ chatStatus: 200, chatBody: errorPayloadEnvelope });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Consulta' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 502);
  });

  await runTestCase('11. requires_confirmation=true with valid ConfirmationRequiredPayload passes', async () => {
    const validConfEnvelope = {
      request_id: '11111111-1111-1111-1111-111111111111',
      intent: 'PREPARE_INBOX_ACTION',
      payload: {
        confirmation_token: 'conf-token-12345678',
        action_summary: 'Resolviendo hallazgo de auditoría',
        human_target_description: 'Socio Juan Pérez',
        expires_at: '2026-09-14T12:00:00Z',
        risk_level: 'LEVEL_3_SENSITIVE_MUTATION',
      },
      human_message: 'Requiere confirmación',
      requires_confirmation: true,
      requires_clarification: false,
    };
    setupMockFetch({ chatStatus: 200, chatBody: validConfEnvelope });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Aprobar' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
  });

  await runTestCase('12. requires_confirmation=true with ErrorPayload is REJECTED (502)', async () => {
    const invalidConfEnvelope = {
      request_id: '11111111-1111-1111-1111-111111111111',
      intent: 'PREPARE_INBOX_ACTION',
      payload: {
        error_code: 'CONFIRMATION_REQUIRED',
        message: 'Acción requiere confirmación',
      },
      human_message: 'Requiere confirmación',
      requires_confirmation: true,
      requires_clarification: false,
    };
    setupMockFetch({ chatStatus: 200, chatBody: invalidConfEnvelope });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Aprobar' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 502);
  });

  await runTestCase('13. requires_clarification=true with valid ClarificationRequiredPayload passes', async () => {
    const validClarifEnvelope = {
      request_id: '11111111-1111-1111-1111-111111111111',
      intent: 'UNKNOWN',
      payload: {
        clarification_question: '¿Desea consultar pedidos o socios?',
        suggested_options: ['Pedidos', 'Socios'],
      },
      human_message: '¿Desea consultar pedidos o socios?',
      requires_confirmation: false,
      requires_clarification: true,
    };
    setupMockFetch({ chatStatus: 200, chatBody: validClarifEnvelope });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Consulta' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
  });

  await runTestCase('14. Contradictory flags (requires_confirmation=true & requires_clarification=true) REJECTED (502)', async () => {
    const contradictoryEnvelope = {
      ...validEnvelope,
      requires_confirmation: true,
      requires_clarification: true,
    };
    setupMockFetch({ chatStatus: 200, chatBody: contradictoryEnvelope });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Consulta' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 502);
  });

  // -------------------------------------------------------------------------
  // 4. MODELO DE SEGURIDAD DE ERRORES UPSTREAM ALLOWLIST (15 - 19)
  // -------------------------------------------------------------------------

  await runTestCase('15. Valid physical Agent Core error envelope (ChatResponseEnvelope + ChatErrorPayload) maps correctly', async () => {
    const validErrorEnvelope = {
      request_id: '11111111-1111-1111-1111-111111111111',
      intent: 'UNKNOWN',
      payload: {
        error_code: 'CONFIRMATION_EXPIRED',
        message: 'La sesión de confirmación ha expirado.',
      },
      human_message: 'La sesión de confirmación ha expirado.',
      requires_confirmation: false,
      requires_clarification: false,
    };
    setupMockFetch({ chatStatus: 400, chatBody: validErrorEnvelope });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ confirmation_token: 'expired-token-12345' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    const json = (await res.json()) as typeof validErrorEnvelope;
    assert.strictEqual(json.payload.error_code, 'CONFIRMATION_EXPIRED');
  });

  await runTestCase('16. 500 error containing secret inside message does NOT leak secret (502 sanitized)', async () => {
    const secretInMessageError = {
      error_code: 'INTERNAL',
      message: 'postgresql://admin:SUPER_SECRET_PASSWORD@db.internal/prod',
    };
    setupMockFetch({ chatStatus: 500, chatBody: secretInMessageError });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Consulta' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 502);
    const json = (await res.json()) as { error: string };
    assert.strictEqual(json.error, 'Respuesta inválida del servicio de asistencia');
    assert.strictEqual(JSON.stringify(json).includes('SUPER_SECRET_PASSWORD'), false);
  });

  await runTestCase('17. Arbitrary 500 JSON object fails closed (502 sanitized)', async () => {
    const arbitraryObj = {
      detail: 'Internal server error details',
      stack: 'Exception at line 42',
    };
    setupMockFetch({ chatStatus: 500, chatBody: arbitraryObj });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Consulta' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 502);
    const json = (await res.json()) as { error: string };
    assert.strictEqual(json.error, 'Respuesta inválida del servicio de asistencia');
  });

  await runTestCase('18. Network failure to Agent Core returns 503 sanitized', async () => {
    setupMockFetch({
      chatHandler: () => {
        throw new Error('Fatal: Connection failed to postgresql://admin:secret@db.internal:5432/prod');
      },
    });

    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Consulta' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 503);
    const json = (await res.json()) as { error: string };
    assert.strictEqual(json.error, 'El servicio de asistencia no está disponible temporalmente');
    assert.strictEqual(JSON.stringify(json).includes('postgresql'), false);
    assert.strictEqual(JSON.stringify(json).includes('secret'), false);
  });

  await runTestCase('19. Uncaught unexpected runtime exception returns 500 sanitized', async () => {
    setupMockFetch();
    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: defaultAuthHeaders,
      body: JSON.stringify({ message: 'Consulta' }),
    });
    const throwingBody: Record<string, unknown> = {};
    Object.defineProperty(throwingBody, 'message', {
      get() {
        throw new Error('Uncaught runtime failure: postgresql://admin:secret@db.internal:5432/prod');
      },
    });
    req.json = async () => throwingBody;

    const res = await POST(req);
    assert.strictEqual(res.status, 500);
    const json = (await res.json()) as { error: string };
    assert.strictEqual(json.error, 'Error interno en el servidor BFF');
    assert.strictEqual(JSON.stringify(json).includes('postgresql'), false);
    assert.strictEqual(JSON.stringify(json).includes('secret'), false);
  });

  global.fetch = originalFetch;

  console.log('======================================================================');
  console.log('SUMMARY: TOTAL TESTS: ' + testCount + ' | PASS: ' + passCount + ' | FAIL: ' + (testCount - passCount));
  console.log('======================================================================');

  if (passCount !== testCount) {
    process.exit(1);
  }
}

runTests().catch((err: unknown) => {
  console.error('Unhandled error in test runner:', err);
  process.exit(1);
});
