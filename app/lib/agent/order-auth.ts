import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClientServer } from '@/app/lib/supabase/server';
import { validateEnvironmentOrThrow } from '@/app/lib/env-guard';

function isTemporaryAuthFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { status?: number; code?: string; name?: string; message?: string };
    if (typeof candidate.status === 'number') {
        return candidate.status >= 500 || candidate.status === 0 || candidate.status === 429;
    }
    const text = `${candidate.code || ''} ${candidate.name || ''} ${candidate.message || ''}`.toLowerCase();
    return /timeout|network|fetch|temporar|econn|enotfound|service unavailable|rate limit/.test(text);
}

function authJson(authResponse: NextResponse | null | undefined, body: unknown, init?: ResponseInit): NextResponse {
    const res = NextResponse.json(body, init);
    if (authResponse && typeof authResponse.cookies?.getAll === 'function') {
        authResponse.cookies.getAll().forEach((c: any) => res.cookies.set(c));
        const cc = authResponse.headers?.get?.('cache-control');
        if (cc) res.headers.set('cache-control', cc);
    }
    return res;
}

export type AuthStatus = 'authenticated' | 'unauthenticated' | 'temporary_failure';

export type AuthResult =
  | {
      success: true;
      status: 200;
      user: User;
      id: string;
      token?: string | null;
      userClient?: SupabaseClient | null;
      response: null;
      authResponse?: NextResponse | null;
    }
  | {
      success: false;
      status: 401 | 503;
      user: null;
      id?: undefined;
      token?: undefined;
      userClient?: undefined;
      response: NextResponse;
      error: string;
      authResponse?: NextResponse | null;
    };

export function createUserClient(token?: string | null): SupabaseClient {
    if (!token) {
        throw new Error('Token de autenticación requerido para instanciar cliente de usuario');
    }
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            global: {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            },
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        }
    );
}

export interface StaffAccessResult {
    user: User | null;
    userClient?: SupabaseClient | null;
    token?: string | null;
    response: NextResponse | null;
    authResponse?: NextResponse | null;
}

