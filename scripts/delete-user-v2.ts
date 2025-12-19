import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
    console.error('Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function deleteUser(email: string) {
    console.log(`Searching for user: ${email}...`);

    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
        console.error('Error listing users:', listError);
        return;
    }

    const user = users.find(u => u.email === email);

    if (!user) {
        console.log('User not found in Auth system.');
    } else {
        console.log(`Found Auth User: ${user.id}. Deleting...`);
        const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
        if (deleteError) {
            console.error('Error deleting auth user:', deleteError);
        } else {
            console.log('Auth user deleted successfully.');
        }
    }

    console.log('Cleaning up public.socios...');
    const { data: socio, error: findSocioError } = await supabase
        .from('socios')
        .select('id')
        .eq('email', email)
        .single();

    if (socio) {
        console.log(`Found Socio record: ${socio.id}. Deleting...`);
        const { error: deleteSocioError } = await supabase
            .from('socios')
            .delete()
            .eq('id', socio.id);

        if (deleteSocioError) {
            console.error('Error deleting socio record:', deleteSocioError);
        } else {
            console.log('Socio record deleted successfully.');
        }
    } else {
        console.log('No orphan socio record found.');
    }
}

const targetEmail = 'facundocampos@gmail.com';
deleteUser(targetEmail).catch(console.error);
