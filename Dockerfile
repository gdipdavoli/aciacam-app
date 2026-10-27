# ==============================================================================
# Dockerfile — Agent Core Worker para Railway (Sprint 7B.8 Prioridad 4A)
# Runtime: Node.js 20 LTS Alpine (mínima huella de memoria y disco)
# ==============================================================================

FROM node:20-alpine AS runner

WORKDIR /app

# Dependencias del sistema necesarias para compatibilidad glibc/musl
RUN apk add --no-cache libc6-compat wget

# Copiar manifiestos de dependencias
COPY package.json package-lock.json ./

# Instalar dependencias de producción y tsx para ejecución TypeScript
RUN npm ci --omit=dev && npm install tsx

# Copiar código fuente de Agent Core y librerías transversales
COPY tsconfig.json ./
COPY app ./app
COPY types ./types
COPY server ./server

# Seguridad: Asignar permisos al usuario node sin privilegios de root
RUN chown -R node:node /app
USER node

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV AGENT_CORE_ENV=integration
ENV PORT=8000
EXPOSE 8000

# Healthcheck interno del contenedor
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

# Arranque del servicio autónomo
CMD ["npx", "tsx", "server/agent-core-service.ts"]
