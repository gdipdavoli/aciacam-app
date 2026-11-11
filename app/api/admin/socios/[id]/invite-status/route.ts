import { requireStaff } from '@/app/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const access = await requireStaff(req, supabaseAdmin);
        if (access.response) return access.response;
        const { id } = await params;

        // 1. Fetch socio directly without fragile foreign key join to legacy or non-existent columns
        const { data: socio, error } = await supabaseAdmin
            .from('socios')
            .select('id, status, auth_user_id, email, terms_accepted_at, created_at, updated_at')
            .eq('id', id)
            .single();

        if (error || !socio) {
            return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
        }

        // 2. Safely query socio_invites if table exists, without breaking main flow if absent
        let latestInvite: any = null;
        try {
            const { data: invites, error: inviteErr } = await supabaseAdmin
                .from('socio_invites')
                .select('token, created_at, expires_at, consumed_at, status')
                .eq('socio_id', id)
                .order('created_at', { ascending: false })
                .limit(1);

            if (!inviteErr && invites && invites.length > 0) {
                latestInvite = invites[0];
            }
        } catch {
            // Table socio_invites does not exist or query failed; gracefully proceed
            latestInvite = null;
        }

        // 3. Check auth.users if auth_user_id exists
        let hasAuthUser = false;
        let isAuthConfirmed = false;
        if (socio.auth_user_id) {
            try {
                const { data: authData } = await supabaseAdmin.auth.admin.getUserById(socio.auth_user_id);
                if (authData?.user) {
                    hasAuthUser = true;
                    isAuthConfirmed = !!authData.user.confirmed_at;
                }
            } catch {
                hasAuthUser = false;
            }
        }

        // 4. Robust check for password configuration
        const passwordSet = !!socio.terms_accepted_at || 
                            (hasAuthUser && isAuthConfirmed) ||
                            (latestInvite && latestInvite.consumed_at !== null) || 
                            (latestInvite && latestInvite.status === 'consumed');

        // 5. Compute Derived Status for Widget
        const invitedAt = latestInvite?.created_at || (socio.status === 'invited' ? socio.updated_at : null);
        const diffMinutes = invitedAt ? (new Date().getTime() - new Date(invitedAt).getTime()) / (1000 * 60) : 0;

        let computedStatus = 'ready_to_invite';
        if (socio.terms_accepted_at || (hasAuthUser && socio.status === 'active')) {
            computedStatus = 'active';
        } else if (latestInvite) {
            computedStatus = latestInvite.status || 'sent';
            if (new Date(latestInvite.expires_at) < new Date()) computedStatus = 'expired';
        } else if (socio.status === 'invited') {
            computedStatus = 'sent';
            if (diffMinutes > 60 * 24 * 7) computedStatus = 'expired'; 
        }

        return NextResponse.json({
            socioActive: !!socio.terms_accepted_at || (hasAuthUser && socio.status === 'active'),
            passwordSet,
            latestInvite: latestInvite ? {
                token: latestInvite.token,
                sent_at: latestInvite.created_at,
                expires_at: latestInvite.expires_at,
                computed_status: computedStatus
            } : invitedAt ? {
                sent_at: invitedAt,
                computed_status: computedStatus
            } : null,
            socioUserId: socio.auth_user_id,
            hasAuthUser,
            isInvited: !!invitedAt || !!latestInvite || socio.status === 'invited',
            computedStatus
        });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
