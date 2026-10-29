/**
 * scripts/test_sprint7b8_preview_isolation_guard.ts
 *
 * ACIACAM — Sprint 7B.8 (Cierre de Remediación de Seguridad: Aislamiento Preview)
 * Suite de Pruebas Automatizadas para scripts/check-preview-isolation.cjs
 *
 * Cobertura:
 * - Fail-Closed ante cualquier ambigüedad, rama desconocida o ausencia de indicadores.
 * - Validación estructural de claims JWT sin denominarla validación criptográfica.
 * - Rechazo categórico de herencia o uso de credenciales productivas en Previews.
 * - Restricción estricta de Production exclusivamente a VERCEL_ENV='production' y rama 'main'.
 * - Detección y rechazo de JWTs ficticios, malformados o con claims inconsistentes.
 * - Cero fugas de secretos en trazas o mensajes de error.
 */

import assert from 'node:assert';
const {
  verifyPreviewEnvironment,
  inspectJwtClaims,
  resolveGitBranch,
  PRODUCTION_SUPABASE_REF,
  INTEGRATION_SUPABASE_REF,
  CONSOLIDATED_BRANCH,
  ALLOWED_PRODUCTION_BRANCHES
} = require('./check-preview-isolation.cjs');

interface TestCaseResult {
  code: string;
  name: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}

const results: TestCaseResult[] = [];

function record(code: string, name: string, status: 'PASS' | 'FAIL', detail: string) {
  results.push({ code, name, status, detail });
  const icon = status === 'PASS' ? '✓' : '✗';
  console.log(`${icon} [${code}] ${name} -> ${status}: ${detail}`);
}

function createDummyJwt(ref: string, role = 'anon') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ ref, role, exp: 1900000000 })).toString('base64url');
  return `${header}.${payload}.dummy_signature_for_test_purposes`;
}

