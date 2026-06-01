# Cloud Run image: legalbridge-search-api
#
# Read-only DB API used by:
#   - Slack Gateway GAS (/法務検索 contract-status lookup)
#   - Admin UI (browser) for masters/dashboards/Backlog reads
#
# This image does NOT contain Backlog webhook handlers or write paths —
# those live in services/worker/. It DOES render template-preview PDFs
# locally (B5b: chromium + puppeteer-core) so Search is independent of
# worker for previews.

FROM node:22-slim

WORKDIR /app

# -----------------------------------------------------------------------
# B5b: 契約書テンプレのプレビュー PDF を search-api ローカルで生成するため、
#   worker と同じ PDF レンダリング依存を入れる(worker proxy 撤去)。
#   - chromium: puppeteer-core が HTML→PDF 印字に使う headless browser
#   - fonts-noto-cjk / fonts-ipafont-*: 日本語フォント。無いと PDF の
#     日本語が豆腐(□)になる。
#   puppeteer-core を /usr/bin/chromium に向け、bundled Chromium の二重DLを回避。
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
