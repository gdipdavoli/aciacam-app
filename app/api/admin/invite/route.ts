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
        const { socioId } = await req.json();

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

        // 4. Invite User (Supabase Auth)
        // If auth_user_id exists, we might normally use `generateLink` for password reset, 
        // but `inviteUserByEmail` is safer for "Welcome" flow. 
        // If user exists, Supabase typically sends a "Magic Link" or "Password Reset" if configured, 
        // or we catch the error if it says "User already registered".
        // Let's try invite first.

        // Determine Origin for Redirect
        const origin = process.env.SITE_URL || req.headers.get('origin') || 'http://localhost:3000';

        // Use Dedicated Invite Callback to force flow to /auth/set-password
        // This avoids query param stripping issues.
        const redirectTo = `${origin}/auth/invite-callback`;

        const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(socio.email, {
            redirectTo
        });

        if (inviteError) {
            console.error("Invite Error:", inviteError);
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

        // 6. Audit Log (Manual Insert)
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
