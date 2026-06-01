-- 0012_sync_triggers.sql
-- C5 の狙い(worker 書込→新スキーマ追従)を worker 無改修で実現する。
-- old テーブルへの AFTER INSERT/UPDATE トリガで新テーブルへ upsert(0008-0011 と同マッピング)。
-- トリガ関数は EXCEPTION で握り潰し、worker の書込を絶対に壊さない(失敗は WARNING のみ)。
--
-- id 空間分離: Search /api/v3 の serial 採番を高レンジ(>=1e9)へ寄せ、トリガは id 保存
--   (低レンジ=worker 由来)とすることで両者の id 衝突を回避する。
--   contracts は Search(/api/v3)+ トリガ の二重書き手のため必須。

-- ── id 空間分離(Search serial を高レンジへ)──────────────────────
SELECT setval(pg_get_serial_sequence('contracts', 'id'),
              GREATEST(1000000000, (SELECT COALESCE(MAX(id), 1) FROM contracts)));
SELECT setval(pg_get_serial_sequence('source_ips', 'id'),
              GREATEST(1000000000, (SELECT COALESCE(MAX(id), 1) FROM source_ips)));
SELECT setval(pg_get_serial_sequence('works', 'id'),
              GREATEST(1000000000, (SELECT COALESCE(MAX(id), 1) FROM works)));
SELECT setval(pg_get_serial_sequence('contract_works', 'id'),
              GREATEST(1000000000, (SELECT COALESCE(MAX(id), 1) FROM contract_works)));

