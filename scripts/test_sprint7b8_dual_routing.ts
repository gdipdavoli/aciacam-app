import { NextRequest } from 'next/server';
import assert from 'node:assert';
import { POST } from '../app/api/agent/chat/route';
import { POST as postAuditCreateCommIntent } from '../app/api/agent/inbox/audit-findings/[id]/create-communication-intent/route';
import { POST as postAuditDismiss } from '../app/api/agent/inbox/audit-findings/[id]/dismiss/route';
import { POST as postAuditMarkInReview } from '../app/api/agent/inbox/audit-findings/[id]/mark-in-review/route';
import { POST as postAuditResolve } from '../app/api/agent/inbox/audit-findings/[id]/resolve/route';
import { POST as postCommApprove } from '../app/api/agent/inbox/communication-intents/[id]/approve/route';
import { POST as postCommCancel } from '../app/api/agent/inbox/communication-intents/[id]/cancel/route';
import { POST as postProfileApprove } from '../app/api/agent/inbox/profile-proposals/[id]/approve/route';
import { POST as postProfileCancel } from '../app/api/agent/inbox/profile-proposals/[id]/cancel/route';
import { POST as postProfileReject } from '../app/api/agent/inbox/profile-proposals/[id]/reject/route';
import { getDelegatedBffContext } from '../app/lib/agent/bff-auth';

/**
 * scripts/test_sprint7b8_dual_routing.ts
 *
 * Suite de Pruebas Automatizadas de Enrutamiento Dual Seguro (Sprint 7B.8 - Entrega 1B)
 * Valida:
 * 1. Enrutamiento hacia Python para mensajes conversacionales (ChatResponseEnvelope).
 * 2. Enrutamiento hacia TypeScript para propuestas de pedidos (LPCP-v2).
 * 3. Rechazo estricto de payloads ambiguos o malformados (HTTP 400).
 * 4. Seguridad: Sesiones, roles, identidad delegada y anti-spoofing (HTTP 401/403/400).
 * 5. Manejo defensivo de fallos upstream (HTTP 423/502/503).
 * 6. Cero regresiones en resolución de destinos en bff-auth.ts.
 *
 * Cero llamadas de red reales. Cero mutaciones en base de datos.
 */

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function recordTest(id: string, name: string, status: 'PASS' | 'FAIL', detail?: string) {
  totalTests++;
  if (status === 'PASS') {
    passedTests++;
    console.log(`[${status}] ${id}: ${name} ${detail ? '(' + detail + ')' : ''}`);
  } else {
    failedTests++;
    console.error(`[${status}] ${id}: ${name} - ${detail || 'Fallo desconocido'}`);
  }
}

