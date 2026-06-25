# 課題コントロール整合性改修 設計・実施記録

作成日: 2026-06-24  
対象ブランチ: `codex/issue-consistency-audit`  
worker反映ブランチ: `release/worker`  
対象リポジトリ: `tatsuyakuramchi/LegalBridge_AI_GCP`

## 目的

課題・契約文書・条件明細・実績イベントが別々のテーブルに分散していることで、課題終了/統合後に文書や進捗が取り残される問題を是正する。

主な対象は以下。

- 課題キーと契約能力レコードの不一致
- 統合済み課題に残る `final` 文書
- `condition_lines` の分類/取引先未補完
- 条件明細・実績イベントの未生成/未結合
- 課題詳細画面での取引循環進捗の可視化
- worker / admin-ui / search-api の反映範囲整理

## 実施済み変更

### 1. 整合性監査APIと監査SQL

追加/更新ファイル:

- `services/worker/src/routes/dataLinkage.ts`
- `src/lib/apiRouter.ts`
- `src/pages/DataLinkagePanel.tsx`
- `scripts/audit/issue_consistency_audit.sql`

実施内容:

- `/api/audit/issue-consistency` を追加。
- Admin UI のデータ連結チェック画面に「課題コントロール監査」カードを追加。
- A1/A4/A5/A7 など、課題・文書・条件明細・実績イベントの不整合を一覧化。
- `pub_license_terms` の `condition_lines` 生成カバレッジも監査対象へ追加。

代表コミット:

- `a331837 Add issue consistency audit`
- `dc6fc34 Add condition line classification backfill`

### 2. 課題統合/終了フローの原子化

更新ファイル:

- `services/worker/server.ts`
- `scripts/audit/repair_issue_merge_consistency.sql`

実施内容:

- `mergeIssueInto` のDB更新をトランザクション化。
- 統合元文書/契約能力/条件明細/イベントの移動を一括処理。
- 重複する正本文書は最新のみ `final/is_primary` とし、古いものを `superseded` 化。
- Backlog側操作はDB commit後のbest-effortに分離。
- 課題終了APIを同じ統合処理へ寄せ、終了/統合の挙動を統一。

代表コミット:

- `f627dac Make issue merge DB updates atomic`
- `513eebe Unify issue termination flow`

### 3. 課題詳細UIの取引循環進捗

更新ファイル:

- `services/worker/server.ts`
- `src/lib/apiRouter.ts`
- `src/pages/IssueDetailPage.tsx`

実施内容:

- `/api/issues/:issueKey/condition-line-summary` を追加。
- 課題詳細に取引循環進捗を表示。
- フェーズバッジ、関連課題リンク、最近イベント、次文書導線を追加。
- ステージレーンを `締結 → 納品 → 利用 → 検収 → 計算` として可視化。

代表コミット:

- `8708c17 Add issue condition line progress`
- `8895c21 Refine issue progress UI`

### 4. A4: 条件明細分類補完

追加/更新ファイル:

- `scripts/audit/backfill_condition_line_classification.sql`
- `services/worker/src/routes/dataLinkage.ts`
- `src/pages/DataLinkagePanel.tsx`

実施内容:

- `condition_lines.transaction_kind` と `condition_lines.counterparty_vendor_id` のNULL補完ロジックを追加。
- SQLはdry-run既定、`-v apply=1` で実適用。
- worker修復API `backfill_condition_line_classification` を追加し、DB直結なしでもAdmin UI/API経由で補正可能にした。
- 取引先補完は以下の順で安全に推定。
  - `contract_capabilities.vendor_id`
  - 親 `contract_capabilities.vendor_id`
  - `documents.form_data` / `legal_requests.counterparty` から `vendors.vendor_name` 完全一致

代表コミット:

- `2f42a96 Add condition line classification repair`
- `1382572 Use parent vendor for condition line backfill`
- `beb4dbc Show condition line classification details`
- `0818305 Use document counterparty for condition line backfill`

## 本番worker反映

workerは `release/worker` pushによりCloud Buildでデプロイされる。

実施済み:

