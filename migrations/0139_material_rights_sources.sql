-- 0139_material_rights_sources.sql
-- Phase F 第2弾: マテリアルの権利根源(利用権・著作権・支払義務の由来)を独立テーブルへ(設計 §6.5)。
--   これまで work_materials の属性直書き(rights_holder_vendor_id / source_contract_id 等)だった
--   「権利がどこ由来か」を material_rights_sources へ切り出し、1 マテリアルに複数根拠を許容する。
--   既存 work_materials は非破壊で残す。additive・冪等・可逆。
--   これで MAT-RGT-003(主要権利根源の一意性) 評価器を有効化できる。
--   ロールバック: DROP TABLE IF EXISTS material_rights_sources CASCADE;

CREATE TABLE IF NOT EXISTS material_rights_sources (
  id                       SERIAL PRIMARY KEY,
  material_id              INTEGER NOT NULL REFERENCES work_materials(id) ON DELETE CASCADE,
  source_type              VARCHAR(30),          -- work / work_family / direct_contract / company_owned / custom
  source_work_id           INTEGER REFERENCES works(id),
  source_family_id         INTEGER,              -- work_families(id)。FK は F5(source_ips/families 整理)後に付与。
  rights_holder_vendor_id  INTEGER REFERENCES vendors(id),
  source_document_id       INTEGER REFERENCES documents(id),
  source_contract_id       INTEGER REFERENCES contracts(id),
  source_role              VARCHAR(30),          -- original_work / underlying_work / character_source / ... / other
  fee_subject_type         VARCHAR(30),
  fee_subject_name         TEXT,
  fee_subject_suffix       TEXT,
  is_primary               BOOLEAN NOT NULL DEFAULT FALSE,
  valid_from               DATE,
  valid_to                 DATE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mrs_material  ON material_rights_sources (material_id);
CREATE INDEX IF NOT EXISTS idx_mrs_vendor    ON material_rights_sources (rights_holder_vendor_id);
CREATE INDEX IF NOT EXISTS idx_mrs_work      ON material_rights_sources (source_work_id);
CREATE INDEX IF NOT EXISTS idx_mrs_contract  ON material_rights_sources (source_contract_id);
CREATE INDEX IF NOT EXISTS idx_mrs_primary   ON material_rights_sources (material_id) WHERE is_primary;
-- 主要根源の一意性は「同一期間・同一用途で 1 件」という期間/用途スコープの規則(設計 §6.5)のため、
--   単純な UNIQUE 制約では表現できない。DB でハード制約は張らず、MAT-RGT-003(DQ 評価器)で検出する。

-- バックフィル: 外部権利マテリアル(rights_type が owned 以外)で、権利者取引先 or 由来契約が
--   判明しているものへ、主要根源(is_primary=true)を 1 件だけ複製する。冪等(未バックフィルのみ)。
--   source_type は 契約由来=direct_contract / 取引先のみ=direct_contract / それ以外=custom。
INSERT INTO material_rights_sources
  (material_id, source_type, rights_holder_vendor_id, source_contract_id, source_role, is_primary)
SELECT wm.id,
       CASE WHEN wm.source_contract_id IS NOT NULL OR wm.rights_holder_vendor_id IS NOT NULL
            THEN 'direct_contract' ELSE 'custom' END,
       wm.rights_holder_vendor_id,
       wm.source_contract_id,
       'other',
       true
  FROM work_materials wm
 WHERE COALESCE(wm.rights_type, '') <> 'owned'
   AND (wm.rights_holder_vendor_id IS NOT NULL OR wm.source_contract_id IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1 FROM material_rights_sources m WHERE m.material_id = wm.id AND m.is_primary
   );
