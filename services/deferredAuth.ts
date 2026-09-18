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
