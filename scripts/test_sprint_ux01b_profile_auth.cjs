const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 1. Test fetchLinkedProfile directly
const linkedProfileModule = { exports: {} };
const lpSource = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../services/linkedProfile.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
).outputText;
vm.runInNewContext(lpSource, {
    module: linkedProfileModule,
    exports: linkedProfileModule.exports,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch
});
const { fetchLinkedProfile } = linkedProfileModule.exports;

test('UX-01B: fetchLinkedProfile forwards Authorization Bearer header when token provided', async () => {
    let capturedUrl = '';
    let capturedOpts = null;

    const mockFetch = async (url, opts) => {
        capturedUrl = url;
        capturedOpts = opts;
        return {
            status: 200,
            ok: true,
            json: async () => ({ id: 'socio-e2e-001', nombre: 'Admin User' })
        };
    };

    const res = await fetchLinkedProfile('30000000-0000-4000-8000-000000000001', mockFetch, 'test-bearer-token-xyz');
    assert.equal(res.id, 'socio-e2e-001');
    assert.match(capturedUrl, /id=30000000-0000-4000-8000-000000000001/);
    assert.equal(capturedOpts.headers['Authorization'], 'Bearer test-bearer-token-xyz');
    assert.equal(capturedOpts.credentials, 'same-origin');
    assert.equal(capturedOpts.cache, 'no-store');
});

test('UX-01B: fetchLinkedProfile omits Authorization header when no token passed', async () => {
    let capturedOpts = null;
    const mockFetch = async (url, opts) => {
        capturedOpts = opts;
        return {
            status: 200,
            ok: true,
            json: async () => ({ id: 'socio-e2e-002', nombre: 'Socio User' })
        };
    };

    const res = await fetchLinkedProfile('30000000-0000-4000-8000-000000000002', mockFetch);
    assert.equal(res.id, 'socio-e2e-002');
    assert.equal(capturedOpts.headers['Authorization'], undefined);
    assert.equal(capturedOpts.credentials, 'same-origin');
});

test('UX-01B: fetchLinkedProfile handles abort/timeout with user-friendly message', async () => {
    const abortingFetch = async (url, opts) => {
        const err = new Error('AbortError');
        throw err;
    };

    await assert.rejects(
        fetchLinkedProfile('any-id', abortingFetch),
        /AbortError/
    );
});

test('UX-01B: fetchLinkedProfile returns undefined on confirmed 404 (unlinked socio)', async () => {
    const mock404Fetch = async () => ({
        status: 404,
        ok: false
    });

    const res = await fetchLinkedProfile('unlinked-user-id', mock404Fetch, 'some-token');
    assert.equal(res, undefined);
});

test('UX-01B: fetchLinkedProfile throws descriptive error on 401/403/500 backend responses', async () => {
    for (const status of [401, 403, 500, 502, 503]) {
        const mockErrorFetch = async () => ({
            status,
            ok: false
        });
        await assert.rejects(
            fetchLinkedProfile('user-id', mockErrorFetch, 'some-token'),
            /No pudimos verificar tu ficha\. Volv/
        );
    }
});

// 2. Test /api/admin/socios/by-user route authorization contracts
const responseHelper = {
    json: (body, options = {}) => ({
        body,
        status: options.status || 200,
        headers: options.headers || new Headers(),
        cookies: { getAll: () => [], set: () => {} }
    })
};

function loadRoute(file, mocks = {}) {
    const module = { exports: {} };
    const source = ts.transpileModule(
        fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
    ).outputText;
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        require: n => mocks[n] || require(n),
        console,
        URL,
        process: {
            env: {
                NEXT_PUBLIC_SUPABASE_URL: 'https://uqwuhjxzazsexuvqxmfm.supabase.co',
                SUPABASE_SERVICE_ROLE_KEY: 'test-service-key'
            }
        }
    });
    return module.exports;
}

const adminUid = '30000000-0000-4000-8000-000000000001';
const socioUid = '30000000-0000-4000-8000-000000000002';
const otherSocioUid = '30000000-0000-4000-8000-000000000003';

