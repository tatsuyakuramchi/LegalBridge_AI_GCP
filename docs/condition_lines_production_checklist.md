# データ構造刷新 — 本番実行チェックリスト

作成日: 2026-06-11
対象ブランチ: `claude/recent-push-execution-dp9hto`
関連: `condition_lines_migration_runbook.md`（前提・据置フェーズの詳細はこちら）

> 大原則: **コードを先にデプロイ → その後でバックフィル**。読み取りは coverage-gated
> dual-read で、新スキーマ未完成なら旧テーブルに自動フォールバック(無回帰)。
> まず **ステージングで STEP 1〜5 を一周**し、出力差分ゼロを確認してから本番へ。

各 STEP の確認 SQL は `psql $DATABASE_URL -c "..."` で実行する想定。

---

## STEP 0 — 準備

- [ ] 本番 DB のスナップショット(バックアップ)を取得した
- [ ] ロールバック方針を確認した（コードは dual-read で切り戻し不要。データは STEP3 前のスナップショットに復元）
- [ ] 本番 `DATABASE_URL` でスクリプトを実行できる環境を用意した（`tsx` 実行可）
- [ ] このブランチをステージングに先行デプロイした（推奨）

---

## STEP 1 — コードデプロイ（スキーマ自動作成）

- [ ] worker / api をデプロイし、`initDb()` が完走した（ログに `Database tables initialized`）

確認 SQL:
```sql
-- 新テーブル 3 / 新ビュー 3 が存在
SELECT count(*) AS tables FROM pg_tables
 WHERE tablename IN ('condition_lines','condition_events','works');         -- 期待 3
SELECT count(*) AS views FROM pg_views
 WHERE viewname IN ('condition_line_status_v','condition_line_balance_v','condition_line_schedule_v'); -- 期待 3
-- condition_lines に表示列/連番が追加されている
SELECT count(*) AS disp_cols FROM information_schema.columns
 WHERE table_name='condition_lines'
   AND column_name IN ('spec','category','calc_method','payment_method','payment_terms',
                       'payment_date','fee_type','calc_period','formula_text','source_seq_no'); -- 期待 10
```
- [ ] 上記すべて期待値どおり

---

## STEP 2 — バックフィル dry-run

```bash
DATABASE_URL=<本番> tsx scripts/restructure_run_all.ts
```

- [ ] 各 Phase の「未移行件数」を記録した
- [ ] `restructure_reports/` の CSV を確認した:
  - [ ] `c1_mixed_contracts.csv`（mixed 契約 — scope 手動分解の要否）
  - [ ] `c1_no_scope_contracts.csv`（scope 0 件 — 手動補完の要否）
  - [ ] `c1_unresolved_parents.csv`（親 master 未解決）
  - [ ] `c3_held_inspection.csv` / `c3_held_royalty.csv`（document_id 解決不能 = 保留）
  - [ ] `c4_work_name_survey.csv`（作品名寄せドラフト）
- [ ] 保留・mixed の件数が許容範囲、または対応方針を決めた

事前把握 SQL（移行対象の規模感）:
```sql
SELECT
  (SELECT count(*) FROM capability_line_items)           AS line_items,
  (SELECT count(*) FROM capability_financial_conditions) AS fin_conditions,
  (SELECT count(*) FROM delivery_line_items)             AS delivery_lines,
  (SELECT count(*) FROM royalty_calculations)            AS royalty_calcs,
  (SELECT count(*) FROM contract_capabilities WHERE contract_category='mixed') AS mixed_contracts;
```

---

## STEP 3 — バックフィル apply

```bash
DATABASE_URL=<本番> tsx scripts/restructure_run_all.ts --apply
```

- [ ] D-5 突合: `consumed 差分 0` / `MG残 差分 0`
- [ ] `fulfilled 差分` の中身を確認した（既知バグ=部分検収の全量誤判定 の解消件数）
- [ ] レディネス監査: `E-2 / G-4` が 🟢 GO（データ整合）

検証 SQL（旧→新の網羅。左右が一致していること）:
```sql
SELECT
  (SELECT count(*) FROM capability_line_items) AS li,
  (SELECT count(*) FROM capability_line_items x
     WHERE EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.source_line_item_id=x.id)) AS li_migrated,
  (SELECT count(*) FROM capability_financial_conditions) AS fc,
  (SELECT count(*) FROM capability_financial_conditions x
     WHERE EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.source_condition_id=x.id)) AS fc_migrated,
  (SELECT count(*) FROM delivery_line_items) AS dli,
  (SELECT count(*) FROM delivery_line_items x
     WHERE EXISTS (SELECT 1 FROM condition_events e WHERE e.source_delivery_line_item_id=x.id)) AS dli_migrated,
  (SELECT count(*) FROM royalty_calculations) AS rc,
  (SELECT count(*) FROM royalty_calculations x
     WHERE EXISTS (SELECT 1 FROM condition_events e WHERE e.source_royalty_calculation_id=x.id)) AS rc_migrated;
-- 保留(C-3 で取り込めなかった実績)の確認: held の CSV と件数が一致するはず
```
- [ ] li=li_migrated / fc=fc_migrated（100% 移行）。dli/rc は保留分を除いて一致
- [ ] 表示列の充填漏れなし:
```sql
SELECT count(*) AS spec_missing FROM condition_lines
 WHERE source_line_item_id IS NOT NULL AND spec IS NULL
   AND EXISTS (SELECT 1 FROM capability_line_items li
                WHERE li.id=condition_lines.source_line_item_id AND li.spec IS NOT NULL); -- 期待 0
```

