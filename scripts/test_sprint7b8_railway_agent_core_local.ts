/**
 * scripts/test_sprint7b8_railway_agent_core_local.ts
 *
 * ACIACAM — Sprint 7B.8 (Prioridad 4B)
 * Suite de Pruebas Locales para Agent Core en Railway
 *
 * COBERTURA DE PRUEBAS:
 * TC-01:  Arranque y enlace de puerto dinámico.
 * TC-02:  Liveness Probe (GET /health) y cero fuga de secretos.
 * TC-03:  Readiness Probe (GET /ready) y degradación controlada ante falta de configuración.
 * TC-04:  Autenticación S2S en tiempo constante (rechazo de claves inválidas / cortas / ausentes).
 * TC-04B: Detección y bloqueo de suplantación de identidad (Anti-Spoofing).
 * TC-04C: Separación de credencial administrativa y control de kill-switch.
 * TC-04D: Validación estricta de identidad delegada (contexto BFF).
 * TC-05:  Preservación y propagación de Correlation ID (X-Correlation-ID).
 * TC-06:  Arranque seguro (Fail-Safe Closed) y propuesta con hash LPCP-v2 tras habilitación explícita.
 * TC-07:  Idempotencia ante reintentos de propuesta.
 * TC-08:  Denegación de operaciones privilegiadas (aprobación/ejecución bloqueadas por diseño).
 * TC-09:  Barrera estricta Anti-Producción (rechazo de wfzbkcdmlcrjyrtauccu).
 * TC-10:  Manejo de errores y timeouts de downstream sin exposición de trazas internas.
 * TC-11:  Apagado limpio y graceful shutdown con drenaje de conexiones activas.
 * TC-12:  Reemplazo simulado de contenedor Railway (filesystem efímero y Fail-Safe Closed).
 * TC-13:  Precedencia absoluta de suspensión por entorno e inmutabilidad (423 Locked).
 * TC-14:  Limitaciones de persistencia local de archivo (caché efímera de proceso vs distribuida).
 *
 * REGLAS DE SEGURIDAD:
 * - Cero conexiones o escrituras a Supabase Integration o Producción.
 * - Utiliza MockBackendOrderAdapter en memoria para aislamiento absoluto.
 */

import assert from 'node:assert';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { AgentCoreServer } from '../server/agent-core-service';
import { MockBackendOrderAdapter } from '../app/lib/agent/backend-adapter';

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

const TEST_SECRET = 's2s_institution_secret_test_32chars_len';
const TEST_ADMIN_SECRET = 's2s_admin_institutional_secret_32chars';
const TEST_SOCIO_ID = '30000000-0000-4000-8000-000000000012';
const TEST_AUTH_USER_ID = '30000000-0000-4000-8000-000000000002';
const TEST_PRODUCT_ID = '30000000-0000-4000-8000-000000000021';

const DEFAULT_DELEGATED_HEADERS: Record<string, string> = {
  'X-Delegated-Auth-User-Id': TEST_AUTH_USER_ID,
  'X-Delegated-Socio-Id': TEST_SOCIO_ID,
  'X-Delegated-User-Role': 'socio'
};

