# 課題コントロール整合性改修 計画書

ステータス: **Phase 0/1/2/3-A4 実装済・本番監査実行済（残: A2/A3/A6 補修 ＝ §8 F1〜F6）** / 2026-06-24 起票・同日合意・同日実装＆レビュー
関連: [`condition_lines_unification_design.md`](../condition_lines_unification_design.md)（概念設計・第10章 課題詳細）/ [`condition_lines_implementation_plan.md`](../condition_lines_implementation_plan.md)（Phase A〜G 実行計画）

---

## 1. 背景・目的

### 1.1 課題サイクルは「1フェイズ＝1課題」の2フェイズ構成

課題(Backlog issue)は **1フェイズ＝1課題**で、各課題は `文書作成依頼 → 文書作成 → 作成内容のDB格納` で**終結する（＝正常終結）**。1本の取引は2フェイズで構成される:

```
【締結フェイズ】     起票(文書作成依頼) → 発注書 / 利用許諾条件書 の作成 → DB格納 …課題A 終結
        │  ここで condition_lines（条件明細）が生成される
        ▼
【支払準備フェイズ】 起票(納品報告 / 利用報告) → 検収書 / 計算書 の作成 → DB格納 …課題B 終結
        │  ここで condition_events（実績）が記録される。支払準備フェイズは取引が続く限り N 回繰り返す
        ▼
        （ロイヤリティ等は支払準備フェイズが期間中くり返し発生）
```

**重要**: 1本の **条件明細 `condition_lines` が複数の課題をまたぐ背骨**になる（締結フェイズ1課題 ＋ 支払準備フェイズ N課題）。課題は短命（フェイズ完了で終結）、条件明細は取引の寿命まで生き続ける。

### 1.2 条件明細の「完了条件」は支払方法で決まる

| 支払方法 | 種別 | 完了条件 |
|---|---|---|
| 固定費 | 消化型 (`lump_sum`/`per_unit`/`installment`) | 1回の支払で完了。分納予定 or 結果的分納の場合は**完済まで**（`consumed_amount ≥ amount_ex_tax`） |
| ロイヤリティ | 継続型 (`subscription`/`royalty`) | **時限式**。期間満了（`term_end` 経過）で完了。更新したら期間延長（`term_end` 延伸） |

この判定は既存の導出ビュー `condition_line_status_v`（[`0066_status_v_remaining_depletable_only.sql`](../../migrations/0066_status_v_remaining_depletable_only.sql)）に既に実装済み（消化型は consumed≥amount で `fulfilled`、継続型は term ベースで `active`/`expired`）。**新たな状態機械は作らず、このビューを正準として課題コントロールに供給する。**

### 1.3 本計画の目的

上記サイクルを **条件明細 `condition_lines`(状態を持つ唯一の中心)** ＋ **実績 `condition_events`(真実の源)** で串刺しに整合させるのが設計の骨子。本計画は「**それが本当に実現できているかの確認(監査)と、ズレている箇所の修正**」と「**リクエスト画面での課題の終結・統合の管理**」を、串刺しで整える改修の全体計画である。

なお課題の**終結には2種類**ある — ①**正常終結**（フェイズの文書がDB格納され役目を終えた）と ②**統合終結**（重複/誤起票を別課題へ merge）。両者を混同せず扱う。

ゴール:
- G1. 課題 → 文書 → 条件明細 → 実績 の紐づけが一意・無矛盾であることを **データで検証でき、ズレを検出・是正できる**。特に **1条件明細：N課題（締結1＋支払準備N）** の対応が正しく辿れること。
- G2. 課題の **正常終結・統合終結**操作が、文書・条件明細・実績・Backlog を**捻れなく**一括で動かす（取り残し・半端状態を作らない）。
- G3. **条件明細を背骨に**「この取引が2フェイズ循環のどこまで進んだか」「完了条件まであと何が必要か（未発行ghost行＝次に出すべき文書）」が一望できる。固定費は残額/分納残、ロイヤリティは期間/更新まで可視化。

---

## 2. 現状の接続マップ（裏取り済み）

課題への紐づけが **「文字列キー」と「FK」で混在**しているのが弱点の根。

