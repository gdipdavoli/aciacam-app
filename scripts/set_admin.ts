
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

const TARGET_EMAIL = process.argv[2];

if (!TARGET_EMAIL) {
    console.error("Please provide an email as argument.");
    process.exit(1);
}

async function setAdmin() {
    console.log(`Promoting user to ADMIN: ${TARGET_EMAIL}`);

    // 1. Find the socio by email
    const { data: socio, error: scanError } = await supabase
        .from('socios')
        .select('*')
        .eq('email', TARGET_EMAIL)
        .single();

    if (scanError || !socio) {
        console.error("❌ Socio not found with that email.");
        console.error(scanError);
        return;
    }

    console.log(`Found Auth User for Socio: ${socio.user_id}`);

    // 2. Update Auth User App Metadata
    const { data: user, error: updateError } = await supabase.auth.admin.updateUserById(
        socio.user_id,
        { app_metadata: { role: 'admin' } }
    );

    if (updateError) {
        console.error("❌ Failed to update auth metadata:", updateError);
    } else {
        console.log("✅ SUCCESS! User App Metadata set to role='admin'.");
        console.log("   (Please ensure AuthContext merges this metadata into the Socio object).");
    }
}

setAdmin();
