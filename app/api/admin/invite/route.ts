import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Server-Role Supabase Client (Admin Access)
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

export async function POST(req: Request) {
    let invitedUser: any = null;
    let isAlreadyConfirmed = false;

    try {
        const { socioId, redirectTo: providedOrigin } = await req.json();

        if (!socioId) {
            return NextResponse.json({ error: 'Missing socioId' }, { status: 400 });
        }

        // 1. Verify Caller (RBAC)
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

        if (authError || !user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 });
        }

        const metadataRole = user.app_metadata?.role || user.user_metadata?.role;
        const isAdminOrStaff = metadataRole === 'admin' || metadataRole === 'staff';

        if (!isAdminOrStaff) {
            const { data: callerSocio, error: roleError } = await supabaseAdmin
                .from('socios')
                .select('id, rol')
                .eq('auth_user_id', user.id)
                .single();

            if (roleError || !callerSocio || (callerSocio.rol !== 'admin' && callerSocio.rol !== 'staff')) {
                return NextResponse.json({ error: 'Forbidden: Staff/Admin only' }, { status: 403 });
            }
        }

        // 2. Fetch Target Socio
        const { data: socio, error: socioError } = await supabaseAdmin
            .from('socios')
            .select('email, status, invited_at, auth_user_id, password_set')
            .eq('id', socioId)
            .single();

        if (socioError || !socio) {
            return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
        }

        if (!socio.email) {
            return NextResponse.json({ error: 'Socio has no email' }, { status: 400 });
        }

        // 3. Rate Limit (10 minutes)
        if (socio.invited_at) {
            const lastInvite = new Date(socio.invited_at).getTime();
            const now = new Date().getTime();
            const diffMinutes = (now - lastInvite) / (1000 * 60);
            if (diffMinutes < 10) {
                return NextResponse.json({ error: 'Please wait 10 minutes before re-inviting.' }, { status: 429 });
            }
        }

        // 4. Check status and handle confirmed/password state
        let targetAuthId = socio.auth_user_id;
        let existingAuthUser = null;

        if (targetAuthId) {
            const { data: { user: fetchedUser } } = await supabaseAdmin.auth.admin.getUserById(targetAuthId);
            existingAuthUser = fetchedUser;
        }

        // Self-healing: lookup by email if auth_user_id is not set
        if (!existingAuthUser && socio.email) {
            const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
            existingAuthUser = users.find(u => u.email?.toLowerCase() === socio.email.toLowerCase()) || null;
            if (existingAuthUser) {
                targetAuthId = existingAuthUser.id;
            }
        }

        if (existingAuthUser) {
            if (!existingAuthUser.confirmed_at) {
                console.log(`API Invite: User ${existingAuthUser.id} exists but not confirmed. Deleting for fresh start.`);
                await supabaseAdmin.auth.admin.deleteUser(existingAuthUser.id);
                targetAuthId = null;
                existingAuthUser = null;
            } else {
                isAlreadyConfirmed = true;
            }
        }

        // Fetch latest invites to check for consumption
        const { data: invites } = await supabaseAdmin
            .from('socio_invites')
            .select('status, consumed_at')
            .eq('socio_id', socioId)
            .order('created_at', { ascending: false });
        
        const latestInvite = invites && invites.length > 0 ? invites[0] : null;

        let customToken = crypto.randomUUID();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 72); // 3 days

        if (isAlreadyConfirmed) {
            const isPasswordSet = socio.password_set || (latestInvite && latestInvite.consumed_at !== null) || (latestInvite && latestInvite.status === 'consumed');
            
            if (isPasswordSet) {
                return NextResponse.json({ 
                    error: 'El socio ya está registrado y tiene clave configurada. Por favor, indíquele que ingrese con sus credenciales.' 
                }, { status: 400 });
            }

            console.log(`API Invite: User ${targetAuthId} is already confirmed but has no password set. Renewing token only.`);
            invitedUser = existingAuthUser;
        } else {
            // Determine Origin for Redirect
            const origin = providedOrigin || process.env.SITE_URL || req.headers.get('origin') || 'http://localhost:3000';
            const finalRedirectTo = `${origin}/auth/invite-callback`;

            console.log(`API Invite: Sending invite to ${socio.email}`);
            const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(socio.email, {
                redirectTo: finalRedirectTo
            });

            if (inviteError) {
                console.error("Invite Error:", inviteError.message);
                return NextResponse.json({ error: inviteError.message }, { status: 500 });
            }

            invitedUser = inviteData.user;
        }

        if (!invitedUser) {
            return NextResponse.json({ error: "Fallo al inicializar el usuario" }, { status: 500 });
        }

        // 5. Update Socio Record
        const { error: updateError } = await supabaseAdmin
            .from('socios')
            .update({
                status: 'invited',
                invited_at: new Date().toISOString(),
                invited_by: user.id, // Auth User ID of Admin
                auth_user_id: invitedUser.id, // Link the Auth User
                user_id: invitedUser.id // Sync user_id to avoid RLS/policy issues
            })
            .eq('id', socioId);

        if (updateError) {
            console.error("API Invite Error updating socio record:", updateError);
            if (!isAlreadyConfirmed && invitedUser?.id) {
                try {
                    await supabaseAdmin.auth.admin.deleteUser(invitedUser.id);
                    console.log(`API Invite Rollback: Deleted auth user ${invitedUser.id} due to socios update failure.`);
                } catch (rollbackErr) {
                    console.error("API Invite Rollback failed:", rollbackErr);
                }
            }
            return NextResponse.json({ error: `Error vinculando el socio: ${updateError.message}` }, { status: 500 });
        }

        // 6. Create custom invite record for "Copy Link" support

        const { error: customInviteError } = await supabaseAdmin
            .from('socio_invites')
            .insert({
                socio_id: socioId,
                email: socio.email,
                token: customToken,
                expires_at: expiresAt.toISOString(),
                status: 'sent',
                created_by: user.id
            });

        if (customInviteError) {
            console.error("Custom Invite Error:", customInviteError);
            // We don't fail the whole request if this fails, but it's bad.
        }

        // 7. Audit Log (Manual Insert)
        await supabaseAdmin.from('audit_logs').insert({
            user_id: user.id, // Actor
            entity_type: 'SOCIO',
            entity_id: socioId,
            action: 'INVITE_SOCIO',
            details: {
                inviterAuthUserId: user.id,
                socioEmail: socio.email,
                targetAuthUserId: invitedUser.id,
                renewedOnly: isAlreadyConfirmed
            }
        });

        return NextResponse.json({ success: true, invited_at: new Date().toISOString() });

    } catch (e: any) {
        console.error("API Invite Error:", e);
        if (invitedUser && !isAlreadyConfirmed && invitedUser.id) {
            try {
                await supabaseAdmin.auth.admin.deleteUser(invitedUser.id);
                console.log(`API Invite Rollback: Cleaned orphan auth user ${invitedUser.id} on error.`);
            } catch (rErr) {
                console.error("API Invite Rollback error:", rErr);
            }
        }
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
