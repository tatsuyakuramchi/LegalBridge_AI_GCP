# Cloud Run image: legalbridge-document-worker
#
# Handles:
#   - Backlog webhook ingress (POST /api/webhooks/backlog)
#   - Document generation (Docs/Excel/Drive)
#   - Master-data writes (vendors, staff, contracts, rules, templates)
#   - Workflow status transitions
#
# Owned by the Legal team. Independent of services/api.

FROM node:22-slim

WORKDIR /app

# Install dependencies first so they're cached across code changes.
COPY package*.json ./
RUN npm install --omit=dev

# Bring in tsx so we can run .ts directly.
RUN npm install tsx

# Copy the application source.
COPY server.ts ./
COPY src ./src
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "server.ts"]
