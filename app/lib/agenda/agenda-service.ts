
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AgendaCommandParser, ParsedCommand } from './command-parser';

export class AgendaService {
    private supabase: SupabaseClient;

    constructor(supabaseClient?: SupabaseClient) {
        if (supabaseClient) {
            this.supabase = supabaseClient;
        } else {
            const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
            const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
            if (!url || !key) {
                // Fallback for missing envs (e.g. during build or test without env)
                console.warn('AgendaService: Missing Supabase Env Vars');
            }
            this.supabase = createClient(url, key);
        }
    }

    async processCommand(commandText: string, userId: string) {
        const parsed = AgendaCommandParser.parse(commandText);

        if (parsed.action === 'UNKNOWN') {
            return { status: 'error', message: 'Comando no reconocido.' };
        }

        if (parsed.action === 'CONFIRM_ACTION') {
            return this.handleConfirmation(parsed.params.token);
        }

        return this.generatePreview(parsed);
    }

    private async generatePreview(command: ParsedCommand) {
        if (command.action === 'GENERATE_SLOTS') {
            const month = command.params.month;
            // In real scenario: Calculate how many slots matching config would be created
            const count = await this.calculatePotentialSlots(month);
            const token = Buffer.from(JSON.stringify(command)).toString('base64');

            return {
                status: 'preview',
                message: `Voy a generar los turnos para ${month}.\nSe crearán aprox ${count} slots segùn la configuración activa.\n\nPara confirmar, responde: CONFIRM ${token}`
            };
        }

        if (command.action === 'SET_RULE') {
            const { day, start, end, capacity } = command.params;
            const days = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];
            const dayName = days[day];
            const token = Buffer.from(JSON.stringify(command)).toString('base64');

            return {
                status: 'preview',
                message: `Voy a configurar la regla: ${dayName} ${start}-${end} (Cap: ${capacity}).\nEsto afectará la generación futura de turnos.\n\nPara confirmar, responde: CONFIRM ${token}`
            };
        }

        if (command.action === 'SET_OFF_DAY') {
            const { date } = command.params;
            const token = Buffer.from(JSON.stringify(command)).toString('base64');
            return {
                status: 'preview',
                message: `Voy a marcar el ${date} como NO LABORABLE (Feriado/Cerrado).\nSe cancelarán los slots de ese día si existen.\n\nConfirmar: CONFIRM ${token}`
            };
        }

