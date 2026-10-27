/**
 * server/agent-core-service.ts
 *
 * ACIACAM — Sprint 7B.8 (Prioridad 4A)
 * Servicio HTTP Autónomo de Agent Core para Railway
 *
 * Directivas de Arquitectura y Seguridad:
 * 1. Runtime: Node.js (>=18) sobre contenedor Railway.
 * 2. Cero dependencias web externas pesadas: implementado sobre node:http nativo.
 * 3. Endpoints Canónicos:
 *    - GET /health  -> Liveness probe (200 OK, sin secretos).
 *    - GET /ready   -> Readiness probe (200 OK o 503, chequeo de backend y env guards).
 *    - POST /api/v1/chat/message -> Endpoint S2S institucional para BFF Vercel.
 * 4. Autenticación S2S en tiempo constante mediante timingSafeEqual contra AGENT_CORE_BFF_SECRET.
 * 5. Trazabilidad de Correlation ID (X-Correlation-ID) en logs y respuestas.
 * 6. Mínimo Privilegio: El worker solo puede generar propuestas en pending_review vía PedidosTool;
 *    carece de endpoints o código para aprobar grants o ejecutar pedidos.
 * 7. Barrera Anti-Producción: Rechazo terminante si detecta wfzbkcdmlcrjyrtauccu en ambiente de Integration.
 */

import * as http from 'node:http';
import * as net from 'node:net';
import * as crypto from 'node:crypto';
import * as url from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger, StructuredLogger } from './logger';
import { PedidosTool } from '../app/lib/agent/pedidos-tool';
import { IBackendOrderAdapter, S2SBackendOrderAdapter, MockBackendOrderAdapter } from '../app/lib/agent/backend-adapter';
import { IOperatorVerifier, MockOperatorVerifier } from '../app/lib/agent/operator-verifier';

export interface AgentCoreServiceConfig {
  port?: number;
  environment?: 'integration' | 'production' | 'test';
  bffBaseUrl?: string;
  bffSecret?: string;
  adminSecret?: string;
  supabaseUrl?: string;
  maxConcurrency?: number;
  requestTimeoutMs?: number;
  killSwitchActive?: boolean;
  forceKillswitchEnvActive?: boolean;
  proposalsEnabled?: boolean;
  killswitchPersistencePath?: string;
  adapterOverride?: IBackendOrderAdapter;
}

export class AgentCoreServer {
  private server: http.Server | null = null;
  private config: Required<Omit<AgentCoreServiceConfig, 'adapterOverride' | 'killSwitchActive' | 'forceKillswitchEnvActive' | 'proposalsEnabled' | 'killswitchPersistencePath'>> & {
    adapterOverride?: IBackendOrderAdapter;
    killSwitchActive?: boolean;
    forceKillswitchEnvActive?: boolean;
    proposalsEnabled?: boolean;
    killswitchPersistencePath?: string;
  };
  private startTime: number = Date.now();
  private inFlightRequests: number = 0;
  private isDraining: boolean = false;
  private isKillSwitchActive: boolean = false;
  private isKillSwitchLockedByEnv: boolean = false;
  private killswitchReason: string = '';
  private isProposalsEnabled: boolean = false;
  private proposalsReason: string = 'Inactivo por diseño tras el arranque (Fail-Safe Closed)';
  private killswitchPersistencePath: string;
  private openSockets: Set<net.Socket> = new Set();
  private backendAdapter: IBackendOrderAdapter;
  private pedidosTool: PedidosTool;
  private log: StructuredLogger;

