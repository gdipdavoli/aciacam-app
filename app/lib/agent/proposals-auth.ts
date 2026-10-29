import { requireStaff } from '@/app/lib/api-auth';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { createClientServer } from '@/app/lib/supabase/server';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

let _supabaseAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
    if (_supabaseAdmin) return _supabaseAdmin;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error('Configuración de Supabase service role incompleta en el servidor');
    }
    _supabaseAdmin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    return _supabaseAdmin;
}

/**
 * Contexto de autorización fuertemente tipado para operaciones de propuestas de pedidos.
 * - 's2s': Solicitud backend-a-backend de Agent Core (Worker) autenticada mediante X-Agent-Core-Secret.
 *          Utiliza explícitamente supabaseAdmin para ejecutar la RPC con solicitante 'agente'.
 * - 'staff': Solicitud de operador humano autenticada mediante requireStaff (Bearer o Cookie SSR).
 *          Utiliza exclusivamente el cliente con permisos del usuario autenticado (RLS-scoped),
 *          prohibiendo cualquier bypass silencioso a service_role.
 */
export type ProposalsAuthContext =
    | {
        readonly type: 's2s';
        readonly client: SupabaseClient;
        readonly solicitanteTipo: 'agente';
        readonly solicitanteNombre: string;
        readonly actorUserId: null;
    }
    | {
        readonly type: 'staff';
        readonly client: SupabaseClient;
        readonly user: User;
        readonly solicitanteTipo: 'operador';
        readonly solicitanteNombre: string;
        readonly actorUserId: string;
    };

export type ProposalsAuthResult =
    | { readonly success: true; readonly context: ProposalsAuthContext; readonly response: null }
    | { readonly success: false; readonly context: null; readonly response: NextResponse };

/**
 * Crea un cliente Supabase con el scope de identidad del usuario autenticado (respetando RLS en PostgreSQL).
 */
export async function createScopedUserClient(request: Request): Promise<SupabaseClient | null> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        return null;
    }

    // 1. Si la petición incluye un token Bearer explícito, crear cliente con ese token (RLS-scoped)
    const authHeader = request.headers.get('authorization');
    if (authHeader && /^Bearer\s+\S+$/i.test(authHeader)) {
        const token = authHeader.replace(/^Bearer\s+/i, '');
        return createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false }
        });
    }

    // 2. Si la petición incluye cookies en el header
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
        return createServerClient(supabaseUrl, supabaseAnonKey, {
            cookies: {
                getAll() {
                    return cookieHeader.split(';').map(c => {
                        const [name, ...val] = c.trim().split('=');
                        return { name, value: val.join('=') };
                    });
                },
                setAll() {}
            }
        });
    }

    // 3. Fallback al contexto SSR de Next.js si está disponible
    try {
        return await createClientServer();
    } catch {
        return null;
    }
}

/**
 * Autentica y autoriza la solicitud hacia el endpoint de propuestas bajo política Fail-Closed:
 * - Valida si la llamada es S2S mediante timingSafeEqual contra AGENT_CORE_BFF_SECRET.
 * - Si contiene encabezado S2S pero es inválido, rechaza inmediatamente con 401 UNAUTHORIZED_S2S.
 * - Si no contiene encabezado S2S, valida rol Staff mediante requireStaff.
 * - Construye el cliente correspondiente (userClient para Staff, supabaseAdmin para S2S).
 * - Cero fallback implícito a supabaseAdmin ante fallos de sesión de usuario.
 */
export async function authenticateProposalsRequest(request: Request): Promise<ProposalsAuthResult> {
    const s2sHeader = request.headers.get('X-Agent-Core-Secret');

    // CANAL 1: Si la solicitud declara el encabezado S2S
    if (s2sHeader !== null) {
        const configuredSecret = process.env.AGENT_CORE_BFF_SECRET || process.env.AGENT_ORDER_CALLBACK_SECRET || '';

        const isS2SValid =
            configuredSecret.length >= 16 &&
            s2sHeader.length === configuredSecret.length &&
            timingSafeEqual(Buffer.from(s2sHeader), Buffer.from(configuredSecret));

        if (!isS2SValid) {
            // Intento S2S inválido: rechazo inmediato fail-closed sin fallback a staff
            return {
                success: false,
                context: null,
                response: NextResponse.json(
                    { error: 'Secreto S2S institucional inválido o no configurado', code: 'UNAUTHORIZED_S2S' },
                    { status: 401 }
                )
            };
        }

        const solicitanteNombre = (request.headers.get('X-Solicitante-Nombre') || 'Agent Core Worker').trim();

        let adminClient: SupabaseClient;
        try {
            adminClient = getSupabaseAdmin();
        } catch {
            return {
                success: false,
                context: null,
                response: NextResponse.json(
                    { error: 'Error de configuración del servidor de base de datos', code: 'SERVER_CONFIG_ERROR' },
                    { status: 500 }
                )
            };
        }

        return {
            success: true,
            context: {
                type: 's2s',
                client: adminClient, // S2S interno utiliza el service role de forma explícita y justificada
                solicitanteTipo: 'agente',
                solicitanteNombre,
                actorUserId: null
            },
            response: null
        };
    }

    // CANAL 2: Solicitud interactiva de Staff humano (Bearer o Cookie SSR)
    let adminClientForRoleCheck: SupabaseClient;
    try {
        adminClientForRoleCheck = getSupabaseAdmin();
    } catch {
        return {
            success: false,
            context: null,
            response: NextResponse.json(
                { error: 'Error de configuración del servidor de base de datos', code: 'SERVER_CONFIG_ERROR' },
                { status: 500 }
            )
        };
    }

    const staffAccess = await requireStaff(request, adminClientForRoleCheck);
    if (staffAccess.response || !staffAccess.user) {
        return {
            success: false,
            context: null,
            response: staffAccess.response || NextResponse.json(
                { error: 'No autorizado', code: 'UNAUTHORIZED' },
                { status: 401 }
            )
        };
    }

    const userClient = await createScopedUserClient(request);
    if (!userClient) {
        return {
            success: false,
            context: null,
            response: NextResponse.json(
                { error: 'No se pudo inicializar el cliente autenticado del operador', code: 'USER_CLIENT_INIT_FAILED' },
                { status: 500 }
            )
        };
    }

    const staffEmail = staffAccess.user.email || 'operador';
    const staffNombre = staffEmail.split('@')[0] || 'Staff Operador';

    return {
        success: true,
        context: {
            type: 'staff',
            client: userClient, // Cliente del usuario autenticado (evalúa RLS en PostgreSQL)
            user: staffAccess.user,
            solicitanteTipo: 'operador',
            solicitanteNombre: staffNombre,
            actorUserId: staffAccess.user.id
        },
        response: null
    };
}
