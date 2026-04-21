
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function cleanUser() {
    const email = 'nicoganon@gmail.com';
    console.log(`\n🧹 Starting cleanup for: ${email}`);

    // 1. Get Auth User
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
        console.error("❌ Auth Error:", authError);
        return;
    }

    const user = users.find(u => u.email === email);

    if (user) {
        console.log(`✅ Found Auth User: ID [${user.id}]`);
        
        // Delete Auth User
        const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(user.id);
        if (deleteAuthError) {
            console.error(`❌ Error deleting Auth User:`, deleteAuthError);
        } else {
            console.log(`🚀 Deleted from Supabase Auth.`);
        }
    } else {
        console.log("ℹ️ No user found in Supabase Auth.");
    }

    // 2. Delete from Socios table
    console.log("Checking 'socios' table...");
    const { data: socios, error: sociosError } = await supabase
        .from('socios')
        .delete()
        .eq('email', email)
        .select();

    if (sociosError) {
        console.error(`❌ Error deleting from 'socios':`, sociosError);
    } else if (socios && socios.length > 0) {
        console.log(`🚀 Deleted ${socios.length} record(s) from 'socios' table.`);
    } else {
        console.log("ℹ️ No records found in 'socios' table.");
    }

    // 3. Delete from Invitations
    console.log("Checking 'socio_invites' table...");
    const { data: invites, error: invitesError } = await supabase
        .from('socio_invites')
        .delete()
        .eq('email', email)
        .select();

    if (invitesError) {
        console.error(`❌ Error deleting from 'socio_invites':`, invitesError);
    } else if (invites && invites.length > 0) {
        console.log(`🚀 Deleted ${invites.length} invite(s).`);
    } else {
        console.log("ℹ️ No records found in 'socio_invites' table.");
    }

    console.log("\n✨ Cleanup finished. The email is now free to be reused.");
}

cleanUser();
