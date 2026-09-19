import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClientServer } from '@/app/lib/supabase/server';

export async function authenticate(request: Request, admin: SupabaseClient): Promise<User | null> {
    const header = request.headers.get('authorization');
    if (header) {
        if (!/^Bearer\s+\S+$/i.test(header)) return null;
        const { data, error } = await admin.auth.getUser(header.replace(/^Bearer\s+/i, ''));
        return error ? null : data.user;
    }
    const client = await createClientServer();
    const { data, error } = await client.auth.getUser();
    return error ? null : data.user;
}

export async function hasStaffRole(user: User, admin: SupabaseClient, adminOnly = false): Promise<boolean> {
    const allowed = adminOnly ? ['admin'] : ['admin', 'staff'];
    if (allowed.includes(user.app_metadata?.role)) return true;
    const { data, error } = await admin.from('socios').select('rol')
        .or(`auth_user_id.eq.${user.id},user_id.eq.${user.id}`).maybeSingle();
    if (error) throw new Error('No se pudieron verificar los permisos');
    return !!data && allowed.includes(data.rol);
}

export async function requireStaff(request: Request, admin: SupabaseClient, adminOnly = false) {
    const user = await authenticate(request, admin);
    if (!user) return { user: null, response: NextResponse.json({ error: 'Iniciá sesión para continuar' }, { status: 401 }) };
    if (!await hasStaffRole(user, admin, adminOnly)) return { user: null, response: NextResponse.json({ error: 'No tenés permisos para esta operación' }, { status: 403 }) };
    return { user, response: null };
}
