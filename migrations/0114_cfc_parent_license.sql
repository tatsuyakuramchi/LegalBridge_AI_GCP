-- ============================================================================
-- 0114: 再許諾(sublicense_out)条件 → 親ライセンスイン(license_in)条件 リンク。
--   再許諾料の分配(ライセンサーへ支払 = 基準額 × 個数 × ライセンスイン料率)を
--   正確に算出するため、sublicense_out 条件が「どの license_in 条件の料率を源泉に
--   するか」を明示リンクする。自己参照 FK。親条件が消えても再許諾条件は残すため
--   ON DELETE SET NULL。NULL = 未リンク(分配は請求テーブル画面で手動/推定)。
--
--   NOTE: capability_financial_conditions は 0101 で VIEW 化済み(condition_lines +
--   documents を束ねる)。VIEW には ALTER ADD COLUMN できないため、実体テーブル
--   condition_lines にカラムを追加する。cfc.id = condition_lines.id の 1:1 対応
--   (0101 view: cl.id AS id)なので、API は挿入後に condition_lines を直接 UPDATE し、
--   GET は condition_lines を JOIN して読む。
-- ============================================================================
ALTER TABLE condition_lines
  ADD COLUMN IF NOT EXISTS parent_license_condition_id INTEGER
    REFERENCES condition_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_condition_lines_parent_license
  ON condition_lines(parent_license_condition_id);
