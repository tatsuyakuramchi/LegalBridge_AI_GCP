# Cloud Run image: legalbridge-search-api
#
# Read-only DB API used by:
#   - Slack Gateway GAS (/法務検索 contract-status lookup)
#   - Admin UI (browser) for masters/dashboards/Backlog reads
#
# This image does NOT contain document-generation code, Backlog webhook
# handlers, or any write paths. Those live in services/worker/.

FROM node:22-slim

WORKDIR /app

# Install dependencies first so they're cached across code changes.
COPY package*.json ./
RUN npm install --omit=dev

# Bring in tsx so we can run .ts directly (matches existing pipeline).
RUN npm install tsx

# Copy the application source.
COPY server.ts ./
COPY src ./src
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "server.ts"]
