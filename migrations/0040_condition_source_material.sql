-- 0040_condition_source_material.sql
-- モデル(あ)精緻化: 素材(マテリアル)は原作IPに帰属し、条件明細が「原作IP＋素材」を参照する。
--   capability_financial_conditions.source_work_id(原作IP) に加え、
--   source_material_id(その原作IPの素材 work_materials.id) を additive 追加。
--   → 「原作IP＋マテリアル選択で作品の契約構成」を条件明細1行で表現。
-- 冪等: ADD COLUMN IF NOT EXISTS。

ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS source_material_id INTEGER REFERENCES work_materials(id);
CREATE INDEX IF NOT EXISTS idx_cfc_source_material ON capability_financial_conditions(source_material_id);
