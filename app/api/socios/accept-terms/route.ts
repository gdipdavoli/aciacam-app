import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: Request) {
    try {
        // 1. Authenticate Owner
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

        if (authError || !user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 });
        }

        // 2. Resolve Socio
        // First try strict link by ID
        let { data: socio, error: socioError } = await supabaseAdmin
            .from('socios')
            .select('id, status, email') // Added email to select
            .or(`auth_user_id.eq.${user.id},user_id.eq.${user.id}`)
            .maybeSingle();

        // 2b. Fallback: Lookup by Email (Self-Healing)
        // If the INVITE link logic failed to write auth_user_id, we trust the email from the verified Auth Session.
        if (!socio && user.email) {
            console.log(`AcceptTerms: Strict link failed for ${user.id}. Trying email fallback: ${user.email}`);
            const { data: socioByEmail } = await supabaseAdmin
                .from('socios')
                .select('id, status, email')
                .eq('email', user.email)
                .maybeSingle();

            if (socioByEmail) {
                console.log(`AcceptTerms: Found socio by email ${socioByEmail.id}. Healing link...`);
                // Heal the link immediately
                await supabaseAdmin.from('socios').update({ auth_user_id: user.id }).eq('id', socioByEmail.id);
                socio = socioByEmail;
            }
        }

        if (!socio) {
            return NextResponse.json({ error: 'Socio profile not found' }, { status: 404 });
        }

        // 3. Update DB
        const now = new Date().toISOString();
        const updates: any = {
            terms_accepted_at: now,
            terms_version: 'v1'
        };

        if (socio.status === 'invited' || socio.status === 'ready_to_invite') {
            updates.status = 'active';
        }

        const { error: updateError } = await supabaseAdmin
            .from('socios')
            .update(updates)
            .eq('id', socio.id);

        if (updateError) throw updateError;

        // 4. Update Auth Metadata (for fast checks in future)
        await supabaseAdmin.auth.admin.updateUserById(user.id, {
            app_metadata: {
                terms_accepted: true,
                terms_version: 'v1'
            }
        });

        // 5. Audit Log
        await supabaseAdmin.from('audit_logs').insert({
            user_id: user.id,
            actor_socio_id: socio.id,
            action: 'ACCEPT_TERMS',
            entity_type: 'SOCIO',
            entity_id: socio.id,
            details: { version: 'v1' }
        });

        return NextResponse.json({ success: true });

    } catch (e: any) {
        console.error("Accept Terms Error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
