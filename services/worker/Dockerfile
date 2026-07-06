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
#   - chromium (apt): 実行に使うのは下の chrome-headless-shell だが、
#     必要な共有ライブラリ一式を確実に揃えるために入れておく (依存 .so
#     だけを手で列挙すると Debian 側の変化で漏れが出るため)。
#   - fonts-noto-cjk / fonts-ipafont-*: Japanese fonts. Without these,
#     all 日本語 in the rendered PDF is replaced by tofu (□).
#
# 2026-07-06 障害の教訓: apt の chromium はビルド時期で版が変わり、新しい
# 版は Cloud Run 上で puppeteer.launch が「Failed to launch the browser
# process!」で起動不能になった。実行バイナリは puppeteer-core 23.11.1 が
# 公式サポートする chrome-headless-shell 131.0.6778.204 をピン留めして
# 入れ、ビルドを再現可能にする (puppeteer-core を上げるときは同梱の
# revisions.js の chrome-headless-shell 版に合わせてここも上げること)。
# -----------------------------------------------------------------------
# unzip: @puppeteer/browsers はダウンロードした zip の展開に unzip か
#   yauzl を要求する。node:22-slim にはどちらも無く、これが無いと
#   「no zip archiver is available」でビルドが失敗する (2026-07-06 実証)。
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      unzip \
      fonts-noto-cjk \
      fonts-noto-cjk-extra \
      fonts-ipafont-gothic \
      fonts-ipafont-mincho \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# chrome-headless-shell を /opt/chrome に取得し、展開先を find で特定して
# 安定パス /usr/local/bin/chrome-headless-shell へ symlink する
# (バージョン依存のディレクトリ名を実行時パスに直書きしないため)。
# 併せて --version を叩き、バイナリが実際に起動できることをビルド時に検証
# する (起動不能ならここで build を失敗させ、本番へ壊れた image を出さない)。
RUN npx --yes @puppeteer/browsers install chrome-headless-shell@131.0.6778.204 --path /opt/chrome \
    && ln -s "$(find /opt/chrome -type f -name chrome-headless-shell | head -n1)" /usr/local/bin/chrome-headless-shell \
    && /usr/local/bin/chrome-headless-shell --version

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chrome-headless-shell

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