- `dc6fc34` を `release/worker` へpushし、監査APIを本番workerへ反映。
- `c0c73e3 Trigger worker deploy` でCloud Buildを再トリガー。
- A4修復API系のコミットを順次 `release/worker` へ反映。
- 最終worker反映コミット: `de6232d Use document counterparty for condition line backfill`

確認済みエンドポイント:

- `GET https://legalbridge-document-worker-988056987352.asia-northeast1.run.app/api/status`
- `GET https://legalbridge-document-worker-988056987352.asia-northeast1.run.app/api/audit/issue-consistency`
- `POST https://legalbridge-document-worker-988056987352.asia-northeast1.run.app/api/admin/data-linkage/repair`

## 本番データ補正結果

### A4: 条件明細分類未完了

初回監査:

- `condition_line_classification_missing`: 12件
- 内訳:
  - `transaction_kind` NULL: 6件
  - `counterparty_vendor_id` NULL: 12件相当

補正1回目:

- 実行API: `backfill_condition_line_classification`
- affected: 14フィールド
- `transaction_kind`: 6件補完
- `counterparty_vendor_id`: 8件補完
- 残: 4件

補正2回目:

- 親capability vendor fallbackを追加したが、残4件は親vendorなし。
- 詳細監査で `capability_vendor_id` / `parent_vendor_id` ともNULLを確認。

補正3回目:

- `documents.form_data` / `legal_requests.counterparty` から `vendors.vendor_name` 完全一致fallbackを追加。
- affected: 4件
- 最終結果: `condition_line_classification_missing` 0件

最終監査日時:

- `2026-06-24T09:36:38.408Z`

### 最終監査結果サマリ

OKになった項目:

- `issue_capability_mismatch`: 0件
- `condition_line_classification_missing`: 0件
- `merged_source_final_documents`: 0件
- `pub_license_terms_without_lines`: 0件

残件:

- `final_contract_docs_without_lines`: 16件
- `payment_docs_without_events`: 35件
- `non_primary_final_records`: 40件

## デプロイ判断

### worker

必要。今回の監査API、課題詳細サマリAPI、修復APIはいずれもworker側に実装されている。

反映済み:

- `release/worker`

### admin-ui / frontend

必要。以下のUI変更が含まれる。

- 課題詳細画面の取引循環進捗
- データ連結チェック画面の課題コントロール監査
- 条件明細分類補完ボタンラベル

未完了:

- 最新featureブランチ内容のmain反映
- admin-ui Cloud Runへの再デプロイ確認

### search-api

基本不要。今回の変更は `services/api` には入っていない。

ただし、将来的にread endpointをsearch-apiへ戻す設計にする場合は別途移植が必要。現状は `apiRouter.ts` で該当GETをworkerへ寄せている。

## 残タスク

優先順:

1. `final_contract_docs_without_lines` 16件の補正
   - final/正本の発注書・条件書に `condition_lines` が無い。
   - `contract_capabilities` と `documents.form_data` から復元できるものを分類する。

2. `payment_docs_without_events` 35件の補正
   - 検収書/計算書があるのに `condition_events` が無い。
   - 検収・ロイヤリティ計算の既存生成情報からイベント復元ルールを作る。

3. `non_primary_final_records` 40件の整理
   - `is_primary=false` なのに `lifecycle_status=final` の旧版。
   - `superseded` 化できるものと、正本判定を見直すべきものを分離する。

4. main反映とadmin-uiデプロイ
   - `codex/issue-consistency-audit` の最新コミットをmainへ反映。
   - admin-ui Cloud Runデプロイ後に画面スモークを実施。

5. 本番スモーク
   - 課題詳細: 取引循環進捗表示
   - 監査画面: 課題コントロール監査表示
   - 修復ボタン: A4が0件のまま再実行しても冪等
   - 終了/統合: 文書・capability・condition系の取り残しなし

## 検証メモ

実施済み:

- `git diff --check`
- Cloud Run worker `/api/status`
- Cloud Run worker `/api/audit/issue-consistency`
- Cloud Run worker `/api/admin/data-linkage/repair`

未実施/制約:

- `npm run lint` はローカルnpm破損により未実行。
- ローカル環境では `DATABASE_URL` と `psql` が未設定。
- `gcloud sql instances list` はgcloud再認証が必要。

