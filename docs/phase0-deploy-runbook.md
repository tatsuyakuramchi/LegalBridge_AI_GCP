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

---

## 段階デプロイ(フラグOFF)― 基盤を低リスクで本番投入

> 現時点のブランチは **フラグ既定OFF=現行挙動** + **新スキーマは純追加・冪等**。
> サービス分離(C1/C2)は未完だが、**動く基盤を本番に載せて、サンドボックスで
> 検証できなかったランタイム(worker/search-api 起動・migrate の実DB適用)を実証**
> できる。**フラグは立てず**に出すのが安全。

### 制御フラグ一覧
| フラグ | サービス | 既定 | 立てると | 立てる前提 |
| :--- | :--- | :--- | :--- | :--- |
| (なし) | worker | — | worker `renderHtml` は共有 `renderTemplate` 委譲(**フラグ非依存・常時**)。挙動一致は検証済 → **要スモーク** | — |
| `RUN_INIT_DB=false` | worker | 未設定=initDb実行 | 起動時 initDb を停止 | migrate Job 成功後 |
| `TEMPLATE_SOURCE=db` | worker / search-api | 未設定=disk/proxy | テンプレを DB から読取(C3/B2/B5b 有効化) | `document_templates` seed 済(0002/0003 適用) |
| `VITE_API_READS_TO_WORKER=1` | **admin-ui(ビルド時)** | 未設定=read は search-api | admin-ui の GET を **worker** へ(C1)。worker は read superset(C2 完了)。マスター書込(vendors 等)は D1 どおり Search 維持 | worker に C2 read デプロイ済 + admin-ui 再ビルド・再デプロイ |

### デプロイ順序(推奨)
1. **staging があれば staging を先に**。無ければ本番でもフラグOFFなら低リスク。
2. **migrate Job 実行**(上記 Step 1–2)。0001 は既存DBに冪等no-op、0002–0006 で
   新テーブル追加 + `document_templates` seed。**既存フロー不変**。
3. **コードデプロイ**(`cloudbuild.yaml` admin-ui / `cloudbuild-api.yaml` search-api /
   `cloudbuild-worker.yaml` worker)。**環境変数フラグは未設定のまま**。
   - search-api は Dockerfile の `npm install` で handlebars(B5b 依存)が入る。
4. **スモークテスト**(下記)。
5. 問題なければ**後日**フラグを段階ON: まず `TEMPLATE_SOURCE=db`(worker→search-api の順)、
   さらに後で `RUN_INIT_DB=false`、最後に admin-ui の read 切替(C1, C2 完了後)。

### スモークチェックリスト(フラグOFFデプロイ後)
- [ ] worker 起動ログ正常、**文書生成が従来どおり**(renderHtml 共有化の確認=最重要)
- [ ] search-api 起動正常、`/api/contract-check`(Slack法務検索)・`/api/master/vendors` 応答
- [ ] migrate Job `Succeeded`、`SELECT version FROM schema_migrations`(0001–0006)、
      `works`/`contracts`/`payments` 等が存在
- [ ] admin-ui 既存操作が従来どおり

### フラグ切替の可逆性
- `TEMPLATE_SOURCE`: `--remove-env-vars TEMPLATE_SOURCE` で disk/proxy に即戻し。
- `RUN_INIT_DB`: `--remove-env-vars RUN_INIT_DB` で initDb 再開(冪等・無害)。

> **本デプロイで完了しないこと**: C1(admin-ui→worker専用)/ C2 残バッチ /
> 0007 互換ビュー / 0008 backfill / C5 worker書込先差替。これらは後続フェーズ。
