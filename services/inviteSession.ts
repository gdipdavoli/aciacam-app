import type { Session, SupabaseClient } from '@supabase/supabase-js';

// React may mount an effect twice. Never exchange a one-use link twice at once.
const pending = new WeakMap<SupabaseClient, Map<string, Promise<Session>>>();

export function resolveInviteSession(client: SupabaseClient, href: string): Promise<Session> {
    let requests = pending.get(client);
    if (!requests) {
        requests = new Map();
        pending.set(client, requests);
    }
    const existing = requests.get(href);
    if (existing) return existing;

    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<Session>((_, reject) => {
        timer = setTimeout(() => reject(new Error('La conexión está tardando demasiado. Revisá tu conexión y volvé a abrir el correo.')), 15000);
    });
    const request = Promise.race([resolve(client, new URL(href)), timeout]);
    requests.set(href, request);
    const clear = () => { clearTimeout(timer); requests.delete(href); };
    void request.then(clear, clear);
    return request;
}

async function resolve(client: SupabaseClient, url: URL): Promise<Session> {
    const hash = new URLSearchParams(url.hash.slice(1));
    const param = (name: string) => hash.get(name) || url.searchParams.get(name);

    // An invalid link must not silently reuse a different account's session.
    if (param('error') || param('error_code') || param('error_description')) {
        throw new Error('El enlace no es válido o ya fue utilizado. Solicitá un nuevo enlace para recuperar tu contraseña.');
    }

    const accessToken = param('access_token');
    const refreshToken = param('refresh_token');
    const code = url.searchParams.get('code');
    let result;
    if (accessToken || refreshToken) {
        if (!accessToken || !refreshToken) {
            throw new Error('El enlace está incompleto. Abrí el botón del correo original.');
        }
        result = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    } else if (code) {
        // The SSR browser client automatically exchanges PKCE codes on startup.
        // Wait for it, then only exchange manually if the code is still present.
        const initialization = await client.auth.initialize();
        if (initialization.error) throw new Error('No pudimos validar el enlace. Solicitá uno nuevo para recuperar tu contraseña.');
        const currentUrl = typeof window !== 'undefined' ? new URL(window.location.href) : url;
        const alreadyExchanged = currentUrl.origin === url.origin
            && currentUrl.pathname === url.pathname && !currentUrl.searchParams.has('code');
        result = alreadyExchanged
            ? await client.auth.getSession()
            : await client.auth.exchangeCodeForSession(code);
    } else {
        result = await client.auth.getSession();
    }

    if (result.error) throw new Error('No pudimos validar tu sesión. Solicitá un nuevo enlace para recuperar tu contraseña.');
    if (!result.data.session) throw new Error('SESSION_EXPIRED');
    return result.data.session;
}
