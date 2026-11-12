import { requireStaff } from '@/app/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Cliente administrativo seguro aislado para verificaciones y consultas con service_role
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

// Estados canónicos activos y finalizados
const ACTIVE_STATUSES = ['pendiente', 'en_preparacion', 'confirmado', 'en_camino', 'listo_para_retiro'];
const FINALIZED_STATUSES = ['entregado', 'retirado', 'cancelado'];

export async function GET(request: Request) {
    try {
        // 1. Validar autenticación JWT y rol staff/admin en el servidor
        const access = await requireStaff(request, supabaseAdmin);
        if (access.response) return access.response;

        const { searchParams } = new URL(request.url);

        // Parámetros de consulta
        const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
        const limitParam = parseInt(searchParams.get('limit') || '15', 10);
        const maxAllowedLimit = (searchParams.get('legacy') === 'true' || limitParam > 100) ? 1000 : 100;
        const limit = Math.min(maxAllowedLimit, Math.max(1, isNaN(limitParam) ? 15 : limitParam));
        
        const statusParam = (searchParams.get('status') || 'active').trim();
        const origenParam = searchParams.get('origen') || 'all';
        const tipoPedidoParam = searchParams.get('tipoPedido') || 'all';
        const desdeParam = searchParams.get('desde');
        const hastaParam = searchParams.get('hasta');
        const search = (searchParams.get('search') || '').trim();
        const sortBy = searchParams.get('sortBy') || 'created_at';
        const sortDir = (searchParams.get('sortDir') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
        const includeArchived = searchParams.get('includeArchived') === 'true' || statusParam === 'archived';
        const isLegacy = searchParams.get('legacy') === 'true';

        // 2. Calcular conteos globales para las pestañas (conjunto completo no paginado)
        const { data: allStatuses, error: countError } = await supabaseAdmin
            .from('pedidos')
            .select('estado, archivado');

        const counts = {
            all: 0,
            active: 0,
            en_preparacion: 0,
            finalized: 0,
            archived: 0
        };

        if (!countError && allStatuses) {
            allStatuses.forEach((p: any) => {
                if (p.archivado) {
                    counts.archived++;
                } else {
                    counts.all++;
                    if (ACTIVE_STATUSES.includes(p.estado)) counts.active++;
                    if (p.estado === 'en_preparacion') counts.en_preparacion++;
                    if (FINALIZED_STATUSES.includes(p.estado)) counts.finalized++;
                }
            });
        }

        // 3. Si hay término de búsqueda, resolver primero identificadores de socios coincidentes
        let matchedSocioIds: string[] | null = null;
        let isUuidSearch = false;

        if (search) {
            // Verificar si el término de búsqueda es un UUID directo de pedido
            isUuidSearch = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search);

            // Búsqueda en socios por nombre, apellido o DNI
            const safeSearch = search.replace(/[%_,]/g, '');
            if (safeSearch.length > 0) {
                const { data: sociosFound } = await supabaseAdmin
                    .from('socios')
                    .select('id')
                    .or(`nombre.ilike.%${safeSearch}%,apellido.ilike.%${safeSearch}%,dni.ilike.%${safeSearch}%`);

                matchedSocioIds = (sociosFound || []).map((s: any) => s.id);
            }
        }

        // 4. Construir la consulta principal sobre 'pedidos'
        let query = supabaseAdmin
            .from('pedidos')
            .select(`
                *,
                socio:socios(
                    id,
                    nombre,
                    apellido,
                    dni,
                    email,
                    telefono,
                    status,
                    rol
                )
            `, { count: 'exact' });

        // Filtro de archivado
        if (statusParam === 'archived') {
            query = query.eq('archivado', true);
        } else if (!includeArchived) {
            query = query.or('archivado.is.null,archivado.eq.false');
        }

        // Filtro por Estado
        if (statusParam === 'active') {
            query = query.in('estado', ACTIVE_STATUSES);
        } else if (statusParam === 'finalized') {
            query = query.in('estado', FINALIZED_STATUSES);
        } else if (statusParam === 'en_preparacion') {
            query = query.eq('estado', 'en_preparacion');
        } else if (statusParam !== 'all' && statusParam !== 'archived') {
            query = query.eq('estado', statusParam);
        }

        // Filtro por Origen
        if (origenParam === 'sede' || origenParam === 'admin') {
            query = query.eq('origen', 'admin');
        } else if (origenParam === 'app') {
            query = query.eq('origen', 'app');
        }

        // Filtro por Tipo de Pedido
        if (tipoPedidoParam === 'delivery' || tipoPedidoParam === 'retiro_sede') {
            query = query.eq('tipo_pedido', tipoPedidoParam);
        }

        // Filtro por Rango de Fechas
        if (desdeParam && /^\d{4}-\d{2}-\d{2}$/.test(desdeParam)) {
            query = query.gte('created_at', `${desdeParam}T00:00:00-03:00`);
        }
        if (hastaParam && /^\d{4}-\d{2}-\d{2}$/.test(hastaParam)) {
            query = query.lte('created_at', `${hastaParam}T23:59:59-03:00`);
        }

        // Filtro por Búsqueda (Socio o ID de Pedido)
        if (search) {
            if (isUuidSearch) {
                // Si es un UUID exacto, coincidir con ID de pedido o con socios coincidentes
                if (matchedSocioIds && matchedSocioIds.length > 0) {
                    query = query.or(`id.eq.${search},socio_id.in.(${matchedSocioIds.join(',')})`);
                } else {
                    query = query.eq('id', search);
                }
            } else if (matchedSocioIds && matchedSocioIds.length > 0) {
                query = query.in('socio_id', matchedSocioIds);
            } else {
                // Búsqueda sin coincidencias en socios ni UUID válido -> devolver vacío directamente
                return NextResponse.json({
                    pedidos: [],
                    pagination: {
                        page,
                        limit,
                        totalCount: 0,
                        totalPages: 0,
                        hasMore: false
                    },
                    counts
                }, {
                    headers: { 'Cache-Control': 'private, no-store' }
                });
            }
        }

        // 5. Ordenamiento estable con desempate determinista por ID
        const validSortFields = ['created_at', 'fecha_retiro_preferida', 'updated_at'];
        const actualSortBy = validSortFields.includes(sortBy) ? sortBy : 'created_at';
        query = query.order(actualSortBy, { ascending: sortDir === 'asc', nullsFirst: false });
        query = query.order('id', { ascending: false });

        // 6. Aplicar paginación server-side
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        query = query.range(from, to);

        const { data: pedidos, count: totalCount, error: queryError } = await query;

        if (queryError) {
            console.error('API /api/admin/pedidos query error:', queryError);
            return NextResponse.json(
                { error: `Error al consultar pedidos: ${queryError.message}` },
                { status: 500 }
            );
        }

        const total = totalCount || 0;
        const totalPages = Math.ceil(total / limit);
        const hasMore = page < totalPages;

        // Soporte retrocompatible para clientes legacy que esperan un array directo
        if (isLegacy) {
            return NextResponse.json(pedidos || [], {
                headers: { 'Cache-Control': 'private, no-store' }
            });
        }

        return NextResponse.json({
            pedidos: pedidos || [],
            pagination: {
                page,
                limit,
                totalCount: total,
                totalPages,
                hasMore
            },
            counts
        }, {
            headers: { 'Cache-Control': 'private, no-store' }
        });

    } catch (e: any) {
        console.error('API /api/admin/pedidos catch error:', e);
        return NextResponse.json(
            { error: `Error interno del servidor: ${e.message}` },
            { status: 500 }
        );
    }
}

