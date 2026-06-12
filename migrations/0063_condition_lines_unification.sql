-- 0063_condition_lines_unification.sql
-- データ構造刷新: 統一条件明細(condition_lines)スキーマを本番DDLとして追加。
--   契約・条件・実績を condition_lines / condition_events / works 中心に統一する。
--   設計: docs/condition_lines_unification_design.md / _implementation_plan.md
--
-- これまで services/worker/src/lib/db.ts の initDb に入れていた DDL を、本番の
-- 単一DDL所有者である migrations/ に移設(initDb は RUN_INIT_DB=true の後方互換のみ)。
-- 追加のみ・冪等(IF NOT EXISTS)。末尾で app ロール(legalbridge)へ権限付与。
--
-- 注: バックフィル(旧明細→condition_lines 等)は別途 scripts/restructure_*.ts で実施。
--     本migrationはスキーマ作成のみ。

ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS structural_role VARCHAR(10);

ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS parent_capability_id INTEGER REFERENCES contract_capabilities(id);

ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS template_family VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_cc_parent ON contract_capabilities(parent_capability_id);

CREATE TABLE IF NOT EXISTS contract_scopes (
      id SERIAL PRIMARY KEY,
      capability_id INTEGER NOT NULL REFERENCES contract_capabilities(id) ON DELETE CASCADE,
      scope VARCHAR(20) NOT NULL CHECK (scope IN ('service','license_use')),
      UNIQUE (capability_id, scope)
    );

CREATE INDEX IF NOT EXISTS idx_cs_capability ON contract_scopes(capability_id);

