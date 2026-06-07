-- 0036_condition_work_sourceip_link.sql
-- データモデル統合 Part2: 条件明細(利用許諾条件)に「作品 → 条件明細 → 原作IP」の
--   直接リンクを持たせる(ユーザー確定モデル(A))。
--
--   capability_financial_conditions に:
--     work_id        … この条件が適用される「自社作品」(works kind='own')
--     source_work_id … この条件の対象「原作IP」(works kind='licensed_in')
--   を additive 追加。実務フロー(作品を先に作り、後から原作IP+利用許諾を紐づける)に対応。
--
-- 既存データは v3 ミラー contract_financial_terms(id 共有, work_id/source_ip_id 保持)から
--   best-effort backfill。残りは UI で後から紐付け(null 始まり)。
-- 冪等: ADD COLUMN IF NOT EXISTS / backfill は IS NULL ガード。

ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS work_id        INTEGER REFERENCES works(id);
ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS source_work_id INTEGER REFERENCES works(id);
CREATE INDEX IF NOT EXISTS idx_cfc_work        ON capability_financial_conditions(work_id);
CREATE INDEX IF NOT EXISTS idx_cfc_source_work ON capability_financial_conditions(source_work_id);

-- backfill: v3 ミラー(contract_financial_terms)が持つ work_id / source_ip_id から。
--   id 共有(mirror) なので id 一致で対応づく。
UPDATE capability_financial_conditions cfc
   SET work_id = cft.work_id
  FROM contract_financial_terms cft
 WHERE cft.id = cfc.id
   AND cft.work_id IS NOT NULL
   AND cfc.work_id IS NULL;

-- 原作IP: 旧 source_ip_id を works(legacy_source_ip_id)経由で licensed_in works に解決。
UPDATE capability_financial_conditions cfc
   SET source_work_id = w.id
  FROM contract_financial_terms cft
  JOIN works w ON w.legacy_source_ip_id = cft.source_ip_id
 WHERE cft.id = cfc.id
   AND cft.source_ip_id IS NOT NULL
   AND cfc.source_work_id IS NULL;
