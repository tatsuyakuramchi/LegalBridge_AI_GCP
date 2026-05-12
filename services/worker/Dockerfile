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

# -----------------------------------------------------------------------
# PDF rendering deps:
#   - chromium: headless browser used by puppeteer-core to print HTML→PDF
#   - fonts-noto-cjk / fonts-ipafont-*: Japanese fonts. Without these,
#     all 日本語 in the rendered PDF is replaced by tofu (□).
# We use puppeteer-core (not puppeteer) and point it at /usr/bin/chromium
# so we don't double-download the bundled Chromium binary.
# -----------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-noto-cjk \
      fonts-noto-cjk-extra \
      fonts-ipafont-gothic \
      fonts-ipafont-mincho \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROMIUM_FLAGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage"

# Install dependencies first so they're cached across code changes.
COPY package*.json ./
RUN npm install --omit=dev

# Bring in tsx so we can run .ts directly.
RUN npm install tsx

# Copy the application source.
COPY server.ts ./
COPY src ./src
COPY tsconfig.json ./

# Copy document templates. DocumentService reads from process.cwd()/templates,
# so they must land at /app/templates inside the container.
COPY templates ./templates
COPY templates_config.json ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "server.ts"]
