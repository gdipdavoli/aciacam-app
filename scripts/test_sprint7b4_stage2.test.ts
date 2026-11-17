/**
 * scripts/test_sprint7b4_stage2.test.ts
 *
 * ACIACAM — Sprint 7B.4 (Etapa 2)
 * Suite de Pruebas Obligatorias de Integración, Seguridad y Autorización Delegada
 *
 * Matriz de Pruebas:
 * 1. Token expirado.
 * 2. Firma incorrecta.
 * 3. Alteración del payload.
 * 4. Reutilización concurrente del grant.
 * 5. Operador revocado o sin permisos en tiempo de ejecución.
 * 6. Reintento después de timeout (recuperación determinista sin re-ejecución).
 * 7. Dos pedidos legítimos con contenido idéntico (distintos orderIntentId).
 * 8. Stock insuficiente durante la ejecución (transaccional).
 * 9. Fallas de comunicación entre servicios (S2S timeout/504).
 * 10. Control por defecto: execute_order bloqueado cuando executionEnabled = false.
 */

import { InMemoryActionGrantStore } from '../app/lib/agent/action-grant-store';
import { MockBackendOrderAdapter } from '../app/lib/agent/backend-adapter';
import { MockOperatorVerifier } from '../app/lib/agent/operator-verifier';
import { PedidosTool } from '../app/lib/agent/pedidos-tool';
import {
    computeCanonicalOrderHash,
    createActionGrantToken,
    deriveSocioCheckoutEnvelope
} from '../app/lib/agent/pedidos-tool-core';
import { ExecuteOrderInput } from '../types/pedidos-tool';

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(`FALLO DE ASERCIÓN: ${message}`);
    }
}

async function assertThrows(fn: () => Promise<any>, expectedErrorSubstring: string, testName: string) {
    let thrown = false;
    try {
        await fn();
    } catch (err: any) {
        thrown = true;
        if (!err.message || !err.message.includes(expectedErrorSubstring)) {
            throw new Error(`Excepción inesperada en ${testName}. Esperado: '${expectedErrorSubstring}', Recibido: '${err.message}'`);
        }
    }
    if (!thrown) throw new Error(`No se produjo la excepcion esperada en ${testName}`);
}

console.log('======================================================================');
console.log('ACIACAM — SPRINT 7B.4 (ETAPA 2): PRUEBAS OBLIGATORIAS DE SEGURIDAD');
console.log('======================================================================\n');

const SECRET = 'ultra-secure-s2s-test-secret-at-least-32-chars-long';
const OPERATOR_ID = '30000000-0000-4000-8000-000000000001';
const SOCIO_ID = '30000000-0000-4000-8000-000000000012';
const PROD_A = '30000000-0000-4000-8000-000000000021';
const PROD_B = '30000000-0000-4000-8000-000000000022';

