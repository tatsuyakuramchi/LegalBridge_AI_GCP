-- 0042_sublicense_receipt_flow.sql
-- サブライセンス条件明細(OUT) → 受領記録 の連結(Phase 1・additive)。
--   条件SSOT = capability_financial_conditions(condition_kind='sublicense_out')。
--   旧 sublicense_deals の条件項目をここへ吸収するため、受領用カラムを additive 追加。
--   受領記録は新テーブル condition_receipts(condition_id 紐付け)で保持(数字計算のみ・文書発行なし)。
-- 冪等: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS。

-- 条件明細(OUT)に受領(収益)条件の項目を追加。
ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS counterparty_vendor_id INTEGER REFERENCES vendors(id);  -- 受領先(サブライセンシー=取引先)
ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS basis VARCHAR(20);            -- 計算根拠: sales(報告売上) / manufacturing(報告数量)
ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS unit_price DECIMAL(15,2);     -- manufacturing 基準の単価
ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS cycle VARCHAR(20);            -- MONTHLY/QUARTERLY/SEMIANNUAL/ANNUAL/CUSTOM
ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS billing_day INTEGER;          -- 受領日(1-31 / 0 or >30 で末日)
ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS term_start DATE;
ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS term_end DATE;
ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS advance_amount DECIMAL(15,2); -- 前払(AG・受領総額から相殺)
ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS forecast_amount DECIMAL(15,2);-- 見込(受領予定の試算用)

CREATE INDEX IF NOT EXISTS idx_cfc_counterparty ON capability_financial_conditions(counterparty_vendor_id);

-- 受領記録(計算のみ)。condition_id ごとに period 行で報告→計算→受領を保持。
CREATE TABLE IF NOT EXISTS condition_receipts (
  id                       SERIAL PRIMARY KEY,
  condition_id             INTEGER NOT NULL REFERENCES capability_financial_conditions(id) ON DELETE CASCADE,
  period                   VARCHAR(7),                   -- YYYY-MM 等の表示
  period_date              DATE,                         -- 期の代表日(締め日)
  reported_sales           DECIMAL(15,2),                -- 報告売上(税抜)
  reported_quantity        DECIMAL(15,4),                -- 報告数量(製造数等)
  computed_royalty_ex_tax  DECIMAL(15,2),                -- 計算結果(受領予定額・税抜)
  received_amount          DECIMAL(15,2),                -- 実受領額(税抜)
  received_date            DATE,
  payment_id               INTEGER REFERENCES payments(id), -- P2で入金台帳と連携
  status                   VARCHAR(20) DEFAULT 'reported',  -- reported(報告のみ) / received(受領済)
  note                     TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_condition_receipts_condition ON condition_receipts(condition_id);
CREATE INDEX IF NOT EXISTS idx_condition_receipts_period ON condition_receipts(condition_id, period_date);
