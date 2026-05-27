-- =================================================================
-- Phase 23.0 — レガシーテーブル → contract_capabilities 系への一括移行
--
-- 移行マップ:
--   order_items                  → contract_capabilities (record_type='purchase_order')
--   order_line_items             → capability_line_items
--   order_expenses               → capability_expenses
--   order_other_fees             → capability_other_fees
--   license_contracts            → contract_capabilities (individual_contract / standalone_contract)
--   license_financial_conditions → capability_financial_conditions
--
--   delivery_events.order_item_id           → delivery_events.capability_id
--   delivery_line_items.order_line_item_id  → delivery_line_items.capability_line_item_id
--   royalty_calculations.license_contract_id            → capability_id
--   royalty_calculations.license_financial_condition_id → capability_financial_condition_id
--
-- 実行方法 (Cloud SQL):
--   1. Cloud SQL Studio (GUI) で本ファイルを丸ごとペースト → 「実行」
--   2. または gcloud sql connect <instance> --user=postgres
--      \i /path/to/phase23_migrate.sql
--
-- 特性:
--   - 単一トランザクション (BEGIN..COMMIT) — 失敗時は自動 ROLLBACK
--   - 冪等 (UNIQUE 制約 + ON CONFLICT DO UPDATE) — 何度走らせても件数増えない
--   - TEMP TABLE はセッション内で完結 (COMMIT 時に自動破棄)
--
-- 実行時間: 件数次第。1000 件未満なら数秒。
-- =================================================================

BEGIN;

-- -----------------------------------------------------------------
-- [pre] 移行前の件数を表示
-- -----------------------------------------------------------------
SELECT 'BEFORE migration' AS phase,
       (SELECT COUNT(*) FROM order_items)                   AS order_items,
       (SELECT COUNT(*) FROM order_line_items)              AS order_line_items,
       (SELECT COUNT(*) FROM order_expenses)                AS order_expenses,
       (SELECT COUNT(*) FROM order_other_fees)              AS order_other_fees,
       (SELECT COUNT(*) FROM license_contracts)             AS license_contracts,
       (SELECT COUNT(*) FROM license_financial_conditions)  AS license_financial_conditions,
       (SELECT COUNT(*) FROM contract_capabilities)         AS contract_capabilities,
       (SELECT COUNT(*) FROM capability_line_items)         AS capability_line_items,
       (SELECT COUNT(*) FROM capability_expenses)           AS capability_expenses,
       (SELECT COUNT(*) FROM capability_other_fees)         AS capability_other_fees,
       (SELECT COUNT(*) FROM capability_financial_conditions) AS capability_financial_conditions;

-- -----------------------------------------------------------------
-- [1/8] order_items → contract_capabilities (record_type='purchase_order')
-- -----------------------------------------------------------------
CREATE TEMP TABLE _tmp_oi_to_cc (
  order_item_id INTEGER PRIMARY KEY,
  capability_id INTEGER
) ON COMMIT DROP;