```
documents.issue_key (NOT NULL, 文字列) ───────────┐
contract_capabilities.backlog_issue_key (文字列) ─┼─ 課題への紐づけが文字列一致
condition_events.backlog_issue_key (文字列) ──────┘
                                          │ FK: condition_line_id
condition_lines ── backlog_issue_key 列は無い（課題へは capability_id 経由の間接参照のみ）
   │ FK: capability_id → contract_capabilities
   │ FK: id ← condition_events.condition_line_id
   └ condition_events.document_id → documents（検収書/計算書を実績として結合）
```

検証根拠:
- `condition_lines` 本体定義: [`migrations/0063_condition_lines_unification.sql`](../../migrations/0063_condition_lines_unification.sql) — `backlog_issue_key` 列は **無し**（`backlog_issue_key` は `condition_events` 側 L148 のみ）。
- 状態・残高ビュー: `condition_line_status_v`（0063 → 0066 で remaining を消化型限定）、`condition_line_balance_v`（[`0065_balance_v_from_events.sql`](../../migrations/0065_balance_v_from_events.sql)、MG/AG を events から導出）。
- 文書種別(template_type)と循環段階の対応: 発注書 `purchase_order`/`intl_purchase_order`、利用許諾条件書 `individual_license_terms`/`pub_license_terms`、検収書 `inspection_certificate`、計算書 `royalty_statement`(旧 `license_calculation_sheet`)。納品/利用報告は `delivery_events`/`royalty_calculations`（文書なし実績）。

---

## 3. 確認できた整合性の穴

### 3.1 コードで裏取り済み

| # | 穴 | 箇所 | 影響 |
|---|----|------|------|
| H1 | **統合(merge)で文書が取り残される**。文書付け替えは「統合先に同一 template_type が無い場合のみ」だが、`contract_capabilities` は無条件全件付け替え | [`services/worker/server.ts:3158-3166`](../../services/worker/server.ts) | 「文書は source・その capability は target」の捻れ。スキップ件数は黙殺 |
| H2 | **merge がトランザクション化されていない**。documents/capabilities/condition_events/legal_requests/issue_workflows/Backlog操作 が個別 try-catch | [`services/worker/server.ts:3155-3202`](../../services/worker/server.ts) | 途中失敗で「DBは統合済・Backlogは未変更」等の半端状態。warnings に積むだけ |
| H3 | **condition_lines が課題キーを直接持たない**。merge 付け替え対象も condition_events のみ | [`server.ts:3167`](../../services/worker/server.ts) / 0063 スキーマ | 1条件明細：N課題（締結1＋支払準備N）モデルでは、明細に単一 issue_key を持たせる方が誤り。**締結フェイズ課題＝capability 経由、支払準備フェイズ課題＝各 condition_events.backlog_issue_key** で持つ現設計は本質的に正しい。問題は H1 の捻れで capability 経由の締結帰属が壊れる点に限定される |
| H4 | **終結/統合APIが3系統に分散**。`PATCH /terminate`・`POST /:key/merge`・`POST /merge-bulk` で挙動が微妙に異なる | `server.ts:3021,3219,3243` / FE: WorkflowPanel・IssueDetailPage・RequestsPage | 仕様のばらつき・保守コスト。`is_primary`/`lifecycle_status` の二重条件も未統一 |
| H5 | **課題詳細が「文書一覧」止まり**。条件明細は `line_code` リンクのみ、進捗・残高・未発行ghost行なし | [`IssueDetailPage.tsx:40-42,661`](../../src/pages/IssueDetailPage.tsx) | 課題が循環のどこまで進んだか一望不可。G3 未達 |

### 3.2 実DB監査で要確認（Phase 0 で確定させる仮説）

