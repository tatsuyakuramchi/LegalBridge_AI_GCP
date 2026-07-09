-- ============================================================================
-- 0114: 再許諾(sublicense_out)条件 → 親ライセンスイン(license_in)条件 リンク。
--   再許諾料の分配(ライセンサーへ支払 = 基準額 × 個数 × ライセンスイン料率)を
--   正確に算出するため、sublicense_out 条件が「どの license_in 条件の料率を源泉に
--   するか」を明示リンクする。自己参照 FK。親条件が消えても再許諾条件は残すため
--   ON DELETE SET NULL。NULL = 未リンク(分配は請求テーブル画面で手動/推定)。
-- ============================================================================
ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS parent_license_condition_id INTEGER
    REFERENCES capability_financial_conditions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cfc_parent_license
  ON capability_financial_conditions(parent_license_condition_id);
