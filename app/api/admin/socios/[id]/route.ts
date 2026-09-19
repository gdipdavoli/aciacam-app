import { authenticate, hasStaffRole, requireStaff } from '@/app/lib/api-auth';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> } // Params is a Promise in Next 15+? Or strictly just { params } in generic.
    // In Next 13 App Dir, generic types for params are slightly tricky.
    // Let's use context generic.
) {
    try {
        const caller = await authenticate(request, supabaseAdmin);
        if (!caller) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        // Next.js 15 breaking change: params is a promise. 
        // We can await it.
        const { id } = await params;

        if (!id) {
            return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
        }

        const { data: socio, error } = await supabaseAdmin
            .from('socios_with_auth')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }

        if (socio.auth_user_id !== caller.id && socio.user_id !== caller.id && !await hasStaffRole(caller, supabaseAdmin)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
        return NextResponse.json(socio, { headers: { "Cache-Control": "private, no-store" } });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
// ... GET remains ...

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const access = await requireStaff(request, supabaseAdmin, true);
        if (access.response) return access.response;
        const user = access.user!;

        // 2. Fetch Target to get Auth ID
        const { data: targetSocio, error: fetchError } = await supabaseAdmin.from('socios').select('auth_user_id, email').eq('id', id).single();
        if (fetchError || !targetSocio) {
            return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
        }

        // 3. Delete Auth User (if linked)
        let authUserDeleted = false;
        if (targetSocio.auth_user_id) {
            const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(targetSocio.auth_user_id);
            if (!deleteAuthError) authUserDeleted = true;
            else console.error("Failed to delete auth user by ID", deleteAuthError);
        }

        // 3.1 Robust Cleanup: Search by email if not deleted yet
        if (!authUserDeleted && targetSocio.email) {
            const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
            if (!listError) {
                const orphanUser = users.find(u => u.email === targetSocio.email);
                if (orphanUser) {
                    console.log(`Clearing orphan auth user: ${orphanUser.id} for email ${targetSocio.email}`);
                    await supabaseAdmin.auth.admin.deleteUser(orphanUser.id);
                }
            }
        }

        // 4. Delete Socio Record
        const { error: deleteSocioError } = await supabaseAdmin.from('socios').delete().eq('id', id);
        if (deleteSocioError) throw deleteSocioError;

        // 5. Audit
        await supabaseAdmin.from('audit_logs').insert({
            user_id: user.id,
            action: 'DELETE_SOCIO',
            entity_type: 'SOCIO',
            entity_id: id,
            details: { email: targetSocio.email, deleted_auth_id: targetSocio.auth_user_id }
        });

        return NextResponse.json({ success: true });

    } catch (e: any) {
        console.error("Delete Error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
