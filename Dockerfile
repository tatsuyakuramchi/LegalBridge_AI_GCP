# legalbridge-admin-ui — slim static host (Phase 2f-2)
#
# Two-stage build:
#   1. Build the React bundle with Vite (needs full dev deps).
#   2. Run a thin Express host that serves the bundle from /app/dist
#      and returns 410 Gone for any /api/* request (apiRouter dispatches
#      everything client-side to legalbridge-search-api / -document-worker).

# ── Build stage ────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

# tsx is needed because server.ts runs directly (no JS transpile step).
RUN npm install tsx

# Static assets + thin server. We deliberately do NOT copy src/,
# templates/, or lib/ — none of them are needed at runtime now that
# the API routes live in services/api and services/worker.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "server.ts"]
