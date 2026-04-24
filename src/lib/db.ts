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
      issue_key VARCHAR(50) NOT NULL,
      template_type VARCHAR(50) NOT NULL,
      form_data JSONB NOT NULL,
      drive_link TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(255)
    );`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_number VARCHAR(100) UNIQUE;`,
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`,

    `CREATE TABLE IF NOT EXISTS document_sequences (
      sequence_key VARCHAR(50) PRIMARY KEY,
      current_value INTEGER DEFAULT 0
    );`,

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
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,

    // 5. Licensing & Royalties
    `CREATE TABLE IF NOT EXISTS license_contracts (
      id SERIAL PRIMARY KEY,
      backlog_issue_key VARCHAR(50) UNIQUE NOT NULL,
      ledger_id VARCHAR(50) UNIQUE NOT NULL,
      licensor VARCHAR(255),
      original_work TEXT,
      royalty_rate DECIMAL(5, 4),
      mg_amount DECIMAL(15, 2),
      fee_structure VARCHAR(50),
      payment_cycle VARCHAR(50),
      license_start_date DATE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,

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

export async function getNextSequenceValue(sequenceKey: string): Promise<number> {
  const res = await query(
    `INSERT INTO document_sequences (sequence_key, current_value)
     VALUES ($1, 1)
     ON CONFLICT (sequence_key)
     DO UPDATE SET current_value = document_sequences.current_value + 1
     RETURNING current_value`,
    [sequenceKey]
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
      inspection_certificate: "INS",
      royalty_statement: "ROY",
      payment_notice: "PAY",
      legal_request: "REQ",
      service_master: "SRVP",
      license_master: "LIC",
      fee_statement: "FEE",
      asset: "AST",
      external_contract: "EXT",
      design: "DSG",
      spec: "SPC"
    };
    prefix = typeCodes[type] || type.toUpperCase().substring(0, 3);
  }

  const year = new Date().getFullYear();
  const sequenceKey = `${prefix}-${year}`;
  const val = await getNextSequenceValue(sequenceKey);
  return `${prefix}-${year}-${val.toString().padStart(4, "0")}`;
}
