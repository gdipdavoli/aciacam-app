import { NextResponse } from 'next/server';

export interface SafeUpstreamBody {
  data: unknown;
  rawText: string;
  parseError?: string;
}

function isJsonResponse(response: Response): boolean {
  return (response.headers.get('content-type') || '').toLowerCase().includes('application/json');
}

function sanitizeTextBody(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed;
}

export async function readUpstreamBody(response: Response): Promise<SafeUpstreamBody> {
  const rawText = await response.text();

  if (!rawText) {
    return { data: null, rawText };
  }

  if (!isJsonResponse(response)) {
    return { data: null, rawText };
  }

  try {
    return { data: JSON.parse(rawText), rawText };
  } catch (error: any) {
    return {
      data: null,
      rawText,
      parseError: error?.message || 'Invalid JSON response',
    };
  }
}

export async function proxyAgentCoreResponse(response: Response): Promise<NextResponse> {
  const body = await readUpstreamBody(response);
  const upstreamStatus = response.status || 502;

  if (body.parseError) {
    return NextResponse.json(
      {
        error: 'Agent Core devolvió una respuesta JSON inválida.',
        detail: body.parseError,
        upstream_status: upstreamStatus,
      },
      { status: upstreamStatus }
    );
  }

  if (isJsonResponse(response)) {
    return NextResponse.json(body.data ?? {}, { status: upstreamStatus });
  }

  const normalizedText = sanitizeTextBody(body.rawText);
  return NextResponse.json(
    response.ok
      ? {
          message: normalizedText || response.statusText || 'Respuesta no JSON de Agent Core.',
          upstream_status: upstreamStatus,
        }
      : {
          error: normalizedText || response.statusText || 'Error no JSON de Agent Core.',
          upstream_status: upstreamStatus,
        },
    { status: upstreamStatus }
  );
}