test('UX-01B: /api/admin/socios/by-user route contract tests', async () => {
    // A. Anonymous request (no token, no cookies) returns 401
    {
        const mockAdminDb = { auth: {}, from: () => ({ select: () => ({ or: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
        const route = loadRoute('app/api/admin/socios/by-user/route.ts', {
            '@supabase/supabase-js': { createClient: () => mockAdminDb },
            'next/server': { NextResponse: responseHelper },
            '@/app/lib/api-auth': {
                authenticate: async () => null,
                hasStaffRole: async () => false
            }
        });
        const req = { nextUrl: new URL(`https://example.invalid?id=${socioUid}`) };
        const res = await route.GET(req);
        assert.equal(res.status, 401);
    }

    // B. Socio queries another user profile -> 403 Forbidden (Cross-tenant guard)
    {
        const mockAdminDb = { auth: {}, from: () => ({ select: () => ({ or: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
        const route = loadRoute('app/api/admin/socios/by-user/route.ts', {
            '@supabase/supabase-js': { createClient: () => mockAdminDb },
            'next/server': { NextResponse: responseHelper },
            '@/app/lib/api-auth': {
                authenticate: async () => ({ id: socioUid }),
                hasStaffRole: async () => false
            }
        });
        // socioUid attempts to fetch otherSocioUid
        const req = { nextUrl: new URL(`https://example.invalid?id=${otherSocioUid}`) };
        const res = await route.GET(req);
        assert.equal(res.status, 403);
    }

    // C. Socio queries own profile -> 200 OK
    {
        const mockAdminDb = {
            auth: {},
            from: (table) => ({
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({
                            data: {
                                id: 'socio-record-002',
                                auth_user_id: socioUid,
                                nombre: 'Socio Test',
                                rol: 'socio',
                                status: 'active',
                                bloqueado: false
                            },
                            error: null
                        })
                    }),
                    or: () => ({
                        maybeSingle: async () => ({
                            data: {
                                id: 'socio-record-002',
                                auth_user_id: socioUid,
                                nombre: 'Socio Test',
                                rol: 'socio',
                                status: 'active',
                                bloqueado: false
                            },
                            error: null
                        })
                    })
                })
            })
        };
        const route = loadRoute('app/api/admin/socios/by-user/route.ts', {
            '@supabase/supabase-js': { createClient: () => mockAdminDb },
            'next/server': { NextResponse: responseHelper },
            '@/app/lib/api-auth': {
                authenticate: async () => ({ id: socioUid }),
                hasStaffRole: async () => false
            }
        });
        const req = { nextUrl: new URL(`https://example.invalid?id=${socioUid}`) };
        const res = await route.GET(req);
        assert.equal(res.status, 200);
        assert.equal(res.body.id, 'socio-record-002');
    }

    // D. Admin queries another user profile -> 200 OK (Staff access allowed)
    {
        const mockAdminDb = {
            auth: {},
            from: (table) => ({
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({
                            data: {
                                id: 'socio-record-003',
                                auth_user_id: otherSocioUid,
                                nombre: 'Other Member',
                                rol: 'socio',
                                status: 'active',
                                bloqueado: false
                            },
                            error: null
                        })
                    }),
                    or: () => ({
                        maybeSingle: async () => ({
                            data: {
                                id: 'socio-record-003',
                                auth_user_id: otherSocioUid,
                                nombre: 'Other Member',
                                rol: 'socio',
                                status: 'active',
                                bloqueado: false
                            },
                            error: null
                        })
                    })
                })
            })
        };
        const route = loadRoute('app/api/admin/socios/by-user/route.ts', {
            '@supabase/supabase-js': { createClient: () => mockAdminDb },
            'next/server': { NextResponse: responseHelper },
            '@/app/lib/api-auth': {
                authenticate: async () => ({ id: adminUid }),
                hasStaffRole: async () => true
            }
        });
        const req = { nextUrl: new URL(`https://example.invalid?id=${otherSocioUid}`) };
        const res = await route.GET(req);
        assert.equal(res.status, 200);
        assert.equal(res.body.id, 'socio-record-003');
    }

    // E. Invalid UUID format returns 400
    {
        const mockAdminDb = { auth: {}, from: () => ({}) };
        const route = loadRoute('app/api/admin/socios/by-user/route.ts', {
            '@supabase/supabase-js': { createClient: () => mockAdminDb },
            'next/server': { NextResponse: responseHelper },
            '@/app/lib/api-auth': {
                authenticate: async () => ({ id: adminUid }),
                hasStaffRole: async () => true
            }
        });
        const req = { nextUrl: new URL(`https://example.invalid?id=not-a-valid-uuid`) };
        const res = await route.GET(req);
        assert.equal(res.status, 400);
    }
});
