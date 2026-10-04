import { NextRequest, NextResponse } from 'next/server';
import { proxyAgentCoreResponse } from '@/app/lib/agent/agent-core-response';
import { getDelegatedBffContext } from '@/app/lib/agent/bff-auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Requisito estricto: Rol admin obligatorio para materializar propuestas aprobadas.
  const auth = await getDelegatedBffContext(request, ['admin']);
  if (!auth.success) {
    return auth.response;
  }

  const { agentCoreBaseUrl, s2sHeaders } = auth.context;

  try {
    const { id } = await params;
    const targetUrl = new URL(
      `/api/v1/inbox/onboarding-proposals/${id}/apply`,
      agentCoreBaseUrl
    );

    const agentCoreResponse = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: s2sHeaders,
      body: JSON.stringify({}),
      cache: 'no-store',
    });

    return proxyAgentCoreResponse(agentCoreResponse);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Error interno en el BFF' },
      { status: 500 }
    );
  }
}
