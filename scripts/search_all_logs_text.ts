import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function searchAllLogsText() {
    const orderIds = [
        'ef50ef27-368f-4ac2-b6d3-77e06e2e933a', // Saul
        '99c5a207-57cc-43b6-92ae-ccb0d4f195ff', // Molina
        '57fe2e4f-2058-488e-a56f-c5924581005e'  // Funes
    ];

    console.log("Searching all audit logs for references to the target order IDs...");

    const { data: logs, error } = await supabase
        .from('audit_logs')
        .select('*');

    if (error) {
        console.error("Error fetching all logs:", error);
        return;
    }

    console.log(`Searching through ${logs.length} total logs...`);
    let found = 0;
    logs.forEach(log => {
        const logStr = JSON.stringify(log);
        orderIds.forEach(id => {
            if (logStr.includes(id)) {
                found++;
                console.log(`Match found for order ID: ${id}`);
                console.log(`[${log.created_at}] Log:`, JSON.stringify(log, null, 2));
            }
        });
    });

    if (found === 0) {
        console.log("No audit logs refer to these order IDs.");
    }
}

searchAllLogsText();