- A1. `documents.issue_key` ≠ その文書の `capability.backlog_issue_key`（H1 起因の捻れ実数）。
- A2. `final` かつ条件明細を生むはずの文書(発注書/条件書)で `line_code` を持たない＝condition_lines 未生成のもの。
- A3. `condition_events` を1件も持たない検収書/計算書（document あり・event なし＝結合漏れ）。
- A4. `payment_scheme` 別の condition_lines 件数と、`transaction_kind`/`counterparty_vendor_id` NULL 残（分類未完）。
- A5. `merged_into_issue_key` が立っているのに source 側に `final` 文書が残る課題（統合の取り残し）。
- A6. `is_primary=FALSE AND lifecycle_status='final'` の古い正本（重複計上の温床）。
- A7. publication 系(`pub_license_terms`)で condition_lines が生成されているか。
- A8. **フェイズ整合**: 締結フェイズが終結（条件書/発注書がDB格納）しているのに `condition_lines` が未生成の課題＝締結フェイズが空振りした課題。
- A9. **支払準備の取りこぼし**: 未完了の条件明細（消化型で `remaining>0` / 継続型で `term_end` 未到来）なのに、当期に対応する支払準備フェイズ課題も実績 `condition_events` も存在しない＝循環が途中で止まった取引。
- A10. **完了済みなのに開いている**: 条件明細が完了条件を満たす（消化型 `consumed≥amount` / 継続型 `term_end` 経過）のに、紐づく課題が未終結のまま残っている。

---

## 4. 改修方針（設計判断）

1. **課題への正準キーは「文字列 issue_key」を当面維持**（Backlog が source of truth、全面 FK 化は大改修のため非ゴール）。ただし **condition_lines も移行に追従できるよう、merge は capability 単位で原子的に動かす**。
2. **merge / terminate を単一の原子オペレーションに統一**。1トランザクション内で「文書・capability・condition_lines(capability経由)・condition_events・legal_requests・issue_workflows」を整合させ、Backlog 操作は **DB コミット後に best-effort + 失敗をユーザーに明示**（DB はロールバック可能、外部APIは補償ログ）。
3. **取り残しを作らない**: 統合先に同種文書が既存の場合も **source の文書を target へ移送し、重複する旧版を `superseded`(差し替え済み)化する**【O1 決定】。課題に文書を残さず追跡を一元化する。結果レポートにドキュメント単位（moved / superseded）で列挙。
4. **進捗は条件明細単位**の原則は維持（設計第10章）。課題詳細はその**サマリービュー**を埋め込む（Stage2 を IssueDetailPage に薄く統合）。導出は既存 `condition_line_status_v`/`balance_v` を再利用、スナップショット列は読まない。
5. **監査は読み取り専用**で先行。スキーマ変更を伴わない SQL ＋ 管理画面で実態を可視化してから是正する。

---

## 5. Phase 計画

依存順。各 Phase は独立リリース可能な粒度。

### Phase 0 — 整合性監査（読み取り専用・スキーマ変更なし）★最初に着手 — **実装済 (2026-06-24, codex/issue-consistency-audit → main)**
- [x] 0-1. 監査 SQL 一式を `scripts/audit/issue_consistency_audit.sql` に作成（A1〜A7 を各クエリ化、件数＋サンプルID）。
- [x] 0-2. 専用 `GET /api/audit/issue-consistency`（worker `services/worker/src/routes/dataLinkage.ts`）を read-only で新設【O4 決定: worker 集約・search-api 非実装】。
- [x] 0-3. 管理画面 `src/pages/DataLinkagePanel.tsx` に「課題コントロール監査」カード（件数バッジ＋ドリルダウン）。
- [x] 0-4. 本番DBで実行し実数確定（下記 §8）。**残: A8〜A10（status_v ベースのフェイズ取りこぼし）は監査 SQL/API 未収録 → フォローアップ**。
- リスク: 低（参照のみ）。

### Phase 1 — 統合/終結の整合性修正（H1・H2・H3・H4）— **実装済**
- [x] 1-1. `mergeIssueInto` を**単一トランザクション化**（`pool.connect()`＋BEGIN/COMMIT/ROLLBACK, server.ts:3105-）。
- [x] 1-2. 取り残し対策【O1: 移送+superseded】: 全 source 文書を target へ移送し、target 側 final を template_type 単位で `created_at DESC` ランク→最新のみ primary/final・他を `superseded`＋`superseded_by` ポインタ。`document_report`(moved/primary/superseded) を返却。**正本規則=最新 created_at**【O6 決定】。
- [x] 1-3. capability の `backlog_issue_key` を移送＝配下 condition_lines は capability 経由で追従（O5 据え置きどおり）。capability の primary/lifecycle も文書に同期。
- [x] 1-4. Backlog 操作を**コミット後**に best-effort 化、失敗は warnings に集約。
- [x] 1-5. 課題終了API を統合処理へ寄せ、終了/統合の挙動を統一（remediation 記録）。
- [x] 1-6. 既存捻れの補修 `scripts/audit/repair_issue_merge_consistency.sql`（全課題スキャン, O3）。A5/A1 は本番 0 件に是正済。
- リスク: 中（破壊的操作だがトランザクション＋レポートで担保）。

