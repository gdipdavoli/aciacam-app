/**
 * scripts/check-preview-isolation.cjs
 *
 * ACIACAM — Guardián Centralizado de Aislamiento de Entorno Prebuild
 *
 * Principios:
 * - Fail-Closed: Ante cualquier ambigüedad, ausencia de indicadores o discrepancia, aborta el build.
 * - Cero filtración de credenciales: Nunca imprime JWTs, firmas ni claves secretas en logs o errores.
 * - Inspección Estructural de Claims JWT: Decodifica de forma segura los claims 'ref' y 'role'
 *   del payload de las claves anon y service_role para certificar correspondencia con Integration.
 * - Aislamiento Estricto de Producción: Solo permite build de Producción ante identificación
 *   inequívoca simultánea de VERCEL_ENV='production' y rama principal 'main'.
 *   Cualquier intento de declarar Production en ramas feature es bloqueado de inmediato.
 */

const { execSync } = require('child_process');

const PRODUCTION_SUPABASE_REF = 'wfzbkcdmlcrjyrtauccu';
const INTEGRATION_SUPABASE_REF = 'uqwuhjxzazsexuvqxmfm';
const CONSOLIDATED_BRANCH = 'feature/sprint7b8-integration-consolidated';
const ALLOWED_PRODUCTION_BRANCHES = ['main'];

/**
 * Inspecciona de forma segura la estructura y claims del payload de un token JWT de Supabase.
 * Nunca expone la firma, clave o contenido sensible.
 */
function inspectJwtClaims(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null; // Debe ser un JWT con 3 segmentos (header.payload.signature)
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    return {
      ref: typeof payload.ref === 'string' ? payload.ref.trim() : null,
      role: typeof payload.role === 'string' ? payload.role.trim() : null
    };
  } catch {
    return null;
  }
}

/**
 * Resuelve la rama Git activa considerando variables de Vercel/CI y fallback local.
 */
