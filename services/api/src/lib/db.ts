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
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS corporate_number VARCHAR(20);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS phone VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS payment_terms TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS main_business TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS transaction_category VARCHAR(100);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS capital_yen BIGINT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS employee_count INTEGER;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS subcontract_act_applicable BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS rating VARCHAR(100);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS antisocial_check_result VARCHAR(100);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS master_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_department VARCHAR(100);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_name VARCHAR(100);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS master_contract_ref TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_info TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS branch_name TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS account_type VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS account_number VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS account_holder_kana TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_invoice_issuer BOOLEAN DEFAULT FALSE;`,
    // Phase 28: bank_name / invoice_registration_number は CREATE TABLE 句にしか
    //   無く、既存 (旧) vendors テーブルには ADD COLUMN が無いため列が欠落していた。
    //   この 2 列を参照する upsert INSERT が 42703 (undefined_column) で 500 に
    //   なっていたので、明示的に backfill する。
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_name TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS invoice_registration_number VARCHAR(50);`,
    `CREATE TABLE IF NOT EXISTS vendor_addresses (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      address_label VARCHAR(100),
      postal_code VARCHAR(20),
      address TEXT NOT NULL,
      is_primary BOOLEAN DEFAULT FALSE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS idx_vendor_addresses_vendor ON vendor_addresses(vendor_id);`,
    `CREATE INDEX IF NOT EXISTS idx_vendor_addresses_primary ON vendor_addresses(vendor_id, is_primary);`,
    `INSERT INTO vendor_addresses (vendor_id, address_label, address, is_primary, sort_order)
     SELECT v.id, 'primary', v.address, TRUE, 0
       FROM vendors v
      WHERE v.address IS NOT NULL
        AND v.address <> ''
        AND NOT EXISTS (
          SELECT 1 FROM vendor_addresses va WHERE va.vendor_id = v.id
        );`,
    `CREATE TABLE IF NOT EXISTS vendor_bank_accounts (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      bank_label VARCHAR(100),
      bank_name TEXT,
      branch_name TEXT,
      account_type VARCHAR(50),
      account_number VARCHAR(50),
      account_holder_kana TEXT,
      is_primary BOOLEAN DEFAULT FALSE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS idx_vendor_bank_accounts_vendor ON vendor_bank_accounts(vendor_id);`,
    `CREATE INDEX IF NOT EXISTS idx_vendor_bank_accounts_primary ON vendor_bank_accounts(vendor_id, is_primary);`,
    `INSERT INTO vendor_bank_accounts
      (vendor_id, bank_label, bank_name, branch_name, account_type, account_number, account_holder_kana, is_primary, sort_order)
     SELECT v.id, 'primary', v.bank_name, v.branch_name, v.account_type, v.account_number, v.account_holder_kana, TRUE, 0
       FROM vendors v
      WHERE (COALESCE(v.bank_name, '') <> ''
          OR COALESCE(v.branch_name, '') <> ''
          OR COALESCE(v.account_number, '') <> ''
          OR COALESCE(v.account_holder_kana, '') <> '')
        AND NOT EXISTS (
          SELECT 1 FROM vendor_bank_accounts vba WHERE vba.vendor_id = v.id
        );`,

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
    // Phase 22.21.40: app_role の ALTER は services/worker/src/lib/db.ts へ
    //   移植済 (こちらの initDb() は server.ts から呼ばれない死コード)。
    //   一覧の見やすさのためコメントだけ残す。

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

    // Phase 22: 「終結」記録 (詳細は worker 側 db.ts のコメント参照)
    `ALTER TABLE legal_requests ADD COLUMN IF NOT EXISTS merged_into_issue_key VARCHAR(50);`,

    // Phase 23.6.5: order_items の CREATE TABLE / ALTER は廃止
    //   (contract_capabilities + capability_line_items に統合済み)。
    //   delivery_events.order_item_id 列は FK 制約を外して残置 (物理 DROP 待ち)。

    `CREATE TABLE IF NOT EXISTS delivery_events (
      id SERIAL PRIMARY KEY,
      backlog_issue_key VARCHAR(50) UNIQUE NOT NULL,
      -- Phase 23.6.5: order_items は廃止予定のため FK 制約を外す
      order_item_id INTEGER,
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

    // Phase 20: 納期アラート用カラム
    //   last_alert_at は最終アラート送信日時 (= 同日重複送信防止)
    //   alert_count は累計送信回数 (運用観察用)
    `ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMP WITH TIME ZONE;`,
    `ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS alert_count INTEGER DEFAULT 0;`,

    // 5. Licensing & Royalties
    // Phase 23.6.5: license_contracts の CREATE TABLE / ALTER は廃止
    //   (contract_capabilities + capability_financial_conditions に統合済み)。
    //   manufacturing_events / royalty_payments の license_contract_id 列は
    //   FK 制約を外して残置 (物理 DROP 待ち)。

    `CREATE TABLE IF NOT EXISTS manufacturing_events (
      id SERIAL PRIMARY KEY,
      backlog_issue_key VARCHAR(50) UNIQUE NOT NULL,
      -- Phase 23.6.5: license_contracts は廃止予定のため FK 制約を外す
      license_contract_id INTEGER,
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
      -- Phase 23.6.5: license_contracts は廃止予定のため FK 制約を外す
      license_contract_id INTEGER,
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
    // Phase 23.6.5: license_contracts への ALTER は廃止 (テーブル自体が新規 DB には存在しない)。

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
    // Phase 17p: 部分ユニークインデックス → 通常 UNIQUE INDEX に変更
    //   (ON CONFLICT (document_number) が動くようにするため。詳細は worker
    //    側 db.ts の同名コメント参照。)
    `DROP INDEX IF EXISTS idx_capabilities_doc_num;`,
    // Phase 22.21.102: 真 = 最新 updated_at で重複マージ。
    // 詳細は worker/src/lib/db.ts の同名コメント参照。
    `DO $merge$
     DECLARE
       loser_count INTEGER;
     BEGIN
       CREATE TEMP TABLE _cc_winners ON COMMIT DROP AS
         SELECT DISTINCT ON (document_number)
                document_number, id AS winner_id
           FROM contract_capabilities
          WHERE document_number IS NOT NULL
          ORDER BY document_number, updated_at DESC NULLS LAST, id DESC;
       CREATE TEMP TABLE _cc_losers ON COMMIT DROP AS
         SELECT cc.id AS loser_id, w.winner_id
           FROM contract_capabilities cc
           JOIN _cc_winners w ON w.document_number = cc.document_number
          WHERE cc.id <> w.winner_id;
       SELECT COUNT(*) INTO loser_count FROM _cc_losers;
       IF loser_count > 0 THEN
         UPDATE condition_lines cfc
            SET capability_id = l.winner_id,
                document_id   = l.winner_id
           FROM _cc_losers l
          WHERE cfc.capability_id = l.loser_id
            AND cfc.legacy_role = 'cfc'
            AND NOT EXISTS (
              SELECT 1 FROM condition_lines w
               WHERE w.capability_id = l.winner_id
                 AND w.legacy_role = 'cfc'
                 AND w.line_no = cfc.line_no
            );
         DELETE FROM condition_lines cfc
          USING _cc_losers l
          WHERE cfc.capability_id = l.loser_id
            AND cfc.legacy_role = 'cfc';
         DELETE FROM documents cc
          USING _cc_losers l
          WHERE cc.id = l.loser_id;
         RAISE NOTICE
           '[Phase 22.21.102] contract_capabilities: merged % duplicate rows by document_number (winner = latest updated_at).',
           loser_count;
       END IF;
     END
     $merge$;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS contract_capabilities_doc_num_uniq
       ON contract_capabilities(document_number);`,

    // Phase 17x: 3+ 者契約サポート
    //   LegalOn 契約台帳のインポートで「取引先名」列にカンマ区切りで複数社が
    //   入っている場合、1 つ目を vendor_id (主取引先)、2 つ目以降を
    //   additional_parties JSONB に格納する。JSONB 配列の各要素は
    //     { "name": "B社", "vendor_id": 42, "role": "secondary" }
    //   形式。法務検索は vendor_id の他にこの JSONB を GIN で見て 2+ 社目も
    //   突合可能にする。
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS additional_parties JSONB DEFAULT '[]'::jsonb;`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_additional_parties
       ON contract_capabilities USING GIN (additional_parties);`,

    // Phase 20: 契約更新アラート用カラム
    //   renewal_notice_months : 自動更新を停止する場合の通告期限 (満期の N カ月前)
    //                            例: 1 → 満期の 1 カ月前までに通告が必要
    //   alert_lead_months     : 通告期限の更に N カ月前にアラート
    //                            例: 2 → 通告期限の 2 カ月前にアラート
    //                            (= 満期の 3 カ月前にアラート)
    //   last_renewal_alert_at : 最終通知送信日時 (= 重複防止)
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS renewal_notice_months INTEGER;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS alert_lead_months INTEGER;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS last_renewal_alert_at TIMESTAMP WITH TIME ZONE;`,

    // Phase 22.21.46: 契約ごとの Slack アラート設定 (詳細は worker/src/lib/db.ts 参照)
    //   alert_slack_channels: 通知先チャンネル配列 (例 ["#legal", "C0123ABCD"])
    //   alert_slack_mentions: メンション配列 (例 ["<!channel>", "<@U0123>"])
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS alert_slack_channels JSONB DEFAULT '[]'::jsonb;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS alert_slack_mentions JSONB DEFAULT '[]'::jsonb;`,

    // Phase 22.21.52: 原作 (ledger) 紐付け。ILT 採番 (LIC-{ledger_code}-ILT-NNNN) に使う。
    //   詳細は worker/src/lib/db.ts の同名コメント参照。
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS ledger_code VARCHAR(40);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_ledger_code
       ON contract_capabilities (ledger_code) WHERE ledger_code IS NOT NULL;`,

    // Phase 22.21.91: 契約マスタの金銭条件 (1..N 行) ─ ライセンス系の
    //   単独契約 / 個別契約で「個別利用許諾条件書」と同じ shape の
    //   金銭条件を保持する。詳細は worker/src/lib/db.ts の同名コメント参照。
    `CREATE TABLE IF NOT EXISTS capability_financial_conditions (
      id SERIAL PRIMARY KEY,
      capability_id INTEGER NOT NULL REFERENCES contract_capabilities(id) ON DELETE CASCADE,
      condition_no INTEGER NOT NULL,
      region_language_label TEXT,
      calc_method VARCHAR(50),
      rate_pct DECIMAL(7, 4),
      base_price_label TEXT,
      calc_period VARCHAR(50),
      calc_period_kind VARCHAR(20),
      calc_period_close_month SMALLINT,
      currency VARCHAR(10) DEFAULT 'JPY',
      formula_text TEXT,
      payment_terms TEXT,
      mg_amount DECIMAL(15, 2) DEFAULT 0,
      ag_amount DECIMAL(15, 2) DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(capability_id, condition_no)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_cfc_capability ON capability_financial_conditions(capability_id);`,
    // Phase 22.21.95: 旧 DB に対しても ag_amount を追加
    `ALTER TABLE capability_financial_conditions
       ADD COLUMN IF NOT EXISTS ag_amount DECIMAL(15, 2) DEFAULT 0;`,

    // Phase 22.21.112: 業務委託マスタの業務明細 (検収書 自動補完用)。
    // 詳細は worker/src/lib/db.ts の同名コメント参照。
    `CREATE TABLE IF NOT EXISTS capability_line_items (
      id SERIAL PRIMARY KEY,
      capability_id INTEGER NOT NULL REFERENCES contract_capabilities(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      category VARCHAR(100),
      item_name TEXT,
      spec TEXT,
      calc_method VARCHAR(50),
      payment_method VARCHAR(50),
      payment_terms TEXT,
      quantity DECIMAL(15, 4),
      unit_price DECIMAL(15, 2),
      amount_ex_tax DECIMAL(15, 2),
      delivery_date DATE,
      payment_date DATE,
      cycle VARCHAR(50),
      billing_day INTEGER,
      term_start DATE,
      term_end DATE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(capability_id, line_no)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_cli_capability ON capability_line_items(capability_id);`,

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

/**
 * Phase 28.1: search-api 専用の取引先テーブル列バックフィル。
 *
 * search-api (services/api) は initDb() を呼ばない設計 (= worker の migration に
 * 依存) だが、worker の再デプロイ/migration が共有 DB に届く前は
 * upsertVendor の INSERT が 42703 (undefined_column) で 500 になる。
 * worker のデプロイ完了タイミングに依存せず保存を成立させるため、
 * vendors と子テーブルに必要な列/テーブルだけを冪等に保証する軽量 migration。
 *
 * - 呼び出し側 (vendorMasterService.upsertVendor) でメモ化して 1 回だけ実行。
 * - 全て IF NOT EXISTS なので既存 DB では実質 no-op。
 */
export async function ensureVendorColumns(): Promise<void> {
  const stmts = [
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS corporate_number VARCHAR(20);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS trade_name VARCHAR(255);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS pen_name VARCHAR(255);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_suffix VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS withholding_enabled BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS aliases TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS phone VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS email VARCHAR(255);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS payment_terms TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS main_business TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS transaction_category VARCHAR(100);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS capital_yen BIGINT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS employee_count INTEGER;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS subcontract_act_applicable BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS rating VARCHAR(100);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS antisocial_check_result VARCHAR(100);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS master_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_department VARCHAR(100);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_name VARCHAR(100);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS master_contract_ref TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_info TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_name TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS branch_name TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS account_type VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS account_number VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS account_holder_kana TEXT;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_invoice_issuer BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS invoice_registration_number VARCHAR(50);`,
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_rep TEXT;`,
    // upsert は vendor_addresses / vendor_bank_accounts にも書き込むため、
    //   テーブルが無い旧 DB でも 42P01 にならないよう最低限の DDL を保証する。
    `CREATE TABLE IF NOT EXISTS vendor_addresses (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      address_label VARCHAR(100),
      postal_code VARCHAR(20),
      address TEXT NOT NULL,
      is_primary BOOLEAN DEFAULT FALSE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS vendor_bank_accounts (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      bank_label VARCHAR(100),
      bank_name TEXT,
      branch_name TEXT,
      account_type VARCHAR(50),
      account_number VARCHAR(50),
      account_holder_kana TEXT,
      is_primary BOOLEAN DEFAULT FALSE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    // 0014: 海外送金フィールド。migration が共有 DB に届く前でも overseas 口座を
    //   保存できるよう、upsert 前に冪等に保証する(replaceVendorBankAccounts の
    //   INSERT が参照する列)。
    `ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS account_scope VARCHAR(20) DEFAULT 'domestic';`,
    `ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS swift_bic VARCHAR(20);`,
    `ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS iban VARCHAR(64);`,
    `ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS routing_number VARCHAR(40);`,
    `ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS account_holder_name TEXT;`,
    `ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS bank_country VARCHAR(2);`,
    `ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS bank_address TEXT;`,
    `ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS currency VARCHAR(3);`,
    `ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS intermediary_bank_swift VARCHAR(20);`,
    `ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS intermediary_bank_name TEXT;`,
  ];
  for (const sql of stmts) {
    await query(sql);
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

/**
 * Phase 17k: ARC umbrella + 文書種別 prefix + 年 + 連番 の 4 セグメント形式。
 *   ARC-<TYPE>-<YEAR>-<NNNN>  例: ARC-PO-2026-0001
 *
 * worker 側の db.ts と完全に同じロジックを保つ (どちらの service が
 * 採番を実行しても同じ結果になるように)。
 */
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
      // 発注系
      purchase_order: "PO",
      planning_purchase_order: "PPO",
      intl_purchase_order: "IPO",
      "発注書": "PO",
      // 検収系
      inspection_certificate: "INS",
      inspection_certificate_v2: "INS",
      inspection_certificate_detailed: "INS",
      delivery_inspec: "INS",
      "検収書": "INS",
      // ライセンス系
      license_master: "LIC",
      lic_individual: "ILT",
      individual_license_terms: "ILT",
      license_report: "LRP",
      license_calculation_sheet: "LCS",
      intl_master: "ILM",
      intl_amendment: "IAM",
      "ライセンス基本契約": "LIC",
      "個別利用許諾条件": "ILT",
      // ロイヤリティ / 支払
      royalty_statement: "ROY",
      manufacturing: "MFG",
      payment_notice: "PAY",
      payment_notice_alt: "PAY",
      fee_statement: "FEE",
      "利用許諾料計算書": "ROY",
      // 業務委託
      service_master: "SVC",
      service_terms: "SVT",
      outsourcing: "OUT",
      "業務委託基本契約": "SVC",
      // 売買
      sales_master: "SAL",
      sales_master_buyer: "SAL",
      sales_master_credit: "SAL",
      sales_master_standard: "SAL",
      "売買基本契約": "SAL",
      // 出版 (Phase 25.6): worker と同一仕様。基本契約=PUB / 利用許諾条件書=PUBT /
      //   追加利用許諾条件書=PUBA。publication_contract は legalon import の基本契約。
      pub_master_individual: "PUB",
      pub_master_corporate: "PUB",
      publication_contract: "PUB",
      "出版等許諾基本契約": "PUB",
      "出版基本契約": "PUB",
      pub_license_terms: "PUBT",
      "出版等利用許諾条件書": "PUBT",
      pub_additional_terms: "PUBA",
      "追加利用許諾条件書": "PUBA",
      // 通知・同意 (個人情報取得 通知・同意書) → ARC-PR-YYYY-NNNN
      notice_consent_personal_info_freelance: "PR",
      "個人情報取得 通知・同意書": "PR",
      // その他
      nda: "NDA",
      "NDA": "NDA",
      contract: "CTR",
      external_contract: "ARC",
      legal_request: "REQ",
      legal_consult: "REQ",
    };
    prefix =
      typeCodes[type] ||
      (issueTypeName ? typeCodes[issueTypeName] : "") ||
      type.toUpperCase().substring(0, 3);
  }

  const year = new Date().getFullYear();
  // sequence kind = prefix なので文書種別ごとに独立した連番が走る
  const val = await getNextSequenceValue(prefix, year);

  return `ARC-${prefix}-${year}-${val.toString().padStart(4, "0")}`;
}
