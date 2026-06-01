# 実装進捗ログ ― 作品中心スキーマ + サービス分離

> 設計: `schema-redesign-proposal.md`(データ構造)/ `service-architecture.md`(サービス役割分担)。
> 本書は**実装・デプロイの完了状況**を記録する。全コードは一時 PostgreSQL 16 で検証してからコミット。

最終更新: ブランチ `claude/game-company-schema-design-HSNYB`(PR #2 マージ済 → main 反映)。

---

## 1. マイグレーション基盤(Phase 0 / D2)
- `migrations/run.mjs`: 順序付き `NNNN_*.sql` を `schema_migrations` 追跡で**冪等適用**(1ファイル=1トランザクション、checksum、`--dry-run`)。
- `migrations/0001_baseline.sql`: 現行スキーマを worker `initDb` から**自動抽出**(`scripts/extract-baseline.mjs`、CREATE TABLE 先頭ソートで fresh DB 安全)。
- `migrations/roles.template.sql`: `lb_migrate`/`lb_search`/`lb_worker` ロール雛形。
- `migrations/Dockerfile` + `cloudbuild-migrate.yaml`: Cloud Run Job として実行。
- worker `server.ts`: 起動時 `initDb` を `RUN_INIT_DB` で制御(段階移行・可逆)。
- 手順書: `docs/phase0-deploy-runbook.md`。

## 2. マイグレーション一覧(0001–0011)
| # | 内容 | 種別 |
| :--- | :--- | :--- |
| 0001 | baseline(現行スキーマ) | 基盤 |
| 0002 | `document_templates` / `document_template_versions` + `documents.template_version_id` | 新テーブル |
| 0003 | 既存テンプレ(config + HTML + partials)を version1 で投入(`scripts/seed-templates.mjs` 生成) | seed |
| 0004 | 作品/IPマスター(works / source_ips / source_ip_materials / products / ip_registrations / expense_categories / party_roles + vendors.related_party) | 新テーブル |
| 0005 | 契約層(contracts / contract_works / parties / financial_terms / line_items / obligations / stage_history / signature_* / master_sequences / ringi_works) | 新テーブル |
| 0006 | 財務・成果物(payments / invoices / royalty_statements / sales_events / deliverables / work_materials / alerts) | 新テーブル |
| 0008 | backfill: contract_capabilities → contracts / financial_terms / line_items(id保存) | backfill |
| 0009 | backfill: royalty_calculations → royalty_statements | backfill |
| 0010 | backfill: ledgers→source_ips / materials→source_ip_materials / contract_works / contract_parties | backfill |
| 0011 | backfill: royalty_payments → payments(snapshot、contract_id 導出、暫定 department) | backfill |
| 0012 | **同期トリガ**: old(contract_capabilities / capability_* / royalty_*)→ 新スキーマへ AFTER INSERT/UPDATE で自動ミラー(C5 の狙いを worker 無改修で達成)+ Search serial の id 高レンジ分離 | トリガ |
| 0013 | **GRANT**: migrate を postgres で流すと新テーブルが postgres 所有になりアプリロール `legalbridge` に権限が無い(F1 で permission denied)。postgres 所有テーブル/シーケンスを legalbridge へ付与 + `ALTER DEFAULT PRIVILEGES` で今後分も自動付与。冪等 | 権限 |

> 全 backfill は **id保存・冪等・FK整合**。0007(互換ビュー)は旧テーブル名の読取置換用に予約。

## 3. テンプレ DB 化 + レンダリング分離(Phase 1 / C3 / B2 / B5 / B5b)
- **A1/A2**: テンプレを DB 化(0002/0003)。`templates_config.json` + `services/worker/templates/*.html` + partials を忠実移植(byte一致検証済)。
- **C3**: worker 文書生成を DB テンプレ取得に対応(`TEMPLATE_SOURCE=db`、既定 disk=可逆)。
- **B2**: search-api テンプレ list を DB 直読(`TEMPLATE_SOURCE=db`)。
- **B5**: 共有レンダリング `shared/rendering/render.mjs`(helper/日付展開/render)を切出し、worker を接続(`scripts/sync-shared.mjs` で両サービスへ同期)。
- **B5b**: search-api が html プレビューをローカル生成(worker proxy 撤去)。PDF は Chromium 同梱(infra)まで proxy 継続。

## 4. サービス分離(Phase 2)
- **C2 完了**: admin-ui が search-api から取得していた read **計24本を worker に補完**(`services/worker/src/routes/sharedReads.ts` + `formReadRoutes.ts`)。master/* / backlog/* / management/* / dashboard/stats / contract-check/purposes / legalon。form-context(710行)は `scripts/extract-form-routes.mjs` で **byte-exact 抽出**。
- **C1**: admin-ui の read を worker へ寄せる切替フラグ `VITE_API_READS_TO_WORKER`(既定OFF=可逆)。マスター書込は D1 どおり Search 維持。

## 5. 新モデル read/write API + 最小フロント
- **read API**(`services/api/src/routes/workModel.ts`, `/api/v3/*`): source-ips / works / contracts(作品軸の詳細・集計)。
- **write API**(同): `POST /api/v3/source-ips` / `works` / `contracts`。`master_sequences` 採番(IP-/W-/ARC-REG- 、worker と番号空間分離)、IAP ゲート。
- **B1 最小フロント**(`src/pages/WorkModelPage.tsx` + route + Sidebar): `/api/v3` を読む新モデル閲覧(admin-ui 内 seed。後で Search 専用フロントへ切出し)。

## 6. デプロイ状況
| サービス | ブランチ | 反映 |
| :--- | :--- | :--- |
| document-worker | `release/worker` | initDb ゲート / C3 / B5 / C2 read(フラグOFF=挙動不変) |
| search-api | `release/api` | B2 / B5b / `/api/v3` read+write |
| admin-ui | `main` | C1 フラグ / `/work-model` ページ |

- **フラグは全て既定OFF=現行挙動**で安全にデプロイ済み。
- **migrate Job**(`cloudbuild-migrate.yaml`)で 0001–0011 を適用 → 新スキーマ作成 + old データ backfill(additive・冪等)。

### 制御フラグ(切替で機能ON・可逆)
| フラグ | サービス | ON の効果 |
| :--- | :--- | :--- |
| `RUN_INIT_DB=false` | worker | 起動時 initDb 停止(migrate Job が schema 所有) |
| `TEMPLATE_SOURCE=db` | worker / search-api | テンプレを DB 読取(C3/B2/B5b 有効化) |
| `VITE_API_READS_TO_WORKER=1` | admin-ui(ビルド時) | read を worker へ(C1) |

---

## 7. 残作業
- ~~**C5**(worker 書込先差替)~~ → **0012 同期トリガで達成**(worker 無改修・SQL のみ・検証済)。worker が old に書くと新スキーマへ自動追従。
- **0007 互換ビュー**: 旧テーブル名を読取専用ビュー化(残存 reader 用。トリガ方式では旧テーブルは実体のまま残るため優先度低)。
- **works への work_id 紐付け**: backfill は source_ip 中心のため、`__migrated_royalty__` payments 等の work 再分類は運用で実施。
- ~~**B3 admin ロール厳格化**~~ → 完了(`/api/v3` write を admin ロール必須化、commit `0211390`。`release/api` 反映待ち)。
- **B1 専用フロント分離 / B5b PDF ローカル化(Chromium)**(infra 同梱が必要・サンドボックス検証不可。段階ON完了後の次候補)。
- **運用メモ**: F0 適用時に使った Cloud SQL `postgres` パスワードはチャット履歴に露出したため**ローテーション推奨**(`gcloud sql users set-password postgres --instance=legalbridge-db ...`)。
- **フラグの段階 ON**: 手順整備済 → `docs/phase0-deploy-runbook.md`「フラグ段階ON 完全手順」(F0 migrate → F1/F2 worker → F3 search-api → F4 admin-ui)。各フラグ独立・可逆、ステップ毎にスモーク+即時ロールバックを明記。**実行は GCP 認証環境**(本サンドボックスは gcloud 不可)。
  - **F0 完了**(本番 Cloud SQL `legalbridge-488506:asia-northeast1:legalbridge-db`、Cloud Shell の `cloud-sql-proxy` + runner で適用): `schema_migrations` 0001–0012(11行)、`document_templates`=18、`contracts`=118 / `source_ips`=12 / `payments`=10(backfill)、`trg_sync_*` トリガ5本。`works`=0(source_ip 中心 backfill のため、自社作品は今後 `/api/v3` 登録)。
  - **B3 反映済**(`release/api`、commit `0211390`)。**worker(`release/worker` `ee59aee`)は F1/F2 前提コード(RUN_INIT_DB ゲート/C3/B5/C2)を保持** → env 切替のみで有効化可(再デプロイ不要)。
  - **0013 GRANT 追加**(F1 で判明): migrate を postgres で流すと新テーブルが postgres 所有になりアプリロール `legalbridge` が `permission denied`。postgres 所有を legalbridge へ付与 + DEFAULT PRIVILEGES。一時PG検証済 → 本番適用済。
  - **段階ON 全完了**(本番):
    - ✅ **F1** worker `TEMPLATE_SOURCE=db` — ログ `loaded templates from DB: 17 documents, 1 partials`(permission denied 解消)。
    - ✅ **F2** worker `RUN_INIT_DB=false` — ログ `⏭️ RUN_INIT_DB=false — skipping initDb`(schema は runner 単一所有)。
    - ✅ **F3** search-api `TEMPLATE_SOURCE=db` — クリーン起動、GRANT 済で permission denied なし。
    - ✅ **F4** admin-ui `VITE_API_READS_TO_WORKER=1`(`.env.production` commit → PR #3 マージで main 反映 → 自動再ビルド)。GET read を worker(C2 superset)へ、マスター書込は search-api 維持(D1)。
  - **可逆**: 各フラグ `--remove-env-vars`(F1/F2/F3)/ `.env.production` の `0` 化+再ビルド(F4)で即ロールバック。