async function runStage2Tests() {
    // ----------------------------------------------------------------------------
    // PRUEBA 0: Guard de Configuración de Seguridad (Deshabilitado por Defecto)
    // ----------------------------------------------------------------------------
    console.log('--- PRUEBA 0: Feature Flag Deshabilitado por Defecto ---');
    {
        const store = new InMemoryActionGrantStore();
        const adapter = new MockBackendOrderAdapter();
        const verifier = new MockOperatorVerifier();
        verifier.setOperator(OPERATOR_ID, { role: 'admin', active: true, blocked: false });

        // Tool instanciada con executionEnabled = false (valor por defecto en prod)
        const toolDefault = new PedidosTool(
            { executionEnabled: false, secret: SECRET },
            adapter,
            verifier,
            store
        );

        const hash = computeCanonicalOrderHash({
            actorUserId: OPERATOR_ID,
            socioId: SOCIO_ID,
            tipoPedido: 'retiro_sede',
            items: [{ productoId: PROD_A, cantidad: 1 }],
            motivo: 'Dispensa médica'
        });

        const grant = createActionGrantToken({
            operatorAuthUserId: OPERATOR_ID,
            operatorRole: 'admin',
            targetSocioId: SOCIO_ID,
            approvedPayloadHash: hash
        }, SECRET);

        await assertThrows(
            () => toolDefault.executeOrder({
                operation: 'execute_order',
                proposal_id: 'prop-test',
                action_grant: grant,
                idempotency_key: '50000000-0000-4000-8000-000000000001',
                socio_id: SOCIO_ID,
                items: [{ productoId: PROD_A, cantidad: 1 }],
                tipo_pedido: 'retiro_sede',
                motivo: 'Dispensa médica'
            }),
            'AGENT_ORDER_EXECUTION_DISABLED',
            'PRUEBA 0'
        );
        console.log('✓ PRUEBA 0 APROBADA: execute_order rechazado incondicionalmente cuando executionEnabled = false.');
    }

    // ----------------------------------------------------------------------------
    // PRUEBA 1: Token Expirado
    // ----------------------------------------------------------------------------
    console.log('\n--- PRUEBA 1: Token Expirado ---');
    {
        const store = new InMemoryActionGrantStore();
        const adapter = new MockBackendOrderAdapter();
        const verifier = new MockOperatorVerifier();
        verifier.setOperator(OPERATOR_ID, { role: 'admin', active: true, blocked: false });

        const tool = new PedidosTool(
            { executionEnabled: true, secret: SECRET },
            adapter,
            verifier,
            store
        );

        const hash = computeCanonicalOrderHash({
            actorUserId: OPERATOR_ID,
            socioId: SOCIO_ID,
            tipoPedido: 'retiro_sede',
            items: [{ productoId: PROD_A, cantidad: 1 }],
            motivo: 'Dispensa médica'
        });

        // Grant expirado en el pasado
        const grant = createActionGrantToken({
            operatorAuthUserId: OPERATOR_ID,
            operatorRole: 'admin',
            targetSocioId: SOCIO_ID,
            approvedPayloadHash: hash,
            ttlSeconds: 1 // 1 segundo
        }, SECRET);

        // Forzar expiración
        (grant.payload as any).expires_at = Math.floor(Date.now() / 1000) - 15;
        // Re-firmar el payload manipulado para que pase la firma pero falle en expiración
        const crypto = require('crypto');
        (grant as any).signature = crypto
            .createHmac('sha256', SECRET)
            .update(JSON.stringify(grant.payload))
            .digest('hex');

        await assertThrows(
            () => tool.executeOrder({
                operation: 'execute_order',
                proposal_id: 'prop-test',
                action_grant: grant,
                idempotency_key: '50000000-0000-4000-8000-000000000002',
                socio_id: SOCIO_ID,
                items: [{ productoId: PROD_A, cantidad: 1 }],
                tipo_pedido: 'retiro_sede',
                motivo: 'Dispensa médica'
            }),
            'GRANT_EXPIRED',
            'PRUEBA 1'
        );
        console.log('✓ PRUEBA 1 APROBADA: Token expirado rechazado con código GRANT_EXPIRED.');
    }

    // ----------------------------------------------------------------------------
    // PRUEBA 2: Firma Incorrecta
    // ----------------------------------------------------------------------------
    console.log('\n--- PRUEBA 2: Firma Incorrecta o Adulterada ---');
    {
        const store = new InMemoryActionGrantStore();
        const adapter = new MockBackendOrderAdapter();
        const verifier = new MockOperatorVerifier();
        verifier.setOperator(OPERATOR_ID, { role: 'admin', active: true, blocked: false });

        const tool = new PedidosTool(
            { executionEnabled: true, secret: SECRET },
            adapter,
            verifier,
            store
        );

        const hash = computeCanonicalOrderHash({
            actorUserId: OPERATOR_ID,
            socioId: SOCIO_ID,
            tipoPedido: 'retiro_sede',
            items: [{ productoId: PROD_A, cantidad: 1 }],
            motivo: 'Dispensa médica'
        });

        // Grant firmado con una clave incorrecta
        const grant = createActionGrantToken({
            operatorAuthUserId: OPERATOR_ID,
            operatorRole: 'admin',
            targetSocioId: SOCIO_ID,
            approvedPayloadHash: hash
        }, 'wrong-key-attacker-signature-32-chars-xxxx');

        await assertThrows(
            () => tool.executeOrder({
                operation: 'execute_order',
                proposal_id: 'prop-test',
                action_grant: grant,
                idempotency_key: '50000000-0000-4000-8000-000000000003',
                socio_id: SOCIO_ID,
                items: [{ productoId: PROD_A, cantidad: 1 }],
                tipo_pedido: 'retiro_sede',
                motivo: 'Dispensa médica'
            }),
            'GRANT_SIGNATURE_MISMATCH',
            'PRUEBA 2'
        );
        console.log('✓ PRUEBA 2 APROBADA: Firma adulterada rechazada con GRANT_SIGNATURE_MISMATCH.');
    }

    // ----------------------------------------------------------------------------
    // PRUEBA 3: Alteración del Payload
    // ----------------------------------------------------------------------------
    console.log('\n--- PRUEBA 3: Alteración del Payload Aprobado ---');
    {
        const store = new InMemoryActionGrantStore();
        const adapter = new MockBackendOrderAdapter();
        const verifier = new MockOperatorVerifier();
        verifier.setOperator(OPERATOR_ID, { role: 'admin', active: true, blocked: false });

        const tool = new PedidosTool(
            { executionEnabled: true, secret: SECRET },
            adapter,
            verifier,
            store
        );

        // Operador aprobó 1 unidad de PROD_A
        const hash = computeCanonicalOrderHash({
            actorUserId: OPERATOR_ID,
            socioId: SOCIO_ID,
            tipoPedido: 'retiro_sede',
            items: [{ productoId: PROD_A, cantidad: 1 }],
            motivo: 'Dispensa médica'
        });

        const grant = createActionGrantToken({
            operatorAuthUserId: OPERATOR_ID,
            operatorRole: 'admin',
            targetSocioId: SOCIO_ID,
            approvedPayloadHash: hash
        }, SECRET);

        // Agente intenta ejecutar 5 unidades en vez de 1
        await assertThrows(
            () => tool.executeOrder({
                operation: 'execute_order',
                proposal_id: 'prop-test',
                action_grant: grant,
                idempotency_key: '50000000-0000-4000-8000-000000000004',
                socio_id: SOCIO_ID,
                items: [{ productoId: PROD_A, cantidad: 5 }], // ¡Alterado!
                tipo_pedido: 'retiro_sede',
                motivo: 'Dispensa médica'
            }),
            'PAYLOAD_HASH_MISMATCH',
            'PRUEBA 3'
        );
        console.log('✓ PRUEBA 3 APROBADA: Manipulación de parámetros rechazada con PAYLOAD_HASH_MISMATCH.');
    }

    // ----------------------------------------------------------------------------
    // PRUEBA 4: Reutilización Concurrente del Grant (Replay Attack)
    // ----------------------------------------------------------------------------
    console.log('\n--- PRUEBA 4: Reutilización Concurrente del Grant ---');
    {
        const store = new InMemoryActionGrantStore();
        const adapter = new MockBackendOrderAdapter();
        const verifier = new MockOperatorVerifier();
        verifier.setOperator(OPERATOR_ID, { role: 'admin', active: true, blocked: false });

        const tool = new PedidosTool(
            { executionEnabled: true, secret: SECRET },
            adapter,
            verifier,
            store
        );

        const hash = computeCanonicalOrderHash({
            actorUserId: OPERATOR_ID,
            socioId: SOCIO_ID,
            tipoPedido: 'retiro_sede',
            items: [{ productoId: PROD_A, cantidad: 2 }],
            motivo: 'Dispensa médica'
        });

        const grant = createActionGrantToken({
            operatorAuthUserId: OPERATOR_ID,
            operatorRole: 'admin',
            targetSocioId: SOCIO_ID,
            approvedPayloadHash: hash
        }, SECRET);

        const input1: ExecuteOrderInput = {
            operation: 'execute_order',
            proposal_id: 'prop-test',
            action_grant: grant,
            idempotency_key: '50000000-0000-4000-8000-000000000010',
            socio_id: SOCIO_ID,
            items: [{ productoId: PROD_A, cantidad: 2 }],
            tipo_pedido: 'retiro_sede',
            motivo: 'Dispensa médica'
        };

        // Primer consumo exitoso
        const res1 = await tool.executeOrder(input1);
        assert(res1.success === true, 'El primer consumo debe ser exitoso');

        // Segundo intento: Reusar el mismo grant para una ejecución diferente (distinta clave)
        const input2: ExecuteOrderInput = {
            ...input1,
            idempotency_key: '50000000-0000-4000-8000-000000000011' // Diferente intento
        };

        await assertThrows(
            () => tool.executeOrder(input2),
            'GRANT_ALREADY_CONSUMED',
            'PRUEBA 4'
        );
        console.log('✓ PRUEBA 4 APROBADA: Reutilización de grant bloqueada atómicamente con GRANT_ALREADY_CONSUMED.');
    }

    // ----------------------------------------------------------------------------
    // PRUEBA 5: Operador Revocado o Sin Permisos en Tiempo de Ejecución
    // ----------------------------------------------------------------------------
    console.log('\n--- PRUEBA 5: Operador Revocado en Tiempo de Ejecución ---');
    {
        const store = new InMemoryActionGrantStore();
        const adapter = new MockBackendOrderAdapter();
        const verifier = new MockOperatorVerifier();

        // Inicialmente el operador era admin al emitir el token
        verifier.setOperator(OPERATOR_ID, { role: 'admin', active: true, blocked: false });

        const tool = new PedidosTool(
            { executionEnabled: true, secret: SECRET },
            adapter,
            verifier,
            store
        );

        const hash = computeCanonicalOrderHash({
            actorUserId: OPERATOR_ID,
            socioId: SOCIO_ID,
            tipoPedido: 'retiro_sede',
            items: [{ productoId: PROD_A, cantidad: 1 }],
            motivo: 'Dispensa'
        });

        const grant = createActionGrantToken({
            operatorAuthUserId: OPERATOR_ID,
            operatorRole: 'admin',
            targetSocioId: SOCIO_ID,
            approvedPayloadHash: hash
        }, SECRET);

        const input: ExecuteOrderInput = {
            operation: 'execute_order',
            proposal_id: 'prop-test',
            action_grant: grant,
            idempotency_key: '50000000-0000-4000-8000-000000000020',
            socio_id: SOCIO_ID,
            items: [{ productoId: PROD_A, cantidad: 1 }],
            tipo_pedido: 'retiro_sede',
            motivo: 'Dispensa'
        };

        // Escenario 5A: Operador bloqueado antes de ejecutar
        verifier.setOperator(OPERATOR_ID, { role: 'admin', active: true, blocked: true, motivo: 'Sospecha de fraude' });
        await assertThrows(() => tool.executeOrder(input), 'OPERATOR_REVOKED', 'PRUEBA 5A');

        // Escenario 5B: Operador suspendido/inactivo
        verifier.setOperator(OPERATOR_ID, { role: 'admin', active: false, blocked: false });
        await assertThrows(() => tool.executeOrder(input), 'OPERATOR_INACTIVE', 'PRUEBA 5B');

        // Escenario 5C: Operador degradado a socio común (sin permisos de dispensa)
        verifier.setOperator(OPERATOR_ID, { role: 'socio', active: true, blocked: false });
        await assertThrows(() => tool.executeOrder(input), 'OPERATOR_NOT_PERMITTED', 'PRUEBA 5C');

        console.log('✓ PRUEBA 5 APROBADA: Revocación de operador detectada y bloqueada en tiempo de ejecución.');
    }

    // ----------------------------------------------------------------------------
    // PRUEBA 6: Reintento Después de Timeout (Recuperabilidad Determinista)
    // ----------------------------------------------------------------------------
    console.log('\n--- PRUEBA 6: Reintento Después de Timeout ---');
    {
        const store = new InMemoryActionGrantStore();
        const adapter = new MockBackendOrderAdapter();
        const verifier = new MockOperatorVerifier();
        verifier.setOperator(OPERATOR_ID, { role: 'admin', active: true, blocked: false });

        const tool = new PedidosTool(
            { executionEnabled: true, secret: SECRET },
            adapter,
            verifier,
            store
        );

        const hash = computeCanonicalOrderHash({
            actorUserId: OPERATOR_ID,
            socioId: SOCIO_ID,
            tipoPedido: 'retiro_sede',
            items: [{ productoId: PROD_A, cantidad: 1 }],
            motivo: 'Dispensa con timeout'
        });

        const grant = createActionGrantToken({
            operatorAuthUserId: OPERATOR_ID,
            operatorRole: 'admin',
            targetSocioId: SOCIO_ID,
            approvedPayloadHash: hash
        }, SECRET);

        const input: ExecuteOrderInput = {
            operation: 'execute_order',
            proposal_id: 'prop-test',
            action_grant: grant,
            idempotency_key: '50000000-0000-4000-8000-000000000030',
            socio_id: SOCIO_ID,
            items: [{ productoId: PROD_A, cantidad: 1 }],
            tipo_pedido: 'retiro_sede',
            motivo: 'Dispensa con timeout'
        };

        // Primera ejecución exitosa
        const firstResult = await tool.executeOrder(input);
        assert(firstResult.success === true, 'La primera ejecución debe resultar exitosa');
        assert(firstResult.deduplicated === false, 'La primera ejecución no debe ser deduplicada');
        const originalOrderId = firstResult.pedido_id;

        // Reintento idéntico tras timeout de red (mismo grant y misma idempotency_key)
        const retryResult = await tool.executeOrder(input);
        assert(retryResult.success === true, 'El reintento debe completarse exitosamente');
        assert(retryResult.deduplicated === true, 'El reintento DEBE identificarse como deduplicado');
        assert(retryResult.pedido_id === originalOrderId, 'El reintento DEBE retornar el mismo pedido_id original');

        console.log(`✓ PRUEBA 6 APROBADA: Recuperación transparente tras timeout verificada (pedido_id: ${originalOrderId}).`);
    }

    // ----------------------------------------------------------------------------
    // PRUEBA 7: Dos Pedidos Legítimos con Contenido Idéntico
    // ----------------------------------------------------------------------------
    console.log('\n--- PRUEBA 7: Dos Pedidos Legítimos con Contenido Idéntico ---');
    {
        const items = [{ productoId: PROD_A, cantidad: 2 }, { productoId: PROD_B, cantidad: 1 }];

        // Compra 1: Intento hoy
        const env1 = deriveSocioCheckoutEnvelope({
            socioId: SOCIO_ID,
            orderIntentId: 'checkout-intent-2026-10-19-001',
            items,
            tipoPedido: 'retiro_sede'
        });

        // Compra 2: Intento la próxima semana con exactamente los mismos productos y cantidades
        const env2 = deriveSocioCheckoutEnvelope({
            socioId: SOCIO_ID,
            orderIntentId: 'checkout-intent-2026-10-26-002',
            items,
            tipoPedido: 'retiro_sede'
        });

        assert(env1.canonical_payload_hash === env2.canonical_payload_hash, 'El hash de ítems debe ser idéntico');
        assert(env1.idempotency_key !== env2.idempotency_key, 'Las claves de idempotencia DEBEN ser distintas para intentos legítimos diferentes');

        // Reintento de la compra 1 por timeout de red
        const env1Retry = deriveSocioCheckoutEnvelope({
            socioId: SOCIO_ID,
            orderIntentId: 'checkout-intent-2026-10-19-001', // Mismo intento
            items,
            tipoPedido: 'retiro_sede',
            clientAttempt: 2
        });
        assert(env1.idempotency_key === env1Retry.idempotency_key, 'El reintento del mismo intento debe conservar la misma clave');

        console.log(`✓ PRUEBA 7 APROBADA: Compra 1 (${env1.idempotency_key}) y Compra 2 (${env2.idempotency_key}) diferenciadas.`);
    }

    // ----------------------------------------------------------------------------
    // PRUEBA 8: Stock Insuficiente Durante la Ejecución Transaccional
    // ----------------------------------------------------------------------------
    console.log('\n--- PRUEBA 8: Stock Insuficiente Durante la Ejecución Transaccional ---');
    {
        const store = new InMemoryActionGrantStore();
        const adapter = new MockBackendOrderAdapter();
        const verifier = new MockOperatorVerifier();
        verifier.setOperator(OPERATOR_ID, { role: 'admin', active: true, blocked: false });

        // Catálogo: Inicialmente hay 5 unidades de PROD_A
        adapter.setProductStock(PROD_A, 5);

        const tool = new PedidosTool(
            { executionEnabled: true, secret: SECRET },
            adapter,
            verifier,
            store
        );

        // Validación previa (preflight): 5 unidades disponibles
        const valPreflight = await tool.validateOrder({
            operation: 'validate_order',
            socio_id: SOCIO_ID,
            items: [{ productoId: PROD_A, cantidad: 5 }],
            tipo_pedido: 'retiro_sede'
        });
        assert(valPreflight.valid === true, 'El preflight debe ser válido con 5 unidades');

        // Simular que una venta concurrente consumió el stock antes de la ejecución definitiva
        adapter.setProductStock(PROD_A, 2); // Quedan solo 2

        const hash = computeCanonicalOrderHash({
            actorUserId: OPERATOR_ID,
            socioId: SOCIO_ID,
            tipoPedido: 'retiro_sede',
            items: [{ productoId: PROD_A, cantidad: 5 }],
            motivo: 'Dispensa sin stock'
        });

        const grant = createActionGrantToken({
            operatorAuthUserId: OPERATOR_ID,
            operatorRole: 'admin',
            targetSocioId: SOCIO_ID,
            approvedPayloadHash: hash
        }, SECRET);

        await assertThrows(
            () => tool.executeOrder({
                operation: 'execute_order',
                proposal_id: 'prop-test',
                action_grant: grant,
                idempotency_key: '50000000-0000-4000-8000-000000000040',
                socio_id: SOCIO_ID,
                items: [{ productoId: PROD_A, cantidad: 5 }],
                tipo_pedido: 'retiro_sede',
                motivo: 'Dispensa sin stock'
            }),
            'ORDER_STOCK_INSUFFICIENT',
            'PRUEBA 8'
        );
        console.log('✓ PRUEBA 8 APROBADA: Stock insuficiente rechazado atómicamente durante la transacción.');
    }

    // ----------------------------------------------------------------------------
    // PRUEBA 9: Fallas de Comunicación Entre Servicios (S2S Timeout/504)
    // ----------------------------------------------------------------------------
    console.log('\n--- PRUEBA 9: Fallas de Comunicación Entre Servicios ---');
    {
        const store = new InMemoryActionGrantStore();
        const adapter = new MockBackendOrderAdapter();
        const verifier = new MockOperatorVerifier();
        verifier.setOperator(OPERATOR_ID, { role: 'admin', active: true, blocked: false });

        const tool = new PedidosTool(
            { executionEnabled: true, secret: SECRET },
            adapter,
            verifier,
            store
        );

        // Simular falla de red en el backend adapter
        adapter.simulateNetworkFailure(true);

        const hash = computeCanonicalOrderHash({
            actorUserId: OPERATOR_ID,
            socioId: SOCIO_ID,
            tipoPedido: 'retiro_sede',
            items: [{ productoId: PROD_A, cantidad: 1 }],
            motivo: 'Falla S2S'
        });

        const grant = createActionGrantToken({
            operatorAuthUserId: OPERATOR_ID,
            operatorRole: 'admin',
            targetSocioId: SOCIO_ID,
            approvedPayloadHash: hash
        }, SECRET);

        await assertThrows(
            () => tool.executeOrder({
                operation: 'execute_order',
                proposal_id: 'prop-test',
                action_grant: grant,
                idempotency_key: '50000000-0000-4000-8000-000000000050',
                socio_id: SOCIO_ID,
                items: [{ productoId: PROD_A, cantidad: 1 }],
                tipo_pedido: 'retiro_sede',
                motivo: 'Falla S2S'
            }),
            'SIMULATED_S2S_TIMEOUT',
            'PRUEBA 9'
        );

        console.log('✓ PRUEBA 9 APROBADA: Error de comunicación S2S capturado y reportado de forma controlada.');
    }

    // ----------------------------------------------------------------------------
    // PRUEBA 10: Control de Límites Legales en propose_order
    // ----------------------------------------------------------------------------
    console.log('\n--- PRUEBA 10: Cumplimiento Legal REPROCANN en propose_order ---');
    {
        const store = new InMemoryActionGrantStore();
        const adapter = new MockBackendOrderAdapter();
        const verifier = new MockOperatorVerifier();

        const tool = new PedidosTool(
            { executionEnabled: true, secret: SECRET },
            adapter,
            verifier,
            store
        );

        // A. Solicitud conforme (2 unidades = 10g <= 40g)
        const propLegal = await tool.proposeOrder({
            operation: 'propose_order',
            socio_id: SOCIO_ID,
            items: [{ productoId: PROD_A, cantidad: 2 }],
            tipo_pedido: 'retiro_sede',
            motivo: 'Tratamiento dolor crónico'
        });
        assert(propLegal.legal_transport_compliant === true, '10g debe ser legalmente transportable');
        assert(propLegal.legal_warning === undefined, 'No debe emitir advertencia si cumple límites');

        // B. Solicitud excesiva (10 unidades = 50g > 40g límite REPROCANN)
        const propExceso = await tool.proposeOrder({
            operation: 'propose_order',
            socio_id: SOCIO_ID,
            items: [{ productoId: PROD_A, cantidad: 10 }],
            tipo_pedido: 'retiro_sede',
            motivo: 'Dispensa mayor'
        });
        assert(propExceso.legal_transport_compliant === false, '50g supera el límite legal');
        assert(propExceso.legal_warning?.includes('Ley 27.350') === true, 'Debe emitir advertencia citando la Ley 27.350');

        console.log('✓ PRUEBA 10 APROBADA: Límites de transporte legal y advertencias REPROCANN verificados.');
    }

    console.log('\n======================================================================');
    console.log('TODAS LAS PRUEBAS DE SEGURIDAD (SPRINT 7B.4 - ETAPA 2) PASARON 100% OK');
    console.log('======================================================================');
}

runStage2Tests().catch(err => {
    console.error('ERROR FATAL EN SUITE DE PRUEBAS:', err);
    process.exit(1);
});
