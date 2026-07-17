/**
 * Phase 7 G3b — 互換VIEW(capability_line_items / capability_financial_conditions)を
 * DBオブジェクトに依存せず condition_lines から直読みするためのインライン射影 SQL。
 *
 * 0101 で定義された VIEW と列単位で完全一致する SELECT 文字列を返す。呼び出し側は
 *   `FROM (${CLI_VIEW_SQL}) cli`  /  `FROM (${CFC_VIEW_SQL}) cfc`
 * のようにサブクエリとして埋め込むことで、既存クエリの列参照・フィルタを一切変えずに
 * VIEW への textual 参照だけを除去できる(挙動不変)。VIEW 撤去(G4)の前提。
 *
 * ※ VIEW が NULL 固定にしていた列(condition_kind / source_ip_id 等)はここでも NULL の
 *   ままにして忠実さを優先する。実体列を露出したい呼び出し側は、この射影を使わず
 *   condition_lines を個別に直読みすること(receivableMapService 参照)。
 */

// capability_line_items(cli) と同一射影 (0101: 355-392)。
export const CLI_VIEW_SQL = `SELECT
    cl.id AS id,
    cl.capability_id AS capability_id,
    (cl.line_no-1000) AS line_no,
    cl.category AS category,
    cl.condition_name AS item_name,
    cl.spec AS spec,
    CASE cl.payment_scheme WHEN 'subscription' THEN 'SUBSCRIPTION' ELSE 'FIXED' END AS calc_method,
    cl.payment_method AS payment_method,
    cl.payment_terms AS payment_terms,
    cl.quantity::numeric AS quantity,
    cl.unit_price AS unit_price,
    cl.amount_ex_tax AS amount_ex_tax,
    cl.delivery_date AS delivery_date,
    cl.payment_date AS payment_date,
    cl.cycle AS cycle,
    cl.billing_day AS billing_day,
    cl.term_start AS term_start,
    cl.term_end AS term_end,
    cl.created_at AS created_at,
    cl.updated_at AS updated_at,
    NULL::numeric(15,2) AS inspected_amount_ex_tax,
    NULL::timestamp with time zone AS last_alert_at,
    NULL::integer AS alert_count,
    NULL::integer AS source_ip_id,
    cl.source_work_id AS work_id,
    NULL::integer AS master_contract_id,
    NULL::integer AS ringi_id,
    cl.status_flags AS status_flags,
    cl.is_inbound AS is_inbound,
    CASE cl.direction WHEN 'receivable' THEN 'out' ELSE 'in' END AS flow_direction,
    NULL::character varying(20) AS fee_type,
    cl.rate_pct AS rate_pct,
    cl.deliverable_ownership AS deliverable_ownership,
    NULL::text AS royalty_calc_basis
  FROM condition_lines cl
  WHERE cl.legacy_role = 'cli'`;

// capability_financial_conditions(cfc) と同一射影 (0101: 304-353)。
export const CFC_VIEW_SQL = `SELECT
    cl.id AS id,
    cl.capability_id AS capability_id,
    cl.line_no AS condition_no,
    cl.condition_name AS region_language_label,
    CASE cl.payment_scheme WHEN 'royalty' THEN 'ROYALTY' WHEN 'subscription' THEN 'SUBSCRIPTION' WHEN 'per_unit' THEN 'PER_UNIT' WHEN 'installment' THEN 'INSTALLMENT' ELSE 'FIXED' END AS calc_method,
    cl.rate_pct AS rate_pct,
    cl.base_price_label AS base_price_label,
    cl.calc_period AS calc_period,
    cl.calc_period_kind AS calc_period_kind,
    cl.calc_period_close_month AS calc_period_close_month,
    cl.currency AS currency,
    cl.formula_text AS formula_text,
    cl.payment_terms AS payment_terms,
    cl.mg_amount AS mg_amount,
    cl.ag_amount AS ag_amount,
    cl.created_at AS created_at,
    cl.updated_at AS updated_at,
    cl.source_work_id AS work_id,
    cl.source_work_id AS source_work_id,
    cl.source_material_id AS source_material_id,
    NULL::character varying(20) AS condition_kind,
    cl.counterparty_vendor_id AS counterparty_vendor_id,
    NULL::character varying(20) AS basis,
    cl.unit_price AS unit_price,
    cl.cycle AS cycle,
    cl.billing_day AS billing_day,
    cl.term_start AS term_start,
    cl.term_end AS term_end,
    NULL::numeric(15,2) AS advance_amount,
    NULL::numeric(15,2) AS forecast_amount,
    cl.condition_name AS condition_name,
    cl.calc_type AS calc_type,
    cl.fixed_kind AS fixed_kind,
    cl.subscription_cycle AS subscription_cycle,
    cl.unit_amount AS unit_amount,
    cl.guarantee_type AS guarantee_type,
    cl.region_territory AS region_territory,
    cl.region_language AS region_language,
    cl.applies_scope AS applies_scope,
    NULL::integer AS copied_from_condition_id,
    cl.manufacturer AS manufacturer,
    cl.seller AS seller,
    cl.max_region AS max_region,
    cl.max_language AS max_language,
    cl.is_addon AS is_addon,
    cl.quantity::text AS quantity
  FROM condition_lines cl
  WHERE cl.legacy_role = 'cfc'`;
