-- 0026_usage_reports_period.sql
-- 利用報告(サブライセンス売上報告)を「利用期間」付きで複数保持し、受領回に
-- 集約できるようにする。報告周期(月次 4分/5分…)と受領周期(四半期等)が
-- 一致しないケース(混在)に対応する(ユーザー決定)。
--
-- 既存 sublicense_sales_reports(0020: deal_id × period_date)を拡張:
--   - period_label   表示名(例: 2026年4月分)
--   - period_start/period_end  利用期間(月次なら 4/1〜4/30)
--   - report_basis   sales(売上)/ manufacturing(製造時)/ usage(利用期間)
--   - unit_price     製造時の単価(任意)
--   - reported_amount 相手方が金額を直接報告した場合(任意。あれば最優先)
--
-- 受領回への集約は サービス側(buildReceiptRows)で「受領回の対象期間に
--   period_end(無ければ period_date)が入る報告を合算」する。
-- period_date は引き続き各報告の代表日(= 通常 period_end)として一意キーに残す。
--
-- additive・冪等。参照先 sublicense_sales_reports(0020)。

ALTER TABLE sublicense_sales_reports
  ADD COLUMN IF NOT EXISTS period_label    VARCHAR(50);
ALTER TABLE sublicense_sales_reports
  ADD COLUMN IF NOT EXISTS period_start    DATE;
ALTER TABLE sublicense_sales_reports
  ADD COLUMN IF NOT EXISTS period_end      DATE;
ALTER TABLE sublicense_sales_reports
  ADD COLUMN IF NOT EXISTS report_basis    VARCHAR(20);
ALTER TABLE sublicense_sales_reports
  ADD COLUMN IF NOT EXISTS unit_price      DECIMAL(15,2);
ALTER TABLE sublicense_sales_reports
  ADD COLUMN IF NOT EXISTS reported_amount DECIMAL(15,2);

-- 既存行は period_date を利用期間末日とみなして補完(冪等)。
UPDATE sublicense_sales_reports
   SET period_end = COALESCE(period_end, period_date)
 WHERE period_end IS NULL AND period_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_slsr_period_end ON sublicense_sales_reports(period_end);
