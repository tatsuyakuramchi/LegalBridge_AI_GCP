import pg from 'pg';
import { createHash } from 'node:crypto';

import { normalizeGenre, normalizeRole, coreGenreForDivision } from './materialVocab.ts';

/**
 * 文書の「内容ハッシュ」。重複保存の検出に使う。
 * __ で始まる制御フィールド(__reopen_doc_number 等)は除外し、キーを
 * ソートして安定化したうえで template_type と結合して sha256。
 */
export function computeFormContentHash(
  formData: Record<string, any> | null | undefined,
  templateType: string
): string {
  const clean: Record<string, any> = {};
  for (const k of Object.keys(formData || {}).sort()) {
    if (k.startsWith('__')) continue;
    clean[k] = (formData as any)[k];
  }
  return createHash('sha256')
    .update(String(templateType || '') + '\n' + JSON.stringify(clean))
    .digest('hex');
}

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
    // -----------------------------------------------------------------
    // Phase 22.10: 発注書 (および他文書) の再発行リビジョン管理。
    //   base_document_number : 初版の document_number。再発行版もこれを共有する。
    //   revision             : 0=初版 / 1,2,... = 再発行版 (採番順)
    //   document_number       : 初版は base のまま、再発行版は "{base}_001" / "_002" …
    //   vendor_name_snapshot : 生成時の取引先名 (file 名整形 / 検索用)
    //
    //   過去ドキュメントは base_document_number = document_number (= 初版) で
    //   backfill する。
    // -----------------------------------------------------------------
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS base_document_number VARCHAR(100);`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS revision INTEGER DEFAULT 0;`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS vendor_name_snapshot TEXT;`,
    `UPDATE documents
        SET base_document_number = COALESCE(base_document_number, document_number)
      WHERE base_document_number IS NULL;`,
    `CREATE INDEX IF NOT EXISTS idx_documents_base ON documents(base_document_number);`,
    // -----------------------------------------------------------------
    // Phase 22.12: 「真の契約」フラグ。
    //   is_primary    : TRUE = この行が現在の真の契約 (検索一覧に表示する)
    //                  FALSE = 旧版・superseded (新リビジョンに置き換えられた)
    //   superseded_by : この行が無効化されたとき、置き換え先の document_number
    //   既存データはまず全部 TRUE で開始 (DEFAULT TRUE)。
    //   その後 backfill: 同 base 内で newer sibling がある旧 doc は FALSE に。
    // -----------------------------------------------------------------
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT TRUE;`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS superseded_by VARCHAR(100);`,
    `UPDATE documents d SET is_primary = FALSE
      WHERE is_primary IS NOT FALSE
        AND base_document_number IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM documents d2
           WHERE d2.base_document_number = d.base_document_number
             AND d2.document_number <> d.document_number
             AND d2.created_at > d.created_at
        );`,
    `CREATE INDEX IF NOT EXISTS idx_documents_is_primary ON documents(is_primary);`,

    // contract_capabilities にも同じ概念をミラー。
    // 検索 (個別契約一覧) が is_primary でフィルタできるようにする。
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS base_document_number VARCHAR(100);`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS revision INTEGER DEFAULT 0;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT TRUE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS superseded_by VARCHAR(100);`,
    // documents から base_document_number / revision / is_primary / superseded_by を逆ミラー
    `UPDATE documents cc
        SET base_document_number = d.base_document_number,
            revision             = d.revision,
            is_primary           = d.is_primary,
            superseded_by        = d.superseded_by
       FROM documents d
      WHERE cc.document_number = d.document_number
        AND (cc.base_document_number IS NULL OR cc.is_primary IS NULL);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_is_primary ON contract_capabilities(is_primary);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_base ON contract_capabilities(base_document_number);`,

    // -----------------------------------------------------------------
    // Phase 23.1: 文書ライフサイクル管理。
    //   従来の is_primary は「真の契約=1件」のフラグだったが、(issue_key,
    //   template_type) 単位での「正/過去版」区分が運用上不足。lifecycle_status
    //   で 3 状態に分けて管理する。
    //
    //   values:
    //     'final'           ... 現在の正 (検索一覧・PDF再生成の対象)
    //     'archived_draft'  ... 内部修正で上書き前の過去版 (履歴参照のみ)
    //     'reissued'        ... 外部要請の再発行で revision+1 された過去版
    //                            (修正版 Rev. N で置換された旧 final)
    //
    //   既存データは DEFAULT 'final' で開始。実際の正規化 (= 同 issueKey に
    //   複数 final がある状態の解消) は scripts/normalize_document_lifecycle.ts
    //   を別途実行する運用とする (initDb では行わない)。
    // -----------------------------------------------------------------
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(20) DEFAULT 'final';`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(20) DEFAULT 'final';`,
    `UPDATE documents SET lifecycle_status = 'final'
      WHERE lifecycle_status IS NULL OR lifecycle_status = '';`,
    `UPDATE documents SET lifecycle_status = 'final'
      WHERE lifecycle_status IS NULL OR lifecycle_status = '';`,
    `CREATE INDEX IF NOT EXISTS idx_documents_lifecycle ON documents(lifecycle_status);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_lifecycle ON contract_capabilities(lifecycle_status);`,

    // -----------------------------------------------------------------
    // Phase 24: 会計用 Excel の発行を PDF 発行から切り離し、担当者 × 支払期日
    //   のバッチ出力に一本化。検収書 / 利用許諾料計算書が「発行済みだが Excel
    //   未発行」かを追跡する。excel_issued_at IS NULL = 未発行。
    // -----------------------------------------------------------------
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS excel_issued_at TIMESTAMP WITH TIME ZONE;`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS excel_link TEXT;`,
    // メール送信(検収書 / 利用許諾料計算書)の送信時刻・宛先・Gmail messageId。
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP WITH TIME ZONE;`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS email_to TEXT;`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS email_message_id TEXT;`,
    `CREATE INDEX IF NOT EXISTS idx_documents_excel_pending
       ON documents(template_type)
       WHERE excel_issued_at IS NULL;`,

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
    // -----------------------------------------------------------------
    // Phase 22.13: 代表者名 (法人の場合に契約書 / 発注書の代表者欄に転記)。
    //   個人事業主では空でよい。entity_type = 'corporate' の場合のみ UI で必須化。
    // -----------------------------------------------------------------
    `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_rep TEXT;`,
    // -----------------------------------------------------------------
    // Phase 22.13: 担当者を 1 取引先 N 担当者の構造化テーブルに分離。
    //   従来 vendors.contact_name は 1:1 だったが、大企業や複数案件持ち
    //   取引先に対応するため別テーブル化。1 件を is_primary=TRUE で
    //   「メイン担当者」とし、vendor 行の contact_name は backfill で
    //   primary 担当者の名前にミラーする (後方互換)。
    // -----------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS vendor_contacts (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      contact_name VARCHAR(255) NOT NULL,
      contact_department VARCHAR(255),
      title VARCHAR(100),
      email VARCHAR(255),
      phone VARCHAR(50),
      is_primary BOOLEAN DEFAULT FALSE,
      sort_order INTEGER DEFAULT 0,
      remarks TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS idx_vendor_contacts_vendor ON vendor_contacts(vendor_id);`,
    `CREATE INDEX IF NOT EXISTS idx_vendor_contacts_primary ON vendor_contacts(vendor_id, is_primary);`,
    // backfill: 既存 vendors.contact_name を primary contact として 1 行作る
    // (まだ vendor_contacts に存在しない場合のみ)。
    `INSERT INTO vendor_contacts (vendor_id, contact_name, contact_department, email, phone, is_primary, sort_order)
     SELECT v.id, v.contact_name, v.contact_department, v.email, v.phone, TRUE, 0
       FROM vendors v
      WHERE v.contact_name IS NOT NULL
        AND v.contact_name <> ''
        AND NOT EXISTS (
          SELECT 1 FROM vendor_contacts vc WHERE vc.vendor_id = v.id
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
    // -----------------------------------------------------------------
    // Phase 22.21.40: アプリ内ロール (app_role) を staff に追加。
    //   元々 Phase 22.21.36 で services/api/src/lib/db.ts に書いていたが、
    //   そちらの initDb() は server.ts から呼ばれない死コードだったため、
    //   実際にマイグレーションを走らせる worker 側 db.ts に移植する。
    //
    //   values:
    //     'admin'  ... /admin ダッシュボード + import 機能を使える
    //     'viewer' ... 検索系のみ (default)
    //   NULL は viewer 扱い (後方互換)。
    //
    //   bootstrap: 「経営管理本部」「法務」部署の既存 staff を自動的に admin
    //   に昇格 (Phase 22.21.36 リリース直後でも admin が誰か居る状態に)。
    //
    //   ※ 旧コードの WHERE 句に OR の優先順位ミスがあったので修正:
    //     旧: WHERE app_role IS NULL OR app_role = 'viewer' AND department IN (...)
    //         (AND が先に評価されて意図と違う)
    //     新: WHERE (app_role IS NULL OR app_role = 'viewer')
    //           AND department IN (...)
    // -----------------------------------------------------------------
    `ALTER TABLE staff ADD COLUMN IF NOT EXISTS app_role VARCHAR(20) DEFAULT 'viewer';`,
    `UPDATE staff
        SET app_role = 'admin'
      WHERE (app_role IS NULL OR app_role = 'viewer')
        AND department IN ('経営管理本部', '法務');`,

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

    // Phase 22: 「終結」(既存課題に統合された) の記録用
    //   ステータスが「終結」になった課題で、どの課題に統合されたかを残す。
    //   admin-ui で見ると「統合先 LEGAL-XXX」が分かる。
    `ALTER TABLE legal_requests ADD COLUMN IF NOT EXISTS merged_into_issue_key VARCHAR(50);`,

    // -----------------------------------------------------------------
    // Phase 22.21.21: 古い 発注書 / 検収書 / 個別利用許諾条件書 の
    //   contract_type を backfill。
    //
    //   背景: Phase 22.21.20 以前は Admin UI からの /api/documents/generate
    //   が legal_requests を INSERT する際に contract_type を入れていなかった。
    //   その結果、自動連鎖 (autoChainOnComplete) が parentRequestType と
    //   マッチせず、納品リクエスト子課題 / 売上報告子課題が作られていなかった。
    //
    //   修正: documents.template_type を辿って contract_type を埋める。
    //   既に contract_type が入っている行は触らない (IS NULL / '' のみ対象)。
    //   冪等なので毎回 worker 起動時に走っても安全。
    //
    //   マッピング:
    //     template_type LIKE '%purchase_order%'           → 'purchase_order'
    //                                                       (planning_purchase_order も purchase_order に統合する。
    //                                                        自動連鎖ルールはどちらも同じ delivery_inspec を子に
    //                                                        付ける想定なので OK)
    //     template_type LIKE 'inspection%'                → 'delivery_inspec'
    //     template_type = 'individual_license_terms'      → 'lic_individual'
    // -----------------------------------------------------------------
    `UPDATE legal_requests lr
        SET contract_type = 'purchase_order'
       FROM documents d
      WHERE d.issue_key = lr.backlog_issue_key
        AND d.template_type LIKE '%purchase_order%'
        AND (lr.contract_type IS NULL OR lr.contract_type = '');`,
    `UPDATE legal_requests lr
        SET contract_type = 'delivery_inspec'
       FROM documents d
      WHERE d.issue_key = lr.backlog_issue_key
        AND d.template_type LIKE 'inspection%'
        AND (lr.contract_type IS NULL OR lr.contract_type = '');`,
    `UPDATE legal_requests lr
        SET contract_type = 'lic_individual'
       FROM documents d
      WHERE d.issue_key = lr.backlog_issue_key
        AND d.template_type = 'individual_license_terms'
        AND (lr.contract_type IS NULL OR lr.contract_type = '');`,

    // -----------------------------------------------------------------
    // Phase 22.21.26: 自動連鎖 (autoChainOnComplete) の race-safe dedup。
    //   症状: 2.2ms 差で同じ親に対し 2 つの子課題が INSERT された
    //   (LEGAL-125 / LEGAL-126 とも notes='親: LEGAL-120')
    //   原因: PATCH /status の直接呼び出し と Backlog webhook が同時着火し、
    //         両方とも SELECT (no row) → INSERT のパスを通った (TOCTOU race)。
    //   対策: 親キーを専用カラムに昇格させて UNIQUE 制約で防ぐ。
    //
    //   - parent_issue_key カラム追加
    //   - 既存 notes ('親: LEGAL-XXX') から正規表現で backfill
    //   - 部分 UNIQUE INDEX (contract_type, parent_issue_key) を WHERE 両方
    //     NOT NULL で作成 → 同じ親に対する同じ contract_type の 2 件目を拒否
    //   - 既存重複行 (LEGAL-125 / LEGAL-126 のような) は手動 cleanup 後に
    //     インデックスを張る (まず重複削除、その後 CREATE) のが安全だが、
    //     CREATE UNIQUE INDEX IF NOT EXISTS は既存重複があると失敗する。
    //     そのため CREATE INDEX (non-unique) で先に張り、後段の運用で
    //     重複削除→DROP INDEX→CREATE UNIQUE INDEX の手順を踏む。
    //
    //   --> Phase 22.21.26 では まず column + backfill + non-unique index のみ。
    //       重複行を手動で削除した後、別マイグレーション (22.21.27) で
    //       UNIQUE INDEX に置き換える計画。
    //       worker INSERT 側は parent_issue_key を埋めるが、ON CONFLICT は
    //       UNIQUE 化以降に強制的に効く形にする。
    // -----------------------------------------------------------------
    `ALTER TABLE legal_requests ADD COLUMN IF NOT EXISTS parent_issue_key VARCHAR(50);`,
    `UPDATE legal_requests
        SET parent_issue_key = substring(notes from '親: (LEGAL-[0-9]+)')
      WHERE parent_issue_key IS NULL
        AND notes ~ '親: LEGAL-[0-9]+';`,
    `CREATE INDEX IF NOT EXISTS idx_lr_parent_issue_key
        ON legal_requests (parent_issue_key)
      WHERE parent_issue_key IS NOT NULL;`,

    // -----------------------------------------------------------------
    // Phase 23.6.5: order_items / order_line_items / order_expenses /
    //   order_other_fees の CREATE TABLE / ALTER / Backfill は廃止。
    //   新規 DB では作成しない (= contract_capabilities + capability_line_items
    //   + capability_expenses + capability_other_fees に統合済み)。
    //   既存 DB の物理 DROP は scripts/phase23_migrate_to_capabilities.ts
    //   --apply --drop --really-drop で実施。
    //   delivery_events.order_item_id / delivery_line_items.order_line_item_id
    //   は FK 列として残置 (物理 DROP 時に同時撤去予定)。
    // -----------------------------------------------------------------

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

    // -----------------------------------------------------------------
    // Phase 23.6.5: 旧 order_line_items / order_expenses / order_other_fees
    //   への ALTER / Backfill / INDEX 文も廃止 (capability_* に統合済み)。
    //   旧テーブルが残存する DB でも IF NOT EXISTS は害が無いが、新規 DB では
    //   そもそもテーブルが作られないので無意味なため削除。
    // -----------------------------------------------------------------

    // -----------------------------------------------------------------
    // Phase 17: 稟議 (ringi) マスタ + 文書との N:N 関連
    //
    // 社内では稟議番号 (5 桁数字, 例: '00001') 単位で複数文書を束ねて
    // 管理している。例:
    //   稟議 00001 (商品開発稟議)
    //     ├ 発注書 PO-2024-001
    //     ├ 個別利用許諾 LIC-2024-001
    //     └ NDA NDA-2024-005
    //
    // 1 つの文書が複数の稟議に紐付くケースもありうるので junction
    // テーブル (N:N) で持つ。
    // -----------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ringi_records (
      id SERIAL PRIMARY KEY,
      ringi_number VARCHAR(5) UNIQUE NOT NULL,
      title TEXT NOT NULL,
      category VARCHAR(50),
      owner_name VARCHAR(255),
      owner_department VARCHAR(100),
      approved_at DATE,
      backlog_issue_key VARCHAR(50),
      status VARCHAR(50) DEFAULT 'open',
      total_budget DECIMAL(15, 2),
      remarks TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT ringi_number_5digits CHECK (ringi_number ~ '^[0-9]{5}$')
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ringi_number ON ringi_records(ringi_number);`,
    `CREATE INDEX IF NOT EXISTS idx_ringi_backlog ON ringi_records(backlog_issue_key);`,
    `CREATE INDEX IF NOT EXISTS idx_ringi_status ON ringi_records(status);`,

    // Phase 22.21.117: 決裁種別を導入 — 稟議承認 + 取締役会決議 を区別する。
    //   ringi_number の format を 5 桁数字から "R-NNNNN" (稟議) /
    //   "B-NNNNN" (board) のプレフィックス付きに拡張。
    //
    //   Migration 手順:
    //     (1) decision_type 列を追加 (default 'ringi')
    //     (2) 旧 CHECK 制約 (5 桁数字限定) を撤去
    //     (3) 既存 5 桁数字を "R-" プレフィックスで backfill
    //     (4) 新 CHECK 制約 (R-NNNNN / B-NNNNN) を追加
    `ALTER TABLE ringi_records
       ADD COLUMN IF NOT EXISTS decision_type VARCHAR(20) DEFAULT 'ringi';`,
    `UPDATE ringi_records SET decision_type = 'ringi'
       WHERE decision_type IS NULL OR decision_type = '';`,
    `ALTER TABLE ringi_records DROP CONSTRAINT IF EXISTS ringi_number_5digits;`,
    `UPDATE ringi_records
        SET ringi_number = 'R-' || ringi_number
      WHERE ringi_number ~ '^[0-9]{5}$';`,
    // 新 CHECK 制約 (重複追加で失敗しないよう DO ブロックで囲む)
    `DO $ringi_chk$
       BEGIN
         BEGIN
           ALTER TABLE ringi_records ADD CONSTRAINT ringi_number_format
             CHECK (ringi_number ~ '^(R|B)-[0-9]{5}$');
         EXCEPTION WHEN duplicate_object THEN
           NULL;
         END;
       END
     $ringi_chk$;`,
    `CREATE INDEX IF NOT EXISTS idx_ringi_decision_type ON ringi_records(decision_type);`,

    `CREATE TABLE IF NOT EXISTS ringi_documents (
      ringi_id INTEGER NOT NULL REFERENCES ringi_records(id) ON DELETE CASCADE,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      linked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ringi_id, document_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ringi_documents_doc ON ringi_documents(document_id);`,

    // -----------------------------------------------------------------
    // Phase 11: 文書カテゴリ (基本 / 個別 / その他)
    //
    // 検索結果 (Slack /法務検索) で 基本契約 / 個別契約 / その他 の
    // 3 セクションに分けて表示するための分類列。template_type から
    // 機械的に決まるので、worker 側 helper で INSERT 時に自動設定する。
    //
    // values:
    //   'basic'      … 基本契約 (license_master, service_master, sales_master_*)
    //   'individual' … 個別契約 (purchase_order, individual_license_terms,
    //                          inspection_certificate, royalty_, maintenance_spec)
    //   'other'      … その他 (nda)
    //
    // Phase 22.21.82: 削除済みテンプレを SQL 関数からも除去
    //   削除: intl_master, planning_purchase_order, fee_, license_report,
    //         payment_notice
    //   追加: maintenance_spec (Phase 22.21.64 追加の別紙)
    // -----------------------------------------------------------------
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_category VARCHAR(20);`,
    `CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(document_category);`,
    // template_type → category マップを 1 つの SQL 関数に集約。
    // worker / search-api 両方の SELECT で UPDATE 不要、INSERT 時 trigger で
    // 自動設定。helper TS 側 (documentCategory.ts) と同じロジック。
    `CREATE OR REPLACE FUNCTION lb_category_for_template(t TEXT) RETURNS VARCHAR(20) AS $$
       BEGIN
         IF t IN ('license_master','service_master','sales_master_buyer','sales_master_standard','sales_master_credit') THEN
           RETURN 'basic';
         ELSIF t = 'individual_license_terms'
            OR t LIKE 'purchase_order%'
            OR t LIKE 'intl_purchase_order%'
            OR t LIKE 'inspection_certificate%'
            OR t LIKE 'royalty_%'
            OR t LIKE 'maintenance_spec%' THEN
           RETURN 'individual';
         ELSE
           RETURN 'other';
         END IF;
       END;
     $$ LANGUAGE plpgsql IMMUTABLE;`,
    // 既存行のバックフィル
    `UPDATE documents
        SET document_category = lb_category_for_template(template_type)
      WHERE document_category IS NULL OR document_category = '';`,
    // INSERT/UPDATE 時に template_type から自動設定 (個別 INSERT で渡し忘れても OK)
    `CREATE OR REPLACE FUNCTION lb_documents_set_category() RETURNS TRIGGER AS $$
       BEGIN
         IF NEW.document_category IS NULL OR NEW.document_category = '' THEN
           NEW.document_category := lb_category_for_template(NEW.template_type);
         END IF;
         RETURN NEW;
       END;
     $$ LANGUAGE plpgsql;`,
    `DROP TRIGGER IF EXISTS documents_auto_category ON documents;`,
    `CREATE TRIGGER documents_auto_category
       BEFORE INSERT OR UPDATE ON documents
       FOR EACH ROW EXECUTE FUNCTION lb_documents_set_category();`,

    // -----------------------------------------------------------------
    // Phase 9f: 1 PO に対する複数回の分割検収サポート
    //
    // 旧: backlog_issue_key UNIQUE → 1 issue = 1 検収行 (再生成は上書き)
    // 新: (backlog_issue_key, delivery_no) UNIQUE → 1 issue = N 検収行
    //
    // 既存 DB の UNIQUE 制約を DROP して複合 UNIQUE に張り替え。
    // 既存データは delivery_no=1 を NOT NULL DEFAULT で埋める。
    // -----------------------------------------------------------------
    `UPDATE delivery_events SET delivery_no = 1 WHERE delivery_no IS NULL;`,
    `ALTER TABLE delivery_events ALTER COLUMN delivery_no SET NOT NULL;`,
    `ALTER TABLE delivery_events ALTER COLUMN delivery_no SET DEFAULT 1;`,
    // 旧 UNIQUE 制約をベストエフォートで削除 (制約名は環境依存だが、
    // pg は CREATE TABLE 内で `UNIQUE NOT NULL` を書くと
    // <table>_<col>_key の命名で auto-generate する)
    `ALTER TABLE delivery_events DROP CONSTRAINT IF EXISTS delivery_events_backlog_issue_key_key;`,
    // 念のためインデックス側もクリーンアップ
    `DROP INDEX IF EXISTS delivery_events_backlog_issue_key_key;`,
    // 複合 UNIQUE を立てる
    `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
            WHERE conname = 'delivery_events_issue_no_uniq'
         ) THEN
           ALTER TABLE delivery_events
             ADD CONSTRAINT delivery_events_issue_no_uniq
             UNIQUE (backlog_issue_key, delivery_no);
         END IF;
       END$$;`,
    `CREATE INDEX IF NOT EXISTS idx_de_issue ON delivery_events(backlog_issue_key);`,

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
      -- Phase 23.6.5: order_line_items は廃止予定のため FK 制約を外す
      order_line_item_id INTEGER,
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
    // -----------------------------------------------------------------
    // Phase 23.6.5: license_contracts の CREATE TABLE / ALTER / Backfill は廃止。
    //   新規 DB では作成しない (= contract_capabilities + capability_financial_conditions
    //   に統合済み)。
    //   既存 DB の物理 DROP は scripts/phase23_migrate_to_capabilities.ts
    //   --apply --drop --really-drop で実施。
    //   旧テーブルを参照する work_sublicensees / manufacturing_events /
    //   royalty_payments / royalty_calculations の license_contract_id 列は
    //   FK 制約を外して残置 (物理 DROP 時に同時撤去予定)。
    // -----------------------------------------------------------------

    // [削除] サブライセンシー(sublicensees / work_sublicensees)の CREATE は廃止(0113 で DROP)。

    // -----------------------------------------------------------------
    // Phase 22.18: 原作マスター (ledgers) + 素材マスター (materials)
    //   原作 IP 単位 → 配下に素材 N 件 → 各素材ごとに 1 契約 (license_contracts)
    //   ID 体系:
    //     ledgers.ledger_code      : LO-YYYY-NNNN
    //     materials.material_code  : {ledger_code}-NNN  (枝番、原作本体 = -001)
    //     license_contracts.work_id : LIC-{ledger_code}-W-YYYY-NNNN
    //   原作登録時に自動で -001 (原作本体) を 1 件作成し、ledger 配下の
    //   デフォルト素材として運用する。
    // -----------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ledgers (
      id SERIAL PRIMARY KEY,
      ledger_code VARCHAR(40) UNIQUE NOT NULL,
      title TEXT NOT NULL,
      title_kana TEXT,
      alternative_titles TEXT[] DEFAULT '{}',
      creator_name TEXT,
      publisher_name TEXT,
      remarks TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ledgers_active ON ledgers(is_active);`,
    `CREATE INDEX IF NOT EXISTS idx_ledgers_title_kana ON ledgers(title_kana);`,
    // Phase 22.20: 原作マスターのデフォルト値 (個別利用許諾条件書フォームで自動引用)
    //   default_rights_holder    : 素材権利者デフォルト (materials.rights_holder が空のとき fallback)
    //   default_credit_display   : PDF のクレジット表記デフォルト
    //   default_work_supplement  : 原著作物補記デフォルト
    // Phase 22.21.7: 承認条件 / 承認時期 のデフォルト値も原作単位で持つ。
    //   default_approval_target  : 承認対象 (例: "ゲームルール・テーマ・文面...")
    //   default_approval_timing  : 承認時期 (例: "製造前・変更前（書面による事前承諾）")
    `ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS default_rights_holder TEXT;`,
    `ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS default_credit_display TEXT;`,
    `ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS default_work_supplement TEXT;`,
    `ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS default_approval_target TEXT;`,
    `ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS default_approval_timing TEXT;`,
    // Phase 26: 事業部タグ (BDG=ボードゲーム事業部 / PUB=出版事業部)。複数付与可 (TEXT[])。
    //   既存行 (division IS NULL) は従来ボードゲーム用途なので BDG で一度きり初期化する。
    //   以後の新規 INSERT は createLedgerWithDefaultMaterial が必ず値を入れるため NULL は発生しない。
    `ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS division TEXT[];`,
    `UPDATE ledgers SET division = ARRAY['BDG'] WHERE division IS NULL;`,
    `CREATE INDEX IF NOT EXISTS idx_ledgers_division ON ledgers USING GIN (division);`,
    // マテリアル一本化(0089/0090): 旧 materials 表は廃止。素材は正準表 work_materials に一本化。
    //   起動時 DDL での materials 再作成は撤去(DROP 後の復活を防ぐ)。
    // Phase 23.6.5: license_contracts の ALTER は廃止 (テーブル自体が新規 DB には存在しない)。

    // Phase 23.6.5: license_financial_conditions の CREATE / ALTER / Backfill は廃止
    //   (capability_financial_conditions に統合済み)。

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
    // Phase 5a: 製造イベントにも単価・サンプル数・課金対象数を追加。
    `ALTER TABLE manufacturing_events ADD COLUMN IF NOT EXISTS unit_price DECIMAL(15, 2);`,
    `ALTER TABLE manufacturing_events ADD COLUMN IF NOT EXISTS sample_quantity DECIMAL(10, 4) DEFAULT 0;`,
    `ALTER TABLE manufacturing_events ADD COLUMN IF NOT EXISTS billable_quantity DECIMAL(10, 4);`,
    `ALTER TABLE manufacturing_events ADD COLUMN IF NOT EXISTS edition VARCHAR(100);`,
    // Backfill: legacy quantity を課金対象に、msrp を unit_price に。
    `UPDATE manufacturing_events
        SET unit_price = msrp
      WHERE unit_price IS NULL AND msrp IS NOT NULL;`,
    `UPDATE manufacturing_events
        SET billable_quantity = quantity
      WHERE billable_quantity IS NULL AND quantity IS NOT NULL;`,

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

    // -----------------------------------------------------------------
    // Phase 5a: 利用許諾料計算書 (1 計算書 = 1 行)
    //
    // 既存の royalty_payments は支払イベントだけ、MG 消化の履歴や
    // ロイヤリティ算出根拠 (unit_price × quantity × rate) の内訳は
    // JSONB の form_data に閉じ込められていた。
    // このテーブルは「いつ、どの金銭条件で、どれだけ製造して、
    // MG をいくら消化し、税抜・税込いくら支払う」を SQL レベルで
    // 追えるようにする。
    //
    // MG 消化は累積計算なので、ある期の mg_consumed_this_time は
    //   max(0, gross_royalty - max(0, mg_amount - SUM(prior mg_consumed)))
    // で求まる。calc_license.ts (Phase 5b) で実装する。
    // -----------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS royalty_calculations (
      id SERIAL PRIMARY KEY,
      backlog_issue_key VARCHAR(50),               -- 計算書の Backlog issue
      -- Phase 23.6.5: license_contracts / license_financial_conditions は廃止予定のため FK 制約を外す
      -- (列自体は物理 DROP 時に capability_id と一緒に撤去予定)
      license_contract_id INTEGER,
      license_financial_condition_id INTEGER,
      manufacturing_event_id INTEGER REFERENCES manufacturing_events(id),
      calc_type VARCHAR(20),                       -- manufacturing / sales / sublicense
      unit_price DECIMAL(15, 2),                   -- 基準価格 (MSRP 等)
      quantity DECIMAL(10, 4),                     -- 製造数 (総数)
      sample_quantity DECIMAL(10, 4) DEFAULT 0,    -- サンプル数 (不課金)
      billable_quantity DECIMAL(10, 4),            -- 課金対象数 = quantity - sample
      rate_pct DECIMAL(7, 4),                      -- 適用料率 (%)
      gross_royalty_ex_tax DECIMAL(15, 2),         -- 総ロイヤリティ (税抜)
      mg_amount DECIMAL(15, 2),                    -- 適用 MG 総額 (snapshot)
      mg_consumed_before DECIMAL(15, 2),           -- 前回までの MG 消化額
      mg_consumed_this_time DECIMAL(15, 2),        -- 今回 MG 消化額
      mg_consumed_after DECIMAL(15, 2),            -- 今回後 MG 累計消化額
      mg_remaining DECIMAL(15, 2),                 -- MG 残額
      mg_fully_consumed BOOLEAN DEFAULT FALSE,
      actual_royalty_ex_tax DECIMAL(15, 2),        -- 実支払額 = gross - mg_consumed_this_time
      tax_rate INTEGER DEFAULT 10,                 -- 10 / 8
      tax_amount DECIMAL(15, 2),                   -- 切り上げ消費税
      total_payment_inc_tax DECIMAL(15, 2),
      currency VARCHAR(10) DEFAULT 'JPY',
      period VARCHAR(7),                           -- YYYY-MM
      reporting_deadline DATE,
      payment_due_date DATE,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS idx_rc_license ON royalty_calculations(license_contract_id);`,
    `CREATE INDEX IF NOT EXISTS idx_rc_mfg ON royalty_calculations(manufacturing_event_id);`,
    `CREATE INDEX IF NOT EXISTS idx_rc_period ON royalty_calculations(license_contract_id, period);`,
    // Phase 22.21.95: AG (Advance Guarantee) と MG floor の履歴列を追加。
    //   - mg_topup_this_time: MG floor が適用された上乗せ額 (max(0, mg - gross))
    //   - ag_amount / ag_consumed_*: AG の累積消化を追跡
    //   旧 mg_consumed_* 列は legacy 互換のため残置 (新規 INSERT では 0)
    `ALTER TABLE royalty_calculations
       ADD COLUMN IF NOT EXISTS mg_topup_this_time DECIMAL(15, 2) DEFAULT 0;`,
    `ALTER TABLE royalty_calculations
       ADD COLUMN IF NOT EXISTS ag_amount DECIMAL(15, 2) DEFAULT 0;`,
    `ALTER TABLE royalty_calculations
       ADD COLUMN IF NOT EXISTS ag_consumed_before DECIMAL(15, 2) DEFAULT 0;`,
    `ALTER TABLE royalty_calculations
       ADD COLUMN IF NOT EXISTS ag_consumed_this_time DECIMAL(15, 2) DEFAULT 0;`,
    `ALTER TABLE royalty_calculations
       ADD COLUMN IF NOT EXISTS ag_consumed_after DECIMAL(15, 2) DEFAULT 0;`,
    `ALTER TABLE royalty_calculations
       ADD COLUMN IF NOT EXISTS ag_remaining DECIMAL(15, 2) DEFAULT 0;`,
    `ALTER TABLE royalty_calculations
       ADD COLUMN IF NOT EXISTS ag_fully_consumed BOOLEAN DEFAULT FALSE;`,

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
    // -----------------------------------------------------------------
    // Phase 22.9: 「有効な基本契約 / 無効な基本契約」フラグ。
    //   contract_status (executed/expired/terminated) とは独立して、
    //   「実際に使う / 使わない」をユーザーがトグルできるようにする。
    //   発注書 / 個別利用許諾条件書 / 個別出版条件書 の自動補完では
    //   is_active=TRUE の契約だけを候補とする。
    // -----------------------------------------------------------------
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_active ON contract_capabilities(is_active);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_vendor ON contract_capabilities(vendor_id);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_category ON contract_capabilities(contract_category);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_type ON contract_capabilities(contract_type);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_record_type ON contract_capabilities(record_type);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_purposes ON contract_capabilities USING GIN(purpose_codes);`,
    // -----------------------------------------------------------------
    // Phase 17p: contract_capabilities.document_number の UNIQUE 制約。
    //
    // 旧: 部分インデックス (WHERE document_number IS NOT NULL) として張って
    //     いたが、PostgreSQL の ON CONFLICT は部分ユニークインデックスを
    //     自動推論せず、INSERT ... ON CONFLICT (document_number) DO UPDATE
    //     が
    //       "there is no unique or exclusion constraint matching the
    //        ON CONFLICT specification"
    //     で失敗していた。これにより worker の contract_capabilities mirror
    //     が常に try/catch 内で握り潰され、法務検索 (個別契約) に発注書が
    //     出ない原因になっていた。
    //
    // 新: 通常の UNIQUE INDEX に変更。PostgreSQL では UNIQUE INDEX は
    //     NULL 値を「distinct (互いに異なる)」として扱うので、
    //     複数行が document_number=NULL でも問題ない (= 部分インデックス
    //     と意味的に同じ) が、ON CONFLICT (document_number) で正しく
    //     推論される。
    //
    // 旧インデックスを冪等に DROP → 新規 UNIQUE INDEX を CREATE。
    // -----------------------------------------------------------------
    `DROP INDEX IF EXISTS idx_capabilities_doc_num;`,
    // Phase 22.21.102: contract_capabilities の document_number 重複を解消
    // (ユーザー要望: 真 = 最新 updated_at)。
    //
    //   旧実装 (id ベース) は新しく INSERT された行が必ず "真" になり、
    //   ユーザーが古い行を手動編集 (= updated_at が新しい) しても上書き
    //   削除される問題があった。Phase 22.21.102 で updated_at の最新を
    //   "真" に変更し、子テーブル (capability_financial_conditions) も
    //   loser → winner に再ポイントしてからマージ削除する。
    //
    //   手順:
    //     (1) winners 一時テーブル: 各 document_number で max(updated_at)
    //         → tie-break: max(id) → 1 件選ぶ
    //     (2) losers 一時テーブル: winner 以外の重複行
    //     (3) capability_financial_conditions:
    //         - winner が同じ condition_no を持っていなければ loser→winner に移行
    //         - 持っていれば loser 側の cfc 行は削除 (winner の値を採用)
    //     (4) losers の contract_capabilities 行を削除
    //         (CASCADE で残りの cfc も消える保険)
    //
    //   PL/pgSQL DO ブロックで wrap して原子性を確保。一時テーブルは
    //   セッション完了で自動破棄される。
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
         -- (3a) move financial_conditions where winner doesn't already have the condition_no
         UPDATE capability_financial_conditions cfc
            SET capability_id = l.winner_id
           FROM _cc_losers l
          WHERE cfc.capability_id = l.loser_id
            AND NOT EXISTS (
              SELECT 1 FROM capability_financial_conditions w
               WHERE w.capability_id = l.winner_id
                 AND w.condition_no = cfc.condition_no
            );
         -- (3b) delete remaining loser financial_conditions
         DELETE FROM capability_financial_conditions cfc
          USING _cc_losers l
          WHERE cfc.capability_id = l.loser_id;
         -- (4) delete loser contract_capabilities rows
         DELETE FROM documents cc
          USING _cc_losers l
          WHERE cc.id = l.loser_id;
         RAISE NOTICE
           '[Phase 22.21.102] contract_capabilities: merged % duplicate rows by document_number (winner = latest updated_at).',
           loser_count;
       END IF;
     END
     $merge$;`,
    // Phase 22.21.102: NON-partial UNIQUE INDEX を維持 (= 既存の
    //   ON CONFLICT (document_number) DO UPDATE を持つ INSERT 7+ 箇所と
    //   推論互換)。Postgres は NULL を distinct 扱いするので、
    //   document_number=NULL の行は複数 OK (NULL 同士は重複しない)。
    `CREATE UNIQUE INDEX IF NOT EXISTS contract_capabilities_doc_num_uniq
       ON contract_capabilities(document_number);`,

    // Phase 17x: 3+ 者契約サポート (詳細は api/src/lib/db.ts の同名コメント参照)
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS additional_parties JSONB DEFAULT '[]'::jsonb;`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_additional_parties
       ON contract_capabilities USING GIN (additional_parties);`,

    // Phase 20: 契約更新アラート用カラム (詳細は api/src/lib/db.ts の同名コメント参照)
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS renewal_notice_months INTEGER;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS alert_lead_months INTEGER;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS last_renewal_alert_at TIMESTAMP WITH TIME ZONE;`,

    // Phase 22.21.46: 契約ごとの Slack アラート設定。
    //   alert_slack_channels: 通知先チャンネル配列 (例: ["#legal", "C0123ABCD"]).
    //     '#name' 形式または Slack channel ID をそのまま入れる。空 / [] なら
    //     env LEGAL_BRIDGE_DEFAULT_ALERT_CHANNEL の値にフォールバック。
    //   alert_slack_mentions: 通知時のメンション配列 (例: ["@U0123", "<!subteam^S...>", "<!channel>"])
    //     ユーザー ID / グループ ID / 特殊メンション をそのまま入れる。空 / [] なら
    //     メンションなしで通知。
    //   いずれも自動更新アラート (renewal) や満了アラート (expiry) で参照する。
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS alert_slack_channels JSONB DEFAULT '[]'::jsonb;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS alert_slack_mentions JSONB DEFAULT '[]'::jsonb;`,

    // Phase 22.21.52: 契約に紐づく原作 (ledger) コード。ライセンス系の
    //   個別/単独契約に ledger を紐づけることで「この原作に対する N 件目の
    //   ILT」という形で番号を発番できるようにする。
    //   形式: LIC-{ledger_code}-ILT-{NNNN}  (例: LIC-LO-2026-0001-ILT-0001)
    //   ledgers.ledger_code への論理参照 (FK は意図的に張らず文字列で持つ。
    //   ledgers を物理削除しても契約データ側は残るほうが運用都合が良い)。
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS ledger_code VARCHAR(40);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_ledger_code
       ON contract_capabilities (ledger_code) WHERE ledger_code IS NOT NULL;`,
    // Phase 26: 原作 (ledger) / 素材 (material) への数値参照。
    //   従来は phase23_migrate.sql 手動移行でのみ追加されていたが、
    //   出版利用許諾条件書 (publication_condition) でも原作紐付けを使うため、
    //   冪等な ADD COLUMN を db.ts に明示し、新規/再構築 DB でも確実に存在させる。
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS ledger_ref_id INTEGER;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS material_ref_id INTEGER;`,

    // -----------------------------------------------------------------
    // Phase 22.21.91: 契約マスタ (contract_capabilities) の金銭条件 (1..N 行)
    //
    //   ライセンス系の 単独契約 / 個別契約 を契約マスタとして登録するとき、
    //   後段の「個別利用許諾条件書」「利用許諾計算書」と同じ粒度で
    //   金銭条件 (条件 1: 自社製造 / 2: サブライセンス / 3: プロダクトアウト) を
    //   保持できるようにする。フォーム側は license_financial_conditions と
    //   同じ shape で受け渡し、利用許諾計算書フォームから master_capability_id
    //   経由で defaults を引いてくる。
    //
    //   schema は license_financial_conditions と完全ミラー
    //   (license_contract_id → capability_id に置き換え)。
    //
    //   contract_capabilities を物理削除した場合は紐づく条件も削除 (CASCADE)。
    // -----------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS capability_financial_conditions (
      id SERIAL PRIMARY KEY,
      capability_id INTEGER NOT NULL REFERENCES contract_capabilities(id) ON DELETE CASCADE,
      condition_no INTEGER NOT NULL,            -- 1=自社製造, 2=サブライセンス, 3=プロダクトアウト
      region_language_label TEXT,               -- 例: 国内・日本語
      calc_method VARCHAR(50),                  -- ROYALTY / FIXED / SUBSCRIPTION
      rate_pct DECIMAL(7, 4),                   -- 例: 5.0000 (%)
      base_price_label TEXT,                    -- 例: 上代 (MSRP)
      calc_period VARCHAR(50),                  -- 表示ラベル (kind+close_month から自動生成可)
      calc_period_kind VARCHAR(20),             -- MANUFACTURING / MONTHLY / QUARTERLY / SEMIANNUAL / ANNUAL
      calc_period_close_month SMALLINT,         -- 1-12
      currency VARCHAR(10) DEFAULT 'JPY',
      formula_text TEXT,                        -- 例: 上代 × 5.0% × 製造数
      payment_terms TEXT,
      mg_amount DECIMAL(15, 2) DEFAULT 0,       -- MG (最低保証 floor) — Phase 22.21.95 で floor 化
      ag_amount DECIMAL(15, 2) DEFAULT 0,       -- AG (前払い保証 = 累積消化) — Phase 22.21.95 で追加
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(capability_id, condition_no)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_cfc_capability ON capability_financial_conditions(capability_id);`,
    // 旧 DB 用の追加 ALTER (新規 CREATE では既に DEF 済みだが念のため)
    `ALTER TABLE capability_financial_conditions
       ADD COLUMN IF NOT EXISTS ag_amount DECIMAL(15, 2) DEFAULT 0;`,

    // -----------------------------------------------------------------
    // Phase 22.21.112: 契約マスタの業務明細 (1..N 行)
    //   業務委託 (service) カテゴリの単独/個別契約に紐づけ、後段の
    //   検収書 (inspection_certificate) フォームから order_lines_for_inspection
    //   として読み込まれる defaults。
    //
    //   shape は order_line_items (発注書) と意味的にミラー:
    //     - line_no, category, item_name, spec, calc_method, payment_terms
    //     - quantity, unit_price, amount_ex_tax
    //     - delivery_date / payment_date (master では空が普通。PO 起票時に設定)
    //     - SUBSCRIPTION 用: cycle / billing_day / term_start / term_end
    //
    //   contract_capabilities を物理削除した場合は紐づく明細も削除 (CASCADE)。
    // -----------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS capability_line_items (
      id SERIAL PRIMARY KEY,
      capability_id INTEGER NOT NULL REFERENCES contract_capabilities(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      category VARCHAR(100),
      item_name TEXT,
      spec TEXT,
      calc_method VARCHAR(50),          -- FIXED / SUBSCRIPTION / ROYALTY 等
      payment_method VARCHAR(50),
      payment_terms TEXT,
      quantity DECIMAL(15, 4),
      unit_price DECIMAL(15, 2),
      amount_ex_tax DECIMAL(15, 2),
      delivery_date DATE,
      payment_date DATE,
      -- SUBSCRIPTION 系
      cycle VARCHAR(50),
      billing_day INTEGER,
      term_start DATE,
      term_end DATE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(capability_id, line_no)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_cli_capability ON capability_line_items(capability_id);`,

    // -----------------------------------------------------------------
    // Phase 23.0: 統一スキーマ — contract_capabilities を全契約・全発注の
    //   正テーブルにする。order_items / license_contracts は段階廃止予定。
    //
    //   record_type 値域:
    //     'master_contract'      : 基本契約 (NDA, license_master, service_master, sales_master)
    //     'individual_contract'  : 基本契約あり個別契約
    //     'standalone_contract'  : 基本契約なし単独契約
    //     'purchase_order'       : 発注書 (新設, contract_category='service' と組合せ)
    //
    //   contract_capabilities に発注書由来の列を追加:
    //     - tax_rate / amount_ex_tax / amount_inc_tax / tax_amount : 金額系
    //     - due_date                                               : 納期
    //     - issue_date                                             : 発注日
    //     - legal_request_id / backlog_issue_key                   : 課題紐付け
    // -----------------------------------------------------------------
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS tax_rate INTEGER DEFAULT 10;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS amount_ex_tax DECIMAL(15,2);`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS amount_inc_tax DECIMAL(15,2);`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(15,2);`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS due_date DATE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS issue_date_po DATE;`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS legal_request_id INTEGER REFERENCES legal_requests(id);`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS backlog_issue_key VARCHAR(50);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_backlog ON contract_capabilities(backlog_issue_key) WHERE backlog_issue_key IS NOT NULL;`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_record_type_cat ON contract_capabilities(record_type, contract_category);`,

    // -----------------------------------------------------------------
    // Phase 23.6.7: 既存データの record_type 修復。
    //   worker/server.ts 旧版が purchase_order / inspection を両方
    //   'individual_contract' として登録していたため、UnifiedContractPicker
    //   で発注書が「個別契約」表示になり、検収書フォームから選択しても
    //   明細が出ない事故 (例: ARC-PO-2026-0019) を起こしていた。
    //
    //   contract_type / document_number 接頭辞をヒントに正しい record_type へ
    //   バックフィル。冪等 (条件付き UPDATE)。
    //
    //   - contract_type='purchase_order' or document_number LIKE 'ARC-PO-%'
    //     かつ record_type='individual_contract' → 'purchase_order'
    //   - contract_type LIKE '%inspection%' or document_number LIKE 'ARC-IC-%'
    //     かつ record_type='individual_contract' → 'delivery_record'
    // -----------------------------------------------------------------
    `UPDATE documents
        SET record_type = 'purchase_order',
            contract_category = COALESCE(contract_category, 'service'),
            updated_at = CURRENT_TIMESTAMP
      WHERE record_type = 'individual_contract'
        AND (
          contract_type = 'purchase_order'
          OR contract_type = 'intl_purchase_order'
          OR document_number LIKE 'ARC-PO-%'
          OR document_number LIKE 'ARC-IPO-%'
        );`,
    `UPDATE documents
        SET record_type = 'delivery_record',
            contract_category = COALESCE(contract_category, 'service'),
            updated_at = CURRENT_TIMESTAMP
      WHERE record_type = 'individual_contract'
        AND (
          contract_type LIKE '%inspection%'
          OR document_number LIKE 'ARC-IC-%'
        );`,

    // capability_line_items にも検収集計・アラート列を追加 (旧 order_line_items 由来)
    `ALTER TABLE capability_line_items ADD COLUMN IF NOT EXISTS inspected_amount_ex_tax DECIMAL(15,2) DEFAULT 0;`,
    `ALTER TABLE capability_line_items ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMP WITH TIME ZONE;`,
    `ALTER TABLE capability_line_items ADD COLUMN IF NOT EXISTS alert_count INTEGER DEFAULT 0;`,

    // 新規: 経費 (税込) — 旧 order_expenses の移行先
    `CREATE TABLE IF NOT EXISTS capability_expenses (
      id SERIAL PRIMARY KEY,
      capability_id INTEGER NOT NULL REFERENCES contract_capabilities(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      expense_name TEXT NOT NULL,
      spec TEXT,
      spent_date DATE,
      amount_inc_tax DECIMAL(15,2),
      remarks TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(capability_id, line_no)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ce_capability ON capability_expenses(capability_id);`,

    // 新規: その他手数料 — 旧 order_other_fees の移行先
    `CREATE TABLE IF NOT EXISTS capability_other_fees (
      id SERIAL PRIMARY KEY,
      capability_id INTEGER NOT NULL REFERENCES contract_capabilities(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      fee_name TEXT NOT NULL,
      amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      remarks TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(capability_id, line_no)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_cof_capability ON capability_other_fees(capability_id);`,

    // delivery_events / delivery_line_items に capability 直参照キーを追加
    //   旧: order_item_id / order_line_item_id を持つ
    //   新: capability_id / capability_line_item_id を持つ (両者並存 → 移行スクリプトで張替)
    `ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS capability_id INTEGER REFERENCES contract_capabilities(id);`,
    `ALTER TABLE delivery_line_items ADD COLUMN IF NOT EXISTS capability_line_item_id INTEGER REFERENCES capability_line_items(id);`,
    `CREATE INDEX IF NOT EXISTS idx_de_capability ON delivery_events(capability_id);`,
    `CREATE INDEX IF NOT EXISTS idx_dli_capability_line ON delivery_line_items(capability_line_item_id);`,

    // royalty_calculations も capability 直参照に
    `ALTER TABLE royalty_calculations ADD COLUMN IF NOT EXISTS capability_id INTEGER REFERENCES contract_capabilities(id);`,
    `ALTER TABLE royalty_calculations ADD COLUMN IF NOT EXISTS capability_financial_condition_id INTEGER REFERENCES capability_financial_conditions(id);`,
    `CREATE INDEX IF NOT EXISTS idx_rc_capability ON royalty_calculations(capability_id);`,

    // -----------------------------------------------------------------
    // Phase 23.6.4: royalty_calculations.capability_id バックフィル
    //   既存の license_contract_id → contract_capabilities への張替を、
    //   documents.document_number (= license_contracts.contract_number /
    //   ledger_number / work_id) 経由で行う。
    //   旧 license_contracts テーブルがまだ存在する DB でのみ実行
    //   (to_regclass でガード)。新規 DB ではスキップされる。
    //   冪等: WHERE rc.capability_id IS NULL で再実行可。
    // -----------------------------------------------------------------
    `DO $rc_backfill$
     BEGIN
       IF to_regclass('public.license_contracts') IS NOT NULL THEN
         UPDATE royalty_calculations rc
            SET capability_id = cc.id
           FROM license_contracts lc
           JOIN contract_capabilities cc
             ON cc.document_number = COALESCE(lc.contract_number, lc.ledger_number, lc.work_id)
          WHERE rc.license_contract_id = lc.id
            AND rc.capability_id IS NULL
            AND cc.document_number IS NOT NULL;
       END IF;
     END
     $rc_backfill$;`,

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
    ON CONFLICT (issue_type_name) DO UPDATE SET document_prefix = EXCLUDED.document_prefix;`,

    // -----------------------------------------------------------------
    // Phase 22.21.70: sales_master_buyer の var リネーム backfill
    //   旧フィールド名 CURE_PERIOD_DAYS → 新フィールド名 BREACH_CURE_DAYS
    //   (週末コミット 46e46b3 で template + config がリネームされたが、既存の
    //    documents.form_data には旧キーが残ったままだった)
    //   テンプレ参照は BREACH_CURE_DAYS のみなので、旧キーは編集まで PDF に
    //   反映されない silently-lost 状態。
    //   このマイグレは form_data から旧キーを抜き、新キーが未設定なら値を移行する。
    //   どのケースでも CURE_PERIOD_DAYS は最終的に消えるので冪等
    //   (再度同じ SQL を流しても rowCount=0 になる)。
    // -----------------------------------------------------------------
    `UPDATE documents
        SET form_data = CASE
          WHEN form_data ? 'BREACH_CURE_DAYS'
            THEN form_data - 'CURE_PERIOD_DAYS'
          ELSE (form_data - 'CURE_PERIOD_DAYS')
               || jsonb_build_object('BREACH_CURE_DAYS', form_data->'CURE_PERIOD_DAYS')
        END
      WHERE template_type = 'sales_master_buyer'
        AND form_data ? 'CURE_PERIOD_DAYS';`,

    // -----------------------------------------------------------------
    // Phase 22.21.79: document_drafts — 文書作成中の form_data 一時保存。
    //   admin-ui DocumentEditorPage が「閲覧モード ⇄ 編集モード」を
    //   トグルしたタイミング、および「DBSYNC」ボタン押下で参照する。
    //   issue_key + template_type の組で UNIQUE (1 課題 × 1 テンプレ あたり
    //   最新 1 件のみ保持、UPSERT で上書き)。
    //   localStorage の draft と違って:
    //     - 別端末 / 別ブラウザでも編集を引き継げる
    //     - 退職者の引き継ぎや、IT メンバーが状況を見るのが容易
    //   完成 PDF 発行後の draft 自動削除は今回は実装しない (履歴として残す)。
    // -----------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS document_drafts (
        id SERIAL PRIMARY KEY,
        issue_key TEXT NOT NULL,
        template_type TEXT NOT NULL,
        form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by TEXT,
        UNIQUE (issue_key, template_type)
     );`,
    `CREATE INDEX IF NOT EXISTS idx_document_drafts_issue
       ON document_drafts(issue_key);`,

    // =================================================================
    // データ構造刷新 Phase B: 統一条件明細 (condition_lines) 新スキーマ。
    //   追加のみ・既存無影響 (expand)。状態・残高・MG/AG はテーブル列では
    //   なく condition_events からの導出ビュー (Phase D) で提供する設計。
    //   概念設計: docs/condition_lines_unification_design.md
    //   実装設計: docs/condition_lines_implementation_plan.md (Phase B)
    //
    //   注意: condition_lines は materials / works / contract_capabilities /
    //   documents を FK 参照するため、worker db.ts を「正」として定義する
    //   (api db.ts には materials 等が無く FK が張れないため、api は同一 DB を
    //    実行時参照する。documents 追加列と同じ運用)。
    //   CREATE 順序: works → condition_lines → work_component_lines →
    //   installments → condition_events (FK 依存順)。
    // =================================================================

    // --- B-1. 契約ヘッダの直交分解 (structural_role × scope × template_family)
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS structural_role VARCHAR(10);`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS parent_capability_id INTEGER REFERENCES contract_capabilities(id);`,
    `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS template_family VARCHAR(20);`,
    `CREATE INDEX IF NOT EXISTS idx_cc_parent ON contract_capabilities(parent_capability_id);`,
    `CREATE TABLE IF NOT EXISTS contract_scopes (
      id SERIAL PRIMARY KEY,
      capability_id INTEGER NOT NULL REFERENCES contract_capabilities(id) ON DELETE CASCADE,
      scope VARCHAR(20) NOT NULL CHECK (scope IN ('service','license_use')),
      UNIQUE (capability_id, scope)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_cs_capability ON contract_scopes(capability_id);`,

    // --- B-5 (前半). 作品層 — condition_lines.work_id が参照するため先に CREATE
    `CREATE TABLE IF NOT EXISTS works (
      id SERIAL PRIMARY KEY,
      work_code VARCHAR(40) UNIQUE NOT NULL,
      title TEXT NOT NULL,
      parent_work_id INTEGER REFERENCES works(id),
      ledger_code VARCHAR(40),
      remarks TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS work_components (
      id SERIAL PRIMARY KEY,
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      component_no INTEGER NOT NULL,
      component_kind VARCHAR(50),
      material_id INTEGER REFERENCES materials(id),
      notes TEXT,
      UNIQUE (work_id, component_no)
    );`,

    // --- B-2. 統一条件明細
    `CREATE TABLE IF NOT EXISTS condition_lines (
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
    );`,
    `CREATE INDEX IF NOT EXISTS idx_cl_capability ON condition_lines(capability_id);`,
    `CREATE INDEX IF NOT EXISTS idx_cl_work ON condition_lines(work_id);`,
    // Phase E-2(a): 表示用フィールド。旧明細テーブル(capability_line_items /
    //   capability_financial_conditions)の表示列を condition_lines に保持し、
    //   表示/フォーム供給リーダーが condition_lines だけで完結できるようにする
    //   (= 旧テーブル DROP の前提)。値は C-2/C-5 マッパー + 再backfill(E2a)で充填。
    `ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS spec TEXT;`,
    `ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS category VARCHAR(100);`,
    `ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS calc_method VARCHAR(50);`,
    `ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);`,
    `ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS payment_terms TEXT;`,
    `ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS payment_date DATE;`,
    `ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS fee_type VARCHAR(50);`,
    `ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS calc_period VARCHAR(50);`,
    `ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS formula_text TEXT;`,
    // Phase E-2(a): 元明細の連番 (line_item は元 line_no / financial は元 condition_no)。
    //   condition_lines.line_no は再採番されるため、表示系が元の番号を faithful に
    //   出せるよう保持する。財務条件リーダーの condition_no 等に使う。
    `ALTER TABLE condition_lines ADD COLUMN IF NOT EXISTS source_seq_no INTEGER;`,

    // --- B-5 (後半). 構成要素 ↔ イン側条件明細 N:M (condition_lines を参照)
    `CREATE TABLE IF NOT EXISTS work_component_lines (
      component_id INTEGER NOT NULL REFERENCES work_components(id) ON DELETE CASCADE,
      condition_line_id INTEGER NOT NULL REFERENCES condition_lines(id),
      PRIMARY KEY (component_id, condition_line_id)
    );`,

    // --- B-3. 分割予定 (installment scheme)
    `CREATE TABLE IF NOT EXISTS condition_line_installments (
      id SERIAL PRIMARY KEY,
      condition_line_id INTEGER NOT NULL REFERENCES condition_lines(id) ON DELETE CASCADE,
      installment_no INTEGER NOT NULL,
      trigger_kind VARCHAR(20) NOT NULL
        CHECK (trigger_kind IN ('on_signing','on_delivery','on_inspection','fixed_date')),
      planned_amount_ex_tax DECIMAL(15,2) NOT NULL,
      due_date DATE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (condition_line_id, installment_no)
    );`,

    // --- B-4. 統一実績台帳
    `CREATE TABLE IF NOT EXISTS condition_events (
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
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ce_line ON condition_events(condition_line_id);`,
    `CREATE INDEX IF NOT EXISTS idx_ce_document ON condition_events(document_id);`,
    `CREATE INDEX IF NOT EXISTS idx_ce_line_period ON condition_events(condition_line_id, period);`,
    // 既存 detail テーブルに実績 FK を追加 (detail は残す)
    `ALTER TABLE delivery_line_items ADD COLUMN IF NOT EXISTS condition_event_id INTEGER REFERENCES condition_events(id);`,
    `ALTER TABLE delivery_line_items ADD COLUMN IF NOT EXISTS condition_line_id INTEGER REFERENCES condition_lines(id);`,
    `ALTER TABLE royalty_calculations ADD COLUMN IF NOT EXISTS condition_event_id INTEGER REFERENCES condition_events(id);`,
    `ALTER TABLE royalty_calculations ADD COLUMN IF NOT EXISTS condition_line_id INTEGER REFERENCES condition_lines(id);`,

    // -----------------------------------------------------------------
    // データ構造刷新 Phase D-1: 状態・残高・スケジュールの導出ビュー。
    //   状態/残高はテーブル列で持たず、有効実績(condition_events)の集計から
    //   SQL ビューで導出する (真実の源 = 実績台帳)。CREATE OR REPLACE で冪等。
    //   実装設計: docs/condition_lines_implementation_plan.md (Phase D)
    //   注意: cron/calc の読み取り切替 (D-2〜D-4) は段階実装 (本ビュー追加が前提)。
    // -----------------------------------------------------------------
    `CREATE OR REPLACE VIEW condition_line_status_v AS
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
     ) e ON e.condition_line_id = cl.id;`,

    // MG/AG 残高ビュー。移行期は detail (royalty_calculations.mg/ag_consumed_this_time)
    //   の SUM を採用 (有効 royalty_calc イベントに紐づく detail のみ)。
    `CREATE OR REPLACE VIEW condition_line_balance_v AS
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
      WHERE cl.payment_scheme = 'royalty';`,

    // スケジュールビュー: 期待される期 (expected_period) を生成し、有効イベントの
    //   period と突き合わせて当期未発行/期限超過を導出。対象は subscription と
    //   定期報告型 royalty (calc_period_kind が MONTHLY/QUARTERLY/SEMIANNUAL/ANNUAL)。
    //   製造イベント駆動 (MANUFACTURING) は対象外。
    `CREATE OR REPLACE VIEW condition_line_schedule_v AS
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
      WHERE s.step IS NOT NULL;`,
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

/**
 * Phase 17k: ARC umbrella + 文書種別 prefix + 年 + 連番 の 4 セグメント形式。
 *
 *   ARC-<TYPE>-<YEAR>-<NNNN>
 *   例:  ARC-PO-2026-0001   (発注書)
 *        ARC-NDA-2026-0001  (NDA)
 *        ARC-LIC-2026-0001  (ライセンス基本契約)
 *
 * 連番は (prefix, year) を sequence kind として、文書種別ごとに独立。
 * 文書種別 prefix は以下の優先順で決定:
 *   1. workflow_settings.document_prefix (issueTypeName で検索)
 *   2. typeCodes mapping (テンプレ type 名 / issueTypeName のどちらでもヒット)
 *   3. type.toUpperCase().substring(0, 3) フォールバック
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
    // テンプレ type 名 / Backlog issueType.name どちらでもヒットするよう
    // 両方向のキーを登録する。
    // Phase 22.21.82: 削除済みテンプレ (planning_purchase_order /
    //   inspection_certificate_v2 / inspection_certificate_detailed /
    //   license_report / intl_master / intl_amendment / payment_notice /
    //   payment_notice_alt / fee_statement / service_terms / contract)
    //   を typeCodes から除去。
    // Phase 22.21.83: legal_response (LGR) と maintenance_spec (MNT) を追加。
    const typeCodes: Record<string, string> = {
      // 発注系
      purchase_order: "PO",
      intl_purchase_order: "IPO",
      "発注書": "PO",
      // 検収系
      inspection_certificate: "INS",
      delivery_inspec: "INS",
      "検収書": "INS",
      // ライセンス系
      license_master: "LIC",
      lic_individual: "ILT",
      individual_license_terms: "ILT",
      license_calculation_sheet: "LCS",
      "ライセンス基本契約": "LIC",
      "個別利用許諾条件": "ILT",
      // ロイヤリティ / 支払
      royalty_statement: "ROY",
      manufacturing: "MFG",
      "利用許諾料計算書": "ROY",
      // 業務委託
      service_master: "SVC",
      outsourcing: "OUT",
      "業務委託基本契約": "SVC",
      // 出版 (Phase 25 / 25.6): 基本契約=PUB / 利用許諾条件書=PUBT / 追加利用許諾条件書=PUBA
      //   search-api の typeCodes と同一仕様。publication_contract は legalon import 用。
      pub_master_individual: "PUB",
      pub_master_corporate: "PUB",
      publication_contract: "PUB",
      "出版等許諾基本契約": "PUB",
      "出版基本契約": "PUB",
      pub_license_terms: "PUBT",
      "出版等利用許諾条件書": "PUBT",
      pub_additional_terms: "PUBA",
      "追加利用許諾条件書": "PUBA",
      // 売買
      sales_master: "SAL",
      sales_master_buyer: "SAL",
      sales_master_credit: "SAL",
      sales_master_standard: "SAL",
      "売買基本契約": "SAL",
      // 別紙 (保守仕様書)
      maintenance_spec: "MNT",
      "システム保守仕様書": "MNT",
      // 法務回答 (Phase 22.21.83 → 22.21.84: ユーザー提供デザインに合わせ
      //   prefix を LGR から LG に短縮。"No. LG-2026-NNNN" 形式で表示。)
      legal_response: "LG",
      "法務回答書": "LG",
      legal_consult: "LG",
      "法務相談": "LG",
      "事務手続": "LG",
      // 通知・同意 (個人情報取得 通知・同意書) → ARC-PR-YYYY-NNNN
      notice_consent_personal_info_freelance: "PR",
      "個人情報取得 通知・同意書": "PR",
      // その他
      nda: "NDA",
      "NDA": "NDA",
      external_contract: "ARC",
    };
    prefix =
      typeCodes[type] ||
      (issueTypeName ? typeCodes[issueTypeName] : "") ||
      type.toUpperCase().substring(0, 3);
  }

  const year = new Date().getFullYear();

  // Phase 17k: 文書種別ごとに独立した連番。sequence kind = prefix なので
  //   PO は PO の連番、NDA は NDA の連番 ... と完全分離。年が変わると
  //   各 prefix のカウンタが個別にリセットされる。
  const val = await getNextSequenceValue(prefix, year);

  return `ARC-${prefix}-${year}-${val.toString().padStart(4, "0")}`;
}

/**
 * Phase 22.12: 「真の契約」マーク管理。
 *
 * 指定 base に属する全ドキュメント (documents + contract_capabilities) を対象に、
 * targetDocNumber のみ is_primary=TRUE、それ以外は is_primary=FALSE + superseded_by=target
 * に書き換える。
 *
 * 用途:
 *   - 新リビジョン生成時: 自動的に最新を真の契約に格上げ
 *   - ユーザーが Archive UI から手動で旧版を真の契約に戻す (override)
 */
/**
 * Phase 22.18 / 採番統一(§9.3): 原作 (ledgers) の ledger_code 自動採番。
 *
 * 形式: LO-{YYYY}-{NNNN} (例: LO-2026-0001)
 *
 * 採番ロジック: **ledgers ∪ works の当年 LO 最大 +1** から導出する。
 *   旧実装は document_sequences(kind="LO") の独立カウンタだったが、api 側
 *   (POST /api/v3/source-ips) は ledgers∪works の max+1 で LO を振るため、
 *   両系統が同一 LO 番号を二重採番しうる問題があった(移行0075も max+1)。
 *   両者を同一の実コード由来ロジックに揃え、系統間衝突を構造的に解消する。
 *   (残: 同時 INSERT の競合は ledger_code/work_code の UNIQUE 制約で検出。)
 */
export async function getNewLedgerCode(year?: number): Promise<string> {
  const y = year || new Date().getFullYear();
  const res = await query(
    `SELECT COALESCE(MAX(
              CASE WHEN code ~ ('^LO-' || $1 || '-[0-9]+$')
                   THEN split_part(code, '-', 3)::int ELSE 0 END), 0) + 1 AS n
       FROM (SELECT ledger_code AS code FROM ledgers
             UNION ALL SELECT work_code AS code FROM works) c`,
    [String(y)]
  );
  const n: number = res.rows[0]?.n ?? 1;
  return `LO-${y}-${n.toString().padStart(4, "0")}`;
}

/**
 * Phase 22.18: WorkID (license_contracts.work_id) の自動採番。
 *
 * 形式: LIC-{ledger_code}-W-{YYYY}-{NNNN}
 *   例: LIC-LO-2026-0001-W-2026-0001
 *
 * 連番カウンタは **原作 (ledger_code) 単位で独立**。
 * document_sequences に kind=`W_${ledger_code}` / year=YYYY で連番。
 *
 * これにより:
 *   - LO-2026-0001 配下: LIC-LO-2026-0001-W-2026-0001, 0002, ...
 *   - LO-2026-0002 配下: LIC-LO-2026-0002-W-2026-0001, 0002, ...
 * となり「シリーズ何作目?」が即わかる識別子になる。
 */
export async function getNewWorkId(
  ledgerCode: string,
  year?: number
): Promise<string> {
  if (!ledgerCode) throw new Error("ledgerCode is required");
  const y = year || new Date().getFullYear();
  const kind = `W_${ledgerCode}`;
  const val = await getNextSequenceValue(kind, y);
  return `LIC-${ledgerCode}-W-${y}-${val.toString().padStart(4, "0")}`;
}

/**
 * データ構造刷新 Phase B-6: 条件明細の公開採番 line_code。
 *
 * 形式 (仮決め / ⚠ Q1): CL-{YYYY}-{NNNNN}
 *   契約再発行・契約改版で番号が変わらないことが要件のため、契約番号従属では
 *   なく **独立採番**。document_sequences に kind='condition_line' / year=YYYY。
 */
export async function issueConditionLineCode(year?: number): Promise<string> {
  const y = year || new Date().getFullYear();
  const val = await getNextSequenceValue("condition_line", y);
  return `CL-${y}-${val.toString().padStart(5, "0")}`;
}

/**
 * データ構造刷新 Phase B-6: 作品マスター works.work_code の採番。
 *
 * 形式 (仮決め / ⚠ Q2): WK-{YYYY}-{NNNN}
 *   document_sequences に kind='work' / year=YYYY で独立採番。
 *   (既存の getNewWorkId = license_contracts.work_id とは別概念)
 */
export async function issueWorkCode(year?: number): Promise<string> {
  const y = year || new Date().getFullYear();
  const val = await getNextSequenceValue("work", y);
  return `WK-${y}-${val.toString().padStart(4, "0")}`;
}

/**
 * Phase 22.21.52: ILT (個別利用許諾条件書 + 単独契約) の原作ベース採番。
 *
 * 形式: LIC-{ledger_code}-ILT-{NNNN}
 *   例: LIC-LO-2026-0001-ILT-0001
 *
 * 連番は **原作 (ledger_code) 単位で通算**。年単位ではリセットしない
 * (作品ライフタイムを通じた連番。getNewWorkId と違う設計判断)。
 *
 * 用途:
 *   - contract_capabilities で record_type='individual_contract' /
 *     'standalone_contract' / 'license_condition' かつ
 *     contract_category='license' かつ ledger_code 紐付け済み のレコード。
 *
 * document_sequences の (kind, year) PK 制約があるため、年でリセットしない
 * 場合は year=0 を sentinel として使う。
 */
export async function getNewIltNumberForLedger(
  ledgerCode: string
): Promise<string> {
  if (!ledgerCode) throw new Error("ledgerCode is required for ILT numbering");
  const kind = `ILT_${ledgerCode}`;
  const val = await getNextSequenceValue(kind, 0);
  return `LIC-${ledgerCode}-ILT-${val.toString().padStart(4, "0")}`;
}

/**
 * Phase 22.18: 素材 (materials) の枝番自動採番。
 *
 * 指定 ledger_id 配下の MAX(material_no) + 1 を返す。
 * 原作マスター登録時に最初に -001 (原作本体) を立てるので、
 * 派生素材は -002, -003, ... と進む。
 */
// Category 昇格(2): (work_id, genre) のカテゴリを get-or-create し id を返す。
//   素材→カテゴリは genre から自動導出。genre 空なら null。
const GENRE_SORT: Record<string, number> = {
  game_design: 0, manuscript: 1, illustration: 2, graphic_design: 3, scenario: 4,
  music: 5, translation: 6, editing: 7, text: 8, data: 9, other: 99,
};
export async function ensureMaterialCategory(
  workId: number, genre: string | null | undefined
): Promise<number | null> {
  const g = String(genre ?? "").trim();
  if (!workId || !g) return null;
  const r = await query(
    `INSERT INTO material_categories (work_id, genre, sort_order)
       VALUES ($1, $2, $3)
     ON CONFLICT (work_id, genre) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [workId, g, GENRE_SORT[g.toLowerCase()] ?? 99]
  );
  return r.rows[0]?.id ? Number(r.rows[0].id) : null;
}

export async function getNextMaterialNo(ledgerId: number): Promise<number> {
  // マテリアル一本化(0089/0090): 正準表 work_materials の枝番を採番。
  //   台帳(ledgers.id) → works(licensed_in, work_code=ledger_code) → work_materials で解決。
  const res = await query(
    `SELECT COALESCE(MAX(wm.material_no), 0) + 1 AS next
       FROM work_materials wm
       JOIN works   w ON w.id = wm.work_id AND w.kind = 'licensed_in'
       JOIN ledgers l ON l.ledger_code = w.work_code
      WHERE l.id = $1`,
    [ledgerId]
  );
  return Number(res.rows[0].next) || 1;
}

/**
 * Phase 22.18: 原作マスター登録 + 自動で原作本体素材 (-001) を作成する一括ヘルパー。
 *
 * @param payload 原作の属性 (title 必須, kana / publisher など任意)
 * @returns 作成された ledger 行 (id, ledger_code, ...) + デフォルト素材
 */
export async function createLedgerWithDefaultMaterial(payload: {
  title: string;
  title_kana?: string;
  alternative_titles?: string[];
  creator_name?: string;
  publisher_name?: string;
  remarks?: string;
  ledger_code?: string; // 手動指定時 (legacy 移行等)
  // Phase 22.20: 原作デフォルト値
  default_rights_holder?: string;
  default_credit_display?: string;
  default_work_supplement?: string;
  // Phase 22.21.7: 承認条件 / 承認時期 デフォルト
  default_approval_target?: string;
  default_approval_timing?: string;
  // Phase 26: 事業部タグ (BDG / PUB)。未指定なら ['BDG'] で初期化 (従来運用に合わせる)。
  division?: string[];
}): Promise<{
  id: number;
  ledger_code: string;
  default_material_id: number;
  default_material_code: string;
}> {
  const ledgerCode = payload.ledger_code || (await getNewLedgerCode());
  const division =
    Array.isArray(payload.division) && payload.division.length > 0
      ? payload.division
      : ["BDG"];
  const ledgerRes = await query(
    `INSERT INTO ledgers (
       ledger_code, title, title_kana, alternative_titles,
       creator_name, publisher_name, remarks,
       default_rights_holder, default_credit_display, default_work_supplement,
       default_approval_target, default_approval_timing, division
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, ledger_code`,
    [
      ledgerCode,
      payload.title,
      payload.title_kana || null,
      payload.alternative_titles || [],
      payload.creator_name || null,
      payload.publisher_name || null,
      payload.remarks || null,
      payload.default_rights_holder || null,
      payload.default_credit_display || null,
      payload.default_work_supplement || null,
      payload.default_approval_target || null,
      payload.default_approval_timing || null,
      division,
    ]
  );
  const ledgerId = Number(ledgerRes.rows[0].id);

  // マテリアル一本化(0089/0090): 原作の正本 works(licensed_in) を作成/更新し、
  //   原作本体素材(-001)は正準表 work_materials に立てる(materials 表は廃止)。
  //   work_code = ledger_code で ledgers と紐付く。works/素材作成は必須経路(best-effort では無い)。
  const wk = await query(
    `INSERT INTO works (work_code, title, title_kana, alternative_titles, kind, is_original,
        original_publisher, default_rights_holder, default_credit_display, default_work_supplement,
        default_approval_target, default_approval_timing, remarks, division, is_active)
     VALUES ($1,$2,$3,$4,'licensed_in',FALSE,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)
     ON CONFLICT (work_code) DO UPDATE SET
        title=EXCLUDED.title, title_kana=EXCLUDED.title_kana,
        default_rights_holder=EXCLUDED.default_rights_holder,
        default_credit_display=EXCLUDED.default_credit_display,
        default_work_supplement=EXCLUDED.default_work_supplement,
        default_approval_target=EXCLUDED.default_approval_target,
        default_approval_timing=EXCLUDED.default_approval_timing,
        updated_at=now()
     RETURNING id`,
    [
      ledgerCode, payload.title, payload.title_kana || null, payload.alternative_titles || [],
      payload.publisher_name || null, payload.default_rights_holder || null,
      payload.default_credit_display || null, payload.default_work_supplement || null,
      payload.default_approval_target || null, payload.default_approval_timing || null,
      payload.remarks || null, division,
    ]
  );
  const workId = Number(wk.rows[0].id);

  // 原作本体素材 (-001) = メイン作品(core_logic)。material_code で冪等。
  // O5: ジャンルは事業部(division)で確定(PUB→執筆文書 / それ以外→ゲームデザイン)。
  // Phase 22.20: 素材権利者を ledger.default_rights_holder で初期化
  const defaultMaterialCode = `${ledgerCode}-001`;
  const coreGenre = coreGenreForDivision(division);
  // Category(2): 本体ジャンルのカテゴリを get-or-create し -001 に紐付け。
  const coreCategoryId = await ensureMaterialCategory(workId, coreGenre);
  const matRes = await query(
    `INSERT INTO work_materials (
       work_id, material_no, material_code, material_name,
       material_type, rights_holder_label, is_default, material_role, acquisition_type, category_id
     ) VALUES ($1, 1, $2, $3, $5, $4, TRUE, 'core_logic', 'license', $6)
     ON CONFLICT (material_code) WHERE material_code IS NOT NULL DO UPDATE SET
       material_name = EXCLUDED.material_name, category_id = EXCLUDED.category_id, updated_at = now()
     RETURNING id, material_code`,
    [
      workId,
      defaultMaterialCode,
      payload.title,
      payload.default_rights_holder || null,
      coreGenre,
      coreCategoryId,
    ]
  );

  return {
    id: ledgerId,
    ledger_code: ledgerCode,
    default_material_id: Number(matRes.rows[0].id),
    default_material_code: matRes.rows[0].material_code,
  };
}

/**
 * Phase 22.18: 原作配下に派生素材を追加する一括ヘルパー。
 *
 * @returns 作成された material 行
 */
export async function addMaterialToLedger(payload: {
  ledger_id: number;
  material_name: string;
  material_type?: string;
  rights_holder?: string;
  remarks?: string;
  territory?: string;
  language?: string;
}): Promise<{ id: number; material_code: string; material_no: number }> {
  // マテリアル一本化(0089/0090): 台帳(ledgers.id) → 正本 works(licensed_in) を解決し、
  //   派生素材は正準表 work_materials に直接追加する(materials 表は廃止)。
  const ledgerRes = await query(
    `SELECT l.ledger_code, w.id AS work_id
       FROM ledgers l
       JOIN works w ON w.work_code = l.ledger_code AND w.kind = 'licensed_in'
      WHERE l.id = $1`,
    [payload.ledger_id]
  );
  if (ledgerRes.rows.length === 0) {
    throw new Error(`ledger ${payload.ledger_id} (works licensed_in) not found`);
  }
  const ledgerCode = ledgerRes.rows[0].ledger_code;
  const workId = Number(ledgerRes.rows[0].work_id);
  const nextNo = await getNextMaterialNo(payload.ledger_id);
  const materialCode = `${ledgerCode}-${nextNo.toString().padStart(3, "0")}`;
  // O5: ジャンルを正準化し、役割(本体/サブ)を推定。
  const matType = normalizeGenre(payload.material_type);
  const role = normalizeRole(undefined, matType, false);
  // Category(2): genre のカテゴリを get-or-create し紐付け。
  const categoryId = await ensureMaterialCategory(workId, matType);
  // acquisition_type は JS 側で算出して別パラメータにする。以前は
  //   CASE WHEN $5 = 'original' … で $5(material_type)を列値と比較の2文脈で使い回し、
  //   PostgreSQL が $5 の型を別々に推論して "inconsistent types deduced for parameter $5"
  //   で 500 になっていた。二重使用を解消する。
  const acquisitionType = matType === "original" ? "license" : null;
  const res = await query(
    `INSERT INTO work_materials (
       work_id, material_no, material_code, material_name,
       material_type, rights_holder_label, remarks, is_default, material_role,
       acquisition_type, category_id, territory, language
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8, $9, $10, $11, $12)
     RETURNING id, material_code, material_no`,
    [
      workId,
      nextNo,
      materialCode,
      payload.material_name,
      matType,
      payload.rights_holder || null,
      payload.remarks || null,
      role,
      acquisitionType,
      categoryId,
      payload.territory || null,
      payload.language || null,
    ]
  );
  return {
    id: Number(res.rows[0].id),
    material_code: res.rows[0].material_code,
    material_no: Number(res.rows[0].material_no),
  };
}

/**
 * Phase 22.17: 台帳ID (license_contracts.ledger_id) の自動採番。
 *
 * 形式: LIC-{YYYY}-{NNNN}  (例: LIC-2026-0001)
 *
 * document_number (ARC-LIC-2026-NNNN) とは独立した連番。
 * 同じ Backlog 課題で複数 PO 発行しても document_number は別々に増えるが、
 * 台帳ID は 1 ライセンス契約 (license_contracts 行) に対して 1 つ固定。
 * document_sequences テーブルに kind='LEDGER' / year=YYYY で連番を持つ。
 */
export async function getNewLedgerId(year?: number): Promise<string> {
  const y = year || new Date().getFullYear();
  const val = await getNextSequenceValue("LEDGER", y);
  return `LIC-${y}-${val.toString().padStart(4, "0")}`;
}

export async function markPrimaryDocument(
  baseDocumentNumber: string,
  targetDocNumber: string
): Promise<void> {
  if (!baseDocumentNumber || !targetDocNumber) return;
  // documents 側を一括更新
  await query(
    `UPDATE documents
        SET is_primary    = (document_number = $2),
            superseded_by = CASE WHEN document_number = $2 THEN NULL ELSE $2 END
      WHERE base_document_number = $1`,
    [baseDocumentNumber, targetDocNumber]
  );
  // contract_capabilities 側も同期 (検索一覧フィルタ用)。
  // 旧データで base_document_number が未設定の row もカバーするため
  // documents JOIN もチェックする。
  await query(
    `UPDATE documents
        SET is_primary    = (document_number = $2),
            superseded_by = CASE WHEN document_number = $2 THEN NULL ELSE $2 END,
            updated_at    = CURRENT_TIMESTAMP
      WHERE base_document_number = $1
         OR document_number IN (
              SELECT document_number FROM documents WHERE base_document_number = $1
            )`,
    [baseDocumentNumber, targetDocNumber]
  );
}

/**
 * Phase 22.10 (改 Phase 22.11.1 / 改 Phase 23.1): 文書番号採番 + リビジョン管理。
 *
 * 採番ルール:
 *   ① existingDocumentNumber が渡されなかった場合 = 完全新規
 *        → 毎回新しい番号を採番 (PO-0001, PO-0002, ...)
 *          同じ Backlog 課題で複数 PO を発行する正常ケースをサポート
 *   ② existingDocumentNumber 渡し + その既存ドキュメントが
 *      drive_link 空 = 未完成 draft → そのまま同番号で完成
 *        (旧 Phase 15: PDF 未作成キュー由来の draft 完成)
 *   ③ existingDocumentNumber 渡し + drive_link 入り + reissue=false (default)
 *      = 完成済を内部修正 (上書き)
 *        → 同じ document_number / revision / base のまま (overwrite=true で返す)
 *          (Phase 23.1: 既定動作。caller 側で UPDATE で同 row を上書きし、
 *           Drive PDF も同 fileId で content 差し替え)
 *   ④ existingDocumentNumber 渡し + drive_link 入り + reissue=true
 *      = 完成済を外部要請で再発行
 *        → base を共有しつつ revision を +1 して "_NNN" サフィックス付与
 *          (Phase 23.1: 明示的 reissue=true でのみ発動。caller 側で過去 row を
 *           lifecycle_status='reissued' に倒し、新 row を挿入する)
 *
 * 旧 Phase 22.10 にあった「同 issue_key + 同 template_type の既存 doc を見て
 * 自動的に再発行扱い」ロジックは撤廃済。同一取引先・同一 issueKey で
 * 別 PO を発行する正常ユースケースを破壊しないため、リビジョンは
 * 「ユーザーが reopen して "再発行" を明示選択した」場合のみ発火する。
 *
 * 返り値:
 *   documentNumber:      実際に発行/更新する番号
 *   baseDocumentNumber:  初版番号 (リビジョンを跨ぐ共通キー)
 *   revision:            0=初版 / 1,2,... = 再発行版
 *   isReissue:           true なら再発行 (Rev. ≥ 1、新規 row 挿入が必要)
 *   overwrite:           true なら既存 row を UPDATE で上書き (Phase 23.1 新設)
 *                        — INSERT ではなく UPDATE で同 row を更新し、Drive PDF も
 *                        既存 fileId に content を差し替える経路を caller に伝える
 */
/**
 * 「同一文書とみなせる既存の正本(is_primary かつ lifecycle=final)」を 1 件返す。
 * 判定: 同 template_type かつ ( 同 issue_key(MANUAL- と空は除外) OR content_hash 一致 )。
 * content_hash 列が無い環境(0017 未適用)では起票×種別のみで判定(graceful)。
 */
async function findExistingPrimaryDocument(
  issueKey: string,
  templateType: string,
  contentHash?: string
): Promise<{ document_number: string; base_document_number: string; revision: number } | null> {
  const ik = (issueKey || '').trim();
  const issueUsable = ik !== '' && !ik.startsWith('MANUAL-');
  // 起票でもハッシュでも引けない場合は判定しない。
  if (!issueUsable && !contentHash) return null;

  const withHash = `
    SELECT document_number, base_document_number, revision
      FROM documents
     WHERE is_primary = TRUE
       AND COALESCE(lifecycle_status, 'final') = 'final'
       AND template_type = $2::text
       AND (
         ($1::text <> '' AND issue_key = $1::text)
         OR ($3::text IS NOT NULL AND content_hash = $3::text)
       )
     ORDER BY revision DESC, created_at DESC
     LIMIT 1`;
  const noHash = `
    SELECT document_number, base_document_number, revision
      FROM documents
     WHERE is_primary = TRUE
       AND COALESCE(lifecycle_status, 'final') = 'final'
       AND template_type = $2::text
       AND $1::text <> '' AND issue_key = $1::text
     ORDER BY revision DESC, created_at DESC
     LIMIT 1`;

  try {
    const r = await query(withHash, [issueUsable ? ik : '', templateType, contentHash || null]);
    return r.rows[0] || null;
  } catch (err: any) {
    if (err && err.code === '42703') {
      // content_hash 未追加 → 起票×種別のみ
      if (!issueUsable) return null;
      const r = await query(noHash, [ik, templateType]);
      return r.rows[0] || null;
    }
    throw err;
  }
}

export async function getDocumentNumberForGenerate(opts: {
  issueKey: string;
  templateType: string;
  issueTypeName?: string;
  existingDocumentNumber?: string;
  /** Phase 23.1: 外部要請の再発行フラグ。true なら revision+1 で別 row 採番。 */
  reissue?: boolean;
  /** 重複検出用の内容ハッシュ(computeFormContentHash)。Case① の再利用判定に使う。 */
  contentHash?: string;
}): Promise<{
  documentNumber: string;
  baseDocumentNumber: string;
  revision: number;
  isReissue: boolean;
  overwrite: boolean;
}> {
  const { issueKey, templateType, issueTypeName, existingDocumentNumber, reissue, contentHash } = opts;

  // === Case ①: 完全新規 (existingDocumentNumber なし) ===
  if (!existingDocumentNumber || !existingDocumentNumber.trim()) {
    // 重複防止: 再発行(reissue)でない通常保存では、新規採番の前に
    //   「同一文書とみなせる既存の正本(final)」を探し、あればその番号を
    //   上書き(overwrite)対象として返す。これにより
    //   ・同じ起票(issue_key)× 同じ種別(template_type)
    //   ・もしくは内容ハッシュ(content_hash)が同一
    //   の保存し直しが、毎回あたらしい番号で重複登録されるのを防ぐ。
    //   (MANUAL- 起票は毎回ユニークなので issue 一致は使わず content_hash で判定)
    if (reissue !== true) {
      const dup = await findExistingPrimaryDocument(issueKey, templateType, contentHash);
      if (dup) {
        return {
          documentNumber: dup.document_number,
          baseDocumentNumber: dup.base_document_number || dup.document_number,
          revision: Number(dup.revision) || 0,
          isReissue: false,
          overwrite: true,
        };
      }
    }
    const newNumber = await getNewDocumentNumber(templateType, issueTypeName);
    return {
      documentNumber: newNumber,
      baseDocumentNumber: newNumber,
      revision: 0,
      isReissue: false,
      overwrite: false,
    };
  }

  const docNum = existingDocumentNumber.trim();

  // existingDocumentNumber に対応する既存行を探す。
  // 渡された番号が base そのものでも、_001 等のリビジョン版でも、
  // 同じ base に属する最新リビジョンを取得する。
  const existingRow = await query(
    `SELECT base_document_number, revision, drive_link, document_number, template_type
       FROM documents
      WHERE document_number = $1
         OR base_document_number = $1
         OR base_document_number = (
              SELECT COALESCE(base_document_number, document_number)
                FROM documents WHERE document_number = $1 LIMIT 1
            )
      ORDER BY revision DESC
      LIMIT 1`,
    [docNum]
  );

  // 想定外: 既存履歴ゼロ → 渡された番号で初版扱い (互換性のため)
  if (existingRow.rows.length === 0) {
    return {
      documentNumber: docNum,
      baseDocumentNumber: docNum,
      revision: 0,
      isReissue: false,
      overwrite: false,
    };
  }

  const existing = existingRow.rows[0];

  // === 安全ガード: existingDocumentNumber の行と「生成種別」が異なる場合 ===
  //   その番号は流用しない(別種別の文書を誤って上書き=データ消失するのを防ぐ)。
  //   フロントが前の文書番号(__draft_doc_number 等)を持ち越しても、ここで握りつぶす。
  //   → 同種別の正本があればそれを上書き対象に、無ければ新規採番する。
  if (existing.template_type && templateType && existing.template_type !== templateType) {
    if (reissue !== true) {
      const dup = await findExistingPrimaryDocument(issueKey, templateType, contentHash);
      if (dup) {
        return {
          documentNumber: dup.document_number,
          baseDocumentNumber: dup.base_document_number || dup.document_number,
          revision: Number(dup.revision) || 0,
          isReissue: false,
          overwrite: true,
        };
      }
    }
    const newNumber = await getNewDocumentNumber(templateType, issueTypeName);
    return {
      documentNumber: newNumber,
      baseDocumentNumber: newNumber,
      revision: 0,
      isReissue: false,
      overwrite: false,
    };
  }

  const base = existing.base_document_number || existing.document_number || docNum;
  const existingDocNumber = existing.document_number || docNum;
  const isUnfinishedDraft =
    !existing.drive_link || String(existing.drive_link).trim() === "";

  // === Case ②: 未完成 draft の完成 (drive_link 空) ===
  // 旧 Phase 15: PDF 未作成キュー由来。同番号で UPDATE 完了 (リビジョンは
  // 上げない)。overwrite=true で同 row UPDATE 経路へ。
  if (isUnfinishedDraft) {
    return {
      documentNumber: existingDocNumber,
      baseDocumentNumber: base,
      revision: Number(existing.revision) || 0,
      isReissue: false,
      overwrite: true,
    };
  }

  // === Case ④: 完成済 + 再発行 (reissue=true) → revision+1 で新行 ===
  // 「再発行 (修正版)」ボタン経由でのみ発動。base を共有しつつ revision を
  // +1 して "_NNN" サフィックス付与。caller は過去 row を
  // lifecycle_status='reissued' に倒し、新 row を挿入する。
  if (reissue === true) {
    const nextRev = (Number(existing.revision) || 0) + 1;
    const suffix = nextRev.toString().padStart(3, "0");
    return {
      documentNumber: `${base}_${suffix}`,
      baseDocumentNumber: base,
      revision: nextRev,
      isReissue: true,
      overwrite: false,
    };
  }

  // === Case ③: 完成済 + reissue=false (default) → 同 row 上書き (内部修正) ===
  // Phase 23.1: 再編集 → 生成は既定で「内部修正」扱い。document_number /
  // revision を維持して同 row を UPDATE で上書き。Drive PDF も既存 fileId に
  // content 差し替えで参照リンク不変。
  return {
    documentNumber: existingDocNumber,
    baseDocumentNumber: base,
    revision: Number(existing.revision) || 0,
    isReissue: false,
    overwrite: true,
  };
}

/**
 * Phase 22.10: ファイル名に取引先名を含める用のサニタイザ。
 *   日本語 OK だがファイルシステム / URL で問題になる文字 (/ \ ? * : | " < > 改行等) を
 *   "_" に置換する。空白も "_" に。長すぎる名前は 40 文字で truncate。
 */
export function sanitizeForFilename(s: string): string {
  if (!s) return "";
  return s
    .replace(/[\\/:*?"<>|\r\n\t]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
