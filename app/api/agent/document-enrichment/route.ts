import { NextRequest, NextResponse } from 'next/server';
import { proxyAgentCoreResponse } from '@/app/lib/agent/agent-core-response';
import { getDelegatedBffContext, withBffAuthResponse } from '@/app/lib/agent/bff-auth';

export async function POST(request: NextRequest) {
  // Rol autorizado original: ['admin', 'staff']
  const auth = await getDelegatedBffContext(request, ['admin', 'staff']);
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

    const socioId = typeof bodyPayload.socio_id === 'string' ? bodyPayload.socio_id.trim() : '';
    const documentId = typeof bodyPayload.document_id === 'string' ? bodyPayload.document_id.trim() : '';

    if (!socioId || !documentId) {
      return withBffAuthResponse(
        auth,
        NextResponse.json(
          { error: 'Bad Request: socio_id y document_id son obligatorios' },
          { status: 400 }
        )
      );
    }

    const reason =
      typeof bodyPayload.reason === 'string' && bodyPayload.reason.trim()
        ? bodyPayload.reason.trim()
        : 'Solicitud de enriquecimiento documental desde App BFF';

    const targetUrl = new URL(
      '/api/v1/orchestration/document-enrichment',
      agentCoreBaseUrl
    );

    const agentCoreResponse = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: s2sHeaders,
      body: JSON.stringify({
        socio_id: socioId,
        document_id: documentId,
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
