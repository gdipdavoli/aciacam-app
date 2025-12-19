import { createClient } from '@supabase/supabase-js';
import { streamText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

// DEBUG: Zod Version
try {
    // @ts-ignore
    const zodPkg = require('zod/package.json');
    console.log("[API/Chat] Zod Version (Resolved):", zodPkg.version);
} catch (e) {
    console.log("[API/Chat] Zod Version: Could not require package.json");
}

export async function POST(req: Request) {
    // 1. Authenticate User
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
        console.error("[API/Chat] Missing Authorization header");
        return new Response('Unauthorized: Missing Header', { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error("[API/Chat] Configuration Error: Missing Supabase Env Vars");
        return new Response('Configuration Error: Missing API Keys', { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        console.error("[API/Chat] Auth Failed:", error?.message || "No user found");
        return new Response(`Unauthorized: Invalid Token (${error?.message || 'No user'})`, { status: 401 });
    }
    console.log("[API/Chat] Authenticated User:", user.id);

    // 2. Fetch Context (Socio Info) to personalize
    const { data: socio } = await supabase
        .from('socios')
        .select('*')
        .eq('user_id', user.id)
        .single();

    if (!socio) {
        return new Response('Socio not found', { status: 403 });
    }

    const { messages } = await req.json();

    const systemPrompt = `
    Eres el Asistente Virtual de ACIACAM (Club de Cultivo).
    Tu nombre es "Cogollito" (opcional, sé amable y servicial).
    Estás hablando con el socio: ${socio.nombre} ${socio.apellido}.
    
    Reglas:
    - Responde de forma concisa y amigable.
    - Si te preguntan por horarios: Lunes a Viernes 10-18hs.
    - Dirección: Calle Falsa 123.
    - Tienes herramientas para consultar el estado de los pedidos.
    - Si preguntan por pedidos, LLAMA a la herramienta checkOrderStatus() SIN Argumentos.
    `;

    const result = streamText({
        model: openai('gpt-4o-mini'),
        system: systemPrompt,
        messages,
        // @ts-ignore
        maxSteps: 5, // Allow server-side tool execution (Roundtrips)
        // tools: {
        //     checkOrderStatus: tool({
        //         description: 'Consultar el estado de los pedidos recientes del socio.',
        //         parameters: z.object({}), // EMPTY SCHEMA to test serialization
        //         execute: async (_args) => {
        //             console.log("[API/Chat] Tool 'checkOrderStatus' TRIGGERED (No Args)");
        //             const { data: orders } = await supabase
        //                 .from('pedidos')
        //                 .select('id, estado, tipo_pedido, items, created_at, slot_id, pickup_slots(start_time)')
        //                 .eq('socio_id', socio.id)
        //                 .order('created_at', { ascending: false })
        //                 .limit(3);

        //             if (!orders || orders.length === 0) {
        //                 return "No encontré pedidos recientes.";
        //             }

        //             return JSON.stringify(orders.map((o: any) => ({
        //                 id: o.id.slice(0, 8),
        //                 estado: o.estado,
        //                 items: o.items,
        //                 fecha: o.created_at,
        //                 turno: o.pickup_slots?.start_time
        //             })));
        //         },
        //     }),
        // },
    });

    console.log("[API/Chat] StreamText Result Keys:", Object.keys(result));

    // Check if result has toDataStreamResponse
    // @ts-ignore
    if (result.toDataStreamResponse) {
        // @ts-ignore
        return result.toDataStreamResponse();
    }

    // Fallback
    // @ts-ignore
    return result.toTextStreamResponse();
}
