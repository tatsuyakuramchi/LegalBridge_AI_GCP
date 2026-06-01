# Phase 0 デプロイ手順書(ロール / migrate Job / RUN_INIT_DB 切替)

> migration 基盤(D2)の**本番反映**手順。コード/設定は検証済み(`migrations/`、
> `cloudbuild-migrate.yaml`、worker の `RUN_INIT_DB` ゲート)。本手順は GCP 認証の
> ある環境(Cloud Shell / CI / 運用端末)で実行する。各ステップに**検証**と
> **ロールバック**を併記。安全のため**この順序**で行う。

## 前提・置き換え変数
| 変数 | 例 |
| :--- | :--- |
| `PROJECT` | (GCP プロジェクトID) |
| `REGION` | `asia-northeast1` |
| `INSTANCE` | Cloud SQL 接続名 `PROJECT:REGION:instance` |
| `DB` | `legalbridge`(DB名) |
| `WORKER_SVC` | `legalbridge-document-worker` |

---

## Step 0: worker コードを先にデプロイ(挙動不変)
`RUN_INIT_DB` ゲート入りの worker を**先に**出す。env 未設定なので**挙動は現行どおり**(initDb 実行)= 安全。
```bash
gcloud builds submit --config cloudbuild-worker.yaml \
  --substitutions=_REGION=$REGION .
```
- **検証**: worker が起動し、ログに従来どおり `✅ Database initialized`。
- **ロールバック**: 直前リビジョンへ `gcloud run services update-traffic $WORKER_SVC --region $REGION --to-revisions=PREV=100`。

---

## Step 1: DB ロール作成 + シークレット登録
Cloud SQL に `lb_migrate`(DDL用)を作成。`lb_search`/`lb_worker` は Phase 3 で本格利用。
```bash
# 1-1. ログインロール作成(Cloud SQL 流儀)
gcloud sql users create lb_migrate --instance=<instance> --password='<STRONG_PW>'

# 1-2. 権限付与(public スキーマに DDL)。psql は Cloud SQL Auth Proxy or gcloud sql connect 経由
#   GRANT ALL ON SCHEMA public TO lb_migrate;  (migrations/roles.template.sql 参照)

# 1-3. migrate 用 DATABASE_URL を Secret Manager へ
printf 'postgresql://lb_migrate:<STRONG_PW>@localhost/%s?host=/cloudsql/%s' "$DB" "$INSTANCE" \
  | gcloud secrets create lb-migrate-database-url --data-file=- --project=$PROJECT
# 既存なら: gcloud secrets versions add lb-migrate-database-url --data-file=-

# 1-4. migrate Job 実行 SA にシークレット読取 + Cloud SQL Client を付与
#   roles/secretmanager.secretAccessor, roles/cloudsql.client
```
- **検証**: `gcloud secrets versions access latest --secret=lb-migrate-database-url` が取得できる。
- **ロールバック**: `gcloud sql users delete lb_migrate --instance=<instance>` / シークレット無効化。

---

## Step 2: migrate Cloud Run Job をデプロイ＆実行
`cloudbuild-migrate.yaml` がイメージビルド → Job デプロイ → **実行(--wait)**まで行う。
```bash
gcloud builds submit --config cloudbuild-migrate.yaml \
  --substitutions=_REGION=$REGION,_INSTANCE_CONNECTION_NAME=$INSTANCE .
```
- 既存本番 DB に対して `0001_baseline` は**冪等(IF NOT EXISTS)= 実質 no-op**。`schema_migrations` に baseline が記録される。
- **検証**:
  ```bash
  gcloud run jobs executions list --job legalbridge-migrate --region $REGION   # Succeeded
  # DB で: SELECT version, applied_at FROM schema_migrations;  → 0001_baseline 1 行
  ```
- **ロールバック**: baseline は no-op なのでデータ変更なし。問題時は Job を無効化し従来の initDb 運用へ(Step 3 を実施しない)。

> 以後、スキーマ変更は `migrations/0002_*.sql …` を足して同 Job を再実行する(単一所有)。

---

## Step 3: worker の initDb を停止(RUN_INIT_DB=false)
**前提**: Step 2 成功(schema を runner が所有)。worker は起動時に DDL を触らなくする。
```bash
gcloud run services update $WORKER_SVC --region $REGION \
  --update-env-vars RUN_INIT_DB=false
```
- **検証**: 新リビジョンのログに `⏭️  RUN_INIT_DB=false — skipping initDb`。worker が正常起動し、
  Backlog webhook / 文書生成のスモークが通る。`schema_migrations` 以外のスキーマに変化なし。
- **ロールバック**(即時・安全):
  ```bash
  gcloud run services update $WORKER_SVC --region $REGION --remove-env-vars RUN_INIT_DB
  ```
  → worker は再び起動時 initDb を実行(従来挙動)。initDb は冪等なので無害。

---

## 完了条件(Phase 0 DoD)
- [ ] migrate Job が `Succeeded`、`schema_migrations` に `0001_baseline`。
- [ ] worker が `RUN_INIT_DB=false` で正常稼働(initDb skip ログ + スモークOK)。
- [ ] スキーマは runner が単一所有(以後 initDb は流れない)。
- [ ] ロールバック手順(Step 0/2/3)を確認済み。

## 注意
- `lb_search`/`lb_worker` の**テーブル単位 GRANT 厳格化**は Phase 3(C5/D1)で
  `migrations/00NN_grants.sql` として版管理する(本 Phase は `lb_migrate` のみ実利用)。
- 新スキーマ(works/contracts/payments …)と互換ビューは Phase 1 以降、同 Job で適用。
