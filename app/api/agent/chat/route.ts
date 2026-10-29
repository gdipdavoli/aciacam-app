import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { ChatResponseEnvelope } from '@/types/chat';
import { authJson, isTemporaryAuthFailure } from '@/app/lib/supabase/auth-response';
import * as crypto from 'node:crypto';

export const maxDuration = 25;
export const dynamic = 'force-dynamic';

/**
 * app/api/agent/chat/route.ts
 *
 * BFF Endpoint para la interfaz conversacional de App Chat con Enrutamiento Dual Seguro:
 * - Solicitudes validadas con intent="propose_order" -> Worker TypeScript (LPCP-v2).
 * - Solicitudes conversacionales estándar (message, confirmation_token) -> Agent Core Python.
 *
 * GARANTÍAS DE SEGURIDAD Y CONTRATO:
 * 1. Única fuente de auth: Sesión SSR de Supabase via cookies.
 * 2. Cero uso de SUPABASE_SERVICE_ROLE_KEY.
 * 3. Resolución canónica de socio: exclusivamente vía public.socios.auth_user_id.
 * 4. Prohibición total de inyección de campos de autoridad en el body.
 * 5. Validación estricta y discriminada por HTTP Status, intent, flags y payload.
 * 6. Modelo de seguridad ALLOWLIST pura para errores upstream de Agent Core.
 * 7. Respuestas de error públicas determinísticas y sanitizadas sin exponer stack traces ni secrets.
 * 8. Rechazo estricto de payloads ambiguos o malformados sin enviarlos a ningún upstream.
 */

const ALLOWED_INTENTS: ReadonlySet<string> = new Set([
  'QUERY_INBOX',
  'RUN_CAPABILITY',
  'PREPARE_INBOX_ACTION',
  'CONFIRM_ACTION',
  'CANCEL_CONFIRMATION',
  'UNKNOWN',
  'PROPOSE_ORDER',
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isChatErrorPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  if (typeof p.error_code !== 'string' || !p.error_code.trim()) return false;
  if (typeof p.message !== 'string') return false;
  return true;
}

function isChatResponseEnvelope(data: unknown, isHttp200: boolean): data is ChatResponseEnvelope {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.request_id !== 'string' || !obj.request_id.trim()) {
    return false;
  }
  if (typeof obj.intent !== 'string' || !ALLOWED_INTENTS.has(obj.intent)) {
    return false;
  }
  if (typeof obj.human_message !== 'string') {
    return false;
  }
  if (typeof obj.requires_confirmation !== 'boolean' || typeof obj.requires_clarification !== 'boolean') {
    return false;
  }

  // 1. Prohibir combinaciones de flags contradictorias
  if (obj.requires_confirmation && obj.requires_clarification) {
    return false;
  }

  const payload = obj.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const p = payload as Record<string, unknown>;

  // 2. Si requires_confirmation = true, exige exclusivamente ConfirmationRequiredResponsePayload
  if (obj.requires_confirmation) {
    if (obj.requires_clarification) return false;
    if (typeof p.confirmation_token !== 'string' || !p.confirmation_token.trim()) return false;
    if (typeof p.action_summary !== 'string') return false;
    if (typeof p.human_target_description !== 'string') return false;
    if (typeof p.expires_at !== 'string') return false;
    return true;
  }

  // 3. Si requires_clarification = true, exige exclusivamente ClarificationRequiredResponsePayload
  if (obj.requires_clarification) {
    if (obj.requires_confirmation) return false;
    if (typeof p.clarification_question !== 'string') return false;
    if ('suggested_options' in p && !Array.isArray(p.suggested_options)) return false;
    return true;
  }

  // 4. Si HTTP es 200 (éxito): NO se acepta ChatErrorResponsePayload como bypass universal
  if (isHttp200) {
    if ('error_code' in p) {
      return false;
    }

    switch (obj.intent) {
      case 'QUERY_INBOX': {
        if (!Array.isArray(p.items)) return false;
        if (typeof p.total_count !== 'number' || p.total_count < 0) return false;
        return true;
      }
      case 'RUN_CAPABILITY':
      case 'CONFIRM_ACTION':
      case 'CANCEL_CONFIRMATION': {
        if (typeof p.capability_name !== 'string' && typeof p.status !== 'string') return false;
        return true;
      }
      case 'PREPARE_INBOX_ACTION': {
        if (typeof p.confirmation_token !== 'string') return false;
        return true;
      }
      case 'UNKNOWN': {
        if (typeof p.clarification_question !== 'string' && !('suggested_options' in p)) return false;
        return true;
      }
      case 'PROPOSE_ORDER': {
        if (typeof p.proposal_id !== 'string' || !p.proposal_id.trim()) return false;
        if (typeof p.proposal_payload_hash !== 'string' || !p.proposal_payload_hash.trim()) return false;
        if (typeof p.status !== 'string') return false;
        return true;
      }
      default:
        return false;
    }
  }

  // 5. Para respuestas HTTP no-200 (errores de Agent Core):
  // Exige exclusivamente que el payload sea un ChatErrorResponsePayload válido
  if (!isChatErrorPayload(p)) {
    return false;
  }

  return true;
}

