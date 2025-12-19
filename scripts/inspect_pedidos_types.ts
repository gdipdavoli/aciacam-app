
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectTypes() {
    console.log("Inspecting 'pedidos' column types...");

    // We can query the postgres information_schema via RPC if strict, but easiest is to try to verify via error or assumption,
    // OR just use a raw query if we had a function.
    // Since we don't have a SQL runner exposed as a tool other than running migration files, 
    // we can try to infer it or just assume the error is correct.

    // However, we CAN run a "smart" query using the client to infer type returned? 
    // No, JS client converts everything to JSON/JS types.

    // Better idea: Create a temp migration that logs or raises info? No.

    // Let's assume the error is correct. 'invalid input syntax for type date' 
    // means the target column IS of type DATE. 

    // We will verifying by trying to insert a proper DATE string.
    // If that works, then the column is DATE.
    // If that fails with "type mismatch", then it's something else.

    const { data: slots } = await supabase.from('pickup_slots').select('*').limit(1);
    const slotId = slots?.[0]?.id;
    const { data: socios } = await supabase.from('socios').select('*').limit(1);
    const socioId = socios?.[0]?.id;

    if (!slotId || !socioId) { console.log("No data"); return; }

    console.log("Attempting insert with ISO Date string...");
    const { error: isoError } = await supabase.from('pedidos').insert({
        socio_id: socioId,
        items: [],
        slot_id: slotId,
        fecha_retiro_preferida: new Date().toISOString().split('T')[0] // '2025-12-18'
    });

    if (isoError) {
        console.log("ISO Date Insert Failed:", isoError.message);
    } else {
        console.log("✅ ISO Date Insert Succeeded. The column is definitely DATE type.");
    }

    console.log("Attempting insert with Text string...");
    const { error: textError } = await supabase.from('pedidos').insert({
        socio_id: socioId,
        items: [],
        slot_id: slotId,
        fecha_retiro_preferida: "Texto Largo de Prueba"
    });

    if (textError) {
        console.log("❌ Text Insert Failed (Expected if type is DATE):", textError.message);
    } else {
        console.log("Text Insert Succeeded. The column is TEXT type.");
    }
}

inspectTypes();
