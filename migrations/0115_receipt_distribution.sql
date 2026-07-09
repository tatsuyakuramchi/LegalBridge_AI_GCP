-- ============================================================================
-- 0115: 再許諾受領記録(condition_receipts)に「分配(ライセンサーへの支払)」列を追加。
--   分配 = ライセンサーへ支払額 = 基準額 × 個数 × 親ライセンスイン料率。
--   親ライセンスイン条件は condition_lines.parent_license_condition_id(0114)で辿る。
--   基準額/個数は受領記録ごとに保持(スマート既定＋手動上書き)。算出額と、生成した
--   outbound payment(分配台帳)への参照を保存する。
-- ============================================================================
ALTER TABLE condition_receipts
  ADD COLUMN IF NOT EXISTS distribution_base            DECIMAL(15,2),   -- 分配の基準額(サブライセンス料 or 卸値)
  ADD COLUMN IF NOT EXISTS distribution_qty             DECIMAL(15,4) DEFAULT 1, -- 個数(権利許諾=1 / プロダクトアウト=販売数)
  ADD COLUMN IF NOT EXISTS distribution_rate_pct        DECIMAL(7,4),    -- 算出に用いた親ライセンスイン料率(スナップショット)
  ADD COLUMN IF NOT EXISTS distribution_parent_condition_id INTEGER,     -- 用いた親ライセンスイン条件(監査用)
  ADD COLUMN IF NOT EXISTS computed_distribution_ex_tax DECIMAL(15,2),   -- ライセンサーへ支払額(税抜)
  ADD COLUMN IF NOT EXISTS distribution_payment_id      INTEGER REFERENCES payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_condition_receipts_dist_payment
  ON condition_receipts(distribution_payment_id);
