import { requireStaff } from '@/app/lib/agent/order-auth';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        if (request.headers.get('origin') !== new URL(request.url).origin) {
            return NextResponse.json({ code: 'ORIGIN_FORBIDDEN' }, { status: 403 });
        }
        // 1. Validar autenticación JWT y rol staff/admin en el servidor
        const access = await requireStaff(request, supabaseAdmin);
        if (access.response || !access.user) {
            return access.response || NextResponse.json({ error: 'No autorizado', code: 'UNAUTHORIZED' }, { status: 401 });
        }

        const staffClient = access.userClient;
        if (!staffClient) {
            return NextResponse.json({ error: 'Cliente autenticado del operador no disponible', code: 'UNAUTHORIZED' }, { status: 401 });
        }

        const resolvedParams = await Promise.resolve(params);
        const orderId = resolvedParams?.id;

        if (!orderId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
            return NextResponse.json({ error: 'Identificador de pedido inválido', code: 'INVALID_ORDER_ID' }, { status: 400 });
        }

        const body = await request.json().catch(() => ({}));
        const motivo = body?.motivo || 'Confirmación administrativa de pedido';

        // 2. Ejecución atómica y transaccional mediante la RPC invocada con el JWT autenticado del staff
        // FAIL-CLOSED: No se admite ningún fallback de escritura alternativa.
        const { data: rpcData, error: rpcError } = await staffClient.rpc('confirmar_pedido_administrativo_transaccional', {
            p_pedido_id: orderId,
            p_motivo: motivo
        });

        if (!rpcError && rpcData) {
            return NextResponse.json(rpcData, { status: 200 });
        }

        if (rpcError) {
            const msg = rpcError.message || '';
            const code = rpcError.code || '';

            // Migración no aplicada o función no existente en base de datos
            if (msg.includes('does not exist') || code === '42883') {
                return NextResponse.json({
                    error: 'La función transaccional de confirmación de pedidos no está disponible en la base de datos. Migración pendiente.',
                    code: 'MIGRATION_PENDING'
                }, { status: 500 });
            }

            if (msg.includes('ORDER_NOT_FOUND')) {
                return NextResponse.json({ error: msg, code: 'ORDER_NOT_FOUND' }, { status: 404 });
            }

            if (msg.includes('INVALID_STATE_TRANSITION')) {
                return NextResponse.json({ error: msg, code: 'INVALID_STATE_TRANSITION' }, { status: 400 });
            }

            if (msg.includes('FORBIDDEN') || code === '42501') {
                return NextResponse.json({ error: msg, code: 'FORBIDDEN' }, { status: 403 });
            }

            if (msg.includes('UNAUTHORIZED')) {
                return NextResponse.json({ error: msg, code: 'UNAUTHORIZED' }, { status: 401 });
            }

            return NextResponse.json({ error: msg, code: 'RPC_ERROR' }, { status: 500 });
        }

        return NextResponse.json({
            error: 'Respuesta inesperada al ejecutar transacción de confirmación de pedido.',
            code: 'TRANSACTION_ERROR'
        }, { status: 500 });

    } catch (e: any) {
        console.error('API /api/admin/pedidos/[id]/confirm error:', e);
        return NextResponse.json({ error: `Error interno: ${e.message}`, code: 'INTERNAL_ERROR' }, { status: 500 });
    }
}
