import { NextRequest, NextResponse } from 'next/server';
import { getDelegatedBffContext } from '@/app/lib/agent/bff-auth';

export async function GET(request: NextRequest) {
  const auth = await getDelegatedBffContext(request, ['admin', 'staff']);
  if (!auth.success) {
    return auth.response;
  }

  const { agentCoreBaseUrl, s2sHeaders } = auth.context;

  try {
    const searchParams = request.nextUrl.searchParams;
    const targetUrl = new URL('/api/v1/inbox', agentCoreBaseUrl);
    searchParams.forEach((value, key) => {
      targetUrl.searchParams.append(key, value);
    });

    const agentCoreResponse = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: s2sHeaders,
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
