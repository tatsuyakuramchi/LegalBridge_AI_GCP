# Phase 17s セキュリティ強化: HMAC 短期署名 URL + IAP

## 目的
Slack `/法務検索` から開く Web 詳細ページの認可を、恒久キー
`LB_PORTAL_SECRET` から **2 層構造** に置き換える:

- **Lv.1 HMAC 短期署名 URL** — リソース固有・期限付き (10 分)
- **Lv.2 IAP + Workspace SSO** — 社員のみ通過

## 構成図

```
[Slack /法務検索] ──issue短期URL──> [GAS Code.gs]
                                         │ sign(resourceId, exp) with LB_SIGNING_SECRET
                                         ▼
                  https://search.example.com/search/vendor/123?exp=...&sig=...
                                         │
                                         ▼
                  [HTTPS LB] ─ IAP ─> Workspace SSO で本人確認
                                         ▼
                  [Cloud Run: legalbridge-search-api]
                                         │ requireSignedUrl middleware
                                         │   - IAP JWT 再検証 (任意)
                                         │   - HMAC + exp 検証
                                         │   - 旧 ?token= は dual-accept
                                         ▼
                                       Postgres
```

## 変更ファイル
- `services/api/src/lib/signedUrl.ts` (新) — HMAC sign/verify
- `services/api/src/lib/iap.ts` (新)       — IAP JWT 検証 (任意)
- `services/api/src/lib/authMiddleware.ts` (新) — requireSignedUrl
- `services/api/src/views/contractSearchHtml.ts` — `SignLink` 受け取り
- `services/api/server.ts` — `/search/*` ルートに requireSignedUrl
- `services/api/package.json` — `google-auth-library` 追加
- `gas/Code.gs` — `signListResourceQs_` / `signResourceQs_` 追加
- `cloudbuild-api-private.yaml` (新) — ロックダウン版デプロイパイプライン

## 移行ステップ（無停止）

### Step 1. シークレット作成

```bash
# 32+ bytes random hex
LB_SIGNING_SECRET=$(openssl rand -hex 32)
echo $LB_SIGNING_SECRET

# Secret Manager に登録
echo -n "$LB_SIGNING_SECRET" | gcloud secrets create LB_SIGNING_SECRET \
  --data-file=- --replication-policy=automatic
```

### Step 2. Cloud Run に注入

```bash
gcloud run services update legalbridge-search-api \
  --region asia-northeast1 \
  --update-secrets=LB_SIGNING_SECRET=LB_SIGNING_SECRET:latest
```

### Step 3. GAS の ScriptProperty に同じ値を登録

GAS エディタ → プロジェクトの設定 → スクリプトプロパティ:
- `LB_SIGNING_SECRET` = Step 1 の値（同じもの）

旧 `LB_PORTAL_SECRET` は **当面残置**（dual-accept で並走するため）。

### Step 4. 動作確認（dual-accept 期間）

`services/api` をデプロイ後:
- 新規 Slack `/法務検索` 経由のリンクは HMAC URL (`exp=...&sig=...`)
- 既存ブラウザの古い `?token=` URL も引き続き動作
- Cloud Logging で `evt:"search_access"` で集計:
  - `outcome:"allow_signed"` が増えていく
  - `outcome:"allow_legacy_token"` が 0 に近づく

### Step 5. HTTPS LB + IAP を構築

```bash
PROJECT=legalbridge-488506
REGION=asia-northeast1
SERVICE=legalbridge-search-api
DOMAIN=search.example.com           # 自社の正式 DNS
WORKSPACE_DOMAIN=example.com         # Workspace のドメイン

# 静的 IP
gcloud compute addresses create lb-ip --global

# Serverless NEG
gcloud compute network-endpoint-groups create sneg-search-api \
  --region=$REGION --network-endpoint-type=serverless \
  --cloud-run-service=$SERVICE

# Backend Service (IAP 後で有効化)
gcloud compute backend-services create be-search-api \
  --global --load-balancing-scheme=EXTERNAL_MANAGED
gcloud compute backend-services add-backend be-search-api \
  --global --network-endpoint-group=sneg-search-api \
  --network-endpoint-group-region=$REGION

# SSL Cert + URL Map + Forwarding Rule
gcloud compute ssl-certificates create cert-search \
  --domains=$DOMAIN --global
gcloud compute url-maps create um-search \
  --default-service=be-search-api
gcloud compute target-https-proxies create tp-search \
  --url-map=um-search --ssl-certificates=cert-search
gcloud compute forwarding-rules create fr-search \
  --global --address=lb-ip --target-https-proxy=tp-search --ports=443

# IAP 有効化
gcloud iap web enable --resource-type=backend-services --service=be-search-api

# Workspace ドメインのみ許可
gcloud iap web add-iam-policy-binding \
  --resource-type=backend-services --service=be-search-api \
  --member="domain:$WORKSPACE_DOMAIN" \
  --role="roles/iap.httpsResourceAccessor"

# LB が Cloud Run を呼べる権限
PROJECT_NUM=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
gcloud run services add-iam-policy-binding $SERVICE --region=$REGION \
  --member="serviceAccount:service-$PROJECT_NUM@gcp-sa-iap.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# DNS A レコード設定 (lb-ip の値を DOMAIN にポイント)
gcloud compute addresses describe lb-ip --global --format='value(address)'
# → DNS 管理画面で A レコードを設定
```

