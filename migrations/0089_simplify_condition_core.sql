-- 0089_simplify_condition_core.sql
-- スキーマ単純化 Phase 1（DDL）: 「文書⇄CL⇄原作マテリアル⇄作品⇄原作」コアの再構築。
--   設計: docs/design/schema-simplification-plan.md
--   前提: 現状データは破棄してよい（再ビルド可能）。周辺(vendors/ringi/royalty/signature 等)は対象外。
--
--   確定方針:
--     ① 条件は condition_lines に一本化（cfc/cli 廃止・ミラー撤廃・CL を直接書く）
--     ② documents と contract_capabilities を統合（document_number 文字列結合を廃止）
--     ③ 作品⇄原作マテリアルは N:N（work_material_uses）に一本化
--   付随確定: 取引形態ヘッダは CL インライン / 経費・手数料も独立CL / 分割・受領は温存
--             / material は source_material_id(→work_materials) を正準・NULL許容
--
--   ⚠ 破壊的（DROP CASCADE）。デプロイは Phase 2-4(コード書換え)完了後に release/worker へ。

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 0. 旧コアに依存するビューを撤去（capability_id 等の旧列に依存）。
--    新スキーマ向けの残高/予定/状態ビューは Phase 3（読み取り側）で再作成する。
-- ───────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS condition_line_status_v   CASCADE;
DROP VIEW IF EXISTS condition_line_balance_v  CASCADE;
DROP VIEW IF EXISTS condition_line_schedule_v CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. documents へ契約マスタ(contract_capabilities)の列を統合（②）
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS vendor_id             INTEGER REFERENCES vendors(id),
  ADD COLUMN IF NOT EXISTS record_type           VARCHAR(50),
  ADD COLUMN IF NOT EXISTS contract_category      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS contract_type          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS contract_title         TEXT,
  ADD COLUMN IF NOT EXISTS contract_status        VARCHAR(30),
  ADD COLUMN IF NOT EXISTS effective_date         DATE,
  ADD COLUMN IF NOT EXISTS expiration_date        DATE,
  ADD COLUMN IF NOT EXISTS flow_direction         VARCHAR(10),
  ADD COLUMN IF NOT EXISTS deliverable_ownership  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS backlog_issue_key      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ledger_ref_id          INTEGER REFERENCES works(id),
  ADD COLUMN IF NOT EXISTS ledger_code            VARCHAR(40),
  ADD COLUMN IF NOT EXISTS material_ref_id        INTEGER REFERENCES work_materials(id),
  ADD COLUMN IF NOT EXISTS master_document_id     INTEGER REFERENCES documents(id);

CREATE INDEX IF NOT EXISTS idx_documents_ledger   ON documents(ledger_code) WHERE ledger_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_vendor   ON documents(vendor_id)   WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_master   ON documents(master_document_id) WHERE master_document_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. condition_lines: 新リンク列＋取引形態ヘッダ/経済メタをインライン補完（①）
--    既存の source_material_id(→work_materials)/source_work_id(→works) を素材/原作の正準とする。
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE condition_lines
  ADD COLUMN IF NOT EXISTS document_id          INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS group_no             INTEGER,           -- 取引形態(v3列)。加算型セルを束ねる
  ADD COLUMN IF NOT EXISTS condition_name       TEXT,
  ADD COLUMN IF NOT EXISTS calc_type            VARCHAR(30),
  ADD COLUMN IF NOT EXISTS fixed_kind           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS subscription_cycle   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS unit_amount          NUMERIC,
  ADD COLUMN IF NOT EXISTS guarantee_type       VARCHAR(10),
  ADD COLUMN IF NOT EXISTS region_territory     TEXT,
  ADD COLUMN IF NOT EXISTS region_language      TEXT,
  ADD COLUMN IF NOT EXISTS applies_scope        TEXT,
  ADD COLUMN IF NOT EXISTS deliverable_ownership VARCHAR(20),
  -- 取引形態ヘッダ(v3)をインライン（§4 (a)）
  ADD COLUMN IF NOT EXISTS is_addon             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manufacturer         TEXT,
  ADD COLUMN IF NOT EXISTS seller                TEXT,
  ADD COLUMN IF NOT EXISTS max_region           TEXT,
  ADD COLUMN IF NOT EXISTS max_language         TEXT;