async function runIsolationGuardSuite() {
  console.log('='.repeat(78));
  console.log('ACIACAM — SPRINT 7B.8: SUITE DE AISLAMIENTO PREVIEW PREBUILD');
  console.log('Evaluación: Fail-Closed, Anti-Producción, Detección de Rama y Cero Filtraciones');
  console.log('='.repeat(78) + '\n');

  const validIntegrationAnon = createDummyJwt(INTEGRATION_SUPABASE_REF, 'anon');
  const validIntegrationService = createDummyJwt(INTEGRATION_SUPABASE_REF, 'service_role');
  const productionAnon = createDummyJwt(PRODUCTION_SUPABASE_REF, 'anon');
  const productionService = createDummyJwt(PRODUCTION_SUPABASE_REF, 'service_role');

  const baseValidConsolidatedEnv = {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_REF: CONSOLIDATED_BRANCH,
    ACIACAM_PREVIEW_SUPABASE_REF: INTEGRATION_SUPABASE_REF,
    NEXT_PUBLIC_SUPABASE_URL: `https://${INTEGRATION_SUPABASE_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: validIntegrationAnon,
    SUPABASE_SERVICE_ROLE_KEY: validIntegrationService,
    INTEGRATION_E2E: 'true',
    EMAIL_DISABLE_EXTERNAL: 'true',
    COMMS_DISABLE_EXTERNAL: 'true'
  };

  // ---------------------------------------------------------------------------
  // TC-PIG-01: Aprobación legítima en rama consolidada con variables de Integration
  // ---------------------------------------------------------------------------
  try {
    const res = verifyPreviewEnvironment(baseValidConsolidatedEnv);
    assert.strictEqual(res.status, 'CONSOLIDATED_INTEGRATION_VERIFIED');
    record('TC-PIG-01', 'Aprobación Legítima de Rama Consolidada en Integration', 'PASS',
      'Entorno verificado correctamente como CONSOLIDATED_INTEGRATION_VERIFIED');
  } catch (e: any) {
    record('TC-PIG-01', 'Aprobación Legítima de Rama Consolidada en Integration', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-02: Rechazo si falta ACIACAM_PREVIEW_SUPABASE_REF o no es Integration
  // ---------------------------------------------------------------------------
  try {
    const env = { ...baseValidConsolidatedEnv, ACIACAM_PREVIEW_SUPABASE_REF: undefined };
    assert.throws(() => verifyPreviewEnvironment(env), /ACIACAM_PREVIEW_SUPABASE_REF/);
    record('TC-PIG-02', 'Rechazo por Ausencia de ACIACAM_PREVIEW_SUPABASE_REF', 'PASS',
      'Build abortado fail-closed ante referencia ausente o incorrecta');
  } catch (e: any) {
    record('TC-PIG-02', 'Rechazo por Ausencia de ACIACAM_PREVIEW_SUPABASE_REF', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-03: Rechazo si URL apunta a Supabase Producción
  // ---------------------------------------------------------------------------
  try {
    const env = { ...baseValidConsolidatedEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co` };
    assert.throws(() => verifyPreviewEnvironment(env), /URL de Supabase Producción estrictamente prohibida/);
    record('TC-PIG-03', 'Rechazo si URL apunta a Supabase Producción', 'PASS',
      'Barrera anti-producción interceptó URL productiva en preview');
  } catch (e: any) {
    record('TC-PIG-03', 'Rechazo si URL apunta a Supabase Producción', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-04: Rechazo si NEXT_PUBLIC_SUPABASE_ANON_KEY pertenece a Producción
  // ---------------------------------------------------------------------------
  try {
    const env = { ...baseValidConsolidatedEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: productionAnon };
    assert.throws(() => verifyPreviewEnvironment(env), /NEXT_PUBLIC_SUPABASE_ANON_KEY contiene claims de Supabase Producción/);
    record('TC-PIG-04', 'Rechazo si Anon Key pertenece a Supabase Producción', 'PASS',
      'Claim ref de Anon Key inspeccionado y bloqueado fail-closed');
  } catch (e: any) {
    record('TC-PIG-04', 'Rechazo si Anon Key pertenece a Supabase Producción', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-05: Rechazo si SUPABASE_SERVICE_ROLE_KEY pertenece a Producción
  // ---------------------------------------------------------------------------
  try {
    const env = { ...baseValidConsolidatedEnv, SUPABASE_SERVICE_ROLE_KEY: productionService };
    assert.throws(() => verifyPreviewEnvironment(env), /SUPABASE_SERVICE_ROLE_KEY contiene claims de Supabase Producción/);
    record('TC-PIG-05', 'Rechazo si Service Role Key pertenece a Supabase Producción', 'PASS',
      'Claim ref de Service Role inspeccionado y bloqueado fail-closed');
  } catch (e: any) {
    record('TC-PIG-05', 'Rechazo si Service Role Key pertenece a Supabase Producción', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-06: Rechazo si INTEGRATION_E2E no es 'true'
  // ---------------------------------------------------------------------------
  try {
    const env = { ...baseValidConsolidatedEnv, INTEGRATION_E2E: 'false' };
    assert.throws(() => verifyPreviewEnvironment(env), /INTEGRATION_E2E/);
    record('TC-PIG-06', 'Rechazo si INTEGRATION_E2E es falso o ausente', 'PASS',
      'Invariante de flag E2E exigido estrictamente');
  } catch (e: any) {
    record('TC-PIG-06', 'Rechazo si INTEGRATION_E2E es falso o ausente', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-07: Rechazo si EMAIL_DISABLE_EXTERNAL no es 'true'
  // ---------------------------------------------------------------------------
  try {
    const env = { ...baseValidConsolidatedEnv, EMAIL_DISABLE_EXTERNAL: undefined };
    assert.throws(() => verifyPreviewEnvironment(env), /EMAIL_DISABLE_EXTERNAL/);
    record('TC-PIG-07', 'Rechazo si EMAIL_DISABLE_EXTERNAL es ausente', 'PASS',
      'Bloqueo obligatorio de salida de correos verificado');
  } catch (e: any) {
    record('TC-PIG-07', 'Rechazo si EMAIL_DISABLE_EXTERNAL es ausente', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-08: Rechazo si COMMS_DISABLE_EXTERNAL no es 'true'
  // ---------------------------------------------------------------------------
  try {
    const env = { ...baseValidConsolidatedEnv, COMMS_DISABLE_EXTERNAL: '0' };
    assert.throws(() => verifyPreviewEnvironment(env), /COMMS_DISABLE_EXTERNAL/);
    record('TC-PIG-08', 'Rechazo si COMMS_DISABLE_EXTERNAL no es true', 'PASS',
      'Bloqueo obligatorio de salida de WhatsApp/comms verificado');
  } catch (e: any) {
    record('TC-PIG-08', 'Rechazo si COMMS_DISABLE_EXTERNAL no es true', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-09: Reproducción del Incidente: VERCEL_ENV ausente en Vercel pero rama consolidada
  // ---------------------------------------------------------------------------
  try {
    const incidentEnv = {
      VERCEL: '1',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_REF: CONSOLIDATED_BRANCH,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: productionAnon,
      SUPABASE_SERVICE_ROLE_KEY: productionService
    };
    assert.throws(() => verifyPreviewEnvironment(incidentEnv), /URL de Supabase Producción estrictamente prohibida/);
    record('TC-PIG-09', 'Mitigación del Incidente Inicial (VERCEL_ENV ausente en Vercel)', 'PASS',
      'Detección robusta de infraestructura Vercel y rama bloquea build con variables de producción');
  } catch (e: any) {
    record('TC-PIG-09', 'Mitigación del Incidente Inicial (VERCEL_ENV ausente en Vercel)', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-10: Cero fuga de credenciales en errores arrojados
  // ---------------------------------------------------------------------------
  try {
    const secretSignature = 'super_secret_private_signature_999999999999';
    const fakeSecretToken = `eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxd3Voanh6YXpzZXh1dnF4bWZtIn0.${secretSignature}`;
    const env = { ...baseValidConsolidatedEnv, INTEGRATION_E2E: 'invalid_value', NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeSecretToken };
    try {
      verifyPreviewEnvironment(env);
      assert.fail('Debió fallar');
    } catch (err: any) {
      assert(!err.message.includes(secretSignature), 'El mensaje de error no debe contener firmas ni tokens');
      assert(!err.message.includes('eyJhbGci'), 'El mensaje de error no debe contener fragmentos de JWT');
    }
    record('TC-PIG-10', 'Cero Filtración de Credenciales o JWTs en Trazas de Error', 'PASS',
      'Mensajes de excepción sanitizados y libres de valores sensibles');
  } catch (e: any) {
    record('TC-PIG-10', 'Cero Filtración de Credenciales o JWTs en Trazas de Error', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-11: Despliegue legítimo de Producción en main permitido inequívocamente
  // ---------------------------------------------------------------------------
  try {
    const prodEnv = {
      VERCEL: '1',
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_REF: 'main',
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: productionAnon,
      SUPABASE_SERVICE_ROLE_KEY: productionService
    };
    const res = verifyPreviewEnvironment(prodEnv);
    assert.strictEqual(res.status, 'PRODUCTION_ALLOWED');
    record('TC-PIG-11', 'Permisividad en Despliegue Legítimo de Producción (main)', 'PASS',
      'Despliegues productivos no se ven afectados ni interrumpidos');
  } catch (e: any) {
    record('TC-PIG-11', 'Permisividad en Despliegue Legítimo de Producción (main)', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-12: Rechazo universal en Preview genérico ante credenciales de producción
  // ---------------------------------------------------------------------------
  try {
    const genericPreviewEnv = {
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'feature/otra-rama',
      ACIACAM_PREVIEW_SUPABASE_REF: 'otro-proyecto',
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`
    };
    assert.throws(() => verifyPreviewEnvironment(genericPreviewEnv), /URL de Supabase Producción estrictamente prohibida/);
    record('TC-PIG-12', 'Rechazo Universal en Preview Genérico ante URLs de Producción', 'PASS',
      'Cualquier rama preview con URL productiva es bloqueada');
  } catch (e: any) {
    record('TC-PIG-12', 'Rechazo Universal en Preview Genérico ante URLs de Producción', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-13: Negativa: Rama desconocida o no identificable (fail-closed)
  // ---------------------------------------------------------------------------
  try {
    const unknownBranchEnv = {
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: '',
      GIT_BRANCH_OVERRIDE: ''
    };
    assert.throws(() => verifyPreviewEnvironment(unknownBranchEnv), /rama desconocida/);
    record('TC-PIG-13', 'Rechazo Fail-Closed ante Rama Desconocida o No Identificable', 'PASS',
      'Build abortado inmediatamente si la rama Git no puede resolverse con certeza');
  } catch (e: any) {
    record('TC-PIG-13', 'Rechazo Fail-Closed ante Rama Desconocida o No Identificable', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-14: Negativa: Production declarada en rama feature (inconsistencia crítica)
  // ---------------------------------------------------------------------------
  try {
    const prodInFeatureEnv = {
      VERCEL: '1',
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_REF: CONSOLIDATED_BRANCH,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: productionAnon,
      SUPABASE_SERVICE_ROLE_KEY: productionService
    };
    assert.throws(() => verifyPreviewEnvironment(prodInFeatureEnv), /VERCEL_ENV='production' declarado en rama no autorizada/);
    record('TC-PIG-14', 'Rechazo si VERCEL_ENV=production se declara en rama Feature', 'PASS',
      'Inconsistencia crítica interceptada; producción solo permitida en main');
  } catch (e: any) {
    record('TC-PIG-14', 'Rechazo si VERCEL_ENV=production se declara en rama Feature', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-15: Negativa: Ausencia total de indicadores de entorno
  // ---------------------------------------------------------------------------
  try {
    const emptyIndicatorsEnv = {
      GIT_BRANCH_OVERRIDE: 'feature/untracked-experiment'
      // Sin VERCEL, sin VERCEL_ENV, sin CI, sin NODE_ENV, sin ACIACAM_PREVIEW_SUPABASE_REF
    };
    assert.throws(() => verifyPreviewEnvironment(emptyIndicatorsEnv), /Ausencia de indicadores de entorno/);
    record('TC-PIG-15', 'Rechazo Fail-Closed ante Ausencia Total de Indicadores de Entorno', 'PASS',
      'Build abortado si no existen indicadores confiables para certificar aislamiento');
  } catch (e: any) {
    record('TC-PIG-15', 'Rechazo Fail-Closed ante Ausencia Total de Indicadores de Entorno', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-16: Negativa: JWT ficticio malformado (segmentos incompletos o cadena inválida)
  // ---------------------------------------------------------------------------
  try {
    const malformedToken = 'eyJhbGciOiJIUzI1NiJ9.solamente_dos_segmentos';
    const env = { ...baseValidConsolidatedEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: malformedToken };
    assert.throws(() => verifyPreviewEnvironment(env), /JWT estructuralmente válido/);
    record('TC-PIG-16', 'Rechazo ante JWT Ficticio Malformado (segmentos incompletos)', 'PASS',
      'Token sin estructura estándar de 3 segmentos rechazado fail-closed');
  } catch (e: any) {
    record('TC-PIG-16', 'Rechazo ante JWT Ficticio Malformado (segmentos incompletos)', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-17: Negativa: JWT ficticio con payload JSON corrupto
  // ---------------------------------------------------------------------------
  try {
    const corruptPayloadToken = 'eyJhbGciOiJIUzI1NiJ9.payload_no_es_json_valido.dummy_signature';
    const env = { ...baseValidConsolidatedEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: corruptPayloadToken };
    assert.throws(() => verifyPreviewEnvironment(env), /JWT estructuralmente válido/);
    record('TC-PIG-17', 'Rechazo ante JWT Ficticio con Payload No Parseable', 'PASS',
      'Payload base64url que no deserializa a JSON válido es rechazado');
  } catch (e: any) {
    record('TC-PIG-17', 'Rechazo ante JWT Ficticio con Payload No Parseable', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-18: Negativa: JWT ficticio con rol incorrecto en anon o service_role
  // ---------------------------------------------------------------------------
  try {
    // service_role token que presenta role 'anon' o rol espurio
    const wrongRoleToken = createDummyJwt(INTEGRATION_SUPABASE_REF, 'authenticated');
    const env = { ...baseValidConsolidatedEnv, SUPABASE_SERVICE_ROLE_KEY: wrongRoleToken };
    assert.throws(() => verifyPreviewEnvironment(env), /SUPABASE_SERVICE_ROLE_KEY debe tener role 'service_role'/);
    record('TC-PIG-18', 'Rechazo ante JWT Ficticio con Role Incorrecto', 'PASS',
      'Role distinto al exigido para service_role interceptado');
  } catch (e: any) {
    record('TC-PIG-18', 'Rechazo ante JWT Ficticio con Role Incorrecto', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-19: Negativa: JWT ficticio con ref de proyecto ajeno/desconocido
  // ---------------------------------------------------------------------------
  try {
    const alienRefToken = createDummyJwt('randomalienprojectref', 'anon');
    const env = { ...baseValidConsolidatedEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: alienRefToken };
    assert.throws(() => verifyPreviewEnvironment(env), /debe tener ref 'uqwuhjxzazsexuvqxmfm'/);
    record('TC-PIG-19', 'Rechazo ante JWT Ficticio con Referencia de Proyecto Ajena', 'PASS',
      'Ref discrepante con el proyecto Integration rechazado fail-closed');
  } catch (e: any) {
    record('TC-PIG-19', 'Rechazo ante JWT Ficticio con Referencia de Proyecto Ajena', 'FAIL', e.message);
  }

  // ---------------------------------------------------------------------------
  // TC-PIG-20: Negativa: Entorno Vercel ambiguo en rama main (sin VERCEL_ENV production)
  // ---------------------------------------------------------------------------
  try {
    const ambiguousVercelMainEnv = {
      VERCEL: '1',
      VERCEL_GIT_COMMIT_REF: 'main',
      VERCEL_ENV: undefined // En Vercel en rama main pero sin certificar producción
    };
    assert.throws(() => verifyPreviewEnvironment(ambiguousVercelMainEnv), /Entorno Vercel ambiguo en rama principal/);
    record('TC-PIG-20', 'Rechazo Fail-Closed ante Entorno Vercel Ambiguo en Rama Main', 'PASS',
      'Ambivalencia en Vercel sobre rama main bloquea ejecución prebuild');
  } catch (e: any) {
    record('TC-PIG-20', 'Rechazo Fail-Closed ante Entorno Vercel Ambiguo en Rama Main', 'FAIL', e.message);
  }

  console.log('\n' + '='.repeat(78));
  console.log(`RESUMEN GUARD PREVIEW: ${results.filter(r => r.status === 'PASS').length}/${results.length} PASARON`);
  console.log('='.repeat(78));

  const failed = results.filter(r => r.status === 'FAIL');
  if (failed.length > 0) {
    console.error(`\n❌ Se encontraron ${failed.length} fallos en el guard de aislamiento.`);
    process.exit(1);
  } else {
    console.log(`\n✅ SUITE DE AISLAMIENTO PREVIEW EXITOSA (${results.length}/${results.length} PASS).`);
  }
}

runIsolationGuardSuite().catch(err => {
  console.error('Fatal suite error:', err);
  process.exit(1);
});
