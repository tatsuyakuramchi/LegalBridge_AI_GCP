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

---

## フラグ段階ON 完全手順 ― 基盤投入後に機能を1つずつ有効化

> フラグOFFデプロイ(上記)が本番で安定したあと、**フラグを1つずつ立てて**
> 新機能を有効化する手順。各フラグは**独立・可逆**で、ON→スモーク→NG なら
> `--remove-env-vars` で即ロールバック。**この順序**(依存の浅い順)で進める。
> 実行は GCP 認証のある環境。1ステップ完了・安定を確認してから次へ。
>
> **前提となるブランチ反映**(各 cloudbuild は対象ブランチの push で自動デプロイ):
> | コミット | 内容 | 反映先ブランチ | 必要なステップ |
> | :--- | :--- | :--- | :--- |
> | `0211390` B3 | `/api/v3` write を admin ロール必須化 | `release/api`(search-api) | Step F4 の v3 write 前 |
> | `361ed48` 0012 | 同期トリガ(old→新スキーマ) | migrate Job(`schema_migrations`) | Step F0 の migrate で適用 |
>
> ```bash
> # B3(search-api)を release/api へ反映 → search-api 自動デプロイ(挙動はフラグ非依存で安全)
> git push origin claude/game-company-schema-design-HSNYB:release/api
> ```

### 共通変数(再掲)
```bash
REGION=asia-northeast1
WORKER_SVC=legalbridge-document-worker
SEARCH_SVC=legalbridge-search-api
```
> リビジョン固定ロールバック用に、各 update 前の現リビジョンを控える:
> `gcloud run services describe $SVC --region $REGION --format='value(status.latestReadyRevisionName)'`

---

### Step F0: migrations を最新まで適用(0001–0012)
フラグを立てる前に、DB スキーマ・backfill・同期トリガを**先に**反映する。

> ⚠️ **`.sql` を Cloud SQL Studio / GUI に手で貼って流さないこと。**
> マイグレーションの適用順・冪等・重複ガードは **runner(`migrations/run.mjs`)が
> `schema_migrations` で管理**する。`.sql` 自体は `schema_migrations` を作らないため、
> 手動貼付では `relation "schema_migrations" does not exist` 等になり追跡も効かない。
> さらに `0003_seed_templates.sql` は **約656KB** で GUI の貼付上限を超える。
> **必ず runner(下記 A or B)で流す。** 全マイグレーションは冪等(`IF NOT EXISTS` /
> `WHERE NOT EXISTS` / `CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS`)なので、
> 手動で一部オブジェクトが既にあっても runner 全件再実行で安全。

**A) Cloud Shell から runner 直実行(最速・推奨。Job/Secret 不要)**
```bash
INSTANCE=<PROJECT:REGION:instance>   # Cloud SQL 接続名
DB=legalbridge

# Cloud SQL Auth Proxy で 127.0.0.1:5432 に DB を張る
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.1/cloud-sql-proxy.linux.amd64
chmod +x cloud-sql-proxy
./cloud-sql-proxy "$INSTANCE" &

cd migrations && npm install
DATABASE_URL="postgresql://postgres:<PW>@127.0.0.1:5432/$DB" npm run migrate:dry   # pending 確認(0001-0012)
DATABASE_URL="postgresql://postgres:<PW>@127.0.0.1:5432/$DB" npm run migrate        # 適用
```
> run.mjs は 127.0.0.1 を local 判定し ssl=false(proxy が Cloud SQL への TLS を担う)。

**B) Cloud Run Job(CI/反復運用向け。Secret 前提=Step 1 が必要)**
```bash
gcloud builds submit --config cloudbuild-migrate.yaml \
  --substitutions=_REGION=$REGION,_INSTANCE_CONNECTION_NAME=$INSTANCE .
```
- **検証**:
  ```bash
  gcloud run jobs executions list --job legalbridge-migrate --region $REGION   # 最新が Succeeded
  # DB で:
  #   SELECT version FROM schema_migrations ORDER BY version;  → 0001〜0012 が揃う
  #   SELECT count(*) FROM document_templates;                 → seed 済(>0)
  #   SELECT count(*) FROM works; SELECT count(*) FROM contracts;  → 0008–0010 backfill 反映
  #   SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_sync_%';  → 0012 トリガ 5本(関数名は lb_sync_*、トリガ名は trg_sync_*)
  ```
- **ロールバック**: backfill/トリガは**純追加・冪等**(既存テーブル不変)。問題時は
  0012 のトリガのみ無効化可: `DROP TRIGGER lb_sync_contracts ON contract_capabilities;` 等
  (旧フローは旧テーブルにそのまま書くため無影響)。

---