CREATE INDEX IF NOT EXISTS idx_cl_document  ON condition_lines(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cl_group     ON condition_lines(document_id, group_no);

-- 旧 capability 結合は廃止。document_id へ移行するため NOT NULL を一旦外す（Phase2 で必須化）。
ALTER TABLE condition_lines ALTER COLUMN capability_id DROP NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. work_material_uses（作品 N:N 原作マテリアル）。work_components/_lines を一本化（③）
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_material_uses (
  id                SERIAL PRIMARY KEY,
  work_id           INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,        -- 作品(kind='own')
  material_id       INTEGER NOT NULL REFERENCES work_materials(id) ON DELETE CASCADE, -- 原作マテリアル(跨ぎ可)
  condition_line_id INTEGER REFERENCES condition_lines(id) ON DELETE CASCADE,        -- 引用する具体CL(任意)
  use_no            INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_id, condition_line_id)
);
CREATE INDEX IF NOT EXISTS idx_wmu_work     ON work_material_uses(work_id);
CREATE INDEX IF NOT EXISTS idx_wmu_material ON work_material_uses(material_id);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. 受領(condition_receipts) を cfc 依存から condition_line_id へ付け替え
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE condition_receipts
  ADD COLUMN IF NOT EXISTS condition_line_id INTEGER REFERENCES condition_lines(id) ON DELETE CASCADE;
ALTER TABLE condition_receipts ALTER COLUMN condition_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_creceipts_line ON condition_receipts(condition_line_id);

-- royalty_calculations(周辺) も将来 CL 直結できるよう列だけ用意（Phase 後段で配線）。
ALTER TABLE royalty_calculations
  ADD COLUMN IF NOT EXISTS condition_line_id INTEGER REFERENCES condition_lines(id);

-- ───────────────────────────────────────────────────────────────────────────
-- 5. 旧コアテーブルを DROP（データ破棄前提・CASCADE）
--    依存FK/ビューは CASCADE で外れる（後で必要なビューは Phase で再作成）。
-- ───────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS work_component_lines            CASCADE;
DROP TABLE IF EXISTS work_components                 CASCADE;
DROP TABLE IF EXISTS capability_financial_conditions CASCADE;
DROP TABLE IF EXISTS capability_line_items           CASCADE;
DROP TABLE IF EXISTS capability_expenses             CASCADE;
DROP TABLE IF EXISTS capability_other_fees           CASCADE;
DROP TABLE IF EXISTS license_financial_conditions    CASCADE;
DROP TABLE IF EXISTS contract_financial_terms        CASCADE;
DROP TABLE IF EXISTS contract_capabilities           CASCADE;
DROP TABLE IF EXISTS source_ip_materials             CASCADE;
DROP TABLE IF EXISTS source_ips                      CASCADE;
DROP TABLE IF EXISTS materials                       CASCADE;
DROP TABLE IF EXISTS ledgers                         CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. 旧結線列の掃除（DROP TABLE CASCADE は FK は外すが列は残るため明示 drop）
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE condition_lines
  DROP COLUMN IF EXISTS capability_id,
  DROP COLUMN IF EXISTS material_id,        -- legacy → materials(廃止)
  DROP COLUMN IF EXISTS source_ip_id,
  DROP COLUMN IF EXISTS master_contract_id,
  DROP COLUMN IF EXISTS ledger_code;        -- 原作は source_material_id→work_materials→work で導出

ALTER TABLE work_materials
  DROP COLUMN IF EXISTS source_ip_id,
  DROP COLUMN IF EXISTS source_ip_material_id,
  DROP COLUMN IF EXISTS source_contract_id,
  DROP COLUMN IF EXISTS license_financial_term_id,
  DROP COLUMN IF EXISTS license_condition_id,
  DROP COLUMN IF EXISTS service_line_item_id;

COMMIT;
