import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    if (!token) {
        return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    // Check token existence and validity
    const { data: invite, error } = await supabaseAdmin
        .from('socio_invites')
        .select(`
            *,
            socios (
                nombre,
                apellido,
                email
            )
        `)
        .eq('token', token)
        .single();

    if (error || !invite) {
        return NextResponse.json({ valid: false, error: 'Invalid token' }, { status: 404 });
    }

    if (invite.used_at) {
        return NextResponse.json({ valid: false, error: 'Token already used' }, { status: 400 });
    }

    const now = new Date();
    const expires = new Date(invite.expires_at);

    if (now > expires) {
        return NextResponse.json({ valid: false, error: 'Token expired' }, { status: 400 });
    }

    return NextResponse.json({
        valid: true,
        email: invite.email,
        socioName: `${invite.socios.nombre} ${invite.socios.apellido}`
    });
}