-- メイン経路: backlog_issue_key 経由で document_number を引き当てて UPSERT
WITH po_docs AS (
  SELECT DISTINCT ON (d.issue_key)
         d.issue_key,
         d.document_number
    FROM documents d
   WHERE d.template_type LIKE '%purchase_order%'
   ORDER BY d.issue_key, d.created_at DESC
),
enriched AS (
  SELECT
    oi.id   AS order_item_id,
    oi.backlog_issue_key,
    oi.legal_request_id,
    oi.vendor_code,
    oi.description,
    oi.amount_ex_tax,
    oi.amount_inc_tax,
    oi.tax_rate,
    oi.tax_amount,
    oi.due_date,
    oi.created_at,
    v.id AS vendor_id,
    pd.document_number
  FROM order_items oi
  LEFT JOIN po_docs pd ON pd.issue_key = oi.backlog_issue_key
  LEFT JOIN vendors v  ON v.vendor_code = oi.vendor_code
),
upsert AS (
  INSERT INTO contract_capabilities (
    vendor_id, record_type, contract_category, contract_type, contract_title,
    document_number, contract_status, source_system,
    backlog_issue_key, legal_request_id,
    amount_ex_tax, amount_inc_tax, tax_rate, tax_amount, due_date
  )
  SELECT
    e.vendor_id,
    'purchase_order',
    'service',
    'purchase_order',
    COALESCE(NULLIF(e.description, ''), e.document_number, e.backlog_issue_key),
    e.document_number,
    'executed',
    'phase23-migration',
    e.backlog_issue_key,
    e.legal_request_id,
    e.amount_ex_tax,
    e.amount_inc_tax,
    e.tax_rate,
    e.tax_amount,
    e.due_date
  FROM enriched e
  WHERE e.document_number IS NOT NULL
  ON CONFLICT (document_number) DO UPDATE SET
    record_type        = 'purchase_order',
    contract_category  = 'service',
    contract_type      = 'purchase_order',
    vendor_id          = COALESCE(EXCLUDED.vendor_id, contract_capabilities.vendor_id),
    backlog_issue_key  = COALESCE(EXCLUDED.backlog_issue_key, contract_capabilities.backlog_issue_key),
    legal_request_id   = COALESCE(EXCLUDED.legal_request_id, contract_capabilities.legal_request_id),
    amount_ex_tax      = COALESCE(EXCLUDED.amount_ex_tax, contract_capabilities.amount_ex_tax),
    amount_inc_tax     = COALESCE(EXCLUDED.amount_inc_tax, contract_capabilities.amount_inc_tax),
    tax_rate           = COALESCE(EXCLUDED.tax_rate, contract_capabilities.tax_rate),
    tax_amount         = COALESCE(EXCLUDED.tax_amount, contract_capabilities.tax_amount),
    due_date           = COALESCE(EXCLUDED.due_date, contract_capabilities.due_date),
    updated_at         = CURRENT_TIMESTAMP
  RETURNING id, backlog_issue_key
)
INSERT INTO _tmp_oi_to_cc (order_item_id, capability_id)
SELECT oi.id, u.id
  FROM order_items oi
  JOIN upsert u ON u.backlog_issue_key = oi.backlog_issue_key
ON CONFLICT (order_item_id) DO NOTHING;

-- 補助経路: backlog_issue_key が NULL の order_items は documents.template_type 経由
INSERT INTO _tmp_oi_to_cc (order_item_id, capability_id)
SELECT oi.id, cc.id
  FROM order_items oi
  JOIN documents d ON d.issue_key = oi.backlog_issue_key
                  AND d.template_type LIKE '%purchase_order%'
  JOIN contract_capabilities cc ON cc.document_number = d.document_number
 WHERE NOT EXISTS (SELECT 1 FROM _tmp_oi_to_cc t WHERE t.order_item_id = oi.id)
ON CONFLICT (order_item_id) DO NOTHING;

SELECT '[1/8] order_items mapped' AS step,
       COUNT(*) AS mapped_count
  FROM _tmp_oi_to_cc;

-- -----------------------------------------------------------------
-- [2/8] order_line_items → capability_line_items
-- -----------------------------------------------------------------
CREATE TEMP TABLE _tmp_oli_to_cli (
  order_line_item_id INTEGER PRIMARY KEY,
  capability_line_item_id INTEGER
) ON COMMIT DROP;

WITH ins AS (
  INSERT INTO capability_line_items (
    capability_id, line_no, item_name, spec, calc_method, payment_method,
    payment_terms, quantity, unit_price, amount_ex_tax,
    delivery_date, payment_date, cycle, billing_day, term_start, term_end,
    inspected_amount_ex_tax
  )
  SELECT
    t.capability_id, oli.line_no, oli.item_name, oli.spec, oli.calc_method,
    oli.payment_method, oli.payment_terms, oli.quantity, oli.unit_price,
    oli.amount_ex_tax, oli.delivery_date, oli.payment_date,
    oli.cycle, oli.billing_day, oli.term_start, oli.term_end,
    0
  FROM order_line_items oli
  JOIN _tmp_oi_to_cc t ON t.order_item_id = oli.order_item_id
  ON CONFLICT (capability_id, line_no) DO UPDATE SET
    item_name        = EXCLUDED.item_name,
    spec             = EXCLUDED.spec,
    calc_method      = EXCLUDED.calc_method,
    payment_method   = EXCLUDED.payment_method,
    payment_terms    = EXCLUDED.payment_terms,
    quantity         = EXCLUDED.quantity,
    unit_price       = EXCLUDED.unit_price,
    amount_ex_tax    = EXCLUDED.amount_ex_tax,
    delivery_date    = EXCLUDED.delivery_date,
    payment_date     = EXCLUDED.payment_date,
    cycle            = EXCLUDED.cycle,
    billing_day      = EXCLUDED.billing_day,
    term_start       = EXCLUDED.term_start,
    term_end         = EXCLUDED.term_end,
    updated_at       = CURRENT_TIMESTAMP
  RETURNING id, capability_id, line_no
)
INSERT INTO _tmp_oli_to_cli (order_line_item_id, capability_line_item_id)
SELECT oli.id, ins.id
  FROM order_line_items oli
  JOIN _tmp_oi_to_cc t ON t.order_item_id = oli.order_item_id
  JOIN ins ON ins.capability_id = t.capability_id AND ins.line_no = oli.line_no
