import assert from 'node:assert/strict';
import {
    buildSocioIdentitySignature,
    resolveStableSocioState,
    shouldSkipProfileRefreshOnTokenEvent,
    SocioLike,
} from '../services/deferredAuth';

let passed = 0;
function test(name: string, fn: () => void) {
    fn();
    passed++;
    console.log(`✓ ${name}`);
}

console.log('=== PERF-01 AUTH STABILITY SUITE ===');

const baseSocio: SocioLike = {
    id: 'socio-1',
    auth_user_id: 'auth-1',
    rol: 'admin',
    estado: 'activo',
    terms_accepted_at: '2026-10-01T12:00:00Z',
    nombre: 'Admin',
    apellido: 'Prueba',
};

test('PERF-01.1: TOKEN_REFRESHED omite recarga dentro del TTL y revalida silenciosamente tras vencer el TTL', () => {
    const now = 1_700_000_000_000;
    const skipRecent = shouldSkipProfileRefreshOnTokenEvent({
        event: 'TOKEN_REFRESHED',
        currentUserId: 'auth-1',
        currentAuthRole: 'admin',
        hasLoadedSocio: true,
        session: { user: { id: 'auth-1', app_metadata: { role: 'admin' } } } as any,
        lastSyncedAt: now - 15_000,
        now,
    });
    assert.equal(skipRecent, true);

    const skipExpired = shouldSkipProfileRefreshOnTokenEvent({
        event: 'TOKEN_REFRESHED',
        currentUserId: 'auth-1',
        currentAuthRole: 'admin',
        hasLoadedSocio: true,
        session: { user: { id: 'auth-1', app_metadata: { role: 'admin' } } } as any,
        lastSyncedAt: now - 65_000,
        now,
    });
    assert.equal(skipExpired, false);
});

test('PERF-01.2: TOKEN_REFRESHED con cambio de rol en app_metadata NO omite recarga', () => {
    const skip = shouldSkipProfileRefreshOnTokenEvent({
        event: 'TOKEN_REFRESHED',
        currentUserId: 'auth-1',
        currentAuthRole: 'socio',
        hasLoadedSocio: true,
        session: { user: { id: 'auth-1', app_metadata: { role: 'admin' } } } as any,
    });
    assert.equal(skip, false);
});

test('PERF-01.3: TOKEN_REFRESHED con distinto userId NO omite recarga', () => {
    const skip = shouldSkipProfileRefreshOnTokenEvent({
        event: 'TOKEN_REFRESHED',
        currentUserId: 'auth-1',
        currentAuthRole: 'admin',
        hasLoadedSocio: true,
        session: { user: { id: 'auth-2', app_metadata: { role: 'admin' } } } as any,
    });
    assert.equal(skip, false);
});

test('PERF-01.4: SIGNED_IN siempre permite verificación de sesión (no omite), pero preserva referencia si no cambió nada', () => {
    const skip = shouldSkipProfileRefreshOnTokenEvent({
        event: 'SIGNED_IN',
        currentUserId: 'auth-1',
        currentAuthRole: 'admin',
        hasLoadedSocio: true,
        session: { user: { id: 'auth-1', app_metadata: { role: 'admin' } } } as any,
    });
    assert.equal(skip, false);

    const copy = { ...baseSocio };
    const resolved = resolveStableSocioState(baseSocio, copy, 'admin', 'admin');
    assert.equal(resolved, baseSocio);
});

test('PERF-01.5: Cambio de estado (bloqueo/suspensión), rol o términos actualiza la referencia de user', () => {
    const blocked = { ...baseSocio, estado: 'suspendido' };
    assert.equal(resolveStableSocioState(baseSocio, blocked, 'admin', 'admin'), blocked);

    const demoted = { ...baseSocio, rol: 'socio' };
    assert.equal(resolveStableSocioState(baseSocio, demoted, 'admin', 'socio'), demoted);

    const acceptedTerms = { ...baseSocio, terms_accepted_at: '2026-11-20T10:00:00Z' };
    assert.equal(resolveStableSocioState(baseSocio, acceptedTerms, 'admin', 'admin'), acceptedTerms);
});

test('PERF-01.6: buildSocioIdentitySignature refleja identidad, rol, estado y términos', () => {
    assert.notEqual(
        buildSocioIdentitySignature(baseSocio, 'admin'),
        buildSocioIdentitySignature({ ...baseSocio, estado: 'inactivo' }, 'admin')
    );
});

console.log(`=== PERF-01 SUITE COMPLETE: ${passed}/${passed} PASS ===`);
