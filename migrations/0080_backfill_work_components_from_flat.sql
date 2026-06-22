-- 0080_backfill_work_components_from_flat.sql
-- N:N 中間表(work_components / work_component_lines)活性化 Stage 4: 既存フラット→中間表 バックフィル。
--   設計: docs/design/work-nn-junction-activation-plan.md
--
-- 目的:
--   Stage 1〜3 で中間表への populate 経路は用意したが、それ以前に作られた既存リンク
--   (condition_lines.work_id + source_material_id のフラット結合)や、worker graph-link 経由で
--   素材だけ後付けされた明細は中間表に入っていない。本移行でフラットから中間表へ一括取込し、
--   グラフの N:N 読取(work_component_lines 経由)に既存データも乗るようにする。
--
-- 前提: 0078(material_id→work_materials 正準化) / 0079(work_components(work_id,material_id) 部分ユニーク)。
-- 方針: additive・冪等(コンポーネントは NOT EXISTS、リンクは ON CONFLICT)。フラット列は削除しない
--   (物理廃止はデュアルラン検証後の別移行)。

-- ── (1) 不足コンポーネントを作成: 明細が指す (work_id, source_material_id) の組で未作成のもの ──
--   component_no は作品内 既存max + 組内連番。0079 の部分ユニークで (work_id, material_id) は一意。
WITH pairs AS (
  SELECT DISTINCT cl.work_id, cl.source_material_id AS material_id
    FROM condition_lines cl
   WHERE cl.work_id IS NOT NULL
     AND cl.source_material_id IS NOT NULL
),
missing AS (
  SELECT p.work_id, p.material_id
    FROM pairs p
   WHERE NOT EXISTS (
     SELECT 1 FROM work_components wc
      WHERE wc.work_id = p.work_id AND wc.material_id = p.material_id
   )
),
numbered AS (
  SELECT m.work_id, m.material_id,
         COALESCE(
           (SELECT MAX(wc.component_no) FROM work_components wc WHERE wc.work_id = m.work_id), 0
         ) + ROW_NUMBER() OVER (PARTITION BY m.work_id ORDER BY m.material_id) AS component_no
    FROM missing m
)
INSERT INTO work_components (work_id, component_no, component_kind, material_id)
SELECT work_id, component_no, 'material', material_id FROM numbered;

-- ── (2) 明細を対応コンポーネントへ結線(冪等) ───────────────────────────────────────────
INSERT INTO work_component_lines (component_id, condition_line_id)
SELECT wc.id, cl.id
  FROM condition_lines cl
  JOIN work_components wc
    ON wc.work_id = cl.work_id AND wc.material_id = cl.source_material_id
 WHERE cl.work_id IS NOT NULL
   AND cl.source_material_id IS NOT NULL
ON CONFLICT DO NOTHING;
