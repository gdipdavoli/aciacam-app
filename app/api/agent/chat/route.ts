import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { ChatResponseEnvelope } from '@/types/chat';

/**
 * app/api/agent/chat/route.ts
 *
 * BFF Endpoint para la interfaz conversacional de App Chat (Sprint 2 - Step 10E-B.3).
 * Conecta el browser autenticado con el motor Agent Core (/api/v1/chat/message).
 *
 * GARANTÍAS DE SEGURIDAD Y CONTRATO:
 * 1. Única fuente de auth: Sesión SSR de Supabase via cookies.
 * 2. Cero uso de SUPABASE_SERVICE_ROLE_KEY.
 * 3. Resolución canónica de socio: exclusivamente vía public.socios.auth_user_id.
 * 4. Prohibición total de inyección de campos de autoridad en el body.
 * 5. Validación estricta y discriminada por HTTP Status, intent, flags y payload (sin ErrorPayload universal en 200).
 * 6. Modelo de seguridad ALLOWLIST pura para errores upstream de Agent Core (cero denylists).
 * 7. Respuestas de error públicas determinísticas y sanitizadas sin exponer stack traces ni secrets.
 */

const ALLOWED_INTENTS: ReadonlySet<string> = new Set([
  'QUERY_INBOX',
  'RUN_CAPABILITY',
  'PREPARE_INBOX_ACTION',
  'CONFIRM_ACTION',
  'CANCEL_CONFIRMATION',
  'UNKNOWN',
]);

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
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Configuración de Supabase incompleta en el servidor' },
        { status: 500 }
      );
    }

    // Autenticación canónica mediante sesión SSR (cookies)
    const response = NextResponse.next();
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

    if (authError || !user) {
      return NextResponse.json({ error: 'No autenticado o sesión inválida' }, { status: 401 });
    }

    // Resolución canónica de perfil de socio e identidad delegada (EXCLUSIVAMENTE vía auth_user_id)
    const { data: socio, error: socioError } = await supabase
      .from('socios')
      .select('id, rol')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (socioError || !socio) {
      return NextResponse.json(
        { error: 'Usuario no está vinculado a un socio válido' },
        { status: 403 }
      );
    }

    const userRole = String(socio.rol || '').toLowerCase().trim();

    if (!['admin', 'staff', 'socio'].includes(userRole)) {
      return NextResponse.json(
        { error: 'El usuario autenticado no posee un rol habilitado para el asistente' },
        { status: 403 }
      );
    }

    // Parseo y validación estricta de payload de entrada
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Formato JSON inválido' },
        { status: 400 }
      );
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
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
        return NextResponse.json(
          { error: 'El cuerpo de la solicitud no puede contener campos de autoridad (' + field + ')' },
          { status: 400 }
        );
      }
    }

    // Validación de campos permitidos
    const allowedFields = new Set(['message', 'confirmation_token']);
    for (const key of Object.keys(body)) {
      if (!allowedFields.has(key)) {
        return NextResponse.json(
          { error: 'El cuerpo de la solicitud contiene campos no permitidos (' + key + ')' },
          { status: 400 }
        );
      }
    }

    const message = typeof body.message === 'string' ? body.message.trim() : undefined;
    const confirmationToken = typeof body.confirmation_token === 'string' ? body.confirmation_token.trim() : undefined;

    if (!message && !confirmationToken) {
      return NextResponse.json(
        { error: 'Debe proporcionar message o confirmation_token' },
        { status: 400 }
      );
    }

    if (message && message.length > 4000) {
      return NextResponse.json(
        { error: 'El mensaje excede el límite máximo de 4000 caracteres' },
        { status: 400 }
      );
    }

    if (confirmationToken && confirmationToken.length < 8) {
      return NextResponse.json(
        { error: 'Token de confirmación inválido' },
        { status: 400 }
      );
    }

    // Configuración S2S de Agent Core
    const agentCoreBaseUrl = process.env.AGENT_CORE_BASE_URL || process.env.AGENT_CORE_URL;
    const agentCoreBffSecret = process.env.AGENT_CORE_BFF_SECRET;

    if (!agentCoreBaseUrl || !agentCoreBffSecret) {
      return NextResponse.json(
        { error: 'Configuración S2S de Agent Core no disponible en el servidor' },
        { status: 500 }
      );
    }

    const cleanBaseUrl = agentCoreBaseUrl.replace(/\/+$/, '');
    const targetUrl = cleanBaseUrl + '/api/v1/chat/message';

    const payloadToSend: Record<string, string> = {};
    if (message) payloadToSend.message = message;
    if (confirmationToken) payloadToSend.confirmation_token = confirmationToken;

    // Timeout de 15 segundos sin reintentos automáticos
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

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
        return NextResponse.json(
          { error: 'El servicio de asistencia no respondió a tiempo (timeout)' },
          { status: 503 }
        );
      }
      return NextResponse.json(
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
      return NextResponse.json(
        { error: 'Respuesta con formato no-JSON desde Agent Core' },
        { status: 502 }
      );
    }

    // Si Agent Core respondió con status OK (200), validar estructuralmente el ChatResponseEnvelope para HTTP 200
    if (agentCoreResponse.status === 200) {
      if (!isChatResponseEnvelope(data, true)) {
        return NextResponse.json(
          { error: 'Respuesta con estructura inválida desde Agent Core' },
          { status: 502 }
        );
      }
      return NextResponse.json(data, { status: 200 });
    }

    // Para respuestas de error HTTP de Agent Core (4xx / 5xx):
    // ACEPTAR EXCLUSIVAMENTE si la respuesta es un ChatResponseEnvelope de error válido de Agent Core
    if (isChatResponseEnvelope(data, false)) {
      return NextResponse.json(data, { status: agentCoreResponse.status });
    }

    // CUALQUIER OTRA RESPUESTA UPSTREAM (JSON genérico, DTO no reconocido, error con texto o secreto)
    // FAIL CLOSED: Modelo de seguridad de ALLOWLIST estricta sin denylist
    return NextResponse.json(
      { error: 'Respuesta inválida del servicio de asistencia' },
      { status: 502 }
    );
  } catch {
    // Sanitización global de errores: Mensaje determinístico sin exponer stacktrace ni error.message
    return NextResponse.json(
      { error: 'Error interno en el servidor BFF' },
      { status: 500 }
    );
  }
}