export async function POST(request: NextRequest) {
  try {
    let response: NextResponse | null = null;
    const json = (body: unknown, init?: ResponseInit) => authJson(response, body, init);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return json(
        { error: 'Configuración de Supabase incompleta en el servidor' },
        { status: 500 }
      );
    }

    // Autenticación canónica mediante sesión SSR (cookies)
    response = NextResponse.next();
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError && isTemporaryAuthFailure(authError)) {
      return json(
        { error: 'Autenticación temporalmente no disponible. Reintentá en unos instantes.' },
        { status: 503 }
      );
    }

    if (authError || !user) {
      return json({ error: 'No autenticado o sesión inválida' }, { status: 401 });
    }

    // Resolución canónica de perfil de socio e identidad delegada (EXCLUSIVAMENTE vía auth_user_id)
    const { data: socio, error: socioError } = await supabase
      .from('socios')
      .select('id, rol')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (socioError || !socio) {
      return json(
        { error: 'Usuario no está vinculado a un socio válido' },
        { status: 403 }
      );
    }

    const userRole = String(socio.rol || '').toLowerCase().trim();

    if (!['admin', 'staff', 'socio'].includes(userRole)) {
      return json(
        { error: 'El usuario autenticado no posee un rol habilitado para el asistente' },
        { status: 403 }
      );
    }

    // Parseo y validación estricta de payload de entrada
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json(
        { error: 'Formato JSON inválido' },
        { status: 400 }
      );
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json(
        { error: 'Formato de cuerpo de solicitud inválido' },
        { status: 400 }
      );
    }

    // Prohibición estricta de inyección de campos de autoridad en el cuerpo
    const forbiddenAuthorityFields = [
      'role',
      'actor_id',
      'auth_user_id',
      'socio_id',
      'requested_by',
      'is_admin',
      'permissions',
      'agent_core_secret',
      'headers',
    ];

    for (const field of forbiddenAuthorityFields) {
      if (field in body) {
        return json(
          { error: 'El cuerpo de la solicitud no puede contener campos de autoridad (' + field + ')' },
          { status: 400 }
        );
      }
    }

    // -------------------------------------------------------------------------
    // DISCRIMINACIÓN DE ENRUTAMIENTO DUAL:
    // -------------------------------------------------------------------------
    const isProposeOrder = body.intent === 'propose_order';

    if (isProposeOrder) {
      // -----------------------------------------------------------------------
      // RAMA A: PROPUESTA DE PEDIDO -> WORKER TYPESCRIPT
      // -----------------------------------------------------------------------
      // Rechazar campos ambiguos de diálogo conversacional
      if ('confirmation_token' in body) {
        return json(
          { error: 'Payload ambiguo: no se permite confirmation_token en una propuesta de pedido' },
          { status: 400 }
        );
      }

      // Validar campos permitidos para propuesta
      const allowedProposalFields = new Set([
        'intent',
        'items',
        'tipo_pedido',
        'motivo',
        'direccion_entrega',
        'localidad',
        'fecha_retiro',
        'franja_horaria',
        'slot_id',
        'observaciones',
        'details',
        'message',
      ]);

      for (const key of Object.keys(body)) {
        if (!allowedProposalFields.has(key)) {
          return json(
            { error: 'El cuerpo de la solicitud contiene campos no permitidos para propuesta de pedido (' + key + ')' },
            { status: 400 }
          );
        }
      }

      // Validar items obligatorios y estructurados
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return json(
          { error: 'La propuesta de pedido debe contener al menos un ítem en items' },
          { status: 400 }
        );
      }

      for (let i = 0; i < body.items.length; i++) {
        const item = body.items[i];
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return json(
            { error: 'Ítem de pedido inválido en posición ' + i },
            { status: 400 }
          );
        }
        const prodId = item.producto_id || item.product_id || item.productoId;
        if (typeof prodId !== 'string' || !UUID_REGEX.test(prodId.trim())) {
          return json(
            { error: 'Identificador de producto inválido o malformado en posición ' + i },
            { status: 400 }
          );
        }
        const cant = item.cantidad;
        if (typeof cant !== 'number' || !Number.isInteger(cant) || cant <= 0) {
          return json(
            { error: 'Cantidad inválida para producto ' + prodId + ' (debe ser un entero positivo)' },
            { status: 400 }
          );
        }
      }

      // Validar tipo_pedido y delivery
      const tipoPedido = typeof body.tipo_pedido === 'string' ? body.tipo_pedido.trim().toLowerCase() : 'retiro_sede';
      if (!['retiro_sede', 'delivery'].includes(tipoPedido)) {
        return json(
          { error: 'tipo_pedido no soportado (debe ser retiro_sede o delivery)' },
          { status: 400 }
        );
      }

      const dirEntrega = (typeof body.direccion_entrega === 'string' && body.direccion_entrega.trim()) ||
        (body.details && typeof (body.details as Record<string, unknown>).direccion_entrega === 'string' &&
          ((body.details as Record<string, unknown>).direccion_entrega as string).trim());

      if (tipoPedido === 'delivery' && !dirEntrega) {
        return json(
          { error: 'Los pedidos con entrega a domicilio (delivery) requieren una dirección de entrega válida' },
          { status: 400 }
        );
      }

      // Configuración S2S del Worker TypeScript
      const workerBaseUrl = process.env.AGENT_CORE_ORDER_WORKER_URL || process.env.AGENT_CORE_BASE_URL;
      const workerSecret = process.env.AGENT_CORE_ORDER_WORKER_SECRET || process.env.AGENT_CORE_BFF_SECRET;

      if (!workerBaseUrl || !workerSecret) {
        return json(
          { error: 'Configuración S2S de Agent Core (worker) no disponible en el servidor' },
          { status: 500 }
        );
      }

      const cleanBaseUrl = workerBaseUrl.replace(/\/+$/, '');
      const targetUrl = cleanBaseUrl + '/api/v1/chat/message';

      const payloadToSend = {
        intent: 'propose_order',
        items: body.items,
        tipo_pedido: tipoPedido,
        motivo: typeof body.motivo === 'string' ? body.motivo.trim() : 'Propuesta formulada desde App Chat',
        direccion_entrega: dirEntrega || undefined,
        localidad: typeof body.localidad === 'string' ? body.localidad.trim() : undefined,
        fecha_retiro: typeof body.fecha_retiro === 'string' ? body.fecha_retiro.trim() : undefined,
        franja_horaria: typeof body.franja_horaria === 'string' ? body.franja_horaria.trim() : undefined,
        slot_id: typeof body.slot_id === 'string' ? body.slot_id.trim() : undefined,
        observaciones: typeof body.observaciones === 'string' ? body.observaciones.trim() : undefined,
        details: (body.details && typeof body.details === 'object' && !Array.isArray(body.details)) ? body.details : undefined,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 22000);

      let workerResponse: Response;
      try {
        workerResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Core-Secret': workerSecret,
            'Authorization': 'Bearer ' + workerSecret,
            'X-Delegated-Auth-User-Id': user.id,
            'X-Delegated-Socio-Id': socio.id,
            'X-Delegated-User-Role': userRole,
          },
          body: JSON.stringify(payloadToSend),
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch (err: unknown) {
        const errorObj = err as { name?: string };
        if (errorObj?.name === 'AbortError') {
          return json(
            { error: 'El servicio de asistencia no respondió a tiempo (timeout)' },
            { status: 503 }
          );
        }
        return json(
          { error: 'El servicio de asistencia no está disponible temporalmente' },
          { status: 503 }
        );
      } finally {
        clearTimeout(timeoutId);
      }

      let workerData: any;
      try {
        workerData = await workerResponse.json();
      } catch {
        return json(
          { error: 'Respuesta inválida recibida de Agent Core (worker)' },
          { status: 502 }
        );
      }

      // Si el worker devolvió error de killswitch o suspensión
      if (workerResponse.status === 423 || workerResponse.status === 503) {
        return json(
          {
            error: workerData?.message || 'La formulación de pedidos está temporalmente suspendida',
            code: workerData?.code || 'SERVICE_SUSPENDED',
            correlation_id: workerData?.correlation_id,
          },
          { status: workerResponse.status }
        );
      }

      if (workerResponse.status === 401 || workerResponse.status === 403) {
        return json(
          { error: 'Falla de autorización upstream en Agent Core (worker)' },
          { status: 502 }
        );
      }

      if (!workerResponse.ok || !workerData?.success || !workerData?.proposal?.proposal_id) {
        return json(
          {
            error: workerData?.message || 'Error al procesar propuesta en Agent Core (worker)',
            code: workerData?.code || 'WORKER_ERROR',
          },
          { status: 502 }
        );
      }

      // Formatear la respuesta canónica como ChatResponseEnvelope
      const envelope: ChatResponseEnvelope = {
        request_id: String(workerData.correlation_id || crypto.randomUUID()),
        intent: 'PROPOSE_ORDER',
        human_message: String(workerData.reply || ('He generado la propuesta de pedido #' + String(workerData.proposal.proposal_id).slice(0, 8) + '. Quedará pendiente de aprobación humana formal por el equipo de administración en /admin/aprobaciones.')),
        requires_confirmation: false,
        requires_clarification: false,
        payload: {
          status: 'PROPOSAL_CREATED',
          proposal_id: String(workerData.proposal.proposal_id),
          proposal_payload_hash: String(workerData.proposal.proposal_payload_hash),
          proposal_status: String(workerData.proposal.status || 'pending_review'),
          items_count: Array.isArray(body.items) ? body.items.length : 1,
          raw_proposal: workerData.proposal,
        },
      };

      if (!isChatResponseEnvelope(envelope, true)) {
        return json(
          { error: 'Error al estructurar sobre de respuesta de propuesta' },
          { status: 502 }
        );
      }

      return json(envelope, { status: 200 });

    } else {
      // -----------------------------------------------------------------------
      // RAMA B: MENSAJE CONVERSACIONAL ESTÁNDAR -> AGENT CORE PYTHON
      // -----------------------------------------------------------------------
      // Rechazar si contiene campos de propuesta sin declarar intent='propose_order'
      if ('items' in body || ('intent' in body && body.intent !== undefined)) {
        return json(
          { error: 'Payload ambiguo: no se permite items o intent no reconocido en diálogo general' },
          { status: 400 }
        );
      }

      // Validación de campos permitidos para diálogo
      const allowedFields = new Set(['message', 'confirmation_token']);
      for (const key of Object.keys(body)) {
        if (!allowedFields.has(key)) {
          return json(
            { error: 'El cuerpo de la solicitud contiene campos no permitidos (' + key + ')' },
            { status: 400 }
          );
        }
      }

      const message = typeof body.message === 'string' ? body.message.trim() : undefined;
      const confirmationToken = typeof body.confirmation_token === 'string' ? body.confirmation_token.trim() : undefined;

      if (!message && !confirmationToken) {
        return json(
          { error: 'Debe proporcionar message o confirmation_token' },
          { status: 400 }
        );
      }

      if (message && message.length > 4000) {
        return json(
          { error: 'El mensaje excede el límite máximo de 4000 caracteres' },
          { status: 400 }
        );
      }

      if (confirmationToken && confirmationToken.length < 8) {
        return json(
          { error: 'Token de confirmación inválido' },
          { status: 400 }
        );
      }

      // Configuración S2S de Agent Core Python
      const agentCoreBaseUrl = process.env.AGENT_CORE_PYTHON_URL || process.env.AGENT_CORE_BASE_URL || process.env.AGENT_CORE_URL;
      const agentCoreBffSecret = process.env.AGENT_CORE_BFF_SECRET;

      if (!agentCoreBaseUrl || !agentCoreBffSecret) {
        return json(
          { error: 'Configuración S2S de Agent Core no disponible en el servidor' },
          { status: 500 }
        );
      }

      const cleanBaseUrl = agentCoreBaseUrl.replace(/\/+$/, '');
      const targetUrl = cleanBaseUrl + '/api/v1/chat/message';

      const payloadToSend: Record<string, string> = {};
      if (message) payloadToSend.message = message;
      if (confirmationToken) payloadToSend.confirmation_token = confirmationToken;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 22000);

      let agentCoreResponse: Response;
      try {
        agentCoreResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Core-Secret': agentCoreBffSecret,
            'Authorization': 'Bearer ' + agentCoreBffSecret,
            'X-Delegated-Auth-User-Id': user.id,
            'X-Delegated-Socio-Id': socio.id,
            'X-Delegated-User-Role': userRole,
          },
          body: JSON.stringify(payloadToSend),
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch (err: unknown) {
        const errorObj = err as { name?: string };
        if (errorObj?.name === 'AbortError') {
          return json(
            { error: 'El servicio de asistencia no respondió a tiempo (timeout)' },
            { status: 503 }
          );
        }
        return json(
          { error: 'El servicio de asistencia no está disponible temporalmente' },
          { status: 503 }
        );
      } finally {
        clearTimeout(timeoutId);
      }

      let data: unknown;
      try {
        data = await agentCoreResponse.json();
      } catch {
        return json(
          { error: 'Respuesta con formato no-JSON desde Agent Core' },
          { status: 502 }
        );
      }

      // Si Agent Core respondió con status OK (200), validar estructuralmente el ChatResponseEnvelope para HTTP 200
      if (agentCoreResponse.status === 200) {
        if (!isChatResponseEnvelope(data, true)) {
          return json(
            { error: 'Respuesta con estructura inválida desde Agent Core' },
            { status: 502 }
          );
        }
        return json(data, { status: 200 });
      }

      // Para respuestas de error HTTP de Agent Core (4xx / 5xx):
      // ACEPTAR EXCLUSIVAMENTE si la respuesta es un ChatResponseEnvelope de error válido de Agent Core
      if (isChatResponseEnvelope(data, false)) {
        return json(data, { status: agentCoreResponse.status });
      }

      // CUALQUIER OTRA RESPUESTA UPSTREAM (JSON genérico, DTO no reconocido, error con texto o secreto)
      // FAIL CLOSED: Modelo de seguridad de ALLOWLIST estricta sin denylist
      return json(
        { error: 'Respuesta inválida del servicio de asistencia' },
        { status: 502 }
      );
    }

  } catch {
    // Sanitización global de errores: Mensaje determinístico sin exponer stacktrace ni error.message
    return NextResponse.json(
      { error: 'Error interno en el servidor BFF' },
      { status: 500 }
    );
  }
}
