-- 0009_backfill_royalty.sql
-- royalty_calculations → royalty_statements(決定的・id保存・冪等)。
-- FK: contract_id ← capability_id(0008 で contracts.id=capability_id)、
--     financial_term_id ← capability_financial_condition_id(0008 で同id移行済)、
--     manufacturing_event_id は同名テーブル(0006 で product_id 追加のみ)を直接参照。
-- 存在しない参照は NULL に落として FK 違反を回避。
--
-- 注: royalty_payments → payments は payments の CHECK(work_id か department 必須)を
--     満たすため work 紐付け(contract_works/works backfill)が要る。後段で実施。

INSERT INTO royalty_statements (
  id, backlog_issue_key, contract_id, financial_term_id, product_id, work_material_id,
  manufacturing_event_id, sales_event_id, payment_id, calc_type, unit_price, quantity,
  sample_quantity, billable_quantity, rate_pct, gross_royalty_ex_tax, mg_amount,
  mg_consumed_before, mg_consumed_this_time, mg_consumed_after, mg_remaining, mg_fully_consumed,
  mg_topup_this_time, ag_amount, ag_consumed_before, ag_consumed_this_time, ag_consumed_after,
  ag_remaining, ag_fully_consumed, actual_royalty_ex_tax, tax_rate, tax_amount,
  total_payment_inc_tax, currency, period, reporting_deadline, payment_due_date, notes, created_at
)
SELECT
  rc.id, rc.backlog_issue_key,
  (SELECT c.id FROM contracts c WHERE c.id = rc.capability_id),
  (SELECT t.id FROM contract_financial_terms t WHERE t.id = rc.capability_financial_condition_id),
  NULL, NULL,
  (SELECT m.id FROM manufacturing_events m WHERE m.id = rc.manufacturing_event_id),
  NULL, NULL,
  rc.calc_type, rc.unit_price, rc.quantity, rc.sample_quantity, rc.billable_quantity, rc.rate_pct,
  rc.gross_royalty_ex_tax, rc.mg_amount, rc.mg_consumed_before, rc.mg_consumed_this_time,
  rc.mg_consumed_after, rc.mg_remaining, COALESCE(rc.mg_fully_consumed, FALSE),
  COALESCE(rc.mg_topup_this_time, 0), COALESCE(rc.ag_amount, 0), COALESCE(rc.ag_consumed_before, 0),
  COALESCE(rc.ag_consumed_this_time, 0), COALESCE(rc.ag_consumed_after, 0),
  COALESCE(rc.ag_remaining, 0), COALESCE(rc.ag_fully_consumed, FALSE), rc.actual_royalty_ex_tax,
  COALESCE(rc.tax_rate, 10), rc.tax_amount, rc.total_payment_inc_tax, COALESCE(rc.currency, 'JPY'),
  rc.period, rc.reporting_deadline, rc.payment_due_date, rc.notes, rc.created_at
FROM royalty_calculations rc
WHERE NOT EXISTS (SELECT 1 FROM royalty_statements rs WHERE rs.id = rc.id);

SELECT setval(pg_get_serial_sequence('royalty_statements', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM royalty_statements), 1));
