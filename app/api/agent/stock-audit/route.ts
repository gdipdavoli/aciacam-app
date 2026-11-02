import { NextRequest, NextResponse } from 'next/server';
import { proxyAgentCoreResponse } from '@/app/lib/agent/agent-core-response';
import { getDelegatedBffContext, withBffAuthResponse } from '@/app/lib/agent/bff-auth';

export async function POST(request: NextRequest) {
  // Rol autorizado original: ['admin']
  const auth = await getDelegatedBffContext(request, ['admin']);
  if (!auth.success) {
    return auth.response;
  }

  const { agentCoreBaseUrl, s2sHeaders } = auth.context;

  try {
    let bodyPayload: Record<string, unknown> = {};
    try {
      const text = await request.text();
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          bodyPayload = parsed as Record<string, unknown>;
        }
      }
    } catch {
      bodyPayload = {};
    }

    const targetDate =
      typeof bodyPayload.target_date === 'string' && bodyPayload.target_date.trim()
        ? bodyPayload.target_date.trim()
        : null;
    const forceRecount = Boolean(bodyPayload.force_recount);
    const reason =
      typeof bodyPayload.reason === 'string' && bodyPayload.reason.trim()
        ? bodyPayload.reason.trim()
        : 'Solicitud de auditoría de stock desde App BFF';

    const targetUrl = new URL(
      '/api/v1/orchestration/stock-audit',
      agentCoreBaseUrl
    );

    const agentCoreResponse = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: s2sHeaders,
      body: JSON.stringify({
        target_date: targetDate,
        force_recount: forceRecount,
        reason,
      }),
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
