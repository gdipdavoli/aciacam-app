
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { AgendaService } from '@/app/lib/agenda/agenda-service';

// Initialize Supabase Admin for looking up users
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseLink = createClient(supabaseUrl, supabaseKey);

const agendaService = new AgendaService(supabaseLink);

export async function POST(req: Request) {
    try {
        // Adapt input based on Provider (Twilio, Meta, or Generic)
        // For now, handling Generic JSON: { From: "+549...", Body: "AGENDA SET..." }
        // If it's URL Encoded (Twilio), we might need formData()

        let sender = '';
        let message = '';

        const contentType = req.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            const body = await req.json();
            sender = body.From || body.from;
            message = body.Body || body.message || body.text;
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
            const formData = await req.formData();
            sender = formData.get('From') as string;
            message = formData.get('Body') as string;
        }

        if (!sender || !message) {
            return NextResponse.json({ error: 'Missing From or Body' }, { status: 400 });
        }

        console.log(`[WhatsApp] Msg from ${sender}: ${message}`);

        // 1. Authenticate Sender
        // Normalize phone: remove non-digits? 
        // Assuming DB stores standardized phones.
        // We'll try exact match or contains.

        const { data: user, error } = await supabaseLink
            .from('socios')
            .select('id, rol, nombre')
            .or(`telefono.eq.${sender},telefono.eq.+${sender.replace(/\+/g, '')}`) // Try with/without +
            .single();

        if (error || !user) {
            console.warn(`[WhatsApp] Unauthorized sender: ${sender}`);
            // Start a session or ignore? For staff bot, ignore or reply "Unauthorized".
            // We reply generic to avoid leaking info, or simple error.
            return NextResponse.json({ body: '⛔ Lo siento, no estás autorizado para operar este bot.' });
        }

        if (!['admin', 'staff'].includes(user.rol)) {
            return NextResponse.json({ body: '⛔ Solo personal autorizado.' });
        }

        // 2. Process Command
        const response = await agendaService.processCommand(message, user.id);

        // 3. Return Response for WhatsApp to send back
        // Twilio expects XML? Or just text if using a proxy?
        // Let's return JSON and assume the "Bot Connector" handles the format.
        // Or if direct Twilio TwiML:
        // <Response><Message>...</Message></Response>

        return NextResponse.json({
            reply: response.message
        });

    } catch (e: any) {
        console.error('[WhatsApp] Error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
