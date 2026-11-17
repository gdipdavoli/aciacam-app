/**
 * scripts/test_pedidos_tool_contracts.test.ts
 *
 * ACIACAM — Sprint 7B.4 (Etapa 1)
 * Suite de Pruebas Unitarias para Contratos de PedidosTool, Autorización Delegada e Idempotencia
 */

import {
    consolidateOrderItems,
    computeCanonicalOrderHash,
    createActionGrantToken,
    verifyActionGrantToken,
    deriveSocioCheckoutEnvelope,
    validateOrderStatusTransition
} from '../app/lib/agent/pedidos-tool-core';
import { CanonicalOrderStatus } from '../types/pedidos-tool';

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(`FALLO DE ASERCIÓN: ${message}`);
    }
}

console.log('======================================================================');
console.log('ACIACAM — SPRINT 7B.4 (ETAPA 1): PRUEBAS UNITARIAS DE CONTRATOS Y TIPOS');
console.log('======================================================================\n');

// ----------------------------------------------------------------------------
// TEST 1: Consolidación Canónica de Ítems
// ----------------------------------------------------------------------------
console.log('--- TEST 1: Consolidación Canónica de Ítems ---');
{
    const input = [
        { productoId: '30000000-0000-4000-8000-000000000002', cantidad: 3 },
        { productoId: '30000000-0000-4000-8000-000000000001', cantidad: 2 },
        { productoId: '30000000-0000-4000-8000-000000000002', cantidad: 5 }
    ];

    const consolidated = consolidateOrderItems(input);
    assert(consolidated.length === 2, 'Deben consolidarse exactamente 2 productos únicos');
    assert(consolidated[0].productoId === '30000000-0000-4000-8000-000000000001', 'El primer producto debe ser ...0001 (orden ascendente)');
    assert(consolidated[0].cantidad === 2, 'La cantidad de ...0001 debe ser 2');
    assert(consolidated[1].productoId === '30000000-0000-4000-8000-000000000002', 'El segundo producto debe ser ...0002');
    assert(consolidated[1].cantidad === 8, 'La cantidad consolidada de ...0002 debe ser 8 (3 + 5)');
    console.log('✓ TEST 1 APROBADO: Consolidación, suma y ordenamiento ascendente verificados.');
}

// ----------------------------------------------------------------------------
// TEST 2: Determinismo e Invariancia de la Huella Canónica SHA-256
// ----------------------------------------------------------------------------
console.log('\n--- TEST 2: Determinismo e Invariancia de la Huella Canónica ---');
{
    const baseParams = {
        actorUserId: '30000000-0000-4000-8000-000000000001',
        socioId: '30000000-0000-4000-8000-000000000012',
        tipoPedido: 'retiro_sede' as const,
        items: [
            { productoId: '30000000-0000-4000-8000-000000000021', cantidad: 2 },
            { productoId: '30000000-0000-4000-8000-000000000022', cantidad: 1 }
        ],
        motivo: 'Dispensa aprobada en comité',
        fechaRetiro: '2026-10-25'
    };

    const hash1 = computeCanonicalOrderHash(baseParams);

    // Permutación de orden en el array de entrada: debe producir exactamente el mismo hash
    const permutedParams = {
        ...baseParams,
        items: [
            { productoId: '30000000-0000-4000-8000-000000000022', cantidad: 1 },
            { productoId: '30000000-0000-4000-8000-000000000021', cantidad: 2 }
        ]
    };
    const hash2 = computeCanonicalOrderHash(permutedParams);
    assert(hash1 === hash2, 'La huella canónica debe ser inmune a la permutación de ítems');

    // Modificación de cantidad: debe alterar el hash
    const modifiedQtyParams = {
        ...baseParams,
        items: [
            { productoId: '30000000-0000-4000-8000-000000000021', cantidad: 3 },
            { productoId: '30000000-0000-4000-8000-000000000022', cantidad: 1 }
        ]
    };
    const hashModified = computeCanonicalOrderHash(modifiedQtyParams);
    assert(hash1 !== hashModified, 'Cualquier variación de cantidad debe cambiar el hash canónico');

    console.log(`✓ TEST 2 APROBADO: Huella canónica determinista (${hash1.substring(0, 16)}...) validada.`);
}

