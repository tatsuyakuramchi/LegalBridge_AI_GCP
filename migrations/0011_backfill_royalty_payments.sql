-- 0011_backfill_royalty_payments.sql
-- royalty_payments → payments(snapshot移行・冪等)。
-- payments の CHECK(work_id か department 必須)を満たすため、過去データで work 紐付けが
-- 無い royalty 支払は暫定 department_code='__migrated_royalty__' を付与(work 再分類は後段)。
-- contract_id は royalty_calculations(同 manufacturing_event_id)の capability_id 経由で導出。
-- payment_no='PAY-MIG-{id}' で出所を保持(冪等ガード兼用)。

INSERT INTO payments (
  payment_no, direction, payment_kind, work_id, department_code, contract_id,
  counterparty_vendor_id, period, total_amount, status, due_date, backlog_issue_key, created_at
)
SELECT
  'PAY-MIG-' || rp.id,
  'outbound',
  'royalty',
  NULL,
  '__migrated_royalty__',
  (SELECT c.id FROM contracts c
     WHERE c.id = (
       SELECT rc.capability_id FROM royalty_calculations rc
        WHERE rc.manufacturing_event_id = rp.manufacturing_event_id
          AND rc.capability_id IS NOT NULL
        LIMIT 1
     )),
  NULL,
  rp.period,
  rp.total_amount,
  CASE rp.status WHEN 'paid' THEN 'paid' WHEN 'calculated' THEN 'calculated' ELSE rp.status END,
  rp.payment_due_date,
  rp.backlog_issue_key,
  rp.created_at
FROM royalty_payments rp
WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.payment_no = 'PAY-MIG-' || rp.id);

SELECT setval(pg_get_serial_sequence('payments', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM payments), 1));
