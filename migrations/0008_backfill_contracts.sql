-- 0008_backfill_contracts.sql
-- 既存(old)→ 新スキーマへのデータ移行(決定的・id保存・冪等)。
-- 対象: contract_capabilities → contracts / capability_financial_conditions →
--       contract_financial_terms / capability_line_items → contract_line_items。
-- id を保存して移行するため子FK(contract_id=capability_id)がそのまま整合する。
-- ledgers→works/source_ips(自社作品/外部原作の判別が必要)と contract_works/
-- parties(ledger_ref_id/additional_parties 由来)は判別フェーズで別途。
--
-- 注: これは「スナップショット移行」。worker が old を書き続ける間は新が陳腐化する
--     ため、継続同期は C5(worker 書込先差替)で一本化する。

-- 1) contract_capabilities → contracts(id 保存)
INSERT INTO contracts (
  id, document_number, contract_level, record_type, contract_category, contract_type,
  contract_title, primary_vendor_id, origin, contract_status, lifecycle_stage,
  effective_date, expiration_date, auto_renewal, renewal_notice_months, alert_lead_months,
  alert_slack_channels, alert_slack_mentions, source_system, legalon_url, cloudsign_url,
  drive_url, purpose_codes, scope, sublicense_allowed, overseas_allowed, translation_allowed,
  ebook_allowed, merchandising_allowed, video_adaptation_allowed, game_adaptation_allowed,
  risk_flags, legal_review_required, scope_confidence, created_at, updated_at
)
SELECT
  cc.id, cc.document_number,
  CASE cc.record_type
    WHEN 'master_contract'       THEN 'master'
    WHEN 'license_condition'     THEN 'individual'
    WHEN 'publication_condition' THEN 'individual'
    ELSE 'standalone'
  END,
  cc.record_type, cc.contract_category, cc.contract_type,
  cc.contract_title, cc.vendor_id, 'workflow', cc.contract_status,
  CASE cc.contract_status
    WHEN 'executed'  THEN 'executed'
    WHEN 'confirmed' THEN 'executed'
    WHEN 'pending'   THEN 'requested'
    ELSE cc.contract_status
  END,
  cc.effective_date, cc.expiration_date, COALESCE(cc.auto_renewal, FALSE),
  cc.renewal_notice_months, cc.alert_lead_months,
  COALESCE(cc.alert_slack_channels, '[]'::jsonb), COALESCE(cc.alert_slack_mentions, '[]'::jsonb),
  cc.source_system, cc.legalon_url, cc.cloudsign_url, cc.drive_url,
  COALESCE(cc.purpose_codes, '{}'), cc.scope, cc.sublicense_allowed,
  COALESCE(cc.overseas_allowed, FALSE), COALESCE(cc.translation_allowed, FALSE),
  COALESCE(cc.ebook_allowed, FALSE), COALESCE(cc.merchandising_allowed, FALSE),
  COALESCE(cc.video_adaptation_allowed, FALSE), COALESCE(cc.game_adaptation_allowed, FALSE),
  COALESCE(cc.risk_flags, '{}'::jsonb), COALESCE(cc.legal_review_required, FALSE),
  cc.scope_confidence, cc.created_at, cc.updated_at
FROM contract_capabilities cc
WHERE NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = cc.id);

-- 2) capability_financial_conditions → contract_financial_terms(id 保存, contract_id=capability_id)
INSERT INTO contract_financial_terms (
  id, contract_id, condition_no, region_language_label, calc_method, rate_pct,
  base_price_label, calc_period, calc_period_kind, calc_period_close_month, currency,
  formula_text, payment_terms, mg_amount, ag_amount, created_at, updated_at
)
SELECT
  cfc.id, cfc.capability_id, cfc.condition_no, cfc.region_language_label, cfc.calc_method,
  cfc.rate_pct, cfc.base_price_label, cfc.calc_period, cfc.calc_period_kind,
  cfc.calc_period_close_month, COALESCE(cfc.currency, 'JPY'), cfc.formula_text,
  cfc.payment_terms, COALESCE(cfc.mg_amount, 0), COALESCE(cfc.ag_amount, 0),
  cfc.created_at, cfc.updated_at
FROM capability_financial_conditions cfc
WHERE EXISTS (SELECT 1 FROM contracts c WHERE c.id = cfc.capability_id)
  AND NOT EXISTS (SELECT 1 FROM contract_financial_terms t WHERE t.id = cfc.id);

-- 3) capability_line_items → contract_line_items(id 保存, contract_id=capability_id)
INSERT INTO contract_line_items (
  id, contract_id, line_no, category, item_name, spec, calc_method, payment_method,
  payment_terms, quantity, unit_price, amount_ex_tax, delivery_date, payment_date,
  cycle, billing_day, term_start, term_end, created_at, updated_at
)
SELECT
  cli.id, cli.capability_id, cli.line_no, cli.category, cli.item_name, cli.spec,
  cli.calc_method, cli.payment_method, cli.payment_terms, cli.quantity, cli.unit_price,
  cli.amount_ex_tax, cli.delivery_date, cli.payment_date, cli.cycle, cli.billing_day,
  cli.term_start, cli.term_end, cli.created_at, cli.updated_at
FROM capability_line_items cli
WHERE EXISTS (SELECT 1 FROM contracts c WHERE c.id = cli.capability_id)
  AND NOT EXISTS (SELECT 1 FROM contract_line_items t WHERE t.id = cli.id);

-- 4) SERIAL シーケンスを移行後の MAX(id) に合わせる(以後の新規 INSERT が衝突しないように)
SELECT setval(pg_get_serial_sequence('contracts', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM contracts), 1));
SELECT setval(pg_get_serial_sequence('contract_financial_terms', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM contract_financial_terms), 1));
SELECT setval(pg_get_serial_sequence('contract_line_items', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM contract_line_items), 1));
