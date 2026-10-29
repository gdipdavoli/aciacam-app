/**
 * Suite de Pruebas Automatizadas — Sprint 7B.8: Protección de Comunicaciones Externas en Integration
 * 
 * Valida:
 * 1. Política centralizada de bloqueo (fail-closed, flags explícitos, variaciones truthy y detección por DB)
 * 2. Comportamiento seguro ante configuraciones inconsistentes o URLs ausentes/malformadas
 * 3. Enmascaramiento estricto de destinatarios (sin fuga de PII en logs)
 * 4. Simulación de EmailService.sendInviteEmail
 * 5. Intercepción de endpoints críticos:
 *    - POST /api/admin/cierres/send-email (Resend HTTP bypass)
 *    - POST /api/admin/invite (Supabase inviteUserByEmail -> generateLink bypass)
 *    - POST /api/admin/invite/bulk (Supabase inviteUserByEmail -> generateLink bypass)
 *    - POST /api/whatsapp/webhook (Meta Graph API fetch bypass)
 *    - Recuperación de contraseña en cliente: app/(auth)/forgot-password/page.tsx
 * 6. Validación de generateLink como mecanismo sin despacho de emails en GoTrue
 * 7. Restricción estricta de dominios de prueba (RFC 2606)
 * 8. Comportamiento en Producción legítima (passthrough)
 */

