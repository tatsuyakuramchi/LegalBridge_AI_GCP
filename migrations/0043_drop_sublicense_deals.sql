-- 0043_drop_sublicense_deals.sql
-- サブライセンス受領の刷新(Phase 3・撤去)。
--   旧 sublicense_deals / sublicense_sales_reports を廃止し、
--   条件明細(capability_financial_conditions condition_kind='sublicense_out') + condition_receipts に一本化。
--   ※ 現状データ無し前提(ユーザー確認済)。冪等: IF EXISTS。
-- 依存: sublicense_sales_reports.deal_id → sublicense_deals / payments.sublicense_deal_id → sublicense_deals。

-- 報告テーブル(deal_id FK)を先に削除。
DROP TABLE IF EXISTS sublicense_sales_reports;

-- payments の旧リンク列(FK)を撤去。
ALTER TABLE payments DROP COLUMN IF EXISTS sublicense_deal_id;

-- 請求権台帳本体を撤去(残依存があれば CASCADE で FK 制約も除去)。
DROP TABLE IF EXISTS sublicense_deals CASCADE;
