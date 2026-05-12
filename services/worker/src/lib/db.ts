import pg from 'pg';

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === 'production';

// Cloud SQL connection configuration
const poolConfig = process.env.DATABASE_URL 
  ? { 
      connectionString: process.env.DATABASE_URL,
      // For some hosted DBs, SSL might be required. 
      // This is a safe default for many cloud providers.
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
    }
  : {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      // If running on Cloud Run, connect via Unix socket
      host: isProduction && process.env.INSTANCE_CONNECTION_NAME ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` : process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };

if (!process.env.DATABASE_URL && !process.env.DB_HOST && !process.env.INSTANCE_CONNECTION_NAME) {
  console.warn('⚠️ No database configuration found. Please set DATABASE_URL or DB_* environment variables in the Settings menu.');
}

export const pool = new Pool(poolConfig);

export async function query(text: string, params?: any[]) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

// Initialize tables if they don't exist
export async function initDb() {
  const tables = [
    // 1. Documents (Legacy/Meta)
    `CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      document_number VARCHAR(100) UNIQUE,
      legacy_document_number VARCHAR(100),
      issue_key VARCHAR(50) NOT NULL,
      template_type VARCHAR(50) NOT NULL,
      form_data JSONB NOT NULL,
      drive_link TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(255)
    );`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_number VARCHAR(100) UNIQUE;`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS legacy_document_number VARCHAR(100);`,

    `CREATE TABLE IF NOT EXISTS document_sequences (
      kind VARCHAR(50) NOT NULL,
      year INTEGER NOT NULL,
      current_value INTEGER DEFAULT 0,
      PRIMARY KEY (kind, year)
    );`,
    `ALTER TABLE document_sequences ADD COLUMN IF NOT EXISTS kind VARCHAR(50);`,
    `ALTER TABLE document_sequences ADD COLUMN IF NOT EXISTS year INTEGER;`,
    // Drop the old sequence_key if it exists after migration if necessary, 
    // but the most important thing is to make sure columns exist for the new primary key.
    // If the table already existed without being partitioned by year, we might need to recreate it.

    // 2. Vendors
    `CREATE TABLE IF NOT EXISTS vendors (
      id SERIAL PRIMARY KEY,
      vendor_code VARCHAR(50) UNIQUE NOT NULL,
      vendor_name VARCHAR(255) NOT NULL,
      trade_name VARCHAR(255),
      pen_name VARCHAR(255),
      vendor_suffix VARCHAR(50),
      entity_type VARCHAR(50),
      withholding_enabled BOOLEAN DEFAULT FALSE,
      aliases TEXT,
      address TEXT,
      phone VARCHAR(50),
      email VARCHAR(255),
      contact_department VARCHAR(100),
      contact_name VARCHAR(100),
      master_contract_ref TEXT,
      bank_info TEXT,
      bank_name TEXT,
      branch_name TEXT,
      account_type VARCHAR(50),
      account_number VARCHAR(50),
      account_holder_kana TEXT,
      is_invoice_issuer BOOLEAN DEFAULT FALSE,
      invoice_registration_number VARCHAR(50)
    );`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS trade_name VARCHAR(255);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS pen_name VARCHAR(255);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_suffix VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS withholding_enabled BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS aliases TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS phone VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_department VARCHAR(100);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_name VARCHAR(100);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS master_contract_ref TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_info TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS branch_name TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS account_type VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS account_number VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS account_holder_kana TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_invoice_issuer BOOLEAN DEFAULT FALSE;`,

    // 3. Staff & Workflow Rules
    `CREATE TABLE IF NOT EXISTS staff (
      id SERIAL PRIMARY KEY,
      slack_user_id VARCHAR(50) UNIQUE NOT NULL,
      staff_name VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      phone VARCHAR(50),
      department VARCHAR(100),
      department_code VARCHAR(50)
    );`,
    `ALTER TABLE staff ADD COLUMN IF NOT EXISTS email VARCHAR(255);`,
    `ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone VARCHAR(50);`,

    `CREATE TABLE IF NOT EXISTS department_workflow_rules (
      id SERIAL PRIMARY KEY,
      department VARCHAR(100) UNIQUE NOT NULL,
      approver_slack_id VARCHAR(50),
      stamp_operator_slack_id VARCHAR(50),
      manager_slack_id VARCHAR(50),
      slack_channel_id VARCHAR(50),
      is_active BOOLEAN DEFAULT TRUE
    );`,
    `ALTER TABLE department_workflow_rules ADD COLUMN IF NOT EXISTS slack_channel_id VARCHAR(50);`,

    // 4. Legal Requests & Order Items (Delivery Management)
    `CREATE TABLE IF NOT EXISTS legal_requests (
      id SERIAL PRIMARY KEY,
      backlog_issue_key VARCHAR(50) UNIQUE NOT NULL,
      slack_user_id VARCHAR(50),
      contract_type VARCHAR(50),
      counterparty VARCHAR(255),
      summary TEXT,
      deadline TIMESTAMP WITH TIME ZONE,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,

    `CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      legal_request_id INTEGER REFERENCES legal_requests(id) ON DELETE CASCADE,
      item_no INTEGER NOT NULL,
      vendor_code VARCHAR(50),
      description TEXT,
      amount DECIMAL(15, 2),
      due_date TIMESTAMP WITH TIME ZONE,
      latest_amount DECIMAL(15, 2),
      latest_due_date TIMESTAMP WITH TIME ZONE,
      backlog_issue_key VARCHAR(50) UNIQUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(legal_request_id, item_no)
    );`,
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`,

    // -----------------------------------------------------------------
    // Phase 4a: 発注書の税抜・税込・税率を SQL-queryable に
    //
    // 既存の order_items.amount は税抜総額として残し、新カラムで
    // 内訳を持つ。税は Math.ceil で切り上げ (calc.ts 参照)。
    // -----------------------------------------------------------------
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS amount_ex_tax DECIMAL(15, 2);`,
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tax_rate INTEGER;`,
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(15, 2);`,
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS amount_inc_tax DECIMAL(15, 2);`,

    // Backfill amount_ex_tax from the legacy single-column amount so
    // the new query surface works for historic rows.
    `UPDATE order_items
        SET amount_ex_tax = amount
      WHERE amount_ex_tax IS NULL AND amount IS NOT NULL;`,

    // -----------------------------------------------------------------
    // Phase 4a: 発注書の明細レコード (1 PO = N 明細)
    //
    // quantity / inspected_quantity は DECIMAL(10, 4) — 部分検収
    // (例: 0.5 単位) と契約不適合品の割合評価 (acceptance_ratio) に
    // 対応するため整数では不足。
    // amount_ex_tax は unit_price × quantity をサーバ側で計算 (calc.ts)。
    // -----------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS order_line_items (
      id SERIAL PRIMARY KEY,
      order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      spec TEXT,
      unit_price DECIMAL(15, 2),
      quantity DECIMAL(10, 4),
      amount_ex_tax DECIMAL(15, 2),
      payment_method VARCHAR(50),
      payment_date DATE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(order_item_id, line_no)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_oli_order_item ON order_line_items(order_item_id);`,

    // Backfill: turn each existing order_items row into a single
    // line item so the new SUM(line.amount_ex_tax) = header.amount_ex_tax
    // invariant holds without rewriting historic data manually.
    `INSERT INTO order_line_items (order_item_id, line_no, item_name, spec, amount_ex_tax)
     SELECT oi.id, 1, COALESCE(oi.description, ''), '', oi.amount
       FROM order_items oi
       LEFT JOIN order_line_items oli
         ON oli.order_item_id = oi.id AND oli.line_no = 1
      WHERE oli.id IS NULL
        AND oi.amount IS NOT NULL;`,

    `CREATE TABLE IF NOT EXISTS delivery_events (
      id SERIAL PRIMARY KEY,
      backlog_issue_key VARCHAR(50) UNIQUE NOT NULL,
      order_item_id INTEGER REFERENCES order_items(id),
      delivery_no INTEGER,
      delivered_at TIMESTAMP WITH TIME ZONE,
      delivered_amount DECIMAL(15, 2),
      inspection_deadline TIMESTAMP WITH TIME ZONE,
      status VARCHAR(20) DEFAULT 'pending', -- pending, completed, overdue
      note TEXT,
      linked_asset_id INTEGER, -- Link to external_assets
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS linked_asset_id INTEGER;`,

    // -----------------------------------------------------------------
    // Phase 4a: 検収書の明細レコード (1 検収書 = N 明細)
    //
    // acceptance_ratio は 0.0000–1.0000 で品質評価:
    //   1.0   = 全量検収
    //   0.5   = 半量評価 (例: 1個納品されたが品質低下で 50% の価値)
    //   など。
    // inspected_amount_ex_tax = (unit_price × inspected_quantity)
    //   × acceptance_ratio をサーバ側で計算する (calc.ts)。
    // 累計検収 vs 発注額の overflow チェックはサーバ側ガードで実施。
    // -----------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS delivery_line_items (
      id SERIAL PRIMARY KEY,
      delivery_event_id INTEGER NOT NULL REFERENCES delivery_events(id) ON DELETE CASCADE,
      order_line_item_id INTEGER REFERENCES order_line_items(id),
      inspected_quantity DECIMAL(10, 4),
      acceptance_ratio DECIMAL(5, 4) DEFAULT 1.0,
      inspected_amount_ex_tax DECIMAL(15, 2),
      rejection_reason TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(delivery_event_id, order_line_item_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_dli_delivery_event ON delivery_line_items(delivery_event_id);`,
    `CREATE INDEX IF NOT EXISTS idx_dli_order_line ON delivery_line_items(order_line_item_id);`,

    // 5. Licensing & Royalties
    `CREATE TABLE IF NOT EXISTS license_contracts (
      id SERIAL PRIMARY KEY,
      backlog_issue_key VARCHAR(50) UNIQUE NOT NULL,
      ledger_id VARCHAR(50) UNIQUE NOT NULL,
      ledger_number VARCHAR(100),
      contract_number VARCHAR(100),
      licensor VARCHAR(255),
      original_work TEXT,
      royalty_rate DECIMAL(5, 4),
      mg_amount DECIMAL(15, 2),
      fee_structure VARCHAR(50),
      payment_cycle VARCHAR(50),
      license_start_date DATE,
      linked_asset_id INTEGER, -- Link to external_assets
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS ledger_number VARCHAR(100);`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS contract_number VARCHAR(100);`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS linked_asset_id INTEGER;`,

    `CREATE TABLE IF NOT EXISTS manufacturing_events (
      id SERIAL PRIMARY KEY,
      backlog_issue_key VARCHAR(50) UNIQUE NOT NULL,
      license_contract_id INTEGER REFERENCES license_contracts(id),
      product_name VARCHAR(255) NOT NULL,
      completion_date DATE,
      quantity INTEGER,
      msrp DECIMAL(15, 2),
      total_payment DECIMAL(15, 2),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,

    `CREATE TABLE IF NOT EXISTS royalty_payments (
      id SERIAL PRIMARY KEY,
      backlog_issue_key VARCHAR(50) NOT NULL,
      manufacturing_event_id INTEGER REFERENCES manufacturing_events(id) UNIQUE,
      license_contract_id INTEGER REFERENCES license_contracts(id),
      payment_due_date DATE,
      reporting_deadline DATE,
      total_amount DECIMAL(15, 2),
      status VARCHAR(20) DEFAULT 'calculated', -- calculated, paid
      period VARCHAR(7) NOT NULL, -- YYYY-MM
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,

    // 6. Contact Assets / External Documents
    `CREATE TABLE IF NOT EXISTS external_assets (
      id SERIAL PRIMARY KEY,
      asset_number VARCHAR(100) UNIQUE,
      asset_name VARCHAR(255) NOT NULL,
      asset_type VARCHAR(50) NOT NULL, -- 'contract', 'draft', 'design', 'spec'
      counterparty VARCHAR(255),
      status VARCHAR(50) DEFAULT 'active',
      file_link TEXT,
      metadata JSONB DEFAULT '{}',
      start_date DATE,
      end_date DATE,
      backlog_issue_key VARCHAR(50),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `ALTER TABLE external_assets ADD COLUMN IF NOT EXISTS asset_number VARCHAR(100) UNIQUE;`,

    // 7. Workflow & Sync State
    `CREATE TABLE IF NOT EXISTS issue_workflows (
      id SERIAL PRIMARY KEY,
      backlog_issue_key VARCHAR(50) UNIQUE NOT NULL,
      issue_type_name VARCHAR(100),
      current_status_name VARCHAR(50),
      document_draft TEXT,
      generated_documents JSONB DEFAULT '[]',
      approval_at TIMESTAMP WITH TIME ZONE,
      stamp_at TIMESTAMP WITH TIME ZONE,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS workflow_settings (
      id SERIAL PRIMARY KEY,
      issue_type_name VARCHAR(100) UNIQUE NOT NULL,
      allowed_templates JSONB DEFAULT '[]',
      status_configs JSONB DEFAULT '{}', -- e.g. { "完了": { "auto_advance": true } }
      variable_mappings JSONB DEFAULT '{}', -- { "CONTRACT_DATE": { "source": "backlog", "field": "customField_123" } }
      next_status_id INTEGER, -- Backlog status ID to move to after generation
      document_prefix VARCHAR(50), -- Prefix for document numbering
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      key VARCHAR(100) PRIMARY KEY,
      value JSONB DEFAULT '{}',
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `ALTER TABLE workflow_settings ADD COLUMN IF NOT EXISTS variable_mappings JSONB DEFAULT '{}';`,
    `ALTER TABLE workflow_settings ADD COLUMN IF NOT EXISTS next_status_id INTEGER;`,
    `ALTER TABLE workflow_settings ADD COLUMN IF NOT EXISTS document_prefix VARCHAR(50);`,
    `ALTER TABLE royalty_payments ADD COLUMN IF NOT EXISTS backlog_issue_key VARCHAR(50);`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS mg_amount DECIMAL(15, 2);`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS fee_structure VARCHAR(50);`,

    // 8. Contract Check & Capabilities (Audit/Referral API Support)
    `CREATE TABLE IF NOT EXISTS contract_purposes (
      purpose_code VARCHAR(100) PRIMARY KEY,
      purpose_group VARCHAR(100) NOT NULL,
      purpose_label TEXT NOT NULL,
      category VARCHAR(50) NOT NULL,
      required_contract_type VARCHAR(100) NOT NULL,
      default_document_type VARCHAR(100) NOT NULL,
      require_work_name BOOLEAN DEFAULT FALSE,
      require_product_name BOOLEAN DEFAULT FALSE,
      require_territory BOOLEAN DEFAULT FALSE,
      require_language BOOLEAN DEFAULT FALSE,
      high_risk_flag BOOLEAN DEFAULT FALSE,
      active BOOLEAN DEFAULT TRUE,
      sort_order INTEGER DEFAULT 999,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS contract_capabilities (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER REFERENCES vendors(id),
      external_asset_id INTEGER REFERENCES external_assets(id),
      record_type VARCHAR(50) NOT NULL DEFAULT 'master_contract', -- master_contract / license_condition / publication_condition
      contract_category VARCHAR(50) NOT NULL, -- service / license / publication
      contract_type VARCHAR(100) NOT NULL, -- service_basic / license_basic / publication_license
      contract_title TEXT NOT NULL,
      document_number VARCHAR(100),
      contract_status VARCHAR(50) DEFAULT 'executed',
      effective_date DATE,
      expiration_date DATE,
      auto_renewal BOOLEAN DEFAULT FALSE,
      source_system VARCHAR(50),
      legalon_url TEXT,
      cloudsign_url TEXT,
      drive_url TEXT,
      document_url TEXT,
      purpose_codes TEXT[] DEFAULT '{}',
      purchase_order_allowed BOOLEAN DEFAULT FALSE,
      license_condition_allowed BOOLEAN DEFAULT FALSE,
      publication_contract_allowed BOOLEAN DEFAULT FALSE,
      publication_condition_allowed BOOLEAN DEFAULT FALSE,
      condition_number VARCHAR(100),
      original_work TEXT,
      work_name TEXT,
      product_name TEXT,
      media TEXT,
      territory TEXT,
      language TEXT,
      scope TEXT,
      covered_service_categories TEXT,
      covered_works TEXT,
      covered_products TEXT,
      covered_media TEXT,
      covered_territory TEXT,
      covered_language TEXT,
      sublicense_allowed VARCHAR(100),
      overseas_allowed BOOLEAN DEFAULT FALSE,
      translation_allowed BOOLEAN DEFAULT FALSE,
      ebook_allowed BOOLEAN DEFAULT FALSE,
      merchandising_allowed BOOLEAN DEFAULT FALSE,
      video_adaptation_allowed BOOLEAN DEFAULT FALSE,
      game_adaptation_allowed BOOLEAN DEFAULT FALSE,
      risk_flags JSONB DEFAULT '{}',
      legal_review_required BOOLEAN DEFAULT FALSE,
      scope_confidence VARCHAR(20) DEFAULT 'medium',
      reason_template TEXT,
      caution_note TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS work_name TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS record_type VARCHAR(50) DEFAULT 'master_contract';`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS contract_category VARCHAR(50);`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS contract_type VARCHAR(100);`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS contract_title TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS document_number VARCHAR(100);`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS contract_status VARCHAR(50) DEFAULT 'executed';`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS effective_date DATE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS expiration_date DATE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS auto_renewal BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS source_system VARCHAR(50);`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS legalon_url TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS cloudsign_url TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS drive_url TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS document_url TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS purpose_codes TEXT[] DEFAULT '{}';`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS purchase_order_allowed BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS license_condition_allowed BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS publication_contract_allowed BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS publication_condition_allowed BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS condition_number VARCHAR(100);`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS original_work TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS product_name TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS media TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS territory TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS language TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS scope TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS covered_service_categories TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS covered_works TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS covered_products TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS covered_media TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS covered_territory TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS covered_language TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS sublicense_allowed VARCHAR(100);`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS overseas_allowed BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS translation_allowed BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS ebook_allowed BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS merchandising_allowed BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS video_adaptation_allowed BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS game_adaptation_allowed BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS risk_flags JSONB DEFAULT '{}';`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS legal_review_required BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS scope_confidence VARCHAR(20) DEFAULT 'medium';`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS reason_template TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS caution_note TEXT;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_vendor ON contract_capabilities(vendor_id);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_category ON contract_capabilities(contract_category);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_type ON contract_capabilities(contract_type);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_record_type ON contract_capabilities(record_type);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_purposes ON contract_capabilities USING GIN(purpose_codes);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_capabilities_doc_num ON contract_capabilities(document_number) WHERE document_number IS NOT NULL;`,

    `CREATE TABLE IF NOT EXISTS contract_decision_logs (
      id SERIAL PRIMARY KEY,
      requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      requester_email VARCHAR(255),
      counterparty_name_input TEXT NOT NULL,
      vendor_id INTEGER REFERENCES vendors(id),
      purpose_code VARCHAR(100),
      work_name TEXT,
      product_name TEXT,
      territory TEXT,
      language TEXT,
      additional_flags JSONB DEFAULT '{}',
      matched_capability_ids INTEGER[] DEFAULT '{}',
      result_payload JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,

    // Seed contract_purposes
    `INSERT INTO contract_purposes (purpose_code, purpose_group, purpose_label, category, required_contract_type, default_document_type, sort_order) VALUES
      ('service_general', '業務を依頼する', '制作・編集・デザイン等の業務を依頼したい', 'service', 'service_basic', 'purchase_order', 10),
      ('service_creative', '業務を依頼する', 'イラスト・原稿・DTP・校正等を依頼したい', 'service', 'service_basic', 'purchase_order', 20),
      ('service_event', '業務を依頼する', 'イベント運営・スタッフ業務を依頼したい', 'service', 'service_basic', 'purchase_order', 30),
      ('license_game', '作品・IPを利用する', '作品・ゲーム・IPをアナログゲーム化したい', 'license', 'license_basic', 'license_condition', 40),
      ('license_localize', '作品・IPを利用する', '作品を別地域・別言語で展開したい', 'license', 'license_basic', 'license_condition', 50),
      ('license_sublicense', '作品・IPを利用する', '第三者に再許諾・OEM展開したい', 'license', 'license_basic', 'license_condition', 60),
      ('publication_paper', '出版する', '紙書籍として出版したい', 'publication', 'publication_license', 'publication_contract', 70),
      ('publication_ebook', '出版する', '電子書籍として配信したい', 'publication', 'publication_license', 'publication_contract', 80),
      ('publication_translation', '出版する', '海外出版・翻訳版を出したい', 'publication', 'publication_license', 'publication_contract', 90),
      ('publication_merch', '出版する', '出版物・イラストを商品化したい', 'publication', 'publication_license', 'publication_contract', 100),
      ('publication_video_game', '出版する', '映像化・ゲーム化したい', 'publication', 'publication_license', 'legal_review', 110),
      ('mixed_service_license', '複合取引', '業務依頼と権利利用の両方がある', 'mixed', 'service_basic,license_basic', 'purchase_order,license_condition', 120),
      ('unknown', 'その他', 'どれに該当するかわからない', 'unknown', 'unknown', 'legal_review', 999)
    ON CONFLICT (purpose_code) DO UPDATE SET 
      purpose_group = EXCLUDED.purpose_group,
      purpose_label = EXCLUDED.purpose_label,
      category = EXCLUDED.category,
      required_contract_type = EXCLUDED.required_contract_type,
      default_document_type = EXCLUDED.default_document_type,
      sort_order = EXCLUDED.sort_order;`,

    // 9. Seed Workflow Settings based on design images
    `INSERT INTO workflow_settings (issue_type_name, document_prefix) VALUES 
      ('license_master', 'LIC'),
      ('lic_individual', 'ILT'),
      ('manufacturing', 'ROY'),
      ('outsourcing', 'OUT'),
      ('purchase_order', 'PO'),
      ('delivery_inspec', 'INS'),
      ('payment', 'PAY'),
      ('sales_master', 'SAL'),
      ('legal_consult', 'REQ'),
      ('nda', 'NDA')
    ON CONFLICT (issue_type_name) DO UPDATE SET document_prefix = EXCLUDED.document_prefix;`
  ];

  try {
    for (const sql of tables) {
      await query(sql);
    }
    console.log('Database tables initialized per integrated design');
  } catch (err) {
    console.error('Failed to initialize database:', err);
  }
}

export async function getNextSequenceValue(kind: string, year: number): Promise<number> {
  const res = await query(
    `INSERT INTO document_sequences (kind, year, current_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (kind, year)
     DO UPDATE SET current_value = document_sequences.current_value + 1
     RETURNING current_value`,
    [kind, year]
  );
  return res.rows[0].current_value;
}

export async function getNewDocumentNumber(type: string, issueTypeName?: string): Promise<string> {
  let prefix = "";
  
  if (issueTypeName) {
    const wsResult = await query("SELECT document_prefix FROM workflow_settings WHERE issue_type_name = $1", [issueTypeName]);
    if (wsResult.rows[0]?.document_prefix) {
      prefix = wsResult.rows[0].document_prefix;
    }
  }

  if (!prefix) {
    const typeCodes: Record<string, string> = {
      nda: "NDA",
      purchase_order: "PO",
      contract: "CTR",
      external_contract: "ARC",
      inspection_certificate: "INS",
      inspection_certificate_v2: "INS",
      royalty_statement: "ROY",
      payment_notice: "PAY",
      legal_request: "REQ",
      license_master: "LIC",
      lic_individual: "ILT",
      manufacturing: "MFG",
      outsourcing: "OUT",
      delivery_inspec: "INS",
      sales_master: "SAL",
      legal_consult: "REQ",
    };
    prefix = typeCodes[type] || (issueTypeName ? typeCodes[issueTypeName] : null) || type.toUpperCase().substring(0, 3);
  }

  const year = new Date().getFullYear();
  // Using a unified sequence kind 'ARC' for the general document numbering to ensure global uniqueness if requested,
  // or sticking to the specific prefix if we want per-type sequences.
  // Given the request for "ARC-" prefix, we will use 'ARC' as the sequence kind.
  const val = await getNextSequenceValue('ARC', year);
  
  return `ARC-${year}-${val.toString().padStart(4, "0")}`;
}
