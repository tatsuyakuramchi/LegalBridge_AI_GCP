-- 0004_work_ip_masters.sql
-- 作品中心スキーマ: マスター層(§3.1/§3.2)。純追加(新テーブル名・既存と非衝突)。
-- FK は baseline 内(vendors / ringi_records)で閉じる範囲のみ。
-- work_materials は契約/成果物を参照するため後続(0005/0006)で作成。

-- 自社作品(原作IPは source_ips に分離)
CREATE TABLE IF NOT EXISTS works (
  id                  SERIAL PRIMARY KEY,
  work_code           VARCHAR(40) UNIQUE NOT NULL,        -- W-YYYY-NNNN
  title               TEXT NOT NULL,
  title_kana          TEXT,
  alternative_titles  TEXT[] NOT NULL DEFAULT '{}',
  division            TEXT[] NOT NULL DEFAULT '{}',        -- {BDG, PUB}
  work_type           VARCHAR(50),                         -- board_game / trpg_book / supplement / digital
  status              VARCHAR(20),                         -- planning / in_production / released / suspended / discontinued
  publisher_vendor_id INTEGER REFERENCES vendors(id),
  origin_ringi_id     INTEGER REFERENCES ringi_records(id),-- 起案(作品稟議)
  is_original         BOOLEAN NOT NULL DEFAULT TRUE,       -- 原作なしの完全オリジナルか
  remarks             TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_works_active ON works(is_active);
CREATE INDEX IF NOT EXISTS idx_works_division ON works USING GIN (division);

-- 原作IP(社外に権利があり当社が許諾を受けて使うIP全般の器)
CREATE TABLE IF NOT EXISTS source_ips (
  id                      SERIAL PRIMARY KEY,
  source_code             VARCHAR(40) UNIQUE NOT NULL,     -- IP-YYYY-NNNN
  title                   TEXT NOT NULL,
  title_kana              TEXT,
  alternative_titles      TEXT[] NOT NULL DEFAULT '{}',
  rights_holder_vendor_id INTEGER REFERENCES vendors(id),
  original_publisher      TEXT,
  default_rights_holder   TEXT,
  default_credit_display  TEXT,
  default_work_supplement TEXT,
  default_approval_target TEXT,
  default_approval_timing TEXT,
  remarks                 TEXT,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_ips_active ON source_ips(is_active);

-- 原作素材(委託で作らせ相手が権利を持つマテリアルの取込口でもある)
CREATE TABLE IF NOT EXISTS source_ip_materials (
  id                      SERIAL PRIMARY KEY,
  source_ip_id            INTEGER NOT NULL REFERENCES source_ips(id) ON DELETE CASCADE,
  material_no             INTEGER,
  material_code           VARCHAR(80) UNIQUE,
  material_name           TEXT NOT NULL,
  material_type           VARCHAR(50),                     -- illustration / scenario / design / music / text
  rights_holder_vendor_id INTEGER REFERENCES vendors(id),
  rights_holder_label     TEXT,
  remarks                 TEXT,
  is_default              BOOLEAN NOT NULL DEFAULT FALSE,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_ip_id, material_no)
);
CREATE INDEX IF NOT EXISTS idx_sim_source_ip ON source_ip_materials(source_ip_id);

-- 製品 / SKU(製造・販売・ロイヤリティ計算の起点)
CREATE TABLE IF NOT EXISTS products (
  id           SERIAL PRIMARY KEY,
  work_id      INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  product_code VARCHAR(60) UNIQUE,
  product_name TEXT,
  edition      VARCHAR(100),                               -- 初版 / 第2版 / 拡張
  format       VARCHAR(30),                                -- physical / ebook / print_on_demand
  msrp         DECIMAL(15,2),
  jan_code     VARCHAR(50),
  isbn         VARCHAR(30),
  release_date DATE,
  status       VARCHAR(20),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_work ON products(work_id);

-- 産業財産権(商標・意匠)+ 更新期限
CREATE TABLE IF NOT EXISTS ip_registrations (
  id                SERIAL PRIMARY KEY,
  work_id           INTEGER REFERENCES works(id),
  ip_type           VARCHAR(20),                            -- trademark / design / patent
  registration_no   VARCHAR(100),
  application_no    VARCHAR(100),
  classes           TEXT[] NOT NULL DEFAULT '{}',
  status            VARCHAR(20),                            -- applied / registered / abandoned / expired
  application_date  DATE,
  registration_date DATE,
  next_renewal_date DATE,                                   -- 更新期限(アラート対象)
  holder_vendor_id  INTEGER REFERENCES vendors(id),
  agent_vendor_id   INTEGER REFERENCES vendors(id),
  remarks           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ipreg_work ON ip_registrations(work_id);
CREATE INDEX IF NOT EXISTS idx_ipreg_renewal ON ip_registrations(next_renewal_date);

-- 費目マスター(作品に紐づかない全社/部門経費の分類)
CREATE TABLE IF NOT EXISTS expense_categories (
  expense_code     VARCHAR(40) PRIMARY KEY,                 -- accounting_audit / system_maintenance / ...
  label            TEXT,
  account_category VARCHAR(50),                             -- 販管費 / 一般管理費 等
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INTEGER NOT NULL DEFAULT 999
);

-- 当事者の役割固有マスター属性(再許諾先の既定地域等)。役割の有無は contract_parties から導出。
CREATE TABLE IF NOT EXISTS party_roles (
  id         SERIAL PRIMARY KEY,
  vendor_id  INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  role       VARCHAR(30) NOT NULL,                          -- sublicensee / author 等(固有属性を持つ役割のみ)
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (vendor_id, role)
);

-- vendors: 関連当事者フラグ(コンプライアンス)
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS related_party BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS related_party_type VARCHAR(50);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS related_party_note TEXT;
