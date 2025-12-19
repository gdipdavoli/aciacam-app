import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Initialize Supabase Client (Service Role for admin access)
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;

export async function PATCH(
    req: NextRequest,
    context: { params: Promise<{ id: string, docType: string }> } // Correct type for async params in Next.js 15+
) {
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 });
    }

    try {
        const { id, docType } = await context.params;
        const body = await req.json();
        const { verificacion_estado, verificacion_obs, verificado_por } = body;

        // Strict Validation: Enum check
        const VALID_STATES = ['pendiente', 'aprobado', 'rechazado'];
        if (!VALID_STATES.includes(verificacion_estado)) {
            return NextResponse.json({
                error: `Invalid verificacion_estado. Must be one of: ${VALID_STATES.join(', ')}`
            }, { status: 400 });
        }

        const updates: any = {
            verificacion_estado,
            verificacion_obs,
            verificado_at: new Date().toISOString(),
            verificado_por: verificado_por || 'admin'
        };

        const { data, error } = await supabase
            .from('documentos_socio')
            .update(updates)
            .eq('socio_id', id)
            .eq('tipo', docType)
            .select();

        if (error) {
            console.error('Error updating verification:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, data }, { status: 200 });

    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
