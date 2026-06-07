-- 0039_material_condition_links.sql
-- モデル(あ): マテリアル(work_materials)中心。各マテリアルが帰属(rights_type)に応じて
--   「利用許諾条件明細」または「業務委託条件明細」への参照を1つ持つ。
--   capability 層(正準)へのリンク列を additive 追加。
--     license_condition_id  … 帰属=相手方/共有(license/joint) → capability_financial_conditions
--     service_line_item_id  … 帰属=当社(owned/copyright_assignment) → capability_line_items(業務委託明細)
--
--   既存の v3 リンク(license_financial_term_id)は capability_financial_conditions と id 共有のため流用 backfill。
--   material_type の語彙に translation(翻訳) を追加(VARCHAR運用・DB変更不要、UI側で選択肢追加)。
-- 冪等: ADD COLUMN IF NOT EXISTS / backfill は IS NULL ガード。

ALTER TABLE work_materials ADD COLUMN IF NOT EXISTS license_condition_id INTEGER REFERENCES capability_financial_conditions(id);
ALTER TABLE work_materials ADD COLUMN IF NOT EXISTS service_line_item_id INTEGER REFERENCES capability_line_items(id);
CREATE INDEX IF NOT EXISTS idx_wm_license_condition ON work_materials(license_condition_id);
CREATE INDEX IF NOT EXISTS idx_wm_service_line ON work_materials(service_line_item_id);

-- backfill: 旧 license_financial_term_id(v3 contract_financial_terms.id) は
--   capability_financial_conditions と id 共有のためそのまま流用できる。
UPDATE work_materials wm
   SET license_condition_id = wm.license_financial_term_id
 WHERE wm.license_financial_term_id IS NOT NULL
   AND wm.license_condition_id IS NULL
   AND EXISTS (SELECT 1 FROM capability_financial_conditions c WHERE c.id = wm.license_financial_term_id);
