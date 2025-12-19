
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function diagnose() {
    const email = 'gdipdavoli@gmail.com';
    console.log(`Diagnosing for: ${email}`);

    // 1. Get Auth User
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
        console.error("Auth Error:", authError);
        return;
    }

    const user = users.find(u => u.email === email);

    if (!user) {
        console.log("❌ User not found in Supabase Auth.");
    } else {
        console.log(`✅ Found Auth User: ID [${user.id}]`);
        console.log(`   Metadata:`, user.user_metadata);
        console.log(`   App Metadata:`, user.app_metadata);
    }

    // 2. Search in Socios Table by Email
    console.log("Searching 'socios' by email...");
    const { data: sociosByEmail, error: errorEmail } = await supabase
        .from('socios')
        .select('*')
        .eq('email', email);

    if (sociosByEmail && sociosByEmail.length > 0) {
        sociosByEmail.forEach(s => {
            console.log(`   Found Socio [${s.id}] with email: ${s.email}`);
            console.log(`     -> user_id column: ${s.user_id}`);
        });
    } else {
        console.log("   No socios found by email.");
    }

    // 3. Search in Socios Table by Auth User ID (if found)
    if (user) {
        console.log(`Searching 'socios' by user_id [${user.id}]...`);
        const { data: sociosByUserId, error: errorId } = await supabase
            .from('socios')
            .select('*')
            .eq('user_id', user.id);

        if (sociosByUserId && sociosByUserId.length > 0) {
            sociosByUserId.forEach(s => {
                console.log(`   Found Socio [${s.id}] linked to user_id.`);
            });
        } else {
            console.log("   ❌ No socios linked to this Auth User ID.");
        }
    }

    // 4. Check Invitations
    console.log("Searching 'socio_invites'...");
    const { data: invites } = await supabase
        .from('socio_invites')
        .select('*')
        .eq('email', email);

    if (invites && invites.length > 0) {
        invites.forEach(i => {
            console.log(`   Found Invite for Socio ID [${i.socio_id}] (Token: ${i.token})`);
        });
    }

}

diagnose();