// ----------------------------------------------------------------------------
// TEST 3: Autorización Delegada (ActionGrantToken) y Validación Criptográfica
// ----------------------------------------------------------------------------
console.log('\n--- TEST 3: Autorización Delegada y Verificación de ActionGrantToken ---');
{
    const secret = 'super-secret-s2s-test-key-32-characters-minimum';
    const approvedHash = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

    // A. Emisión y verificación exitosa
    const grant = createActionGrantToken({
        operatorAuthUserId: '30000000-0000-4000-8000-000000000001',
        operatorRole: 'admin',
        targetSocioId: '30000000-0000-4000-8000-000000000012',
        approvedPayloadHash: approvedHash,
        ttlSeconds: 60
    }, secret);

    const validResult = verifyActionGrantToken(grant, approvedHash, secret);
    assert(validResult.valid === true, 'El grant legítimo debe validarse exitosamente');

    // B. Rechazo por discrepancia de parámetros (payload hash mismatch)
    const mismatchResult = verifyActionGrantToken(grant, 'tampered-hash-value', secret);
    assert(mismatchResult.valid === false, 'Debe rechazar si la carga difiere de lo aprobado');
    assert(mismatchResult.error?.includes('PAYLOAD_HASH_MISMATCH') === true, 'Debe reportar PAYLOAD_HASH_MISMATCH');

    // C. Rechazo por firma inválida o adulterada
    const tamperedGrant = {
        ...grant,
        signature: 'deadbeef' + grant.signature.substring(8)
    };
    const tamperedResult = verifyActionGrantToken(tamperedGrant, approvedHash, secret);
    assert(tamperedResult.valid === false, 'Debe rechazar firmas adulteradas');
    assert(tamperedResult.error?.includes('GRANT_SIGNATURE_MISMATCH') === true, 'Debe reportar GRANT_SIGNATURE_MISMATCH');

    // D. Rechazo por expiración
    const nowSec = Math.floor(Date.now() / 1000);
    const expiredPayload = {
        ...grant.payload,
        issued_at: nowSec - 130,
        expires_at: nowSec - 10 // Expirado hace 10s con ventana válida de 120s
    };
    const expiredSignature = require('crypto')
        .createHmac('sha256', secret)
        .update(JSON.stringify(expiredPayload))
        .digest('hex');
    const expiredGrant = { payload: expiredPayload, signature: expiredSignature };

    const expiredResult = verifyActionGrantToken(expiredGrant, approvedHash, secret);
    assert(expiredResult.valid === false, 'Debe rechazar grants expirados');
    assert(expiredResult.error?.includes('GRANT_EXPIRED') === true, 'Debe reportar GRANT_EXPIRED');

    console.log('✓ TEST 3 APROBADO: Verificación criptográfica, expiración y control de carga de ActionGrant validados.');
}