-- ── 1) contract_capabilities → contracts ────────────────────────
CREATE OR REPLACE FUNCTION lb_sync_contracts() RETURNS trigger AS $fn$
BEGIN
  INSERT INTO contracts (
    id, document_number, contract_level, record_type, contract_category, contract_type,
    contract_title, primary_vendor_id, origin, contract_status, lifecycle_stage,
    effective_date, expiration_date, auto_renewal, renewal_notice_months, alert_lead_months,
    alert_slack_channels, alert_slack_mentions, source_system, legalon_url, cloudsign_url,
    drive_url, purpose_codes, scope, sublicense_allowed, overseas_allowed, translation_allowed,
    ebook_allowed, merchandising_allowed, video_adaptation_allowed, game_adaptation_allowed,
    risk_flags, legal_review_required, scope_confidence, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.document_number,
    CASE NEW.record_type
      WHEN 'master_contract' THEN 'master'
      WHEN 'license_condition' THEN 'individual'
      WHEN 'publication_condition' THEN 'individual'
      ELSE 'standalone' END,
    NEW.record_type, NEW.contract_category, NEW.contract_type, NEW.contract_title, NEW.vendor_id,
    'workflow', NEW.contract_status,
    CASE NEW.contract_status WHEN 'executed' THEN 'executed' WHEN 'confirmed' THEN 'executed'
      WHEN 'pending' THEN 'requested' ELSE NEW.contract_status END,
    NEW.effective_date, NEW.expiration_date, COALESCE(NEW.auto_renewal, FALSE),
    NEW.renewal_notice_months, NEW.alert_lead_months,
    COALESCE(NEW.alert_slack_channels, '[]'::jsonb), COALESCE(NEW.alert_slack_mentions, '[]'::jsonb),
    NEW.source_system, NEW.legalon_url, NEW.cloudsign_url, NEW.drive_url,
    COALESCE(NEW.purpose_codes, '{}'), NEW.scope, NEW.sublicense_allowed,
    COALESCE(NEW.overseas_allowed, FALSE), COALESCE(NEW.translation_allowed, FALSE),
    COALESCE(NEW.ebook_allowed, FALSE), COALESCE(NEW.merchandising_allowed, FALSE),
    COALESCE(NEW.video_adaptation_allowed, FALSE), COALESCE(NEW.game_adaptation_allowed, FALSE),
    COALESCE(NEW.risk_flags, '{}'::jsonb), COALESCE(NEW.legal_review_required, FALSE),
    NEW.scope_confidence, NEW.created_at, NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    document_number = EXCLUDED.document_number, contract_category = EXCLUDED.contract_category,
    contract_type = EXCLUDED.contract_type, contract_title = EXCLUDED.contract_title,
    primary_vendor_id = EXCLUDED.primary_vendor_id, contract_status = EXCLUDED.contract_status,
    lifecycle_stage = EXCLUDED.lifecycle_stage, effective_date = EXCLUDED.effective_date,
    expiration_date = EXCLUDED.expiration_date, auto_renewal = EXCLUDED.auto_renewal,
    purpose_codes = EXCLUDED.purpose_codes, updated_at = now();
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'lb_sync_contracts failed (cc.id=%): %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_contracts ON contract_capabilities;
CREATE TRIGGER trg_sync_contracts AFTER INSERT OR UPDATE ON contract_capabilities
  FOR EACH ROW EXECUTE FUNCTION lb_sync_contracts();

-- ── 2) capability_financial_conditions → contract_financial_terms ──
CREATE OR REPLACE FUNCTION lb_sync_cft() RETURNS trigger AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = NEW.capability_id) THEN
    RETURN NULL; -- 親契約未同期(順序前後)。FK 違反回避。
  END IF;
  INSERT INTO contract_financial_terms (
    id, contract_id, condition_no, region_language_label, calc_method, rate_pct,
    base_price_label, calc_period, calc_period_kind, calc_period_close_month, currency,
    formula_text, payment_terms, mg_amount, ag_amount, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.capability_id, NEW.condition_no, NEW.region_language_label, NEW.calc_method,
    NEW.rate_pct, NEW.base_price_label, NEW.calc_period, NEW.calc_period_kind,
    NEW.calc_period_close_month, COALESCE(NEW.currency, 'JPY'), NEW.formula_text,
    NEW.payment_terms, COALESCE(NEW.mg_amount, 0), COALESCE(NEW.ag_amount, 0),
    NEW.created_at, NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    condition_no = EXCLUDED.condition_no, calc_method = EXCLUDED.calc_method,
    rate_pct = EXCLUDED.rate_pct, mg_amount = EXCLUDED.mg_amount, ag_amount = EXCLUDED.ag_amount,
    payment_terms = EXCLUDED.payment_terms, updated_at = now();
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'lb_sync_cft failed (cfc.id=%): %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_cft ON capability_financial_conditions;
CREATE TRIGGER trg_sync_cft AFTER INSERT OR UPDATE ON capability_financial_conditions
  FOR EACH ROW EXECUTE FUNCTION lb_sync_cft();

-- ── 3) capability_line_items → contract_line_items ───────────────
CREATE OR REPLACE FUNCTION lb_sync_cli() RETURNS trigger AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = NEW.capability_id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO contract_line_items (
    id, contract_id, line_no, category, item_name, spec, calc_method, payment_method,
    payment_terms, quantity, unit_price, amount_ex_tax, delivery_date, payment_date,
    cycle, billing_day, term_start, term_end, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.capability_id, NEW.line_no, NEW.category, NEW.item_name, NEW.spec,
    NEW.calc_method, NEW.payment_method, NEW.payment_terms, NEW.quantity, NEW.unit_price,
    NEW.amount_ex_tax, NEW.delivery_date, NEW.payment_date, NEW.cycle, NEW.billing_day,
    NEW.term_start, NEW.term_end, NEW.created_at, NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    line_no = EXCLUDED.line_no, item_name = EXCLUDED.item_name, quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price, amount_ex_tax = EXCLUDED.amount_ex_tax, updated_at = now();
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'lb_sync_cli failed (cli.id=%): %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_cli ON capability_line_items;
CREATE TRIGGER trg_sync_cli AFTER INSERT OR UPDATE ON capability_line_items
  FOR EACH ROW EXECUTE FUNCTION lb_sync_cli();

-- ── 4) royalty_calculations → royalty_statements ─────────────────
CREATE OR REPLACE FUNCTION lb_sync_royalty_statements() RETURNS trigger AS $fn$
BEGIN
  INSERT INTO royalty_statements (
    id, backlog_issue_key, contract_id, financial_term_id, manufacturing_event_id, calc_type,
    unit_price, quantity, sample_quantity, billable_quantity, rate_pct, gross_royalty_ex_tax,
    mg_amount, mg_consumed_before, mg_consumed_this_time, mg_consumed_after, mg_remaining,
    mg_fully_consumed, mg_topup_this_time, ag_amount, ag_consumed_before, ag_consumed_this_time,
    ag_consumed_after, ag_remaining, ag_fully_consumed, actual_royalty_ex_tax, tax_rate,
    tax_amount, total_payment_inc_tax, currency, period, reporting_deadline, payment_due_date,
    notes, created_at
  ) VALUES (
    NEW.id, NEW.backlog_issue_key,
    (SELECT c.id FROM contracts c WHERE c.id = NEW.capability_id),
    (SELECT t.id FROM contract_financial_terms t WHERE t.id = NEW.capability_financial_condition_id),
    (SELECT m.id FROM manufacturing_events m WHERE m.id = NEW.manufacturing_event_id),
    NEW.calc_type, NEW.unit_price, NEW.quantity, NEW.sample_quantity, NEW.billable_quantity,
    NEW.rate_pct, NEW.gross_royalty_ex_tax, NEW.mg_amount, NEW.mg_consumed_before,
    NEW.mg_consumed_this_time, NEW.mg_consumed_after, NEW.mg_remaining,
    COALESCE(NEW.mg_fully_consumed, FALSE), COALESCE(NEW.mg_topup_this_time, 0),
    COALESCE(NEW.ag_amount, 0), COALESCE(NEW.ag_consumed_before, 0),
    COALESCE(NEW.ag_consumed_this_time, 0), COALESCE(NEW.ag_consumed_after, 0),
    COALESCE(NEW.ag_remaining, 0), COALESCE(NEW.ag_fully_consumed, FALSE),
    NEW.actual_royalty_ex_tax, COALESCE(NEW.tax_rate, 10), NEW.tax_amount,
    NEW.total_payment_inc_tax, COALESCE(NEW.currency, 'JPY'), NEW.period, NEW.reporting_deadline,
    NEW.payment_due_date, NEW.notes, NEW.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    gross_royalty_ex_tax = EXCLUDED.gross_royalty_ex_tax, mg_remaining = EXCLUDED.mg_remaining,
    actual_royalty_ex_tax = EXCLUDED.actual_royalty_ex_tax, total_payment_inc_tax = EXCLUDED.total_payment_inc_tax,
    period = EXCLUDED.period;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'lb_sync_royalty_statements failed (rc.id=%): %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_royalty_statements ON royalty_calculations;
CREATE TRIGGER trg_sync_royalty_statements AFTER INSERT OR UPDATE ON royalty_calculations
  FOR EACH ROW EXECUTE FUNCTION lb_sync_royalty_statements();

-- ── 5) royalty_payments → payments(payment_no をキーに upsert)──────
CREATE OR REPLACE FUNCTION lb_sync_payments() RETURNS trigger AS $fn$
BEGIN
  INSERT INTO payments (
    payment_no, direction, payment_kind, work_id, department_code, contract_id,
    period, total_amount, status, due_date, backlog_issue_key, created_at
  ) VALUES (
    'PAY-MIG-' || NEW.id, 'outbound', 'royalty', NULL, '__migrated_royalty__',
    (SELECT c.id FROM contracts c WHERE c.id = (
        SELECT rc.capability_id FROM royalty_calculations rc
         WHERE rc.manufacturing_event_id = NEW.manufacturing_event_id
           AND rc.capability_id IS NOT NULL LIMIT 1)),
    NEW.period, NEW.total_amount,
    CASE NEW.status WHEN 'paid' THEN 'paid' WHEN 'calculated' THEN 'calculated' ELSE NEW.status END,
    NEW.payment_due_date, NEW.backlog_issue_key, NEW.created_at
  )
  ON CONFLICT (payment_no) DO UPDATE SET
    total_amount = EXCLUDED.total_amount, status = EXCLUDED.status,
    contract_id = EXCLUDED.contract_id, period = EXCLUDED.period;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'lb_sync_payments failed (rp.id=%): %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

-- payment_no UNIQUE 制約は 0006 で UNIQUE(payment_no) 済み(ON CONFLICT 用)。
DROP TRIGGER IF EXISTS trg_sync_payments ON royalty_payments;
CREATE TRIGGER trg_sync_payments AFTER INSERT OR UPDATE ON royalty_payments
  FOR EACH ROW EXECUTE FUNCTION lb_sync_payments();
