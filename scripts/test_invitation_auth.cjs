// Offline regression tests: no production users, tokens, emails or database writes.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}, globals = {}) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
    } });
    const module = { exports: {} };
    vm.runInNewContext(outputText, {
        module, exports: module.exports, require: name => mocks[name] || require(name),
        URL, URLSearchParams, setTimeout, clearTimeout, console, ...globals,
    }, { filename: file });
    return module.exports;
}

const session = { user: { id: 'test-user', email: 'test@example.invalid' }, access_token: 'test-only' };
const ok = { data: { session }, error: null };
function client(overrides = {}) {
    const calls = [];
    const auth = {};
    for (const name of ['getSession', 'setSession', 'exchangeCodeForSession']) {
        auth[name] = async (...args) => { calls.push(name); return overrides[name] ? overrides[name](...args) : ok; };
    }
    auth.initialize = async () => ({ error: null });
    return { auth, calls };
}
const { resolveInviteSession } = load('services/inviteSession.ts');

test('email fragment establishes a session before showing the password form', async () => {
    const c = client({ setSession: async tokens => {
        assert.equal(tokens.access_token, 'example-access');
        assert.equal(tokens.refresh_token, 'example-refresh');
        return ok;
    } });
    assert.equal(await resolveInviteSession(c, 'https://example.invalid/auth/set-password#access_token=example-access&refresh_token=example-refresh'), session);
    assert.deepEqual(c.calls, ['setSession']);
});

test('incomplete or explicitly expired links cannot reuse an unrelated active session', async () => {
    for (const suffix of ['#access_token=partial', '#error_code=otp_expired', '?error_description=bad%25value']) {
        const c = client();
        await assert.rejects(resolveInviteSession(c, 'https://example.invalid/auth/set-password' + suffix));
        assert.deepEqual(c.calls, []);
    }
});

test('missing session is reported and an active session can continue', async () => {
    const c = client({ getSession: async () => ({ data: { session: null }, error: null }) });
    await assert.rejects(resolveInviteSession(c, 'https://example.invalid/auth/set-password'), /SESSION_EXPIRED/);
    assert.equal(await resolveInviteSession(client(), 'https://example.invalid/auth/set-password'), session);
});

test('duplicate React effects exchange a one-use code only once', async () => {
    let finish;
    const c = client({ exchangeCodeForSession: () => new Promise(resolve => { finish = resolve; }) });
    const url = 'https://example.invalid/auth/invite-callback?code=one-use';
    const first = resolveInviteSession(c, url);
    const second = resolveInviteSession(c, url);
    assert.equal(first, second);
    await new Promise(resolve => setImmediate(resolve));
    finish(ok);
    await Promise.all([first, second]);
    assert.deepEqual(c.calls, ['exchangeCodeForSession']);
});

test('PKCE code consumed automatically by the SDK is not exchanged again', async () => {
    const { resolveInviteSession: resolve } = load('services/inviteSession.ts', {}, {
        window: { location: { href: 'https://example.invalid/reset-password' } },
    });
    const c = client();
    assert.equal(await resolve(c, 'https://example.invalid/reset-password?code=already-consumed'), session);
    assert.deepEqual(c.calls, ['getSession']);
});

test('failed exchanges can be retried and never count as successful sessions', async () => {
    let fail = true;
    const c = client({ setSession: async () => fail ? { data: { session: null }, error: { message: 'offline' } } : ok });
    const url = 'https://example.invalid/auth/invite-callback#access_token=a&refresh_token=b';
    await assert.rejects(resolveInviteSession(c, url));
    fail = false;
    assert.equal(await resolveInviteSession(c, url), session);
});

test('auth listener returns before database work and unsubscribe cancels queued work', async () => {
    const { onDeferredAuthStateChange } = load('services/deferredAuth.ts');
    let callback, locked = true, invoked = 0, unsubscribed = false;
    const auth = { onAuthStateChange: handler => {
        callback = handler;
        return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } };
    } };
    const stop = onDeferredAuthStateChange(auth, async () => {
        assert.equal(locked, false, 'Auth work must run after the SDK releases its lock');
        invoked++;
    }, error => { throw error; });
    assert.equal(callback('SIGNED_IN', session), undefined);
    assert.equal(invoked, 0);
    locked = false;
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(invoked, 1);
    callback('TOKEN_REFRESHED', session);
    stop();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(invoked, 1);
    assert.equal(unsubscribed, true);
});

// Render the real page using a small hook harness, then exercise its actual form
// handler with controlled Supabase responses. No source-text assertions.
function passwordPage(updateError) {
    let index = 0, mounted = false;
    const state = [], effects = [], calls = [];
    const react = {
        useState: initial => {
            const key = index++;
            if (!(key in state)) state[key] = initial;
            return [state[key], value => { state[key] = value; }];
        },
        useEffect: effect => { if (!mounted) effects.push(effect); },
    };
    const jsx = (type, props) => ({ type, props });
    const db = {
        select: () => db, eq: () => db, is: () => db, order: () => db, limit: () => db,
        maybeSingle: async () => ({ data: { id: 'test-invite' }, error: null }),
        update: () => { calls.push('consume'); return db; },
        single: async () => ({ data: { rol: 'socio' }, error: null }),
    };
    const supabase = {
        auth: {
            getSession: async () => ok,
            getUser: async () => ({ data: { user: session.user } }),
            updateUser: async () => { calls.push('password'); return { error: updateError }; },
        },
        from: () => db,
    };
    const router = { replace: route => calls.push(route) };
    const page = load('app/auth/set-password/page.tsx', {
        react, 'react/jsx-runtime': { jsx, jsxs: jsx },
        'next/navigation': { useRouter: () => router },
        '@/services/supabaseClient': { supabase },
        '@/services/inviteSession': { resolveInviteSession: async () => session },
    }, { window: { location: { href: 'https://example.invalid/auth/set-password', pathname: '/auth/set-password' }, history: { replaceState() {} } } }).default;
    return {
        calls, effects,
        render: () => { index = 0; const tree = page(); mounted = true; return tree; },
    };
}
function find(tree, predicate) {
    if (!tree || typeof tree !== 'object') return null;
    if (predicate(tree)) return tree;
    for (const child of [tree.props?.children].flat(Infinity)) {
        const found = find(child, predicate);
        if (found) return found;
    }
    return null;
}
async function submitPassword(harness) {
    const initial = harness.render();
    assert.equal(find(initial, node => node.type === 'form'), null);
    harness.effects.forEach(effect => effect());
    await new Promise(resolve => setImmediate(resolve));
    let tree = harness.render();
    for (const id of ['password', 'confirm']) find(tree, node => node.props?.id === id).props.onChange({ target: { value: 'test-password' } });
    tree = harness.render();
    await find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    return harness.render();
}

test('password rejection leaves invitation unused and allows another attempt', async () => {
    const h = passwordPage({ message: 'Password rejected' });
    const tree = await submitPassword(h);
    assert.deepEqual(h.calls, ['password']);
    assert.equal(find(tree, node => node.props?.type === 'submit').props.disabled, false);
});

test('successful password save precedes invite consumption and navigation', async () => {
    const h = passwordPage(null);
    await submitPassword(h);
    assert.deepEqual(h.calls, ['password', 'consume', '/terms']);
});