// ----------------------------------------------------------------------------
// TEST 4: Idempotencia Integral del Checkout de Socios
// ----------------------------------------------------------------------------
console.log('\n--- TEST 4: Idempotencia Integral del Checkout de Socios ---');
{
    const socioId = '30000000-0000-4000-8000-000000000012';
    const cartSessionId = 'cart-session-abc-123';
    const items = [{ productoId: '30000000-0000-4000-8000-000000000021', cantidad: 2 }];

    // Intento 1 (primer clic)
    const env1 = deriveSocioCheckoutEnvelope({
        socioId,
        cartSessionId,
        items,
        tipoPedido: 'retiro_sede',
        clientAttempt: 1
    });

    // Intento 2 (reintento de red por timeout con la misma sesión de compra)
    const env2 = deriveSocioCheckoutEnvelope({
        socioId,
        cartSessionId,
        items,
        tipoPedido: 'retiro_sede',
        clientAttempt: 2
    });

    assert(env1.idempotency_key === env2.idempotency_key, 'La clave de idempotencia DEBE ser idéntica en reintentos del mismo carrito');
    assert(env1.canonical_payload_hash === env2.canonical_payload_hash, 'El hash de carga debe ser idéntico');
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(env1.idempotency_key), 'Debe ser un UUID v5 canónico válido');

    // Nueva compra / carrito modificado: La clave debe rotar
    const envModificado = deriveSocioCheckoutEnvelope({
        socioId,
        cartSessionId,
        items: [{ productoId: '30000000-0000-4000-8000-000000000021', cantidad: 5 }], // Modificó cantidad
        tipoPedido: 'retiro_sede'
    });
    assert(env1.idempotency_key !== envModificado.idempotency_key, 'Al modificar ítems del carrito la clave DEBE renovarse');

    // Nueva sesión de compra (tras finalizar o vaciar carrito): La clave debe rotar
    const envNuevaSesion = deriveSocioCheckoutEnvelope({
        socioId,
        cartSessionId: 'cart-session-xyz-789', // Nueva sesión
        items,
        tipoPedido: 'retiro_sede'
    });
    assert(env1.idempotency_key !== envNuevaSesion.idempotency_key, 'Al iniciar un nuevo ciclo de compra la clave DEBE renovarse');

    console.log(`✓ TEST 4 APROBADO: Clave estable en reintentos (${env1.idempotency_key}) y rotación verificada.`);
}

// ----------------------------------------------------------------------------
// TEST 5: Matriz de Transiciones de Estado y Control de 'procesando'
// ----------------------------------------------------------------------------
console.log('\n--- TEST 5: Matriz de Transiciones Canónicas y Detección de Estado Legacy ---');
{
    // Transiciones canónicas válidas
    assert(validateOrderStatusTransition('pendiente', 'confirmado').allowed === true, 'pendiente -> confirmado debe ser válido');
    assert(validateOrderStatusTransition('confirmado', 'en_preparacion').allowed === true, 'confirmado -> en_preparacion debe ser válido');
    assert(validateOrderStatusTransition('en_preparacion', 'listo_para_retiro').allowed === true, 'en_preparacion -> listo_para_retiro debe ser válido');
    assert(validateOrderStatusTransition('listo_para_retiro', 'retirado').allowed === true, 'listo_para_retiro -> retirado debe ser válido');
    assert(validateOrderStatusTransition('en_preparacion', 'en_camino').allowed === true, 'en_preparacion -> en_camino debe ser válido');
    assert(validateOrderStatusTransition('en_camino', 'entregado').allowed === true, 'en_camino -> entregado debe ser válido');
    assert(validateOrderStatusTransition('pendiente', 'cancelado').allowed === true, 'pendiente -> cancelado debe ser válido');

    // Idempotencia de estado
    assert(validateOrderStatusTransition('confirmado', 'confirmado').allowed === true, 'Mismo estado debe ser permitido (idempotente)');

    // Transiciones prohibidas
    assert(validateOrderStatusTransition('retirado', 'cancelado').allowed === false, 'Estado terminal retirado no puede cancelarse');
    assert(validateOrderStatusTransition('entregado', 'pendiente').allowed === false, 'Estado terminal entregado no puede reabrirse');
    assert(validateOrderStatusTransition('cancelado', 'confirmado').allowed === false, 'Estado terminal cancelado no puede transicionar');
    assert(validateOrderStatusTransition('pendiente', 'entregado').allowed === false, 'No puede saltar de pendiente a entregado');

    // Validación de estado legacy 'procesando'
    const procesandoCheck = validateOrderStatusTransition('procesando' as any, 'confirmado');
    assert(procesandoCheck.allowed === false, "El estado legacy 'procesando' no debe permitirse como estado origen canónico");

    console.log('✓ TEST 5 APROBADO: Matriz de 8 estados canónicos y rechazo de transiciones ilegales comprobados.');
}

console.log('\n======================================================================');
console.log('TODAS LAS PRUEBAS UNITARIAS DE CONTRATOS (SPRINT 7B.4) PASARON 100% OK');
console.log('======================================================================');
