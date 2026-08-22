import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

async function testRenewal() {
    const socioId = '13c887f8-353b-4aef-a7dc-2681b68a0e63'; // Ramiro Strella
    console.log(`\n--- Starting Test for Socio: ${socioId} ---`);

    // 1. Fetch Socio
    const { data: socio, error: socioError } = await supabaseAdmin
        .from('socios')
        .select('email, status, invited_at, auth_user_id, password_set')
        .eq('id', socioId)
        .single();

    if (socioError || !socio) {
        console.error('Socio not found:', socioError);
        return;
    }

    console.log(`Current DB status: ${socio.status}, password_set in DB: ${socio.password_set}`);

    // 2. Fetch Latest Invite
    const { data: invites } = await supabaseAdmin
        .from('socio_invites')
        .select('*')
        .eq('socio_id', socioId)
        .order('created_at', { ascending: false });
    
    const latestInvite = invites && invites.length > 0 ? invites[0] : null;
    console.log(`Latest Invite token: ${latestInvite?.token}, status: ${latestInvite?.status}, consumed_at: ${latestInvite?.consumed_at}`);

    // 3. Check Auth Status
    let isAlreadyConfirmed = false;
    let existingAuthUser = null;

    if (socio.auth_user_id) {
        const { data: { user: fetchedUser } } = await supabaseAdmin.auth.admin.getUserById(socio.auth_user_id);
        existingAuthUser = fetchedUser;
    }

    if (existingAuthUser) {
        console.log(`Auth User exists. confirmed_at: ${existingAuthUser.confirmed_at}`);
        if (existingAuthUser.confirmed_at) {
            isAlreadyConfirmed = true;
        }
    }

    console.log(`isAlreadyConfirmed: ${isAlreadyConfirmed}`);

    // 4. Run Renewal Logic
    const isPasswordSet = socio.password_set || (latestInvite && latestInvite.consumed_at !== null) || (latestInvite && latestInvite.status === 'consumed');
    console.log(`isPasswordSet calculation: ${isPasswordSet}`);

    if (isAlreadyConfirmed && isPasswordSet) {
        console.log('❌ FAIL: User already has password, renewal should not be allowed.');
        return;
    }

    if (isAlreadyConfirmed && !isPasswordSet) {
        console.log('✅ PASS: User is confirmed but no password set. Triggering token renewal...');
        
        // Generate new token
        const customToken = crypto.randomUUID();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 72); // 3 days

        // Update Socio Record
        const { error: updateError } = await supabaseAdmin
            .from('socios')
            .update({
                status: 'invited',
                invited_at: new Date().toISOString()
            })
            .eq('id', socioId);

        if (updateError) {
            console.error('Error updating socio status:', updateError);
            return;
        }
        console.log('Socio record updated successfully.');

        // Insert new Invite token
        const { error: customInviteError } = await supabaseAdmin
            .from('socio_invites')
            .insert({
                socio_id: socioId,
                email: socio.email,
                token: customToken,
                expires_at: expiresAt.toISOString(),
                status: 'sent'
            });

        if (customInviteError) {
            console.error('Error inserting new invite token:', customInviteError);
            return;
        }
        console.log(`New token generated: ${customToken}`);
        console.log('Invitation link renewed successfully.');
    } else {
        console.log('User is not confirmed yet. A fresh invite would be generated via Supabase Auth.');
    }

    // 5. Verify status output
    console.log('\n--- Verifying invite-status output ---');
    const { data: updatedSocio } = await supabaseAdmin
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
        .eq('id', socioId)
        .single();

    if (updatedSocio) {
        const updatedInvites = updatedSocio.socio_invites as any[] || [];
        const newLatestInvite = updatedInvites.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
        
        const computedPasswordSet = !!updatedSocio.password_set || 
                                    (newLatestInvite && newLatestInvite.consumed_at !== null) || 
                                    (newLatestInvite && newLatestInvite.status === 'consumed');

        console.log('Widget API Status response would be:');
        console.log(JSON.stringify({
            socioActive: !!updatedSocio.terms_accepted_at || updatedSocio.status === 'active',
            passwordSet: computedPasswordSet,
            latestInvite: newLatestInvite ? {
                token: newLatestInvite.token,
                sent_at: newLatestInvite.created_at,
                expires_at: newLatestInvite.expires_at,
                computed_status: newLatestInvite.status
            } : null
        }, null, 2));
    }
}

testRenewal().catch(console.error);
