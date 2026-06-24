-- condition_lines 分類補完 Phase 3 (dry-run付き)
--
-- 対象:
--   A4. transaction_kind / counterparty_vendor_id の NULL 残
--
-- 方針:
--   - transaction_kind は contract_capabilities の category/record_type/payment_scheme から確実に推定できる範囲だけ補完
--   - counterparty_vendor_id は capability.vendor_id を既定値として補完
--   - dry-run 既定。apply=1 のときだけ UPDATE
--
-- dry-run:
--   psql "$DATABASE_URL" -f scripts/audit/backfill_condition_line_classification.sql
--
-- apply:
--   psql "$DATABASE_URL" -v apply=1 -f scripts/audit/backfill_condition_line_classification.sql

\if :{?apply}
\else
  \set apply 0
\endif

\echo 'backfill_condition_line_classification.sql apply=' :apply

BEGIN;

CREATE TEMP TABLE condition_line_classification_candidates ON COMMIT DROP AS
SELECT cl.id,
       cl.line_code,
       cl.payment_scheme,
       cl.transaction_kind AS current_transaction_kind,
       cl.counterparty_vendor_id AS current_counterparty_vendor_id,
       cc.id AS capability_id,
       cc.document_number,
       cc.record_type,
       cc.contract_category,
       cc.vendor_id AS capability_vendor_id,
       CASE
         WHEN cc.record_type = 'purchase_order' THEN 'service'
         WHEN cc.contract_category = 'service' THEN 'service'
         WHEN cc.contract_category = 'sales' THEN 'product'
         WHEN cc.contract_category IN ('license', 'publication') THEN 'license'
         WHEN cc.record_type IN ('license_condition', 'publication_condition') THEN 'license'
         WHEN cl.payment_scheme = 'royalty' THEN 'license'
         WHEN cl.payment_scheme = 'per_unit' THEN 'service'
         ELSE NULL
       END AS suggested_transaction_kind,
       CASE
         WHEN cc.vendor_id IS NOT NULL THEN cc.vendor_id
         ELSE NULL
       END AS suggested_counterparty_vendor_id
  FROM condition_lines cl
  LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
 WHERE cl.transaction_kind IS NULL
    OR cl.counterparty_vendor_id IS NULL;

\echo 'current null summary'
SELECT COUNT(*)::int AS total_candidates,
       COUNT(*) FILTER (WHERE current_transaction_kind IS NULL)::int AS transaction_kind_null,
       COUNT(*) FILTER (WHERE current_counterparty_vendor_id IS NULL)::int AS counterparty_vendor_id_null,
       COUNT(*) FILTER (WHERE current_transaction_kind IS NULL AND suggested_transaction_kind IS NOT NULL)::int AS transaction_kind_fillable,
       COUNT(*) FILTER (WHERE current_counterparty_vendor_id IS NULL AND suggested_counterparty_vendor_id IS NOT NULL)::int AS counterparty_fillable
  FROM condition_line_classification_candidates;

\echo 'suggested transaction_kind by source'
SELECT COALESCE(contract_category, '(NULL)') AS contract_category,
       COALESCE(record_type, '(NULL)') AS record_type,
       COALESCE(payment_scheme, '(NULL)') AS payment_scheme,
       COALESCE(suggested_transaction_kind, '(unresolved)') AS suggested_transaction_kind,
       COUNT(*)::int AS count
  FROM condition_line_classification_candidates
 WHERE current_transaction_kind IS NULL
 GROUP BY 1, 2, 3, 4
 ORDER BY count DESC, contract_category, record_type, payment_scheme;

\echo 'unresolved samples'
SELECT id,
       line_code,
       payment_scheme,
       document_number,
       record_type,
       contract_category
  FROM condition_line_classification_candidates
 WHERE current_transaction_kind IS NULL
   AND suggested_transaction_kind IS NULL
 ORDER BY id
 LIMIT 50;

\if :apply

\echo 'applying transaction_kind backfill'
UPDATE condition_lines cl
   SET transaction_kind = c.suggested_transaction_kind
  FROM condition_line_classification_candidates c
 WHERE cl.id = c.id
   AND cl.transaction_kind IS NULL
   AND c.suggested_transaction_kind IS NOT NULL;

\echo 'applying counterparty_vendor_id backfill'
UPDATE condition_lines cl
   SET counterparty_vendor_id = c.suggested_counterparty_vendor_id
  FROM condition_line_classification_candidates c
 WHERE cl.id = c.id
   AND cl.counterparty_vendor_id IS NULL
   AND c.suggested_counterparty_vendor_id IS NOT NULL;

COMMIT;

\else

\echo 'dry-run only; no changes applied'
ROLLBACK;

\endif
