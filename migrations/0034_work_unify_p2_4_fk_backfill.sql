-- 0034_work_unify_p2_4_fk_backfill.sql
-- データモデル統合 Part2 P2-4: source_ip_id を持つ表に、対応する work_id
--   (kind='licensed_in' に backfill した works) を埋める。works.legacy_source_ip_id 経由。
--
-- additive・冪等(work_id IS NULL の行のみ更新)。source_ip_id 側は残置(両キー併存)。
--   これにより以降の読み手は work_id 一本で原作IPも辿れるようになる(P2-3で活用)。
--   新規DB(licensed_in works 無し)はマッチ0で実質no-op。

UPDATE contract_works t SET work_id = w.id
  FROM works w
 WHERE w.legacy_source_ip_id = t.source_ip_id
   AND t.source_ip_id IS NOT NULL
   AND t.work_id IS NULL;

UPDATE contract_financial_terms t SET work_id = w.id
  FROM works w
 WHERE w.legacy_source_ip_id = t.source_ip_id
   AND t.source_ip_id IS NOT NULL
   AND t.work_id IS NULL;

UPDATE capability_line_items t SET work_id = w.id
  FROM works w
 WHERE w.legacy_source_ip_id = t.source_ip_id
   AND t.source_ip_id IS NOT NULL
   AND t.work_id IS NULL;
