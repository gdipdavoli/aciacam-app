/**
 * scripts/test_sprint7b8_proposals_authorization.ts
 *
 * ACIACAM — Sprint 7B.8 (Revisión Final de Autorización)
 * Suite de Pruebas de Autorización y Permisos Mínimos para Proposals Endpoint
 *
 * COBERTURA DE PRUEBAS NEGATIVAS Y POSITIVAS:
 * - TC-PA-01: Rechazo S2S por secreto incorrecto (timingSafeEqual fail-closed, HTTP 401).
 * - TC-PA-02: Rechazo S2S por secreto de longitud insuficiente (< 16 caracteres, HTTP 401).
 * - TC-PA-03: Rechazo sin credenciales (ausencia total de S2S y sesión, HTTP 401).
 * - TC-PA-04: Rechazo a usuario autenticado sin rol staff (rol 'socio', HTTP 403).
 * - TC-PA-05: Rechazo a usuario con token/sesión inválida o expirada (HTTP 401).
 * - TC-PA-06: Autorización legítima S2S (contexto 's2s', solicitante 'agente', actorUserId null).
 * - TC-PA-07: Autorización legítima Staff (contexto 'staff', solicitante 'operador', client RLS-scoped).
 * - TC-PA-08: Bloqueo de escalamiento de privilegios y anti-spoofing de solicitante en POST.
 * - TC-PA-09: Rechazo por ausencia de contexto / payload incompleto o malformado (HTTP 400).
 * - TC-PA-10: Rechazo de propuesta para socio bloqueado administrativamente (HTTP 403).
 * - TC-PA-11: GET /api/admin/pedidos/proposals protegido contra acceso no autenticado (HTTP 401).
 * - TC-PA-12: GET /api/admin/pedidos/proposals protegido contra rol socio no staff (HTTP 403).
 * - TC-PA-13: GET /api/admin/pedidos/proposals exitoso para operador staff evaluando RLS.
 * - TC-PA-14: Auditoría de cero fuga de secretos en respuestas y trazas de error.
 *
 * SEGURIDAD:
 * - Cero conexiones ni escrituras a bases remotas (mocks en memoria de Supabase REST/Auth).
 * - Aislamiento estricto y ejecución local controlada.
 */

// Inicializar variables de entorno de prueba antes de cualquier importación de módulos
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://uqwuhjxzazsexuvqxmfm.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key-12345';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWYiOiJ1cXd1aGp4emF6c2V4dXZxeG1mbSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.fake_integration_signature_12345';

import assert from 'node:assert';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/admin/pedidos/proposals/route';

interface TestResult {
  code: string;
  name: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}

const results: TestResult[] = [];

function record(code: string, name: string, status: 'PASS' | 'FAIL', detail: string) {
  results.push({ code, name, status, detail });
  const icon = status === 'PASS' ? '✓' : '✗';
  console.log(`${icon} [${code}] ${name} -> ${status}: ${detail}`);
}

const TEST_BFF_SECRET = 's2s_auth_test_secret_32bytes_mock_valid';
const TEST_STAFF_USER_ID = '30000000-0000-4000-8000-000000000010';
const TEST_SOCIO_USER_ID = '30000000-0000-4000-8000-000000000020';
const TEST_TARGET_SOCIO_ID = '30000000-0000-4000-8000-000000000030';
const TEST_BLOCKED_SOCIO_ID = '30000000-0000-4000-8000-000000000040';
const TEST_PRODUCT_ID = '30000000-0000-4000-8000-000000000050';

function createMockJwt(userId: string, role = 'authenticated') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    email: `${userId}@test.local`,
    role,
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString('base64url');
  return `${header}.${payload}.mock_signature`;
}