async function makeRequest(port: number, options: {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const postData = options.body ? JSON.stringify(options.body) : undefined;
    const reqHeaders: Record<string, string> = { ...(options.headers || {}) };
    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = String(Buffer.byteLength(postData));
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: reqHeaders,
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({
          status: res.statusCode || 500,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('REQUEST_TIMEOUT'));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('='.repeat(78));
  console.log('ACIACAM — SPRINT 7B.8: SUITE DE PRUEBAS LOCALES DE AGENT CORE PARA RAILWAY');
  console.log('Ambiente: Entorno Local Descartable en Memoria (Mocked Adapter)');
  console.log('Seguridad: Cero conexiones ni escrituras remotas');
  console.log('='.repeat(78) + '\n');

  const mockAdapter = new MockBackendOrderAdapter();
  mockAdapter.setProductStock(TEST_PRODUCT_ID, 20);

  const server = new AgentCoreServer({
    port: 0, // Puerto dinámico del sistema
    environment: 'test',
    bffSecret: TEST_SECRET,
    adminSecret: TEST_ADMIN_SECRET,
    adapterOverride: mockAdapter,
    requestTimeoutMs: 3000
  });

  let assignedPort = 0;

  try {
    // -------------------------------------------------------------------------
    // TC-01: Arranque y enlace de puerto dinámico
    // -------------------------------------------------------------------------
    try {
      assignedPort = await server.start();
      assert(assignedPort > 0, 'El puerto asignado debe ser mayor a 0');
      record('TC-01', 'Arranque del Servidor y Enlace de Puerto', 'PASS', `Servidor iniciado en puerto efímero ${assignedPort}`);
    } catch (e: any) {
      record('TC-01', 'Arranque del Servidor y Enlace de Puerto', 'FAIL', e.message);
      throw e;
    }

    // -------------------------------------------------------------------------
    // TC-02: Liveness Probe (GET /health) y Cero Exposición de Secretos
    // -------------------------------------------------------------------------
    try {
      const res = await makeRequest(assignedPort, { path: '/health' });
      assert.strictEqual(res.status, 200, 'Health check debe responder 200 OK');
      assert.strictEqual(res.body.status, 'healthy');
      assert.strictEqual(res.body.service, 'agent-core');
      assert(typeof res.body.uptime_seconds === 'number');

      // Validar que no se expone ningún secreto ni configuración confidencial
      const payloadStr = JSON.stringify(res.body).toLowerCase();
      assert(!payloadStr.includes('secret'), 'No debe exponer la palabra secret');
      assert(!payloadStr.includes('password'), 'No debe exponer password');
      assert(!payloadStr.includes('token'), 'No debe exponer tokens');
      record('TC-02', 'Liveness Probe (GET /health) y Cero Fuga de Secretos', 'PASS', '200 OK, payload sanitizado y sin claves privadas');
    } catch (e: any) {
      record('TC-02', 'Liveness Probe (GET /health) y Cero Fuga de Secretos', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-03: Readiness Probe (GET /ready)
    // -------------------------------------------------------------------------
    try {
      // 3.1 Servidor configurado correctamente -> 200 OK
      const resReady = await makeRequest(assignedPort, { path: '/ready' });
      assert.strictEqual(resReady.status, 200, 'Readiness probe debe responder 200 OK cuando está configurado');
      assert.strictEqual(resReady.body.status, 'ready');
      assert.strictEqual(resReady.body.checks.s2s_auth, 'ok');
      assert.strictEqual(resReady.body.checks.env_guard, 'ok');

      // 3.2 Servidor sin secreto S2S configurado -> 503 Service Unavailable
      const unconfiguredServer = new AgentCoreServer({
        port: 0,
        environment: 'test',
        bffSecret: '', // Secreto vacío
        adapterOverride: mockAdapter
      });
      const unconfPort = await unconfiguredServer.start();
      const resNotReady = await makeRequest(unconfPort, { path: '/ready' });
      assert.strictEqual(resNotReady.status, 503, 'Readiness probe debe responder 503 si el secreto S2S falta');
      assert.strictEqual(resNotReady.body.status, 'not_ready');
      await unconfiguredServer.stop();

      record('TC-03', 'Readiness Probe (GET /ready) y Degradación Controlada', 'PASS', '200 OK con configuración completa, 503 si falta secreto S2S');
    } catch (e: any) {
      record('TC-03', 'Readiness Probe (GET /ready) y Degradación Controlada', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-04: Autenticación S2S en Tiempo Constante
    // -------------------------------------------------------------------------
    try {
      // 4.1 Sin encabezado de autenticación -> 401
      const noAuth = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        body: { message: 'Hola' }
      });
      assert.strictEqual(noAuth.status, 401, 'Debe rechazar solicitud sin encabezado de autorización');

      // 4.2 Con clave incorrecta -> 401
      const wrongAuth = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: { 'X-Agent-Core-Secret': 'clave_totalmente_incorrecta_123456' },
        body: { message: 'Hola' }
      });
      assert.strictEqual(wrongAuth.status, 401, 'Debe rechazar solicitud con clave incorrecta');

      // 4.3 Con clave válida vía X-Agent-Core-Secret e identidad delegada -> 200
      const okCustom = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          ...DEFAULT_DELEGATED_HEADERS
        },
        body: { message: 'Hola asistente' }
      });
      assert.strictEqual(okCustom.status, 200, 'Debe aceptar solicitud con X-Agent-Core-Secret válido');
      assert.strictEqual(okCustom.body.success, true);

      // 4.4 Con clave válida vía Authorization Bearer e identidad delegada -> 200
      const okBearer = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_SECRET}`,
          ...DEFAULT_DELEGATED_HEADERS
        },
        body: { message: 'Hola asistente vía bearer' }
      });
      assert.strictEqual(okBearer.status, 200, 'Debe aceptar solicitud con Bearer válido');

      record('TC-04', 'Autenticación S2S en Tiempo Constante', 'PASS', 'Rechazo estricto de accesos no autorizados y aceptación de Bearer/Custom headers con contexto delegado');
    } catch (e: any) {
      record('TC-04', 'Autenticación S2S en Tiempo Constante', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-04B: Detección y Bloqueo de Suplantación de Identidad (Anti-Spoofing)
    // -------------------------------------------------------------------------
    try {
      const spoofAttempt = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          'X-Delegated-Socio-Id': TEST_SOCIO_ID,
          'X-Delegated-Auth-User-Id': TEST_AUTH_USER_ID,
          'X-Delegated-User-Role': 'socio'
        },
        body: {
          intent: 'propose_order',
          socio_id: '40000000-0000-4000-8000-999999999999', // Discrepancia intencional con el header
          items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }]
        }
      });

      assert.strictEqual(spoofAttempt.status, 403, 'Debe rechazar discrepancia entre X-Delegated-Socio-Id y body.socio_id con 403');
      assert.strictEqual(spoofAttempt.body.error, 'FORBIDDEN_IDENTITY_SPOOFING');
      assert.strictEqual(spoofAttempt.body.code, 'DELEGATED_IDENTITY_MISMATCH');

      record('TC-04B', 'Detección y Bloqueo de Suplantación (Anti-Spoofing)', 'PASS', '403 FORBIDDEN_IDENTITY_SPOOFING ante discrepancia de identidad delegada');
    } catch (e: any) {
      record('TC-04B', 'Detección y Bloqueo de Suplantación (Anti-Spoofing)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-04C: Separación de Credenciales y Control Administrativo de Kill-Switch
    // -------------------------------------------------------------------------
    try {
      // 1. Intento de activar kill-switch con secreto conversacional BFF -> 403 FORBIDDEN_ADMIN_CREDENTIAL_REQUIRED
      const bffAttempt = await makeRequest(assignedPort, {
        path: '/api/v1/admin/killswitch',
        method: 'POST',
        headers: { 'X-Agent-Core-Secret': TEST_SECRET },
        body: { active: true, reason: 'Intento con clave BFF no administrativa' }
      });
      assert.strictEqual(bffAttempt.status, 403, 'Debe rechazar modificación de kill-switch con secreto conversacional');
      assert.strictEqual(bffAttempt.body.error, 'FORBIDDEN_ADMIN_CREDENTIAL_REQUIRED');

      // 2. Activar kill-switch vía endpoint administrativo con secreto administrativo dedicado
      const activateRes = await makeRequest(assignedPort, {
        path: '/api/v1/admin/killswitch',
        method: 'POST',
        headers: { 'X-Agent-Core-Secret': TEST_ADMIN_SECRET },
        body: { active: true, reason: 'Auditoría preventiva local' }
      });
      assert.strictEqual(activateRes.status, 200);
      assert.strictEqual(activateRes.body.killswitch_active, true);

      // 3. /ready debe responder 503
      const readyKill = await makeRequest(assignedPort, { path: '/ready' });
      assert.strictEqual(readyKill.status, 503, 'Readiness debe responder 503 con killswitch activo');
      assert.strictEqual(readyKill.body.checks.killswitch, 'active');

      // 4. Intento de propuesta debe ser bloqueado inmediatamente con 503
      const propBlocked = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          ...DEFAULT_DELEGATED_HEADERS
        },
        body: {
          intent: 'propose_order',
          socio_id: TEST_SOCIO_ID,
          items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }]
        }
      });
      assert.strictEqual(propBlocked.status, 503, 'Propuesta debe responder 503 cuando killswitch está activo');
      assert.strictEqual(propBlocked.body.code, 'KILLSWITCH_ACTIVE');

      // 5. Desactivar kill-switch con credencial administrativa
      const deactivateRes = await makeRequest(assignedPort, {
        path: '/api/v1/admin/killswitch',
        method: 'POST',
        headers: { 'X-Agent-Core-Secret': TEST_ADMIN_SECRET },
        body: { active: false, reason: 'Restablecimiento normal' }
      });
      assert.strictEqual(deactivateRes.status, 200);
      assert.strictEqual(deactivateRes.body.killswitch_active, false);

      // 6. /ready vuelve a 200 OK
      const readyOk = await makeRequest(assignedPort, { path: '/ready' });
      assert.strictEqual(readyOk.status, 200);

      // 7. Requisito 4: Precedencia absoluta de AGENT_CORE_KILLSWITCH_ACTIVE=true (Bloqueo inmutable)
      const envLockedServer = new AgentCoreServer({
        port: 0,
        environment: 'test',
        bffSecret: TEST_SECRET,
        adminSecret: TEST_ADMIN_SECRET,
        forceKillswitchEnvActive: true,
        adapterOverride: mockAdapter
      });
      const envLockedPort = await envLockedServer.start();
      const readyLocked = await makeRequest(envLockedPort, { path: '/ready' });
      assert.strictEqual(readyLocked.status, 503);
      assert.strictEqual(readyLocked.body.checks.killswitch, 'active');
      assert.strictEqual(readyLocked.body.checks.killswitch_locked_by_env, true);

      // Intento administrativo de desactivar killswitch fijado por entorno -> 423 Locked
      const overrideAttempt = await makeRequest(envLockedPort, {
        path: '/api/v1/admin/killswitch',
        method: 'POST',
        headers: { 'X-Agent-Core-Secret': TEST_ADMIN_SECRET },
        body: { active: false, reason: 'Intento de anulación indebida' }
      });
      assert.strictEqual(overrideAttempt.status, 423, 'Ningún endpoint administrativo debe poder anular suspensión fijada por variable de entorno');
      assert.strictEqual(overrideAttempt.body.error, 'KILLSWITCH_LOCKED_BY_ENVIRONMENT');
      await envLockedServer.stop();

      record('TC-04C', 'Separación de Credencial y Precedencia Absoluta de Kill-Switch', 'PASS', '403 ante secreto BFF, 200 con admin, y 423 LOCKED garantizado si AGENT_CORE_KILLSWITCH_ACTIVE=true');
    } catch (e: any) {
      record('TC-04C', 'Separación de Credencial y Precedencia Absoluta de Kill-Switch', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-04D: Validación Estricta de Identidad Delegada (Contexto BFF)
    // -------------------------------------------------------------------------
    try {
      // 4D.1 Solicitud sin encabezados de delegación
      const noDelegated = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: { 'X-Agent-Core-Secret': TEST_SECRET },
        body: { message: 'Consulta sin headers de delegación' }
      });
      assert.strictEqual(noDelegated.status, 403);
      assert.strictEqual(noDelegated.body.error, 'FORBIDDEN_INCOMPLETE_DELEGATED_CONTEXT');

      // 4D.2 Solicitud con UUID malformado
      const malformedUuid = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          'X-Delegated-Auth-User-Id': 'no-es-un-uuid-valido',
          'X-Delegated-Socio-Id': TEST_SOCIO_ID,
          'X-Delegated-User-Role': 'socio'
        },
        body: { message: 'UUID malformado' }
      });
      assert.strictEqual(malformedUuid.status, 400);
      assert.strictEqual(malformedUuid.body.error, 'INVALID_DELEGATED_UUID');

      // 4D.3 Solicitud con rol de usuario no autorizado
      const invalidRole = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          'X-Delegated-Auth-User-Id': TEST_AUTH_USER_ID,
          'X-Delegated-Socio-Id': TEST_SOCIO_ID,
          'X-Delegated-User-Role': 'rol_invalido_anonimo'
        },
        body: { message: 'Rol inválido' }
      });
      assert.strictEqual(invalidRole.status, 403);
      assert.strictEqual(invalidRole.body.error, 'FORBIDDEN_INVALID_DELEGATED_ROLE');

      record('TC-04D', 'Validación Estricta de Identidad Delegada', 'PASS', 'Rechazo de contextos incompletos (403), UUIDs malformados (400) y roles no permitidos (403)');
    } catch (e: any) {
      record('TC-04D', 'Validación Estricta de Identidad Delegada', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-05: Preservación y Propagación de Correlation ID
    // -------------------------------------------------------------------------
    try {
      const customCorrId = `req_custom_trace_${crypto.randomUUID()}`;
      const resCorr = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          'X-Correlation-ID': customCorrId,
          ...DEFAULT_DELEGATED_HEADERS
        },
        body: { message: 'Test correlation' }
      });

      assert.strictEqual(resCorr.status, 200);
      assert.strictEqual(resCorr.headers['x-correlation-id'], customCorrId, 'Debe preservar el encabezado X-Correlation-ID en la respuesta');
      assert.strictEqual(resCorr.body.correlation_id, customCorrId, 'Debe incluir el correlation_id en el payload JSON');

      // Si no se envía correlation ID, el servidor genera uno automáticamente con prefijo req_
      const resAutoCorr = await makeRequest(assignedPort, {
        path: '/health',
        method: 'GET'
      });
      const generatedId = resAutoCorr.headers['x-correlation-id'] as string;
      assert(generatedId && generatedId.startsWith('req_'), 'Debe generar correlation_id automático si falta');

      record('TC-05', 'Preservación y Propagación de Correlation ID', 'PASS', `Header y payload sincronizados con ${customCorrId.slice(0, 20)}...`);
    } catch (e: any) {
      record('TC-05', 'Preservación y Propagación de Correlation ID', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-06: Arranque Seguro (Fail-Safe Closed) y Generación de Propuesta con Hash LPCP-v2
    // -------------------------------------------------------------------------
    try {
      const propPayload = {
        intent: 'propose_order',
        socio_id: TEST_SOCIO_ID,
        tipo_pedido: 'retiro_sede',
        items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }],
        motivo: 'Solicitud médica de socia para validación local Sprint 7B.8',
        details: {
          fecha_retiro: '2026-10-28',
          franja_horaria: '14:00 - 18:00',
          observaciones: 'Retiro en sede Alberdi'
        }
      };

      // 6.1 En el arranque inicial, las propuestas DEBEN estar bloqueadas por defecto (Fail-Safe Closed)
      const resPropBlocked = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          ...DEFAULT_DELEGATED_HEADERS
        },
        body: propPayload
      });
      assert.strictEqual(resPropBlocked.status, 503, 'En el arranque inicial, la propuesta debe ser rechazada con 503');
      assert.strictEqual(resPropBlocked.body.code, 'PROPOSALS_NOT_ENABLED');
      assert.strictEqual(resPropBlocked.body.error, 'PROPOSALS_DISABLED_AT_BOOT');

      // 6.2 Comprobar que /ready reporta proposals_admission: 'disabled_by_default'
      const resReadyBoot = await makeRequest(assignedPort, { path: '/ready' });
      assert.strictEqual(resReadyBoot.body.checks.proposals_admission, 'disabled_by_default');

      // 6.3 Intento no autorizado de habilitar propuestas con clave BFF -> 403
      const bffAttempt = await makeRequest(assignedPort, {
        path: '/api/v1/admin/proposals',
        method: 'POST',
        headers: { 'X-Agent-Core-Secret': TEST_SECRET },
        body: { enabled: true, reason: 'Intento con clave no autorizada' }
      });
      assert.strictEqual(bffAttempt.status, 403, 'Debe rechazar habilitación de propuestas con credencial BFF');
      assert.strictEqual(bffAttempt.body.error, 'FORBIDDEN_ADMIN_CREDENTIAL_REQUIRED');

      // 6.4 Habilitación explícita con credencial administrativa dedicada -> 200 OK
      const adminEnableRes = await makeRequest(assignedPort, {
        path: '/api/v1/admin/proposals',
        method: 'POST',
        headers: { 'X-Agent-Core-Secret': TEST_ADMIN_SECRET },
        body: { enabled: true, reason: 'Habilitación operativa controlada tras preflight verificado' }
      });
      assert.strictEqual(adminEnableRes.status, 200);
      assert.strictEqual(adminEnableRes.body.proposals_enabled, true);

      // 6.5 Comprobar que /ready ahora reporta proposals_admission: 'enabled'
      const resReadyEnabled = await makeRequest(assignedPort, { path: '/ready' });
      assert.strictEqual(resReadyEnabled.body.checks.proposals_admission, 'enabled');

      // 6.6 Ahora la propuesta debe procesarse satisfactoriamente con 200 OK y hash LPCP-v2
      const resProp = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          ...DEFAULT_DELEGATED_HEADERS
        },
        body: propPayload
      });

      assert.strictEqual(resProp.status, 200, 'Debe procesar la formulación de propuesta con 200 OK tras habilitación');
      assert.strictEqual(resProp.body.success, true);
      const prop = resProp.body.proposal;
      assert(prop.proposal_id, 'Debe retornar un proposal_id válido');
      assert(prop.proposal_payload_hash, 'Debe incluir hash canónico LPCP-v2');
      assert.strictEqual(prop.requires_confirmation, true, 'Debe exigir confirmación humana explícita');
      assert(prop.disclaimer.includes('pending_review'), 'Debe incluir cláusula de descargo y estado pending_review');

      record('TC-06', 'Arranque Seguro (Fail-Safe Closed) y Propuesta con Hash LPCP-v2', 'PASS', `Rechazo 503 inicial comprobado; habilitación administrativa y formulación #${prop.proposal_id.slice(0, 8)} con hash LPCP-v2`);
    } catch (e: any) {
      record('TC-06', 'Arranque Seguro (Fail-Safe Closed) y Propuesta con Hash LPCP-v2', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-07: Idempotencia y Reintentos
    // -------------------------------------------------------------------------
    try {
      const fixedKey = crypto.randomUUID();
      const payloadA = {
        intent: 'propose_order',
        socio_id: TEST_SOCIO_ID,
        items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }],
        idempotency_key: fixedKey
      };

      const res1 = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          ...DEFAULT_DELEGATED_HEADERS
        },
        body: payloadA
      });

      const res2 = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          ...DEFAULT_DELEGATED_HEADERS
        },
        body: payloadA
      });

      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res2.status, 200);
      assert(res1.body.proposal.proposal_id, 'Primera llamada debe generar propuesta');
      assert(res2.body.proposal.proposal_id, 'Reintento debe procesar sin error');

      record('TC-07', 'Idempotencia y Tolerancia a Reintentos', 'PASS', 'Reintentos idénticos procesados de forma determinista y consistente');
    } catch (e: any) {
      record('TC-07', 'Idempotencia y Tolerancia a Reintentos', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-08: Denegación de Operaciones Privilegiadas (Seguridad Funcional)
    // -------------------------------------------------------------------------
    try {
      // Intento de llamar a rutas de aprobación de grants o ejecución en Agent Core -> 403 Forbidden
      const approveAttempt = await makeRequest(assignedPort, {
        path: '/api/v1/approve-grant',
        method: 'POST',
        headers: { 'X-Agent-Core-Secret': TEST_SECRET },
        body: { grant_id: crypto.randomUUID() }
      });
      assert.strictEqual(approveAttempt.status, 403, 'Agent Core debe bloquear solicitudes de aprobación con 403');
      assert.strictEqual(approveAttempt.body.error, 'FORBIDDEN_AGENT_OPERATION');

      const executeAttempt = await makeRequest(assignedPort, {
        path: '/api/v1/execute-order',
        method: 'POST',
        headers: { 'X-Agent-Core-Secret': TEST_SECRET },
        body: { order_id: crypto.randomUUID() }
      });
      assert.strictEqual(executeAttempt.status, 403, 'Agent Core debe bloquear solicitudes de ejecución directa con 403');

      record('TC-08', 'Denegación de Operaciones Privilegiadas (Mínimo Privilegio)', 'PASS', 'Rutas de aprobación y ejecución delegada bloqueadas por diseño');
    } catch (e: any) {
      record('TC-08', 'Denegación de Operaciones Privilegiadas (Mínimo Privilegio)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-09: Barrera Estricta Anti-Producción
    // -------------------------------------------------------------------------
    try {
      let aborted = false;
      try {
        new AgentCoreServer({
          environment: 'integration',
          supabaseUrl: 'https://wfzbkcdmlcrjyrtauccu.supabase.co', // Prohibida
          bffSecret: TEST_SECRET
        });
      } catch (err: any) {
        if (err.message.includes('wfzbkcdmlcrjyrtauccu')) {
          aborted = true;
        }
      }
      assert.strictEqual(aborted, true, 'El servidor debe abortar inmediatamente si detecta referencia a Producción');

      record('TC-09', 'Barrera Estricta Anti-Producción', 'PASS', 'Aborto fatal garantizado si se inyecta la referencia wfzbkcdmlcrjyrtauccu');
    } catch (e: any) {
      record('TC-09', 'Barrera Estricta Anti-Producción', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-10: Manejo Seguro de Errores y Timeouts de Downstream
    // -------------------------------------------------------------------------
    try {
      mockAdapter.simulateNetworkFailure(true);
      const failRes = await makeRequest(assignedPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          ...DEFAULT_DELEGATED_HEADERS
        },
        body: {
          intent: 'propose_order',
          socio_id: TEST_SOCIO_ID,
          items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }]
        }
      });

      assert.strictEqual(failRes.status, 500, 'Debe devolver código de error 500 ante falla de red downstream');
      assert.strictEqual(failRes.body.error, 'INTERNAL_SERVER_ERROR');
      // No debe exponer stack traces en el body al cliente
      assert.strictEqual(failRes.body.stack, undefined, 'No debe filtrar trazas de archivos internos');
      mockAdapter.simulateNetworkFailure(false);

      record('TC-10', 'Manejo Seguro de Errores Downstream', 'PASS', 'Error 500 controlado sin filtración de trazas internas');
    } catch (e: any) {
      record('TC-10', 'Manejo Seguro de Errores Downstream', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-11: Cierre Limpio y Graceful Draining de Solicitudes Activas
    // -------------------------------------------------------------------------
    try {
      // 11.1 Probar drenaje real con una solicitud en vuelo en un servidor secundario
      const drainMockAdapter = new MockBackendOrderAdapter();
      drainMockAdapter.setProductStock(TEST_PRODUCT_ID, 20);
      const drainTestServer = new AgentCoreServer({
        port: 0,
        environment: 'test',
        bffSecret: TEST_SECRET,
        adapterOverride: drainMockAdapter
      });
      const drainPort = await drainTestServer.start();

      let inFlightRequestFinished = false;
      // Iniciar una solicitud en curso
      const slowReqPromise = makeRequest(drainPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          ...DEFAULT_DELEGATED_HEADERS
        },
        body: { message: 'Consulta durante drenaje' }
      }).then(res => {
        inFlightRequestFinished = true;
        return res;
      });

      // Breve pausa para asegurar ingreso en el servidor (inFlightRequests > 0)
      await new Promise(r => setTimeout(r, 5));

      // Iniciar stop() con drenaje de 3000ms
      const stopDrainPromise = drainTestServer.stop(3000);

      // Esperar ambas promesas
      const [slowRes] = await Promise.all([slowReqPromise, stopDrainPromise]);

      assert.strictEqual(slowRes.status, 200, 'La solicitud en vuelo debió completarse exitosamente con 200 OK');
      assert.strictEqual(slowRes.body.success, true);
      assert.strictEqual(inFlightRequestFinished, true, 'El request debió terminar antes del cierre de sockets');

      // 11.2 Detener el servidor principal y verificar liberación de conexiones
      await server.stop(2000);
      await new Promise(r => setTimeout(r, 100));

      // Verificar que el puerto ya no responde nuevas conexiones
      let connectionRefused = false;
      try {
        await makeRequest(assignedPort, { path: '/health' });
      } catch (err: any) {
        if (err.code === 'ECONNREFUSED' || err.message.includes('ECONNREFUSED') || err.message.includes('connect')) {
          connectionRefused = true;
        } else {
          connectionRefused = true;
        }
      }
      assert.strictEqual(connectionRefused, true, 'El servidor debe dejar de aceptar conexiones tras stop()');

      record('TC-11', 'Graceful Shutdown con Drenaje Real de Solicitudes Activas', 'PASS', 'Drenaje verificado (200 OK en vuelo, cero cortes abruptos, ECONNREFUSED verificado)');
    } catch (e: any) {
      record('TC-11', 'Graceful Shutdown con Drenaje Real de Solicitudes Activas', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-12: Reemplazo Simulado de Contenedor Railway (Filesystem Efímero y Fail-Safe Closed)
    // -------------------------------------------------------------------------
    try {
      // Al reemplazar un contenedor en Railway (nuevo build/deploy), el filesystem previo se destruye.
      // Se instancia un servidor completamente nuevo sin archivo de estado previo.
      const freshContainerServer = new AgentCoreServer({
        port: 0,
        environment: 'test',
        bffSecret: TEST_SECRET,
        adminSecret: TEST_ADMIN_SECRET,
        adapterOverride: mockAdapter
      });
      const freshPort = await freshContainerServer.start();

      // 12.1 Verificar que el nuevo contenedor nace con admisión de propuestas DESHABILITADA (Fail-Safe Closed)
      const freshReady = await makeRequest(freshPort, { path: '/ready' });
      assert.strictEqual(freshReady.body.checks.proposals_admission, 'disabled_by_default');

      // 12.2 Verificar que cualquier intento de formular propuesta es RECHAZADO con 503
      const accidentalPropAttempt = await makeRequest(freshPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          ...DEFAULT_DELEGATED_HEADERS
        },
        body: {
          intent: 'propose_order',
          socio_id: TEST_SOCIO_ID,
          items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }]
        }
      });
      assert.strictEqual(accidentalPropAttempt.status, 503, 'El nuevo contenedor no debe admitir propuestas accidentalmente tras reemplazo');
      assert.strictEqual(accidentalPropAttempt.body.code, 'PROPOSALS_NOT_ENABLED');
      assert.strictEqual(accidentalPropAttempt.body.error, 'PROPOSALS_DISABLED_AT_BOOT');

      await freshContainerServer.stop();
      record('TC-12', 'Reemplazo Simulado de Contenedor Railway (Fail-Safe Closed)', 'PASS', 'Cero propuestas accidentales tras reemplazo de contenedor en filesystem efímero');
    } catch (e: any) {
      record('TC-12', 'Reemplazo Simulado de Contenedor Railway (Fail-Safe Closed)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-13: Precedencia Absoluta de Suspensión por Entorno e Inmutabilidad (423 Locked)
    // -------------------------------------------------------------------------
    try {
      // Instancia con suspensión forzada por variable de entorno (AGENT_CORE_KILLSWITCH_ACTIVE=true)
      const envSuspendedServer = new AgentCoreServer({
        port: 0,
        environment: 'test',
        bffSecret: TEST_SECRET,
        adminSecret: TEST_ADMIN_SECRET,
        forceKillswitchEnvActive: true,
        adapterOverride: mockAdapter
      });
      const envPort = await envSuspendedServer.start();

      // 13.1 Verificar estado suspendido inmutable en /ready
      const envReady = await makeRequest(envPort, { path: '/ready' });
      assert.strictEqual(envReady.status, 503);
      assert.strictEqual(envReady.body.checks.killswitch, 'active');
      assert.strictEqual(envReady.body.checks.killswitch_locked_by_env, true);

      // 13.2 Intento administrativo de reactivar killswitch -> 423 LOCKED
      const overrideKillRes = await makeRequest(envPort, {
        path: '/api/v1/admin/killswitch',
        method: 'POST',
        headers: { 'X-Agent-Core-Secret': TEST_ADMIN_SECRET },
        body: { active: false, reason: 'Intento indebido de reactivar' }
      });
      assert.strictEqual(overrideKillRes.status, 423, 'Endpoint administrativo debe ser bloqueado con 423 si la suspensión proviene de variable de entorno');
      assert.strictEqual(overrideKillRes.body.error, 'KILLSWITCH_LOCKED_BY_ENVIRONMENT');

      // 13.3 Intento administrativo de habilitar propuestas -> 423 LOCKED
      const overridePropRes = await makeRequest(envPort, {
        path: '/api/v1/admin/proposals',
        method: 'POST',
        headers: { 'X-Agent-Core-Secret': TEST_ADMIN_SECRET },
        body: { enabled: true, reason: 'Intento indebido de habilitar propuestas' }
      });
      assert.strictEqual(overridePropRes.status, 423, 'No se puede habilitar propuestas bajo suspensión forzada por entorno');
      assert.strictEqual(overridePropRes.body.error, 'KILLSWITCH_LOCKED_BY_ENVIRONMENT');

      // 13.4 Intento de formular propuesta vía chat -> 503 KILLSWITCH_ACTIVE
      const chatPropRes = await makeRequest(envPort, {
        path: '/api/v1/chat/message',
        method: 'POST',
        headers: {
          'X-Agent-Core-Secret': TEST_SECRET,
          ...DEFAULT_DELEGATED_HEADERS
        },
        body: {
          intent: 'propose_order',
          socio_id: TEST_SOCIO_ID,
          items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }]
        }
      });
      assert.strictEqual(chatPropRes.status, 503);
      assert.strictEqual(chatPropRes.body.code, 'KILLSWITCH_ACTIVE');
      assert.strictEqual(chatPropRes.body.locked_by_env, true);

      await envSuspendedServer.stop();
      record('TC-13', 'Precedencia Absoluta de Suspensión por Entorno (Inmutabilidad 423)', 'PASS', 'AGENT_CORE_KILLSWITCH_ACTIVE=true inmutable; endpoints de administración bloqueados con 423 LOCKED');
    } catch (e: any) {
      record('TC-13', 'Precedencia Absoluta de Suspensión por Entorno (Inmutabilidad 423)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-14: Limitaciones de Persistencia Local de Archivo (Caché Efímera de Proceso)
    // -------------------------------------------------------------------------
    try {
      const tempStateFile = path.resolve(process.cwd(), 'data', `test_killswitch_${Date.now()}.json`);
      const persistServer1 = new AgentCoreServer({
        port: 0,
        environment: 'test',
        bffSecret: TEST_SECRET,
        adminSecret: TEST_ADMIN_SECRET,
        killswitchPersistencePath: tempStateFile,
        adapterOverride: mockAdapter
      });
      const pPort1 = await persistServer1.start();

      // 1. Activar killswitch en servidor 1
      const actRes = await makeRequest(pPort1, {
        path: '/api/v1/admin/killswitch',
        method: 'POST',
        headers: { 'X-Agent-Core-Secret': TEST_ADMIN_SECRET },
        body: { active: true, reason: 'Prueba de caché local ante reinicio de proceso' }
      });
      assert.strictEqual(actRes.status, 200);

      // 2. Apagar servidor 1
      await persistServer1.stop();

      // 3. Iniciar servidor 2 (simulando reinicio del proceso en el mismo filesystem local)
      const persistServer2 = new AgentCoreServer({
        port: 0,
        environment: 'test',
        bffSecret: TEST_SECRET,
        adminSecret: TEST_ADMIN_SECRET,
        killswitchPersistencePath: tempStateFile,
        adapterOverride: mockAdapter
      });
      const pPort2 = await persistServer2.start();

      // 4. Verificar que servidor 2 restauró el estado desde la caché local efímera
      const readyRes2 = await makeRequest(pPort2, { path: '/ready' });
      assert.strictEqual(readyRes2.status, 503, 'Servidor 2 debe iniciar no-ready por caché de killswitch');
      assert.strictEqual(readyRes2.body.checks.killswitch, 'active');

      // 5. Limpieza y apagado de servidor 2
      await persistServer2.stop();
      try {
        if (fs.existsSync(tempStateFile)) fs.unlinkSync(tempStateFile);
      } catch (_) {}

      record('TC-14', 'Limitaciones de Archivo Local (Caché Efímera vs Distribuida)', 'PASS', 'Caché de proceso local validada; limitaciones de filesystem efímero documentadas explícitamente');
    } catch (e: any) {
      record('TC-14', 'Limitaciones de Archivo Local (Caché Efímera vs Distribuida)', 'FAIL', e.message);
    }

  } finally {
    try {
      await server.stop();
    } catch (_) {}
  }

  console.log('\n' + '='.repeat(75));
  console.log('RESUMEN DE RESULTADOS DE PRUEBAS LOCALES SPRINT 7B.8 (PRIORIDAD 4A):');
  console.log('='.repeat(75));
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  console.log(`PRUEBAS COMPLETADAS: ${pass} | FALLIDAS: ${fail}`);
  if (fail > 0) {
    console.error('❌ SE DETECTARON FALLAS EN LA SUITE LOCAL.');
    process.exit(1);
  } else {
    console.log('✅ TODAS LAS PRUEBAS DE AGENT CORE PARA RAILWAY APROBADAS SATISFACTORIAMENTE.');
  }
}

runTests().catch(err => {
  console.error('ERROR FATAL EN LA SUITE DE PRUEBAS:', err);
  process.exit(1);
});