### Step 6. アプリ側の IAP 検証を有効化（多層防御）

Cloud Run 環境変数に追加:
- `GCP_PROJECT_NUMBER` = `(gcloud projects describe $PROJECT --format='value(projectNumber)')`
- `IAP_BACKEND_SERVICE_ID` = `(gcloud compute backend-services describe be-search-api --global --format='value(id)')`
- `IAP_ENFORCE=true`

```bash
gcloud run services update legalbridge-search-api \
  --region asia-northeast1 \
  --update-env-vars=GCP_PROJECT_NUMBER=$PROJECT_NUM,IAP_BACKEND_SERVICE_ID=<id>,IAP_ENFORCE=true
```

### Step 7. Cloud Run を非公開化（最終切替）

Cloud Build trigger を `cloudbuild-api-private.yaml` に切り替え:

```bash
gcloud builds triggers update <trigger-id> \
  --build-config=cloudbuild-api-private.yaml
```

または GCP コンソールでトリガー設定の "Cloud Build configuration file" を
`cloudbuild-api-private.yaml` に変更。

次の release/api 反映で:
- `--no-allow-unauthenticated`
- `--ingress=internal-and-cloud-load-balancing`

が適用され、`*.run.app` URL からの直アクセスが拒否される。

### Step 8. GAS の `CLOUD_RUN_BASE_URL` を LB ドメインに変更

GAS ScriptProperty:
- `CLOUD_RUN_BASE_URL` = `https://search.example.com`（LB のドメイン）

### Step 9. legacy 経路の撤去

ログで `outcome:"allow_legacy_token"` が 1〜2 週間ゼロのままなら:

1. `services/api/server.ts` の `requireSignedUrl` から legacy フォールバック削除（または `LB_PORTAL_SECRET` env を削除するだけでも事実上 disable）
2. `gas/Code.gs` から legacy token 経路 (`else { ... LB_PORTAL_SECRET ... }`) を削除
3. Secret Manager の `LB_PORTAL_SECRET` を削除

## 動作確認用 curl

```bash
# 1. 直 *.run.app アクセス禁止（Step 7 後）
curl -i https://legalbridge-search-api-xxx-an.a.run.app/search/vendor?q=test
# → 403 Forbidden (or 401)

# 2. LB ドメイン経由（Workspace ログイン経由でしか通らない）
# ブラウザで以下を開く → Workspace SSO 画面 → 通過後にアプリ画面
https://search.example.com/search/vendor?q=test&exp=...&sig=...
```

## トラブルシューティング

| 症状 | 切り分け |
|---|---|
| 「アクセス URL が無効か期限切れ」 | Cloud Logging で `evt:"search_access"` `outcome:"deny"` の `sigDenyReason` を確認 (`expired` / `mismatch` / `missing_params`) |
| GAS で `LB_SIGNING_SECRET is not set` 状の挙動 | GAS ScriptProperty を確認。値が空文字なら legacy フォールバックされる |
| IAP の Workspace SSO 画面が出ない | `gcloud iap web get-iam-policy` でドメインバインディングを確認 |
| Slack から開いた直後に「期限切れ」 | exp の TTL が短すぎる（デフォルト 600 秒）。`signResourceQs_(id, 1200)` 等に伸ばす |
| Cloud Logging で IAP_ENFORCE=true でも `iap.ok=false` | `GCP_PROJECT_NUMBER` / `IAP_BACKEND_SERVICE_ID` の値を再確認 |

## 監査クエリ（Cloud Logging）

```
jsonPayload.evt="search_access"
  AND timestamp >= "2026-05-13T00:00:00Z"
```

- `outcome` 別件数: 認可成功/失敗の傾向
- `outcome="allow_legacy_token"` の残存: GAS / 旧クライアント未移行の指標
- `iapEmail` 別: 社員ごとのアクセス頻度（過剰利用検知）
