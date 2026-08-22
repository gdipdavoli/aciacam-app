import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

async function testResponse() {
    const id = '13c887f8-353b-4aef-a7dc-2681b68a0e63'; // Ramiro Santino Strella
    
    const { data: socio, error } = await supabaseAdmin
        .from('socios')
        .select(`
            status, 
            invited_at, 
            auth_user_id, 
            email, 
            terms_accepted_at,
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
        console.error('Socio not found', error);
        return;
    }

    let passwordSet = false;
    let userDetails = null;
    if (socio.auth_user_id) {
        const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(socio.auth_user_id);
        userDetails = user;
        if (user && !userError) {
            passwordSet = user.identities?.some(i => i.provider === 'email') ?? false;
        }
    }

    const invites = socio.socio_invites as any[] || [];
    const latestInvite = invites.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

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

    console.log('Result for widget API mock:');
    console.log(JSON.stringify({
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
    }, null, 2));
}

testResponse().catch(console.error);
