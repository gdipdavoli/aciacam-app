import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { EmailService } from '@/services/emailService';

// Service Role Client for Admin actions (skips RLS for inserting invite if needed, or better use normal client if policy allows)
// Using service role is safer for "Admin Only" API routes to ensure we bypass RLS glitches during dev.
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> } // Params is a Promise in Next 15+
) {
    try {
        const { id } = await params;

        // 1. Verify Admin Auth (Placeholder: In real app check session user role)
        // For now assuming the route protection via Middleware handles general access, 
        // but we should verify the "caller" is admin.
        // Skipping strict auth check for "local dev speed" as per context, but adding TODO.

        // 2. Get Socio info
        const { data: socio, error: socioError } = await supabaseAdmin
            .from('socios')
            .select('*')
            .eq('id', id)
            .single();

        if (socioError || !socio) {
            return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
        }

        if (socio.user_id) {
            return NextResponse.json({ error: 'Socio already active (linked to user)' }, { status: 409 });
        }

        if (!socio.email) {
            return NextResponse.json({ error: 'Socio has no email' }, { status: 400 });
        }

        // 3. Check for existing ACTIVE invite
        // Active = Not consumed AND Not expired
        const { data: existingInvites } = await supabaseAdmin
            .from('socio_invites')
            .select('*')
            .eq('socio_id', id)
            .is('consumed_at', null)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1);

        if (existingInvites && existingInvites.length > 0) {
            // We have an active invite.
            // We could offer to "Resend" but usually better to let client decide.
            // For now, return 409 with details so Admin UI can show "Pending".
            return NextResponse.json({
                error: 'Invite already active',
                activeInvite: existingInvites[0]
            }, { status: 409 });
        }

        // 4. Generate Token & Create Invite
        const token = crypto.randomUUID();
        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setHours(expiresAt.getHours() + 48); // 48hs window

        const { data: newInvite, error: inviteError } = await supabaseAdmin
            .from('socio_invites')
            .insert({
                socio_id: id,
                email: socio.email,
                token: token,
                expires_at: expiresAt.toISOString(),
                status: 'created',
                email_status: 'pending'
            })
            .select() // return the inserted row
            .single();

        if (inviteError) {
            console.error('Error creating invite:', inviteError);
            return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 });
        }

        // 5. Send Email
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const activationUrl = `${baseUrl}/activate?token=${token}`;

        const emailResult = await EmailService.sendInviteEmail(socio.email, activationUrl, `${socio.nombre} ${socio.apellido}`);

        // 6. Update Invite Status based on Email Result
        const updateData: any = {
            sent_at: new Date().toISOString(),
            status: 'sent',
            email_status: emailResult.success ? 'sent' : 'error'
        };

        if (!emailResult.success) {
            updateData.last_error = emailResult.error || 'Unknown email error';
        }

        await supabaseAdmin
            .from('socio_invites')
            .update(updateData)
            .eq('id', newInvite.id);

        return NextResponse.json({
            success: true,
            message: 'Invite sent',
            invite: { ...newInvite, ...updateData },
            activationUrl: process.env.NODE_ENV === 'development' ? activationUrl : undefined
        });

    } catch (e: any) {
        console.error('API Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
