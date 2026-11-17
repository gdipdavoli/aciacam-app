import { requireStaff } from '@/app/lib/agent/order-auth';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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
        // 1. Validar autenticación JWT y rol staff/admin
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
        const reason = (body?.motivo || body?.reason || 'Rechazo administrativo por operador').trim();

        if (!reason) {
            return NextResponse.json({ error: 'El motivo de rechazo es obligatorio', code: 'REJECT_REASON_REQUIRED' }, { status: 400 });
        }

        // 2. Ejecutar rechazo institucional transaccional vía RPC
        const { data: rpcData, error: rpcError } = await staffClient.rpc('rechazar_propuesta_pedido', {
            p_proposal_id: proposalId,
            p_motivo: reason
        });

        if (rpcError) {
            const msg = rpcError.message || '';
            const code = rpcError.code || '';

            if (msg.includes('PROPOSAL_NOT_FOUND')) {
                return NextResponse.json({ error: msg, code: 'PROPOSAL_NOT_FOUND' }, { status: 404 });
            }
            if (msg.includes('PROPOSAL_ALREADY_EXECUTED')) {
                return NextResponse.json({ error: msg, code: 'PROPOSAL_ALREADY_EXECUTED' }, { status: 400 });
            }
            if (msg.includes('REJECT_INPUT_INVALID')) {
                return NextResponse.json({ error: msg, code: 'REJECT_INPUT_INVALID' }, { status: 400 });
            }
            if (msg.includes('FORBIDDEN') || code === '42501') {
                return NextResponse.json({ error: msg, code: 'FORBIDDEN' }, { status: 403 });
            }

            return NextResponse.json({ error: msg, code: 'RPC_ERROR' }, { status: 500 });
        }

        return NextResponse.json(rpcData, { status: 200 });

    } catch (e: any) {
        console.error('POST /api/admin/pedidos/proposals/[id]/reject error:', e);
        return NextResponse.json({ error: `Error interno: ${e.message}`, code: 'INTERNAL_ERROR' }, { status: 500 });
    }
}
