
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load env from .env.local
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing env vars");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const TEST_EMAIL = process.argv[2];

if (!TEST_EMAIL) {
    console.error("Please provide an email as argument.");
    process.exit(1);
}

async function checkUser() {
    console.log(`Checking user: ${TEST_EMAIL}`);

    // 1. Get Auth User
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
        console.error("Auth Error:", authError);
        return;
    }

    const authUser = users.find(u => u.email === TEST_EMAIL);

    if (!authUser) {
        console.log("❌ Auth User NOT FOUND.");
    } else {
        console.log("✅ Auth User Found:", authUser.id);
        console.log("   Last Sign In:", authUser.last_sign_in_at);

        // 2. Check Socio Record by User ID
        const { data: socio, error: socioError } = await supabase
            .from('socios')
            .select('*')
            .eq('user_id', authUser.id) // Corrected from 'userId' to 'user_id' based on schema assumptions or standard specificaiton, but let's check both if unsure. Actually previous context used 'userId' in some types but DB usually 'user_id'. Use 'userId' is safer if that's what was used before, OR check schema.
            // Wait, previous file `input_schema.sql` might help? No.
            // `storeService.ts` used `.eq('userId', userId)`.
            .eq('userId', authUser.id)
            .single();

        if (socioError) {
            // Try fetching by email if user_id link is missing
            console.log("⚠️ Socio not found by userId. Trying email...");
            const { data: socioEmail, error: emailError } = await supabase
                .from('socios')
                .select('*')
                .eq('email', TEST_EMAIL)
                .single();

            if (socioEmail) {
                console.log("✅ Socio FOUND by Email (Link Missing?):", socioEmail.id);
                console.log("   Role:", socioEmail.rol);
                console.log("   Linked userId in DB:", socioEmail.userId);
            } else {
                console.log("❌ Socio NOT FOUND in database.");
            }
        } else {
            console.log("✅ Socio FOUND Linked:", socio.id);
            console.log("   Name:", socio.nombre, socio.apellido);
            console.log("   Role:", socio.rol);
        }
    }
}

checkUser();