CREATE TABLE IF NOT EXISTS works (
      id SERIAL PRIMARY KEY,
      work_code VARCHAR(40) UNIQUE NOT NULL,
      title TEXT NOT NULL,
      parent_work_id INTEGER REFERENCES works(id),
      ledger_code VARCHAR(40),
      remarks TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE IF NOT EXISTS work_components (
      id SERIAL PRIMARY KEY,
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      component_no INTEGER NOT NULL,
      component_kind VARCHAR(50),
      material_id INTEGER REFERENCES materials(id),
      notes TEXT,
      UNIQUE (work_id, component_no)
    );

CREATE TABLE IF NOT EXISTS condition_lines (
      id SERIAL PRIMARY KEY,
      capability_id INTEGER NOT NULL REFERENCES contract_capabilities(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      line_code VARCHAR(60) UNIQUE,
      subject TEXT,
      ledger_code VARCHAR(40),
      material_id INTEGER REFERENCES materials(id),
      work_id INTEGER REFERENCES works(id),
      direction VARCHAR(10) NOT NULL DEFAULT 'payable'
        CHECK (direction IN ('payable','receivable')),
      payment_scheme VARCHAR(20) NOT NULL
        CHECK (payment_scheme IN ('lump_sum','per_unit','installment','subscription','royalty')),
      rights_attribution VARCHAR(20)
        CHECK (rights_attribution IN ('transfer','retained_license','license_only','joint')),
      currency VARCHAR(10) DEFAULT 'JPY',
      notes TEXT,
      quantity DECIMAL(15,4),
      unit_price DECIMAL(15,2),
      amount_ex_tax DECIMAL(15,2),
      delivery_date DATE,
      term_start DATE,
      term_end DATE,
      cycle VARCHAR(50),
      billing_day INTEGER,
      calc_period_kind VARCHAR(20),
      calc_period_close_month SMALLINT,
      rate_pct DECIMAL(7,4),
      base_price_label TEXT,
      mg_amount DECIMAL(15,2),
      ag_amount DECIMAL(15,2),
      closed_at TIMESTAMP WITH TIME ZONE,
      closed_reason TEXT,
      cancelled_at TIMESTAMP WITH TIME ZONE,
      source_line_item_id INTEGER,
      source_condition_id INTEGER,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (capability_id, line_no),
      CONSTRAINT cl_scheme_royalty_cols CHECK (
        payment_scheme = 'royalty'
        OR (rate_pct IS NULL AND mg_amount IS NULL AND ag_amount IS NULL)),
      CONSTRAINT cl_scheme_depletable_target CHECK (
        payment_scheme IN ('subscription','royalty') OR amount_ex_tax IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_cl_capability ON condition_lines(capability_id);

CREATE INDEX IF NOT EXISTS idx_cl_work ON condition_lines(work_id);

ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS spec TEXT;

ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS category VARCHAR(100);

ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS calc_method VARCHAR(50);

ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);

ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS payment_terms TEXT;

ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS payment_date DATE;

ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS fee_type VARCHAR(50);

ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS calc_period VARCHAR(50);

ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS formula_text TEXT;

ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS source_seq_no INTEGER;

CREATE TABLE IF NOT EXISTS work_component_lines (
      component_id INTEGER NOT NULL REFERENCES work_components(id) ON DELETE CASCADE,
      condition_line_id INTEGER NOT NULL REFERENCES condition_lines(id),
      PRIMARY KEY (component_id, condition_line_id)
    );

CREATE TABLE IF NOT EXISTS condition_line_installments (
      id SERIAL PRIMARY KEY,
      condition_line_id INTEGER NOT NULL REFERENCES condition_lines(id) ON DELETE CASCADE,
      installment_no INTEGER NOT NULL,
      trigger_kind VARCHAR(20) NOT NULL
        CHECK (trigger_kind IN ('on_signing','on_delivery','on_inspection','fixed_date')),
      planned_amount_ex_tax DECIMAL(15,2) NOT NULL,
      due_date DATE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (condition_line_id, installment_no)
    );

CREATE TABLE IF NOT EXISTS condition_events (
      id SERIAL PRIMARY KEY,
      condition_line_id INTEGER NOT NULL REFERENCES condition_lines(id),
      event_no INTEGER NOT NULL,
      event_type VARCHAR(20) NOT NULL
        CHECK (event_type IN ('inspection','royalty_calc','payment')),
      installment_id INTEGER REFERENCES condition_line_installments(id),
      document_id INTEGER REFERENCES documents(id),
      backlog_issue_key VARCHAR(50),
      occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
      period VARCHAR(7),
      amount_ex_tax DECIMAL(15,2) NOT NULL DEFAULT 0,
      voided_at TIMESTAMP WITH TIME ZONE,
      void_reason TEXT,
      source_delivery_line_item_id INTEGER,
      source_royalty_calculation_id INTEGER,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (condition_line_id, event_no),
      CONSTRAINT ce_document_pairing CHECK (
        (event_type IN ('inspection','royalty_calc') AND document_id IS NOT NULL)
        OR (event_type = 'payment' AND document_id IS NULL))
    );

CREATE INDEX IF NOT EXISTS idx_ce_line ON condition_events(condition_line_id);

CREATE INDEX IF NOT EXISTS idx_ce_document ON condition_events(document_id);

CREATE INDEX IF NOT EXISTS idx_ce_line_period ON condition_events(condition_line_id, period);

ALTER TABLE delivery_line_items ADD COLUMN IF NOT EXISTS condition_event_id INTEGER REFERENCES condition_events(id);

ALTER TABLE delivery_line_items ADD COLUMN IF NOT EXISTS condition_line_id INTEGER REFERENCES condition_lines(id);

ALTER TABLE royalty_calculations ADD COLUMN IF NOT EXISTS condition_event_id INTEGER REFERENCES condition_events(id);

ALTER TABLE royalty_calculations ADD COLUMN IF NOT EXISTS condition_line_id INTEGER REFERENCES condition_lines(id);

CREATE OR REPLACE VIEW condition_line_status_v AS
     SELECT
       cl.id, cl.line_code, cl.capability_id, cl.payment_scheme, cl.direction,
       CASE
         WHEN cl.cancelled_at IS NOT NULL THEN 'cancelled'
         WHEN cl.closed_at IS NOT NULL THEN 'closed_short'
         WHEN cl.payment_scheme IN ('lump_sum','per_unit','installment') THEN
           CASE WHEN COALESCE(e.sum_amount,0) >= COALESCE(cl.amount_ex_tax,0) THEN 'fulfilled'
                WHEN COALESCE(e.sum_amount,0) > 0 THEN 'partially_fulfilled'
                ELSE 'open' END
         ELSE
           CASE WHEN cl.term_start IS NOT NULL AND CURRENT_DATE < cl.term_start THEN 'pending'
                WHEN cl.term_end IS NOT NULL AND CURRENT_DATE > cl.term_end THEN 'expired'
                ELSE 'active' END
       END AS status,
       COALESCE(e.sum_amount,0) AS consumed_amount,
       CASE WHEN cl.amount_ex_tax IS NOT NULL
            THEN cl.amount_ex_tax - COALESCE(e.sum_amount,0) END AS remaining_amount,
       COALESCE(e.event_count,0) AS event_count,
       e.last_event_at
     FROM condition_lines cl
     LEFT JOIN (
       SELECT condition_line_id, SUM(amount_ex_tax) AS sum_amount,
              COUNT(*) AS event_count, MAX(occurred_at) AS last_event_at
         FROM condition_events
        WHERE voided_at IS NULL
        GROUP BY condition_line_id
     ) e ON e.condition_line_id = cl.id;

CREATE OR REPLACE VIEW condition_line_balance_v AS
     SELECT cl.id AS condition_line_id, cl.line_code,
            cl.mg_amount, cl.ag_amount,
            COALESCE(d.mg_consumed,0) AS mg_consumed,
            GREATEST(0, COALESCE(cl.mg_amount,0) - COALESCE(d.mg_consumed,0)) AS mg_remaining,
            COALESCE(d.ag_consumed,0) AS ag_consumed,
            GREATEST(0, COALESCE(cl.ag_amount,0) - COALESCE(d.ag_consumed,0)) AS ag_remaining
       FROM condition_lines cl
       LEFT JOIN (
         SELECT ev.condition_line_id,
                SUM(COALESCE(rc.mg_consumed_this_time,0)) AS mg_consumed,
                SUM(COALESCE(rc.ag_consumed_this_time,0)) AS ag_consumed
           FROM condition_events ev
           JOIN royalty_calculations rc ON rc.condition_event_id = ev.id
          WHERE ev.voided_at IS NULL AND ev.event_type = 'royalty_calc'
          GROUP BY ev.condition_line_id
       ) d ON d.condition_line_id = cl.id
      WHERE cl.payment_scheme = 'royalty';

CREATE OR REPLACE VIEW condition_line_schedule_v AS
     WITH sched AS (
       SELECT cl.id AS condition_line_id, cl.line_code, cl.payment_scheme,
              cl.term_start,
              LEAST(COALESCE(cl.term_end, CURRENT_DATE), CURRENT_DATE) AS term_until,
              CASE
                WHEN cl.payment_scheme = 'subscription' THEN INTERVAL '1 month'
                WHEN cl.calc_period_kind = 'MONTHLY'    THEN INTERVAL '1 month'
                WHEN cl.calc_period_kind = 'QUARTERLY'  THEN INTERVAL '3 months'
                WHEN cl.calc_period_kind = 'SEMIANNUAL' THEN INTERVAL '6 months'
                WHEN cl.calc_period_kind = 'ANNUAL'     THEN INTERVAL '12 months'
              END AS step
         FROM condition_lines cl
        WHERE cl.term_start IS NOT NULL
          AND (cl.payment_scheme = 'subscription'
               OR (cl.payment_scheme = 'royalty'
                   AND cl.calc_period_kind IN ('MONTHLY','QUARTERLY','SEMIANNUAL','ANNUAL')))
     )
     SELECT s.condition_line_id, s.line_code, s.payment_scheme,
            to_char(gs, 'YYYY-MM') AS expected_period,
            EXISTS (
              SELECT 1 FROM condition_events e
               WHERE e.condition_line_id = s.condition_line_id
                 AND e.voided_at IS NULL
                 AND e.period = to_char(gs, 'YYYY-MM')
            ) AS issued,
            (gs < date_trunc('month', CURRENT_DATE)) AS overdue
       FROM sched s
       CROSS JOIN LATERAL generate_series(
         date_trunc('month', s.term_start), date_trunc('month', s.term_until), s.step
       ) AS gs
      WHERE s.step IS NOT NULL;

-- ---- app ロール(legalbridge)への権限付与 ----------------------------------
--   migration runner は postgres/lb_migrate で適用するため新オブジェクトは
--   その所有になる。アプリ(worker/search-api)は legalbridge ロールで接続するので
--   明示付与が必要(0013_grants.sql と同方針)。冪等(再付与は無害)。
DO $grant$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'condition_lines','condition_events','condition_line_installments',
    'contract_scopes','works','work_components','work_component_lines'
  ] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO legalbridge', t);
      -- SERIAL の所有シーケンスにも付与 (id 列)
      IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name=t AND column_name='id') THEN
        EXECUTE format(
          'GRANT USAGE, SELECT, UPDATE ON SEQUENCE %s TO legalbridge',
          pg_get_serial_sequence('public.'||t, 'id'))
        ;
      END IF;
    END IF;
  END LOOP;
END
$grant$;

GRANT SELECT ON condition_line_status_v   TO legalbridge;
GRANT SELECT ON condition_line_balance_v  TO legalbridge;
GRANT SELECT ON condition_line_schedule_v TO legalbridge;
