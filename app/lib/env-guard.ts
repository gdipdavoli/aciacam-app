/**
 * Guarda de Seguridad de Entorno y Aislamiento para ACIACAM App
 * Valida la alineación estricta entre las URLs públicas y las claves de Service Role.
 * Soporta de forma explícita tanto el entorno de Producción Legítima como el entorno de Integration E2E.
 * Implementa un comportamiento estrictamente FAIL-CLOSED ante configuraciones mixtas o incoherentes.
 */

export interface EnvValidationResult {
  valid: boolean;
  environment: 'production' | 'integration';
  targetRef: string;
  isProductionBlocked: boolean;
}

const INTEGRATION_REF = 'uqwuhjxzazsexuvqxmfm';
const PRODUCTION_REF = 'wfzbkcdmlcrjyrtauccu';

function parseJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(payloadBase64, 'base64').toString('utf8');
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export function validateEnvironmentOrThrow(): EnvValidationResult {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl) {
    throw new Error('ABORTAR: La variable de entorno NEXT_PUBLIC_SUPABASE_URL no está definida.');
  }

  let urlRef: string | null = null;
  if (supabaseUrl.includes(INTEGRATION_REF)) {
    urlRef = INTEGRATION_REF;
  } else if (supabaseUrl.includes(PRODUCTION_REF)) {
    urlRef = PRODUCTION_REF;
  } else {
    throw new Error(`ABORTAR: NEXT_PUBLIC_SUPABASE_URL no corresponde a un proyecto autorizado (${supabaseUrl}).`);
  }

  let keyRef: string | null = null;
  if (serviceRoleKey) {
    const jwt = parseJwtPayload(serviceRoleKey);
    if (!jwt) {
      throw new Error('ABORTAR: SUPABASE_SERVICE_ROLE_KEY es opaca, malformada o no posee un formato JWT estándar.');
    }
    keyRef = jwt.ref || (jwt.iss && typeof jwt.iss === 'string' ? jwt.iss.split('/')[3] : null);
    if (!keyRef) {
      throw new Error('ABORTAR: No se pudo extraer el claim project_ref de la llave SUPABASE_SERVICE_ROLE_KEY.');
    }
  }

  // Comprobación de Configuración Mixta (Mismatch FAIL-CLOSED)
  if (keyRef && keyRef !== urlRef) {
    throw new Error(
      `ABORTAR CRÍTICO DE SEGURIDAD: Configuración mixta detectada. NEXT_PUBLIC_SUPABASE_URL apunta a '${urlRef}', pero SUPABASE_SERVICE_ROLE_KEY pertenece a '${keyRef}'.`
    );
  }

  const isE2EIntegrationMode = process.env.INTEGRATION_E2E === 'true' || process.env.EMAIL_DISABLE_EXTERNAL === 'true';

  // Si se fuerza modo E2E Integration, verificar que no haya referencias a Producción
  if (isE2EIntegrationMode && urlRef !== INTEGRATION_REF) {
    throw new Error(
      `ABORTAR CRÍTICO DE SEGURIDAD: Modo Integration E2E activo pero la URL apunta al proyecto '${urlRef}'. Se requiere el proyecto '${INTEGRATION_REF}'.`
    );
  }

  return {
    valid: true,
    environment: urlRef === PRODUCTION_REF ? 'production' : 'integration',
    targetRef: urlRef,
    isProductionBlocked: urlRef === INTEGRATION_REF
  };
}
