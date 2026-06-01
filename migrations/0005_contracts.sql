-- 0005_contracts.sql
-- 作品中心スキーマ: 契約層(§3.3)。純追加(新テーブル名・既存と非衝突)。
-- FK は baseline + 0004 で閉じる。worker/Search 双方が origin+採番で書く(D1補正)。

-- 契約(本体)。階層: master / individual / standalone。
CREATE TABLE IF NOT EXISTS contracts (
  id                    SERIAL PRIMARY KEY,
  document_number       VARCHAR(100) UNIQUE,
  contract_level        VARCHAR(20),                         -- master / individual / standalone
  master_contract_id    INTEGER REFERENCES contracts(id),    -- individual のとき親(基本契約)
  amends_contract_id    INTEGER REFERENCES contracts(id),    -- 改定/覚書の対象
  record_type           VARCHAR(50),
  contract_category     VARCHAR(30),                         -- license_in / license_out / service / publication / sales / nda / mixed
  contract_type         VARCHAR(100),
  contract_title        TEXT,
  primary_vendor_id     INTEGER REFERENCES vendors(id),
  origin                VARCHAR(20),                         -- workflow(課題駆動) / registered(登録・取込)
  -- 作品に紐づかない契約(全社/部門経費)
  is_work_related       BOOLEAN NOT NULL DEFAULT TRUE,
  department_code       VARCHAR(50),
  expense_category      VARCHAR(40) REFERENCES expense_categories(expense_code),
  -- ライフサイクル(締結進捗)
  lifecycle_stage       VARCHAR(30),                         -- requested..executed / on_hold / cancelled / expired / terminated
  current_owner_slack_id VARCHAR(50),
  review_due_date       DATE,
  requested_at          TIMESTAMPTZ,
  executed_at           TIMESTAMPTZ,
  ringi_id              INTEGER REFERENCES ringi_records(id),
  -- 期間・更新
  effective_date        DATE,
  expiration_date       DATE,
  auto_renewal          BOOLEAN NOT NULL DEFAULT FALSE,
  renewal_notice_months INTEGER,
  alert_lead_months     INTEGER,
  alert_slack_channels  JSONB NOT NULL DEFAULT '[]'::jsonb,
  alert_slack_mentions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 連携 URL / source
  source_system         VARCHAR(50),
  legalon_url           TEXT,
  cloudsign_url         TEXT,
  drive_url             TEXT,
  document_url          TEXT,
  purpose_codes         TEXT[] NOT NULL DEFAULT '{}',
  -- 許諾範囲フラグ
  scope                 TEXT,
  sublicense_allowed    VARCHAR(100),
  overseas_allowed      BOOLEAN NOT NULL DEFAULT FALSE,
  translation_allowed   BOOLEAN NOT NULL DEFAULT FALSE,
  ebook_allowed         BOOLEAN NOT NULL DEFAULT FALSE,
  merchandising_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  video_adaptation_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  game_adaptation_allowed  BOOLEAN NOT NULL DEFAULT FALSE,
  risk_flags            JSONB NOT NULL DEFAULT '{}'::jsonb,
  legal_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  scope_confidence      VARCHAR(20) DEFAULT 'medium',
  contract_status       VARCHAR(50),                         -- legacy互換(lifecycle_stage を正とする)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contracts_master ON contracts(master_contract_id);
CREATE INDEX IF NOT EXISTS idx_contracts_category ON contracts(contract_category);
CREATE INDEX IF NOT EXISTS idx_contracts_lifecycle ON contracts(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_contracts_purposes ON contracts USING GIN (purpose_codes);

-- 契約⇔作品/原作IP/製品(M:N)
CREATE TABLE IF NOT EXISTS contract_works (
  id                      SERIAL PRIMARY KEY,
  contract_id             INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  work_id                 INTEGER REFERENCES works(id),
  source_ip_id            INTEGER REFERENCES source_ips(id),
  product_id              INTEGER REFERENCES products(id),
  role                    VARCHAR(30),                         -- licensed_in / licensed_out / service_target / publication_target
  rights_holder_vendor_id INTEGER REFERENCES vendors(id),
  CHECK (work_id IS NOT NULL OR source_ip_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_cw_contract ON contract_works(contract_id);
CREATE INDEX IF NOT EXISTS idx_cw_work ON contract_works(work_id);
CREATE INDEX IF NOT EXISTS idx_cw_source_ip ON contract_works(source_ip_id);

-- 契約当事者(3者以上対応)
CREATE TABLE IF NOT EXISTS contract_parties (
  id          SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  vendor_id   INTEGER NOT NULL REFERENCES vendors(id),
  party_role  VARCHAR(30),                                    -- 主/副/連帯保証/権利者/再許諾先
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cp_contract ON contract_parties(contract_id);
CREATE INDEX IF NOT EXISTS idx_cp_vendor ON contract_parties(vendor_id);

-- 利用許諾条件明細(料率/MG型・継続)。individual/standalone のみ。
CREATE TABLE IF NOT EXISTS contract_financial_terms (
  id                     SERIAL PRIMARY KEY,
  contract_id            INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  condition_no           INTEGER NOT NULL,
  work_id                INTEGER REFERENCES works(id),
  product_id             INTEGER REFERENCES products(id),
  source_ip_id           INTEGER REFERENCES source_ips(id),
  source_ip_material_id  INTEGER REFERENCES source_ip_materials(id),
  region_language_label  TEXT,
  calc_method            VARCHAR(50),
  rate_pct               DECIMAL(7,4),
  base_price_label       TEXT,
  calc_period            VARCHAR(50),
  calc_period_kind       VARCHAR(20),
  calc_period_close_month SMALLINT,
  currency               VARCHAR(10) DEFAULT 'JPY',
  formula_text           TEXT,
  payment_terms          TEXT,
  mg_amount              DECIMAL(15,2) NOT NULL DEFAULT 0,
  ag_amount              DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, condition_no)
);
CREATE INDEX IF NOT EXISTS idx_cft_contract ON contract_financial_terms(contract_id);
CREATE INDEX IF NOT EXISTS idx_cft_work ON contract_financial_terms(work_id);
CREATE INDEX IF NOT EXISTS idx_cft_source_material ON contract_financial_terms(source_ip_material_id);

-- 業務委託明細(単価×数量型・確定)。individual/standalone のみ。
CREATE TABLE IF NOT EXISTS contract_line_items (
  id            SERIAL PRIMARY KEY,
  contract_id   INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL,
  work_id       INTEGER REFERENCES works(id),
  product_id    INTEGER REFERENCES products(id),
  category      VARCHAR(100),
  item_name     TEXT,
  spec          TEXT,
  calc_method   VARCHAR(50),
  payment_method VARCHAR(50),
  payment_terms TEXT,
  quantity      DECIMAL(15,4),
  unit_price    DECIMAL(15,2),
  amount_ex_tax DECIMAL(15,2),
  delivery_date DATE,
  payment_date  DATE,
  cycle         VARCHAR(50),
  billing_day   INTEGER,
  term_start    DATE,
  term_end      DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_cli_contract ON contract_line_items(contract_id);
CREATE INDEX IF NOT EXISTS idx_cli_work ON contract_line_items(work_id);

-- 非金銭的義務(最低製造・クレジット・報告・監査 等)
CREATE TABLE IF NOT EXISTS contract_obligations (
  id              SERIAL PRIMARY KEY,
  contract_id     INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  obligation_type VARCHAR(40),
  description     TEXT,
  due_rule        TEXT,
  next_due_date   DATE,
  status          VARCHAR(20) DEFAULT 'active',
  last_alert_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cob_contract ON contract_obligations(contract_id);

-- 締結進捗の遷移履歴
CREATE TABLE IF NOT EXISTS contract_stage_history (
  id                  SERIAL PRIMARY KEY,
  contract_id         INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  from_stage          VARCHAR(30),
  to_stage            VARCHAR(30),
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_slack_id VARCHAR(50),
  comment             TEXT
);
CREATE INDEX IF NOT EXISTS idx_csh_contract ON contract_stage_history(contract_id);

-- 電子契約 送信単位
CREATE TABLE IF NOT EXISTS signature_requests (
  id                   SERIAL PRIMARY KEY,
  contract_id          INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  document_id          INTEGER REFERENCES documents(id),
  provider             VARCHAR(20),                            -- cloudsign / legalon / docusign / paper
  provider_envelope_id VARCHAR(120),
  status               VARCHAR(20),                            -- preparing / circulating / completed / declined / cancelled / expired
  cloudsign_url        TEXT,
  sent_at              TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sr_contract ON signature_requests(contract_id);

-- 署名リレー(宛先順)
CREATE TABLE IF NOT EXISTS signature_steps (
  id                    SERIAL PRIMARY KEY,
  signature_request_id  INTEGER NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  step_no               INTEGER NOT NULL,
  party_type            VARCHAR(20),                           -- internal / counterparty / witness
  vendor_id             INTEGER REFERENCES vendors(id),
  signer_name           TEXT,
  signer_email          TEXT,
  signer_slack_id       VARCHAR(50),
  status                VARCHAR(20),                           -- pending / current / signed / declined / skipped
  acted_at              TIMESTAMPTZ,
  UNIQUE (signature_request_id, step_no)
);

-- Search 専用採番(worker document_sequences と番号空間分離)
CREATE TABLE IF NOT EXISTS master_sequences (
  kind          VARCHAR(50) NOT NULL,
  year          INTEGER NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, year)
);

-- 稟議⇔作品(N:N)。増刷/海外/続編等。
CREATE TABLE IF NOT EXISTS ringi_works (
  ringi_id  INTEGER NOT NULL REFERENCES ringi_records(id) ON DELETE CASCADE,
  work_id   INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  role      VARCHAR(30) NOT NULL DEFAULT '',
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ringi_id, work_id, role)
);
CREATE INDEX IF NOT EXISTS idx_rw_work ON ringi_works(work_id);
