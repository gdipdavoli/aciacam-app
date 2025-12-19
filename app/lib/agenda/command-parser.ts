
export type AgendaAction =
    | 'SET_RULE'
    | 'ADD_RULE'
    | 'SHIFT_SLOT'
    | 'SET_OFF_DAY'
    | 'GENERATE_SLOTS'
    | 'CONFIRM_ACTION'
    | 'UNKNOWN';

export interface ParsedCommand {
    action: AgendaAction;
    params: any;
    raw: string;
}

export class AgendaCommandParser {

    static parse(text: string): ParsedCommand {
        const cleanText = text.trim();

        // 1. AGENDA SET [DIA] [HH:MM]-[HH:MM] CAP [N]
        // Ex: AGENDA SET LUN 10:00-14:00 CAP 4
        const setMatch = cleanText.match(/^AGENDA SET (LUN|MAR|MIE|JUE|VIE|SAB|DOM) (\d{1,2}:\d{2})-(\d{1,2}:\d{2}) CAP (\d+)$/i);
        if (setMatch) {
            return {
                action: 'SET_RULE',
                params: {
                    day: this.parseDay(setMatch[1].toUpperCase()),
                    start: setMatch[2],
                    end: setMatch[3],
                    capacity: parseInt(setMatch[4])
                },
                raw: text
            };
        }

        // 2. AGENDA GEN [YYYY-MM]
        // Ex: AGENDA GEN 2026-01
        const genMatch = cleanText.match(/^AGENDA GEN (\d{4}-\d{2})$/i);
        if (genMatch) {
            return {
                action: 'GENERATE_SLOTS',
                params: {
                    month: genMatch[1] // YYYY-MM
                },
                raw: text
            };
        }

        // 3. AGENDA OFF [YYYY-MM-DD]
        // Ex: AGENDA OFF 2025-12-24
        const offMatch = cleanText.match(/^AGENDA OFF (\d{4}-\d{2}-\d{2})$/i);
        if (offMatch) {
            return {
                action: 'SET_OFF_DAY',
                params: {
                    date: offMatch[1]
                },
                raw: text
            };
        }

        // 4. CONFIRMAR AGENDA [TOKEN]
        // Ex: CONFIRMAR AGENDA 1234
        // or just CONFIRM 1234
        // We use \S+ to capture the full token including potential base64 chars like = or +
        const confirmMatch = cleanText.match(/^(?:CONFIRMAR|CONFIRM)(?: AGENDA)? (\S+)$/i);
        if (confirmMatch) {
            return {
                action: 'CONFIRM_ACTION',
                params: {
                    token: confirmMatch[1] // Preserve case!
                },
                raw: text
            };
        }

        // TODO: Implement ADD, SHIFT as needed.

        return {
            action: 'UNKNOWN',
            params: {},
            raw: text
        };
    }

    private static parseDay(dayStr: string): number {
        const map: Record<string, number> = {
            'DOM': 0, 'LUN': 1, 'MAR': 2, 'MIE': 3, 'JUE': 4, 'VIE': 5, 'SAB': 6
        };
        return map[dayStr] ?? -1; // Should not happen due to regex
    }
}