### Phase 2 — 課題詳細を循環ビューに（H5・G3）— **実装済**
- [x] 2-1. `GET /api/issues/:issueKey/condition-line-summary`（server.ts:11941-）。締結(capability経由)＋支払準備(condition_events.backlog_issue_key)を UNION 集約、`status_v`/`balance_v` 使用、`next_template_type`(完了→無/消化型→検収書/継続型→計算書)、`related_issue_keys`、`recent_events`、スキーマ未適用フォールバック。
- [x] 2-2. IssueDetailPage「SEC·01 取引循環進捗」セクション（段階レーン 締結→納品→利用→検収→計算 ＋ 明細別進捗、O2 どおり）。
- [x] 2-3. 未発行ghost行＝`next_template_type` で次文書導線、完了明細は除外。
- [x] 2-4. `is_primary=TRUE AND lifecycle_status='final'` 二重条件化。
- [x] 2-5. フェイズバッジ(contracting/payment/mixed)＋兄弟課題リンク。
- リスク: 低〜中（読み取り中心）。

### Phase 3 — 仕上げ・分類補完（任意・優先度低）— **A4 実装済 / 残あり**
- [x] 3-1. `transaction_kind`/`counterparty_vendor_id` の NULL 補完（`scripts/audit/backfill_condition_line_classification.sql` ＋ worker 修復API `backfill_condition_line_classification`）。本番 0 件に補正済。
- [ ] 3-2. publication 系条件書の condition_lines 生成経路の確認・是正（A7）。**本番 A7=0 だが生成経路の恒久確認は残**。
- [ ] 3-3. 監査パネルを定常運用化（CI/定期ジョブで件数を監視）。

---

## 8. 実施状況と本番監査結果（2026-06-24, レビュー: Claude）

Codex により Phase 0/1/2/3-A4 を実装し `codex/issue-consistency-audit`→main へマージ済（PR #189/#190 系）。worker は `release/worker` でデプロイ済。**コードレビュー結果: 計画・決定（O1〜O6）に整合。マージ原子化・superseded化・2フェイズサマリ・監査いずれも設計どおりで、`superseded_by` 列も実在（baseline 543/563）でマージは安全。**

### 本番監査の最終結果（`2026-06-24T09:36Z`）
| 監査項目 | 件数 | 状態 |
|---|---|---|
| `issue_capability_mismatch` (A1) | 0 | ✅ 是正済 |
| `condition_line_classification_missing` (A4) | 0 | ✅ 是正済 |
| `merged_source_final_documents` (A5) | 0 | ✅ 是正済 |
| `pub_license_terms_without_lines` (A7) | 0 | ✅ |
| `final_contract_docs_without_lines` (A2) | **16** | ⚠️ 残: 締結フェイズで明細未生成 |
| `payment_docs_without_events` (A3) | **35** | ⚠️ 残: 検収/計算書あるのにイベント未結合 |
| `non_primary_final_records` (A6) | **40** | ⚠️ 残: is_primary=false なのに final |

### レビューで挙がったフォローアップ
- **F1 (最優先) — コード実装済・本番適用待ち (2026-06-25)**: A2=16 の補修。**正準生成経路 `syncConditionLinesForCapability` を再利用**する修復アクション `backfill_contract_condition_lines` を `dataLinkage.ts` に追加。`dry_run` 既定 true（同一トランザクションで生成→ROLLBACK＝本番無変更の正確なプレビュー）、`dry_run:false` で COMMIT。`final_contract_docs_without_lines` チェックに `repair_action` 設定。`DataLinkagePanel` 監査カードに preview→確認→apply ボタン追加。3分類で報告: ①regenerated（capability配下の明細から復元）②skipped_no_capability（capability未連結=要手動連結）③skipped_empty_source（明細が form_data のみ＝form_data 再構成が必要な別系統）。
  - **本番適用手順**: ① worker を `release/worker` へ反映しデプロイ → ② `POST /api/admin/data-linkage/repair {action:"backfill_contract_condition_lines", dry_run:true}` でプレビュー（または監査カードのボタン）→ ③ 件数確認後 `dry_run:false` で適用 → ④ 監査再実行で A2 件数の減少を確認。**①②③は冪等**（再実行しても二重生成しない）。
  - **注意**: `skipped_empty_source`（capability に line_items/financial_conditions が無く form_data にしか明細が無い文書）は本アクションでは復元不可。残数があれば form_data 再構成の別フォロー（F1b）を立てる。SQL 単体修復は TS マッパーロジックの二重化＝ドリフトを招くため**作らない**方針。
