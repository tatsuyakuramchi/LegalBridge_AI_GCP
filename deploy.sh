#!/bin/bash
# deploy.sh
# 使い方: ./deploy.sh
# 事前準備: gcloud auth login && gcloud auth configure-docker asia-northeast1-docker.pkg.dev

set -e

# ─────────────────────────────────────────────
# 設定
# ─────────────────────────────────────────────
PROJECT_ID="legalbridge-488506"
SERVICE_NAME="legalbridge-admin-ui"
REGION="asia-northeast1"
REPO="legalbridge"
IMAGE="asia-northeast1-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE_NAME}"
TAG=$(git rev-parse --short HEAD)

echo ""
echo "🚀 LegalBridge デプロイ開始"
echo "   プロジェクト : ${PROJECT_ID}"
echo "   サービス名   : ${SERVICE_NAME}"
echo "   リージョン   : ${REGION}"
echo "   イメージタグ : ${TAG}"
echo ""

# ─────────────────────────────────────────────
# 1. Docker ビルド
# ─────────────────────────────────────────────
echo "📦 Docker イメージをビルド中..."
docker build \
  --platform linux/amd64 \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  .

echo "✅ ビルド完了"

# ─────────────────────────────────────────────
# 2. Artifact Registry へ push
# ─────────────────────────────────────────────
echo ""
echo "📤 Artifact Registry へ push 中..."
docker push "${IMAGE}:${TAG}"
docker push "${IMAGE}:latest"
echo "✅ push 完了"

# ─────────────────────────────────────────────
# 3. Cloud Run へデプロイ
# ─────────────────────────────────────────────
echo ""
echo "🌏 Cloud Run へデプロイ中..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}:${TAG}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 5 \
  --timeout 300 \
  --set-env-vars "NODE_ENV=production"

echo ""
echo "✅ デプロイ完了！"
echo ""

# ─────────────────────────────────────────────
# 4. サービスURL取得
# ─────────────────────────────────────────────
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format "value(status.url)")

echo "🌐 サービスURL: ${SERVICE_URL}"
echo ""

# ─────────────────────────────────────────────
# 5. workflow_settings をDBに反映（オプション）
# ─────────────────────────────────────────────
echo "📋 workflow_settings をDBに反映中..."
APP_URL="${SERVICE_URL}" npx tsx src/scripts/setupBacklogStatuses.ts
echo "✅ workflow_settings 反映完了"
echo ""
echo "🎉 すべてのデプロイ作業が完了しました"
