const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('UX-02: Navigation CSS & layout guarantees vertical scroll', () => {
    const cssPath = path.resolve(__dirname, '../app/(dashboard)/dashboard.module.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // 1. Sidebar must allow vertical scroll and prevent horizontal scroll
    assert.match(css, /\.sidebar\s*\{[^}]*overflow-y:\s*auto/, 'Sidebar must declare overflow-y: auto');
    assert.match(css, /\.sidebar\s*\{[^}]*overflow-x:\s*hidden/, 'Sidebar must declare overflow-x: hidden');

    // 2. Nav list must be a scrollable flex child
    assert.match(css, /\.nav\s*\{[^}]*overflow-y:\s*auto/, 'Nav must declare overflow-y: auto');
    assert.match(css, /\.nav\s*\{[^}]*overflow-x:\s*hidden/, 'Nav must declare overflow-x: hidden');
    assert.match(css, /\.nav\s*\{[^}]*min-height:\s*0/, 'Nav must declare min-height: 0 to allow flexbox shrinking & scrolling');

    // 3. Logo and User Section must be protected from shrinking
    assert.match(css, /\.logo\s*\{[^}]*flex-shrink:\s*0/, 'Logo must have flex-shrink: 0');
    assert.match(css, /\.userSection\s*\{[^}]*flex-shrink:\s*0/, 'UserSection must have flex-shrink: 0');

    // 4. Main content area must maintain margin and independent scroll
    assert.match(css, /\.main\s*\{[^}]*margin-left:\s*250px/, 'Main must preserve sidebar offset');

    // 5. Layout mobile drawer check
    const layoutPath = path.resolve(__dirname, '../app/(dashboard)/layout.tsx');
    const layout = fs.readFileSync(layoutPath, 'utf8');
    assert.ok(layout.includes('max-h-[90dvh]') || layout.includes('max-h-[90vh]'), 'Mobile drawer must have max-height constraint');
    assert.ok(layout.includes('overflow-y-auto'), 'Mobile drawer must have overflow-y-auto');
});

test('UX-02: StoreService.createPedido satisfies DB trigger boundary & idempotency', () => {
    const servicePath = path.resolve(__dirname, '../services/storeService.ts');
    const code = fs.readFileSync(servicePath, 'utf8');

    // 1. Must resolve authenticated user ID
    assert.ok(code.includes('currentAuthUserId'), 'createPedido must resolve currentAuthUserId');
    assert.ok(code.includes('created_by_user_id: currentAuthUserId'), 'createPedido payload must pass created_by_user_id');

    // 2. Must generate or preserve idempotency_key
    assert.ok(code.includes('idempotencyKey'), 'createPedido must handle idempotencyKey');
    assert.ok(code.includes('idempotency_key: idempotencyKey'), 'createPedido payload must pass idempotency_key');

    // 3. Must enforce initial status 'pendiente' on insert
    assert.ok(code.includes("estado: 'pendiente'"), "createPedido payload must set estado: 'pendiente' on insert");

    // 4. Must not perform obsolete unauthenticated client query to socios
    assert.ok(!code.includes("supabase\n            .from('socios')\n            .select('id')\n            .eq('id', socioId)"), 'createPedido must not execute obsolete client check on socios');
});

test('UX-02: Checkout page enforces business rules & prevents delivery when disabled', () => {
    const checkoutPath = path.resolve(__dirname, '../app/(dashboard)/checkout/page.tsx');
    const code = fs.readFileSync(checkoutPath, 'utf8');

    // 1. Initial state defaults to 'retiro_sede'
    assert.ok(code.includes("useState<OrderType>('retiro_sede')"), "orderType must initialize safely to 'retiro_sede'");

    // 2. Synchronizes with user.envios_habilitados
    assert.ok(code.includes('!user.envios_habilitados'), 'Must check user.envios_habilitados');

    // 3. Guards handleCheckout
    assert.ok(code.includes("orderType === 'delivery' && !user.envios_habilitados"), 'handleCheckout must guard against delivery if not enabled');

    // 4. Passes created_by_user_id to createPedido
    assert.ok(code.includes('created_by_user_id: user.auth_user_id || user.userId'), 'checkout must forward user auth id');

    // 5. Radio button has disabled prop and informative text
    assert.ok(code.includes('disabled={!user?.envios_habilitados}'), 'Delivery radio must be disabled when !user.envios_habilitados');
    assert.ok(code.includes('No habilitado para tu cuenta'), 'Delivery radio must display explanatory notice');

    // 6. Descriptive toast error messages
    assert.ok(code.includes('DELIVERY_DISABLED'), 'Error handler must catch DELIVERY_DISABLED');
    assert.ok(code.includes('ORDER_STOCK_INSUFFICIENT'), 'Error handler must catch stock errors');
    assert.ok(code.includes('ORDER_CREATION_BOUNDARY_REQUIRED'), 'Error handler must catch boundary errors');
});

