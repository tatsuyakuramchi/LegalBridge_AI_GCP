-- 0140_condition_material_rights_source.sql
-- Phase F 第3弾: 条件明細に「どの権利根源に基づく条件か」の参照を持たせる(設計 §6.6-6.7)。
--   condition_lines.material_rights_source_id を追加し、条件が指す軸マテリアル
--   (material_ref_id / source_material_id)の主要権利根源(material_rights_sources.is_primary)を
--   1:1 でバックフィルする。これで利用許諾計算書の利用料名目を権利根源から解決する土台になる。
--   既存列は非破壊。additive・冪等・可逆。
--   ロールバック: ALTER TABLE condition_lines DROP COLUMN IF EXISTS material_rights_source_id;

ALTER TABLE condition_lines
  ADD COLUMN IF NOT EXISTS material_rights_source_id INTEGER REFERENCES material_rights_sources(id);

CREATE INDEX IF NOT EXISTS idx_cl_material_rights_source
  ON condition_lines (material_rights_source_id);

-- バックフィル: 条件が指す軸マテリアル(material_ref_id 優先、無ければ source_material_id)の
--   主要権利根源(is_primary)を紐付ける。既に付いている行は触らない(冪等)。
--   material が material_rights_sources を持たない条件は NULL のまま(COND-RGT-001 で将来検出)。
UPDATE condition_lines cl
   SET material_rights_source_id = mrs.id
  FROM material_rights_sources mrs
 WHERE cl.material_rights_source_id IS NULL
   AND mrs.is_primary
   AND mrs.material_id = COALESCE(cl.material_ref_id, cl.source_material_id);
