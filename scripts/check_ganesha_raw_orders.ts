import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkGaneshaRawOrders() {
    const orderIds = [
        'ef50ef27-368f-4ac2-b6d3-77e06e2e933a', // Saul
        '88a6e549-b10c-4420-9ca1-9a53c36ee64d', // Delbon
        '99c5a207-57cc-43b6-92ae-ccb0d4f195ff', // Molina
        '57fe2e4f-2058-488e-a56f-c5924581005e'  // Funes
    ];

    console.log("Checking raw database rows for Ganesha orders...");

    const { data: orders, error } = await supabase
        .from('pedidos')
        .select('*')
        .in('id', orderIds);

    if (error) {
        console.error("Error:", error);
        return;
    }

    orders.forEach(order => {
        console.log(`\nOrder ID: ${order.id}`);
        console.log(`- estado: ${order.estado}`);
        console.log(`- tipo_pedido: ${order.tipo_pedido}`);
        console.log(`- origen: ${order.origen}`);
        console.log(`- created_at: ${order.created_at}`);
        console.log(`- updated_at: ${order.updated_at}`);
    });
}

checkGaneshaRawOrders();
