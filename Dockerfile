# syntax=docker/dockerfile:1
# ============================================================================
# OTPsplash — Production image (multi-stage)
#
# Debian tabanlı (node:20-slim): Prisma'nın `native` query engine'i builder ve
# runner'da aynı libc/openssl ABI'sine denk gelir (alpine/musl uyumsuzluğu yok).
# Runner non-root `node` kullanıcısıyla, yalnızca production bağımlılıklarıyla çalışır.
# ============================================================================

# ───────────────────────── Stage 1: builder ─────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

# Prisma query engine libssl'e ihtiyaç duyar.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Bağımlılık katmanını cache'le: yalnızca manifest değişince yeniden kurulur.
COPY package.json package-lock.json ./
RUN npm ci

# Derleme girdileri (şema → prisma generate, src → tsc, tsconfig → path alias).
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# prisma generate + tsc + tsc-alias (package.json "build" script'i).
RUN npm run build

# Dev bağımlılıklarını at — üretilen Prisma client (@prisma/client + .prisma) kalır.
RUN npm prune --omit=dev

# ───────────────────────── Stage 2: runner ─────────────────────────
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Runtime'da Prisma için libssl + PID 1 sinyal yönetimi için dumb-init.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Prune edilmiş bağımlılıklar + derlenmiş çıktı + şema/migration'lar.
# node:20-slim'de hazır gelen non-root `node` (uid 1000) kullanıcısına devredilir.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000

# /health üzerinden canlılık kontrolü (slim'de curl yok → node http ile).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Şema migration'ları bir release adımıdır (uygulama başlangıcında değil):
#   docker run --rm <image> npx prisma migrate deploy
# dumb-init → SIGTERM/SIGINT'i node'a iletir, graceful shutdown çalışır.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
