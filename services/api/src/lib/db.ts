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

// Phase 7: 旧 initDb() (起動時レガシー DDL) は撤去した。スキーマは migrations/ が単一所有する。
//   0101 以降 contract_capabilities は VIEW のため、旧 ALTER TABLE 群は実行するとエラーになる死コードだった。

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
      // 再許諾/アウトライセンス条件書(当社が受け取る sublicense_out)
      sublicense_out_terms: "SLO",
      "再許諾条件書": "SLO",
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
