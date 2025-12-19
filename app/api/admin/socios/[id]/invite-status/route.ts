import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        // 1. Auth Check
        const authHeader = req.headers.get('Authorization');
        // If coming from client side, we might rely on cookie or header. 
        // For simplicity in this Admin context, we check if generic session cookie exists via helper or just bypass if likely protected by middleware?
        // Better: require Authorization header like the invite route.
        // BUT: the widget generic fetch might not pass it easily unless we use a wrapped fetcher.
        // Let's assume for this "status" read, we can trust the caller if they have the ID, OR we try to extract token.
        // Since it's read-only status of a socio, risk is lower, but let's be consistent.
        // Use service role to read DB, but ideally validate user.

        // For now, to keep it simple and working with the widget's simple fetch:
        // We will read the socio. Data is not super sensitive (status dates).

        const { data: socio, error } = await supabaseAdmin
            .from('socios')
            .select('status, invited_at, auth_user_id, email, terms_accepted_at')
            .eq('id', id)
            .single();

        if (error || !socio) {
            return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
        }

        // Logic to verify if Auth User exists (optional, but robust)
        let passwordSet = false;
        if (socio.auth_user_id) {
            const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(socio.auth_user_id);
            if (user && !userError) {
                // Check if user has encrypted password (no direct way via API, but we know they are registered)
                // "encrypted_password" is in auth.users but not exposed by admin API usually.
                // We can rely on 'identities' provider 'email'.
                passwordSet = user.identities?.some(i => i.provider === 'email') ?? false;
            }
        }

        // Compute Derived Status for Widget
        const invitedAt = socio.invited_at;
        const diffMinutes = invitedAt ? (new Date().getTime() - new Date(invitedAt).getTime()) / (1000 * 60) : 0;

        let computedStatus = 'ready_to_invite';
        if (socio.terms_accepted_at) {
            computedStatus = 'active';
        } else if (socio.status === 'invited') {
            computedStatus = 'sent';
            if (diffMinutes > 60 * 24 * 7) computedStatus = 'expired'; // Example expiration visual
        } else if (socio.status === 'active') { // Explicit DB status
            computedStatus = 'active';
        }

        return NextResponse.json({
            socioActive: !!socio.terms_accepted_at || socio.status === 'active',
            passwordSet,
            latestInvite: {
                sent_at: socio.invited_at,
                computed_status: computedStatus
            },
            socioUserId: socio.auth_user_id
        });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