## 次の作業候補

次に進めるなら、`final_contract_docs_without_lines` 16件の詳細サンプル化と復元API追加が最も効果が大きい。

推奨手順:

1. 16件の詳細サンプルに `form_data` の主要キー、`capability_id`、`vendor_id`、`base_document_number` を追加。
2. capabilityが存在するものから `condition_lines` を復元。
3. capabilityが無いものは文書種別ごとに「復元可能/手動確認」を分ける。
4. worker修復APIにdry-run相当のpreviewを追加してからapplyする。

## 追補: F1 (A2=16 締結明細の復元) — 2026-06-25 実装

レビュー(Claude)で計画(`issue-control-consistency-plan.md` §8)に整合と確認後、最優先 F1 を実装。

更新ファイル:

- `services/worker/src/routes/dataLinkage.ts` — 修復アクション `backfill_contract_condition_lines` 追加。
- `src/pages/DataLinkagePanel.tsx` — 課題コントロール監査カードに preview→apply ボタン追加。

実施内容:

- **正準生成経路 `syncConditionLinesForCapability` を再利用**(独自生成ロジックを作らず、二重化/ドリフトを回避)。
- `dry_run` 既定 true: 同一トランザクションで生成→`ROLLBACK` し、本番DB無変更で生成行数を正確にプレビュー。`dry_run:false` で `COMMIT`。
- 冪等(`source_line_item_id`/`source_condition_id` の NOT EXISTS で二重生成しない)。
- 結果を3分類で報告: `regenerated`(復元) / `skipped_no_capability`(capability未連結=要手動連結) / `skipped_empty_source`(明細が form_data のみ=form_data 再構成が必要な別系統 F1b)。
- `final_contract_docs_without_lines` チェックに `repair_action` を設定。

本番適用手順(未実施):

1. worker を `release/worker` へ反映しデプロイ。
2. `POST /api/admin/data-linkage/repair {action:"backfill_contract_condition_lines", dry_run:true}` または監査カードのボタンでプレビュー。
3. 件数確認後 `dry_run:false` で適用。
4. `GET /api/audit/issue-consistency` を再実行し `final_contract_docs_without_lines` の減少を確認。
5. `skipped_empty_source` の残があれば F1b(form_data 再構成)を別途立案。

注: SQL 単体の復元スクリプトは TS マッパーの二重化=ドリフトを招くため作らない方針。

## 追補: F2 (A3=35 支払実績の復元) — 2026-06-25 実装

更新ファイル:

- `services/worker/src/routes/dataLinkage.ts` — 修復アクション `backfill_payment_condition_events` 追加。
- `src/pages/DataLinkagePanel.tsx` — 監査カードのプレビュー/ラベルを汎用化(F1/F2 共通)。

実施内容:

- **正準同期 `syncInspectionEventsForDelivery`(検収)＋ `syncRoyaltyCalcEvent`(計算書)を再利用**。
- 検収側は実績未生成だが condition_lines がある `delivery_events` を走査(既存 `/api/admin/resync-inspection-events` 相当を内包)。**従来欠けていた計算書(royalty)側の一括復元を新規追加**(従来は文書保存時のみ `syncRoyaltyCalcEvent` を呼んでいた)。
- `dry_run` 既定 true(tx内生成→ROLLBACK で件数プレビュー)、`dry_run:false` で COMMIT。冪等。
- 報告: `inspection_events` / `royalty_events` / `delivery_events_touched` / `royalty_calcs_touched`。
- `payment_docs_without_events` チェックに `repair_action` を設定。

依存・注意:

- 両 sync は **condition_lines が前提**。**F1(A2)を先に適用**してから F2 を実行する。
- 計算書 form_data に `capabilityFinancialConditionId`/`manufacturingEventId` 等が無く文書解決できないものは skip し A3 に残る → 残数が出たら F2b で個別調査。

本番適用手順(未実施): F1 適用後、監査カード「支払実績を復元」or `POST /api/admin/data-linkage/repair {action:"backfill_payment_condition_events", dry_run:true}` でプレビュー → `dry_run:false` 適用 → 監査再実行で A3 減少を確認。