ON CONFLICT (order_line_item_id) DO NOTHING;

SELECT '[2/8] order_line_items mapped' AS step,
       COUNT(*) AS mapped_count
  FROM _tmp_oli_to_cli;

-- -----------------------------------------------------------------
-- [3/8] order_expenses → capability_expenses
-- -----------------------------------------------------------------
WITH ins AS (
  INSERT INTO capability_expenses (
    capability_id, line_no, expense_name, spec, spent_date, amount_inc_tax, remarks
  )
  SELECT t.capability_id, oe.line_no, oe.expense_name, oe.spec, oe.spent_date,
         oe.amount_inc_tax, oe.remarks
    FROM order_expenses oe
    JOIN _tmp_oi_to_cc t ON t.order_item_id = oe.order_item_id
  ON CONFLICT (capability_id, line_no) DO UPDATE SET
    expense_name    = EXCLUDED.expense_name,
    spec            = EXCLUDED.spec,
    spent_date      = EXCLUDED.spent_date,
    amount_inc_tax  = EXCLUDED.amount_inc_tax,
    remarks         = EXCLUDED.remarks,
    updated_at      = CURRENT_TIMESTAMP
  RETURNING id
)
SELECT '[3/8] order_expenses upserted' AS step,
       COUNT(*) AS rows
  FROM ins;

-- -----------------------------------------------------------------
-- [4/8] order_other_fees → capability_other_fees
-- -----------------------------------------------------------------
WITH ins AS (
  INSERT INTO capability_other_fees (
    capability_id, line_no, fee_name, amount, remarks
  )
  SELECT t.capability_id, oof.line_no, oof.fee_name, oof.amount, oof.remarks
    FROM order_other_fees oof
    JOIN _tmp_oi_to_cc t ON t.order_item_id = oof.order_item_id
  ON CONFLICT (capability_id, line_no) DO UPDATE SET
    fee_name = EXCLUDED.fee_name,
    amount   = EXCLUDED.amount,
    remarks  = EXCLUDED.remarks,
    updated_at = CURRENT_TIMESTAMP
  RETURNING id
)
SELECT '[4/8] order_other_fees upserted' AS step,
       COUNT(*) AS rows
  FROM ins;

-- -----------------------------------------------------------------
-- [5/8] license_contracts → contract_capabilities (license)
-- -----------------------------------------------------------------
CREATE TEMP TABLE _tmp_lc_to_cc (
  license_contract_id INTEGER PRIMARY KEY,
  capability_id INTEGER
) ON COMMIT DROP;

WITH enriched AS (
  SELECT
    lc.id AS license_contract_id,
    lc.backlog_issue_key,
    COALESCE(lc.contract_number, lc.ledger_number, lc.work_id) AS document_number,
    lc.licensor_name, lc.licensee_name,
    lc.license_start_date, lc.original_work, lc.original_work_note,
    lc.product_name_predicted, lc.exclusivity, lc.supervisor,
    lc.credit_display, lc.remarks,
    CASE WHEN lc.basic_contract_name IS NULL OR lc.basic_contract_name = ''
         THEN 'standalone_contract'
         ELSE 'individual_contract' END AS rt,
    v.id AS vendor_id
  FROM license_contracts lc
  LEFT JOIN vendors v ON v.vendor_name = lc.licensor_name OR v.vendor_name = lc.licensee_name
),
upsert AS (
  INSERT INTO contract_capabilities (
    vendor_id, record_type, contract_category, contract_type, contract_title,
    document_number, contract_status, source_system,
    backlog_issue_key, original_work, effective_date,
    caution_note
  )
  SELECT
    e.vendor_id,
    e.rt,
    'license',
    CASE WHEN e.rt = 'standalone_contract' THEN 'license_standalone' ELSE 'license_individual' END,
    COALESCE(NULLIF(e.product_name_predicted, ''), NULLIF(e.original_work, ''), e.document_number),
    e.document_number,
    'executed',
    'phase23-migration',
    e.backlog_issue_key,
    e.original_work,
    e.license_start_date,
    e.remarks
  FROM enriched e
  WHERE e.document_number IS NOT NULL
  ON CONFLICT (document_number) DO UPDATE SET
    record_type       = EXCLUDED.record_type,
    contract_category = 'license',
    contract_type     = EXCLUDED.contract_type,
    vendor_id         = COALESCE(EXCLUDED.vendor_id, contract_capabilities.vendor_id),
    backlog_issue_key = COALESCE(EXCLUDED.backlog_issue_key, contract_capabilities.backlog_issue_key),
    original_work     = COALESCE(EXCLUDED.original_work, contract_capabilities.original_work),
    effective_date    = COALESCE(EXCLUDED.effective_date, contract_capabilities.effective_date),
    updated_at        = CURRENT_TIMESTAMP
  RETURNING id, document_number
)
INSERT INTO _tmp_lc_to_cc (license_contract_id, capability_id)
SELECT lc.id, u.id
  FROM license_contracts lc
  JOIN upsert u ON u.document_number = COALESCE(lc.contract_number, lc.ledger_number, lc.work_id)
