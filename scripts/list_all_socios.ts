import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

async function listAll() {
    console.log('Fetching Supabase Auth Users...');
    const { data: { users }, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    if (authError) {
        console.error('Error fetching auth users:', authError);
        return;
    }

    console.log('Fetching socios table records...');
    const { data: socios, error: sociosError } = await supabaseAdmin
        .from('socios')
        .select('id, nombre, apellido, email, status, auth_user_id, user_id, updated_at');
    
    if (sociosError) {
        console.error('Error fetching socios:', sociosError);
        return;
    }

    console.log('Fetching socio_invites...');
    const { data: invites, error: invitesError } = await supabaseAdmin
        .from('socio_invites')
        .select('*');

    if (invitesError) {
        console.error('Error fetching invites:', invitesError);
    }

    console.log('\n================ SOCIOS IN DATABASE ================');
    const authUsersMap = new Map(users.map(u => [u.id, u]));
    const authUsersByEmail = new Map(users.map(u => [u.email?.toLowerCase(), u]));

    const report = socios?.map(s => {
        const authUserById = s.auth_user_id ? authUsersMap.get(s.auth_user_id) : null;
        const authUserByEmail = s.email ? authUsersByEmail.get(s.email.toLowerCase()) : null;
        const authUser = authUserById || authUserByEmail;

        const matchingInvites = invites?.filter(i => i.socio_id === s.id) || [];
        const latestInvite = matchingInvites.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

        return {
            ID: s.id,
            Nombre: `${s.nombre || ''} ${s.apellido || ''}`.trim(),
            Email: s.email,
            DB_Status: s.status,
            DB_AuthID: s.auth_user_id,
            DB_UserID: s.user_id,
            Auth_ID: authUser?.id || 'N/A',
            Auth_Email: authUser?.email || 'N/A',
            Auth_Confirmed: authUser?.confirmed_at ? 'YES' : 'NO',
            Auth_LastSignIn: authUser?.last_sign_in_at || 'N/A',
            LatestInvite_Status: latestInvite ? latestInvite.status : 'None',
            LatestInvite_Consumed: latestInvite ? (latestInvite.consumed_at ? 'YES' : 'NO') : 'N/A',
            LatestInvite_Token: latestInvite ? latestInvite.token : 'N/A',
            LatestInvite_Expires: latestInvite ? latestInvite.expires_at : 'N/A'
        };
    });

    console.table(report);

    console.log('\n================ AUTH USERS NOT IN SOCIOS TABLE ================');
    const sociosAuthIds = new Set(socios?.map(s => s.auth_user_id).filter(Boolean));
    const sociosEmails = new Set(socios?.map(s => s.email?.toLowerCase()).filter(Boolean));
    
    const unmatchedAuthUsers = users.filter(u => !sociosAuthIds.has(u.id) && !sociosEmails.has(u.email?.toLowerCase()));
    if (unmatchedAuthUsers.length > 0) {
        console.table(unmatchedAuthUsers.map(u => ({
            ID: u.id,
            Email: u.email,
            Confirmed: u.confirmed_at ? 'YES' : 'NO',
            Created: u.created_at
        })));
    } else {
        console.log('None.');
    }
}

listAll().catch(console.error);
