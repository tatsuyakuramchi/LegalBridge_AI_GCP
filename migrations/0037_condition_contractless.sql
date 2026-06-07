-- 0037_condition_contractless.sql
-- データモデル統合 Part2: 条件明細を「契約レス」でも作れるようにする。
--   実務フロー「作品を先に作り、後から原作IP＋利用許諾条件を紐づける」に対応。
--
--   capability_financial_conditions.capability_id を nullable 化し、
--   「契約(capability_id) または 作品(work_id) のどちらかに属する」CHECK を追加。
--   契約レス(capability_id IS NULL)条件は work_id 単位で condition_no を一意にする。
--
-- 冪等: DROP NOT NULL は再実行可。CHECK / partial unique は存在チェック付き。
-- 既存挙動: capability_id を持つ条件は従来どおり(v3ミラートリガも capability_id NULL は skip)。

ALTER TABLE capability_financial_conditions ALTER COLUMN capability_id DROP NOT NULL;

-- 契約 or 作品 のどちらかに属する
DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_cfc_owner'
  ) THEN
    ALTER TABLE capability_financial_conditions
      ADD CONSTRAINT chk_cfc_owner CHECK (capability_id IS NOT NULL OR work_id IS NOT NULL);
  END IF;
END
$chk$;

-- 契約レス条件は (work_id, condition_no) を一意に(契約あり条件は従来の UNIQUE(capability_id, condition_no))
CREATE UNIQUE INDEX IF NOT EXISTS uq_cfc_work_condition
  ON capability_financial_conditions(work_id, condition_no)
  WHERE capability_id IS NULL AND work_id IS NOT NULL;
