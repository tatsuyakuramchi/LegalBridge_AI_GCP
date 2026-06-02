-- 0020_sublicense_sales_reports.sql
-- サブライセンス受領管理(第2段): サブライセンシーからの売上報告。
-- deal(作品×サブライセンシー)× 受領予定日(period_date)単位で実績売上/数量を保持。
-- これがある期間は受領予定を「実績ベース(料率×実売上)」で再計算する。
-- additive・冪等。参照先 sublicense_deals(0019)。

CREATE TABLE IF NOT EXISTS sublicense_sales_reports (
  id                 SERIAL PRIMARY KEY,
  deal_id            INTEGER NOT NULL REFERENCES sublicense_deals(id) ON DELETE CASCADE,
  period_date        DATE NOT NULL,                  -- 対応する受領予定日
  reported_sales     DECIMAL(15,2),                  -- 実売上(sales 基準)
  reported_quantity  DECIMAL(15,4),                  -- 実数量(manufacturing 基準)
  note               TEXT,
  reported_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, period_date)
);

CREATE INDEX IF NOT EXISTS idx_slsr_deal ON sublicense_sales_reports(deal_id);
