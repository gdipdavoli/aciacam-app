import { requireStaff } from '@/app/lib/agent/order-auth';
import { handleOrderAction } from '@/app/lib/agent/order-api';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { proposalStore } from '@/app/lib/agent/proposal-store';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    if (request.headers.get('origin') !== new URL(request.url).origin) {
        return NextResponse.json({ code: 'ORIGIN_FORBIDDEN' }, { status: 403 });
    }
    if (process.env.AGENT_CORE_ENABLED !== 'true' || process.env.AGENT_ORDER_EXECUTION_ENABLED !== 'true') {
        return NextResponse.json({ code: 'AGENT_ORDER_EXECUTION_DISABLED' }, { status: 503 });
    }
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
    const access = await requireStaff(request, admin);
    if (access.response) return access.response;
    if (!access.user || !access.userClient) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
    const proposal = await proposalStore.get((await params).id, access.userClient);
    if (!proposal?.grant?.grant_id) return NextResponse.json({ code: 'GRANT_NOT_FOUND' }, { status: 404 });
    const { data: grant, error } = await admin.from('action_grants').select('idempotency_key,operator_auth_user_id')
        .eq('grant_id', proposal.grant.grant_id).maybeSingle();
    if (error) return NextResponse.json({ code: 'GRANT_LOOKUP_UNAVAILABLE' }, { status: 503 });
    if (!grant || grant.operator_auth_user_id !== access.user.id) return NextResponse.json({ code: 'GRANT_ACTOR_MISMATCH' }, { status: 403 });
    const secret = process.env.AGENT_ORDER_CALLBACK_SECRET || process.env.AGENT_CORE_BFF_SECRET || '';
    const response = await handleOrderAction(new Request(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Core-Secret': secret, 'X-Delegated-Auth-User-Id': access.user.id },
        body: JSON.stringify({ ...proposal.details, grant_id: proposal.grant.grant_id,
            socio_id: proposal.socio_id, tipo_pedido: proposal.tipo_pedido, motivo: proposal.motivo,
            items: proposal.items.map(item => ({ productoId: item.productoId, cantidad: item.cantidad })),
            idempotency_key: grant.idempotency_key })
    }), 'execute', { enabled: true, s2sSecret: secret, admin: () => admin, authenticate: async () => null });
    for (const cookie of access.authResponse?.headers.getSetCookie() || []) response.headers.append('set-cookie', cookie);
    return response;
}