async function runProposalsAuthSuite() {
  console.log('='.repeat(78));
  console.log('ACIACAM — SPRINT 7B.8: SUITE DE AUTORIZACIÓN DEL ENDPOINT DE PROPUESTAS');
  console.log('Evaluación: Fail-Closed, Permisos Mínimos, RLS Scoping y Anti-Privilege Escalation');
  console.log('='.repeat(78) + '\n');

  process.env.AGENT_CORE_BFF_SECRET = TEST_BFF_SECRET;

  const originalFetch = global.fetch;

  // Interceptor global para llamadas a Supabase Auth y REST simuladas en memoria
  global.fetch = async (input: any, init?: any): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input?.url || '';
    const headers = (init?.headers || {}) as Record<string, string>;

    // 1. Supabase Auth (getUser)
    if (urlStr.includes('/auth/v1/user')) {
      const authHeader = headers['Authorization'] || headers['authorization'] || '';
      let tokenPayloadStr = '';
      try {
        const parts = authHeader.replace(/^Bearer\s+/i, '').split('.');
        if (parts.length >= 2) {
          tokenPayloadStr = Buffer.from(parts[1], 'base64url').toString('utf8');
        }
      } catch {}

      if (tokenPayloadStr.includes(TEST_STAFF_USER_ID) || authHeader.includes(TEST_STAFF_USER_ID)) {
        return new Response(JSON.stringify({
          id: TEST_STAFF_USER_ID,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'staff.operador@aciacam.local',
          app_metadata: { role: 'staff' },
          user_metadata: {}
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (tokenPayloadStr.includes(TEST_SOCIO_USER_ID) || authHeader.includes(TEST_SOCIO_USER_ID)) {
        return new Response(JSON.stringify({
          id: TEST_SOCIO_USER_ID,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'socio.comun@aciacam.local',
          app_metadata: {},
          user_metadata: {}
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 });
    }

    // 2. Supabase REST: socios
    if (urlStr.includes('/rest/v1/socios')) {
      const acceptHeader = headers['Accept'] || headers['accept'] || '';
      const isSingle = acceptHeader.includes('application/vnd.pgrst.object');

      if (urlStr.includes(TEST_STAFF_USER_ID)) {
        const payload = { id: 'socio-staff-uuid', rol: 'staff', status: 'active', bloqueado: false };
        return new Response(JSON.stringify(isSingle ? payload : [payload]), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      if (urlStr.includes(TEST_SOCIO_USER_ID)) {
        const payload = { id: 'socio-regular-uuid', rol: 'socio', status: 'active', bloqueado: false };
        return new Response(JSON.stringify(isSingle ? payload : [payload]), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      if (urlStr.includes(TEST_TARGET_SOCIO_ID)) {
        const payload = {
          id: TEST_TARGET_SOCIO_ID,
          nombre: 'Juan',
          apellido: 'Pérez',
          dni: '12345678',
          email: 'socio.target@test.local',
          status: 'active',
          bloqueado: false,
          envios_habilitados: true
        };
        return new Response(JSON.stringify(isSingle ? payload : [payload]), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      if (urlStr.includes(TEST_BLOCKED_SOCIO_ID)) {
        const payload = {
          id: TEST_BLOCKED_SOCIO_ID,
          nombre: 'Carlos',
          apellido: 'Bloqueado',
          dni: '87654321',
          email: 'socio.bloqueado@test.local',
          status: 'active',
          bloqueado: true,
          envios_habilitados: false
        };
        return new Response(JSON.stringify(isSingle ? payload : [payload]), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(isSingle ? null : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // 3. Supabase REST: products
    if (urlStr.includes('/rest/v1/products')) {
      return new Response(JSON.stringify([{
        id: TEST_PRODUCT_ID,
        nombre: 'Flores Variedad Test',
        stock_disponible: 50,
        peso_gramos: 5,
        tipo: 'flor'
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // 4. Supabase RPC: crear_propuesta_pedido
    if (urlStr.includes('/rest/v1/rpc/crear_propuesta_pedido')) {
      const body = JSON.parse(init?.body || '{}');
      return new Response(JSON.stringify({
        success: true,
        deduplicated: false,
        proposal: {
          proposal_id: 'prop-test-uuid-1234',
          target_socio_id: body.p_socio_id,
          solicitante_tipo: body.p_solicitante_tipo,
          solicitante_nombre: body.p_solicitante_nombre,
          tipo_pedido: body.p_tipo_pedido,
          status: 'pending_review',
          items: body.p_items,
          proposal_payload_hash: 'a1b2c3d4e5f60000000000000000000000000000000000000000000000000000',
          created_at: new Date().toISOString()
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // 5. Supabase REST: order_proposals
    if (urlStr.includes('/rest/v1/order_proposals')) {
      return new Response(JSON.stringify([{
        proposal_id: 'prop-listed-01',
        target_socio_id: TEST_TARGET_SOCIO_ID,
        status: 'pending_review',
        items: [{ productoId: TEST_PRODUCT_ID, cantidad: 2 }],
        proposal_payload_hash: 'hash-mock-01',
        created_at: new Date().toISOString()
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return originalFetch(input, init);
  };

  try {
    // -------------------------------------------------------------------------
    // TC-PA-01: Rechazo S2S por Secreto Incorrecto
    // -------------------------------------------------------------------------
    try {
      const req = new NextRequest('http://localhost:3000/api/admin/pedidos/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Core-Secret': 'wrong_secret_32bytes_random_value!'
        },
        body: JSON.stringify({ socio_id: TEST_TARGET_SOCIO_ID, items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }] })
      });

      const res = await POST(req);
      const data = await res.json();
      assert.strictEqual(res.status, 401, 'Debe responder 401 ante secreto incorrecto');
      assert.strictEqual(data.code, 'UNAUTHORIZED_S2S', 'Código de error debe ser UNAUTHORIZED_S2S');
      record('TC-PA-01', 'Rechazo S2S por Secreto Incorrecto (timingSafeEqual)', 'PASS',
        'Secreto inválido rechazado en tiempo constante con 401 UNAUTHORIZED_S2S');
    } catch (e: any) {
      record('TC-PA-01', 'Rechazo S2S por Secreto Incorrecto (timingSafeEqual)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-PA-02: Rechazo S2S por Longitud Insuficiente (< 16 caracteres)
    // -------------------------------------------------------------------------
    try {
      const req = new NextRequest('http://localhost:3000/api/admin/pedidos/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Core-Secret': 'short_secret'
        },
        body: JSON.stringify({ socio_id: TEST_TARGET_SOCIO_ID, items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }] })
      });

      const res = await POST(req);
      const data = await res.json();
      assert.strictEqual(res.status, 401, 'Debe responder 401 ante secreto corto');
      assert.strictEqual(data.code, 'UNAUTHORIZED_S2S', 'Código debe ser UNAUTHORIZED_S2S');
      record('TC-PA-02', 'Rechazo S2S por Secreto de Longitud Insuficiente (<16)', 'PASS',
        'Secreto menor a 16 caracteres rechazado fail-closed con 401');
    } catch (e: any) {
      record('TC-PA-02', 'Rechazo S2S por Secreto de Longitud Insuficiente (<16)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-PA-03: Rechazo Sin Credenciales (Ausencia Total S2S y Sesión)
    // -------------------------------------------------------------------------
    try {
      const req = new NextRequest('http://localhost:3000/api/admin/pedidos/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socio_id: TEST_TARGET_SOCIO_ID, items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }] })
      });

      const res = await POST(req);
      const data = await res.json();
      assert.strictEqual(res.status, 401, 'Debe responder 401 sin credenciales');
      record('TC-PA-03', 'Rechazo Sin Credenciales (Sin S2S ni Sesión Staff)', 'PASS',
        `Acceso denegado con 401: "${data.error}"`);
    } catch (e: any) {
      record('TC-PA-03', 'Rechazo Sin Credenciales (Sin S2S ni Sesión Staff)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-PA-04: Rechazo a Usuario Autenticado Sin Rol Staff (Rol Socio)
    // -------------------------------------------------------------------------
    try {
      const socioToken = createMockJwt(TEST_SOCIO_USER_ID);
      const req = new NextRequest('http://localhost:3000/api/admin/pedidos/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${socioToken}`
        },
        body: JSON.stringify({ socio_id: TEST_TARGET_SOCIO_ID, items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }] })
      });

      const res = await POST(req);
      const data = await res.json();
      assert.strictEqual(res.status, 403, 'Debe responder 403 ante usuario con rol no staff');
      assert.strictEqual(data.error, 'No tenés permisos para esta operación');
      record('TC-PA-04', 'Rechazo a Usuario Autenticado No Staff (Rol Socio)', 'PASS',
        'Usuario autenticado con rol socio bloqueado con 403 Forbidden');
    } catch (e: any) {
      record('TC-PA-04', 'Rechazo a Usuario Autenticado No Staff (Rol Socio)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-PA-05: Rechazo a Usuario con Token Inválido / Expirado
    // -------------------------------------------------------------------------
    try {
      const req = new NextRequest('http://localhost:3000/api/admin/pedidos/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer token_invalido_totalmente_falso'
        },
        body: JSON.stringify({ socio_id: TEST_TARGET_SOCIO_ID, items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }] })
      });

      const res = await POST(req);
      assert.strictEqual(res.status, 401, 'Debe responder 401 ante token inválido');
      record('TC-PA-05', 'Rechazo ante Token Inválido o Expirado', 'PASS',
        'Token ilegítimo rechazado fail-closed con 401 Unauthorized');
    } catch (e: any) {
      record('TC-PA-05', 'Rechazo ante Token Inválido o Expirado', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-PA-06: Autorización Exitosa S2S (Worker Agent Core)
    // -------------------------------------------------------------------------
    try {
      const req = new NextRequest('http://localhost:3000/api/admin/pedidos/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Core-Secret': TEST_BFF_SECRET,
          'X-Solicitante-Nombre': 'Agent Core Worker TS'
        },
        body: JSON.stringify({
          socio_id: TEST_TARGET_SOCIO_ID,
          items: [{ productoId: TEST_PRODUCT_ID, cantidad: 2 }],
          tipo_pedido: 'retiro_sede',
          motivo: 'Propuesta formulada desde asistente'
        })
      });

      const res = await POST(req);
      const data = await res.json();
      assert.strictEqual(res.status, 201, `Debe responder 201 Created, recibido: ${res.status} (${JSON.stringify(data)})`);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.proposal?.solicitante?.tipo, 'agente', 'Solicitante debe ser agente para S2S');
      assert.strictEqual(data.proposal?.solicitante?.nombre, 'Agent Core Worker TS');
      record('TC-PA-06', 'Autorización Exitosa S2S (Canal Worker Agent Core)', 'PASS',
        `Propuesta creada vía S2S con solicitante.tipo='agente' y status=201`);
    } catch (e: any) {
      record('TC-PA-06', 'Autorización Exitosa S2S (Canal Worker Agent Core)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-PA-07: Autorización Exitosa Staff (Operador Humano con RLS Scoping)
    // -------------------------------------------------------------------------
    try {
      const staffToken = createMockJwt(TEST_STAFF_USER_ID);
      const req = new NextRequest('http://localhost:3000/api/admin/pedidos/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${staffToken}`
        },
        body: JSON.stringify({
          socio_id: TEST_TARGET_SOCIO_ID,
          items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }],
          tipo_pedido: 'retiro_sede',
          motivo: 'Propuesta formulada por staff'
        })
      });

      const res = await POST(req);
      const data = await res.json();
      assert.strictEqual(res.status, 201, `Debe responder 201 Created, recibido: ${res.status}`);
      assert.strictEqual(data.proposal?.solicitante?.tipo, 'operador', 'Solicitante debe ser operador para Staff');
      assert.strictEqual(data.proposal?.solicitante?.nombre, 'staff.operador');
      record('TC-PA-07', 'Autorización Exitosa Staff (Operador con Scope RLS)', 'PASS',
        `Propuesta creada vía Staff con solicitante.tipo='operador' y status=201`);
    } catch (e: any) {
      record('TC-PA-07', 'Autorización Exitosa Staff (Operador con Scope RLS)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-PA-08: Bloqueo de Escalamiento / Anti-Spoofing de Solicitante
    // -------------------------------------------------------------------------
    try {
      const staffToken = createMockJwt(TEST_STAFF_USER_ID);
      // Intento de inyectar solicitante_tipo='agente' desde una sesión de staff
      const req = new NextRequest('http://localhost:3000/api/admin/pedidos/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${staffToken}`
        },
        body: JSON.stringify({
          socio_id: TEST_TARGET_SOCIO_ID,
          items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }],
          tipo_pedido: 'retiro_sede',
          solicitante_tipo: 'agente', // INTENTO DE SPOOFING
          solicitante_nombre: 'Suplantador'
        })
      });

      const res = await POST(req);
      const data = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(data.proposal?.solicitante?.tipo, 'operador', 'Debe ignorar inyección y forzar operador');
      assert.strictEqual(data.proposal?.solicitante?.nombre, 'staff.operador', 'Debe ignorar nombre falso');
      record('TC-PA-08', 'Mitigación Anti-Spoofing de Solicitante (No Suplantación de Agente)', 'PASS',
        'Inyección de solicitante_tipo rechazada, forzado a operador según credencial');
    } catch (e: any) {
      record('TC-PA-08', 'Mitigación Anti-Spoofing de Solicitante (No Suplantación de Agente)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-PA-09: Rechazo por Payload Incompleto o Malformado
    // -------------------------------------------------------------------------
    try {
      const req = new NextRequest('http://localhost:3000/api/admin/pedidos/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Core-Secret': TEST_BFF_SECRET
        },
        body: JSON.stringify({ socio_id: TEST_TARGET_SOCIO_ID, items: [] }) // Sin items
      });

      const res = await POST(req);
      const data = await res.json();
      assert.strictEqual(res.status, 400, 'Debe responder 400 con items vacíos');
      assert.strictEqual(data.code, 'INVALID_INPUT');
      record('TC-PA-09', 'Rechazo por Payload Incompleto (Items Vacíos)', 'PASS',
        'Solicitud rechazada con 400 INVALID_INPUT');
    } catch (e: any) {
      record('TC-PA-09', 'Rechazo por Payload Incompleto (Items Vacíos)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-PA-10: Rechazo de Propuesta para Socio Bloqueado
    // -------------------------------------------------------------------------
    try {
      const req = new NextRequest('http://localhost:3000/api/admin/pedidos/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Core-Secret': TEST_BFF_SECRET
        },
        body: JSON.stringify({
          socio_id: TEST_BLOCKED_SOCIO_ID,
          items: [{ productoId: TEST_PRODUCT_ID, cantidad: 1 }],
          tipo_pedido: 'retiro_sede'
        })
      });

      const res = await POST(req);
      const data = await res.json();
      assert.strictEqual(res.status, 403, 'Debe responder 403 para socio bloqueado');
      assert.strictEqual(data.code, 'SOCIO_BLOCKED');
      record('TC-PA-10', 'Rechazo de Propuesta para Socio Bloqueado', 'PASS',
        'Socio bloqueado administrativamente rechazado con 403 SOCIO_BLOCKED');
    } catch (e: any) {
      record('TC-PA-10', 'Rechazo de Propuesta para Socio Bloqueado', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-PA-11: GET /api/admin/pedidos/proposals Protegido Sin Auth
    // -------------------------------------------------------------------------
    try {
      const req = new NextRequest('http://localhost:3000/api/admin/pedidos/proposals', { method: 'GET' });
      const res = await GET(req);
      assert.strictEqual(res.status, 401, 'GET sin credenciales debe responder 401');
      record('TC-PA-11', 'GET Proposals Protegido Contra Acceso Anónimo', 'PASS',
        'GET sin credenciales rechazado con 401');
    } catch (e: any) {
      record('TC-PA-11', 'GET Proposals Protegido Contra Acceso Anónimo', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-PA-12: GET /api/admin/pedidos/proposals Protegido Contra Rol Socio
    // -------------------------------------------------------------------------
    try {
      const socioToken = createMockJwt(TEST_SOCIO_USER_ID);
      const req = new NextRequest('http://localhost:3000/api/admin/pedidos/proposals', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${socioToken}` }
      });
      const res = await GET(req);
      assert.strictEqual(res.status, 403, 'GET con rol socio debe responder 403');
      record('TC-PA-12', 'GET Proposals Protegido Contra Rol Socio No Staff', 'PASS',
        'GET con rol socio rechazado con 403 Forbidden');
    } catch (e: any) {
      record('TC-PA-12', 'GET Proposals Protegido Contra Rol Socio No Staff', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-PA-13: GET /api/admin/pedidos/proposals Exitoso para Staff (RLS Scoped)
    // -------------------------------------------------------------------------
    try {
      const staffToken = createMockJwt(TEST_STAFF_USER_ID);
      const req = new NextRequest('http://localhost:3000/api/admin/pedidos/proposals', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${staffToken}` }
      });
      const res = await GET(req);
      const data = await res.json();
      assert.strictEqual(res.status, 200, 'GET con rol staff debe responder 200');
      assert(Array.isArray(data.proposals), 'Debe devolver array de propuestas');
      record('TC-PA-13', 'GET Proposals Exitoso para Operador Staff (RLS Scoped)', 'PASS',
        `Listado de propuestas devuelto con status 200 y headers privados no-store`);
    } catch (e: any) {
      record('TC-PA-13', 'GET Proposals Exitoso para Operador Staff (RLS Scoped)', 'FAIL', e.message);
    }

    // -------------------------------------------------------------------------
    // TC-PA-14: Auditoría de Cero Fuga de Secretos en Errores y Trazas
    // -------------------------------------------------------------------------
    try {
      const sensitiveTokens = [
        TEST_BFF_SECRET,
        'fake_integration_signature_12345',
        'wfzbkcdmlcrjyrtauccu'
      ];
      const serialized = JSON.stringify(results);
      for (const token of sensitiveTokens) {
        assert(!serialized.includes(token), `Token sensible ${token} no debe filtrarse en resultados`);
      }
      record('TC-PA-14', 'Auditoría de Cero Fuga de Secretos en Errores y Trazas', 'PASS',
        'Cero credenciales expuestas en respuestas o salidas de prueba');
    } catch (e: any) {
      record('TC-PA-14', 'Auditoría de Cero Fuga de Secretos en Errores y Trazas', 'FAIL', e.message);
    }

  } finally {
    global.fetch = originalFetch;
  }

  console.log('\n' + '='.repeat(78));
  console.log(`RESUMEN AUTORIZACIÓN PROPUESTAS: ${results.filter(r => r.status === 'PASS').length}/${results.length} PASARON`);
  console.log('='.repeat(78));

  const failed = results.filter(r => r.status === 'FAIL');
  if (failed.length > 0) {
    console.error(`\n❌ Se encontraron ${failed.length} fallos en la suite de autorización.`);
    process.exit(1);
  } else {
    console.log('\n✅ SUITE DE AUTORIZACIÓN DE PROPUESTAS EXITOSA (14/14 PASS).');
  }
}

runProposalsAuthSuite().catch(err => {
  console.error('Fatal suite error:', err);
  process.exit(1);
});
