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
    try {
        const { socioId, redirectTo: providedOrigin } = await req.json();

        if (!socioId) {
            return NextResponse.json({ error: 'Missing socioId' }, { status: 400 });
        }

        // 1. Verify Caller (RBAC)
        // We need to parse accessibility from headers OR use `req.cookies` to get the JWT if we want strict verification.
        // However, standard Next.js API routes run server-side.
        // Best practice: Validate Access Token passed in Headers Authorization: Bearer <token>
        // OR rely on session cookie if passing from client component with credentials.

        // For robustness in this implementation step, we'll extract the user from the 'Authorization' header.
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

        if (authError || !user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 });
        }

        // Check Role: Must be 'admin' or 'staff'
        // Strategy: 
        // 1. Check app_metadata (Metadata assigned by Auth System/Triggers)
        // 2. Check public.socios (Linked Account)

        const metadataRole = user.app_metadata?.role || user.user_metadata?.role;
        const isAdminOrStaff = metadataRole === 'admin' || metadataRole === 'staff';

        if (!isAdminOrStaff) {
            // Fallback: Check public.socios (Single Source of Truth for migrated data)
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
            .select('email, status, invited_at, auth_user_id')
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

        // 4. Invite User (Supabase Auth) - WITH CLEAN START FOR RE-INVITES
        let targetAuthId = socio.auth_user_id;

        if (targetAuthId) {
            // Check current auth status
            const { data: { user: existingAuthUser } } = await supabaseAdmin.auth.admin.getUserById(targetAuthId);
            
            // If user exists but is NOT confirmed, delete them to allow a fresh invite
            if (existingAuthUser && !existingAuthUser.confirmed_at) {
                console.log(`API Invite: User ${targetAuthId} exists but not confirmed. Deleting for fresh start.`);
                await supabaseAdmin.auth.admin.deleteUser(targetAuthId);
                // We clear targetAuthId so we don't accidentally try to use it later
                targetAuthId = null;
            }
        }

        // Determine Origin for Redirect
        const origin = providedOrigin || process.env.SITE_URL || req.headers.get('origin') || 'http://localhost:3000';
        const finalRedirectTo = `${origin}/auth/invite-callback`;

        console.log(`API Invite: Sending invite to ${socio.email}`);
        const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(socio.email, {
            redirectTo: finalRedirectTo
        });

        if (inviteError) {
            console.error("Invite Error:", inviteError.message);
            
            // Fallback: If it still says "already registered", maybe they DID confirm but never set terms?
            // In that case, we should NOT delete them, but maybe send a password reset.
            // But for now, we follow the user's lead: "delete and recreate".
            return NextResponse.json({ error: inviteError.message }, { status: 500 });
        }

        const invitedUser = inviteData.user;

        // 5. Update Socio Record
        const { error: updateError } = await supabaseAdmin
            .from('socios')
            .update({
                status: 'invited',
                invited_at: new Date().toISOString(),
                invited_by: user.id, // Auth User ID of Admin
                auth_user_id: invitedUser.id // Link the Auth User
            })
            .eq('id', socioId);

        if (updateError) {
            throw updateError;
        }

        // 6. Create custom invite record for "Copy Link" support
        const customToken = crypto.randomUUID();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 72); // 3 days

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
                targetAuthUserId: invitedUser.id
            }
        });

        return NextResponse.json({ success: true, invited_at: new Date().toISOString() });

    } catch (e: any) {
        console.error("API Invite Error:", e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