function resolveGitBranch(env) {
  if (typeof env.VERCEL_GIT_COMMIT_REF === 'string') {
    return env.VERCEL_GIT_COMMIT_REF.trim();
  }
  if (typeof env.GIT_BRANCH === 'string') {
    return env.GIT_BRANCH.trim();
  }
  if (typeof env.BRANCH_NAME === 'string') {
    return env.BRANCH_NAME.trim();
  }
  if (env.GIT_BRANCH_OVERRIDE !== undefined) {
    return typeof env.GIT_BRANCH_OVERRIDE === 'string' ? env.GIT_BRANCH_OVERRIDE.trim() : '';
  }
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 3000
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Valida de forma estricta las invariantes de aislamiento antes de permitir el build de Next.js.
 */
function verifyPreviewEnvironment(env = process.env) {
  const branch = resolveGitBranch(env);
  const isVercel = env.VERCEL === '1' || env.NOW_BUILDER === '1' || Boolean(env.VERCEL_ENV) || Boolean(env.VERCEL_URL);

  // ---------------------------------------------------------------------------
  // 1. FAIL-CLOSED ANTE RAMA DESCONOCIDA O NO IDENTIFICABLE
  // ---------------------------------------------------------------------------
  if (!branch) {
    throw new Error(
      '[ISOLATION_GUARD_ABORT] No se pudo identificar la rama Git (rama desconocida). Abortando por seguridad (fail-closed).'
    );
  }

  // ---------------------------------------------------------------------------
  // 2. FAIL-CLOSED ANTE AUSENCIA DE INDICADORES DE ENTORNO
  // Si no hay indicadores de entorno (ni VERCEL_ENV, ni NEXT_PUBLIC_VERCEL_ENV, ni NODE_ENV,
  // ni VERCEL, ni CI, ni referencia de Supabase preview configurada), abortar.
  // ---------------------------------------------------------------------------
  const hasEnvIndicators =
    Boolean(env.VERCEL_ENV) ||
    Boolean(env.NEXT_PUBLIC_VERCEL_ENV) ||
    Boolean(env.NODE_ENV) ||
    Boolean(env.VERCEL) ||
    Boolean(env.CI) ||
    Boolean(env.ACIACAM_PREVIEW_SUPABASE_REF);

  if (!hasEnvIndicators) {
    throw new Error(
      '[ISOLATION_GUARD_ABORT] Ausencia de indicadores de entorno. Imposible certificar aislamiento. Abortando por seguridad.'
    );
  }

  // ---------------------------------------------------------------------------
  // 3. REGLA DE PRODUCCIÓN INEQUÍVOCA (FAIL-CLOSED)
  // Producción solo se autoriza si coexisten simultáneamente:
  // - VERCEL_ENV === 'production'
  // - Rama Git resuelta y perteneciente estrictamente a ALLOWED_PRODUCTION_BRANCHES ('main')
  // ---------------------------------------------------------------------------
  if (env.VERCEL_ENV === 'production') {
    if (!ALLOWED_PRODUCTION_BRANCHES.includes(branch)) {
      throw new Error(
        `[ISOLATION_GUARD_ABORT] Inconsistencia crítica: VERCEL_ENV='production' declarado en rama no autorizada ('${branch}').`
      );
    }
    const prodUrl = (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').trim();
    if (prodUrl.includes(INTEGRATION_SUPABASE_REF)) {
      throw new Error('[ISOLATION_GUARD_ABORT] URL de Supabase Integration detectada en entorno Production.');
    }
    // Entorno de producción genuino verificado inequívocamente
    return { status: 'PRODUCTION_ALLOWED' };
  }

  // ---------------------------------------------------------------------------
  // 4. FAIL-CLOSED ANTE ENTORNO VERCEL AMBIGUO
  // Si está en Vercel y VERCEL_ENV no está definido o es ambiguo en la rama principal main
  // ---------------------------------------------------------------------------
  if (isVercel && branch === 'main' && env.VERCEL_ENV !== 'production') {
    throw new Error(
      '[ISOLATION_GUARD_ABORT] Entorno Vercel ambiguo en rama principal (VERCEL_ENV no es production). Abortando por seguridad.'
    );
  }

  // ---------------------------------------------------------------------------
  // 5. DETERMINACIÓN DE CONTEXTO PREVIEW / RAMA FEATURE
  // ---------------------------------------------------------------------------
  const isConsolidated = branch === CONSOLIDATED_BRANCH;
  const isPreviewContext =
    env.VERCEL_ENV === 'preview' ||
    env.NEXT_PUBLIC_VERCEL_ENV === 'preview' ||
    isVercel ||
    isConsolidated ||
    branch.startsWith('feature/') ||
    branch.startsWith('fix/');

  // Si es una ejecución local fuera de Vercel y fuera de ramas feature, permitir como desarrollo local
  if (!isVercel && !isPreviewContext && !isConsolidated) {
    return { status: 'LOCAL_DEFAULT_ALLOWED' };
  }

  // ---------------------------------------------------------------------------
  // 6. BARRERA UNIVERSAL ANTI-PRODUCCIÓN EN PREVIEWS
  // Ningún Preview puede bajo ninguna circunstancia emplear URL ni credenciales productivas
  // ---------------------------------------------------------------------------
  const url = (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').trim();
  const anonKey = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  const servKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  const anonClaims = inspectJwtClaims(anonKey);
  const servClaims = inspectJwtClaims(servKey);

  if (url.includes(PRODUCTION_SUPABASE_REF)) {
    throw new Error('[ISOLATION_GUARD_ABORT] URL de Supabase Producción estrictamente prohibida en contexto Preview.');
  }

  if (anonClaims && anonClaims.ref === PRODUCTION_SUPABASE_REF) {
    throw new Error('[ISOLATION_GUARD_ABORT] NEXT_PUBLIC_SUPABASE_ANON_KEY contiene claims de Supabase Producción.');
  }

  if (servClaims && servClaims.ref === PRODUCTION_SUPABASE_REF) {
    throw new Error('[ISOLATION_GUARD_ABORT] SUPABASE_SERVICE_ROLE_KEY contiene claims de Supabase Producción.');
  }

  // ---------------------------------------------------------------------------
  // 7. REQUISITOS OBLIGATORIOS PARA LA RAMA CONSOLIDADA
  // ---------------------------------------------------------------------------
  if (isConsolidated) {
    // 7.1 Referencia de proyecto Integration
    const previewRef = (env.ACIACAM_PREVIEW_SUPABASE_REF || '').trim();
    if (previewRef !== INTEGRATION_SUPABASE_REF) {
      throw new Error(`[ISOLATION_GUARD_ABORT] ACIACAM_PREVIEW_SUPABASE_REF debe ser exactamente '${INTEGRATION_SUPABASE_REF}'.`);
    }

    // 7.2 URL de Supabase Integration
    const expectedUrl = `https://${INTEGRATION_SUPABASE_REF}.supabase.co`;
    if (env.NEXT_PUBLIC_SUPABASE_URL !== expectedUrl) {
      throw new Error(`[ISOLATION_GUARD_ABORT] NEXT_PUBLIC_SUPABASE_URL debe ser exactamente '${expectedUrl}'.`);
    }
    if (env.SUPABASE_URL && env.SUPABASE_URL !== expectedUrl) {
      throw new Error(`[ISOLATION_GUARD_ABORT] SUPABASE_URL debe ser exactamente '${expectedUrl}'.`);
    }

    // 7.3 Inspección Estructural de Claims de Tokens Supabase Integration
    if (!anonKey || !anonClaims) {
      throw new Error('[ISOLATION_GUARD_ABORT] NEXT_PUBLIC_SUPABASE_ANON_KEY debe ser un JWT estructuralmente válido.');
    }
    if (anonClaims.ref !== INTEGRATION_SUPABASE_REF) {
      throw new Error(`[ISOLATION_GUARD_ABORT] NEXT_PUBLIC_SUPABASE_ANON_KEY debe tener ref '${INTEGRATION_SUPABASE_REF}'.`);
    }
    if (anonClaims.role !== 'anon') {
      throw new Error("[ISOLATION_GUARD_ABORT] NEXT_PUBLIC_SUPABASE_ANON_KEY debe tener role 'anon'.");
    }

    if (!servKey || !servClaims) {
      throw new Error('[ISOLATION_GUARD_ABORT] SUPABASE_SERVICE_ROLE_KEY debe ser un JWT estructuralmente válido.');
    }
    if (servClaims.ref !== INTEGRATION_SUPABASE_REF) {
      throw new Error(`[ISOLATION_GUARD_ABORT] SUPABASE_SERVICE_ROLE_KEY debe tener ref '${INTEGRATION_SUPABASE_REF}'.`);
    }
    if (servClaims.role !== 'service_role') {
      throw new Error("[ISOLATION_GUARD_ABORT] SUPABASE_SERVICE_ROLE_KEY debe tener role 'service_role'.");
    }

    // 7.4 Flags de aislamiento funcional y comunicaciones
    if (env.INTEGRATION_E2E !== 'true') {
      throw new Error("[ISOLATION_GUARD_ABORT] INTEGRATION_E2E debe ser 'true' para la rama consolidada.");
    }
    if (env.EMAIL_DISABLE_EXTERNAL !== 'true') {
      throw new Error("[ISOLATION_GUARD_ABORT] EMAIL_DISABLE_EXTERNAL debe ser 'true' para la rama consolidada.");
    }
    if (env.COMMS_DISABLE_EXTERNAL !== 'true') {
      throw new Error("[ISOLATION_GUARD_ABORT] COMMS_DISABLE_EXTERNAL debe ser 'true' para la rama consolidada.");
    }

    return { status: 'CONSOLIDATED_INTEGRATION_VERIFIED' };
  }

  // ---------------------------------------------------------------------------
  // 8. REQUISITOS GENERALES PARA OTRAS RAMAS PREVIEW
  // ---------------------------------------------------------------------------
  const ref = (env.ACIACAM_PREVIEW_SUPABASE_REF || '').trim();
  if (!ref || ref === PRODUCTION_SUPABASE_REF || !/^[a-z0-9]+$/.test(ref)) {
    throw new Error('[ISOLATION_GUARD_ABORT] Preview necesita ACIACAM_PREVIEW_SUPABASE_REF de un proyecto separado no productivo.');
  }

  const expectedPreviewUrl = `https://${ref}.supabase.co`;
  if (env.NEXT_PUBLIC_SUPABASE_URL !== expectedPreviewUrl || (env.SUPABASE_URL && env.SUPABASE_URL !== expectedPreviewUrl)) {
    throw new Error('[ISOLATION_GUARD_ABORT] Las URLs de Supabase de Preview deben apuntar al proyecto separado.');
  }

  return { status: 'GENERIC_PREVIEW_VERIFIED' };
}

module.exports = {
  verifyPreviewEnvironment,
  inspectJwtClaims,
  resolveGitBranch,
  PRODUCTION_SUPABASE_REF,
  INTEGRATION_SUPABASE_REF,
  CONSOLIDATED_BRANCH,
  ALLOWED_PRODUCTION_BRANCHES
};

if (require.main === module) {
  try {
    verifyPreviewEnvironment(process.env);
  } catch (err) {
    console.error(`\n❌ PREBUILD BLOQUEADO POR GUARD DE AISLAMIENTO: ${err.message}\n`);
    process.exit(1);
  }
}
