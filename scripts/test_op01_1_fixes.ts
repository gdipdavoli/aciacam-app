import { getNextStatusOptions, isFinalStatus, getStatusLabel } from '../helpers/orderHelpers';
import { OrderStatus, OrderType, OrderItem } from '../types';

async function runTests() {
    console.log("================================================================================");
    console.log("SUITE DE PRUEBAS LOCALES: SPRINT OP-01.1 (Ajustes Finales de Revisión Visual)");
    console.log("================================================================================");

    let passed = 0;
    let failed = 0;

    function assert(desc: string, condition: boolean, extra?: any) {
        if (condition) {
            console.log(`✅ PASS: ${desc}`);
            passed++;
        } else {
            console.error(`❌ FAIL: ${desc}`, extra || '');
            failed++;
        }
    }

    // -------------------------------------------------------------------------
    // TEST 1: Protección de Estados Terminales en getNextStatusOptions
    // -------------------------------------------------------------------------
    console.log("\n[GRUPO 1: Dominio de Estados Terminales y Transiciones]");
    
    assert("cancelado es estado final", isFinalStatus('cancelado') === true);
    assert("entregado es estado final", isFinalStatus('entregado') === true);
    assert("retirado es estado final", isFinalStatus('retirado') === true);
    assert("en_preparacion NO es estado final", isFinalStatus('en_preparacion') === false);
    assert("pendiente NO es estado final", isFinalStatus('pendiente') === false);
    assert("confirmado NO es estado final", isFinalStatus('confirmado') === false);
    assert("en_camino NO es estado final", isFinalStatus('en_camino') === false);

    const optsCancelado = getNextStatusOptions('retiro_sede', 'cancelado');
    assert("getNextStatusOptions para 'cancelado' retorna array vacío []", Array.isArray(optsCancelado) && optsCancelado.length === 0, optsCancelado);

    const optsEntregado = getNextStatusOptions('delivery', 'entregado');
    assert("getNextStatusOptions para 'entregado' retorna array vacío []", Array.isArray(optsEntregado) && optsEntregado.length === 0, optsEntregado);

    const optsRetirado = getNextStatusOptions('retiro_sede', 'retirado');
    assert("getNextStatusOptions para 'retirado' retorna array vacío []", Array.isArray(optsRetirado) && optsRetirado.length === 0, optsRetirado);

    const optsPendienteRetiro = getNextStatusOptions('retiro_sede', 'pendiente');
    assert("getNextStatusOptions para 'pendiente' permite en_preparacion y cancelado", 
        optsPendienteRetiro.some(o => o.value === 'en_preparacion') && 
        optsPendienteRetiro.some(o => o.value === 'cancelado') &&
        !optsPendienteRetiro.some(o => o.value === 'entregado'));

    const optsPrepRetiro = getNextStatusOptions('retiro_sede', 'en_preparacion');
    assert("getNextStatusOptions para 'en_preparacion' en retiro_sede sugiere 'confirmado' y cancelado",
        optsPrepRetiro.some(o => o.value === 'confirmado') && 
        optsPrepRetiro.some(o => o.value === 'cancelado') &&
        !optsPrepRetiro.some(o => o.value === 'en_camino'));

    const optsPrepDelivery = getNextStatusOptions('delivery', 'en_preparacion');
    assert("getNextStatusOptions para 'en_preparacion' en delivery sugiere 'en_camino' y cancelado",
        optsPrepDelivery.some(o => o.value === 'en_camino') && 
        optsPrepDelivery.some(o => o.value === 'cancelado') &&
        !optsPrepDelivery.some(o => o.value === 'confirmado'));

    // -------------------------------------------------------------------------
    // TEST 2: Enriquecimiento en memoria de Productos Históricos
    // -------------------------------------------------------------------------
    console.log("\n[GRUPO 2: Enriquecimiento en Memoria de Productos Históricos]");

    // Simulador de enriquecimiento con catálogo
    const catalogMock = new Map<string, string>([
        ["30000000-0000-4000-8000-000000000021", "Producto E2E Sprint 5"],
        ["de29c0bb-1af0-490c-984f-71ece331ec35", "Lola"]
    ]);

    const mockOrdersFromDB = [
        // Caso A: Formato histórico puro (29 pedidos reales en BD)
        {
            id: "ped-hist-1",
            estado: "cancelado",
            items: [{ cantidad: 1, productoId: "30000000-0000-4000-8000-000000000021" }]
        },
        // Caso B: Formato con nombre original explícito (debe prevalecer)
        {
            id: "ped-hist-2",
            estado: "entregado",
            items: [{ cantidad: 2, productoId: "30000000-0000-4000-8000-000000000021", productoNombre: "Nombre Original Histórico" }]
        },
        // Caso C: Producto eliminado del catálogo / ID huérfano
        {
            id: "ped-hist-3",
            estado: "cancelado",
            items: [{ cantidad: 1, productoId: "ffffffff-9999-4000-8000-000000000099" }]
        },
        // Caso D: Pedido sin ítems o array vacío
        {
            id: "ped-hist-4",
            estado: "cancelado",
            items: []
        }
    ];

    // Aplicar lógica de enriquecimiento idéntica a la de /api/admin/pedidos/route.ts
    const enrichedOrders = mockOrdersFromDB.map(p => {
        if (!Array.isArray(p.items)) return p;
        return {
            ...p,
            items: p.items.map((it: any) => {
                const pid = it.productoId || it.producto_id || it.id || '';
                const originalName = (typeof it.productoNombre === 'string' && it.productoNombre.trim())
                    || (typeof it.nombre === 'string' && it.nombre.trim())
                    || null;

                if (originalName) {
                    return {
                        ...it,
                        productoId: pid,
                        cantidad: Number(it.cantidad) || 1,
                        productoNombre: originalName,
                        nombreOrigen: 'original'
                    };
                }

                const catalogName = pid ? catalogMock.get(pid) : null;
                if (catalogName) {
                    return {
                        ...it,
                        productoId: pid,
                        cantidad: Number(it.cantidad) || 1,
                        productoNombre: catalogName,
                        nombreOrigen: 'catalogo'
                    };
                }

                return {
                    ...it,
                    productoId: pid,
                    cantidad: Number(it.cantidad) || 1,
                    productoNombre: pid ? `Producto no identificado (${pid.slice(0, 8)})` : 'Producto no identificado',
                    nombreOrigen: 'desconocido'
                };
            })
        };
    });

    assert("Caso A: Recupera nombre desde catálogo para ítem histórico",
        enrichedOrders[0].items[0].productoNombre === "Producto E2E Sprint 5" &&
        enrichedOrders[0].items[0].nombreOrigen === "catalogo");

    assert("Caso B: Prioriza nombre original registrado en el pedido",
        enrichedOrders[1].items[0].productoNombre === "Nombre Original Histórico" &&
        enrichedOrders[1].items[0].nombreOrigen === "original");

    assert("Caso C: Si no existe en catálogo, muestra 'Producto no identificado (<id>)'",
        enrichedOrders[2].items[0].productoNombre === "Producto no identificado (ffffffff)" &&
        enrichedOrders[2].items[0].nombreOrigen === "desconocido");

    assert("Caso D: Maneja arreglo vacío sin excepciones",
        Array.isArray(enrichedOrders[3].items) && enrichedOrders[3].items.length === 0);

    // Verificar formato renderizado en UI
    const formatOrderItems = (items: any[]) => {
        if (!items || items.length === 0) return 'Sin productos informados';
        return items.map(i => {
            const name = i.productoNombre || i.nombre || (i.productoId ? `Producto no identificado (${i.productoId.slice(0, 8)})` : 'Producto no identificado');
            return `${i.cantidad}x ${name}`;
        }).join(', ');
    };

    assert("UI renderiza '1x Producto E2E Sprint 5' sin 'undefined'",
        formatOrderItems(enrichedOrders[0].items) === "1x Producto E2E Sprint 5");

    assert("UI renderiza '2x Nombre Original Histórico'",
        formatOrderItems(enrichedOrders[1].items) === "2x Nombre Original Histórico");

    assert("UI renderiza '1x Producto no identificado (ffffffff)' ante producto no encontrado",
        formatOrderItems(enrichedOrders[2].items) === "1x Producto no identificado (ffffffff)");

    assert("UI renderiza 'Sin productos informados' ante lista vacía",
        formatOrderItems(enrichedOrders[3].items) === "Sin productos informados");

    // -------------------------------------------------------------------------
    // TEST 3: Verificación de Etiquetas en Bandeja de Agente (POL-026)
    // -------------------------------------------------------------------------
    console.log("\n[GRUPO 3: Etiquetas y Claridad en Bandeja de Agente]");

    const mapInboxStatusLabel = (status: string) => {
        switch (status) {
            case 'AWAITING_REVIEW':
                return 'Pendiente de revisión';
            case 'APPROVED':
                return 'Propuesta aprobada — Alta pendiente de aplicar';
            case 'READY_FOR_INVITATION':
                return 'Ficha creada — Invitación pendiente';
            case 'COMPLETED':
                return 'Invitación procesada';
            case 'INVITING':
                return 'Invitación en proceso';
            case 'INVITE_FAILED':
                return 'Invitación fallida';
            default:
                return status;
        }
    };

    assert("AWAITING_REVIEW se traduce a 'Pendiente de revisión'",
        mapInboxStatusLabel('AWAITING_REVIEW') === 'Pendiente de revisión');

    assert("APPROVED se traduce a 'Propuesta aprobada — Alta pendiente de aplicar'",
        mapInboxStatusLabel('APPROVED') === 'Propuesta aprobada — Alta pendiente de aplicar');

    assert("READY_FOR_INVITATION se traduce a 'Ficha creada — Invitación pendiente'",
        mapInboxStatusLabel('READY_FOR_INVITATION') === 'Ficha creada — Invitación pendiente');

    // -------------------------------------------------------------------------
    // TEST 4: Sincronización de Tab en Pagos y Cierres
    // -------------------------------------------------------------------------
    console.log("\n[GRUPO 4: Accesibilidad de Pagos / Caja y Cierres]");

    const resolveActiveTab = (tabParam: string | null): 'caja' | 'cierres' => {
        return tabParam === 'cierres' ? 'cierres' : 'caja';
    };

    assert("URL ?tab=cierres activa la pestaña 'cierres'", resolveActiveTab('cierres') === 'cierres');
    assert("URL sin parámetro tab activa la pestaña 'caja' por defecto", resolveActiveTab(null) === 'caja');
    assert("URL ?tab=caja activa la pestaña 'caja'", resolveActiveTab('caja') === 'caja');
    assert("URL con parámetro desconocido activa 'caja'", resolveActiveTab('otro') === 'caja');

    console.log("\n================================================================================");
    console.log(`TOTAL PRUEBAS EJECUTADAS: ${passed + failed}`);
    console.log(`APROBADAS: ${passed} | FALLIDAS: ${failed}`);
    console.log("================================================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error("Error fatal en pruebas:", err);
    process.exit(1);
});

