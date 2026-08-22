import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkOrderLogs() {
    const orderIds = [
        'ef50ef27-368f-4ac2-b6d3-77e06e2e933a', // Saul
        '88a6e549-b10c-4420-9ca1-9a53c36ee64d', // Delbon
        '99c5a207-57cc-43b6-92ae-ccb0d4f195ff', // Molina
        '57fe2e4f-2058-488e-a56f-c5924581005e'  // Funes
    ];

    console.log("Checking audit logs for these 4 orders...");

    const { data: logs, error } = await supabase
        .from('audit_logs')
        .select('*')
        .in('entity_id', orderIds);

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${logs.length} order audit logs:`);
    logs.forEach(log => {
        console.log(`[${log.created_at}] Action: ${log.action}, Order ID: ${log.entity_id}`);
        console.log(`- Details:`, JSON.stringify(log.details));
    });
}

checkOrderLogs();