async function runTestSuite() {
  console.log('======================================================================');
  console.log('ACIACAM — SPRINT 7B.8: SUITE DE ENRUTAMIENTO DUAL SEGURO (ENTREGA 1B)');
  console.log('======================================================================');

  // Configuración de entorno de prueba seguro
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://uqwuhjxzazsexuvqxmfm.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key-12345';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWYiOiJ1cXd1aGp4emF6c2V4dXZxeG1mbSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.fake_integration_signature_12345';
  process.env.AGENT_CORE_PYTHON_URL = 'http://localhost:8000';
  process.env.AGENT_CORE_ORDER_WORKER_URL = 'http://localhost:8001';
  process.env.AGENT_CORE_BFF_SECRET = 'e2e_integration_secret_test_12345';
  process.env.AGENT_CORE_ORDER_WORKER_SECRET = 'e2e_worker_order_secret_12345';

  const VALID_USER_ID = '00000000-0000-4000-a000-000000000001';
  const VALID_SOCIO_ID = '00000000-0000-4000-a000-000000000002';
  const VALID_PRODUCT_ID = '00000000-0000-4000-a000-000000000003';

  function createAuthCookie(userId = VALID_USER_ID) {
    const session = {
      access_token: 'mock-access-token-' + userId,
      refresh_token: 'mock-refresh-token-' + userId,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: userId, email: userId + '@test.local', aud: 'authenticated', role: 'authenticated' },
    };
    const b64 = Buffer.from(JSON.stringify(session)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return { cookie: 'sb-uqwuhjxzazsexuvqxmfm-auth-token=base64-' + b64 };
  }

  // Interceptor global de fetch para simular Supabase y Upstreams (Python y TypeScript)
  let lastCapturedUpstreamUrl = '';
  let lastCapturedUpstreamBody: any = null;
  let lastCapturedUpstreamHeaders: Record<string, string> = {};

  let mockPythonResponse: { status: number; body: unknown } = {
    status: 200,
    body: {
      request_id: '11111111-1111-4111-a111-111111111111',
      intent: 'QUERY_INBOX',
      payload: { items: [{ id: 'item-1' }], total_count: 1 },
      human_message: 'Consulta de inbox procesada en Python',
      requires_confirmation: false,
      requires_clarification: false,
    },
  };

  let mockWorkerResponse: { status: number; body: unknown } = {
    status: 200,
    body: {
      success: true,
      reply: 'Propuesta formulada en Worker TS',
      proposal: {
        proposal_id: '22222222-2222-4222-a222-222222222222',
        proposal_payload_hash: 'a'.repeat(64),
        status: 'pending_review',
      },
      correlation_id: 'corr-worker-999',
    },
  };

  let mockSocioDbResult: { id: string; rol: string } | Array<{ id: string; rol: string }> | null = {
    id: VALID_SOCIO_ID,
    rol: 'socio',
  };
  let mockSocioDbError: { status: number; body: unknown } | null = null;
  let lastSociosQueryAuthHeader = '';

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);

    // Mock Supabase Auth
    if (urlStr.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: VALID_USER_ID, email: 'test@socio.local', user: { id: VALID_USER_ID, email: 'test@socio.local' } }), { status: 200 });
    }

    // Mock Supabase Database (public.socios)
    if (urlStr.includes('/rest/v1/socios')) {
      const hdrs = new Headers(init?.headers);
      lastSociosQueryAuthHeader = hdrs.get('Authorization') || hdrs.get('apikey') || '';

      // Simular entorno Supabase Integration donde el rol 'authenticated' (anon key / user token)
      // recibe 42501 permission denied en public.socios y solo service_role tiene permiso SELECT
      if (!lastSociosQueryAuthHeader.includes(process.env.SUPABASE_SERVICE_ROLE_KEY!)) {
        return new Response(
          JSON.stringify({
            code: '42501',
            details: null,
            hint: 'Grant the required privileges to the current role with: GRANT SELECT ON public.socios TO authenticated;',
            message: 'permission denied for table socios',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (mockSocioDbError) {
        return new Response(JSON.stringify(mockSocioDbError.body), {
          status: mockSocioDbError.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!mockSocioDbResult) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const rows = Array.isArray(mockSocioDbResult) ? mockSocioDbResult : [mockSocioDbResult];
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Captura de llamadas a Upstream Agent Core
    lastCapturedUpstreamUrl = urlStr;
    lastCapturedUpstreamHeaders = (init?.headers as Record<string, string>) || {};
    try {
      lastCapturedUpstreamBody = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      lastCapturedUpstreamBody = String(init?.body);
    }

    if (urlStr.startsWith('http://localhost:8001')) {
      // TypeScript Worker
      return new Response(JSON.stringify(mockWorkerResponse.body), {
        status: mockWorkerResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (urlStr.startsWith('http://localhost:8000')) {
      // Python Agent Core
      return new Response(JSON.stringify(mockPythonResponse.body), {
        status: mockPythonResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }) as any;

  function createRequest(body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...createAuthCookie(),
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  // =========================================================================
  // BLOQUE 1: ENRUTAMIENTO HACIA PYTHON (DIÁLOGO CONVERSACIONAL)
  // =========================================================================
  try {
    mockSocioDbResult = { id: VALID_SOCIO_ID, rol: 'socio' };
    const req = createRequest({ message: 'Hola, ¿cómo están mis turnos?' });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(lastCapturedUpstreamUrl, 'http://localhost:8000/api/v1/chat/message');
    assert.strictEqual(lastCapturedUpstreamBody.message, 'Hola, ¿cómo están mis turnos?');
    assert.strictEqual(lastCapturedUpstreamHeaders['X-Agent-Core-Secret'], 'e2e_integration_secret_test_12345');
    assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-Auth-User-Id'], VALID_USER_ID);
    assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-Socio-Id'], VALID_SOCIO_ID);
    assert.strictEqual(data.intent, 'QUERY_INBOX');
    recordTest('TC-01', 'Mensaje conversacional enruta a Python', 'PASS', '200 OK via http://localhost:8000');
  } catch (e: any) {
    recordTest('TC-01', 'Mensaje conversacional enruta a Python', 'FAIL', e.message);
  }

  try {
    const req = createRequest({ confirmation_token: 'token_valido_12345' });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(lastCapturedUpstreamUrl, 'http://localhost:8000/api/v1/chat/message');
    assert.strictEqual(lastCapturedUpstreamBody.confirmation_token, 'token_valido_12345');
    recordTest('TC-02', 'Confirmación conversacional enruta a Python', 'PASS', 'Token reenviado a Python');
  } catch (e: any) {
    recordTest('TC-02', 'Confirmación conversacional enruta a Python', 'FAIL', e.message);
  }

  try {
    mockPythonResponse = { status: 500, body: { detail: 'Database error con secret leaked: e2e_secret' } };
    const req = createRequest({ message: 'Falla simulada' });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 502);
    assert.strictEqual(JSON.stringify(data).includes('e2e_secret'), false, 'No debe filtrar secretos');
    recordTest('TC-03', 'Falla de Python sanitizada en BFF', 'PASS', '502 Bad Gateway sin leaks');
  } catch (e: any) {
    recordTest('TC-03', 'Falla de Python sanitizada en BFF', 'FAIL', e.message);
  } finally {
    mockPythonResponse = {
      status: 200,
      body: {
        request_id: '11111111-1111-4111-a111-111111111111',
        intent: 'QUERY_INBOX',
        payload: { items: [], total_count: 0 },
        human_message: 'Ok',
        requires_confirmation: false,
        requires_clarification: false,
      },
    };
  }

  // =========================================================================
  // BLOQUE 2: ENRUTAMIENTO HACIA TYPESCRIPT (PROPUESTAS DE PEDIDOS)
  // =========================================================================
  try {
    const req = createRequest({
      intent: 'propose_order',
      items: [{ producto_id: VALID_PRODUCT_ID, cantidad: 2 }],
      tipo_pedido: 'retiro_sede',
      motivo: 'Pedido terapéutico de socio',
    });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(lastCapturedUpstreamUrl, 'http://localhost:8001/api/v1/chat/message');
    assert.strictEqual(lastCapturedUpstreamBody.intent, 'propose_order');
    assert.strictEqual(lastCapturedUpstreamHeaders['X-Agent-Core-Secret'], 'e2e_worker_order_secret_12345');
    assert.strictEqual(data.intent, 'PROPOSE_ORDER');
    assert.strictEqual(data.payload.status, 'PROPOSAL_CREATED');
    assert.strictEqual(data.payload.proposal_id, '22222222-2222-4222-a222-222222222222');
    assert.strictEqual(data.requires_confirmation, false);
    assert.strictEqual(data.requires_clarification, false);
    recordTest('TC-04', 'Propuesta de pedido enruta a Worker TypeScript', 'PASS', '200 OK via http://localhost:8001 con ChatResponseEnvelope');
  } catch (e: any) {
    recordTest('TC-04', 'Propuesta de pedido enruta a Worker TypeScript', 'FAIL', e.message);
  }

  try {
    const req = createRequest({
      intent: 'propose_order',
      items: [{ productoId: VALID_PRODUCT_ID, cantidad: 1 }],
      tipo_pedido: 'delivery',
      direccion_entrega: 'Av. Libertador 4500, CABA',
    });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(lastCapturedUpstreamBody.tipo_pedido, 'delivery');
    assert.strictEqual(lastCapturedUpstreamBody.direccion_entrega, 'Av. Libertador 4500, CABA');
    recordTest('TC-05', 'Propuesta con delivery y dirección válida aceptada', 'PASS', 'Delivery validado');
  } catch (e: any) {
    recordTest('TC-05', 'Propuesta con delivery y dirección válida aceptada', 'FAIL', e.message);
  }

  try {
    mockWorkerResponse = {
      status: 423,
      body: {
        error: 'KILLSWITCH_LOCKED_BY_ENVIRONMENT',
        code: 'IMMUTABLE_SUSPENSION_ACTIVE',
        message: 'Servicio suspendido por variable de entorno',
      },
    };
    const req = createRequest({
      intent: 'propose_order',
      items: [{ producto_id: VALID_PRODUCT_ID, cantidad: 1 }],
    });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 423);
    assert.strictEqual(data.code, 'IMMUTABLE_SUSPENSION_ACTIVE');
    recordTest('TC-06', 'Suspensión inmutable de Worker TS preservada en BFF', 'PASS', '423 Locked propagado limpiamente');
  } catch (e: any) {
    recordTest('TC-06', 'Suspensión inmutable de Worker TS preservada en BFF', 'FAIL', e.message);
  } finally {
    mockWorkerResponse = {
      status: 200,
      body: {
        success: true,
        reply: 'Propuesta formulada en Worker TS',
        proposal: {
          proposal_id: '22222222-2222-4222-a222-222222222222',
          proposal_payload_hash: 'a'.repeat(64),
          status: 'pending_review',
        },
        correlation_id: 'corr-worker-999',
      },
    };
  }

  // =========================================================================
  // BLOQUE 3: PAYLOADS AMBIGUOS O MALFORMADOS (RECHAZO EN BFF - HTTP 400)
  // =========================================================================
  try {
    const req = createRequest({
      intent: 'propose_order',
      items: [], // Vacío
    });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400);
    assert(data.error.includes('al menos un ítem'));
    recordTest('TC-07', 'Propuesta con items vacíos rechazada con 400', 'PASS', 'Rechazo inmediato sin llamada upstream');
  } catch (e: any) {
    recordTest('TC-07', 'Propuesta con items vacíos rechazada con 400', 'FAIL', e.message);
  }

  try {
    const req = createRequest({
      intent: 'propose_order',
      items: [{ producto_id: 'no-es-un-uuid', cantidad: 5 }],
    });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400);
    assert(data.error.includes('inválido o malformado'));
    recordTest('TC-08', 'Propuesta con UUID de producto inválido rechazada con 400', 'PASS', 'Validación estricta de UUID');
  } catch (e: any) {
    recordTest('TC-08', 'Propuesta con UUID de producto inválido rechazada con 400', 'FAIL', e.message);
  }

  try {
    const req = createRequest({
      intent: 'propose_order',
      items: [{ producto_id: VALID_PRODUCT_ID, cantidad: 0 }],
    });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400);
    assert(data.error.includes('entero positivo'));
    recordTest('TC-09', 'Propuesta con cantidad cero o negativa rechazada con 400', 'PASS', 'Validación de cantidad');
  } catch (e: any) {
    recordTest('TC-09', 'Propuesta con cantidad cero o negativa rechazada con 400', 'FAIL', e.message);
  }

  try {
    const req = createRequest({
      intent: 'propose_order',
      items: [{ producto_id: VALID_PRODUCT_ID, cantidad: 1 }],
      confirmation_token: 'conf_token_incompatible', // Ambiguo
    });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400);
    assert(data.error.includes('Payload ambiguo'));
    recordTest('TC-10', 'Payload ambiguo (propose_order + confirmation_token) rechazado con 400', 'PASS', 'Prevención de mezcla de intenciones');
  } catch (e: any) {
    recordTest('TC-10', 'Payload ambiguo (propose_order + confirmation_token) rechazado con 400', 'FAIL', e.message);
  }

  try {
    const req = createRequest({
      message: 'Hola',
      items: [{ producto_id: VALID_PRODUCT_ID, cantidad: 1 }], // Items sin declarar intent='propose_order'
    });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400);
    assert(data.error.includes('Payload ambiguo'));
    recordTest('TC-11', 'Payload ambiguo (message + items sin propose_order) rechazado con 400', 'PASS', 'Protección contra 422 de Python');
  } catch (e: any) {
    recordTest('TC-11', 'Payload ambiguo (message + items sin propose_order) rechazado con 400', 'FAIL', e.message);
  }

  try {
    const req = createRequest({
      intent: 'propose_order',
      items: [{ producto_id: VALID_PRODUCT_ID, cantidad: 1 }],
      tipo_pedido: 'delivery',
      // Falta direccion_entrega
    });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400);
    assert(data.error.includes('requieren una dirección de entrega'));
    recordTest('TC-12', 'Delivery sin dirección de entrega rechazado con 400', 'PASS', 'Invariante de entrega a domicilio');
  } catch (e: any) {
    recordTest('TC-12', 'Delivery sin dirección de entrega rechazado con 400', 'FAIL', e.message);
  }

  // =========================================================================
  // BLOQUE 4: SEGURIDAD, ROLES Y SUPLANTACIÓN DE IDENTIDAD (401 / 403 / 400)
  // =========================================================================
  try {
    const req = new NextRequest('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Sin sesión' }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 401);
    recordTest('TC-13', 'Solicitud sin sesión SSR rechazada con 401', 'PASS', 'Autenticación obligatoria');
  } catch (e: any) {
    recordTest('TC-13', 'Solicitud sin sesión SSR rechazada con 401', 'FAIL', e.message);
  }

  try {
    mockSocioDbResult = null; // Sin socio en BD
    const req = createRequest({ message: 'Usuario sin socio' });
    const res = await POST(req);
    assert.strictEqual(res.status, 403);
    recordTest('TC-14', 'Usuario sin socio en base de datos rechazado con 403', 'PASS', 'Resolución de socio requerida');
  } catch (e: any) {
    recordTest('TC-14', 'Usuario sin socio en base de datos rechazado con 403', 'FAIL', e.message);
  } finally {
    mockSocioDbResult = { id: VALID_SOCIO_ID, rol: 'socio' };
  }

  try {
    mockSocioDbResult = { id: VALID_SOCIO_ID, rol: 'invitado_invalido' };
    const req = createRequest({ message: 'Rol inválido' });
    const res = await POST(req);
    assert.strictEqual(res.status, 403);
    recordTest('TC-15', 'Usuario con rol no habilitado rechazado con 403', 'PASS', 'Allowlist de roles respetada');
  } catch (e: any) {
    recordTest('TC-15', 'Usuario con rol no habilitado rechazado con 403', 'FAIL', e.message);
  } finally {
    mockSocioDbResult = { id: VALID_SOCIO_ID, rol: 'socio' };
  }

  try {
    const req = createRequest({
      intent: 'propose_order',
      items: [{ producto_id: VALID_PRODUCT_ID, cantidad: 1 }],
      socio_id: '99999999-9999-9999-9999-999999999999', // Intento de spoofing
    });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400);
    assert(data.error.includes('campos de autoridad (socio_id)'));
    recordTest('TC-16', 'Intento de inyección de socio_id rechazado con 400', 'PASS', 'Anti-spoofing estricto');
  } catch (e: any) {
    recordTest('TC-16', 'Intento de inyección de socio_id rechazado con 400', 'FAIL', e.message);
  }

  try {
    const req = createRequest({
      intent: 'propose_order',
      items: [{ producto_id: VALID_PRODUCT_ID, cantidad: 1 }],
      role: 'admin', // Intento de elevación de privilegios
    });
    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400);
    assert(data.error.includes('campos de autoridad (role)'));
    recordTest('TC-17', 'Intento de inyección de role rechazado con 400', 'PASS', 'Prohibición de elevación de privilegios');
  } catch (e: any) {
    recordTest('TC-17', 'Intento de inyección de role rechazado con 400', 'FAIL', e.message);
  }

  // =========================================================================
  // BLOQUE 5: RESOLUCIÓN EN BFF-AUTH (COMPATIBILIDAD PYTHON Y TS)
  // =========================================================================
  try {
    const fakeReq = new NextRequest('http://localhost:3000/api/agent/inbox', {
      headers: {
        ...createAuthCookie(),
      },
    });

    // Invocación por defecto (Python)
    const pythonResult = await getDelegatedBffContext(fakeReq, ['admin', 'staff', 'socio'], 'python');
    if (!pythonResult.success) {
      const err = await pythonResult.response.json();
      console.error('TC-18 DEBUG:', pythonResult.response.status, err);
    }
    assert.strictEqual(pythonResult.success, true);
    if (pythonResult.success) {
      assert.strictEqual(pythonResult.context.agentCoreBaseUrl, 'http://localhost:8000');
      assert.strictEqual(pythonResult.context.agentCoreBffSecret, 'e2e_integration_secret_test_12345');
      assert.strictEqual(pythonResult.context.targetService, 'python');
    }

    // Invocación explícita (TypeScript)
    const tsResult = await getDelegatedBffContext(fakeReq, ['admin', 'staff', 'socio'], 'typescript');
    assert.strictEqual(tsResult.success, true);
    if (tsResult.success) {
      assert.strictEqual(tsResult.context.agentCoreBaseUrl, 'http://localhost:8001');
      assert.strictEqual(tsResult.context.agentCoreBffSecret, 'e2e_worker_order_secret_12345');
      assert.strictEqual(tsResult.context.targetService, 'typescript');
    }

    recordTest('TC-18', 'Resolución dual en getDelegatedBffContext', 'PASS', 'Python y TypeScript discriminados correctamente');
  } catch (e: any) {
    recordTest('TC-18', 'Resolución dual en getDelegatedBffContext', 'FAIL', e.message);
  }

  // =========================================================================
  // BLOQUE 6: RESOLUCIÓN CANÓNICA DE IDENTIDAD (SOCIO, STAFF, ADMIN, DB ERROR 500, KILLSWITCH 503)
  // =========================================================================
  try {
    mockSocioDbResult = { id: '00000000-0000-4000-a000-000000000010', rol: 'staff' };
    const req = createRequest({
      intent: 'propose_order',
      items: [{ producto_id: VALID_PRODUCT_ID, cantidad: 1 }],
    });
    const res = await POST(req);
    const rawText = await res.text();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-Auth-User-Id'], VALID_USER_ID);
    assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-Socio-Id'], '00000000-0000-4000-a000-000000000010');
    assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-User-Role'], 'staff');
    assert.strictEqual(rawText.includes(process.env.SUPABASE_SERVICE_ROLE_KEY!), false, 'Nunca debe exponer service_role al cliente');
    recordTest('TC-19', 'Rol staff válido resuelve identidad vía service_role y propaga contexto delegado', 'PASS', 'X-Delegated-User-Role=staff');
  } catch (e: any) {
    recordTest('TC-19', 'Rol staff válido resuelve identidad vía service_role y propaga contexto delegado', 'FAIL', e.message);
  } finally {
    mockSocioDbResult = { id: VALID_SOCIO_ID, rol: 'socio' };
  }

  try {
    mockSocioDbResult = { id: '00000000-0000-4000-a000-000000000011', rol: 'admin' };
    const req = createRequest({
      intent: 'propose_order',
      items: [{ producto_id: VALID_PRODUCT_ID, cantidad: 1 }],
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-Auth-User-Id'], VALID_USER_ID);
    assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-Socio-Id'], '00000000-0000-4000-a000-000000000011');
    assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-User-Role'], 'admin');
    recordTest('TC-20', 'Rol admin válido resuelve identidad vía service_role y propaga contexto delegado', 'PASS', 'X-Delegated-User-Role=admin');
  } catch (e: any) {
    recordTest('TC-20', 'Rol admin válido resuelve identidad vía service_role y propaga contexto delegado', 'FAIL', e.message);
  } finally {
    mockSocioDbResult = { id: VALID_SOCIO_ID, rol: 'socio' };
  }

  try {
    mockSocioDbError = {
      status: 500,
      body: { code: 'XX000', message: 'internal postgres failure: secret_conn_string' },
    };
    const req = createRequest({ message: 'Consulta con error de BD' });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 500, 'Error de consulta a BD debe retornar 500 y no confundirse con 403 usuario no vinculado');
    assert.strictEqual(data.error, 'Error al consultar perfil de socio');
    assert.strictEqual(JSON.stringify(data).includes('secret_conn_string'), false, 'No debe filtrar detalle crudo de BD');
    recordTest('TC-21', 'Error interno de consulta a public.socios distinguido como HTTP 500 sanitizado', 'PASS', '500 Error al consultar perfil de socio');
  } catch (e: any) {
    recordTest('TC-21', 'Error interno de consulta a public.socios distinguido como HTTP 500 sanitizado', 'FAIL', e.message);
  } finally {
    mockSocioDbError = null;
  }

  try {
    mockSocioDbResult = [
      { id: VALID_SOCIO_ID, rol: 'socio' },
      { id: '00000000-0000-4000-a000-000000000099', rol: 'socio' },
    ];
    const req = createRequest({ message: 'Consulta con perfiles duplicados' });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert(String(data.error).includes('múltiples registros vinculados'));
    recordTest('TC-22', 'Multiplicidad de perfiles vinculados rechazada fail-closed con 403', 'PASS', '403 Inconsistencia de perfil');
  } catch (e: any) {
    recordTest('TC-22', 'Multiplicidad de perfiles vinculados rechazada fail-closed con 403', 'FAIL', e.message);
  } finally {
    mockSocioDbResult = { id: VALID_SOCIO_ID, rol: 'socio' };
  }

  try {
    mockWorkerResponse = {
      status: 503,
      body: {
        error: 'SERVICE_SUSPENDED',
        code: 'KILLSWITCH_ACTIVE',
        message: 'Mecanismo de seguridad activado: la formulación de nuevas propuestas está suspendida temporalmente.',
        correlation_id: 'req_killswitch_test_503',
      },
    };
    const req = createRequest({
      intent: 'propose_order',
      items: [{ producto_id: VALID_PRODUCT_ID, cantidad: 1 }],
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 503);
    assert.strictEqual(data.code, 'KILLSWITCH_ACTIVE');
    assert.strictEqual(data.correlation_id, 'req_killswitch_test_503');
    recordTest('TC-23', 'Bloqueo de propuestas con kill-switch activo (503 KILLSWITCH_ACTIVE)', 'PASS', '503 KILLSWITCH_ACTIVE propagado con correlation_id');
  } catch (e: any) {
    recordTest('TC-23', 'Bloqueo de propuestas con kill-switch activo (503 KILLSWITCH_ACTIVE)', 'FAIL', e.message);
  } finally {
    mockWorkerResponse = {
      status: 200,
      body: {
        success: true,
        reply: 'Propuesta formulada en Worker TS',
        proposal: {
          proposal_id: '22222222-2222-4222-a222-222222222222',
          proposal_payload_hash: 'a'.repeat(64),
          status: 'pending_review',
        },
        correlation_id: 'corr-worker-999',
      },
    };
  }

  // =========================================================================
  // BLOQUE 7: ESTANDARIZACIÓN DE AUTENTICACIÓN DE LAS 9 RUTAS DEL ADMIN INBOX
  // =========================================================================
  const ADMIN_INBOX_ACTION_ROUTES = [
    {
      name: 'audit-findings/create-communication-intent',
      handler: postAuditCreateCommIntent,
      expectedPath: '/api/v1/inbox/audit-findings/44444444-4444-4444-8444-444444444444/create-communication-intent',
      sampleBody: { review_notes: 'Crear intent de comunicación' },
    },
    {
      name: 'audit-findings/dismiss',
      handler: postAuditDismiss,
      expectedPath: '/api/v1/inbox/audit-findings/44444444-4444-4444-8444-444444444444/dismiss',
      sampleBody: { resolution_note: 'Hallazgo descartado por duplicado' },
    },
    {
      name: 'audit-findings/mark-in-review',
      handler: postAuditMarkInReview,
      expectedPath: '/api/v1/inbox/audit-findings/44444444-4444-4444-8444-444444444444/mark-in-review',
      sampleBody: {},
    },
    {
      name: 'audit-findings/resolve',
      handler: postAuditResolve,
      expectedPath: '/api/v1/inbox/audit-findings/44444444-4444-4444-8444-444444444444/resolve',
      sampleBody: { resolution_note: 'Hallazgo resuelto satisfactoriamente' },
    },
    {
      name: 'communication-intents/approve',
      handler: postCommApprove,
      expectedPath: '/api/v1/inbox/communication-intents/44444444-4444-4444-8444-444444444444/approve',
      sampleBody: { review_notes: 'Aprobado para envío' },
    },
    {
      name: 'communication-intents/cancel',
      handler: postCommCancel,
      expectedPath: '/api/v1/inbox/communication-intents/44444444-4444-4444-8444-444444444444/cancel',
      sampleBody: { review_notes: 'Cancelado por revisión manual' },
    },
    {
      name: 'profile-proposals/approve',
      handler: postProfileApprove,
      expectedPath: '/api/v1/inbox/profile-proposals/44444444-4444-4444-8444-444444444444/approve',
      sampleBody: { review_notes: 'Propuesta de perfil aprobada' },
    },
    {
      name: 'profile-proposals/cancel',
      handler: postProfileCancel,
      expectedPath: '/api/v1/inbox/profile-proposals/44444444-4444-4444-8444-444444444444/cancel',
      sampleBody: { review_notes: 'Propuesta de perfil cancelada' },
    },
    {
      name: 'profile-proposals/reject',
      handler: postProfileReject,
      expectedPath: '/api/v1/inbox/profile-proposals/44444444-4444-4444-8444-444444444444/reject',
      sampleBody: { review_notes: 'Propuesta de perfil rechazada' },
    },
  ];

  const ITEM_ID = '44444444-4444-4444-8444-444444444444';

  // TC-24: Sesión ausente o inválida en las 9 rutas -> 401
  try {
    for (const route of ADMIN_INBOX_ACTION_ROUTES) {
      lastCapturedUpstreamUrl = '';
      const unauthReq = new NextRequest(`http://localhost:3000/api/agent/inbox/${route.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(route.sampleBody),
      });
      const res = await route.handler(unauthReq, { params: Promise.resolve({ id: ITEM_ID }) });
      const data = await res.json();
      assert.strictEqual(res.status, 401, `Ruta ${route.name} sin sesión debe devolver 401`);
      assert.strictEqual(data.error, 'No autenticado');
      assert.strictEqual(lastCapturedUpstreamUrl, '', `Ruta ${route.name} no debe invocar upstream sin sesión`);
    }
    recordTest('TC-24', 'Las 9 rutas del Admin Inbox rechazan sesión ausente o inválida con 401', 'PASS', '9/9 rutas -> 401 No autenticado');
  } catch (e: any) {
    recordTest('TC-24', 'Las 9 rutas del Admin Inbox rechazan sesión ausente o inválida con 401', 'FAIL', e.message);
  }

  // TC-25: Roles socio y staff rechazados con 403 en las 9 rutas
  try {
    for (const forbiddenRole of ['socio', 'staff']) {
      mockSocioDbResult = { id: VALID_SOCIO_ID, rol: forbiddenRole };
      for (const route of ADMIN_INBOX_ACTION_ROUTES) {
        lastCapturedUpstreamUrl = '';
        const req = new NextRequest(`http://localhost:3000/api/agent/inbox/${route.name}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...createAuthCookie(),
          },
          body: JSON.stringify(route.sampleBody),
        });
        const res = await route.handler(req, { params: Promise.resolve({ id: ITEM_ID }) });
        const data = await res.json();
        assert.strictEqual(res.status, 403, `Ruta ${route.name} con rol ${forbiddenRole} debe devolver 403`);
        assert(String(data.error).includes(`Rol '${forbiddenRole}' no autorizado`), `Mensaje inesperado: ${data.error}`);
        assert.strictEqual(lastCapturedUpstreamUrl, '', `Ruta ${route.name} no debe invocar upstream con rol ${forbiddenRole}`);
      }
    }
    recordTest('TC-25', 'Las 9 rutas del Admin Inbox rechazan usuarios con rol socio o staff con 403', 'PASS', '18/18 intentos bloqueados con 403');
  } catch (e: any) {
    recordTest('TC-25', 'Las 9 rutas del Admin Inbox rechazan usuarios con rol socio o staff con 403', 'FAIL', e.message);
  } finally {
    mockSocioDbResult = { id: VALID_SOCIO_ID, rol: 'socio' };
  }

  // TC-26: Usuario sin vinculación (403) vs error de consulta a base de datos (500) en las 9 rutas
  try {
    mockSocioDbResult = null;
    for (const route of ADMIN_INBOX_ACTION_ROUTES) {
      const req = new NextRequest(`http://localhost:3000/api/agent/inbox/${route.name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...createAuthCookie(),
        },
        body: JSON.stringify(route.sampleBody),
      });
      const res = await route.handler(req, { params: Promise.resolve({ id: ITEM_ID }) });
      const data = await res.json();
      assert.strictEqual(res.status, 403, `Ruta ${route.name} sin socio vinculado debe devolver 403`);
      assert.strictEqual(data.error, 'No se pudo resolver el perfil de socio para la sesión activa');
    }

    mockSocioDbError = {
      status: 500,
      body: { code: 'XX000', message: 'postgres crash internal detail' },
    };
    for (const route of ADMIN_INBOX_ACTION_ROUTES) {
      const req = new NextRequest(`http://localhost:3000/api/agent/inbox/${route.name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...createAuthCookie(),
        },
        body: JSON.stringify(route.sampleBody),
      });
      const res = await route.handler(req, { params: Promise.resolve({ id: ITEM_ID }) });
      const data = await res.json();
      assert.strictEqual(res.status, 500, `Ruta ${route.name} ante fallo de BD debe devolver 500`);
      assert.strictEqual(data.error, 'Error al consultar perfil de socio');
      assert.strictEqual(JSON.stringify(data).includes('postgres crash'), false);
    }
    recordTest('TC-26', 'Las 9 rutas distinguen usuario sin vinculación (403) de error de BD (500)', 'PASS', '9x403 + 9x500 verificados');
  } catch (e: any) {
    recordTest('TC-26', 'Las 9 rutas distinguen usuario sin vinculación (403) de error de BD (500)', 'FAIL', e.message);
  } finally {
    mockSocioDbError = null;
    mockSocioDbResult = { id: VALID_SOCIO_ID, rol: 'socio' };
  }

  // TC-27: Administrador válido y construcción segura de cabeceras S2S en las 9 rutas
  try {
    const ADMIN_SOCIO_ID = '30000000-0000-4000-8000-000000000011';
    mockSocioDbResult = { id: ADMIN_SOCIO_ID, rol: 'admin' };
    mockPythonResponse = {
      status: 200,
      body: { status: 'ok', updated_id: ITEM_ID },
    };

    for (const route of ADMIN_INBOX_ACTION_ROUTES) {
      lastCapturedUpstreamUrl = '';
      lastCapturedUpstreamHeaders = {};
      lastCapturedUpstreamBody = null;

      const req = new NextRequest(`http://localhost:3000/api/agent/inbox/${route.name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...createAuthCookie(),
        },
        body: JSON.stringify(route.sampleBody),
      });
      const res = await route.handler(req, { params: Promise.resolve({ id: ITEM_ID }) });
      const data = await res.json();

      assert.strictEqual(res.status, 200, `Ruta ${route.name} con admin válido debe devolver 200`);
      assert.strictEqual(lastCapturedUpstreamUrl, `http://localhost:8000${route.expectedPath}`);
      assert.strictEqual(lastCapturedUpstreamHeaders['X-Agent-Core-Secret'], 'e2e_integration_secret_test_12345');
      assert.strictEqual(lastCapturedUpstreamHeaders['Authorization'], 'Bearer e2e_integration_secret_test_12345');
      assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-Auth-User-Id'], VALID_USER_ID);
      assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-Socio-Id'], ADMIN_SOCIO_ID);
      assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-User-Role'], 'admin');
      assert.deepStrictEqual(lastCapturedUpstreamBody, route.sampleBody);
      assert.strictEqual(data.updated_id, ITEM_ID);
    }
    recordTest('TC-27', 'Administrador válido delega las 9 rutas con cabeceras S2S canónicas y payload intacto', 'PASS', '9/9 rutas -> 200 OK');
  } catch (e: any) {
    recordTest('TC-27', 'Administrador válido delega las 9 rutas con cabeceras S2S canónicas y payload intacto', 'FAIL', e.message);
  } finally {
    mockSocioDbResult = { id: VALID_SOCIO_ID, rol: 'socio' };
  }

  // TC-28: Prevención de suplantación (headers delegados forjados y campos de identidad en body)
  try {
    const ADMIN_SOCIO_ID = '30000000-0000-4000-8000-000000000011';
    mockSocioDbResult = { id: ADMIN_SOCIO_ID, rol: 'admin' };
    mockPythonResponse = {
      status: 200,
      body: { status: 'ok' },
    };

    for (const route of ADMIN_INBOX_ACTION_ROUTES) {
      lastCapturedUpstreamHeaders = {};
      lastCapturedUpstreamBody = null;

      const req = new NextRequest(`http://localhost:3000/api/agent/inbox/${route.name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Delegated-Auth-User-Id': '99999999-9999-4999-8999-999999999999',
          'X-Delegated-Socio-Id': '99999999-9999-4999-8999-999999999999',
          'X-Delegated-User-Role': 'superadmin_forged',
          'X-Agent-Core-Secret': 'forged_secret',
          ...createAuthCookie(),
        },
        body: JSON.stringify({
          ...route.sampleBody,
          socio_id: '99999999-9999-4999-8999-999999999999',
          auth_user_id: '99999999-9999-4999-8999-999999999999',
          user_id: '99999999-9999-4999-8999-999999999999',
          rol: 'socio',
          role: 'socio',
          actor_id: 'forged_actor',
          actor_role: 'forged_role',
        }),
      });
      const res = await route.handler(req, { params: Promise.resolve({ id: ITEM_ID }) });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-Auth-User-Id'], VALID_USER_ID);
      assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-Socio-Id'], ADMIN_SOCIO_ID);
      assert.strictEqual(lastCapturedUpstreamHeaders['X-Delegated-User-Role'], 'admin');
      assert.strictEqual(lastCapturedUpstreamHeaders['X-Agent-Core-Secret'], 'e2e_integration_secret_test_12345');
      assert.strictEqual('socio_id' in lastCapturedUpstreamBody, false);
      assert.strictEqual('auth_user_id' in lastCapturedUpstreamBody, false);
      assert.strictEqual('user_id' in lastCapturedUpstreamBody, false);
      assert.strictEqual('rol' in lastCapturedUpstreamBody, false);
      assert.strictEqual('role' in lastCapturedUpstreamBody, false);
      assert.strictEqual('actor_id' in lastCapturedUpstreamBody, false);
      assert.strictEqual('actor_role' in lastCapturedUpstreamBody, false);
      assert.deepStrictEqual(lastCapturedUpstreamBody, route.sampleBody);
    }
    recordTest('TC-28', 'Las 9 rutas neutralizan intentos de suplantación en headers y body', 'PASS', 'Headers y body sanitizados en 9/9 rutas');
  } catch (e: any) {
    recordTest('TC-28', 'Las 9 rutas neutralizan intentos de suplantación en headers y body', 'FAIL', e.message);
  } finally {
    mockSocioDbResult = { id: VALID_SOCIO_ID, rol: 'socio' };
  }

  // TC-29: Propagación del bloqueo operativo del Worker (503 KILLSWITCH_ACTIVE) en las 9 rutas
  try {
    const ADMIN_SOCIO_ID = '30000000-0000-4000-8000-000000000011';
    mockSocioDbResult = { id: ADMIN_SOCIO_ID, rol: 'admin' };
    mockPythonResponse = {
      status: 503,
      body: {
        error: 'Mecanismo de seguridad activado: operaciones suspendidas temporalmente.',
        code: 'KILLSWITCH_ACTIVE',
        correlation_id: 'req_inbox_killswitch_503',
      },
    };

    for (const route of ADMIN_INBOX_ACTION_ROUTES) {
      const req = new NextRequest(`http://localhost:3000/api/agent/inbox/${route.name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...createAuthCookie(),
        },
        body: JSON.stringify(route.sampleBody),
      });
      const res = await route.handler(req, { params: Promise.resolve({ id: ITEM_ID }) });
      const data = await res.json();
      assert.strictEqual(res.status, 503, `Ruta ${route.name} debe propagar 503 cuando kill-switch está activo`);
      assert.strictEqual(data.code, 'KILLSWITCH_ACTIVE');
      assert.strictEqual(data.correlation_id, 'req_inbox_killswitch_503');
    }
    recordTest('TC-29', 'Las 9 rutas propagan bloqueo operativo (503 KILLSWITCH_ACTIVE) del Worker', 'PASS', '9/9 rutas -> 503 KILLSWITCH_ACTIVE');
  } catch (e: any) {
    recordTest('TC-29', 'Las 9 rutas propagan bloqueo operativo (503 KILLSWITCH_ACTIVE) del Worker', 'FAIL', e.message);
  } finally {
    mockSocioDbResult = { id: VALID_SOCIO_ID, rol: 'socio' };
    mockPythonResponse = {
      status: 200,
      body: {
        request_id: '11111111-1111-4111-a111-111111111111',
        intent: 'QUERY_INBOX',
        payload: { items: [{ id: 'item-1' }], total_count: 1 },
        human_message: 'Consulta de inbox procesada en Python',
        requires_confirmation: false,
        requires_clarification: false,
      },
    };
  }

  // =========================================================================
  // RESUMEN FINAL
  // =========================================================================
  console.log('======================================================================');
  console.log(`RESUMEN DE PRUEBAS: TOTAL: ${totalTests} | PASS: ${passedTests} | FAIL: ${failedTests}`);
  console.log('======================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Error fatal al ejecutar suite:', err);
  process.exit(1);
});
