
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // Use admin key to bypass RLS for existence check

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing env vars");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log("Checking pickup_slots table...");
    const { data, error } = await supabase.from('pickup_slots').select('count', { count: 'exact', head: true });

    if (error) {
        console.error("Error accessing table:", error);
    } else {
        console.log("Table exists. Count:", data); // valid response means table exists
        // Check active slots
        const { data: slots, error: slotsError } = await supabase.from('pickup_slots').select('*').limit(5);
        if (slotsError) console.error("Error fetching slots:", slotsError);
        else console.log("Sample slots:", slots);
    }
}

check();
