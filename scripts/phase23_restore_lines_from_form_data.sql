-- =================================================================
-- Phase 23.6.8 — documents.form_data.items[] → capability_line_items 復元
--
-- 背景:
--   ARC-PO-2026-0019 のように /api/documents/generate 経由で作られた PO
--   のうち、当時の worker が order_items / order_line_items を埋めずに
--   documents.form_data.items[] にしか明細を保存していなかったケースがある。
--   その結果、Phase 23 マイグレ後も capability_line_items が空のままで、
--   検収書フォームの STEP 2 が「親 PO 未連動」の手入力フォールバックに
--   落ちてしまう。
--
-- 本スクリプトは contract_capabilities (record_type='purchase_order')
-- のうち、子明細を持たないが documents.form_data.items[] が非空のものを
-- 検出し、その items[] から capability_line_items を復元する。
--
-- 実行方法:
--   Cloud SQL Studio に貼り付け → 全文選択 → 実行
--   または
--   gcloud sql connect <INSTANCE> --user=postgres --database=<DB> \
--     < scripts/phase23_restore_lines_from_form_data.sql
--
-- 特性:
--   - BEGIN..COMMIT 単一トランザクション (失敗時自動 ROLLBACK)
--   - 冪等 (capability_line_items の UNIQUE (capability_id, line_no) で UPSERT)
--   - capability_line_items が空の PO のみ対象 (既に明細がある PO は触らない)
--   - 明細復元後、ヘッダの amount_ex_tax / due_date が NULL なら明細合計から逆算
-- =================================================================

BEGIN;

-- -----------------------------------------------------------------
-- [pre] 対象 PO 一覧 (実行前確認)
-- -----------------------------------------------------------------
SELECT 'TARGETS' AS phase,
       cc.id, cc.document_number, cc.record_type,
       cc.amount_ex_tax,
       jsonb_array_length(d.form_data->'items') AS form_items_len,
       (SELECT COUNT(*) FROM capability_line_items cli
         WHERE cli.capability_id = cc.id) AS current_lines
  FROM contract_capabilities cc
  JOIN documents d ON d.document_number = cc.document_number
 WHERE cc.record_type = 'purchase_order'
   AND d.form_data ? 'items'
   AND jsonb_typeof(d.form_data->'items') = 'array'
   AND jsonb_array_length(d.form_data->'items') > 0
   AND NOT EXISTS (
     SELECT 1 FROM capability_line_items cli
      WHERE cli.capability_id = cc.id
   )
 ORDER BY cc.id;

-- -----------------------------------------------------------------
-- [1/3] form_data.items[] → capability_line_items
-- -----------------------------------------------------------------
WITH items_unnested AS (
  SELECT
    cc.id AS capability_id,
    cc.document_number,
    x.item_idx AS line_no_seq,
    x.item
  FROM contract_capabilities cc
  JOIN documents d ON d.document_number = cc.document_number
  CROSS JOIN LATERAL jsonb_array_elements(d.form_data->'items')
                       WITH ORDINALITY AS x(item, item_idx)
  WHERE cc.record_type = 'purchase_order'
    AND d.form_data ? 'items'
    AND jsonb_typeof(d.form_data->'items') = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM capability_line_items cli
       WHERE cli.capability_id = cc.id
    )
),
ins AS (
  INSERT INTO capability_line_items (
    capability_id, line_no, item_name, spec,
    calc_method, payment_method, payment_terms,
    quantity, unit_price, amount_ex_tax,
    delivery_date, payment_date, cycle, billing_day,
    term_start, term_end, inspected_amount_ex_tax
  )
  SELECT
    capability_id,
    COALESCE(NULLIF(item->>'line_no', '')::int, line_no_seq::int) AS line_no,
    COALESCE(item->>'item_name', item->>'description', '')        AS item_name,
    COALESCE(item->>'spec', '')                                   AS spec,
    COALESCE(NULLIF(item->>'calc_method', ''),    'FIXED')        AS calc_method,
    COALESCE(NULLIF(item->>'payment_method', ''), '')             AS payment_method,
    COALESCE(NULLIF(item->>'payment_terms', ''),  '')             AS payment_terms,
    COALESCE(NULLIF(item->>'quantity', '')::numeric,   1)         AS quantity,
    COALESCE(NULLIF(item->>'unit_price', '')::numeric, 0)         AS unit_price,
    COALESCE(
      NULLIF(item->>'amount_ex_tax', '')::numeric,
      NULLIF(item->>'amount',        '')::numeric,
      COALESCE(NULLIF(item->>'quantity', '')::numeric,   1)
        * COALESCE(NULLIF(item->>'unit_price', '')::numeric, 0),
      0
    )                                                              AS amount_ex_tax,
    NULLIF(item->>'delivery_date', '')::date                       AS delivery_date,
    NULLIF(item->>'payment_date',  '')::date                       AS payment_date,
    NULLIF(item->>'cycle',         '')                             AS cycle,
    NULLIF(item->>'billing_day',   '')::int                        AS billing_day,
    NULLIF(item->>'term_start',    '')::date                       AS term_start,
    NULLIF(item->>'term_end',      '')::date                       AS term_end,
    0                                                              AS inspected_amount_ex_tax
  FROM items_unnested
  ON CONFLICT (capability_id, line_no) DO UPDATE SET
    item_name      = EXCLUDED.item_name,
    spec           = EXCLUDED.spec,
    calc_method    = EXCLUDED.calc_method,
    payment_method = EXCLUDED.payment_method,
    payment_terms  = EXCLUDED.payment_terms,
    quantity       = EXCLUDED.quantity,
    unit_price     = EXCLUDED.unit_price,
    amount_ex_tax  = EXCLUDED.amount_ex_tax,
    delivery_date  = EXCLUDED.delivery_date,
    payment_date   = EXCLUDED.payment_date,
    cycle          = EXCLUDED.cycle,
    billing_day    = EXCLUDED.billing_day,
    term_start     = EXCLUDED.term_start,
    term_end       = EXCLUDED.term_end,
    updated_at     = CURRENT_TIMESTAMP
  RETURNING id, capability_id, line_no, amount_ex_tax
)
SELECT '[1/3] items→capability_line_items' AS step,
       COUNT(*) AS rows_inserted
  FROM ins;