ON CONFLICT (license_contract_id) DO NOTHING;

SELECT '[5/8] license_contracts mapped' AS step,
       COUNT(*) AS mapped_count
  FROM _tmp_lc_to_cc;

-- -----------------------------------------------------------------
-- [6/8] license_financial_conditions → capability_financial_conditions
-- -----------------------------------------------------------------
CREATE TEMP TABLE _tmp_lfc_to_cfc (
  license_financial_condition_id INTEGER PRIMARY KEY,
  capability_financial_condition_id INTEGER
) ON COMMIT DROP;

WITH ins AS (
  INSERT INTO capability_financial_conditions (
    capability_id, condition_no, region_language_label, calc_method,
    rate_pct, base_price_label, calc_period, calc_period_kind, calc_period_close_month,
    currency, formula_text, payment_terms, mg_amount, ag_amount
  )
  SELECT t.capability_id, lfc.condition_no, lfc.region_language_label, lfc.calc_method,
         lfc.rate_pct, lfc.base_price_label, lfc.calc_period,
         lfc.calc_period_kind, lfc.calc_period_close_month,
         lfc.currency, lfc.formula_text, lfc.payment_terms,
         lfc.mg_amount, lfc.ag_amount
    FROM license_financial_conditions lfc
    JOIN _tmp_lc_to_cc t ON t.license_contract_id = lfc.license_contract_id
  ON CONFLICT (capability_id, condition_no) DO UPDATE SET
    calc_method            = EXCLUDED.calc_method,
    rate_pct               = EXCLUDED.rate_pct,
    base_price_label       = EXCLUDED.base_price_label,
    calc_period            = EXCLUDED.calc_period,
    calc_period_kind       = EXCLUDED.calc_period_kind,
    calc_period_close_month= EXCLUDED.calc_period_close_month,
    currency               = EXCLUDED.currency,
    formula_text           = EXCLUDED.formula_text,
    payment_terms          = EXCLUDED.payment_terms,
    mg_amount              = EXCLUDED.mg_amount,
    ag_amount              = EXCLUDED.ag_amount,
    updated_at             = CURRENT_TIMESTAMP
  RETURNING id, capability_id, condition_no
)
INSERT INTO _tmp_lfc_to_cfc (license_financial_condition_id, capability_financial_condition_id)
SELECT lfc.id, ins.id
  FROM license_financial_conditions lfc
  JOIN _tmp_lc_to_cc t ON t.license_contract_id = lfc.license_contract_id
  JOIN ins ON ins.capability_id = t.capability_id AND ins.condition_no = lfc.condition_no
ON CONFLICT (license_financial_condition_id) DO NOTHING;

SELECT '[6/8] license_financial_conditions mapped' AS step,
       COUNT(*) AS mapped_count
  FROM _tmp_lfc_to_cfc;

-- -----------------------------------------------------------------
-- [7/8] FK 張り替え: delivery_events / delivery_line_items / royalty_calculations
-- -----------------------------------------------------------------
WITH d1 AS (
  UPDATE delivery_events de
     SET capability_id = t.capability_id
    FROM _tmp_oi_to_cc t
   WHERE de.order_item_id = t.order_item_id
     AND de.capability_id IS NULL
  RETURNING de.id
)
SELECT '[7a] delivery_events.capability_id'    AS step, COUNT(*) AS rows FROM d1;

