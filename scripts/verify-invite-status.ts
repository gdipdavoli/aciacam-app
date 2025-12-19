import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkStatus() {
    console.log('--- Checking Invite Status ---');
    const { data: socios } = await supabaseAdmin.from('socios').select('id, email, user_id').limit(5);

    for (const s of socios || []) {
        console.log(`Socio: ${s.email} (Linked: ${!!s.user_id})`);

        // Check invites directly
        const { data: invites } = await supabaseAdmin
            .from('socio_invites')
            .select('*')
            .eq('socio_id', s.id)
            .order('created_at', { ascending: false });

        if (invites && invites.length > 0) {
            console.table(invites.map(i => ({
                status: i.status,
                expires: i.expires_at,
                sent: i.sent_at,
                consumed: i.consumed_at
            })));
        } else {
            console.log('  No invites found.');
        }
        console.log('------------------');
    }
}

checkStatus();
