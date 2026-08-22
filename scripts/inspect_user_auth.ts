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

async function inspectUser() {
    const email = 'Ramirostrella1@gmail.com';
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
    const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (!user) {
        console.log('User not found in Auth.');
        return;
    }

    console.log('=== Supabase Auth User Details ===');
    console.log(JSON.stringify(user, null, 2));

    console.log('\n=== Socio DB Record ===');
    const { data: socio } = await supabaseAdmin
        .from('socios')
        .select('*')
        .eq('email', email)
        .single();
    console.log(JSON.stringify(socio, null, 2));

    console.log('\n=== Invites DB Records ===');
    const { data: invites } = await supabaseAdmin
        .from('socio_invites')
        .select('*')
        .eq('email', email);
    console.log(JSON.stringify(invites, null, 2));
}

inspectUser().catch(console.error);