---

## STEP 4 — 二重書き込みの確認（新規データ）

- [ ] 新しい検収書を1件発行 → `condition_events`(inspection) が増えた
- [ ] 新しい利用許諾料計算を1件確定 → `condition_events`(royalty_calc) が増えた
- [ ] 新しい契約/明細を登録 → `condition_lines` が増えた
- [ ] worker ログの `[conditionSync] ... skipped (non-fatal)` が多発していない

確認 SQL（直近の二重書き込み）:
```sql
SELECT event_type, count(*), max(created_at)
  FROM condition_events GROUP BY event_type ORDER BY 1;
SELECT count(*) AS new_lines_today FROM condition_lines WHERE created_at::date = CURRENT_DATE;
```

---

## STEP 5 — 読み取り出力の突き合わせ（★実アプリ検証）

新スキーマが揃うと dual-read が condition_lines を使用。**移行前後で描画が同一**かを確認:

- [ ] 発注書フォームの明細（items）が変わらない
- [ ] 検収書フォームの `order_lines_for_inspection`（明細・検収累計・並び）が変わらない
- [ ] 契約一覧/詳細の financial_conditions / line_items が変わらない
- [ ] **Excel / PDF 出力**を新旧で diff（行・金額・並び・condition_no）→ 差異なし

差異が出た明細の調査 SQL（coverage が崩れている疑い）:
```sql
-- ある capability で「旧件数 ≠ 新件数」なら dual-read は旧テーブルにフォールバック中
SELECT cc.id, cc.document_number,
       (SELECT count(*) FROM capability_line_items y WHERE y.capability_id=cc.id) AS old_li,
       (SELECT count(*) FROM condition_lines x WHERE x.capability_id=cc.id AND x.source_line_item_id IS NOT NULL) AS new_li
  FROM contract_capabilities cc
 WHERE (SELECT count(*) FROM capability_line_items y WHERE y.capability_id=cc.id)
     <> (SELECT count(*) FROM condition_lines x WHERE x.capability_id=cc.id AND x.source_line_item_id IS NOT NULL)
 ORDER BY cc.id;
```
- [ ] 上記が 0 行（全 capability で coverage 一致）。残る行は C-2 を個別再実行 or 手動補正

---

## STEP 6 — 制約強化 G-1（データが正しくなってから）

```bash
DATABASE_URL=<本番> tsx scripts/restructure_g1_constraints.ts          # 検証(dry-run)
DATABASE_URL=<本番> tsx scripts/restructure_g1_constraints.ts --apply   # 適用
# term_start 欠落で進める場合のみ:
DATABASE_URL=<本番> tsx scripts/restructure_g1_constraints.ts --apply --force
```

- [ ] dry-run で `structural_role 不正値 0` / `subscription/royalty で term_start 欠落` を確認
- [ ] apply 成功（制約・トリガ追加）

確認 SQL:
```sql
SELECT conname FROM pg_constraint
 WHERE conname IN ('cc_structural_role_chk','cl_scheme_recurring_term');         -- 2 行
SELECT tgname FROM pg_trigger
 WHERE tgname IN ('trg_cc_fill_structural_role','trg_cl_terms_only','trg_cc_master_parent'); -- 3 行
SELECT count(*) AS null_role FROM contract_capabilities WHERE structural_role IS NULL;       -- 0
```
- [ ] すべて期待どおり

---

## ⏸ STEP 7 以降は実施しない（前提が未達）

以下は **別途・前提を満たしてから**。詳細は runbook 第4章。

- [ ] （未解禁）旧テーブル DROP / 書き込み停止
      — 前提: 監査 全GO **かつ** `grep -rn 'capability_line_items\|capability_financial_conditions' services/ src/` がゲート以外ゼロ
- [ ] （未解禁）G-2: `mg/ag_consumed_*` 列 DROP
      — 前提: `condition_line_balance_v` をイベント金額ベース再計算へ切替
- [ ] （未解禁）状態の意味的移行（inspection_issued / 一覧集計）
      — 前提: プロダクト判断（手動フラグ・端数許容）＋ アプリ実行検証
- [ ] （未解禁）作品モデル/受取マップ連結（source_ip_id / work_id）
      — 前提: 連結を新モデルでどう表現するかの設計判断

---

## ロールバック

| 局面 | 対応 |
|---|---|
| STEP 1〜2 で問題 | コードは dual-read フォールバックのため切り戻し不要。様子見 |
| STEP 3 apply 後に問題 | スナップショットへ復元（バックフィルは追加のみ・冪等なので通常は不要） |
| STEP 5 で特定明細だけ差異 | 該当 capability の C-2 を個別再実行、または condition_lines を補正して coverage を合わせる |
| STEP 6 G-1 後に問題 | 制約/トリガを個別 DROP（`ALTER TABLE ... DROP CONSTRAINT` / `DROP TRIGGER`）。データは無変更 |
