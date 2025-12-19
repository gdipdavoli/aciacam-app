
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('id');

    if (!userId) {
        return NextResponse.json({ error: 'Missing user id' }, { status: 400 });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('socios')
            .select('*')
            // Match verify against auth_user_id (new) OR user_id (legacy)
            .eq('user_id', userId)
            .maybeSingle();

        if (error) {
            console.error('Error fetching socio by user id:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        if (!data) {
            // Not found (404) is a valid state (unlinked user)
            return NextResponse.json(null, { status: 404 });
        }

        return NextResponse.json(data);

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