-- -----------------------------------------------------------------
-- [2/3] ヘッダの amount_ex_tax / tax_amount / amount_inc_tax を
--       明細合計から逆算 (NULL のもののみ)
-- -----------------------------------------------------------------
WITH upd AS (
  UPDATE contract_capabilities cc
     SET amount_ex_tax  = sub.total,
         tax_amount     = CEIL(sub.total * COALESCE(cc.tax_rate, 10) / 100.0),
         amount_inc_tax = sub.total + CEIL(sub.total * COALESCE(cc.tax_rate, 10) / 100.0),
         updated_at     = CURRENT_TIMESTAMP
    FROM (
      SELECT capability_id, SUM(amount_ex_tax) AS total
        FROM capability_line_items
       GROUP BY capability_id
    ) sub
   WHERE cc.id = sub.capability_id
     AND cc.record_type = 'purchase_order'
     AND cc.amount_ex_tax IS NULL
     AND sub.total > 0
   RETURNING cc.id
)
SELECT '[2/3] header amount backfilled' AS step,
       COUNT(*) AS rows_updated
  FROM upd;

-- -----------------------------------------------------------------
-- [3/3] ヘッダの due_date を明細の最大 delivery_date から補完
--       (NULL のもののみ)
-- -----------------------------------------------------------------
WITH upd AS (
  UPDATE contract_capabilities cc
     SET due_date   = sub.max_dd,
         updated_at = CURRENT_TIMESTAMP
    FROM (
      SELECT capability_id, MAX(delivery_date) AS max_dd
        FROM capability_line_items
       WHERE delivery_date IS NOT NULL
       GROUP BY capability_id
    ) sub
   WHERE cc.id = sub.capability_id
     AND cc.record_type = 'purchase_order'
     AND cc.due_date IS NULL
   RETURNING cc.id
)
SELECT '[3/3] header due_date backfilled' AS step,
       COUNT(*) AS rows_updated
  FROM upd;

-- -----------------------------------------------------------------
-- [post] 結果確認: ARC-PO-2026-0019 の最終状態
-- -----------------------------------------------------------------
SELECT 'AFTER restore (ARC-PO-2026-0019)' AS phase,
       cc.id, cc.document_number, cc.record_type, cc.contract_category,
       cc.amount_ex_tax, cc.amount_inc_tax, cc.tax_rate, cc.due_date,
       (SELECT COUNT(*) FROM capability_line_items cli
         WHERE cli.capability_id = cc.id) AS line_count
  FROM contract_capabilities cc
 WHERE cc.document_number = 'ARC-PO-2026-0019';

-- 復元された明細の中身も確認
SELECT 'AFTER restore (lines of ARC-PO-2026-0019)' AS phase,
       cli.id, cli.line_no, cli.item_name, cli.spec,
       cli.quantity, cli.unit_price, cli.amount_ex_tax,
       cli.delivery_date
  FROM capability_line_items cli
  JOIN contract_capabilities cc ON cc.id = cli.capability_id
 WHERE cc.document_number = 'ARC-PO-2026-0019'
 ORDER BY cli.line_no;

COMMIT;

-- ★ 成功条件:
--   - [1/3] rows_inserted > 0
--   - AFTER restore (ARC-PO-2026-0019) の line_count > 0
--   - AFTER restore (lines of ...) に 1 行以上表示される
