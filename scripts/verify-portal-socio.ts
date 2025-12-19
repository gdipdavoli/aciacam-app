
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env from .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Using service role to debug ALL records vs RLS
// OR use Anon key to test RLS? The user asked to verify "socio por user_id".
// If we use service key we bypass RLS. 
// Ideally we want to test IF the record exists first.

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE env vars.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TEST_USER_ID = process.env.TEST_USER_ID;

async function verify() {
    if (!TEST_USER_ID) {
        console.error("Please provide TEST_USER_ID env var.");
        process.exit(1);
    }

    console.log(`Verifying Socio for User ID: ${TEST_USER_ID}`);

    const { data, error, status } = await supabase
        .from('socios')
        .select('*')
        .eq('user_id', TEST_USER_ID)
        .maybeSingle();

    if (error) {
        console.error("Error fetching socio:", error);
    } else if (!data) {
        console.log("No socio found for this User ID (Unlinked).");
    } else {
        console.log("Socio Found ✅");
        console.log("- ID:", data.id);
        console.log("- Nombre:", data.nombre, data.apellido);
        console.log("- User ID in DB:", data.user_id);
    }
}

verify();
