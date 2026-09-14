# RunLoop production image: Next.js standalone + Prisma migrate-on-boot.
#
# Build:   docker build -t ghcr.io/kevincutts/runloop:local .
# Run:     via docker-compose.prod.yml on the Proxmox LXC host (never `docker run`
#          bare — Postgres, secrets and migration ordering live in compose).
#
# All pages are `dynamic = "force-dynamic"`, so `next build` never touches the DB.

FROM node:20-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
# postinstall runs `prisma generate`, which needs the schema present.
COPY prisma ./prisma
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time dummy so module-level Prisma init (lib/prisma.ts) can be
# collected by `next build`. No connection is ever opened: all pages are
# force-dynamic and the real DATABASE_URL is injected at runtime via compose.
# Scoped to this stage — the runner image never sees it.
ARG BUILD_DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public
ENV DATABASE_URL=$BUILD_DATABASE_URL
RUN npx prisma generate && npm run build

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --gid 1001 nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Prisma CLI + schema/migrations so the entrypoint can `migrate deploy` at boot.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY scripts/prod-entrypoint.sh ./scripts/prod-entrypoint.sh
# Prisma CLI for `migrate deploy` at boot. Installed on top of the standalone
# tree (standalone only carries traced modules); the CLI version is pinned to
# match package.json — keep the two in sync on Prisma upgrades.
RUN npm install --no-save --no-package-lock --omit=dev prisma@7.10.0 \
  && chmod +x ./scripts/prod-entrypoint.sh \
  && chown -R nextjs:nodejs /app
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["./scripts/prod-entrypoint.sh"]
