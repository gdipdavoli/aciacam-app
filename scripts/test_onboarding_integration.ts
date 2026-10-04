import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

let testCount = 0;
let passCount = 0;

async function runTestCase(name: string, fn: () => Promise<void> | void) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log('[PASS] ' + name);
  } catch (err: unknown) {
    console.error('[FAIL] ' + name + ':', err);
  }
}

async function main() {
  console.log('======================================================================');
  console.log('ACIACAM Onboarding Integration & Canonical BFF Security Test Suite');
  console.log('======================================================================');

  const appDir = process.cwd();

  // 1. Verificar helper BFF canónico (bff-auth.ts)
  await runTestCase('01. Helper bff-auth.ts existe y usa exclusivamente auth_user_id', () => {
    const helperPath = path.join(appDir, 'app', 'lib', 'agent', 'bff-auth.ts');
    assert.strictEqual(fs.existsSync(helperPath), true);
    const helperCode = fs.readFileSync(helperPath, 'utf-8');

    // Verificar lookup estricto
    assert.strictEqual(helperCode.includes(".eq('auth_user_id', user.id)"), true);
    // Verificar que NO usa fallback legacy
    assert.strictEqual(helperCode.includes("user_id.eq."), false);
    assert.strictEqual(helperCode.includes(".or("), false);
  });

  // 2. Rutas migradas del Admin Inbox usan el helper canónico
  await runTestCase('02. Rutas migradas de Admin Inbox consumen getDelegatedBffContext', () => {
    const routeList = path.join(appDir, 'app', 'api', 'agent', 'inbox', 'route.ts');
    const routeSummary = path.join(appDir, 'app', 'api', 'agent', 'inbox', 'summary', 'route.ts');
    const routeDetail = path.join(appDir, 'app', 'api', 'agent', 'inbox', '[source_type]', '[source_id]', 'route.ts');

    [routeList, routeSummary, routeDetail].forEach((p) => {
      assert.strictEqual(fs.existsSync(p), true);
      const code = fs.readFileSync(p, 'utf-8');
      assert.strictEqual(code.includes('getDelegatedBffContext'), true);
      assert.strictEqual(code.includes('user_id.eq.'), false);
    });
  });

  // 3. Nuevas rutas BFF para Onboarding Action
  await runTestCase('03. Nuevas rutas BFF de Onboarding existen y requieren rol admin', () => {
    const approveRoute = path.join(appDir, 'app', 'api', 'agent', 'inbox', 'onboarding-proposals', '[id]', 'approve', 'route.ts');
    const rejectRoute = path.join(appDir, 'app', 'api', 'agent', 'inbox', 'onboarding-proposals', '[id]', 'reject', 'route.ts');
    const applyRoute = path.join(appDir, 'app', 'api', 'agent', 'inbox', 'onboarding-proposals', '[id]', 'apply', 'route.ts');

    assert.strictEqual(fs.existsSync(approveRoute), true);
    assert.strictEqual(fs.existsSync(rejectRoute), true);
    assert.strictEqual(fs.existsSync(applyRoute), true);

    const approveCode = fs.readFileSync(approveRoute, 'utf-8');
    const rejectCode = fs.readFileSync(rejectRoute, 'utf-8');
    const applyCode = fs.readFileSync(applyRoute, 'utf-8');

    assert.strictEqual(approveCode.includes("getDelegatedBffContext(request, ['admin'])"), true);
    assert.strictEqual(rejectCode.includes("getDelegatedBffContext(request, ['admin'])"), true);
    assert.strictEqual(applyCode.includes("getDelegatedBffContext(request, ['admin'])"), true);
    assert.strictEqual(approveCode.includes('/api/v1/inbox/onboarding-proposals/'), true);
    assert.strictEqual(rejectCode.includes('/api/v1/inbox/onboarding-proposals/'), true);
    assert.strictEqual(applyCode.includes('/api/v1/inbox/onboarding-proposals/'), true);
    assert.strictEqual(applyCode.includes('/apply'), true);
  });

  // 4. Tipos exactos en types/inbox.ts
  await runTestCase('04. types/inbox.ts define OnboardingProposalInboxDetail con campos reales', () => {
    const typesPath = path.join(appDir, 'types', 'inbox.ts');
    const code = fs.readFileSync(typesPath, 'utf-8');

    assert.strictEqual(code.includes('export interface OnboardingProposalInboxDetail'), true);
    assert.strictEqual(code.includes('proposal_hash: string;'), true);
    assert.strictEqual(code.includes('identidad_administrativo:'), true);
    assert.strictEqual(code.includes('dni_masked: string;'), true);
    assert.strictEqual(code.includes('numero_tramite?: string | null;'), true);
    assert.strictEqual(code.includes('diagnostico?: string | null;'), true);
    assert.strictEqual(code.includes('medico_nombre?: string | null;'), true);
    assert.strictEqual(code.includes('medico_matricula?: string | null;'), true);
  });

  // 5. OnboardingProposalDetail.tsx no renderiza DNI completo de REPROCANN
  await runTestCase('05. OnboardingProposalDetail renderiza solo dni_masked y no DNI completo', () => {
    const componentPath = path.join(appDir, 'app', 'components', 'admin', 'inbox', 'details', 'OnboardingProposalDetail.tsx');
    assert.strictEqual(fs.existsSync(componentPath), true);
    const code = fs.readFileSync(componentPath, 'utf-8');

    assert.strictEqual(code.includes('identidad.dni_masked'), true);
    assert.strictEqual(code.includes('reprocann.dni}'), false); // No renderiza reprocann.dni
    assert.strictEqual(code.includes('storage_path'), false); // Oculta storage_path
    assert.strictEqual(code.includes('fingerprint'), false); // Oculta fingerprint
  });

  // 6. InboxDetailDrawer renderiza OnboardingProposalDetail
  await runTestCase('06. InboxDetailDrawer rutea source_type onboarding_proposal', () => {
    const drawerPath = path.join(appDir, 'app', 'components', 'admin', 'inbox', 'InboxDetailDrawer.tsx');
    const code = fs.readFileSync(drawerPath, 'utf-8');

    assert.strictEqual(code.includes("item.source_type === 'onboarding_proposal'"), true);
    assert.strictEqual(code.includes('<OnboardingProposalDetail'), true);
  });

  // 7. Client helpers envían expected_proposal_hash/rejection_reason y APPLY sin promoted_docs
  await runTestCase('07. inbox-client.ts contiene approve/reject/apply de Onboarding', () => {
    const clientPath = path.join(appDir, 'app', 'lib', 'inbox-client.ts');
    const code = fs.readFileSync(clientPath, 'utf-8');

    assert.strictEqual(code.includes('expected_proposal_hash: expectedProposalHash'), true);
    assert.strictEqual(code.includes('rejection_reason: rejectionReason.trim()'), true);
    assert.strictEqual(code.includes('executeOnboardingAction'), true);
    assert.strictEqual(code.includes('applyOnboardingProposal'), true);
    assert.strictEqual(code.includes('/apply'), true);
    assert.strictEqual(code.includes('promoted_docs'), false);
    assert.strictEqual(code.includes('storage_path'), false);
    assert.strictEqual(code.includes('fingerprint'), false);
  });

  // 8. Validación de mensajes y 409 Conflict en page.tsx
  await runTestCase('08. page.tsx maneja mensajes de éxito exactos y manejo de 409 Conflict', () => {
    const pagePath = path.join(appDir, 'app', '(dashboard)', 'admin', 'inbox', 'page.tsx');
    const code = fs.readFileSync(pagePath, 'utf-8');

    assert.strictEqual(code.includes('Propuesta de onboarding aprobada. Pendiente de materialización.'), true);
    assert.strictEqual(code.includes('Propuesta de onboarding rechazada.'), true);
    assert.strictEqual(code.includes('Alta materializada. Pendiente de invitación.'), true);
    assert.strictEqual(code.includes("apiErr?.status === 409"), true);
    assert.strictEqual(code.includes('Socio creado'), false);
    assert.strictEqual(code.includes('Alta completada'), false);
  });

  // 9. APPLY existe separado de approve/reject y el browser no puede inyectar promoted_docs
  await runTestCase('09. APPLY usa ruta dedicada y payload server-side vacio', () => {
    const applyRoute = path.join(appDir, 'app', 'api', 'agent', 'inbox', 'onboarding-proposals', '[id]', 'apply', 'route.ts');
    const applyCode = fs.readFileSync(applyRoute, 'utf-8');
    const pageCode = fs.readFileSync(path.join(appDir, 'app', '(dashboard)', 'admin', 'inbox', 'page.tsx'), 'utf-8');

    assert.strictEqual(applyCode.includes("body: JSON.stringify({})"), true);
    assert.strictEqual(applyCode.includes('promoted_docs'), false);
    assert.strictEqual(applyCode.includes('storage_path'), false);
    assert.strictEqual(applyCode.includes('fingerprint'), false);
    assert.strictEqual(pageCode.includes('Aplicar alta de onboarding'), true);
    assert.strictEqual(pageCode.includes('No enviará todavía la invitación de acceso.'), true);
  });

  console.log('======================================================================');
  console.log('SUMMARY: TOTAL TESTS: ' + testCount + ' | PASS: ' + passCount + ' | FAIL: ' + (testCount - passCount));
  console.log('======================================================================');

  if (passCount !== testCount) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled error in test runner:', err);
  process.exit(1);
});
