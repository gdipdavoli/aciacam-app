
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectProducts() {
    // Try to select from 'products' table
    const { data, error } = await supabase.from('products').select('*').limit(1);

    if (error) {
        console.log("❌ Error accessing 'products' table (likely doesn't exist):");
        console.log(error.message);
    } else {
        console.log("✅ 'products' table exists!");
        if (data.length > 0) {
            console.log("Keys:", Object.keys(data[0]));
        } else {
            console.log("Table allows access but is empty.");
        }
    }
}

inspectProducts();
