
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { AgendaCommandParser } from '../app/lib/agenda/command-parser';
import { AgendaService } from '../app/lib/agenda/agenda-service';

async function main() {
    console.log('--- Testing Command Parser ---');

    const cases = [
        'AGENDA SET LUN 10:00-14:00 CAP 4',
        'Agenda Set MAR 16:00-20:00 Cap 10',
        'AGENDA GEN 2025-01',
        'AGENDA OFF 2024-12-25',
        'CONFIRMAR 12345678'
    ];

    for (const c of cases) {
        console.log(`Input: "${c}"`);
        console.log(JSON.stringify(AgendaCommandParser.parse(c), null, 2));
        console.log('---');
    }

    console.log('\n--- Testing Service Flow ---');
    const service = new AgendaService();

    // 1. Simulate User Input
    const input = 'AGENDA SET VIE 09:00-13:00 CAP 5';
    console.log(`User sends: ${input}`);
    const result = await service.processCommand(input, 'user-123');
    console.log('Bot replies:', result.message);

    if (result.status === 'preview' && result.message) {
        // Extract token (simple hack for test)
        const tokenMatch = result.message.match(/CONFIRM (.+)$/);
        if (tokenMatch) {
            const token = tokenMatch[1];
            console.log(`\nUser confirms with token: ${token}`);

            // 2. Simulate Confirmation
            const confirmInput = `CONFIRM ${token}`;
            const confirmResult = await service.processCommand(confirmInput, 'user-123');
            console.log('Bot final reply:', confirmResult.message);
        }
    }
}

main().catch(console.error);
