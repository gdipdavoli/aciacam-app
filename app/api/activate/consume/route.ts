import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { token, access_token } = body;

        // 1. Check Auth Session using passed Access Token
        if (!access_token) {
            return NextResponse.json({ error: 'Unauthorized (Missing Token)' }, { status: 401 });
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        const { data: { user }, error: authError } = await supabase.auth.getUser(access_token);

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized (Invalid Token)' }, { status: 401 });
        }

        // 2. Validate Invite Token
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data: invite, error: inviteError } = await supabaseAdmin
            .from('socio_invites')
            .select('*, socios!inner(id, user_id)') // Join to check socio status
            .eq('token', token)
            .single();

        if (inviteError || !invite) {
            console.error('Invite lookup error', inviteError);
            return NextResponse.json({ error: 'Invalid invite token' }, { status: 400 });
        }

        // 2.a Validations
        if (invite.email.toLowerCase() !== user.email?.toLowerCase()) {
            return NextResponse.json({ error: 'Email mismatch. Please login with the invited email.' }, { status: 403 });
        }

        if (invite.consumet_at || invite.status === 'consumed') {
            return NextResponse.json({ error: 'Invite already used' }, { status: 400 });
        }

        if (new Date(invite.expires_at) < new Date()) {
            return NextResponse.json({ error: 'Invite expired' }, { status: 400 });
        }

        if (invite.socios.user_id) {
            // Socio already has a user. Check if it's the SAME user.
            if (invite.socios.user_id !== user.id) {
                return NextResponse.json({ error: 'Partner record already linked to another user.' }, { status: 409 });
            }
            // If same user, we can technically proceed to mark invite consumed if not already.
        }

        // 3. Link Socio & Mark Used

        // A. Link User ID to Socio (Only if null, or update password_set)
        const updateData: any = {};
        if (!invite.socios.user_id) {
            updateData.user_id = user.id;
        }
        if (body.password_set) {
            updateData.password_set = true;
        }

        if (Object.keys(updateData).length > 0) {
            const { error: linkError } = await supabaseAdmin
                .from('socios')
                .update(updateData)
                .eq('id', invite.socio_id);

            if (linkError) {
                console.error('Link/Update Error', linkError);
                return NextResponse.json({ error: 'Failed to update account link' }, { status: 500 });
            }
        }

        // B. Mark Token Used
        await supabaseAdmin
            .from('socio_invites')
            .update({
                used_at: new Date().toISOString(), // legacy
                consumed_at: new Date().toISOString(),
                status: 'consumed'
            })
            .eq('id', invite.id);

        return NextResponse.json({ success: true, redirect: '/portal' });

    } catch (e: any) {
        console.error('Consume Error', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
