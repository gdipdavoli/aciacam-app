
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkProducts() {
    const { data: products, error } = await supabase
        .from('products')
        .select('*');

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Total products: ${products.length}`);
    products.forEach(p => {
        console.log(`- [${p.id}] ${p.nombre} (Activo: ${p.activo}, Stock: ${p.stock_disponible})`);
    });
}

checkProducts();
