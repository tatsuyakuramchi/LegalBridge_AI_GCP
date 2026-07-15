# legalbridge-migrate — DDL migration runner (Cloud Run Job)
# Build context: migrations/  (see cloudbuild-migrate.yaml)
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
# Runs pending migrations/NNNN_*.sql against DATABASE_URL, then exits.
#
# 2026-07-15 障害対応: ベースイメージ(node:22-slim, floating tag)の更新後、
#   既定 ENTRYPOINT(docker-entrypoint.sh)経由だと CMD の run.mjs が実行されず
#   「出力なし・exit 0」でジョブが成功扱いになり、migration が黙って
#   スキップされる事象が発生(0127 が未適用のまま Cloud Build/Job とも SUCCESS)。
#   node を ENTRYPOINT で直接指定して entrypoint スクリプトを経由しない。
#   (docker run --rm <img> は無言 exit 0 / --entrypoint node <img> run.mjs は
#    正常動作、を Cloud Shell で再現確認済み)
ENTRYPOINT ["node", "run.mjs"]
