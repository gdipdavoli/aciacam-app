import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function backfill() {
    console.log("Starting notification backfill...");

    // 1. Get all notifications that have a pedidoId in metadata
    const { data: notifs, error } = await supabase
        .from('notificaciones')
        .select('*');

    if (error) {
        console.error("Error fetching notifications:", error);
        return;
    }

    // 2. Filter and group by Socio + Pedido
    const groups: Record<string, any[]> = {};

    notifs.forEach(n => {
        const pedidoId = n.metadata?.pedidoId || n.metadata?.orderId;
        if (pedidoId && n.socio_id) {
            const key = `${n.socio_id}_${pedidoId}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(n);
        }
    });

    console.log(`Found ${Object.keys(groups).length} order-related groups.`);

    for (const key in groups) {
        const items = groups[key].sort((a, b) => 
            new Date(a.fecha_creacion).getTime() - new Date(b.fecha_creacion).getTime()
        );

        const root = items[0];
        const children = items.slice(1);

        if (children.length > 0) {
            console.log(`Grouping ${children.length} messages under root ${root.id} for case ${key}`);
            
            // Update children to set parent_id
            for (const child of children) {
                if (child.parent_id === root.id) continue;
                
                const { error: updateError } = await supabase
                    .from('notificaciones')
                    .update({ parent_id: root.id })
                    .eq('id', child.id);
                
                if (updateError) console.error(`Failed to update ${child.id}:`, updateError);
            }
        }
    }

    console.log("Backfill completed.");
}

backfill();
