-- 0041_condition_kind.sql
-- 条件明細(capability_financial_conditions)を「方向」で分離する。
--   利用許諾(IN)      = 'license_in'    : 原作IP(licensed_in)を借りる条件(我々が支払う料率)。原作IP詳細で登録。
--   サブライセンス(OUT)= 'sublicense_out': 自社作品(own)を再許諾する条件(我々が受け取る料率)。自社作品詳細で登録。
-- 既存の work_id 紐付き条件は、所有 work の kind から backfill。
-- 冪等: ADD COLUMN IF NOT EXISTS。

ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS condition_kind VARCHAR(20);

-- 既存条件の backfill: 原作IP(licensed_in) → license_in / 自社作品(own) → sublicense_out。
UPDATE capability_financial_conditions cfc
   SET condition_kind = CASE WHEN w.kind = 'licensed_in' THEN 'license_in' ELSE 'sublicense_out' END
  FROM works w
 WHERE cfc.work_id = w.id
   AND cfc.condition_kind IS NULL;

CREATE INDEX IF NOT EXISTS idx_cfc_condition_kind ON capability_financial_conditions(condition_kind);
