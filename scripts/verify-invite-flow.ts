import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase Service Role credentials');
    process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function verifyInviteFlow() {
    console.log('--- Verification: Invite Flow ---');

    // 1. Pick a test socio (ensure consistency with previous diagnosis)
    const { data: socio, error: sErr } = await supabaseAdmin
        .from('socios')
        .select('*')
        .limit(1)
        .single();

    if (sErr || !socio) {
        console.error('No socio found to test with.');
        return;
    }

    console.log(`Testing with socio: ${socio.email} (${socio.id})`);

    // 2. Generate Invite Logic (Manually or via Fetching local API if server running, but purely script here)
    // We'll simulate what the API does to verify DB permissions/logic
    console.log('Creating invite in DB...');
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 72);

    const { error: inviteError } = await supabaseAdmin
        .from('socio_invites')
        .insert({
            socio_id: socio.id,
            email: socio.email,
            token: token,
            expires_at: expiresAt.toISOString(),
        });

    if (inviteError) {
        console.error('FAILED to insert invite:', inviteError);
        return;
    }
    console.log(`Invite created! Token: ${token}`);

    // 3. Validate Token Logic
    console.log('Validating token...');
    const { data: invite, error: vErr } = await supabaseAdmin
        .from('socio_invites')
        .select('*, socios(email)')
        .eq('token', token)
        .single();

    if (vErr || !invite) {
        console.error('FAILED to fetch/validate token');
        return;
    }

    if (invite.email === socio.email) {
        console.log('SUCCESS: Token valid and email matches.');
    } else {
        console.error('MISMATCH: Token email does not match.');
    }

    // Cleaning up test invite
    console.log('Cleaning up...');
    await supabaseAdmin.from('socio_invites').delete().eq('token', token);

    console.log('--- Verification End ---');
}

verifyInviteFlow();
