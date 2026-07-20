# search-api（`services/api`）read-only 再編 — 呼出元照合と安全な移行計画

- 文書ID: LB-SEARCHAPI-READONLY-20260720
- 対象: 全UIリニューアル指示 §4.2 / §13 / §14（search-api を検索・閲覧専用へ）
- 前提の重要事実: **`services/api` は SSR 検索ポータルと admin-ui のバックエンド（`/api/v3/*` ほか）を兼ねた 4936 行のモノリス**。単純なルート削除は admin-ui/本番ポータルを壊すため不可（§20）。

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

## 4. 未実施（理由・影響・次作業）
- 1〜6 は上記の移行順序が必要。**ルート単純削除は admin-ui(取引先/担当者/条件/別名の編集)を破壊**するため、worker 移設＋切替ソーク＋SSR 実機確認を伴う段階作業として別 PR で行う。実機 SSR / E2E 環境が前提。
