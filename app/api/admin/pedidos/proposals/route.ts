import { NextResponse } from 'next/server';
import { proposalStore, mapRowToProposal } from '@/app/lib/agent/proposal-store';
import { OrderProposalItem } from '@/types/order-approval';
import { randomUUID } from 'crypto';
import { authenticateProposalsRequest } from '@/app/lib/agent/proposals-auth';

export async function GET(request: Request) {
    try {
        const auth = await authenticateProposalsRequest(request);
        if (!auth.success) {
            return auth.response;
        }

        // Consultar propuestas persistidas respetando RLS del cliente correspondiente al contexto
        const proposals = await proposalStore.listAll(auth.context.client);

        return NextResponse.json({ proposals }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (e: any) {
        console.error('GET /api/admin/pedidos/proposals error:', e);
        return NextResponse.json({ error: e.message || 'Error al consultar propuestas' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const auth = await authenticateProposalsRequest(request);
        if (!auth.success) {
            return auth.response;
        }

        const { context } = auth;

        const body = await request.json().catch(() => null);
        if (!body || !body.socio_id || !body.items || !Array.isArray(body.items) || body.items.length === 0) {
            return NextResponse.json({ error: 'Payload de propuesta incompleto', code: 'INVALID_INPUT' }, { status: 400 });
        }

        // 2. Consultar socio en base de datos usando el cliente correspondiente al contexto
        const { data: socio, error: socioErr } = await context.client
            .from('socios')
            .select('id, nombre, apellido, dni, email, status, bloqueado, envios_habilitados')
            .eq('id', body.socio_id)
            .maybeSingle();

        if (socioErr || !socio) {
            return NextResponse.json({ error: 'Socio no encontrado', code: 'SOCIO_NOT_FOUND' }, { status: 404 });
        }

        if (socio.bloqueado) {
            return NextResponse.json({ error: 'El socio se encuentra bloqueado administrativamente', code: 'SOCIO_BLOCKED' }, { status: 403 });
        }

        if (socio.status !== 'active') {
            return NextResponse.json({ error: `El socio no está activo (estado: ${socio.status})`, code: 'SOCIO_INACTIVE' }, { status: 403 });
        }

        const tipoPedido = body.tipo_pedido || 'retiro_sede';
        if (tipoPedido === 'delivery' && !socio.envios_habilitados) {
            return NextResponse.json({ error: 'El socio no tiene envíos a domicilio habilitados', code: 'DELIVERY_DISABLED' }, { status: 403 });
        }

        // 3. Consultar productos y stock disponible usando el cliente correspondiente al contexto
        const prodIds = body.items.map((i: any) => i.productoId || i.id);
        const { data: products, error: prodErr } = await context.client
            .from('products')
            .select('id, nombre, stock_disponible, peso_gramos, tipo')
            .in('id', prodIds);

        if (prodErr || !products) {
            return NextResponse.json({ error: 'Error al consultar catálogo de productos', code: 'CATALOGUE_ERROR' }, { status: 500 });
        }

        const prodMap = new Map<string, any>(products.map(p => [p.id, p]));
        const proposalItems: OrderProposalItem[] = [];
        let totalFlores = 0;
        let totalGoteros = 0;
        let allStockSufficient = true;
        const errors: string[] = [];

        for (const it of body.items) {
            const pid = it.productoId || it.id;
            const qty = Number(it.cantidad || it.quantity || 1);
            const p = prodMap.get(pid);

            if (!p) {
                return NextResponse.json({ error: `Producto no encontrado: ${pid}`, code: 'PRODUCT_NOT_FOUND' }, { status: 400 });
            }

            const avail = Number(p.stock_disponible || 0);
            const sufficient = avail >= qty;
            if (!sufficient) {
                allStockSufficient = false;
                errors.push(`Stock insuficiente para ${p.nombre}. Solicitado: ${qty}, Disponible: ${avail}`);
            }

            const peso = Number(p.peso_gramos || 0);
            if (p.tipo === 'flor') totalFlores += qty * peso;
            if (p.tipo === 'gotero') totalGoteros += qty;

            proposalItems.push({
                productoId: p.id,
                productoNombre: p.nombre,
                cantidad: qty,
                stockDisponible: avail,
                suficiente: sufficient,
                pesoGramosUnitario: peso,
                subtotalGramos: qty * peso,
                tipo: p.tipo === 'flor' ? 'flor' : p.tipo === 'gotero' ? 'gotero' : 'otro'
            });
        }

        // Límites legales Res. 800/2021 (máx 40g flores / 6 goteros)
        const legalCompliant = totalFlores <= 40 && totalGoteros <= 6;
        if (!legalCompliant) {
            errors.push(`Excede el límite legal de transporte de la Res. 800/2021 (Flores: ${totalFlores}g/40g, Goteros: ${totalGoteros}/6).`);
        }

        const idempotencyKey = body.idempotency_key || randomUUID();
        const details = {
            direccion_entrega: body.direccion_entrega || body.details?.direccion_entrega || null,
            localidad: body.localidad || body.details?.localidad || null,
            fecha_retiro: body.fecha_retiro || body.details?.fecha_retiro || null,
            franja_horaria: body.franja_horaria || body.details?.franja_horaria || null,
            slot_id: body.slot_id || body.details?.slot_id || null,
            observaciones: body.observaciones || body.details?.observaciones || null
        };

        const validation = {
            valid: allStockSufficient && legalCompliant,
            stock_sufficient: allStockSufficient,
            legal_transport_compliant: legalCompliant,
            total_flores_gramos: totalFlores,
            total_goteros_unidades: totalGoteros,
            warnings: [],
            errors,
            verified_at: new Date().toISOString()
        };

        // 4. Crear la propuesta exclusivamente mediante la RPC transaccional institucional
        // solicitanteTipo y solicitanteNombre provienen estrictamente del contexto autenticado (Anti-Spoofing)
        const { data: rpcData, error: rpcErr } = await context.client.rpc('crear_propuesta_pedido', {
            p_socio_id: socio.id,
            p_items: proposalItems,
            p_tipo_pedido: tipoPedido,
            p_motivo: (body.motivo || 'Propuesta estructurada preparada para dispensa').trim(),
            p_idempotency_key: idempotencyKey,
            p_solicitante_tipo: context.solicitanteTipo,
            p_solicitante_nombre: context.solicitanteNombre,
            p_details: details,
            p_validation: validation
        });

        if (rpcErr) {
            const msg = rpcErr.message || '';
            const code = rpcErr.code || '';

            if (msg.includes('IDEMPOTENCY_CONFLICT') || code === '23505') {
                return NextResponse.json({ error: msg, code: 'IDEMPOTENCY_CONFLICT' }, { status: 409 });
            }
            if (msg.includes('SOCIO_UNAVAILABLE') || msg.includes('STATUS_INACTIVE') || msg.includes('SOCIO_INACTIVE')) {
                return NextResponse.json({ error: msg, code: 'SOCIO_UNAVAILABLE' }, { status: 403 });
            }
            if (msg.includes('DELIVERY_DISABLED')) {
                return NextResponse.json({ error: msg, code: 'DELIVERY_DISABLED' }, { status: 403 });
            }
            if (msg.includes('FORBIDDEN') || code === '42501') {
                return NextResponse.json({ error: msg, code: 'FORBIDDEN' }, { status: 403 });
            }

            return NextResponse.json({ error: msg, code: 'PROPOSAL_CREATION_FAILED' }, { status: 400 });
        }

        const rawProposal = rpcData?.proposal;
        const mappedProposal = rawProposal ? mapRowToProposal({ ...rawProposal, target_socio: socio }) : rawProposal;

        return NextResponse.json({
            success: true,
            deduplicated: Boolean(rpcData?.deduplicated),
            proposal: mappedProposal
        }, { status: 201 });

    } catch (e: any) {
        console.error('POST /api/admin/pedidos/proposals error:', e);
        return NextResponse.json({ error: e.message || 'Error al preparar propuesta' }, { status: 500 });
    }
}
