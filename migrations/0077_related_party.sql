-- 0077_related_party.sql
-- 関連当事者取引 判定機能のDB基盤（additive / 非破壊）
--   GAS フォーム related_party.html の情報元を本番DBに載せるための土台。
--   方針:
--     - エンティティ(法人)は既存 vendors を流用し、取締役会設置フラグ(has_board)と
--       RPT判定の対象スコープフラグ(rpt_entity)を追加。
--     - 役員(officers)・就任(officer_roles)・株主構成(vendor_shareholdings)は新設。
--     - 判定結果/承認決議(議案)は ringi_records(decision_type='board_resolution')を
--       正本とし、RPT固有項目は 1:1 サイドカー ringi_related_party に持つ。
--   既存テーブルへの変更は ADD COLUMN IF NOT EXISTS のみ。既存クエリは新列に依存しない。

-- ── (1) vendors 拡張: 取締役会設置 + RPTスコープフラグ ───────────────────
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS has_board  BOOLEAN NOT NULL DEFAULT FALSE,  -- 取締役会設置会社
  ADD COLUMN IF NOT EXISTS rpt_entity BOOLEAN NOT NULL DEFAULT FALSE;  -- 関連当事者判定の対象エンティティ

-- rptGetMasters はこのフラグが立つ行のみ返す。rptVoidEntity は false に戻す
-- (= 共有 vendors マスタ本体は削除せず RPT スコープからのみ外す soft-remove)。
CREATE INDEX IF NOT EXISTS idx_vendors_rpt_entity ON vendors(rpt_entity) WHERE rpt_entity;

-- ── (2) 役員マスタ ──────────────────────────────────────────────────────
--   officer_key で外部から一意識別する（社員役員=staff_id、社外役員=氏名）。
--   PUT /rpt/officers は officer_key 単位で upsert + 就任(roles)総入替。
CREATE TABLE IF NOT EXISTS officers (
  id          SERIAL PRIMARY KEY,
  officer_key VARCHAR(255) UNIQUE NOT NULL,                  -- staff_id or 氏名（外部識別子）
  name        VARCHAR(255) NOT NULL,
  staff_id    VARCHAR(50),                                   -- 任意: staff.slack_user_id 等との対応
  voided_at   TIMESTAMP WITH TIME ZONE,                      -- soft-delete (rptVoidOfficer)
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_officers_active ON officers(id) WHERE voided_at IS NULL;

-- ── (3) 役員の就任(会社×役職) — 兼任を表現 ─────────────────────────────
CREATE TABLE IF NOT EXISTS officer_roles (
  id          SERIAL PRIMARY KEY,
  officer_id  INTEGER NOT NULL REFERENCES officers(id) ON DELETE CASCADE,
  entity_id   INTEGER NOT NULL REFERENCES vendors(id)  ON DELETE CASCADE,
  title       VARCHAR(50) NOT NULL,                          -- 代表取締役/取締役/社外取締役/監査役/執行役員/会計参与
  is_director BOOLEAN NOT NULL DEFAULT FALSE,                -- DIRECTOR_TITLES(代表取締役/取締役/社外取締役) に該当
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (officer_id, entity_id, title)
);
CREATE INDEX IF NOT EXISTS idx_officer_roles_officer ON officer_roles(officer_id);
CREATE INDEX IF NOT EXISTS idx_officer_roles_entity  ON officer_roles(entity_id);

-- ── (4) 株主構成(出資比率/議決権) — 株主は法人(vendors)or個人(officers) ──
CREATE TABLE IF NOT EXISTS vendor_shareholdings (
  id                SERIAL PRIMARY KEY,
  entity_id         INTEGER NOT NULL REFERENCES vendors(id)  ON DELETE CASCADE,  -- 被保有会社
  holder_kind       VARCHAR(10) NOT NULL CHECK (holder_kind IN ('entity','officer')),
  holder_entity_id  INTEGER REFERENCES vendors(id)  ON DELETE CASCADE,           -- holder_kind='entity'
  holder_officer_id INTEGER REFERENCES officers(id) ON DELETE CASCADE,           -- holder_kind='officer'
  voting_pct        NUMERIC(7,4) NOT NULL DEFAULT 0,                             -- 議決権%
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (holder_kind = 'entity'  AND holder_entity_id  IS NOT NULL AND holder_officer_id IS NULL) OR
    (holder_kind = 'officer' AND holder_officer_id IS NOT NULL AND holder_entity_id  IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_shareholdings_entity ON vendor_shareholdings(entity_id);

-- ── (5) 議案のRPT拡張 — ringi_records(board_resolution) の 1:1 サイドカー ──
--   議案レコードの正本は ringi_records 行(decision_type='board_resolution', 番号 B-NNNNN)。
--   ここには会計/会社法判定に固有の項目だけを持たせる。
CREATE TABLE IF NOT EXISTS ringi_related_party (
  ringi_id          INTEGER PRIMARY KEY REFERENCES ringi_records(id) ON DELETE CASCADE,
  entity_id         INTEGER REFERENCES vendors(id),         -- 起票対象の自社側 会社
  meeting_date      DATE,
  txn_type          VARCHAR(50),                            -- フォーム TXN_TYPES の id (sale/service/...)
  party_a           TEXT,
  party_b           TEXT,
  amount_ex_tax     NUMERIC(15,2),
  is_conflict       BOOLEAN DEFAULT FALSE,                  -- 会社法 利益相反 該当
  is_related_party  BOOLEAN DEFAULT FALSE,                  -- 会計 関連当事者 該当
  related_category  TEXT,                                   -- 関連当事者の区分(基準5項)
  conflict_types    JSONB DEFAULT '[]'::jsonb,              -- ["会社名：双方代表", ...]
  excluded_officers JSONB DEFAULT '[]'::jsonb,              -- 議決除斥対象の役員名
  rp_status         VARCHAR(20) DEFAULT 'pending',          -- pending/approved/rejected/deferred
  note              TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ringi_rp_entity ON ringi_related_party(entity_id);
CREATE INDEX IF NOT EXISTS idx_ringi_rp_status ON ringi_related_party(rp_status);
