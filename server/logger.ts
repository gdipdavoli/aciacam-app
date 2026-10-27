/**
 * server/logger.ts
 *
 * ACIACAM — Sprint 7B.8 (Prioridad 4A)
 * Logger Estructurado JSON para Agent Core en Railway
 *
 * Directivas de Seguridad:
 * 1. Formato JSON por línea para ingesta estándar (Railway, Datadog, Better Stack).
 * 2. Sanitización estricta: redacta automáticamente secretos, JWTs y contraseñas.
 * 3. Inclusión obligatoria de correlation_id en todas las entradas de log.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogContext {
  correlationId?: string;
  socioId?: string;
  actorType?: 'agente' | 'socio' | 'staff' | 'system';
  action?: string;
  path?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  [key: string]: any;
}

const REDACTED_KEYS = new Set([
  'password',
  'secret',
  'token',
  'key',
  'authorization',
  'x-agent-core-secret',
  'agent_core_bff_secret',
  'supabase_service_role_key',
  'integration_db_password',
  'cookie'
]);

function sanitizeValue(key: string, val: any): any {
  if (val == null) return val;
  const lowerKey = key.toLowerCase();
  for (const rk of REDACTED_KEYS) {
    if (lowerKey.includes(rk)) {
      return '[REDACTED]';
    }
  }
  if (typeof val === 'object') {
    if (Array.isArray(val)) {
      return val.map((v, i) => sanitizeValue(String(i), v));
    }
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      clean[k] = sanitizeValue(k, v);
    }
    return clean;
  }
  return val;
}

export class StructuredLogger {
  private serviceName: string;
  private environment: string;

  constructor(serviceName: string = 'agent-core', environment: string = process.env.NODE_ENV || 'development') {
    this.serviceName = serviceName;
    this.environment = environment;
  }

  private emit(level: LogLevel, message: string, context?: LogContext, error?: Error) {
    const entry: Record<string, any> = {
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      env: this.environment,
      level,
      message,
      correlation_id: context?.correlationId || 'none'
    };

    if (context) {
      for (const [k, v] of Object.entries(context)) {
        if (k !== 'correlationId') {
          entry[k] = sanitizeValue(k, v);
        }
      }
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        code: (error as any).code,
        // En producción no se vuelca la traza completa de archivos internos
        stack: this.environment === 'production' ? undefined : error.stack
      };
    }

    const jsonLine = JSON.stringify(entry);
    if (level === 'ERROR') {
      console.error(jsonLine);
    } else if (level === 'WARN') {
      console.warn(jsonLine);
    } else {
      console.log(jsonLine);
    }
  }

  public debug(message: string, context?: LogContext) {
    this.emit('DEBUG', message, context);
  }

  public info(message: string, context?: LogContext) {
    this.emit('INFO', message, context);
  }

  public warn(message: string, context?: LogContext, error?: Error) {
    this.emit('WARN', message, context, error);
  }

  public error(message: string, context?: LogContext, error?: Error) {
    this.emit('ERROR', message, context, error);
  }
}

export const logger = new StructuredLogger('agent-core', process.env.AGENT_CORE_ENV || 'integration');
