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

        const { data: socio, error } = await supabaseAdmin
            .from('socios')
            .select(`
                status, 
                invited_at, 
                auth_user_id, 
                email, 
                terms_accepted_at,
                password_set,
                socio_invites!socio_invites_socio_id_fkey (
                    token,
                    created_at,
                    expires_at,
                    consumed_at,
                    status
                )
            `)
            .eq('id', id)
            .single();

        if (error || !socio) {
            return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
        }

        // Get latest invite from the join
        const invites = socio.socio_invites as any[] || [];
        const latestInvite = invites.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

        // Robust check for password configuration:
        // Either the password_set column on public.socios is true, 
        // OR the latest invite has a non-null consumed_at / status = consumed.
        const passwordSet = !!socio.password_set || 
                            (latestInvite && latestInvite.consumed_at !== null) || 
                            (latestInvite && latestInvite.status === 'consumed');

        // Compute Derived Status for Widget
        const invitedAt = socio.invited_at || latestInvite?.created_at;
        const diffMinutes = invitedAt ? (new Date().getTime() - new Date(invitedAt).getTime()) / (1000 * 60) : 0;

        let computedStatus = 'ready_to_invite';
        if (socio.terms_accepted_at) {
            computedStatus = 'active';
        } else if (latestInvite) {
            computedStatus = latestInvite.status || 'sent';
            if (new Date(latestInvite.expires_at) < new Date()) computedStatus = 'expired';
        } else if (socio.status === 'invited') {
            computedStatus = 'sent';
            if (diffMinutes > 60 * 24 * 7) computedStatus = 'expired'; 
        }

        return NextResponse.json({
            socioActive: !!socio.terms_accepted_at || socio.status === 'active',
            passwordSet,
            latestInvite: latestInvite ? {
                token: latestInvite.token,
                sent_at: latestInvite.created_at,
                expires_at: latestInvite.expires_at,
                computed_status: computedStatus
            } : socio.invited_at ? {
                sent_at: socio.invited_at,
                computed_status: computedStatus
            } : null,
            socioUserId: socio.auth_user_id
        });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