  constructor(config?: AgentCoreServiceConfig) {
    const env = (config?.environment || process.env.AGENT_CORE_ENV || 'integration') as 'integration' | 'production' | 'test';
    const bffUrl = config?.bffBaseUrl || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const bffSecret = config?.bffSecret || process.env.AGENT_CORE_BFF_SECRET || process.env.AGENT_ORDER_CALLBACK_SECRET || '';
    const adminSecret = config?.adminSecret || process.env.AGENT_CORE_ADMIN_SECRET || bffSecret;
    const supabaseUrl = config?.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const port = config?.port !== undefined ? config.port : parseInt(process.env.PORT || '8000', 10);
    const maxConcurrency = config?.maxConcurrency || 50;
    const requestTimeoutMs = config?.requestTimeoutMs || 15000;

    this.killswitchPersistencePath = config?.killswitchPersistencePath ||
      process.env.AGENT_CORE_KILLSWITCH_PATH ||
      path.resolve(process.cwd(), 'data', 'killswitch_state.json');

    this.config = {
      port,
      environment: env,
      bffBaseUrl: bffUrl,
      bffSecret,
      adminSecret,
      supabaseUrl,
      maxConcurrency,
      requestTimeoutMs,
      adapterOverride: config?.adapterOverride
    };

    this.log = new StructuredLogger('agent-core', this.config.environment);

    // Barrera de entorno inicial
    this.assertEnvironmentSafety();

    // Requisito 4: Precedencia absoluta de variable de entorno inmutable
    const envKillswitch = config?.forceKillswitchEnvActive || process.env.AGENT_CORE_KILLSWITCH_ACTIVE === 'true';
    if (envKillswitch) {
      this.isKillSwitchActive = true;
      this.isKillSwitchLockedByEnv = true;
      this.killswitchReason = 'Suspensión forzada por variable de entorno inmutable (AGENT_CORE_KILLSWITCH_ACTIVE=true)';
      this.log.warn('Kill-switch bloqueado por variable de entorno; ningún endpoint administrativo puede anularlo', {
        action: 'env_killswitch_lock'
      });
    } else {
      // Requisito 1: Carga de caché local efímera (best-effort, no garantiza almacenamiento distribuido)
      this.loadKillSwitchState();
      if (config?.killSwitchActive) {
        this.isKillSwitchActive = true;
        this.killswitchReason = 'Configurado activo en arranque';
      }
    }

    // Requisito 3: Arranque Seguro (Fail-Safe Closed by default)
    // Las operaciones que crean propuestas permanecen deshabilitadas por defecto hasta habilitación explícita
    if (config?.proposalsEnabled ?? (process.env.AGENT_CORE_PROPOSALS_ENABLED === 'true')) {
      this.isProposalsEnabled = true;
      this.proposalsReason = 'Habilitado explícitamente en configuración de arranque';
      this.log.info('Admisión de propuestas habilitada explícitamente en arranque', { action: 'proposals_enabled' });
    } else {
      this.isProposalsEnabled = false;
      this.proposalsReason = 'Inactivo por diseño tras el arranque (Fail-Safe Closed)';
      this.log.info('Admisión de propuestas DESHABILITADA por defecto tras el arranque (Fail-Safe Closed)', {
        action: 'proposals_safe_boot_disabled'
      });
    }

    // Configuración del adaptador del backend
    if (this.config.adapterOverride) {
      this.backendAdapter = this.config.adapterOverride;
    } else if (this.config.environment === 'test') {
      this.backendAdapter = new MockBackendOrderAdapter();
    } else {
      this.backendAdapter = new S2SBackendOrderAdapter(this.config.bffBaseUrl, this.config.bffSecret);
    }

    // PedidosTool configurado con executionEnabled = false (prohibición de ejecución autónoma)
    this.pedidosTool = new PedidosTool(
      { executionEnabled: false },
      this.backendAdapter,
      new MockOperatorVerifier()
    );
  }

  /**
   * Carga de caché local efímera de Kill-Switch (best-effort, no reemplaza almacenamiento distribuido)
   */
  private loadKillSwitchState(): void {
    try {
      if (fs.existsSync(this.killswitchPersistencePath)) {
        const raw = fs.readFileSync(this.killswitchPersistencePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.active === 'boolean') {
          this.isKillSwitchActive = parsed.active;
          this.killswitchReason = parsed.reason || 'Restaurado desde caché local efímera';
          this.log.info('Estado de kill-switch cargado desde caché local efímera', {
            active: this.isKillSwitchActive,
            reason: this.killswitchReason,
            path: this.killswitchPersistencePath
          });
        }
      }
    } catch (err: any) {
      this.log.warn('No se pudo leer caché local de kill-switch', { error: err.message });
    }
  }

