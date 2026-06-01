-- 0006_financial_deliverables.sql
-- 作品中心スキーマ: 財務・成果物層 + work_materials(§3.2/§3.4)。純追加。
-- 既存 baseline テーブル(manufacturing_events / delivery_line_items)は ALTER で列追加。
-- FK が揃う順に作成: invoices → payments → deliverables → work_materials → royalty_statements → alerts。

-- 既存 manufacturing_events に製品リンクを追加(新モデル連携)
ALTER TABLE manufacturing_events ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id);

-- 販売実績(売上報告ベースのロイヤリティ用)
CREATE TABLE IF NOT EXISTS sales_events (
  id                 SERIAL PRIMARY KEY,
  product_id         INTEGER REFERENCES products(id),
  backlog_issue_key  VARCHAR(50),
  period             VARCHAR(7),                  -- YYYY-MM
  sold_quantity      DECIMAL(15,4),
  sales_amount       DECIMAL(15,2),
  report_date        DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_events_product ON sales_events(product_id);

-- 請求(受領=支払側 / 発行=入金側)
CREATE TABLE IF NOT EXISTS invoices (
  id                          SERIAL PRIMARY KEY,
  invoice_no                  VARCHAR(40),
  direction                   VARCHAR(10),         -- received / issued
  contract_id                 INTEGER REFERENCES contracts(id),
  work_id                     INTEGER REFERENCES works(id),
  delivery_event_id           INTEGER REFERENCES delivery_events(id),
  counterparty_vendor_id      INTEGER REFERENCES vendors(id),
  amount_ex_tax               DECIMAL(15,2),
  tax_amount                  DECIMAL(15,2),
  total_amount                DECIMAL(15,2),
  qualified_invoice           BOOLEAN NOT NULL DEFAULT FALSE,
  invoice_registration_number VARCHAR(50),
  received_date               DATE,
  issued_date                 DATE,
  due_date                    DATE,
  status                      VARCHAR(20),         -- draft / sent / received / matched / paid
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_contract ON invoices(contract_id);
CREATE INDEX IF NOT EXISTS idx_invoices_work ON invoices(work_id);

-- 支払・入金 統一台帳
CREATE TABLE IF NOT EXISTS payments (
  id                       SERIAL PRIMARY KEY,
  payment_no               VARCHAR(40) UNIQUE,
  direction                VARCHAR(10),            -- outbound / inbound
  payment_kind             VARCHAR(30),            -- royalty / service_fee / advance / lump_sum / sublicense_income / overhead
  work_id                  INTEGER REFERENCES works(id),
  product_id               INTEGER REFERENCES products(id),
  department_code          VARCHAR(50),
  expense_category         VARCHAR(40) REFERENCES expense_categories(expense_code),
  contract_id              INTEGER REFERENCES contracts(id),
  invoice_id               INTEGER REFERENCES invoices(id),
  financial_term_id        INTEGER REFERENCES contract_financial_terms(id),
  counterparty_vendor_id   INTEGER REFERENCES vendors(id),
  paid_from_bank_account_id INTEGER REFERENCES vendor_bank_accounts(id),
  period                   VARCHAR(7),
  amount_ex_tax            DECIMAL(15,2),
  tax_rate                 INTEGER,
  tax_amount               DECIMAL(15,2),
  withholding_tax          DECIMAL(15,2),
  total_amount             DECIMAL(15,2),
  currency                 VARCHAR(10) DEFAULT 'JPY',
  fx_rate                  DECIMAL(15,6),
  amount_jpy               DECIMAL(15,2),
  fx_rate_date             DATE,
  adjustment_of_payment_id INTEGER REFERENCES payments(id),
  status                   VARCHAR(20),            -- planned / calculated / approved / paid / received
  due_date                 DATE,
  paid_date                DATE,
  source_document_number   VARCHAR(100),
  backlog_issue_key        VARCHAR(50),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (work_id IS NOT NULL OR department_code IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_payments_work ON payments(work_id);
CREATE INDEX IF NOT EXISTS idx_payments_contract ON payments(contract_id);
CREATE INDEX IF NOT EXISTS idx_payments_kind ON payments(payment_kind);

-- 成果物(納品物)+ 版/リテイク
CREATE TABLE IF NOT EXISTS deliverables (
  id                          SERIAL PRIMARY KEY,
  deliverable_code            VARCHAR(60),
  contract_id                 INTEGER REFERENCES contracts(id),
  contract_line_item_id       INTEGER REFERENCES contract_line_items(id),
  work_id                     INTEGER REFERENCES works(id),
  product_id                  INTEGER REFERENCES products(id),
  vendor_id                   INTEGER REFERENCES vendors(id),
  deliverable_name            TEXT,
  deliverable_type            VARCHAR(40),         -- illustration / manuscript / design / music / data
  spec                        TEXT,
  current_version             INTEGER NOT NULL DEFAULT 1,
  status                      VARCHAR(20),         -- submitted / in_review / revision_requested / accepted / rejected
  accepted_delivery_event_id  INTEGER REFERENCES delivery_events(id),
  file_asset_id               INTEGER REFERENCES external_assets(id),
  drive_link                  TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliverables_contract ON deliverables(contract_id);
CREATE INDEX IF NOT EXISTS idx_deliverables_work ON deliverables(work_id);

CREATE TABLE IF NOT EXISTS deliverable_revisions (
  id              SERIAL PRIMARY KEY,
  deliverable_id  INTEGER NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  revision_no     INTEGER NOT NULL,
  file_asset_id   INTEGER REFERENCES external_assets(id),
  drive_link      TEXT,
  submitted_at    TIMESTAMPTZ,
  review_status   VARCHAR(20),                     -- pending / approved / retake
  review_comment  TEXT,
  reviewer_slack_id VARCHAR(50),
  UNIQUE (deliverable_id, revision_no)
);

-- 既存 delivery_line_items に成果物リンク
ALTER TABLE delivery_line_items ADD COLUMN IF NOT EXISTS deliverable_id INTEGER REFERENCES deliverables(id);

-- 作品の権利台帳(所有/譲渡/許諾/共有 を1テーブルに集約)
CREATE TABLE IF NOT EXISTS work_materials (
  id                       SERIAL PRIMARY KEY,
  work_id                  INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  material_name            TEXT,
  material_type            VARCHAR(50),            -- illustration / scenario / design / music / text
  rights_type              VARCHAR(30),            -- owned / copyright_assignment / license / joint
  rights_holder_vendor_id  INTEGER REFERENCES vendors(id),
  rights_status            VARCHAR(20),            -- cleared / pending / expired / disputed
  is_royalty_bearing       BOOLEAN NOT NULL DEFAULT FALSE,
  source_ip_id             INTEGER REFERENCES source_ips(id),
  source_ip_material_id    INTEGER REFERENCES source_ip_materials(id),
  source_contract_id       INTEGER REFERENCES contracts(id),
  license_financial_term_id INTEGER REFERENCES contract_financial_terms(id),
  source_deliverable_id    INTEGER REFERENCES deliverables(id),
  moral_rights_waiver      BOOLEAN NOT NULL DEFAULT FALSE,
  scope                    TEXT,
  secondary_use_flags      JSONB NOT NULL DEFAULT '{}'::jsonb,
  remarks                  TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wm_work ON work_materials(work_id);
CREATE INDEX IF NOT EXISTS idx_wm_source_contract ON work_materials(source_contract_id);

-- 利用許諾料計算書(MG/AGは契約単位プール)
CREATE TABLE IF NOT EXISTS royalty_statements (
  id                     SERIAL PRIMARY KEY,
  backlog_issue_key      VARCHAR(50),
  contract_id            INTEGER REFERENCES contracts(id),
  financial_term_id      INTEGER REFERENCES contract_financial_terms(id),
  product_id             INTEGER REFERENCES products(id),
  work_material_id       INTEGER REFERENCES work_materials(id),
  manufacturing_event_id INTEGER REFERENCES manufacturing_events(id),
  sales_event_id         INTEGER REFERENCES sales_events(id),
  payment_id             INTEGER REFERENCES payments(id),
  calc_type              VARCHAR(20),             -- manufacturing / sales / sublicense
  unit_price             DECIMAL(15,2),
  quantity               DECIMAL(10,4),
  sample_quantity        DECIMAL(10,4) DEFAULT 0,
  billable_quantity      DECIMAL(10,4),
  rate_pct               DECIMAL(7,4),
  gross_royalty_ex_tax   DECIMAL(15,2),
  mg_amount              DECIMAL(15,2),
  mg_consumed_before     DECIMAL(15,2),
  mg_consumed_this_time  DECIMAL(15,2),
  mg_consumed_after      DECIMAL(15,2),
  mg_remaining           DECIMAL(15,2),
  mg_fully_consumed      BOOLEAN DEFAULT FALSE,
  mg_topup_this_time     DECIMAL(15,2) DEFAULT 0,
  ag_amount              DECIMAL(15,2) DEFAULT 0,
  ag_consumed_before     DECIMAL(15,2) DEFAULT 0,
  ag_consumed_this_time  DECIMAL(15,2) DEFAULT 0,
  ag_consumed_after      DECIMAL(15,2) DEFAULT 0,
  ag_remaining           DECIMAL(15,2) DEFAULT 0,
  ag_fully_consumed      BOOLEAN DEFAULT FALSE,
  actual_royalty_ex_tax  DECIMAL(15,2),
  tax_rate               INTEGER DEFAULT 10,
  tax_amount             DECIMAL(15,2),
  total_payment_inc_tax  DECIMAL(15,2),
  currency               VARCHAR(10) DEFAULT 'JPY',
  period                 VARCHAR(7),
  reporting_deadline     DATE,
  payment_due_date       DATE,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rs_contract ON royalty_statements(contract_id);
CREATE INDEX IF NOT EXISTS idx_rs_contract_period ON royalty_statements(contract_id, period);

-- 汎用アラート(満期/検収/義務/商標/レビュー/報告 を集約)。実FKで発生源を保持。
CREATE TABLE IF NOT EXISTS alerts (
  id                    SERIAL PRIMARY KEY,
  alert_type            VARCHAR(40),               -- contract_renewal / inspection_deadline / obligation / ip_renewal / review_due / royalty_report
  contract_id           INTEGER REFERENCES contracts(id),
  delivery_event_id     INTEGER REFERENCES delivery_events(id),
  contract_obligation_id INTEGER REFERENCES contract_obligations(id),
  ip_registration_id    INTEGER REFERENCES ip_registrations(id),
  royalty_statement_id  INTEGER REFERENCES royalty_statements(id),
  source_label          TEXT,
  work_id               INTEGER REFERENCES works(id),
  due_date              DATE,
  lead_days             INTEGER,
  status                VARCHAR(20),               -- scheduled / notified / snoozed / done / dismissed
  last_alert_at         TIMESTAMPTZ,
  alert_count           INTEGER NOT NULL DEFAULT 0,
  channels              JSONB NOT NULL DEFAULT '[]'::jsonb,
  mentions              JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_alerts_due ON alerts(due_date);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