- **F2 — コード実装済・本番適用待ち (2026-06-25)**: A3=35 の補修。**正準同期 `syncInspectionEventsForDelivery`(検収)＋`syncRoyaltyCalcEvent`(計算書)を再利用**した統合修復アクション `backfill_payment_condition_events` を `dataLinkage.ts` に追加。検収側は既存 `/api/admin/resync-inspection-events` 相当を内包し、**従来欠けていた計算書(royalty)側の一括復元を新規追加**(従来 `syncRoyaltyCalcEvent` は文書保存時のみ)。`dry_run` 既定 true（tx内生成→ROLLBACK）。`payment_docs_without_events` チェックに `repair_action` 設定、監査カードに preview→apply ボタン（F1 と共通の汎用プレビュー）。
  - **依存**: 両 sync は **condition_lines が前提**（`cl.source_line_item_id`/`source_condition_id` で解決できないと skip）。よって **F1(A2)を先に適用**してから F2 を実行する。
  - **本番適用手順**: F1 適用済を前提に、監査カードの「支払実績を復元」ボタン or `POST /api/admin/data-linkage/repair {action:"backfill_payment_condition_events", dry_run:true}` でプレビュー → `dry_run:false` で適用 → 監査再実行で A3 減少を確認。冪等。
  - **残**: 計算書の form_data に `capabilityFinancialConditionId`/`manufacturingEventId` が無い等で文書解決できないものは sync が skip し A3 に残る。残数が出たら個別調査（F2b）。
- **F3**: A6=40 の整理。superseded 化できるものと正本判定見直しを分離。
- **F4**: 監査 SQL/API に **A8〜A10**（status_v ベース: 未完了明細の支払準備取りこぼし／完了済みなのに課題未終結）を追加。
- **F5 (ドキュメント)**: 実施記録 `docs/design/issue-control-consistency-remediation-record.md` が **main に未収録**（ブランチのみ）。main へ復元する。
- **F6 (運用)**: admin-ui/frontend の main 反映は済だが **Cloud Run 再デプロイと画面スモーク未確認**（課題詳細の進捗表示・監査カード・修復ボタン冪等）。

---

## 6. 決定事項ログ

- **O1【決定】移送+superseded** — 文書取り残し衝突時は source 文書を target へ移送し、重複旧版を `superseded` 化（1-2）。
- **O2【決定】条件明細ベース主＋段階レーン併記** — 課題詳細の循環進捗は条件明細を背骨にした2フェイズ進捗＋完了条件を主とし、上部に段階レーン(締結→納品→利用→検収→計算)の俯瞰を併記（2-2）。
- **O3【決定】全課題スキャン** — merge 補修スクリプト(1-6)は merged 済に限定せず全課題を対象に捻れ・取り残しを是正。
- **O5【決定】据え置き** — condition_lines への issue_key 直列化は不要（1明細：N課題モデルでは誤り。締結=capability経由／支払準備=condition_events の現設計を維持）。残課題は H1 起因の締結帰属の捻れ是正のみ（Phase 1）。

### 残オープン事項（実装着手時に詰める・ブロッカーではない）
- O4. 監査 API を worker 既存レポートに相乗りさせるか、専用エンドポイント新設か（0-2）。→ Phase 0 着手時に決定。
- O6. superseded 化の「正本選択規則」（新しい created_at を正本とする等）の確定（1-2）。

---

## 7. 着手順サマリ

**Phase 0(監査) → Phase 1(統合/終結修正) → Phase 2(課題詳細の循環ビュー) → Phase 3(仕上げ)**。
Phase 0 の実数次第で Phase 1/2 の優先と範囲を確定する。
