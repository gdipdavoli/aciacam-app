import { NextRequest, NextResponse } from 'next/server';
import { proxyAgentCoreResponse } from '@/app/lib/agent/agent-core-response';
import { getDelegatedBffContext, withBffAuthResponse } from '@/app/lib/agent/bff-auth';

const FORBIDDEN_IDENTITY_KEYS = [
  'socio_id',
  'socioId',
  'auth_user_id',
  'authUserId',
  'user_id',
  'userId',
  'rol',
  'role',
  'actor_id',
  'actorId',
  'actor_role',
  'actorRole',
] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Requisito estricto: Rol admin obligatorio para realizar acciones sobre el Admin Inbox
  const auth = await getDelegatedBffContext(request, ['admin']);
  if (!auth.success) {
    return auth.response;
  }

  const { agentCoreBaseUrl, s2sHeaders } = auth.context;

  try {
    const { id } = await params;
    let bodyPayload: Record<string, unknown> = {};
    try {
      const text = await request.text();
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          bodyPayload = { ...(parsed as Record<string, unknown>) };
        }
      }
    } catch {
      bodyPayload = {};
    }

    for (const key of FORBIDDEN_IDENTITY_KEYS) {
      delete bodyPayload[key];
    }

    const targetUrl = new URL(
      `/api/v1/inbox/communication-intents/${id}/cancel`,
      agentCoreBaseUrl
    );

    const agentCoreResponse = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: s2sHeaders,
      body: JSON.stringify(bodyPayload),
      cache: 'no-store',
    });

    return withBffAuthResponse(auth, await proxyAgentCoreResponse(agentCoreResponse));
  } catch (error: any) {
    return withBffAuthResponse(
      auth,
      NextResponse.json(
        { error: error?.message || 'Error interno en el BFF' },
        { status: 500 }
      )
    );
  }
}
