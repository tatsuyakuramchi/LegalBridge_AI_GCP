-- 0079_work_components_unique_material.sql
-- N:N 中間表(work_components / work_component_lines)活性化 Stage 1: コンポーネント一意化。
--   設計: docs/design/work-nn-junction-activation-plan.md
--
-- 目的:
--   「1作品 × 1マテリアル = 1コンポーネント」を保証する部分ユニーク制約を追加し、
--   Stage 1 の populate API(syncWorkComponentLink)が
--     INSERT ... ON CONFLICT (work_id, material_id) WHERE material_id IS NOT NULL DO NOTHING
--   で冪等に work_components を ensure できるようにする。
--
-- 前提: 0078 で work_components.material_id は work_materials を参照する正準に揃え済。
--   material_id IS NULL(マテリアル未確定のコンポーネント)は一意化対象外(部分インデックス)。
--
-- additive・冪等。

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_components_work_material
  ON work_components (work_id, material_id)
  WHERE material_id IS NOT NULL;