export async function authenticate(request: Request, admin: SupabaseClient): Promise<AuthResult> {
    const header = request.headers.get('authorization');
    if (header) {
        if (!/^Bearer\s+\S+$/i.test(header)) {
            return {
                success: false,
                status: 401,
                user: null,
                error: 'Token inválido',
                response: authJson(null, { error: 'Iniciá sesión para continuar' }, { status: 401 })
            };
        }
        const token = header.replace(/^Bearer\s+/i, '');
        try {
            const { data, error } = await admin.auth.getUser(token);
            if (error) {
                if (isTemporaryAuthFailure(error)) {
                    return {
                        success: false,
                        status: 503,
                        user: null,
                        error: 'Autenticación temporalmente no disponible',
                        response: authJson(
                            null,
                            { error: 'Autenticación temporalmente no disponible. Reintentá en unos instantes.' },
                            { status: 503 }
                        )
                    };
                }
                return {
                    success: false,
                    status: 401,
                    user: null,
                    error: error.message || 'Iniciá sesión para continuar',
                    response: authJson(null, { error: 'Iniciá sesión para continuar' }, { status: 401 })
                };
            }
            if (!data?.user) {
                return {
                    success: false,
                    status: 401,
                    user: null,
                    error: 'Iniciá sesión para continuar',
                    response: authJson(null, { error: 'Iniciá sesión para continuar' }, { status: 401 })
                };
            }
            const userClient = createUserClient(token);
            return {
                success: true,
                status: 200,
                user: data.user,
                id: data.user.id,
                token,
                userClient,
                response: null,
                authResponse: null
            };
        } catch (tokenErr) {
            if (isTemporaryAuthFailure(tokenErr)) {
                return {
                    success: false,
                    status: 503,
                    user: null,
                    error: 'Autenticación temporalmente no disponible',
                    response: authJson(
                        null,
                        { error: 'Autenticación temporalmente no disponible. Reintentá en unos instantes.' },
                        { status: 503 }
                    )
                };
            }
            return {
                success: false,
                status: 401,
                user: null,
                error: 'Iniciá sesión para continuar',
                response: authJson(null, { error: 'Iniciá sesión para continuar' }, { status: 401 })
            };
        }
    }

    const authResponse = NextResponse.next();
    let client: any = null;
    try {
        client = await createClientServer(authResponse);
    } catch {
        // Fallback for tests or environments where cookies() is not available
    }

    if (!client) {
        return {
            success: false,
            status: 401,
            user: null,
            error: 'Iniciá sesión para continuar',
            response: authJson(authResponse, { error: 'Iniciá sesión para continuar' }, { status: 401 }),
            authResponse
        };
    }

    try {
        const { data, error } = await client.auth.getUser();
        if (error) {
            if (isTemporaryAuthFailure(error)) {
                return {
                    success: false,
                    status: 503,
                    user: null,
                    error: 'Autenticación temporalmente no disponible',
                    response: authJson(
                        authResponse,
                        { error: 'Autenticación temporalmente no disponible. Reintentá en unos instantes.' },
                        { status: 503 }
                    ),
                    authResponse
                };
            }
            return {
                success: false,
                status: 401,
                user: null,
                error: error.message || 'Iniciá sesión para continuar',
                response: authJson(authResponse, { error: 'Iniciá sesión para continuar' }, { status: 401 }),
                authResponse
            };
        }
        if (!data?.user) {
            return {
                success: false,
                status: 401,
                user: null,
                error: 'Iniciá sesión para continuar',
                response: authJson(authResponse, { error: 'Iniciá sesión para continuar' }, { status: 401 }),
                authResponse
            };
        }
        return {
            success: true,
            status: 200,
            user: data.user,
            id: data.user.id,
            token: null,
            userClient: client,
            response: null,
            authResponse
        };
    } catch (err) {
        if (isTemporaryAuthFailure(err)) {
            return {
                success: false,
                status: 503,
                user: null,
                error: 'Autenticación temporalmente no disponible',
                response: authJson(
                    authResponse,
                    { error: 'Autenticación temporalmente no disponible. Reintentá en unos instantes.' },
                    { status: 503 }
                ),
                authResponse
            };
        }
        return {
            success: false,
            status: 401,
            user: null,
            error: 'Iniciá sesión para continuar',
            response: authJson(authResponse, { error: 'Iniciá sesión para continuar' }, { status: 401 }),
            authResponse
        };
    }
}

export async function hasStaffRole(user: User, admin: SupabaseClient, adminOnly = false): Promise<boolean> {
    const allowed = adminOnly ? ['admin'] : ['admin', 'staff'];
    const { data, error } = await admin.from('socios').select('rol,status,bloqueado')
        .eq('auth_user_id', user.id).maybeSingle();
    if (error) throw new Error('No se pudieron verificar los permisos');
    const role = String(data?.rol || '').toLowerCase().trim();
    return allowed.includes(role) && data?.status === 'active' && data?.bloqueado !== true;
}

export async function requireStaff(
    request: Request,
    admin: SupabaseClient,
    adminOnly = false
): Promise<StaffAccessResult> {
    validateEnvironmentOrThrow();
    const auth = await authenticate(request, admin);
    if (!auth.success) {
        return { user: null, response: auth.response, authResponse: auth.authResponse };
    }
    const user = auth.user;
    try {
        const isStaff = await hasStaffRole(user, admin, adminOnly);
        if (!isStaff) {
            return {
                user: null,
                response: authJson(
                    auth.authResponse,
                    { error: 'No tenés permisos para esta operación' },
                    { status: 403 }
                ),
                authResponse: auth.authResponse
            };
        }
    } catch {
        return {
            user: null,
            response: authJson(
                auth.authResponse,
                { error: 'No se pudieron verificar los permisos' },
                { status: 500 }
            ),
            authResponse: auth.authResponse
        };
    }
    return {
        user,
        userClient: auth.userClient || null,
        token: auth.token || null,
        response: null,
        authResponse: auth.authResponse
    };
}
