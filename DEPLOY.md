# GCP デプロイ準備手順

## 概要
mainブランチへのpushで自動デプロイ（GitHub Actions）

---

## 1. GCP Secret Manager に環境変数を登録

GCPコンソール → Secret Manager で以下を登録してください。

```bash
# ローカルで一括登録する場合（gcloud CLIが必要）
PROJECT_ID="legalbridge-488506"

gcloud secrets create SLACK_BOT_TOKEN        --data-file=- <<< "your-value" --project=$PROJECT_ID
gcloud secrets create SLACK_SIGNING_SECRET   --data-file=- <<< "your-value" --project=$PROJECT_ID
gcloud secrets create BACKLOG_API_KEY        --data-file=- <<< "HUlVeCDDPqE6mt5x80WuitKKFYbFckfjXwG0TpYodYMaPn4NvN1IHuFeXWocUpvI" --project=$PROJECT_ID
gcloud secrets create BACKLOG_HOST           --data-file=- <<< "arclight.backlog.com" --project=$PROJECT_ID
gcloud secrets create BACKLOG_PROJECT_KEY    --data-file=- <<< "LEGAL" --project=$PROJECT_ID
gcloud secrets create DATABASE_URL           --data-file=- <<< "your-db-url" --project=$PROJECT_ID
gcloud secrets create GEMINI_API_KEY         --data-file=- <<< "your-value" --project=$PROJECT_ID
gcloud secrets create GOOGLE_DRIVE_FOLDER_ID --data-file=- <<< "your-value" --project=$PROJECT_ID

# Backlog カスタム属性ID
gcloud secrets create BACKLOG_FIELD_COUNTERPARTY     --data-file=- <<< "630563" --project=$PROJECT_ID
gcloud secrets create BACKLOG_FIELD_CONTRACT_DATE    --data-file=- <<< "630564" --project=$PROJECT_ID
gcloud secrets create BACKLOG_FIELD_CONTRACT_END_DATE --data-file=- <<< "630565" --project=$PROJECT_ID
gcloud secrets create BACKLOG_FIELD_DEADLINE         --data-file=- <<< "630566" --project=$PROJECT_ID
gcloud secrets create BACKLOG_FIELD_CONTRACT_NO      --data-file=- <<< "630567" --project=$PROJECT_ID
gcloud secrets create BACKLOG_FIELD_ORIGINAL_WORK    --data-file=- <<< "630568" --project=$PROJECT_ID
gcloud secrets create BACKLOG_FIELD_ROYALTY_RATE     --data-file=- <<< "630569" --project=$PROJECT_ID
gcloud secrets create BACKLOG_FIELD_PAYMENT_TERMS    --data-file=- <<< "630570" --project=$PROJECT_ID
gcloud secrets create BACKLOG_FIELD_REMARKS          --data-file=- <<< "622803" --project=$PROJECT_ID

# Backlog 課題種別ID
gcloud secrets create BACKLOG_ISSUE_TYPE_LICENSE_MASTER       --data-file=- <<< "4141991" --project=$PROJECT_ID
gcloud secrets create BACKLOG_ISSUE_TYPE_INDIVIDUAL_LICENSE   --data-file=- <<< "4062783" --project=$PROJECT_ID
gcloud secrets create BACKLOG_ISSUE_TYPE_MANUFACTURING        --data-file=- <<< "4141992" --project=$PROJECT_ID
gcloud secrets create BACKLOG_ISSUE_TYPE_OUTSOURCING          --data-file=- <<< "4041449" --project=$PROJECT_ID
gcloud secrets create BACKLOG_ISSUE_TYPE_PURCHASE_ORDER       --data-file=- <<< "4141993" --project=$PROJECT_ID
gcloud secrets create BACKLOG_ISSUE_TYPE_DELIVERY             --data-file=- <<< "4141994" --project=$PROJECT_ID
gcloud secrets create BACKLOG_ISSUE_TYPE_PAYMENT              --data-file=- <<< "4141995" --project=$PROJECT_ID
gcloud secrets create BACKLOG_ISSUE_TYPE_SALES_MASTER         --data-file=- <<< "4142010" --project=$PROJECT_ID
gcloud secrets create BACKLOG_ISSUE_TYPE_LEGAL_CONSULTATION   --data-file=- <<< "4076165" --project=$PROJECT_ID
gcloud secrets create BACKLOG_ISSUE_TYPE_NDA                  --data-file=- <<< "4142011" --project=$PROJECT_ID
```

---

## 2. GitHub Secrets に GCP認証情報を登録

GitHubリポジトリ → Settings → Secrets and variables → Actions

| Secret名 | 内容 |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity プロバイダのリソース名 |
| `GCP_SERVICE_ACCOUNT` | デプロイ用サービスアカウントのメールアドレス |

### Workload Identity Federation のセットアップ（未設定の場合）

```bash
PROJECT_ID="legalbridge-488506"
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
SA_NAME="github-actions-deployer"
REPO="tatsuyakuramchi/LegalBridge_AI_GCP"

# サービスアカウント作成
gcloud iam service-accounts create $SA_NAME \
  --display-name="GitHub Actions Deployer" \
  --project=$PROJECT_ID

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# 必要なロールを付与
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser"

# Workload Identity Pool 作成
gcloud iam workload-identity-pools create "github-pool" \
  --project=$PROJECT_ID \
  --location="global" \
  --display-name="GitHub Actions Pool"

gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project=$PROJECT_ID \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --project=$PROJECT_ID \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${REPO}"

# GitHub Secrets に登録する値を表示
echo ""
echo "以下をGitHub Secretsに登録してください:"
echo "GCP_SERVICE_ACCOUNT: ${SA_EMAIL}"
echo "GCP_WORKLOAD_IDENTITY_PROVIDER: projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
```

---

## 3. デプロイフロー

```
git push origin main
       ↓
GitHub Actions 自動起動
       ↓
Docker build (linux/amd64)
       ↓
Artifact Registry push
       ↓
Cloud Run deploy
       ↓
Secret Manager から環境変数を注入
       ↓
✅ 完了（約3〜5分）
```

---

## 4. 手動デプロイ（ローカルから）

```bash
chmod +x deploy.sh
./deploy.sh
```

事前に以下が必要です：
- `gcloud auth login`
- `gcloud auth configure-docker asia-northeast1-docker.pkg.dev`
- Docker Desktop 起動中