  /**
   * Palanca administrativa para activar/desactivar kill-switch
   */
  public setKillSwitch(active: boolean, reason: string = ''): void {
    if (this.isKillSwitchLockedByEnv && !active) {
      const msg = 'KILLSWITCH_LOCKED_BY_ENVIRONMENT: No se puede desactivar la suspensión fijada por AGENT_CORE_KILLSWITCH_ACTIVE=true en el entorno.';
      this.log.error(msg, { action: 'set_killswitch_denied' });
      throw new Error(msg);
    }

    this.isKillSwitchActive = active;
    this.killswitchReason = reason;
    this.log.warn(`Kill-switch de emergencia ${active ? 'ACTIVADO' : 'DESACTIVADO'}`, {
      action: 'set_killswitch',
      reason
    });

    try {
      const dir = path.dirname(this.killswitchPersistencePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.killswitchPersistencePath, JSON.stringify({
        active,
        reason,
        updated_at: new Date().toISOString()
      }, null, 2), 'utf8');
    } catch (err: any) {
      this.log.warn('No se pudo escribir en caché local de kill-switch (almacenamiento efímero)', { error: err.message });
    }
  }

  /**
   * Habilitación explícita o suspensión de la admisión de propuestas de pedidos
   */
  public setProposalsEnabled(enabled: boolean, reason: string = ''): void {
    if (enabled && this.isKillSwitchLockedByEnv) {
      const msg = 'KILLSWITCH_LOCKED_BY_ENVIRONMENT: Imposible habilitar propuestas mientras el kill-switch esté bloqueado por variable de entorno.';
      this.log.error(msg, { action: 'set_proposals_denied' });
      throw new Error(msg);
    }
    if (enabled && this.isKillSwitchActive) {
      const msg = 'KILLSWITCH_ACTIVE: Imposible habilitar propuestas mientras el kill-switch general permanezca activo.';
      this.log.error(msg, { action: 'set_proposals_denied' });
      throw new Error(msg);
    }
    this.isProposalsEnabled = enabled;
    this.proposalsReason = reason;
    this.log.info(`Admisión de propuestas ${enabled ? 'HABILITADA' : 'DESHABILITADA'}`, {
      action: 'set_proposals_enabled',
      reason
    });
  }

  public getIsProposalsEnabled(): boolean {
    return this.isProposalsEnabled;
  }

  public getIsKillSwitchLocked(): boolean {
    return this.isKillSwitchLockedByEnv;
  }

  public getInFlightCount(): number {
    return this.inFlightRequests;
  }

  public getIsDraining(): boolean {
    return this.isDraining;
  }

  /**
   * Barrera estricta que previene fugas de configuración entre ambientes
   */
  public assertEnvironmentSafety(): void {
    const FORBIDDEN_PROD_REF = 'wfzbkcdmlcrjyrtauccu';
    if (this.config.environment === 'integration' || this.config.environment === 'test') {
      const dump = JSON.stringify(this.config);
      if (dump.includes(FORBIDDEN_PROD_REF)) {
        const msg = `🚨 FATAL SECURITY ABORT: Detectada referencia a Producción (${FORBIDDEN_PROD_REF}) en entorno de ${this.config.environment}.`;
        this.log.error(msg, { action: 'environment_guard' });
        throw new Error(msg);
      }
    }
  }

