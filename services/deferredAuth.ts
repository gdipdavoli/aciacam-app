import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';

// Supabase invokes listeners while holding its auth lock. Defer database/auth
// work until the callback has returned, so it can acquire that lock normally.
export function onDeferredAuthStateChange(
    auth: SupabaseClient['auth'],
    handler: (event: AuthChangeEvent, session: Session | null) => Promise<void>,
    onError: (error: unknown) => void,
) {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
        const timer = setTimeout(() => {
            timers.delete(timer);
            void handler(event, session).catch(onError);
        }, 0);
        timers.add(timer);
    });
    return () => {
        subscription.unsubscribe();
        timers.forEach(clearTimeout);
        timers.clear();
    };
}

export interface SocioLike {
    id: string;
    auth_user_id?: string | null;
    rol?: string | null;
    estado?: string | null;
    terms_accepted_at?: string | null;
    nombre?: string | null;
    apellido?: string | null;
}

export function buildSocioIdentitySignature(
    socio: SocioLike | null | undefined,
    authRole?: string | null
): string {
    if (!socio) return '';
    return [
        socio.id,
        socio.auth_user_id ?? '',
        socio.rol ?? '',
        socio.estado ?? '',
        socio.terms_accepted_at ?? '',
        authRole ?? '',
    ].join('|');
}

export function shouldSkipProfileRefreshOnTokenEvent(params: {
    event: AuthChangeEvent;
    currentUserId: string | null;
    currentAuthRole: string | null;
    hasLoadedSocio: boolean;
    session: Session | null;
}): boolean {
    const nextUserId = params.session?.user?.id ?? null;
    if (!nextUserId || !params.hasLoadedSocio) return false;
    if (params.currentUserId !== nextUserId) return false;
    const nextAuthRole = (params.session?.user?.app_metadata?.role as string | undefined) ?? null;
    if (params.currentAuthRole !== nextAuthRole) return false;
    return params.event === 'TOKEN_REFRESHED';
}

export function resolveStableSocioState<T extends SocioLike>(
    prev: T | null,
    next: T,
    prevAuthRole?: string | null,
    nextAuthRole?: string | null
): T {
    if (!prev) return next;
    const prevSig = buildSocioIdentitySignature(prev, prevAuthRole);
    const nextSig = buildSocioIdentitySignature(next, nextAuthRole);
    if (prevSig && prevSig === nextSig) {
        return prev;
    }
    return next;
}