### Step F1: worker テンプレを DB 読取(`TEMPLATE_SOURCE=db`)
**前提**: F0 成功(`document_templates` seed 済)。worker の文書生成をディスク→DB に切替。
```bash
gcloud run services update $WORKER_SVC --region $REGION \
  --update-env-vars TEMPLATE_SOURCE=db
```
- **検証**: 新リビジョン起動ログに DB テンプレロード成功。**実際に文書を1本生成**し、
  従来と同一HTML/PDFになること(renderHtml は既に共有 `renderTemplate` 委譲済=差分は出所のみ)。
  Backlog webhook 経由の生成スモークも1件。
- **ロールバック**(即時): `gcloud run services update $WORKER_SVC --region $REGION \
  --remove-env-vars TEMPLATE_SOURCE` → ディスクテンプレに復帰。

---

### Step F2: worker の initDb を停止(`RUN_INIT_DB=false`)
**前提**: F0 成功(schema は migrate Job が単一所有)。Step 3 と同一。
```bash
gcloud run services update $WORKER_SVC --region $REGION \
  --update-env-vars RUN_INIT_DB=false
```
- **検証**: 起動ログに `⏭️  RUN_INIT_DB=false — skipping initDb`。Backlog webhook /
  文書生成スモークOK。スキーマに変化なし。
- **ロールバック**(即時): `--remove-env-vars RUN_INIT_DB` → 起動時 initDb 再開(冪等・無害)。

> F1 と F2 は worker への env 追加なので、1リビジョンに**まとめて**当てても良い:
> `--update-env-vars TEMPLATE_SOURCE=db,RUN_INIT_DB=false`。分けると切り分けが容易。

---

### Step F3: search-api テンプレを DB 読取(`TEMPLATE_SOURCE=db`)
**前提**: F0 成功 + B3 が `release/api` へ反映済(search-api 最新コード)。
```bash
gcloud run services update $SEARCH_SVC --region $REGION \
  --update-env-vars TEMPLATE_SOURCE=db
```
- **検証**: テンプレ一覧 API が DB 由来で返る。`/api/templates`(または該当エンドポイント)で
  件数・内容が従来一致。B5b html プレビューがローカル生成される(worker proxy を使わない)。
  ※ PDF は Chromium 同梱(B5b 残)まで proxy 継続=現状維持で可。
- **ロールバック**(即時): `--remove-env-vars TEMPLATE_SOURCE` → proxy/disk に復帰。

---

### Step F4: admin-ui の read を worker へ寄せる(`VITE_API_READS_TO_WORKER=1`)
**最後**に実施。これは**ビルド時**フラグ(Vite 埋め込み)なので env update では効かず、
**再ビルド+再デプロイ**が必要。
**前提**: worker に C2 read superset がデプロイ済(完了済)+ F1/F2 安定。
```bash
# admin-ui を read→worker でビルドして main へ(cloudbuild.yaml が VITE_API_READS_TO_WORKER を
# ビルド substitution で受ける場合は --substitutions で、env 埋め込みなら下記のように cloudbuild 側で渡す)
#   例) cloudbuild.yaml の Vite build step に: --build-arg VITE_API_READS_TO_WORKER=1
#       もしくは substitutions=_VITE_API_READS_TO_WORKER=1
git push origin claude/game-company-schema-design-HSNYB:main   # main push で admin-ui 自動デプロイ
```
> ⚠️ フラグの注入経路(cloudbuild substitution / build-arg / .env)を**反映前に確認**。
> 値が埋まらないと既定OFF(=search-api 読取)のまま無害に出る。
- **検証**: admin-ui の GET が worker を叩く(DevTools Network で WRITE_URL 宛を確認)。
  一覧/詳細が従来一致。**マスター書込(vendors 等)は引き続き search-api**(D1, READ_PATHS_ON_POST)。
- **ロールバック**: `VITE_API_READS_TO_WORKER` を外して再ビルド→ main 再 push
  → read は search-api に復帰。

---

### フラグ段階ON DoD
- [ ] F0: `schema_migrations` に 0001–0012、`document_templates` seed、works/contracts backfill、`lb_sync_*` トリガ。
- [ ] F1: worker 文書生成が DB テンプレで従来一致。
- [ ] F2: worker `RUN_INIT_DB=false` で initDb skip・スモークOK。
- [ ] F3: search-api テンプレ list が DB 由来、B5b html ローカル生成。
- [ ] F4: admin-ui read が worker、書込は search-api 維持。
- [ ] 各フラグの**即時ロールバック**(remove-env-vars / 再ビルド)を確認済。

### 順序の要点
1. **F0(migrate)が全ての前提** ― スキーマ/seed が無いと TEMPLATE_SOURCE=db / RUN_INIT_DB=false が壊れる。
2. **worker(F1/F2)→ search-api(F3)→ admin-ui(F4)** ― 読取の供給側(worker/search-api)を
   先に安定させてから、消費側(admin-ui)の経路を切り替える。
3. **B3(release/api)は F3/v3-write より前** ― admin ロール必須化が未反映だと書込権限が緩い。