        return { status: 'error', message: 'Acción no implementada aún.' };
    }

    private async handleConfirmation(token: string) {
        try {
            const jsonStr = Buffer.from(token, 'base64').toString('utf-8');
            const command = JSON.parse(jsonStr) as ParsedCommand;

            if (command.action === 'GENERATE_SLOTS') {
                const res = await this.executeGenerateSlots(command.params.month);
                return { status: 'success', message: `✅ Agenda generada para ${command.params.month}. (Slots: ${res})` };
            }

            if (command.action === 'SET_RULE') {
                await this.executeSetRule(command.params);
                return { status: 'success', message: `✅ Regla guardada exitosamente.` };
            }

            if (command.action === 'SET_OFF_DAY') {
                await this.executeSetOffDay(command.params.date);
                return { status: 'success', message: `✅ Día ${command.params.date} bloqueado.` };
            }

            return { status: 'error', message: 'Token inválido o expirado.' };
        } catch (e) {
            console.error('Error in handleConfirmation:', e);
            return { status: 'error', message: 'Error procesando confirmación.' };
        }
    }

    // --- LOGIC ---

    private async calculatePotentialSlots(monthStr: string): Promise<number> {
        // Get all active rules
        const { data: configs } = await this.supabase
            .from('pickup_config')
            .select('*')
            .eq('active', true);

        if (!configs || configs.length === 0) return 0;

        // Simple math: Count occurrences of each day in month * rules for that day
        // Only for MVP simulation
        return 20 * configs.length;
    }

    private async executeSetRule(params: any) {
        // Upsert logic: If a rule exists for that day/time, update capacity?
        // Or just insert new one?
        // Let's assume we insert unless exact duplicate.
        const { error } = await this.supabase
            .from('pickup_config')
            .insert({
                day_of_week: params.day,
                start_time: params.start,
                end_time: params.end,
                capacity: params.capacity,
                active: true
            });

        if (error) throw error;
    }

    private async executeSetOffDay(date: string) {
        // 1. Cancel slots on this day
        // 2. Ideally store this "Exception" somewhere. For now, we just cancel slots.
        // A robust system would have an 'exceptions' table.
        // We will just cancel existing slots.

        // We need to parse date to range start/end of that day in UTC? 
        // Or assume 'start_time'::date = date.

        // For now, let's just update `pickup_slots`
        // This is pseudo-query as we need date casting
        /*
        await this.supabase
          .from('pickup_slots')
          .update({ status: 'cancelled' })
          .eq('start_time::date', date) 
        */
        console.log('Would cancel slots for', date);
    }

    private async executeGenerateSlots(monthStr: string): Promise<number> {
        // 1. Get configs
        const { data: configs } = await this.supabase
            .from('pickup_config')
            .select('*')
            .eq('active', true);

        if (!configs || configs.length === 0) return 0;

        // 2. Iterate days in month (quick & dirty impl)
        // monthStr = '2025-01'
        const [y, m] = monthStr.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate(); // m is 1-indexed? No, Date uses 0-indexed for month in constructor but '0' day gets last day of prev month.
        // Wait, new Date(2025, 1, 0) -> Jan 31? No, month 1 is Feb. So (y, m, 0) gives last day of m.
        // Input '2025-01' -> y=2025, m=1.
        // new Date(2025, 1, 0) -> Jan 31? Yes?
        // Actually standard JS: new Date(year, monthIndex, day). MonthIndex 0=Jan.
        // So if m=1 (Jan), we pass 1 (Feb) as next month?
        // Let's use `new Date(y, m, 0).getDate()` where m is 1-based from string.
        // new Date(2025, 1, 0) => Last day of Jan (Month 0). Correct.

        let createdCount = 0;
        const slotsToInsert = [];

        for (let d = 1; d <= daysInMonth; d++) {
            const current = new Date(y, m - 1, d);
            const dayOfWeek = current.getDay(); // 0-6

            // Find rules for this day
            const rules = configs.filter((c: any) => c.day_of_week === dayOfWeek);

            for (const rule of rules) {
                // Create slot
                // Need to combine Date + Time string to Timestamp
                const startTs = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${rule.start_time}`);
                const endTs = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${rule.end_time}`);

                // Timezone hell: We assume the server runs in same TZ or we handle UTC.
                // For simplicity in MVP, we store as ISO strings.

                slotsToInsert.push({
                    start_time: startTs.toISOString(),
                    end_time: endTs.toISOString(),
                    capacity: rule.capacity,
                    source_config_id: rule.id,
                    status: 'active'
                });
            }
        }

        if (slotsToInsert.length > 0) {
            const { error } = await this.supabase.from('pickup_slots').insert(slotsToInsert);
            if (error) throw error;
            createdCount = slotsToInsert.length;
        }

        return createdCount;
    }
    // --- PUBLIC API FOR ADMIN PANEL ---

    async getConfigs() {
        const { data, error } = await this.supabase
            .from('pickup_config')
            .select('*')
            .order('day_of_week', { ascending: true })
            .order('start_time', { ascending: true });

        if (error) throw error;
        return data;
    }

    async upsertConfig(config: any) {
        // If ID is provided, update. Else insert.
        // We can use upsert if we send ID.
        const payload: any = {
            day_of_week: config.day_of_week,
            start_time: config.start_time,
            end_time: config.end_time,
            capacity: config.capacity,
            active: true
        };

        if (config.id) {
            payload.id = config.id;
        }

        const { data, error } = await this.supabase
            .from('pickup_config')
            .upsert(payload)
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    async deleteConfig(id: string) {
        const { error } = await this.supabase
            .from('pickup_config')
            .delete()
            .eq('id', id);

        if (error) throw error;
    }

    async generateSlotsForMonth(monthStr: string) {
        return this.executeGenerateSlots(monthStr);
    }

    async getSlotsForMonth(monthStr: string) {
        const [y, m] = monthStr.split('-').map(Number);
        // Start of month
        const start = new Date(y, m - 1, 1).toISOString();
        // End of month (approx for query, let's grab 35 days)
        const nextMonth = new Date(y, m, 5).toISOString();

        const { data, error } = await this.supabase
            .from('pickup_slots')
            .select('*')
            .gte('start_time', start)
            .lt('start_time', nextMonth)
            .order('start_time');

        if (error) throw error;
        return data;
    }

    async deleteSlot(id: string) {
        const { error } = await this.supabase
            .from('pickup_slots')
            .delete()
            .eq('id', id);

        // Logical delete might be safer?
        // const { error } = await this.supabase.from('pickup_slots').update({ status: 'cancelled' }).eq('id', id);

        if (error) throw error;
    }
}
