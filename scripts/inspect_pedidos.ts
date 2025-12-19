
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log("Inspecting 'pedidos' columns...");

    // We can't easily select columns metadata via generic client without raw SQL or RPC,
    // but we can try to insert a dummy row with slot_id and see error, 
    // or select * limit 1 and look at keys.

    // Attempt 1: Select generic
    const { data, error } = await supabase.from('pedidos').select('*').limit(1);

    if (error) {
        console.error("Error reading pedidos:", error);
    } else if (data && data.length > 0) {
        console.log("Keys in first row:", Object.keys(data[0]));
        if ('slot_id' in data[0]) console.log("✅ slot_id column found.");
        else console.error("❌ slot_id column NOT found in returned row (might be null).");
    } else {
        console.log("Table empty. Trying to insert dry-run...");
    }

    // Attempt 2: Insert with slot_id to see if it complains about column not found
    // We accept failure, just want to see IF it is "Column not found"

    try {
        const { error: insertError } = await supabase.from('pedidos').insert({
            socio_id: '00000000-0000-0000-0000-000000000000', // invalid FK likely
            items: [],
            tipo_pedido: 'retiro_sede',
            slot_id: '00000000-0000-0000-0000-000000000000'
        });

        if (insertError) {
            console.log("Insert Error:", insertError.message);
        }
    } catch (e) {
        console.log("Exception:", e);
    }
}

inspect();
