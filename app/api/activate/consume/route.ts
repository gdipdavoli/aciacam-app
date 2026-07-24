import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { token, access_token, password } = body;

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } }
        );

        // 1. Validate Invite Token
        const { data: invite, error: inviteError } = await supabaseAdmin
            .from('socio_invites')
            .select('*, socios!inner(id, user_id, email, nombre, apellido)')
            .eq('token', token)
            .single();

        if (inviteError || !invite) {
            return NextResponse.json({ error: 'Token de invitación inválido o expirado' }, { status: 400 });
        }

        if (invite.consumed_at || invite.status === 'consumed') {
            return NextResponse.json({ error: 'La invitación ya ha sido utilizada' }, { status: 400 });
        }

        if (new Date(invite.expires_at) < new Date()) {
            return NextResponse.json({ error: 'La invitación ha expirado' }, { status: 400 });
        }

        let targetUserId: string | null = access_token ? null : null;

        // 2. Handle User Creation/Update
        if (!access_token && password) {
            // Flow A: No session, create user with password
            // Check if user already exists in Auth
            const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
            const existingAuthUser = users.find(u => u.email?.toLowerCase() === invite.email.toLowerCase());

            if (existingAuthUser) {
                // Update existing user password
                const { data: updatedUser, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
                    existingAuthUser.id,
                    { password: password, email_confirm: true }
                );
                if (updateError) throw updateError;
                targetUserId = existingAuthUser.id;
            } else {
                // Create new user
                const { data: { user: newUser }, error: createError } = await supabaseAdmin.auth.admin.createUser({
                    email: invite.email,
                    password: password,
                    email_confirm: true,
                    user_metadata: { 
                        role: 'socio',
                        full_name: `${invite.socios.nombre} ${invite.socios.apellido}`
                    }
                });
                if (createError) throw createError;
                targetUserId = newUser?.id || null;
            }
        } else if (access_token) {
            // Flow B: User already logged in (Magic Link or similar)
            const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(access_token);
            if (authError || !user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
            targetUserId = user.id;
        }

        if (!targetUserId) {
            return NextResponse.json({ error: 'No se pudo determinar el usuario de destino' }, { status: 500 });
        }

        // 3. Link Socio & Mark Invite as Consumed
        const socioUpdate: any = {
            auth_user_id: targetUserId,
            user_id: targetUserId, // Sync legacy user_id to avoid RLS and policy issues
            status: 'active',
            terms_accepted_at: new Date().toISOString() // Auto-accept terms on first activation for simplicity
        };
        
        if (body.password_set) {
            socioUpdate.password_set = true;
        }

        await supabaseAdmin.from('socios').update(socioUpdate).eq('id', invite.socio_id);

        await supabaseAdmin.from('socio_invites').update({
            consumed_at: new Date().toISOString(),
            status: 'consumed'
        }).eq('id', invite.id);

        return NextResponse.json({ success: true, message: 'Cuenta activada correctamente' });

    } catch (e: any) {
        console.error('Consume Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
