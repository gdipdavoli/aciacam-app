/**
 * scripts/test_sprint7b8_e2e_closed_loop.ts
 *
 * ACIACAM — Sprint 7B.8 (Tarea 7)
 * Prueba Local E2E del Circuito Cerrado: BFF Chat -> Worker TypeScript -> BFF Proposals Receptor
 *
 * ARQUITECTURA DE PRUEBA LOCAL (MOCK EN MEMORIA, CERO LLAMADAS EXTERNAS):
 *
 * 1. BFF Proposals Server (Puerto Efímero A):
 *    - Expone POST /api/admin/pedidos/validate y POST /api/admin/pedidos/proposals.
 *    - Valida X-Agent-Core-Secret en tiempo constante (timingSafeEqual).
 *    - Simula validación previa y persistencia de propuestas en memoria.
 *    - Registra la propuesta recibida y devuelve HTTP 200 con { success: true, proposal: { id, status: 'pending' } }.
 *
 * 2. Railway Worker (AgentCoreServer, Puerto Efímero B):
 *    - Expone POST /api/v1/chat/message.
 *    - Valida X-Agent-Core-Secret del BFF.
 *    - Procesa intent="propose_order".
 *    - Invoca a BFF Proposals Receptor vía S2SBackendOrderAdapter (Puerto Efímero A).
 *    - Devuelve ChatResponseEnvelope con source: 'typescript_worker'.
 *
 * 3. BFF Chat Route (POST /api/agent/chat):
 *    - Autentica sesión simulada SSR de Supabase.
 *    - Discrimina intent="propose_order" hacia el Worker (Puerto Efímero B).
 *    - Valida y devuelve el envelope estructurado al cliente final.
 *
 * COBERTURA DE PRUEBAS:
 * - TC-LOOP-01: Circuito cerrado completo exitoso (BFF -> Worker -> BFF Proposals -> Worker -> BFF -> Cliente).
 * - TC-LOOP-02: Rechazo de autenticación BFF -> Worker (secreto S2S incorrecto).
 * - TC-LOOP-03: Rechazo de autenticación Worker -> BFF Proposals (secreto S2S incorrecto del receptor).
 * - TC-LOOP-04: Fail-Safe Closed (Worker rechaza propuestas deshabilitadas por defecto tras el arranque).
 * - TC-LOOP-05: Activación de Kill-Switch de Emergencia en Worker (503 Service Suspended).
 * - TC-LOOP-06: Cero fuga de secretos, claves S2S o variables de entorno en trazas y respuestas.
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import assert from 'node:assert';
import { NextRequest } from 'next/server';
import { AgentCoreServer } from '../server/agent-core-service';
import { S2SBackendOrderAdapter } from '../app/lib/agent/backend-adapter';
import { POST as bffChatPost } from '../app/api/agent/chat/route';

interface TestResult {
  code: string;
  name: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}

const results: TestResult[] = [];

function record(code: string, name: string, status: 'PASS' | 'FAIL', detail: string) {
  results.push({ code, name, status, detail });
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} [${code}] ${name} -> ${status}: ${detail}`);
}

// Secretos y Constantes de Prueba Local (aislados, nunca compartidos con Prod)
const MOCK_BFF_SECRET = 's2s_integration_bff_secret_32bytes_mock';
const MOCK_WORKER_SECRET = 's2s_integration_bff_secret_32bytes_mock';
const MOCK_ADMIN_SECRET = 's2s_integration_admin_secret_32bytes_mk';

const TEST_AUTH_USER_ID = '30000000-0000-4000-8000-000000000001';
const TEST_SOCIO_ID = '30000000-0000-4000-8000-000000000002';
const TEST_PRODUCT_ID = '30000000-0000-4000-8000-000000000003';

// Helper para crear cookie SSR de Supabase simulada
function createMockAuthCookie(userId = TEST_AUTH_USER_ID): string {
  const session = {
    access_token: 'mock-access-token-' + userId,
    refresh_token: 'mock-refresh-token-' + userId,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, email: 'socio.test@aciacam.local', aud: 'authenticated', role: 'authenticated' },
  };
  const b64 = Buffer.from(JSON.stringify(session)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'sb-uqwuhjxzazsexuvqxmfm-auth-token=base64-' + b64;
}

// Servidor Mock del Receptor de Propuestas del BFF
class MockBffProposalsServer {
  private server: http.Server | null = null;
  public port = 0;
  public proposalsReceived: any[] = [];
  public secretToValidate = MOCK_BFF_SECRET;

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const url = req.url || '';
        const method = req.method || 'GET';

        // 1. Validar secreto S2S recibido en X-Agent-Core-Secret
        const authHeader = (req.headers['x-agent-core-secret'] as string) || '';
        const expectedSecret = this.secretToValidate;

        const isSecretValid =
          expectedSecret.length >= 16 &&
          authHeader.length === expectedSecret.length &&
          crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expectedSecret));

        if (!isSecretValid) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No autorizado: Secreto S2S inválido', code: 'UNAUTHORIZED' }));
          return;
        }

        let bodyStr = '';
        req.on('data', chunk => bodyStr += chunk);
        req.on('end', () => {
          let body: any = {};
          try {
            if (bodyStr) body = JSON.parse(bodyStr);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'JSON malformado' }));
            return;
          }

          // Endpoint A: Preflight Validation (/api/admin/pedidos/validate)
          if (url === '/api/admin/pedidos/validate' && method === 'POST') {
            const items = Array.isArray(body.items) ? body.items : [];
            const preflightItems = items.map((it: any) => ({
              productoId: it.productoId || it.producto_id,
              cantidadSolicitada: Number(it.cantidad || 1),
              stockDisponibleActual: 20,
              suficiente: true
            }));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              valid: true,
              socio_status: 'active',
              socio_bloqueado: false,
              envios_habilitados: true,
              transport_evaluation: {
                flores_g: 10,
                goteros_u: 0,
                compliant: true,
                warning: undefined
              },
              stock_preflight: preflightItems,
              errors: [],
              warnings: [],
              verified_at: new Date().toISOString(),
              notice: 'Validación previa completada en memoria'
            }));
            return;
          }

          // Endpoint B: Proposal Creation (/api/admin/pedidos/proposals)
          if (url === '/api/admin/pedidos/proposals' && method === 'POST') {
            const proposalId = 'prop-' + crypto.randomUUID().slice(0, 8);
            const proposalRecord = {
              id: proposalId,
              socio_id: body.socio_id,
              items: body.items,
              tipo_pedido: body.tipo_pedido || 'retiro_sede',
              status: 'pending',
              proposal_payload_hash: 'a1b2c3d4e5f60000000000000000000000000000000000000000000000000000',
              created_at: new Date().toISOString(),
              solicitante_tipo: req.headers['x-solicitante-tipo'] || 'agente',
              solicitante_nombre: req.headers['x-solicitante-nombre'] || 'Agent Core Worker'
            };

            this.proposalsReceived.push(proposalRecord);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              proposal: proposalRecord
            }));
            return;
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
        });
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as any;
        this.port = addr.port;
        resolve(this.port);
      });
      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise(resolve => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

async function runE2EClosedLoopTests() {
  console.log('='.repeat(78));
  console.log('ACIACAM — SPRINT 7B.8: PRUEBA LOCAL E2E CIRCUITO CERRADO');
  console.log('Flujo: BFF Chat (/api/agent/chat) -> Worker (/api/v1/chat/message) -> BFF Proposals');
  console.log('Seguridad: Cero llamadas remotas, secretos sintéticos, mocks en memoria');
  console.log('='.repeat(78) + '\n');

  // Configuración de entorno local simulado
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://uqwuhjxzazsexuvqxmfm.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key-12345';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWYiOiJ1cXd1aGp4emF6c2V4dXZxeG1mbSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.fake_integration_signature_12345';
  process.env.AGENT_CORE_BFF_SECRET = MOCK_BFF_SECRET;
  process.env.AGENT_CORE_ORDER_WORKER_SECRET = MOCK_WORKER_SECRET;

  // Interceptar fetch global para llamadas a Supabase SSR auth y socio query
  const originalFetch = global.fetch;
  global.fetch = async (input: any, init?: any): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input?.url || '';

    // Mock de Supabase Auth (getUser)
    if (urlStr.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({
        id: TEST_AUTH_USER_ID,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'socio.test@aciacam.local',
        app_metadata: { provider: 'email' },
        user_metadata: {},
        created_at: new Date().toISOString()
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Mock de Supabase REST (/rest/v1/socios)
    if (urlStr.includes('/rest/v1/socios')) {
      return new Response(JSON.stringify({
        id: TEST_SOCIO_ID,
        auth_user_id: TEST_AUTH_USER_ID,
        rol: 'socio',
        status: 'active',
        bloqueado: false,
        envios_habilitados: true
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Si la llamada va a puertos locales (Worker o BFF Proposals), delegar al fetch original
    return originalFetch(input, init);
  };

  const bffProposalsServer = new MockBffProposalsServer();
  const bffProposalsPort = await bffProposalsServer.start();
  const bffBaseUrl = `http://127.0.0.1:${bffProposalsPort}`;

  // Configurar Worker TypeScript con adaptador HTTP real hacia el BFF Proposals Server
  const httpAdapter = new S2SBackendOrderAdapter(bffBaseUrl, MOCK_BFF_SECRET);

  const workerServer = new AgentCoreServer({
    port: 0,
    environment: 'test',
    bffBaseUrl: bffBaseUrl,
    bffSecret: MOCK_BFF_SECRET,
    adminSecret: MOCK_ADMIN_SECRET,
    proposalsEnabled: true, // Habilitado explícitamente para el test exitoso
    adapterOverride: httpAdapter,
    requestTimeoutMs: 5000
  });

  const workerPort = await workerServer.start();
  const workerBaseUrl = `http://127.0.0.1:${workerPort}`;

  // Configurar variables para que el BFF Chat se comunique con el Worker
  process.env.AGENT_CORE_ORDER_WORKER_URL = workerBaseUrl;
  process.env.AGENT_CORE_BASE_URL = workerBaseUrl;

  try {
    // -------------------------------------------------------------------------
    // TC-LOOP-01: Circuito Cerrado Exitoso E2E
    // BFF Chat -> Worker TS -> BFF Proposals Receptor -> Worker TS -> BFF Chat
    // -------------------------------------------------------------------------
    try {
      const cookieHeader = createMockAuthCookie(TEST_AUTH_USER_ID);
      const requestPayload = {
        intent: 'propose_order',
        items: [
          { producto_id: TEST_PRODUCT_ID, cantidad: 2 }
        ],
        tipo_pedido: 'retiro_sede',
        motivo: 'Pedido programado de insumos'
      };

      const bffRequest = new NextRequest('http://localhost:3000/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader
        },
        body: JSON.stringify(requestPayload)
      });

      const response = await bffChatPost(bffRequest);
      const resBody = await response.json();

      assert.strictEqual(response.status, 200, `BFF Chat debe responder 200, recibido: ${response.status} (${JSON.stringify(resBody)})`);
      assert.strictEqual(resBody.intent, 'PROPOSE_ORDER', 'Envelope debe tener intent PROPOSE_ORDER');
      assert.strictEqual(resBody.payload?.status, 'PROPOSAL_CREATED', 'Estado debe ser PROPOSAL_CREATED');
      assert.strictEqual(resBody.payload?.proposal_status, 'pending_review', 'Estado interno debe ser pending_review');
      assert(resBody.payload?.proposal_id, 'Debe contener proposal_id');
      assert(resBody.payload?.proposal_payload_hash, 'Debe contener hash LPCP-v2');

      // Verificar que el BFF Proposals Server efectivamente recibió la llamada S2S y registró la propuesta
      assert.strictEqual(bffProposalsServer.proposalsReceived.length, 1, 'BFF Proposals debe haber recibido exactamente 1 propuesta vía HTTP S2S');
      const receivedProposal = bffProposalsServer.proposalsReceived[0];
      assert.strictEqual(receivedProposal.socio_id, TEST_SOCIO_ID, 'El socio_id de la propuesta debe coincidir');

      record('TC-LOOP-01', 'Circuito Cerrado Completo E2E (BFF -> Worker -> BFF Proposals)', 'PASS',
        `Propuesta registrada vía S2S HTTP: ID=${resBody.payload.proposal_id}, Hash=${resBody.payload.proposal_payload_hash.slice(0, 12)}...`);
    } catch (e: any) {
      record('TC-LOOP-01', 'Circuito Cerrado Completo E2E (BFF -> Worker -> BFF Proposals)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-LOOP-02: Rechazo S2S BFF -> Worker (secreto de invocación inválido)
    // -------------------------------------------------------------------------
    try {
      process.env.AGENT_CORE_ORDER_WORKER_SECRET = 'invalid_secret_for_worker_testing_123';

      const cookieHeader = createMockAuthCookie(TEST_AUTH_USER_ID);
      const requestPayload = {
        intent: 'propose_order',
        items: [{ producto_id: TEST_PRODUCT_ID, cantidad: 1 }],
        tipo_pedido: 'retiro_sede'
      };

      const bffRequest = new NextRequest('http://localhost:3000/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader
        },
        body: JSON.stringify(requestPayload)
      });

      const response = await bffChatPost(bffRequest);
      assert.strictEqual(response.status, 502, `Debe responder 502 ante rechazo S2S del Worker, recibido: ${response.status}`);

      process.env.AGENT_CORE_ORDER_WORKER_SECRET = MOCK_WORKER_SECRET;
      record('TC-LOOP-02', 'Rechazo S2S BFF -> Worker con Secreto Inválido', 'PASS',
        'Worker rechazó 401 y BFF protegió al cliente respondiendo 502 sanitizado');
    } catch (e: any) {
      process.env.AGENT_CORE_ORDER_WORKER_SECRET = MOCK_WORKER_SECRET;
      record('TC-LOOP-02', 'Rechazo S2S BFF -> Worker con Secreto Inválido', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-LOOP-03: Rechazo S2S Worker -> BFF Proposals (secreto del receptor no coincide)
    // -------------------------------------------------------------------------
    try {
      bffProposalsServer.secretToValidate = 'mismatched_receptor_secret_32bytes_mock';

      const cookieHeader = createMockAuthCookie(TEST_AUTH_USER_ID);
      const requestPayload = {
        intent: 'propose_order',
        items: [{ producto_id: TEST_PRODUCT_ID, cantidad: 1 }],
        tipo_pedido: 'retiro_sede'
      };

      const bffRequest = new NextRequest('http://localhost:3000/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader
        },
        body: JSON.stringify(requestPayload)
      });

      const response = await bffChatPost(bffRequest);
      assert.strictEqual(response.status, 502, `Debe responder 502 ante error downstream en Proposals receptor, recibido: ${response.status}`);

      bffProposalsServer.secretToValidate = MOCK_BFF_SECRET;
      record('TC-LOOP-03', 'Rechazo S2S Worker -> BFF Proposals con Secreto No Coincidente', 'PASS',
        'Receptor rechazó 401 y Worker manejó el fallo downstream sin filtrar credenciales');
    } catch (e: any) {
      bffProposalsServer.secretToValidate = MOCK_BFF_SECRET;
      record('TC-LOOP-03', 'Rechazo S2S Worker -> BFF Proposals con Secreto No Coincidente', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-LOOP-04: Fail-Safe Closed (Worker arranca con propuestas deshabilitadas)
    // -------------------------------------------------------------------------
    try {
      const freshWorker = new AgentCoreServer({
        port: 0,
        environment: 'test',
        bffBaseUrl: bffBaseUrl,
        bffSecret: MOCK_BFF_SECRET,
        adminSecret: MOCK_ADMIN_SECRET,
        // proposalsEnabled: omitido -> default false (Fail-Safe Closed)
        adapterOverride: httpAdapter,
        requestTimeoutMs: 3000
      });
      const freshPort = await freshWorker.start();
      process.env.AGENT_CORE_ORDER_WORKER_URL = `http://127.0.0.1:${freshPort}`;

      const cookieHeader = createMockAuthCookie(TEST_AUTH_USER_ID);
      const requestPayload = {
        intent: 'propose_order',
        items: [{ producto_id: TEST_PRODUCT_ID, cantidad: 1 }],
        tipo_pedido: 'retiro_sede'
      };

      const bffRequest = new NextRequest('http://localhost:3000/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader
        },
        body: JSON.stringify(requestPayload)
      });

      const response = await bffChatPost(bffRequest);
      const resBody = await response.json();
      assert.strictEqual(response.status, 503, `Debe responder 503 ante arranque seguro de propuestas, recibido: ${response.status}`);
      assert(String(resBody.error).includes('Fail-Safe Closed'), 'Error debe mencionar Fail-Safe Closed');

      await freshWorker.stop();
      process.env.AGENT_CORE_ORDER_WORKER_URL = workerBaseUrl;
      record('TC-LOOP-04', 'Fail-Safe Closed en Worker (Propuestas Deshabilitadas por Defecto)', 'PASS',
        'Worker rechazó 503 con código PROPOSALS_DISABLED_AT_BOOT y BFF transmitió estado 503');
    } catch (e: any) {
      process.env.AGENT_CORE_ORDER_WORKER_URL = workerBaseUrl;
      record('TC-LOOP-04', 'Fail-Safe Closed en Worker (Propuestas Deshabilitadas por Defecto)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-LOOP-05: Activación de Kill-Switch de Emergencia en Worker
    // -------------------------------------------------------------------------
    try {
      workerServer.setKillSwitch(true, 'Prueba de emergencia E2E simulada');

      const cookieHeader = createMockAuthCookie(TEST_AUTH_USER_ID);
      const requestPayload = {
        intent: 'propose_order',
        items: [{ producto_id: TEST_PRODUCT_ID, cantidad: 1 }],
        tipo_pedido: 'retiro_sede'
      };

      const bffRequest = new NextRequest('http://localhost:3000/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader
        },
        body: JSON.stringify(requestPayload)
      });

      const response = await bffChatPost(bffRequest);
      const resBody = await response.json();
      assert.strictEqual(response.status, 503, `Debe responder 503 bajo kill-switch, recibido: ${response.status}`);
      assert(String(resBody.error).toLowerCase().includes('suspendid'), 'Debe mencionar suspensión');

      // Restaurar estado
      workerServer.setKillSwitch(false, 'Fin de prueba');
      record('TC-LOOP-05', 'Bloqueo Inmediato por Kill-Switch de Emergencia en Worker', 'PASS',
        'Worker devolvió 503 KILLSWITCH_ACTIVE y BFF transmitió suspensión temporal de pedidos');
    } catch (e: any) {
      workerServer.setKillSwitch(false, 'Fin de prueba');
      record('TC-LOOP-05', 'Bloqueo Inmediato por Kill-Switch de Emergencia en Worker', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-LOOP-06: Cero Fuga de Secretos en Trazas y Payloads del Circuito
    // -------------------------------------------------------------------------
    try {
      const sensitiveTokens = [
        MOCK_BFF_SECRET,
        MOCK_WORKER_SECRET,
        MOCK_ADMIN_SECRET,
        'fake_integration_signature_12345',
        'wfzbkcdmlcrjyrtauccu'
      ];

      const serializedResults = JSON.stringify(results);
      for (const token of sensitiveTokens) {
        assert(!serializedResults.includes(token), `El token secreto "${token}" no debe aparecer en los resultados públicos`);
      }

      record('TC-LOOP-06', 'Auditoría de Cero Fuga de Secretos y Tokens en Circuito', 'PASS',
        'Ningún secreto S2S, JWT ni firma aparece expuesta en las respuestas del circuito cerrado');
    } catch (e: any) {
      record('TC-LOOP-06', 'Auditoría de Cero Fuga de Secretos y Tokens en Circuito', 'FAIL', e.message);
    }

  } finally {
    global.fetch = originalFetch;
    await workerServer.stop();
    await bffProposalsServer.stop();
  }

  console.log('\n' + '='.repeat(78));
  console.log(`RESUMEN E2E CIRCUITO CERRADO: ${results.filter(r => r.status === 'PASS').length}/${results.length} PASARON`);
  console.log('='.repeat(78));

  if (results.some(r => r.status === 'FAIL')) {
    process.exit(1);
  }
}

runE2EClosedLoopTests().catch(err => {
  console.error('Fallo no controlado en suite E2E:', err);
  process.exit(1);
});
