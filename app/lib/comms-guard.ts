/**
 * Política centralizada de protección y bloqueo de comunicaciones externas para ACIACAM App.
 * Comportamiento FAIL-CLOSED para entornos de Integration, Staging, E2E y pruebas locales.
 * Impide cualquier envío accidental de correos (Resend, Supabase Auth GoTrue) o mensajes de WhatsApp.
 */

export interface CommsSimulationDetails {
  channel: 'email' | 'whatsapp' | 'auth_invite';
  recipient: string;
  action: string;
  subjectOrType?: string;
  metadata?: Record<string, any>;
}

export interface CommsBlockStatus {
  isBlocked: boolean;
  reason: string;
  environment: 'production' | 'integration' | 'development' | 'test' | 'inconsistent';
}

const INTEGRATION_REF = 'uqwuhjxzazsexuvqxmfm';
const PRODUCTION_REF = 'wfzbkcdmlcrjyrtauccu';

function isTruthy(val: string | undefined): boolean {
  if (!val) return false;
  return /^(true|1|yes|enabled)$/i.test(val.trim());
}

/**
 * Enmascara direcciones de correo o números de teléfono para auditoría segura.
 * Nunca expone datos personales en logs.
 */
export function maskRecipient(recipient: string): string {
  if (!recipient || typeof recipient !== 'string') return '***';
  const trimmed = recipient.trim();
  if (trimmed.includes('@')) {
    const [local, domain] = trimmed.split('@');
    const maskedLocal = local.length <= 2 
      ? `${local[0] || ''}***` 
      : `${local[0]}***${local.slice(-1)}`;
    return `${maskedLocal}@${domain || 'masked'}`;
  }
  // Teléfono o identificador alfanumérico
  const digits = trimmed.replace(/\s+/g, '');
  if (digits.length <= 4) return '***';
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`;
}

/**
 * Evalúa si las comunicaciones salientes hacia destinatarios reales están bloqueadas.
 * Comportamiento FAIL-CLOSED ante cualquier incertidumbre:
 * 1. Flags explícitos de Integration / Bloqueo (INTEGRATION_E2E, NEXT_PUBLIC_INTEGRATION_E2E, EMAIL_DISABLE_EXTERNAL, COMMS_DISABLE_EXTERNAL).
 * 2. Entornos de prueba o CI (NODE_ENV === 'test').
 * 3. Ausencia, nulidad o malformación de la URL de Supabase.
 * 4. Base de datos no productiva (Integration uqwuhjxzazsexuvqxmfm, localhost, staging o desconocida).
 * 
 * Únicamente retorna isBlocked: false cuando la URL es inequívocamente la de Producción Legítima
 * (wfzbkcdmlcrjyrtauccu) Y ninguno de los flags de mitigación esté encendido.
 */
export function getOutboundCommsStatus(): CommsBlockStatus {
  // 1. Revisión de flags de bloqueo explícitos (servidor y cliente)
  const isE2E = isTruthy(process.env.INTEGRATION_E2E) || isTruthy(process.env.NEXT_PUBLIC_INTEGRATION_E2E);
  const emailDisabled = isTruthy(process.env.EMAIL_DISABLE_EXTERNAL) || isTruthy(process.env.NEXT_PUBLIC_EMAIL_DISABLE_EXTERNAL);
  const commsDisabled = isTruthy(process.env.COMMS_DISABLE_EXTERNAL) || isTruthy(process.env.NEXT_PUBLIC_COMMS_DISABLE_EXTERNAL);

  if (isE2E) {
    return { isBlocked: true, reason: 'INTEGRATION_E2E activo', environment: 'integration' };
  }
  if (emailDisabled) {
    return { isBlocked: true, reason: 'EMAIL_DISABLE_EXTERNAL activo', environment: 'integration' };
  }
  if (commsDisabled) {
    return { isBlocked: true, reason: 'COMMS_DISABLE_EXTERNAL activo', environment: 'integration' };
  }

  // 2. Revisión de entorno de pruebas
  if (process.env.NODE_ENV === 'test') {
    return { isBlocked: true, reason: 'NODE_ENV=test activo', environment: 'test' };
  }

  // 3. Revisión de URL de Supabase (servidor y cliente)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  if (!supabaseUrl || supabaseUrl === 'undefined' || supabaseUrl === 'null') {
    return { isBlocked: true, reason: 'FAIL-CLOSED: Ausencia de URL de base de datos', environment: 'inconsistent' };
  }

  const isIntegrationDb = supabaseUrl.includes(INTEGRATION_REF);
  const isProductionDb = supabaseUrl.includes(PRODUCTION_REF);

  if (isIntegrationDb) {
    return { isBlocked: true, reason: 'Base de datos Supabase Integration detectada (uqwuhjxzazsexuvqxmfm)', environment: 'integration' };
  }

  if (!isProductionDb) {
    return { isBlocked: true, reason: 'FAIL-CLOSED: URL no corresponde a la instancia certificada de Producción', environment: 'inconsistent' };
  }

  // 4. Solo si apunta inequívocamente a Producción y ningún flag está activo
  return { isBlocked: false, reason: 'Producción legítima con autorizaciones válidas', environment: 'production' };
}

export function isOutboundCommsBlocked(): boolean {
  return getOutboundCommsStatus().isBlocked;
}

/**
 * Registra una simulación de comunicación saliente sin exponer credenciales ni datos personales.
 */
export function logCommsSimulation(details: CommsSimulationDetails): {
  simulated: true;
  maskedRecipient: string;
  channel: string;
  action: string;
} {
  const masked = maskRecipient(details.recipient);
  console.log(`[COMMS_SIMULATION] Canal: ${details.channel} | Destino: ${masked} | Acción: ${details.action} | Tipo: ${details.subjectOrType || 'N/A'}`);
  return {
    simulated: true,
    maskedRecipient: masked,
    channel: details.channel,
    action: details.action,
  };
}