import {
  isOutboundCommsBlocked,
  getOutboundCommsStatus,
  maskRecipient,
  logCommsSimulation
} from '../app/lib/comms-guard';
import { EmailService } from '../services/emailService';

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    results.push({ name, passed: true });
    console.log(`  ✓ PASS: ${name}`);
  } else {
    results.push({ name, passed: false, detail });
    console.error(`  ✗ FAIL: ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// Guarda de variables de entorno para restauración
const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.INTEGRATION_E2E;
  delete process.env.NEXT_PUBLIC_INTEGRATION_E2E;
  delete process.env.EMAIL_DISABLE_EXTERNAL;
  delete process.env.NEXT_PUBLIC_EMAIL_DISABLE_EXTERNAL;
  delete process.env.COMMS_DISABLE_EXTERNAL;
  delete process.env.NEXT_PUBLIC_COMMS_DISABLE_EXTERNAL;
  delete process.env.EMAIL_DEBUG;
  delete (process.env as Record<string, string | undefined>).NODE_ENV;
}

// Validador de dominios RFC 2606 para usuarios de prueba
function isSafeTestEmail(email: string): boolean {
  const allowedTestDomains = ['example.com', 'example.org', 'example.net', 'test.invalid', 'localhost'];
  const domain = email.split('@')[1]?.toLowerCase();
  return allowedTestDomains.includes(domain);
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 ACIACAM — Validación Final de Aislamiento de Comunicaciones');
  console.log('================================================================\n');

  // ----------------------------------------------------------------
  // BLOQUE 1: Política Centralizada Fail-Closed y Precedencias
  // ----------------------------------------------------------------
  console.log('--- Bloque 1: Política Centralizada de Bloqueo Fail-Closed ---');
  
  // Test 1.1: INTEGRATION_E2E = true
  resetEnv();
  process.env.INTEGRATION_E2E = 'true';
  assert(
    isOutboundCommsBlocked() === true,
    'Bloquea comunicaciones cuando INTEGRATION_E2E=true'
  );
  assert(
    getOutboundCommsStatus().reason.includes('INTEGRATION_E2E'),
    'Reporta razón adecuada al activar INTEGRATION_E2E'
  );

  // Test 1.2: Variaciones truthy de flags ('1', 'yes', 'TRUE')
  resetEnv();
  process.env.INTEGRATION_E2E = '1';
  assert(
    isOutboundCommsBlocked() === true,
    'Reconoce variación truthy INTEGRATION_E2E=1 como bloqueado'
  );

  resetEnv();
  process.env.INTEGRATION_E2E = 'yes';
  assert(
    isOutboundCommsBlocked() === true,
    'Reconoce variación truthy INTEGRATION_E2E=yes como bloqueado'
  );

  // Test 1.3: Flags de cliente (NEXT_PUBLIC_*)
  resetEnv();
  process.env.NEXT_PUBLIC_INTEGRATION_E2E = 'true';
  assert(
    isOutboundCommsBlocked() === true,
    'Reconoce flag de cliente NEXT_PUBLIC_INTEGRATION_E2E=true como bloqueado'
  );

  // Test 1.4: EMAIL_DISABLE_EXTERNAL = true
  resetEnv();
  process.env.EMAIL_DISABLE_EXTERNAL = 'true';
  assert(
    isOutboundCommsBlocked() === true,
    'Bloquea comunicaciones cuando EMAIL_DISABLE_EXTERNAL=true'
  );

  // Test 1.5: COMMS_DISABLE_EXTERNAL = true
  resetEnv();
  process.env.COMMS_DISABLE_EXTERNAL = 'true';
  assert(
    isOutboundCommsBlocked() === true,
    'Bloquea comunicaciones cuando COMMS_DISABLE_EXTERNAL=true'
  );

  // Test 1.6: FAIL-CLOSED en NODE_ENV=test
  resetEnv();
  (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
  assert(
    isOutboundCommsBlocked() === true,
    'FAIL-CLOSED: Bloquea automáticamente en NODE_ENV=test'
  );

  // Test 1.7: FAIL-CLOSED ante ausencia o nulidad de URL de Supabase
  resetEnv();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  assert(
    isOutboundCommsBlocked() === true,
    'FAIL-CLOSED: Bloquea automáticamente ante ausencia total de URL de Supabase'
  );
  assert(
    getOutboundCommsStatus().environment === 'inconsistent',
    'Reporta estado environment=inconsistent ante URL ausente'
  );

  resetEnv();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'undefined';
  assert(
    isOutboundCommsBlocked() === true,
    'FAIL-CLOSED: Bloquea automáticamente ante URL literal "undefined"'
  );

  // Test 1.8: FAIL-CLOSED en base de datos Integration (uqwuhjxzazsexuvqxmfm) sin flags explícitos
  resetEnv();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://uqwuhjxzazsexuvqxmfm.supabase.co';
  assert(
    isOutboundCommsBlocked() === true,
    'FAIL-CLOSED: Bloquea automáticamente al apuntar a Supabase Integration sin flag explícito'
  );
  assert(
    getOutboundCommsStatus().reason.includes('uqwuhjxzazsexuvqxmfm'),
    'Reporta detección de base de datos Integration uqwuhjxzazsexuvqxmfm'
  );

  // Test 1.9: Precedencia de bloqueo ante configuración inconsistente (URL de Producción + INTEGRATION_E2E=true)
  resetEnv();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://wfzbkcdmlcrjyrtauccu.supabase.co';
  process.env.INTEGRATION_E2E = 'true';
  assert(
    isOutboundCommsBlocked() === true,
    'Precedencia de seguridad: Si la URL es Producción pero INTEGRATION_E2E=true, prevalece el bloqueo absoluto'
  );

  // Test 1.10: FAIL-CLOSED en base de datos desconocida/staging/localhost
  resetEnv();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  assert(
    isOutboundCommsBlocked() === true,
    'FAIL-CLOSED: Bloquea automáticamente en base de datos localhost/no productiva'
  );

  // Test 1.11: Passthrough en Producción legítima (wfzbkcdmlcrjyrtauccu) sin flags de bloqueo
  resetEnv();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://wfzbkcdmlcrjyrtauccu.supabase.co';
  assert(
    isOutboundCommsBlocked() === false,
    'Permite comunicaciones salientes exclusivamente en Producción legítima wfzbkcdmlcrjyrtauccu sin flags'
  );
  assert(
    getOutboundCommsStatus().environment === 'production',
    'Identifica entorno production correctamente'
  );

  // ----------------------------------------------------------------
  // BLOQUE 2: Enmascaramiento y ausencia de fugas de PII
  // ----------------------------------------------------------------
  console.log('\n--- Bloque 2: Enmascaramiento de PII y Registro Seguro ---');

  const maskedEmail1 = maskRecipient('socio.activo@example.com');
  assert(
    maskedEmail1 === 's***o@example.com',
    `Enmascara email estándar: socio.activo@example.com -> ${maskedEmail1}`
  );

  const maskedEmail2 = maskRecipient('ab@aciacam.org');
  assert(
    maskedEmail2 === 'a***@aciacam.org',
    `Enmascara email corto: ab@aciacam.org -> ${maskedEmail2}`
  );

  const maskedPhone = maskRecipient('+54 9 11 5566 7788');
  assert(
    maskedPhone === '+54***788',
    `Enmascara teléfono: +54 9 11 5566 7788 -> ${maskedPhone}`
  );

  const emptyMask = maskRecipient('');
  assert(
    emptyMask === '***',
    `Enmascara entrada vacía: '' -> ${emptyMask}`
  );

  const simLog = logCommsSimulation({
    channel: 'email',
    recipient: 'german.dip@example.com',
    action: 'cierre_email_simulated',
    subjectOrType: 'Cierre Mensual'
  });
  assert(
    simLog.simulated === true && simLog.maskedRecipient.includes('***'),
    'logCommsSimulation retorna payload simulado con destinatario enmascarado'
  );
  assert(
    !JSON.stringify(simLog).includes('german.dip@example.com'),
    'Garantiza que el log no expone el email original en texto plano'
  );

  // ----------------------------------------------------------------
  // BLOQUE 3: EmailService en Modo Integration
  // ----------------------------------------------------------------
  console.log('\n--- Bloque 3: EmailService en Modo Integration ---');

  resetEnv();
  process.env.INTEGRATION_E2E = 'true';
  const emailResult = await EmailService.sendInviteEmail(
    'socio_test@example.com',
    'https://app.aciacam.org/activate?token=dummy',
    'Socio Test'
  );
  assert(
    emailResult.success === true && emailResult.simulated === true,
    'EmailService.sendInviteEmail retorna { success: true, simulated: true } en modo Integration'
  );
  assert(
    (emailResult as any).recipient.includes('***'),
    'EmailService.sendInviteEmail retorna destinatario enmascarado'
  );

  // ----------------------------------------------------------------
  // BLOQUE 4: Inspección Estática de Puntos Protegidos (Bypass Zero)
  // ----------------------------------------------------------------
  console.log('\n--- Bloque 4: Verificación Estática de Puntos Protegidos ---');

  const fs = await import('fs');
  const path = await import('path');

  // 4.1 Cierres Send-Email
  const cierresRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/api/admin/cierres/send-email/route.ts'),
    'utf8'
  );
  assert(
    cierresRoute.includes('isOutboundCommsBlocked()'),
    'app/api/admin/cierres/send-email/route.ts invoca isOutboundCommsBlocked()'
  );
  assert(
    cierresRoute.includes('cierre_email_simulated'),
    'app/api/admin/cierres/send-email/route.ts registra cierre_email_simulated'
  );

  // 4.2 Invite Single (generateLink)
  const inviteRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/api/admin/invite/route.ts'),
    'utf8'
  );
  assert(
    inviteRoute.includes('isOutboundCommsBlocked()'),
    'app/api/admin/invite/route.ts invoca isOutboundCommsBlocked()'
  );
  assert(
    inviteRoute.includes('generateLink({') && inviteRoute.includes('invite_user_simulated'),
    'app/api/admin/invite/route.ts utiliza generateLink (sin envío de correo) en modo Integration'
  );

  // 4.3 Invite Bulk (generateLink)
  const bulkRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/api/admin/invite/bulk/route.ts'),
    'utf8'
  );
  assert(
    bulkRoute.includes('isOutboundCommsBlocked()'),
    'app/api/admin/invite/bulk/route.ts invoca isOutboundCommsBlocked()'
  );
  assert(
    bulkRoute.includes('generateLink({') && bulkRoute.includes('bulk_invite_simulated'),
    'app/api/admin/invite/bulk/route.ts utiliza generateLink (sin envío de correo) en modo Integration'
  );

  // 4.4 WhatsApp Webhook
  const waRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/api/whatsapp/webhook/route.ts'),
    'utf8'
  );
  assert(
    waRoute.includes('isOutboundCommsBlocked()'),
    'app/api/whatsapp/webhook/route.ts invoca isOutboundCommsBlocked()'
  );
  assert(
    waRoute.includes('whatsapp_message_simulated'),
    'app/api/whatsapp/webhook/route.ts intercepta enviarMensaje con simulación sin llamada a Meta'
  );

  // 4.5 Recuperación de Contraseña en Cliente (forgot-password/page.tsx)
  const forgotPasswordSource = fs.readFileSync(
    path.join(process.cwd(), 'app/(auth)/forgot-password/page.tsx'),
    'utf8'
  );
  assert(
    forgotPasswordSource.includes('isOutboundCommsBlocked()'),
    'app/(auth)/forgot-password/page.tsx importa e invoca isOutboundCommsBlocked()'
  );
  assert(
    forgotPasswordSource.includes('password_reset_simulated'),
    'app/(auth)/forgot-password/page.tsx intercepta resetPasswordForEmail con simulación segura'
  );

  // ----------------------------------------------------------------
  // BLOQUE 5: Restricción de Destinatarios de Prueba (RFC 2606)
  // ----------------------------------------------------------------
  console.log('\n--- Bloque 5: Restricción Estricta de Destinatarios de Prueba ---');

  assert(
    isSafeTestEmail('socio.test@example.com') === true,
    'Permite dominio RFC 2606 seguro: example.com'
  );
  assert(
    isSafeTestEmail('admin.audit@test.invalid') === true,
    'Permite dominio RFC 2606 seguro: test.invalid'
  );
  assert(
    isSafeTestEmail('socio.real@gmail.com') === false,
    'Rechaza dominio real de terceros: gmail.com'
  );
  assert(
    isSafeTestEmail('operador@aciacam.org') === false,
    'Rechaza dominio real de la institución en pruebas: aciacam.org'
  );

  // ----------------------------------------------------------------
  // Resumen final
  // ----------------------------------------------------------------
  resetEnv();
  console.log('\n================================================================');
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`📊 Resumen de Resultados: ${passed}/${total} pruebas superadas (${failed} fallidas)`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Error fatal en ejecución de pruebas:', err);
  process.exit(1);
});
