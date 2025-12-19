
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClientServer() {
    const cookieStore = await cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    } catch {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
            },
        }
    );
}

// Optional: Admin client using Service Role, but we prefer checking Auth cookie first.
// If we need admin privileges (bypass RLS), we can use this, but better to use RLS with the user's session.
// However, the agenda tables might have RLS that requires specific roles.
// The policies I reviewed earlier check for 'admin' or 'staff' role in 'socios' table based on auth.uid().
// So using the standard client with the user's cookie is the CORRECT way (it respects RLS).
