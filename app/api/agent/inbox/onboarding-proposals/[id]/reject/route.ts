import { NextRequest, NextResponse } from 'next/server';
import { getDelegatedBffContext } from '@/app/lib/agent/bff-auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Requisito estricto: Rol admin obligatorio para acciones sobre propuestas
  const auth = await getDelegatedBffContext(request, ['admin']);
  if (!auth.success) {
    return auth.response;
  }

  const { agentCoreBaseUrl, s2sHeaders } = auth.context;

  try {
    const { id } = await params;
    let bodyPayload = {};
    try {
      const text = await request.text();
      if (text) {
        bodyPayload = JSON.parse(text);
      }
    } catch {
      bodyPayload = {};
    }

    const targetUrl = new URL(
      `/api/v1/inbox/onboarding-proposals/${id}/reject`,
      agentCoreBaseUrl
    );

    const agentCoreResponse = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: s2sHeaders,
      body: JSON.stringify(bodyPayload),
      cache: 'no-store',
    });

    const data = await agentCoreResponse.json();
    return NextResponse.json(data, { status: agentCoreResponse.status });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Error interno en el BFF' },
      { status: 500 }
    );
  }
}
