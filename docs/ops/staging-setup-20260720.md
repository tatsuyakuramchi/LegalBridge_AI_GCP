# staging 環境セットアップ Runbook（全UIリニューアル A 検証用）

- 目的: search-api の read-only 再編・§12 機密フィルタ・master 書込みの worker 移設を**本番と分離した staging で実機検証**してから本番へ。
- 前提: project `legalbridge-488506` / region `asia-northeast1` / Artifact Registry・Cloud Build 済み。
- 命名: 既存サービスに `-staging` サフィックス。
  - `legalbridge-admin-ui-staging` / `legalbridge-search-api-staging` / `legalbridge-document-worker-staging`

> ⚠️ **本番 DB・本番サービスには一切触れない。** 以下は staging 専用リソースのみ作成する。

## 1. staging DB（本番クローン）

Cloud SQL の場合（インスタンスクローン）:
```bash
# 本番インスタンス名を PROD_SQL、staging を STG_SQL とする
gcloud sql instances clone "$PROD_SQL" "${PROD_SQL}-staging" --project legalbridge-488506
# 接続名(INSTANCE_CONNECTION_NAME)を控える
gcloud sql instances describe "${PROD_SQL}-staging" --format='value(connectionName)'
```
- クローンには**本物の口座/反社/個人情報**が含まれる。検証は基本 viewer ロールで行う（機密が「返らない」側の確認）。気になる場合は下記で機密列をスクランブル:
```sql
-- staging DB に対してのみ実行（本番厳禁）
UPDATE vendor_bank_accounts SET account_number = 'STG-'||id, account_holder_kana = 'テスト';
UPDATE vendors SET antisocial_check_result = NULL, rating = NULL;
```

## 2. staging サービスをデプロイ

既存 cloudbuild を **サービス名を上書き**して流す。DB 接続・シークレットは**本番デプロイと同じ設定を staging DB へ向け直す**（下記 env を追加/上書き）。

共通の staging env（Cloud Run `--set-env-vars` 相当。cloudbuild の deploy step へ追記 or `gcloud run services update` で付与）:
| env | 値 | 意味 |
|---|---|---|
| `STAGING_DEV_AUTH` | `1` | **staging のみ**。agent の role 別検証を許可（本番は絶対に付けない） |
| `IAP_ENFORCE` | `false`（未設定でも可） | staging は IAP 無し。これが true だと dev-auth は二重防御で無効化される |
| DB 接続 | staging DB を指す | 本番と同じ env 名で接続先だけ staging へ |

### search-api（services/api）
```bash
gcloud builds submit --config cloudbuild-api.yaml \
  --substitutions SHORT_SHA=$(git rev-parse --short origin/main),_SERVICE_NAME=legalbridge-search-api-staging
# デプロイ後、staging 用 env を付与（DB 接続/シークレットは本番同名で staging を指すよう調整）
gcloud run services update legalbridge-search-api-staging --region asia-northeast1 \
  --set-env-vars STAGING_DEV_AUTH=1 \
  --update-env-vars <DB/secret を staging へ向ける env...>
```

### worker
```bash
gcloud builds submit --config cloudbuild-worker.yaml \
  --substitutions SHORT_SHA=$(git rev-parse --short origin/main),_SERVICE_NAME=legalbridge-document-worker-staging
gcloud run services update legalbridge-document-worker-staging --region asia-northeast1 \
  --update-env-vars <DB を staging へ...>
```

### admin-ui（VITE_* を staging api/worker へ）
admin-ui はビルド時に `VITE_API_READ_URL` / `VITE_API_WRITE_URL` を焼き込む（`src/lib/apiRouter.ts`）。`.env.staging` を用意（本 PR に同梱）し、staging ビルドで読み込む:
```bash
# 事前に上の2サービスの URL を取得し .env.staging に記入
gcloud run services describe legalbridge-search-api-staging --region asia-northeast1 --format='value(status.url)'
gcloud run services describe legalbridge-document-worker-staging --region asia-northeast1 --format='value(status.url)'
# .env.staging を使って admin-ui を staging ビルド→デプロイ
#   （既存 cloudbuild.yaml の Docker build 引数で .env.staging を .env.production の代わりに使う運用、
#    もしくはローカルで `cp .env.staging .env.production && npm run build` 相当）
gcloud builds submit --config cloudbuild.yaml \
  --substitutions SHORT_SHA=$(git rev-parse --short origin/main),_SERVICE_NAME=legalbridge-admin-ui-staging
```

## 3. 私(agent)へ共有するもの

デプロイ後、次の**3つの URL** を教えてください（IAP 無し・`--allow-unauthenticated` 前提）:
```
STAGING_API_URL     = https://legalbridge-search-api-staging-....run.app
STAGING_WORKER_URL  = https://legalbridge-document-worker-staging-....run.app
STAGING_ADMIN_URL   = https://legalbridge-admin-ui-staging-....run.app
```
私はこれらに `x-staging-role: viewer|admin` ヘッダ付きで curl/fetch し、検証スクリプト `scripts/staging/verify.sh` で健全性を確認します。

## 4. 検証（agent 実行）
```bash
STAGING_API_URL=<...> bash scripts/staging/verify.sh
```
- §13 統合作品検索（own/licensed_in 横断）
- §12 機密除外（viewer に口座/反社が返らない ／ admin には返る）
- SSR read-only（書込みフォームが無い）
- 各 route の 200/認可

## 5. 破壊的変更の進め方（staging で1つずつ検証）
1. master 書込み(vendors/staff/conditions links/aliases)を worker へ移設 → admin-ui 切替 → staging で編集が通ることを確認
2. search-api から当該 write ルートを撤去 → staging で 404/405 と admin-ui の健全性を確認
3. SSR ポータルの書込みフォーム撤去（read-only 化）→ staging SSR HTML を確認
4. §12 機密フィルタを HTML/JSON/CSV/Projection に実装 → viewer/admin で確認
5. `/api/search/*` 統合エンドポイント＋Projection 新設
各ステップで verify.sh を回し、緑を確認してから次へ。

## 6. 後片付け
検証完了後、staging サービス/DB は削除可（コスト）。本番反映は別途 §15 の手順で。
