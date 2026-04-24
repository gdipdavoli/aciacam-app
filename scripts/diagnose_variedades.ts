
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function diagnose() {
    const email = 'mcvillacorta931@gmail.com';
    console.log(`Diagnosing for: ${email}`);

    // 1. Get Auth User
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
        console.error("Auth Error:", authError);
        return;
    }

    const user = users.find(u => u.email === email);

    if (!user) {
        console.log("❌ User not found in Supabase Auth.");
        return;
    } else {
        console.log(`✅ Found Auth User: ID [${user.id}]`);
        console.log(`   Metadata:`, user.user_metadata);
        console.log(`   App Metadata:`, user.app_metadata);
    }

    // 2. Search in Socios Table
    const { data: socio, error: socioError } = await supabase
        .from('socios')
        .select('*')
        .eq('email', email)
        .maybeSingle();

    if (socioError) {
        console.error("Socio Fetch Error:", socioError);
    } else if (!socio) {
        console.log("❌ Socio NOT found in DB for this email.");
    } else {
        console.log(`✅ Socio found: ID [${socio.id}], Name: ${socio.nombre} ${socio.apellido}`);
        console.log(`   Status: ${socio.status}`);
        console.log(`   Auth User ID in DB: ${socio.auth_user_id}`);
    }

    // 3. Check Products count (Active)
    const { count, error: countError } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('activo', true);
    
    console.log(`🔍 Active products in DB: ${count || 0}`);
}

diagnose();
