# Phase H: source_ips / ledgers 物理撤去 計画（2026-07-19）

設計 v1.4 Phase H「旧API・旧ルート・不要コード物理削除」のうち、レガシー原作台帳
`source_ips` / `ledgers` の **物理 DROP に向けた参照台帳と撤去順序**。

## 前提（F5 照合の結論）

`source_ips` / `ledgers` → `works` の**データ移行は 0033/0076 で完了済み**（未移行 0 件、
[F5 照合記録](./f5-source-ips-ledgers-reconciliation-20260719.md)参照）。残るのは**コード参照を
新モデルへ寄せ切って表を DROP する**こと。両表とも read/write の生きた参照があり、盲目 DROP は
文書生成・財務読取りを壊す。**参照 0 を CI/実測で確認してから DROP** する。

## 参照台帳（2026-07-19 時点）

### `ledgers`
| 箇所 | 種別 | 用途 | 置換先 |
|---|---|---|---|
| `schemas/purchaseOrder.tsx`・`individualLicenseTerms.tsx`・`pubLicenseTerms.tsx` | R (GET `/api/master/ledgers`) | 文書フォームの原作選択 | works 一覧 API（`work_code`/`title`）へ差し替え |
| `schemas/*` (POST `/api/master/ledgers/:id/materials`) | W | 文書フォームからの素材作成 | work_materials 作成 API へ差し替え |
| `services/worker/src/lib/db.ts:223,343,488` | R | `ledger_code=work_code` JOIN・原作コード解決 | works 直読み |
| `services/api/src/routes/workModel.ts:749,766,2918` | R/W | 原作一覧の親・削除時 `DELETE FROM ledgers` | works へ集約（削除は works 側で完結） |
| `services/api/src/routes/entityMerge.ts:306-326` | W | 統合時に旧 ledgers 行を掃除 | works 統合に一本化（ledgers 掃除を撤去） |
| `src/pages/master/LedgersPanel.tsx`・`App.tsx:102` | R (UI) | 移行照合専用 read-only ビュー | works 詳細/一覧へ誘導後に撤去 |

### `source_ips`
| 箇所 | 種別 | 用途 | 置換先 |
|---|---|---|---|
| `services/api/src/services/receivableMapService.ts:150` | R (`LEFT JOIN source_ips`) | 債権マップの原作名 | `condition_lines.source_work_id → works.title` |
| `services/api/src/services/conditionsService.ts:251` | R | 条件読取りの原作名 | 同上 |
| `services/api/src/routes/workModel.ts:659` | R | 原作参照 | works 直読み |
| `services/api/src/services/vendorMasterService.ts:1221` | R (検索設定) | 検索対象カラム定義 | works へ差し替え |
| `condition_lines.source_ip_id` 列 | 列 | 旧原作 FK | `source_work_id` へ寄せ済み。列 DROP は最終段 |
| `contract_works.source_ip_id` FK | FK | 契約×原作 | works ベースへ移行 or contract_works 自体を撤去判断 |

## 撤去順序（安全スライス）

1. **H-1（本 doc）**: 参照台帳・順序・DROP 前提条件の確定。**← 現在ここ**
2. **H-2 readers（source_ips）**: 財務/条件サービスの `LEFT JOIN source_ips` を
   `source_work_id → works` へ差し替え。出力（原作名）を新旧照合して不変を確認。
3. **H-3 readers（ledgers）**: 文書フォームの原作選択 GET と worker db.ts JOIN を works へ。
   フォームの原作候補が不変であることを実機確認。
4. **H-4 writers（ledgers）**: 文書フォームの素材作成 POST を work_materials 化、
   entityMerge/workModel の `DELETE FROM ledgers` を撤去（works 側で完結）。
5. **H-5 UI**: `LedgersPanel` を撤去（`/master/ledgers` は DeprecatedRedirect 化）。
6. **H-6 DROP**: `contract_works.source_ip_id` / `condition_lines.source_ip_id` を DROP、
   `source_ips` / `ledgers` / `contract_works`（残れば）を DROP。**前提: 参照 0 を CI ゲートで固定**。

## DROP 前提条件（Definition of Done）

- `grep -r "source_ips\|FROM ledgers\|JOIN ledgers\|api/master/ledgers" services src`（コメント除く）が **0 件**。
- CI に「`source_ips`/`ledgers` 参照 0」ゲートを追加（Phase 4 の `compat_view_refs --gate-writes 0` と同型）。
- 文書生成（発注書/個別・出版利用許諾）・債権マップ・条件読取りの E2E スモークが緑。
- ロールバック: DROP は最終 migration 1 本（`DROP TABLE ... CASCADE`）。前段は各スライスで可逆。

## H-3 精査で判明した id フロー（重要）

`ledgers` 撤去は「原作選択＋素材作成フロー」の載せ替えで、id 意味論が層ごとに食い違う:

- **保存層は works ベース(健全)**: `documents.ledger_ref_id` の FK は `works(id)`。実データ照合で
  該当 5 文書すべて works.id に解決(ledgers.id には 0)。`documentSave.ts:286` が
  `ledger_ref_id = input.ledger_ref_id ?? origWorkId`(origWorkId = `ledger_code`=`work_code` から
  解決した works.id)で保存。
- **一方 GET `/api/master/ledgers` は `id = ledgers.id` を返し**、POST `.../:id/materials` と
  DELETE `.../:id` は `:id` を **ledgers.id** として解決する(`addMaterialToLedger` / `DELETE FROM ledgers`)。
- つまり **表示・素材作成 API は ledgers.id キー / 保存は works.id キー**で混在。載せ替えは
  GET の id を works.id に統一し、POST/DELETE/merge を works/work_materials へ切り替える必要がある。

### H-3 の段階化（本番フォーム直結のため分割）

- **H-3a(完了・本 PR)**: works 正準化。ledgers 固有の原作メタ(title_kana/creator_name/
  publisher_name/division/alternative_titles)を works へ追加＋backfill(`0142`)。読み書き経路は不変＝
  リスクゼロ。後続の GET 載せ替えで shape 互換を保つ土台。
- **H-3b(要・専用対応)**: GET `/api/master/ledgers` の list を works(licensed_in) 由来へ、
  `id = works.id` に統一。LedgersPanel/フォームの原作候補が不変であることを実機確認。
- **H-4(要・専用対応)**: POST `.../:id/materials`・DELETE・entityMerge/workModel の
  `DELETE FROM ledgers` を works.id/work_materials へ。**発注書・個別/出版利用許諾の原作選択と
  素材作成を実機 E2E で検証**してからマージ。

> H-3b/H-4 は 5 文書のみが対象で、本番の法務文書生成に直結する。専用セッションで
> ドキュメントフォームの E2E(原作選択→素材追加→PDF 生成)を通してから実施すること。

## リスクと方針

- 文書フォームの原作選択・素材作成は**現行運用で使用中**。H-3/H-4 は各スライスで新旧照合＋実機確認を必須とする。
- 各スライス着手時に**ライブ `information_schema` でカラム実在を確認**してから SQL/クエリを書く
  （F2〜F4 で旧列参照ズレの事故があったため、参照列は必ず現物確認）。
