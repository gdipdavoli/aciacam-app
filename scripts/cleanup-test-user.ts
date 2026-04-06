import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const targetEmail = 'elvolcandippuerto@gmail.com';

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

async function cleanupUser(email: string) {
    console.log(`--- Diagnóstico y Limpieza para: ${email} ---`);

    // 1. Auth Cleanup
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
        console.error('Error listing users:', listError);
    } else {
        const user = users.find(u => u.email === email);
        if (user) {
            console.log(`[AUTH] Encontrado usuario ID: ${user.id}. Borrando...`);
            const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(user.id);
            if (deleteAuthError) console.error('[AUTH] Error al borrar:', deleteAuthError);
            else console.log('[AUTH] Borrado exitoso.');
        } else {
            console.log('[AUTH] No se encontró el usuario por el email.');
        }
    }

    // 2. Socio Cleanup
    const { data: socios, error: searchSocioError } = await supabase
        .from('socios')
        .select('id, auth_user_id')
        .eq('email', email);

    if (searchSocioError) {
        console.error('[SOCIOS] Error buscando:', searchSocioError);
    } else if (socios && socios.length > 0) {
        console.log(`[SOCIOS] Encontrados ${socios.length} registros para este email. Limpiando...`);
        for (const s of socios) {
            // Delete associated pagos first (just in case cascade wasn't set or failed)
            console.log(`[SOCIOS] Borrando registros de la tabla pagos para socio: ${s.id}`);
            await supabase.from('pagos').delete().eq('socio_id', s.id);
            
            // Delete socio
            const { error: deleteSocioError } = await supabase.from('socios').delete().eq('id', s.id);
            if (deleteSocioError) console.error(`[SOCIOS] Error borrando ID ${s.id}:`, deleteSocioError);
            else console.log(`[SOCIOS] Socio ID ${s.id} borrado.`);
        }
    } else {
        console.log('[SOCIOS] No se encontraron registros huérfanos.');
    }

    console.log('--- Limpieza Finalizada ---');
}

cleanupUser(targetEmail).catch(console.error);
