import { NextResponse } from 'next/server';

const AUTH_CACHE_HEADERS = ['cache-control', 'expires', 'pragma'] as const;

export function preserveSupabaseAuthResponse<T extends NextResponse>(
  target: T,
  authResponse?: NextResponse | null
): T {
  if (!authResponse) return target;

  authResponse.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
  for (const header of AUTH_CACHE_HEADERS) {
    const value = authResponse.headers.get(header);
    if (value) target.headers.set(header, value);
  }

  return target;
}

export function authJson(
  authResponse: NextResponse | null | undefined,
  body: unknown,
  init?: ResponseInit
): NextResponse {
  return preserveSupabaseAuthResponse(NextResponse.json(body, init), authResponse);
}

export function isTemporaryAuthFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: number; code?: string; name?: string; message?: string };
  if (typeof candidate.status === 'number') {
    return candidate.status >= 500 || candidate.status === 0 || candidate.status === 429;
  }
  const text = `${candidate.code || ''} ${candidate.name || ''} ${candidate.message || ''}`.toLowerCase();
  return /timeout|network|fetch|temporar|econn|enotfound|service unavailable|rate limit/.test(text);
}
