import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup env vars before importing service
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function verify() {
    console.log('--- Verification Start ---');
    console.log('Env loaded, NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'OK' : 'MISSING');

    try {
        // Dynamic import to ensure env vars are loaded before client init
        const { StoreService } = await import('../services/storeService');

        console.log('Fetching socios via StoreService...');
        const socios = await StoreService.getAllSocios();

        console.log(`Total Socios returned: ${socios.length}`);

        if (socios.length > 0) {
            console.log('First Socio:', {
                id: socios[0].id,
                name: `${socios[0].nombre} ${socios[0].apellido}`,
                dni: socios[0].dni,
                active: socios[0].activo
            });
        } else {
            console.warn('WARNING: Returns 0 socios. Check if mock data is used or DB is empty.');
        }

        if (socios.length >= 39) {
            console.log('SUCCESS: Retrieved expected number of socios.');
        } else {
            console.log('FAILURE: Retrieved fewer than expected (39).');
        }

    } catch (e) {
        console.error('Verification failed with error:', e);
    }
    console.log('--- Verification End ---');
}

verify();
