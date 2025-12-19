import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; // Using Anon key as frontend would, or service role if checking hidden data

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
    console.log('--- Diagnosis Start ---');
    console.log(`Connecting to: ${supabaseUrl}`);

    // 1. Check 'socios' table count
    const { count, error: countError } = await supabase
        .from('socios')
        .select('*', { count: 'exact', head: true });

    if (countError) {
        console.error('Error counting socios:', countError.message);
        // If table doesn't exist, it might be named differently
        // We can't easily list tables with supabase-js unless we use rpc or just guess
    } else {
        console.log(`Total rows in 'socios': ${count}`);
    }

    // 2. Fetch a sample to check structure
    const { data: sample, error: sampleError } = await supabase
        .from('socios')
        .select('*')
        .limit(1);

    if (sampleError) {
        console.error('Error fetching sample:', sampleError.message);
    } else if (sample && sample.length > 0) {
        console.log('Sample row keys:', Object.keys(sample[0]).join(', '));
        // Check for typical filter fields
        const s = sample[0];
        console.log('Sample fields check:', {
            active: s.active,
            activo: s.activo,
            deleted_at: s.deleted_at,
            visible: s.visible,
            estado: s.estado
        });
    }

    console.log('--- Diagnosis End ---');
}

diagnose();
