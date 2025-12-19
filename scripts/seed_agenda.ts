
import { createClient } from '@supabase/supabase-js';
import { AgendaService } from '../app/lib/agenda/agenda-service';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Use Service Role for admin privileges
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing env vars");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const service = new AgendaService(supabase);

async function seed() {
    console.log("🌱 Seeding Agenda...");

    // 1. Define Rules: Mon-Fri, 14:00 - 18:00, Capacity 10
    const weekdays = ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'];

    for (const day of weekdays) {
        // e.g. "AGENDA SET LUN 14:00-18:00 CAP 10"
        const cmd = `AGENDA SET ${day} 14:00-18:00 CAP 10`;
        console.log(`Processing: ${cmd}`);

        const res = await service.processCommand(cmd, 'system-seed');
        if (res.status === 'preview' && res.message) {
            const tokenMatch = res.message.match(/CONFIRM (.+)$/);
            if (tokenMatch) {
                await service.processCommand(`CONFIRM ${tokenMatch[1]}`, 'system-seed');
                console.log(`✅ Confirmed rule for ${day}`);
            }
        }
    }

    // 2. Generate Slots for Current Month + Next Month
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM
    // Next month calculation
    const nextDate = new Date(now);
    nextDate.setMonth(now.getMonth() + 1);
    const nextMonth = nextDate.toISOString().slice(0, 7);

    const months = [currentMonth, nextMonth];

    for (const m of months) {
        const cmd = `AGENDA GEN ${m}`;
        console.log(`Generando slots para: ${m}`);
        const res = await service.processCommand(cmd, 'system-seed');

        if (res.status === 'preview' && res.message) {
            const tokenMatch = res.message.match(/CONFIRM (.+)$/);
            if (tokenMatch) {
                await service.processCommand(`CONFIRM ${tokenMatch[1]}`, 'system-seed');
                console.log(`✅ Slots generated for ${m}`);
            }
        } else {
            console.log("Respuesta inesperada al generar:", res);
        }
    }

    console.log("🌱 Seeding Complete.");
}

seed().catch(console.error);
