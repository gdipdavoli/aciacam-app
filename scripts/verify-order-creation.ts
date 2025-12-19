
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Use ANON key to simulate client-side RLS restrictions
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing env vars");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verify() {
    console.log("Verifying Order Creation as Client...");

    // 1. Login as Socio (We need a valid user token)
    // Since we can't easily login via script without credentials, 
    // we will try to use SERVICE key just to test constraints first.
    // IF service key works, then it IS an RLS issue.
    // IF service key fails, it IS a Constraint/Schema issue.

    const adminClient = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    console.log("--- Attempt 1: Service Role (Admin) ---");
    // Find a slot
    const { data: slots } = await adminClient.from('pickup_slots').select('*').limit(1);
    if (!slots || slots.length === 0) { console.error("No slots found to test."); return; }
    const slotId = slots[0].id;

    // Find a socio
    const { data: socios } = await adminClient.from('socios').select('*').limit(1);
    if (!socios || socios.length === 0) { console.error("No socios found to test."); return; }
    const socio = socios[0];

    console.log(`Testing with Socio: ${socio.id}, Slot: ${slotId}`);

    const { data, error } = await adminClient.from('pedidos').insert({
        socio_id: socio.id,
        tipo_pedido: 'retiro_sede',
        items: [{ "id": "test", "qty": 1 }],
        estado: 'pendiente',
        origen: 'script',
        slot_id: slotId
    }).select().single();

    if (error) {
        console.error("❌ Service Role Insert Failed:", error);
    } else {
        console.log("✅ Service Role Insert Success. Schema/Constraints are valid.");

        // Cleanup
        await adminClient.from('pedidos').delete().eq('id', data.id);
    }
}

verify();
