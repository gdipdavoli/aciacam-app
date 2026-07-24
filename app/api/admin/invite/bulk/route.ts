import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

export async function POST(req: Request) {
    try {
        const { socioIds, redirectTo: providedOrigin } = await req.json();

        if (!socioIds || !Array.isArray(socioIds) || socioIds.length === 0) {
            return NextResponse.json({ error: 'Missing or invalid socioIds' }, { status: 400 });
        }

        // 1. Verify Caller (RBAC)
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

        if (authError || !user) return NextResponse.json({ error: 'Invalid Token' }, { status: 401 });

        const metadataRole = user.app_metadata?.role || user.user_metadata?.role;
        const isAdminOrStaff = metadataRole === 'admin' || metadataRole === 'staff';

        if (!isAdminOrStaff) {
            const { data: callerSocio, error: roleError } = await supabaseAdmin
                .from('socios')
                .select('id, rol')
                .eq('auth_user_id', user.id)
                .single();

            if (roleError || !callerSocio || (callerSocio.rol !== 'admin' && callerSocio.rol !== 'staff')) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        // 2. Fetch Targets
        const { data: socios, error: sociosError } = await supabaseAdmin
            .from('socios')
            .select('id, email, status, invited_at, auth_user_id')
            .in('id', socioIds);

        if (sociosError || !socios) {
            return NextResponse.json({ error: 'Failed to fetch socios' }, { status: 500 });
        }

        const results = {
            succeeded: 0,
            failed: 0,
            skipped: 0,
            details: [] as any[]
        };

        const origin = providedOrigin || process.env.SITE_URL || req.headers.get('origin') || 'http://localhost:3000';
        const finalRedirectTo = `${origin}/auth/invite-callback`;

        // 3. Process Each
        for (const socio of socios) {
            // Checks
            if (!socio.email) {
                results.failed++;
                results.details.push({ id: socio.id, status: 'failed', reason: 'No email' });
                continue;
            }

            if (socio.auth_user_id) {
                // Check if they are actually confirmed/active
                const { data: { user: existingAuthUser } } = await supabaseAdmin.auth.admin.getUserById(socio.auth_user_id);
                
                if (existingAuthUser && existingAuthUser.confirmed_at) {
                    results.skipped++;
                    results.details.push({ id: socio.id, status: 'skipped', reason: 'Already active' });
                    continue;
                } else {
                    // Not confirmed or user not found in auth anymore (stale ref)
                    // Delete from auth so we can re-invite fresh
                    if (existingAuthUser) {
                        await supabaseAdmin.auth.admin.deleteUser(socio.auth_user_id);
                    }
                    // Continue to invitation logic below
                }
            }

            // Rate Limit
            if (socio.invited_at) {
                const lastInvite = new Date(socio.invited_at).getTime();
                const now = new Date().getTime();
                const diffMinutes = (now - lastInvite) / (1000 * 60);
                if (diffMinutes < 10) {
                    results.skipped++;
                    results.details.push({ id: socio.id, status: 'skipped', reason: 'Rate limit' });
                    continue;
                }
            }

            // Invite
            const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(socio.email, {
                redirectTo: finalRedirectTo
            });

            if (inviteError) {
                results.failed++;
                results.details.push({ id: socio.id, status: 'failed', reason: inviteError.message });
                continue;
            }

            const invitedUser = inviteData.user;

            // Update
            const { error: updateError } = await supabaseAdmin
                .from('socios')
                .update({
                    status: 'invited',
                    invited_at: new Date().toISOString(),
                    invited_by: user.id,
                    auth_user_id: invitedUser.id,
                    user_id: invitedUser.id // Sync user_id to avoid RLS/policy issues
                })
                .eq('id', socio.id);

            if (updateError) {
                // Log but count as success regarding the email sent? No, better warn.
                console.error("Failed to update socio status after invite", updateError);
                // We count success because user got email
            }

            // 6. Create custom invite record for "Copy Link" support
            const customToken = crypto.randomUUID();
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 72); // 3 days

            await supabaseAdmin
                .from('socio_invites')
                .insert({
                    socio_id: socio.id,
                    email: socio.email,
                    token: customToken,
                    expires_at: expiresAt.toISOString(),
                    status: 'sent',
                    created_by: user.id
                });

            // Audit
            await supabaseAdmin.from('audit_logs').insert({
                user_id: user.id,
                entity_type: 'SOCIO',
                entity_id: socio.id,
                action: 'INVITE_SOCIO_BULK',
                details: { inviter: user.id, target: socio.email }
            });

            results.succeeded++;
            results.details.push({ id: socio.id, status: 'success' });
        }

        return NextResponse.json(results);

    } catch (e: any) {
        console.error("Bulk Invite API Error:", e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