// PATCH: Archivado y Restauración de Pedidos con Auditoría
export async function PATCH(request: Request) {
    try {
        const access = await requireStaff(request, supabaseAdmin);
        if (access.response || !access.user) {
            return access.response || NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || !body.orderId || typeof body.archivado !== 'boolean') {
            return NextResponse.json(
                { error: 'Parámetros inválidos. Se requiere orderId y archivado (boolean).' },
                { status: 400 }
            );
        }

        const { orderId, archivado, motivo } = body;

        // Validar formato UUID estricto
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
            return NextResponse.json(
                { error: 'Formato de orderId inválido (se requiere UUID canónico).' },
                { status: 400 }
            );
        }

        // 1. Verificar existencia y estado del pedido
        const { data: existing, error: findError } = await supabaseAdmin
            .from('pedidos')
            .select('id, estado, archivado, socio_id')
            .eq('id', orderId)
            .single();

        if (findError || !existing) {
            return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 });
        }

        // 2. Control de reglas de negocio para archivado: solo se pueden archivar pedidos finalizados
        if (archivado && !FINALIZED_STATUSES.includes(existing.estado)) {
            return NextResponse.json({
                error: `No se puede archivar un pedido con estado activo '${existing.estado}'. Solo se permite archivar pedidos finalizados ('entregado', 'retirado' o 'cancelado').`
            }, { status: 400 });
        }

        // 3. Actualizar exclusivamente la columna 'archivado' (garantiza inmutabilidad de estado operativo y stock)
        const { data: updated, error: updateError } = await supabaseAdmin
            .from('pedidos')
            .update({ archivado })
            .eq('id', orderId)
            .select('id, estado, archivado, updated_at')
            .single();

        if (updateError) {
            console.error('Error al actualizar archivado de pedido:', updateError);
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // 4. Registrar log de auditoría obligatorio
        try {
            await supabaseAdmin.from('audit_logs').insert({
                user_id: access.user.id,
                action: archivado ? 'ORDER_ARCHIVED' : 'ORDER_UNARCHIVED',
                entity_type: 'pedidos',
                entity_id: orderId,
                details: {
                    motivo: motivo || (archivado ? 'Archivado administrativo' : 'Restauración administrativa'),
                    estado_pedido: existing.estado,
                    socio_id: existing.socio_id
                }
            });
        } catch (auditErr) {
            console.warn('Aviso: fallo al registrar log de auditoría:', auditErr);
        }

        return NextResponse.json({
            success: true,
            orderId,
            archivado: updated.archivado,
            estado: updated.estado,
            updatedAt: updated.updated_at
        });

    } catch (e: any) {
        console.error('API /api/admin/pedidos PATCH error:', e);
        return NextResponse.json(
            { error: `Error interno al actualizar pedido: ${e.message}` },
            { status: 500 }
        );
    }
}

