# search-api（`services/api`）read-only 再編 — 呼出元照合と安全な移行計画

- 文書ID: LB-SEARCHAPI-READONLY-20260720
- 対象: 全UIリニューアル指示 §4.2 / §13 / §14（search-api を検索・閲覧専用へ）
- 前提の重要事実: **`services/api` は SSR 検索ポータルと admin-ui のバックエンド（`/api/v3/*` ほか）を兼ねた 4936 行のモノリス**。単純なルート削除は admin-ui/本番ポータルを壊すため不可（§20）。

## 0. 進捗サマリ（2026-07-20 現在・PR #424/#425 マージ済）

- ✅ **§12 機密フィルタ**: viewer に vendor 口座/反社/与信を返さない（JSON 一覧/詳細・CSV エクスポート・SSR vendor 詳細・統合検索 vendors 射影）。admin は全開示。
- ✅ **master 書込みの worker 移設 + flip**: staff role / vendors(住所口座 1:N) / conditions-links / aliases。staging で API13/13・worker13/13 PASS。本番反映済。
- ✅ **SSR ポータル read-only 化 + write ルート撤去**: staff role/vendors/conditions-links/aliases の write ルートを search-api から物理撤去、SSR 編集 UI を admin-ui へ導線化。
- ✅ **統合検索 namespace**: `/api/search/{works,vendors,contracts,conditions}`（core 4）。works は kind='own' 限定撤去で統合。
- ✅ **§14 dead code**: 無認証 shadowed SELECT* 重複ルート3件を撤去。
- ⏳ **残（別対応・非自明）**:
  1. **CSV 一括取込の撤去**: `POST /api/master/vendors/import-csv` と SSR `/imports/vendor` は現存。**admin-ui はこれを撤去せず search-api の `/imports/vendor` へ委譲している**（`VendorsPanel.tsx`）ため、単純撤去すると vendor CSV 取込が壊れる。→ **先に admin-ui/Data Maintenance へ CSV 取込 UI を新設する機能移設が必要**（read-only 化の厳密完了はここが最後）。
  2. **統合検索の補助 API**: `/api/search/{unified,facets,suggestions,data-quality}` は未実装。
  3. **v3 write**: admin-ui が現役依存（WorkGraphPanel/BillingTablePanel）＋設計上 Search が作品モデル所有のため据え置き。
  4. **本番稼働リビジョンの確定**: 二重デプロイの可能性あり。デプロイは release/* 経由でなく main → 本番サービス直接のため、release ブランチ差分では判定不可。稼働イメージタグで確認する。

## 1. write ルート呼出元照合（admin-ui `src/` 参照数）

| ルート | admin-ui 参照 | 分類 | 方針 |
|---|---|---|---|
| `POST /api/master/vendors`(+import-csv/bulk-delete/orphans-attach) | **11** | admin-ui 依存(取引先の登録/編集/CSV) | **worker へ移設後**に search-api から撤去 |
| `POST /api/master/staff` / `PATCH .../:email/role`(+import-csv) | **6** | admin-ui 依存(担当者 登録/役割) | **worker へ移設後**に撤去 |
| `PUT /api/conditions/:id/links` / `auto-link` / `auto-status` | 6(内 write) | admin-ui 依存(条件リンク更新) | Command Service(worker/文書フォーム)へ移設後に撤去 |
| `POST /api/works/:id/aliases` / `DELETE /api/work-aliases/:id` | 2 / 1 | admin-ui 依存(別名編集) | worker へ移設後に撤去 |
| `POST /api/imports/legalon-csv` | 0 | SSR ポータル専用(CSV取込) | SSR フォーム撤去＋ルート撤去（§4.2 CSV取込撤去） |
| `POST /api/attachment-upload` | 0 | SSR 専用(添付アップロード) | admin-ui 導線化 or 撤去 |
| `POST /api/portal/guides|categories|access …`(8本) | 0 | SSR 専用(ポータルCMS) | ポータル運用要否を確認のうえ admin-ui 集約 or 撤去 |
| `POST /api/payment-exports/assign|export` | 0 | SSR 専用(支払エクスポート=生成) | read-export 扱い。§4.2 対象外の可能性。要確認 |
| `POST /api/intake/create` | 0 | SSR 専用(intake) | 要確認 |
| `POST /api/contract-check/search|lookup-number` | 0 | **read(POST 検索)** | 撤去対象外（読み取り） |
| `POST /slack/commands/legal-search` | 0 | Slack | 対象外 |

## 2. 安全な移行順序（破壊的削除の前提）
1. **master 書込みの worker 移設**: `vendors` / `staff` / `work-aliases` / `conditions links` の write を worker(正規 Command)へ新設し、admin-ui の呼出先を `apiRoutingRules` で worker へ切替。**E2E で登録/編集/役割/別名/条件リンクが通ること**を確認。
2. 切替ソーク後、`services/api` から当該 write ルートを撤去。
3. **SSR ポータルの read-only 化**: `vendorMasterHtml`/`staffMasterHtml`/`adminCategoriesHtml`/`attachmentUploadHtml`/`legalonImportHtml`/`vendorImportHtml` 等の**書込みフォーム/ボタンを撤去**し「編集は admin-ui」へ導線化。SSR 実機で表示崩れ・権限を確認。
4. `/api/imports/legalon-csv`・`/api/attachment-upload`・SSR CSV 取込・強制削除の撤去。
5. **統合検索/Projection 新設**（§13）: `/api/search/{unified,works,vendors,contracts,conditions,...}` ＋ `search_*_projection`（VIEW or materialized）。
6. **機密フィルタ**（§12）: vendor 口座/反社/与信を role 別に HTML/JSON/CSV/Projection 全経路で除外。

## 3. 本セッションで実施済み（安全・検証済み）
- **§13 作品検索の統合化**: `GET /api/v3/works/search` の `kind='own'` 限定を撤去（`?kind=` 後方互換・`kind` 列追加）。SSR 作品ポータル・admin-ui 作品検索が統合 works を横断。api tsc=0。
- **§12 機密フィルタ（JSON/CSV 経路・vendor）**: `GET /api/master/vendors`(一覧/詳細) と CSV エクスポートで viewer に口座/反社/与信(rating)を返さない。`redactVendor`/`redactVendors`/`VENDOR_SENSITIVE_FIELDS` を追加し `resolveAppRole` で role 判定。admin(portal_secret) は全開示のため admin-ui 編集は不変。staging で viewer/admin を検証（`x-staging-role`）。
- **staging 検証環境**: 本番クローン DB(`legalbridge-db-staging`) + `STAGING_DEV_AUTH=1`(IAP 二重防御) の `legalbridge-search-api-staging` を用意。`scripts/staging/verify.sh` で role 別に curl 検証。

### 重要な構造的発見（§3 SSR read-only の実体）
- **SSR ポータルに HTML の `<form method=post>` 書込みフォームは存在しない**（全 views で `<form>` は検索用 `method="get"` の1件のみ）。マスタの登録/編集/削除は全て **ブラウザ JS の `fetch()` → JSON write API** 経由。
- その JSON write API は既に `requireAppRole({allowedRoles:["admin"]})` で保護済み（**viewer は 403**）。
- 従って §3「SSR 書込みフォーム撤去」は HTML フォーム観点では**既に達成**。残るのは「viewer に編集アフォーダンス（保存/削除ボタン等）を描画しない」UX 整理のみで、これは API 層 403＋§12 read フィルタでバックストップ済み。
- `verify.sh` の SSR チェックは当初 `type=submit`（GET 検索ボタン）を誤検知していたため、`<form method=post>` のみを検出するよう精緻化した。

## 3.5 ステップ1 完了: master 書込みの worker 移設（staging 検証済み）
admin-ui が参照する master 書込みを worker へ移設し、`apiRoutingRules` を flip 済み。
staging worker(`legalbridge-document-worker-staging`, LB_PORTAL_SECRET 未設定で curl 検証)
＋ `scripts/staging/verify-worker.sh` で各ルートを実機検証(全 PASS)。

| ルート | worker 実装 | staging 検証 | flip |
|---|---|---|---|
| `PATCH /api/master/staff/:email/role` | 追加(app_role 更新+監査ログ) | 400/404/無変更200 | 済 |
| `POST /api/master/vendors` | 既存に住所/口座 1:N 追加(search-api パリティ) | upsert200+primary ミラー永続化 | 済 |
| `PUT /api/conditions/:id/links` | 追加(旧+新台帳二重UPDATE) | 不正400/存在せず200無変更 | 済 |
| `POST /api/works/:id/aliases` ・ `DELETE /api/work-aliases/:id` | 追加 | 欠落400/INSERT→DELETE round-trip | 済 |

- 認可: 全て `requirePortalSecret`(admin-ui BFF 経由の証明)。GET(閲覧)は search-api(read)維持。
- 反映条件: **admin-ui(BFF ホスト)の再ビルド・再デプロイ**で flip が有効化(本番は本ブランチ merge 後)。
- 据え置き: `sublicense/*`(admin-ui 参照0・SSR専用)、`v3/*`(作品モデル特殊)は search-api 維持。

## 3.6 ステップ5-a: 統合検索 namespace /api/search/*（staging 検証済み）
DB migration 非使用の**コードレベル projection**で新設(worker の migrate ジョブは
prod DB 固定のため staging 検証中は migration を追加しない安全設計):
- `GET /api/search/works`: 統合作品検索(own/licensed_in/external・kind 横断)。
  workModel の `worksSearchHandler` を `/api/v3/works/search` と共用(DRY)。
- `GET /api/search/vendors`: §12 安全射影。role に関わらず常に機密(口座/反社/与信)除外。
- `apiRoutingRules`: `/api/search/` を READ_PATHS_ON_GET へ(search-api 専用 read)。
- staging verify.sh: works=200/kind、vendors=viewer/admin 両方で機密なし → 全 PASS。

未実施: `/api/search/{contracts,conditions,unified}` の追加、admin-ui/SSR からの本
namespace 消費(現状は基盤のみ・未消費)。search_*_projection の DB VIEW 化は本番反映
時(migration 追加が prod に安全に流せるタイミング)に検討。

## 4. 未実施（理由・影響・次作業）
- **ステップ2(search-api から write 撤去)**: ステップ1 の flip が本番 admin-ui に反映され、
  正常動作を **prod soak** で確認した後に、search-api 側の当該 write ルート
  (staff role / vendors / conditions links / aliases)を撤去する。soak 前の撤去は
  ロールバック余地を失うため不可。
- **sublicense/v3 の write**: SSR 専用/作品モデル特殊。read-only 化の要否を別途評価。
- 残りの 5〜6(統合検索/Projection・§12 Projection 経路)は実機検証を伴う段階作業として別途。
