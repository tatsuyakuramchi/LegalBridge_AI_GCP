-- 0074_unify_phase1_additive.sql
-- 作品・原作統合 Phase 1（スキーマ整備・additive / 非破壊）
--   設計書 docs/design/work-source-ip-unification.md v3.0 の Phase 1 に対応。
--   既存データ・既存コードを壊さないよう ADD COLUMN IF NOT EXISTS のみ。
--   呼称変更(kind=licensed_in→source)・互換VIEW・採番集約のコード切替は後続フェーズ。
--   バックフィルは「確実に判定できる範囲」だけ行い、曖昧なものは NULL のまま残す。

-- ── (1) condition_lines: 取引種別 + ノード連結列(エッジの多軸化) ───────────
ALTER TABLE condition_lines
  ADD COLUMN IF NOT EXISTS transaction_kind       VARCHAR(20),   -- 'license' | 'product' | 'service'
  ADD COLUMN IF NOT EXISTS source_work_id         INTEGER REFERENCES works(id),         -- 支払×license の原作(works)
  ADD COLUMN IF NOT EXISTS source_material_id     INTEGER REFERENCES work_materials(id),-- 支払×license/service の素材
  ADD COLUMN IF NOT EXISTS product_id             INTEGER REFERENCES products(id),      -- product 系の SKU
  ADD COLUMN IF NOT EXISTS counterparty_vendor_id INTEGER REFERENCES vendors(id);       -- 取引先(権利者/サブ/サプライヤー/卸先)

-- CHECK は後付け(既存行に NULL があるため NOT VALID で追加し、バックフィル後に VALIDATE)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cl_transaction_kind_chk') THEN
    ALTER TABLE condition_lines
      ADD CONSTRAINT cl_transaction_kind_chk
      CHECK (transaction_kind IS NULL OR transaction_kind IN ('license','product','service'))
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cl_source_work     ON condition_lines(source_work_id)         WHERE source_work_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cl_source_material ON condition_lines(source_material_id)     WHERE source_material_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cl_product         ON condition_lines(product_id)             WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cl_counterparty    ON condition_lines(counterparty_vendor_id) WHERE counterparty_vendor_id IS NOT NULL;

-- 確実に判定できる範囲のみ transaction_kind を補完:
--   royalty → license / 発注書(purchase_order)配下 → service。それ以外は NULL(Phase2で分類)。
UPDATE condition_lines cl SET transaction_kind = 'license'
 WHERE cl.transaction_kind IS NULL AND cl.payment_scheme = 'royalty';

UPDATE condition_lines cl SET transaction_kind = 'service'
  FROM contract_capabilities cc
 WHERE cl.capability_id = cc.id
   AND cl.transaction_kind IS NULL
   AND cc.record_type = 'purchase_order';

-- counterparty は capability の取引先を既定値として補完(明細個別の上書きは後続)。
UPDATE condition_lines cl SET counterparty_vendor_id = cc.vendor_id
  FROM contract_capabilities cc
 WHERE cl.capability_id = cc.id
   AND cl.counterparty_vendor_id IS NULL
   AND cc.vendor_id IS NOT NULL;

-- ── (2) work_materials: 素材コード/連番/デフォルト/取得経路 ────────────────
ALTER TABLE work_materials
  ADD COLUMN IF NOT EXISTS material_no      INTEGER,
  ADD COLUMN IF NOT EXISTS material_code    VARCHAR(80),
  ADD COLUMN IF NOT EXISTS is_default       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS acquisition_type VARCHAR(30);  -- 'license' | 'buyout_commission' | 'in_house'

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wm_acquisition_type_chk') THEN
    ALTER TABLE work_materials
      ADD CONSTRAINT wm_acquisition_type_chk
      CHECK (acquisition_type IS NULL OR acquisition_type IN ('license','buyout_commission','in_house'))
      NOT VALID;
  END IF;
END $$;

-- material_code は部分ユニーク(バックフィル前は NULL 許容)。
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_materials_code
  ON work_materials(material_code) WHERE material_code IS NOT NULL;

-- 取得経路を判定できる範囲で補完:
--   発注書明細あり → buyout_commission / 原作素材由来 or license → license / それ以外 → in_house。
UPDATE work_materials SET acquisition_type = 'buyout_commission'
 WHERE acquisition_type IS NULL AND service_line_item_id IS NOT NULL;

UPDATE work_materials SET acquisition_type = 'license'
 WHERE acquisition_type IS NULL
   AND (source_ip_id IS NOT NULL OR source_ip_material_id IS NOT NULL OR rights_type = 'license');

UPDATE work_materials SET acquisition_type = 'in_house'
 WHERE acquisition_type IS NULL;

-- 注: material_no / material_code / is_default の値バックフィル(work_code 連番付与・
--     原作本体 -001 判定)は Phase 2 の移行スクリプトで実施する(本 migration は列追加のみ)。