  /**
   * Validador de secreto en tiempo constante
   */
  public verifySecret(providedHeader: string | undefined, expectedSecret: string): boolean {
    if (!expectedSecret || expectedSecret.length < 16) return false;
    if (!providedHeader) return false;

    let cleanProvided = providedHeader.trim();
    if (cleanProvided.toLowerCase().startsWith('bearer ')) {
      cleanProvided = cleanProvided.slice(7).trim();
    }

    const providedBuf = Buffer.from(cleanProvided);
    const expectedBuf = Buffer.from(expectedSecret);

    if (providedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  }

  private verifyS2SSecret(providedHeader: string | undefined): boolean {
    return this.verifySecret(providedHeader, this.config.bffSecret);
  }

  private verifyAdminSecret(providedHeader: string | undefined): boolean {
    return this.verifySecret(providedHeader, this.config.adminSecret);
  }

  /**
   * Enrutador HTTP principal
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const start = Date.now();
    const parsedUrl = url.parse(req.url || '/', true);
    const pathname = parsedUrl.pathname || '/';
    const method = req.method?.toUpperCase() || 'GET';

    // Correlation ID institucional
    const correlationId = (req.headers['x-correlation-id'] as string) || `req_${crypto.randomUUID()}`;
    res.setHeader('X-Correlation-ID', correlationId);
    res.setHeader('Content-Type', 'application/json');

    // 0. Comprobación de estado de drenaje ordenado (Graceful Draining)
    if (this.isDraining) {
      if (pathname === '/health') {
        res.writeHead(503);
        res.end(JSON.stringify({ status: 'draining', service: 'agent-core', message: 'Servidor en proceso de apagado' }));
        return;
      }
      res.writeHead(503, { 'Retry-After': '10' });
      res.end(JSON.stringify({
        error: 'SERVER_DRAINING',
        code: 'DRAINING',
        message: 'El servidor está completando solicitudes pendientes y rechazando nuevas peticiones.',
        correlation_id: correlationId
      }));
      return;
    }

    // Control de límite de concurrencia
    if (this.inFlightRequests >= this.config.maxConcurrency) {
      this.log.warn('Límite de concurrencia alcanzado', { correlationId, inFlight: this.inFlightRequests });
      res.writeHead(429, { 'Retry-After': '5' });
      res.end(JSON.stringify({ error: 'TOO_MANY_REQUESTS', correlation_id: correlationId }));
      return;
    }

    this.inFlightRequests++;

    try {
      // -----------------------------------------------------------------------
      // 1. ENDPOINT: GET /health (Liveness Probe de Railway)
      // -----------------------------------------------------------------------
      if (method === 'GET' && pathname === '/health') {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        res.writeHead(200);
        res.end(JSON.stringify({
          status: 'healthy',
          service: 'agent-core',
          version: '1.0.0',
          uptime_seconds: uptime,
          in_flight_requests: this.inFlightRequests,
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // -----------------------------------------------------------------------
      // 2. ENDPOINT: GET /ready (Readiness Probe de Railway)
      // -----------------------------------------------------------------------
      if (method === 'GET' && pathname === '/ready') {
        const s2sConfigured = Boolean(this.config.bffSecret && this.config.bffSecret.length >= 16);
        let envGuardOk = true;
        try {
          this.assertEnvironmentSafety();
        } catch {
          envGuardOk = false;
        }

        const isReady = s2sConfigured && envGuardOk && !this.isKillSwitchActive && !this.isDraining;
        res.writeHead(isReady ? 200 : 503);
        res.end(JSON.stringify({
          status: isReady ? 'ready' : 'not_ready',
          checks: {
            s2s_auth: s2sConfigured ? 'ok' : 'unconfigured_secret',
            env_guard: envGuardOk ? 'ok' : 'violation',
            killswitch: this.isKillSwitchActive ? 'active' : 'inactive',
            killswitch_locked_by_env: this.isKillSwitchLockedByEnv,
            proposals_admission: this.isProposalsEnabled ? 'enabled' : 'disabled_by_default',
            draining: this.isDraining ? 'active' : 'inactive'
          },
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // -----------------------------------------------------------------------
      // 3. ENDPOINT: POST /api/v1/admin/killswitch (Control Rápido de Emergencia)
      // -----------------------------------------------------------------------
      if (method === 'POST' && pathname === '/api/v1/admin/killswitch') {
        const authHeader = (req.headers['x-agent-core-secret'] || req.headers['authorization']) as string | undefined;

        // Si el cliente intenta usar el secreto conversacional del BFF para una acción administrativa
        if (this.verifyS2SSecret(authHeader) && this.config.adminSecret !== this.config.bffSecret) {
          this.log.warn('Intento de modificar killswitch con credencial conversacional BFF (rechazo por mínimo privilegio)', { correlationId });
          res.writeHead(403);
          res.end(JSON.stringify({
            error: 'FORBIDDEN_ADMIN_CREDENTIAL_REQUIRED',
            message: 'El secreto conversacional BFF no posee privilegios administrativos para modificar el killswitch.',
            correlation_id: correlationId
          }));
          return;
        }

        if (!this.verifyAdminSecret(authHeader)) {
          this.log.warn('Rechazo no autorizado en endpoint killswitch', { correlationId });
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'ADMIN_UNAUTHORIZED', correlation_id: correlationId }));
          return;
        }

        const bodyStr = await this.readBody(req, 16384);
        let body: any = {};
        try {
          body = JSON.parse(bodyStr);
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'INVALID_JSON', correlation_id: correlationId }));
          return;
        }

        // Requisito 4: Si la suspensión está fijada por AGENT_CORE_KILLSWITCH_ACTIVE=true, no puede anularse por API
        if (this.isKillSwitchLockedByEnv && !body.active) {
          this.log.error('Intento denegado de anular killswitch fijado por variable de entorno', { correlationId });
          res.writeHead(423);
          res.end(JSON.stringify({
            error: 'KILLSWITCH_LOCKED_BY_ENVIRONMENT',
            code: 'IMMUTABLE_SUSPENSION_OVERRIDE',
            message: 'La suspensión del servicio está fijada por AGENT_CORE_KILLSWITCH_ACTIVE=true en el entorno. Ningún comando administrativo puede anularla mientras la variable persista.',
            correlation_id: correlationId
          }));
          return;
        }

        try {
          this.setKillSwitch(Boolean(body.active), body.reason || 'Acción administrativa manual');
        } catch (err: any) {
          res.writeHead(409);
          res.end(JSON.stringify({ error: 'KILLSWITCH_CONFLICT', message: err.message, correlation_id: correlationId }));
          return;
        }

        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          killswitch_active: this.isKillSwitchActive,
          locked_by_env: this.isKillSwitchLockedByEnv,
          reason: this.killswitchReason,
          correlation_id: correlationId
        }));
        return;
      }

      // -----------------------------------------------------------------------
      // 3B. ENDPOINT: POST /api/v1/admin/proposals (Habilitación Explícita de Propuestas)
      // -----------------------------------------------------------------------
      if (method === 'POST' && pathname === '/api/v1/admin/proposals') {
        const authHeader = (req.headers['x-agent-core-secret'] || req.headers['authorization']) as string | undefined;

        if (this.verifyS2SSecret(authHeader) && this.config.adminSecret !== this.config.bffSecret) {
          res.writeHead(403);
          res.end(JSON.stringify({
            error: 'FORBIDDEN_ADMIN_CREDENTIAL_REQUIRED',
            message: 'Se requiere credencial administrativa para habilitar o suspender la admisión de propuestas.',
            correlation_id: correlationId
          }));
          return;
        }

        if (!this.verifyAdminSecret(authHeader)) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'ADMIN_UNAUTHORIZED', correlation_id: correlationId }));
          return;
        }

        const bodyStr = await this.readBody(req, 16384);
        let body: any = {};
        try {
          body = JSON.parse(bodyStr);
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'INVALID_JSON', correlation_id: correlationId }));
          return;
        }

        if (body.enabled && this.isKillSwitchLockedByEnv) {
          this.log.error('Intento denegado de habilitar propuestas bajo suspensión fijada por variable de entorno', { correlationId });
          res.writeHead(423);
          res.end(JSON.stringify({
            error: 'KILLSWITCH_LOCKED_BY_ENVIRONMENT',
            code: 'IMMUTABLE_SUSPENSION_ACTIVE',
            message: 'No se puede habilitar la admisión de propuestas mientras el kill-switch esté fijado por AGENT_CORE_KILLSWITCH_ACTIVE=true.',
            correlation_id: correlationId
          }));
          return;
        }

        if (body.enabled && this.isKillSwitchActive) {
          this.log.warn('Intento denegado de habilitar propuestas con kill-switch activo', { correlationId });
          res.writeHead(409);
          res.end(JSON.stringify({
            error: 'KILLSWITCH_ACTIVE',
            code: 'SUSPENSION_ACTIVE',
            message: 'No se puede habilitar la admisión de propuestas mientras el kill-switch general permanezca activo.',
            correlation_id: correlationId
          }));
          return;
        }

        try {
          this.setProposalsEnabled(Boolean(body.enabled), body.reason || 'Modificación administrativa');
        } catch (err: any) {
          res.writeHead(409);
          res.end(JSON.stringify({ error: 'PROPOSALS_CONFIG_ERROR', message: err.message, correlation_id: correlationId }));
          return;
        }

        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          proposals_enabled: this.isProposalsEnabled,
          reason: this.proposalsReason,
          correlation_id: correlationId
        }));
        return;
      }

      // -----------------------------------------------------------------------
      // 3. ENDPOINT: POST /api/v1/chat/message (Canal S2S de Chat e Intenciones)
      // -----------------------------------------------------------------------
      if (method === 'POST' && pathname === '/api/v1/chat/message') {
        // Validación de autenticación S2S
        const authHeader = (req.headers['x-agent-core-secret'] || req.headers['authorization']) as string | undefined;
        if (!this.verifyS2SSecret(authHeader)) {
          this.log.warn('Rechazo de autenticación S2S', { correlationId, path: pathname });
          res.writeHead(401);
          res.end(JSON.stringify({
            error: 'S2S_UNAUTHORIZED',
            code: 'UNAUTHORIZED_SECRET',
            correlation_id: correlationId
          }));
          return;
        }

        // Lectura del cuerpo de la solicitud con límite de tamaño (64KB)
        const bodyStr = await this.readBody(req, 65536);
        let body: any = {};
        try {
          body = JSON.parse(bodyStr);
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'INVALID_JSON', correlation_id: correlationId }));
          return;
        }

        // Extracción y validación rigurosa de contexto de identidad delegada
        const rawAuthUserId = req.headers['x-delegated-auth-user-id'];
        const rawSocioId = req.headers['x-delegated-socio-id'];
        const rawUserRole = req.headers['x-delegated-user-role'];

        const delegatedAuthUserId = typeof rawAuthUserId === 'string' ? rawAuthUserId.trim() : undefined;
        const delegatedSocioId = typeof rawSocioId === 'string' ? rawSocioId.trim() : undefined;
        const delegatedUserRole = typeof rawUserRole === 'string' ? rawUserRole.trim().toLowerCase() : undefined;

        // Comprobación de que la identidad delegada procede de sesión validada por el BFF
        if (!delegatedAuthUserId || !delegatedSocioId || !delegatedUserRole) {
          this.log.warn('Rechazo por contexto de delegación incompleto o ausente', {
            correlationId,
            hasAuthUserId: Boolean(delegatedAuthUserId),
            hasSocioId: Boolean(delegatedSocioId),
            hasUserRole: Boolean(delegatedUserRole)
          });
          res.writeHead(403);
          res.end(JSON.stringify({
            error: 'FORBIDDEN_INCOMPLETE_DELEGATED_CONTEXT',
            message: 'El contexto de identidad delegada es incompleto. Se requieren X-Delegated-Auth-User-Id, X-Delegated-Socio-Id y X-Delegated-User-Role.',
            correlation_id: correlationId
          }));
          return;
        }

        // Validación de formato UUID v4 canónico para identidades delegadas
        const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!UUID_REGEX.test(delegatedAuthUserId) || !UUID_REGEX.test(delegatedSocioId)) {
          this.log.warn('Rechazo por identificador UUID delegado inválido o malformado', {
            correlationId,
            delegatedAuthUserId,
            delegatedSocioId
          });
          res.writeHead(400);
          res.end(JSON.stringify({
            error: 'INVALID_DELEGATED_UUID',
            message: 'Los encabezados X-Delegated-Auth-User-Id y X-Delegated-Socio-Id deben ser UUIDs válidos.',
            correlation_id: correlationId
          }));
          return;
        }

        // Validación de roles permitidos del BFF
        const ALLOWED_ROLES = ['admin', 'staff', 'socio'];
        if (!ALLOWED_ROLES.includes(delegatedUserRole)) {
          this.log.warn('Rechazo por rol de usuario delegado no habilitado', { correlationId, role: delegatedUserRole });
          res.writeHead(403);
          res.end(JSON.stringify({
            error: 'FORBIDDEN_INVALID_DELEGATED_ROLE',
            message: `El rol '${delegatedUserRole}' no posee autorización para interactuar con Agent Core.`,
            correlation_id: correlationId
          }));
          return;
        }

        // Anti-Spoofing: Si viene socio_id en el payload, DEBE coincidir inequívocamente con X-Delegated-Socio-Id
        if (body.socio_id && body.socio_id !== delegatedSocioId) {
          this.log.warn('Intento de suplantación de identidad detectado (discrepancia header/body)', {
            correlationId,
            headerSocioId: delegatedSocioId,
            bodySocioId: body.socio_id
          });
          res.writeHead(403);
          res.end(JSON.stringify({
            error: 'FORBIDDEN_IDENTITY_SPOOFING',
            code: 'DELEGATED_IDENTITY_MISMATCH',
            message: 'Discrepancia de identidad: el socio_id del cuerpo no coincide con el encabezado de delegación institucional.',
            correlation_id: correlationId
          }));
          return;
        }

        const normalizedActorType: 'staff' | 'socio' = (delegatedUserRole === 'admin' || delegatedUserRole === 'staff') ? 'staff' : 'socio';

        this.log.info('Procesando solicitud de chat S2S', {
          correlationId,
          socioId: delegatedSocioId,
          actorType: normalizedActorType,
          action: body.intent || 'chat_message'
        });

        // 3.1 Si la solicitud contiene intención de formular propuesta de pedido
        if (body.intent === 'propose_order' || (body.items && Array.isArray(body.items) && body.items.length > 0)) {
          // Bloqueo 1: Kill-Switch general de emergencia
          if (this.isKillSwitchActive) {
            this.log.warn('Intento de propuesta bloqueado por kill-switch activo', { correlationId });
            res.writeHead(503, { 'Retry-After': '60' });
            res.end(JSON.stringify({
              error: 'SERVICE_SUSPENDED',
              code: 'KILLSWITCH_ACTIVE',
              message: 'Mecanismo de seguridad activado: la formulación de nuevas propuestas está suspendida temporalmente.',
              reason: this.killswitchReason,
              locked_by_env: this.isKillSwitchLockedByEnv,
              correlation_id: correlationId
            }));
            return;
          }

          // Bloqueo 2: Arranque Seguro (Fail-Safe Closed)
          // Las propuestas permanecen deshabilitadas tras el arranque hasta habilitación explícita
          if (!this.isProposalsEnabled) {
            this.log.warn('Intento de propuesta bloqueado: servicio en arranque seguro sin habilitación explícita', { correlationId });
            res.writeHead(503, { 'Retry-After': '30' });
            res.end(JSON.stringify({
              error: 'PROPOSALS_DISABLED_AT_BOOT',
              code: 'PROPOSALS_NOT_ENABLED',
              message: 'La formulación de propuestas de pedido se encuentra inactiva por diseño tras el arranque del servicio (Fail-Safe Closed). Requiere habilitación explícita administrativa.',
              reason: this.proposalsReason,
              correlation_id: correlationId
            }));
            return;
          }

          const socioId = delegatedSocioId;

          const proposalResult = await this.pedidosTool.proposeOrder({
            socio_id: socioId,
            items: body.items,
            tipo_pedido: body.tipo_pedido || 'retiro_sede',
            motivo: body.motivo || `Propuesta formulada por Agent Core para socio ${socioId.slice(0, 8)}`,
            direccion_entrega: body.details?.direccion_entrega || body.direccion_entrega,
            localidad: body.details?.localidad || body.localidad,
            fecha_retiro: body.details?.fecha_retiro || body.fecha_retiro,
            franja_horaria: body.details?.franja_horaria || body.franja_horaria,
            slot_id: body.details?.slot_id || body.slot_id,
            observaciones: body.details?.observaciones || body.observaciones
          });

          this.log.info('Propuesta estructurada formulada por Agent Core', {
            correlationId,
            socioId,
            proposalId: proposalResult.proposal_id,
            payloadHash: proposalResult.proposal_payload_hash
          });

          res.writeHead(200);
          res.end(JSON.stringify({
            success: true,
            reply: `He generado la propuesta de pedido #${proposalResult.proposal_id.slice(0, 8)}. Quedará pendiente de aprobación humana formal por el equipo de administración en /admin/aprobaciones.`,
            proposal: proposalResult,
            correlation_id: correlationId
          }));
          return;
        }

        // 3.2 Diálogo conversacional general (consulta o confirmación de token)
        const incomingMsg = body.message || '';
        let reply = 'Hola. Soy el asistente institucional de ACIACAM. ¿En qué puedo ayudarte hoy?';
        if (incomingMsg.toLowerCase().includes('stock') || incomingMsg.toLowerCase().includes('catalogo')) {
          reply = 'Podés consultar los productos disponibles y realizar pedidos terapéuticos desde la sección de Dispensario.';
        } else if (body.confirmation_token) {
          reply = `Token de confirmación recibido (${body.confirmation_token.slice(0, 6)}...). Procesando validación administrativa.`;
        }

        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          reply,
          correlation_id: correlationId
        }));
        return;
      }

      // -----------------------------------------------------------------------
      // 4. SEGURIDAD: Denegación de operaciones de aprobación o ejecución
      // -----------------------------------------------------------------------
      if (pathname.includes('/approve') || pathname.includes('/execute') || pathname.includes('/grants')) {
        this.log.warn('Intento no autorizado de invocar operación restringida en Agent Core', {
          correlationId,
          path: pathname
        });
        res.writeHead(403);
        res.end(JSON.stringify({
          error: 'FORBIDDEN_AGENT_OPERATION',
          detail: 'Agent Core no tiene autorización para emitir grants ni ejecutar pedidos.',
          correlation_id: correlationId
        }));
        return;
      }

      // Endpoint no encontrado
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'NOT_FOUND', path: pathname, correlation_id: correlationId }));

    } catch (err: any) {
      this.log.error('Error no controlado al procesar solicitud', { correlationId, path: pathname }, err);
      res.writeHead(500);
      res.end(JSON.stringify({
        error: 'INTERNAL_SERVER_ERROR',
        message: err.message || 'Error interno',
        correlation_id: correlationId
      }));
    } finally {
      this.inFlightRequests--;
      const duration = Date.now() - start;
      this.log.debug('Petición completada', {
        correlationId,
        method,
        path: pathname,
        durationMs: duration
      });
    }
  }

  private readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      let bytes = 0;
      req.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          reject(new Error('PAYLOAD_TOO_LARGE'));
          req.destroy();
          return;
        }
        data += chunk;
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  /**
   * Inicialización del servidor HTTP
   */
  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // Timeout de seguridad en conexión
        req.setTimeout(this.config.requestTimeoutMs, () => {
          this.log.warn('Timeout de conexión en solicitud HTTP', { url: req.url });
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'GATEWAY_TIMEOUT' }));
          req.destroy();
        });

        this.handleRequest(req, res).catch(err => {
          this.log.error('Falla no capturada en handleRequest', {}, err);
        });
      });

      // Registro de sockets para graceful drain y gestión de keep-alive
      this.server.on('connection', (socket: net.Socket) => {
        this.openSockets.add(socket);
        socket.on('close', () => {
          this.openSockets.delete(socket);
        });
      });

      this.server.on('error', reject);

      this.server.listen(this.config.port, '0.0.0.0', () => {
        const addr = this.server?.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.config.port;
        this.log.info(`Agent Core Server escuchando en puerto ${actualPort}`, {
          port: actualPort,
          env: this.config.environment
        });
        resolve(actualPort);
      });
    });
  }

  /**
   * Cierre ordenado y graceful shutdown con drenaje real de solicitudes activas.
   * NO utiliza closeAllConnections() de forma abrupta antes de que terminen los requests.
   */
  public async stop(drainTimeoutMs: number = 5000): Promise<void> {
    if (!this.server) return;

    this.isDraining = true;
    this.log.info('Iniciando Graceful Shutdown con drenaje real de solicitudes activas...', {
      inFlightRequests: this.inFlightRequests,
      openSockets: this.openSockets.size
    });

    // 1. Dejar de escuchar en el puerto para rechazar nuevas conexiones entrantes en el OS
    const serverClosePromise = new Promise<void>((resolve, reject) => {
      this.server?.close(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 2. Esperar drenaje activo de solicitudes en curso (hasta drainTimeoutMs)
    const drainStart = Date.now();
    while (this.inFlightRequests > 0 && (Date.now() - drainStart) < drainTimeoutMs) {
      await new Promise(r => setTimeout(r, 25));
    }

    if (this.inFlightRequests > 0) {
      this.log.warn('Timeout de drenaje alcanzado con solicitudes activas; forzando cierre de sockets', {
        remainingInFlight: this.inFlightRequests
      });
    } else {
      this.log.info('Drenaje completado limpiamente: cero solicitudes activas remanentes', {
        drainDurationMs: Date.now() - drainStart
      });
    }

    // 3. Cerrar sockets keep-alive ociosos
    if (typeof (this.server as any).closeIdleConnections === 'function') {
      (this.server as any).closeIdleConnections();
    }

    // 4. Si quedan sockets abiertos tras el drenaje, destruirlos limpiamente
    for (const socket of this.openSockets) {
      socket.destroy();
    }
    this.openSockets.clear();

    await serverClosePromise;
    this.server = null;
  }
}

// Punto de entrada si se ejecuta directamente por CLI / Docker
if (require.main === module) {
  const server = new AgentCoreServer();
  server.start().catch(err => {
    console.error('Error fatal al iniciar Agent Core Server:', err);
    process.exit(1);
  });

  // Manejo de señales de terminación del contenedor
  const shutdown = async (signal: string) => {
    console.log(`Recibida señal ${signal}, cerrando servidor...`);
    await server.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