WITH d2 AS (
  UPDATE delivery_line_items dli
     SET capability_line_item_id = t.capability_line_item_id
    FROM _tmp_oli_to_cli t
   WHERE dli.order_line_item_id = t.order_line_item_id
     AND dli.capability_line_item_id IS NULL
  RETURNING dli.id
)
SELECT '[7b] delivery_line_items.capability_line_item_id' AS step, COUNT(*) AS rows FROM d2;

WITH r1 AS (
  UPDATE royalty_calculations rc
     SET capability_id = t.capability_id
    FROM _tmp_lc_to_cc t
   WHERE rc.license_contract_id = t.license_contract_id
     AND rc.capability_id IS NULL
  RETURNING rc.id
)
SELECT '[7c] royalty_calculations.capability_id' AS step, COUNT(*) AS rows FROM r1;

WITH r2 AS (
  UPDATE royalty_calculations rc
     SET capability_financial_condition_id = t.capability_financial_condition_id
    FROM _tmp_lfc_to_cfc t
   WHERE rc.license_financial_condition_id = t.license_financial_condition_id
     AND rc.capability_financial_condition_id IS NULL
  RETURNING rc.id
)
SELECT '[7d] royalty_calculations.capability_financial_condition_id' AS step, COUNT(*) AS rows FROM r2;

-- -----------------------------------------------------------------
-- [8/8] capability_line_items.inspected_amount_ex_tax を再集計
-- -----------------------------------------------------------------
WITH bf AS (
  UPDATE capability_line_items cli
     SET inspected_amount_ex_tax = COALESCE(sub.s, 0)
    FROM (
      SELECT dli.capability_line_item_id AS id,
             SUM(dli.inspected_amount_ex_tax) AS s
        FROM delivery_line_items dli
       WHERE dli.capability_line_item_id IS NOT NULL
       GROUP BY dli.capability_line_item_id
    ) sub
   WHERE cli.id = sub.id
   RETURNING cli.id
)
SELECT '[8/8] inspected_amount_ex_tax backfilled' AS step, COUNT(*) AS rows FROM bf;

-- -----------------------------------------------------------------
-- [post] 移行後の件数を表示
-- -----------------------------------------------------------------
SELECT 'AFTER migration' AS phase,
       (SELECT COUNT(*) FROM order_items)                   AS order_items,
       (SELECT COUNT(*) FROM order_line_items)              AS order_line_items,
       (SELECT COUNT(*) FROM order_expenses)                AS order_expenses,
       (SELECT COUNT(*) FROM order_other_fees)              AS order_other_fees,
       (SELECT COUNT(*) FROM license_contracts)             AS license_contracts,
       (SELECT COUNT(*) FROM license_financial_conditions)  AS license_financial_conditions,
       (SELECT COUNT(*) FROM contract_capabilities)         AS contract_capabilities,
       (SELECT COUNT(*) FROM capability_line_items)         AS capability_line_items,
       (SELECT COUNT(*) FROM capability_expenses)           AS capability_expenses,
       (SELECT COUNT(*) FROM capability_other_fees)         AS capability_other_fees,
       (SELECT COUNT(*) FROM capability_financial_conditions) AS capability_financial_conditions;

-- ARC-PO-2026-0019 の状態確認 (specific row check)
SELECT 'ARC-PO-2026-0019 状態確認' AS check_label,
       cc.id, cc.document_number, cc.record_type, cc.contract_category,
       cc.amount_ex_tax, cc.tax_rate, cc.due_date,
       (SELECT COUNT(*) FROM capability_line_items cli WHERE cli.capability_id = cc.id) AS line_count,
       (SELECT COUNT(*) FROM capability_expenses ce WHERE ce.capability_id = cc.id)     AS expense_count,
       (SELECT COUNT(*) FROM capability_other_fees cof WHERE cof.capability_id = cc.id) AS other_fee_count
  FROM contract_capabilities cc
 WHERE cc.document_number = 'ARC-PO-2026-0019';

COMMIT;

-- ★ ここまで来たら成功。
-- ★ Cloud SQL Studio 側で実行結果 (各 step の rows 数 / AFTER の件数) を
--    キャプチャしておくと後追いしやすい。
