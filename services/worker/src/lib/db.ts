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
    `UPDATE contract_capabilities cc
        SET base_document_number = d.base_document_number,
            revision             = d.revision,
            is_primary           = d.is_primary,
            superseded_by        = d.superseded_by
       FROM documents d
      WHERE cc.document_number = d.document_number
        AND (cc.base_document_number IS NULL OR cc.is_primary IS NULL);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_is_primary ON contract_capabilities(is_primary);`,
    `CREATE INDEX IF NOT EXISTS idx_capabilities_base ON contract_capabilities(base_document_number);`,

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

    // Phase 20: 納期アラート用カラム
    //   last_alert_at は最終アラート送信日時 (= 同日重複送信防止)
    //   alert_count は累計送信回数 (運用観察用)
    `ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMP WITH TIME ZONE;`,
    `ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS alert_count INTEGER DEFAULT 0;`,

    // -----------------------------------------------------------------
    // Phase 17h: 納期 (delivery_date) を業務明細レベルで持つ。
    // 既存 order_items.due_date は header レベルの全体納期、
    // delivery_date は line item ごとの納期 (分納時に分かれる)。
    // -----------------------------------------------------------------
    `ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS delivery_date DATE;`,

    // Phase 20 (修正版): 業務明細レベルの納期アラート
    //   delivery_events.last_alert_at は誤ったテーブルだったため未使用となるが
    //   将来「検収期限超過アラート」を別途出すかもしれないので残置。
    //   実運用のアラートはここ order_line_items.last_alert_at を見る。
    `ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMP WITH TIME ZONE;`,
    `ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS alert_count INTEGER DEFAULT 0;`,

    // -----------------------------------------------------------------
    // Phase 13: order_line_items を calc_method + payment_terms split に。
    // license_financial_conditions と同じ語彙に統一:
    //   calc_method   = 計算方式 (FIXED / SUBSCRIPTION / ROYALTY)
    //   payment_terms = 支払条件 (自由テキスト、例: '翌月末', '検収後')
    // 既存 payment_method 列は legacy 用途に残置 (UI 互換)。
    // -----------------------------------------------------------------
    `ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS calc_method VARCHAR(50) DEFAULT 'FIXED';`,
    `ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS payment_terms TEXT;`,
    // 既存行を backfill: payment_method の値をそのまま payment_terms に移し、
    // calc_method を 'FIXED' で埋める (PO 明細は基本的に FIXED 計算)
    `UPDATE order_line_items
        SET calc_method = COALESCE(NULLIF(calc_method, ''), 'FIXED'),
            payment_terms = COALESCE(payment_terms, payment_method)
      WHERE calc_method IS NULL OR calc_method = '' OR payment_terms IS NULL;`,

    // -----------------------------------------------------------------
    // Phase 22.8: SUBSCRIPTION (継続課金) 用フィールド。
    //   calc_method='SUBSCRIPTION' の行のみ意味を持つ:
    //     cycle       : 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL'
    //     term_start  : 契約開始日
    //     term_end    : 契約終了日 (NULL なら継続中扱い)
    //     billing_day : 毎周期の支払日 (1-31; 0 or >30 で末日扱い)
    //   FIXED/ROYALTY 行では NULL のまま (UI / PDF にも出ない)。
    //   顧問契約・SaaS 月額・年額ライセンス等のスケジュールを構造化保持。
    // -----------------------------------------------------------------
    `ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS cycle VARCHAR(20);`,
    `ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS term_start DATE;`,
    `ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS term_end DATE;`,
    `ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS billing_day SMALLINT;`,

    // -----------------------------------------------------------------
    // Phase 17i: 経費 (交通費等) — 発注書本体の業務報酬とは別に、
    //   発注者が受注者に精算する経費を行単位で保持する。
    //   料金は基本的に税込み額で記録 (現場の領収書がそのまま反映できる)。
    //   発注書 PDF では業務明細表の直下に独立した経費表として描画される。
    // -----------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS order_expenses (
      id SERIAL PRIMARY KEY,
      order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      expense_name TEXT NOT NULL,
      spec TEXT,
      spent_date DATE,
      amount_inc_tax DECIMAL(15, 2),
      remarks TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(order_item_id, line_no)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_oe_order_item ON order_expenses(order_item_id);`,

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
    //                          inspection_certificate*, royalty_*, fee_*)
    //   'other'      … その他 (nda, legal_request, intl_amendment, etc.)
    // -----------------------------------------------------------------
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_category VARCHAR(20);`,
    `CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(document_category);`,
    // template_type → category マップを 1 つの SQL 関数に集約。
    // worker / search-api 両方の SELECT で UPDATE 不要、INSERT 時 trigger で
    // 自動設定。helper TS 側 (documentCategory.ts) と同じロジック。
    `CREATE OR REPLACE FUNCTION lb_category_for_template(t TEXT) RETURNS VARCHAR(20) AS $$
       BEGIN
         IF t IN ('license_master','service_master','sales_master_buyer','sales_master_standard','sales_master_credit','intl_master') THEN
           RETURN 'basic';
         ELSIF t = 'individual_license_terms'
            OR t LIKE 'purchase_order%'
            OR t LIKE 'planning_purchase_order%'
            OR t LIKE 'intl_purchase_order%'
            OR t LIKE 'inspection_certificate%'
            OR t LIKE 'royalty_%'
            OR t LIKE 'fee_%'
            OR t LIKE 'license_report%'
            OR t LIKE 'payment_notice%' THEN
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

    // -----------------------------------------------------------------
    // Phase 5a: 個別利用許諾条件書のヘッダ情報を SQL-queryable に
    //
    // 既存の license_contracts は最低限の項目しか持たないので、
    // individual_license_terms テンプレが扱う変数を直接マッピングできる
    // カラムを追加する。licensor* / licensee* は両当事者の入れ替えに対応
    // するため両方ともテーブルに持つ。
    // -----------------------------------------------------------------
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS issue_date DATE;`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS basic_contract_name TEXT;`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS licensor_name VARCHAR(255);`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS licensor_address TEXT;`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS licensor_rep VARCHAR(255);`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS licensor_is_corporation BOOLEAN;`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS licensee_name VARCHAR(255);`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS licensee_address TEXT;`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS licensee_rep VARCHAR(255);`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS licensee_is_corporation BOOLEAN;`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS license_period_note TEXT;`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS original_work_note TEXT;`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS product_name_predicted TEXT;`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS exclusivity VARCHAR(20);`, // 独占/非独占
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS supervisor VARCHAR(255);`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS credit_display TEXT;`,
    `ALTER TABLE license_contracts ADD COLUMN IF NOT EXISTS remarks TEXT;`,

    // Backfill: legacy licensor varchar → licensor_name
    `UPDATE license_contracts
        SET licensor_name = licensor
      WHERE licensor_name IS NULL AND licensor IS NOT NULL;`,

    // -----------------------------------------------------------------
    // Phase 5a: 金銭条件 (1 ライセンス契約 = N 金銭条件)
    //
    // individual_license_terms テンプレは 金銭条件1 (自社製造) / 2
    // (サブライセンス) / 3 (プロダクトアウト) の 3 つの slot を扱う。
    // 各条件ごとに rate / base_price_label / currency / mg_amount を
    // 持てるようにする。
    //
    // 利用許諾料計算書はこのテーブルの 1 行を指して計算する。
    // -----------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS license_financial_conditions (
      id SERIAL PRIMARY KEY,
      license_contract_id INTEGER NOT NULL REFERENCES license_contracts(id) ON DELETE CASCADE,
      condition_no INTEGER NOT NULL,            -- 1=自社製造, 2=サブライセンス, 3=プロダクトアウト
      region_language_label TEXT,               -- 例: 国内・日本語
      calc_method VARCHAR(50),                  -- ROYALTY / FIXED / SUBSCRIPTION
      rate_pct DECIMAL(7, 4),                   -- 例: 5.0000 (%)
      base_price_label TEXT,                    -- 例: 上代 (MSRP)
      calc_period VARCHAR(50),                  -- 例: 四半期 / 月次
      currency VARCHAR(10) DEFAULT 'JPY',
      formula_text TEXT,                        -- 例: 上代 × 5.0% × 製造数
      payment_terms TEXT,
      mg_amount DECIMAL(15, 2) DEFAULT 0,       -- MG 総額 (この条件単位)
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(license_contract_id, condition_no)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_lfc_contract ON license_financial_conditions(license_contract_id);`,

    // Backfill: 既存 license_contracts.royalty_rate / mg_amount を
    // condition_no=1 の自社製造条件として一行立てる。
    `INSERT INTO license_financial_conditions
       (license_contract_id, condition_no, calc_method, rate_pct, mg_amount, currency)
     SELECT lc.id, 1, 'ROYALTY',
            COALESCE(lc.royalty_rate * 100, 0),
            COALESCE(lc.mg_amount, 0),
            'JPY'
       FROM license_contracts lc
       LEFT JOIN license_financial_conditions lfc
         ON lfc.license_contract_id = lc.id AND lfc.condition_no = 1
      WHERE lfc.id IS NULL;`,

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
      license_contract_id INTEGER REFERENCES license_contracts(id),
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
      license_contract_id INTEGER REFERENCES license_contracts(id),
      license_financial_condition_id INTEGER REFERENCES license_financial_conditions(id),
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
    // 念のため重複行 (document_number が同じで複数行) を残す場合に備えた
    // 防御クリーンアップ — 最新の id 1 件だけ残して他を削除する。
    // 部分インデックスが効いていれば重複は無いはずだが、過去に
    // インデックス未適用の時期があった場合の保険。
    `DELETE FROM contract_capabilities a
       USING contract_capabilities b
      WHERE a.id < b.id
        AND a.document_number = b.document_number
        AND a.document_number IS NOT NULL;`,
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
    `UPDATE contract_capabilities
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
 * Phase 22.10 (改 Phase 22.11.1): 文書番号採番 + リビジョン管理。
 *
 * 採番ルール:
 *   ① existingDocumentNumber が渡されなかった場合 = 完全新規
 *        → 毎回新しい番号を採番 (PO-0001, PO-0002, ...)
 *          同じ Backlog 課題で複数 PO を発行する正常ケースをサポート
 *   ② existingDocumentNumber 渡し + その既存ドキュメントが
 *      drive_link 空 = 未完成 draft → そのまま同番号で完成
 *        (旧 Phase 15: PDF 未作成キュー由来の draft 完成)
 *   ③ existingDocumentNumber 渡し + drive_link 入り = 完成済を再編集
 *        → 同じ base を共有しつつ revision を +1 して "_NNN" サフィックス付与
 *          (Archive から「再編集モードで開く」→ 編集 → 再発行 のフロー)
 *
 * 旧 Phase 22.10 にあった「同 issue_key + 同 template_type の既存 doc を見て
 * 自動的に再発行扱い」ロジックは撤廃。これは同一取引先・同一 issueKey で
 * 別 PO を発行する正常ユースケースを破壊していた。リビジョンは
 * 「ユーザーが既存 PO を明示的に reopen して再編集した」場合のみ発火する。
 *
 * 返り値:
 *   documentNumber:      実際に新規発行する番号
 *   baseDocumentNumber:  初版番号 (リビジョンを跨ぐ共通キー)
 *   revision:            0=初版 / 1,2,... = 再発行版
 *   isReissue:           true なら再発行 (Rev. ≥ 1 = 既存編集)
 */
export async function getDocumentNumberForGenerate(opts: {
  issueKey: string;
  templateType: string;
  issueTypeName?: string;
  existingDocumentNumber?: string;
}): Promise<{
  documentNumber: string;
  baseDocumentNumber: string;
  revision: number;
  isReissue: boolean;
}> {
  const { templateType, issueTypeName, existingDocumentNumber } = opts;

  // === Case ①: 完全新規 (existingDocumentNumber なし) ===
  // 毎回新しい番号を採番。同 issueKey に対して 2 度目以降の発行も普通に新規扱い。
  if (!existingDocumentNumber || !existingDocumentNumber.trim()) {
    const newNumber = await getNewDocumentNumber(templateType, issueTypeName);
    return {
      documentNumber: newNumber,
      baseDocumentNumber: newNumber,
      revision: 0,
      isReissue: false,
    };
  }

  const docNum = existingDocumentNumber.trim();

  // existingDocumentNumber に対応する既存行を探す。
  // 渡された番号が base そのものでも、_001 等のリビジョン版でも、
  // 同じ base に属する最新リビジョンを取得する。
  const existingRow = await query(
    `SELECT base_document_number, revision, drive_link, document_number
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
    };
  }

  const existing = existingRow.rows[0];
  const base = existing.base_document_number || existing.document_number || docNum;
  const isUnfinishedDraft =
    !existing.drive_link || String(existing.drive_link).trim() === "";

  // === Case ②: 未完成 draft の完成 (drive_link 空) ===
  // 旧 Phase 15: PDF 未作成キュー由来。同番号で UPDATE 完了 (リビジョンは
  // 上げない)。
  if (isUnfinishedDraft) {
    return {
      documentNumber: docNum,
      baseDocumentNumber: base,
      revision: Number(existing.revision) || 0,
      isReissue: false,
    };
  }

  // === Case ③: 完成済を再編集 → リビジョン採番 ===
  // base を共有しつつ revision を +1 して "_NNN" サフィックス付与。
  const nextRev = (Number(existing.revision) || 0) + 1;
  const suffix = nextRev.toString().padStart(3, "0");
  return {
    documentNumber: `${base}_${suffix}`,
    baseDocumentNumber: base,
    revision: nextRev,
    isReissue: true,
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
