import { requireStaff } from '@/app/lib/agent/order-auth';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        if (request.headers.get('origin') !== new URL(request.url).origin) {
            return NextResponse.json({ code: 'ORIGIN_FORBIDDEN' }, { status: 403 });
        }
        // 1. Validar autenticación JWT y rol staff/admin del operador humano
        const access = await requireStaff(request, supabaseAdmin);
        if (access.response || !access.user) {
            return access.response || NextResponse.json({ error: 'No autorizado', code: 'UNAUTHORIZED' }, { status: 401 });
        }

        const staffClient = access.userClient;
        if (!staffClient) {
            return NextResponse.json({ error: 'Cliente autenticado del operador no disponible', code: 'UNAUTHORIZED' }, { status: 401 });
        }

        const resolvedParams = await Promise.resolve(params);
        const proposalId = resolvedParams?.id;

        if (!proposalId) {
            return NextResponse.json({ error: 'Identificador de propuesta inválido', code: 'INVALID_PROPOSAL_ID' }, { status: 400 });
        }

        const body = await request.json().catch(() => ({}));
        const idempotencyKey = body?.idempotency_key || randomUUID();

        // 2. Control de vencimiento y renovación limpia de grant
        const { data: currentProp } = await supabaseAdmin
            .from('order_proposals')
            .select('status, grant_id, expires_at')
            .eq('proposal_id', proposalId)
            .maybeSingle();

        if (currentProp) {
            // Si la propuesta superó su ventana de revisión de 24h, rechazar de inmediato y marcar como expired
            if (currentProp.expires_at && new Date(currentProp.expires_at).getTime() <= Date.now()) {
                await supabaseAdmin
                    .from('order_proposals')
                    .update({
                        status: 'expired',
                        updated_at: new Date().toISOString()
                    })
                    .eq('proposal_id', proposalId);

                return NextResponse.json({
                    error: 'PROPOSAL_EXPIRED: La propuesta ha superado su ventana de revisión de 24h y se encuentra vencida',
                    code: 'PROPOSAL_EXPIRED'
                }, { status: 400 });
            }
        }

        // 3. Ejecutar aprobación humana transaccional institucional vía RPC
        const { data: rpcData, error: rpcError } = await staffClient.rpc('aprobar_propuesta_pedido', {
            p_proposal_id: proposalId,
            p_idempotency_key: idempotencyKey
        });

        if (rpcError) {
            const msg = rpcError.message || '';
            const code = rpcError.code || '';

            if (msg.includes('PROPOSAL_NOT_FOUND')) {
                return NextResponse.json({ error: msg, code: 'PROPOSAL_NOT_FOUND' }, { status: 404 });
            }
            if (msg.includes('PROPOSAL_EXPIRED')) {
                await supabaseAdmin
                    .from('order_proposals')
                    .update({
                        status: 'expired',
                        updated_at: new Date().toISOString()
                    })
                    .eq('proposal_id', proposalId);

                return NextResponse.json({ error: msg, code: 'PROPOSAL_EXPIRED' }, { status: 400 });
            }
            if (msg.includes('PROPOSAL_ALREADY_APPROVED')) {
                return NextResponse.json({ error: msg, code: 'PROPOSAL_ALREADY_APPROVED' }, { status: 409 });
            }
            if (msg.includes('APPROVED_CATALOGUE_CHANGED')) {
                return NextResponse.json({ error: msg, code: 'APPROVED_CATALOGUE_CHANGED' }, { status: 400 });
            }
            if (msg.includes('PROPOSAL_INVALID_STATE')) {
                return NextResponse.json({ error: msg, code: 'PROPOSAL_INVALID_STATE' }, { status: 400 });
            }
            if (msg.includes('IDEMPOTENCY_CONFLICT') || code === '23505') {
                return NextResponse.json({ error: msg, code: 'IDEMPOTENCY_CONFLICT' }, { status: 409 });
            }
            if (msg.includes('FORBIDDEN') || code === '42501') {
                return NextResponse.json({ error: msg, code: 'FORBIDDEN' }, { status: 403 });
            }

            return NextResponse.json({ error: msg, code: 'RPC_ERROR' }, { status: 500 });
        }

        return NextResponse.json(rpcData, { status: 200 });

    } catch (e: any) {
        console.error('API /api/admin/pedidos/proposals/[id]/approve error:', e);
        return NextResponse.json({ error: `Error interno: ${e.message}`, code: 'INTERNAL_ERROR' }, { status: 500 });
    }
}
