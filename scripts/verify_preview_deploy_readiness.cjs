/**
 * scripts/verify_preview_deploy_readiness.cjs
 *
 * ACIACAM — Verificación Pre-Deploy Fail-Closed para Vercel Preview (Integration)
 *
 * No depende del guard de build ni confía en VERCEL_GIT_COMMIT_REF como sustituto
 * de una configuración segura: inspecciona la configuración real del proyecto Vercel,
 * Deployment Protection y las variables efectivas del target Preview antes de autorizar
 * un despliegue, sin imprimir secretos ni dejar archivos persistentes con credenciales.
 */

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  verifyPreviewEnvironment,
  inspectJwtClaims,
  INTEGRATION_SUPABASE_REF,
  PRODUCTION_SUPABASE_REF,
  CONSOLIDATED_BRANCH
} = require('./check-preview-isolation.cjs');

function parseArgs(argv) {
  const opts = {
    target: 'preview',
    branch: CONSOLIDATED_BRANCH,
    vercelProjectDir: path.resolve(__dirname, '..'),
    projectName: 'aciacam-member-app'
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target' && argv[i + 1]) opts.target = argv[++i];
    else if (arg === '--branch' && argv[i + 1]) opts.branch = argv[++i];
    else if (arg === '--vercel-dir' && argv[i + 1]) opts.vercelProjectDir = path.resolve(argv[++i]);
    else if (arg === '--project' && argv[i + 1]) opts.projectName = argv[++i];
  }
  return opts;
}

function parseEnvContent(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function runVercel(args, cwd) {
  const isWin = process.platform === 'win32';
  const res = spawnSync(isWin ? 'cmd.exe' : 'vercel', isWin ? ['/c', 'vercel', ...args] : args, {
    cwd,
    encoding: 'utf8',
    timeout: 30000
  });
  if (res.status !== 0) {
    throw new Error(`Fallo al consultar Vercel CLI (${args.join(' ')}): ${(res.stderr || res.stdout || '').trim()}`);
  }
  return res.stdout;
}

function verifyPulledPreviewEnv(pulledEnv, opts) {
  assert.equal(opts.target, 'preview', `ABORTAR: El destino debe ser 'preview', recibido '${opts.target}'.`);

  for (const [k, v] of Object.entries(pulledEnv)) {
    if (typeof v === 'string' && v.includes(PRODUCTION_SUPABASE_REF)) {
      throw new Error(`ABORTAR: La variable '${k}' contiene referencia a Producción (${PRODUCTION_SUPABASE_REF}).`);
    }
  }

  assert.equal(
    pulledEnv.ACIACAM_PREVIEW_SUPABASE_REF,
    INTEGRATION_SUPABASE_REF,
    `ABORTAR: ACIACAM_PREVIEW_SUPABASE_REF debe ser '${INTEGRATION_SUPABASE_REF}'.`
  );
  assert.equal(
    pulledEnv.NEXT_PUBLIC_SUPABASE_URL,
    `https://${INTEGRATION_SUPABASE_REF}.supabase.co`,
    'ABORTAR: NEXT_PUBLIC_SUPABASE_URL no apunta a Integration.'
  );

  const anonClaims = inspectJwtClaims(pulledEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const serviceClaims = inspectJwtClaims(pulledEnv.SUPABASE_SERVICE_ROLE_KEY);
  assert.ok(anonClaims && anonClaims.ref === INTEGRATION_SUPABASE_REF && anonClaims.role === 'anon', 'ABORTAR: NEXT_PUBLIC_SUPABASE_ANON_KEY inválida para Integration.');
  assert.ok(serviceClaims && serviceClaims.ref === INTEGRATION_SUPABASE_REF && serviceClaims.role === 'service_role', 'ABORTAR: SUPABASE_SERVICE_ROLE_KEY inválida para Integration.');

  assert.equal(pulledEnv.INTEGRATION_E2E, 'true', "ABORTAR: INTEGRATION_E2E debe ser 'true'.");
  assert.equal(pulledEnv.EMAIL_DISABLE_EXTERNAL, 'true', "ABORTAR: EMAIL_DISABLE_EXTERNAL debe ser 'true'.");
  assert.equal(pulledEnv.COMMS_DISABLE_EXTERNAL, 'true', "ABORTAR: COMMS_DISABLE_EXTERNAL debe ser 'true'.");
  assert.notEqual(pulledEnv.AGENT_CORE_ENABLED, 'true', 'ABORTAR: AGENT_CORE_ENABLED debe permanecer deshabilitado.');
  assert.notEqual(pulledEnv.AGENT_ORDER_EXECUTION_ENABLED, 'true', 'ABORTAR: AGENT_ORDER_EXECUTION_ENABLED debe permanecer deshabilitado.');

  // Validar también con el guard de build simulando VERCEL_ENV=preview sin depender de VERCEL_GIT_COMMIT_REF
  return verifyPreviewEnvironment({
    ...pulledEnv,
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_REF: opts.branch
  });
}

function main() {
  const opts = parseArgs(process.argv);
  assert.equal(opts.target, 'preview', `ABORTAR: Target prohibido '${opts.target}'. Solo se permite 'preview'.`);

  // 1. Verificar Deployment Protection en Vercel (sin modificar nada)
  const projectRaw = runVercel(['api', `/v9/projects/${opts.projectName}`], opts.vercelProjectDir);
  const project = JSON.parse(projectRaw);
  const hasSso = Boolean(project?.ssoProtection && project.ssoProtection.deploymentType);
  const hasPassword = Boolean(project?.passwordProtection && project.passwordProtection.deploymentType);
  assert.ok(hasSso || hasPassword, 'ABORTAR: Deployment Protection no está habilitada en el proyecto Vercel.');

  // 2. Extraer variables del entorno Preview objetivo en directorio privado efímero y destruirlas en finally
  const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aciacam-vcheck-'));
  const tmpEnvPath = path.join(privateDir, 'preview.env');
  let pulledEnv = {};
  try {
    runVercel(
      ['env', 'pull', tmpEnvPath, '--environment=preview', `--git-branch=${opts.branch}`, '--yes'],
      opts.vercelProjectDir
    );
    pulledEnv = parseEnvContent(fs.readFileSync(tmpEnvPath, 'utf8'));
  } finally {
    if (fs.existsSync(tmpEnvPath)) {
      fs.writeFileSync(tmpEnvPath, '0'.repeat(128), 'utf8');
      fs.rmSync(tmpEnvPath, { force: true });
    }
    fs.rmSync(privateDir, { recursive: true, force: true });
  }

  const guardResult = verifyPulledPreviewEnv(pulledEnv, opts);

  console.log(JSON.stringify({
    readiness: 'PREVIEW_ISOLATION_VERIFIED',
    target: opts.target,
    branchChecked: opts.branch,
    project: opts.projectName,
    deploymentProtection: project.ssoProtection?.deploymentType || project.passwordProtection?.deploymentType,
    supabaseRef: INTEGRATION_SUPABASE_REF,
    integrationE2E: pulledEnv.INTEGRATION_E2E,
    emailDisableExternal: pulledEnv.EMAIL_DISABLE_EXTERNAL,
    commsDisableExternal: pulledEnv.COMMS_DISABLE_EXTERNAL,
    agentCoreEnabled: pulledEnv.AGENT_CORE_ENABLED === 'true',
    agentOrderExecutionEnabled: pulledEnv.AGENT_ORDER_EXECUTION_ENABLED === 'true',
    guardStatus: guardResult.status
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ VERIFICACIÓN PRE-DEPLOY BLOQUEADA: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { verifyPulledPreviewEnv, parseEnvContent };
