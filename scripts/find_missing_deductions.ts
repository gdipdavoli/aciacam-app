import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function findMissingDeductions() {
    console.log("Finding all delivered/retirado orders that have NO corresponding product audit logs...");

    // 1. Fetch all delivered/retirado orders
    const { data: orders, error: ordersError } = await supabase
        .from('pedidos')
        .select(`
            *,
            socio:socios!socio_id(nombre, apellido)
        `)
        .in('estado', ['entregado', 'retirado']);

    if (ordersError) {
        console.error("Error fetching orders:", ordersError);
        return;
    }

    // 2. Fetch all product audit logs
    const { data: logs, error: logsError } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('entity_type', 'PRODUCT');

    if (logsError) {
        console.error("Error fetching audit logs:", logsError);
        return;
    }

    // Create a set of all order IDs referenced in the audit logs
    const referencedOrderIds = new Set<string>();
    logs.forEach(log => {
        const details = log.details || {};
        const orderId = details.order_id || details.after?.last_audit_order_id || details.before?.last_audit_order_id;
        if (orderId) {
            referencedOrderIds.add(orderId);
        }
        // Also scan text just in case
        const logStr = JSON.stringify(log);
        orders.forEach(order => {
            if (logStr.includes(order.id)) {
                referencedOrderIds.add(order.id);
            }
        });
    });

    console.log(`Total delivered/retirado orders: ${orders.length}`);
    console.log(`Referenced order IDs in audit logs: ${referencedOrderIds.size}`);

    const missingOrders: any[] = [];
    orders.forEach(order => {
        if (!referencedOrderIds.has(order.id)) {
            missingOrders.push(order);
        }
    });

    console.log(`\nFound ${missingOrders.length} orders with MISSING stock audit logs:`);
    missingOrders.forEach(order => {
        const name = order.socio ? `${order.socio.nombre} ${order.socio.apellido}` : 'Desconocido';
        console.log(`- [${order.created_at}] ID: ${order.id} | Socio: ${name} | Status: ${order.estado} | Items: ${JSON.stringify(order.items)}`);
    });
}

findMissingDeductions();
