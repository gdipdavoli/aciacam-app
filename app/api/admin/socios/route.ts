
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Initialize Supabase Admin Client
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
    try {
        // 1. Verify Authentication (Admin Only)
        // ... (existing comments)

        const { searchParams } = new URL(request.url);
        const role = searchParams.get('role');

        let query = supabaseAdmin
            .from('socios')
            .select('*, documentos:documentos_socio(tipo, estado, verificacion_estado, archivo_path)')
            .order('created_at', { ascending: false });

        if (role) {
            query = query.eq('rol', role);
        }

        const { data: socios, error } = await query;

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(socios);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
