-- 0078_work_components_material_repoint.sql
-- N:N 中間表(work_components / work_component_lines)活性化 Stage 0: マテリアル表の正準化。
--   設計: docs/design/work-nn-junction-activation-plan.md
--
-- 背景:
--   「原作マテリアル : 作品 = N:N」を中間表 work_component_lines で表現する。しかし
--   work_components.material_id は materials(台帳)を参照する一方、3カードエディタ /
--   condition_lines.source_material_id / GET /api/v3/works/:id/graph は work_materials(works系)
--   を使う(0074)。中間表が橋として機能するには両者を揃える必要がある。
--
-- 決定(ユーザー合意 2026-06-22): work_materials を正準とする。エディタ・条件明細が既に
--   work_materials を使うため破壊が最小。よって work_components.material_id の FK を
--   materials -> work_materials へ付け替える。
--
-- 前提: work_components は現状どのコードも INSERT しておらず実質空(休眠)。データ移行は不要。
--   非空かつ work_materials に対応しない material_id があれば (0) で中断し人手レビューを促す。
--
-- 方針: additive・冪等。旧表(materials)は削除しない(物理廃止は Stage 4 以降の別移行)。
--   新規テーブルは作らない(work_components/work_component_lines への GRANT は 0063 で付与済)。

-- ── (0) 安全確認: work_materials に対応しない material_id が残っていれば中断 ────────────
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad
    FROM work_components wc
   WHERE wc.material_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM work_materials wm WHERE wm.id = wc.material_id);
  IF bad > 0 THEN
    RAISE EXCEPTION
      'work_components.material_id に work_materials 非対応の行が % 件あります。0078 を中断します。'
      ' materials(台帳) id から work_materials id への手動マッピングが必要です。', bad;
  END IF;
END $$;

-- ── (1) FK 付け替え: materials(id) -> work_materials(id) ─────────────────────────────
--   既存 FK は 0063 でインライン定義され、Postgres 既定名(work_components_material_id_fkey)
--   になっているが、名前に依存せず materials を参照する FK を動的に drop する。
DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid AND rel.relname = 'work_components'
    JOIN pg_class fr  ON fr.oid = con.confrelid AND fr.relname = 'materials'
   WHERE con.contype = 'f'
     AND con.conkey = ARRAY[
       (SELECT attnum FROM pg_attribute
         WHERE attrelid = rel.oid AND attname = 'material_id')
     ]::smallint[]
   LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE work_components DROP CONSTRAINT %I', cname);
  END IF;
END $$;

-- work_materials(id) 参照 FK を冪等に追加(既にあれば skip)。
--   ON DELETE は元 FK(materials 参照)に倣い未指定(NO ACTION)のまま。中間表の
--   material 削除時挙動は Stage 1 で work_component_lines と併せて再検討。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_components_material_id_fkey'
  ) THEN
    ALTER TABLE work_components
      ADD CONSTRAINT work_components_material_id_fkey
      FOREIGN KEY (material_id) REFERENCES work_materials(id);
  END IF;
END $$;

-- ── (2) 冪等 top-up: licensed_in 原作の台帳素材を work_materials へ取込(0076 の再掲)──────
--   0076 以降に POST /api/v3/source-ips 等で増えた台帳 materials も work_materials に揃え、
--   中間表(work_components.material_id)が指すべき行を確実に存在させる。NOT EXISTS で冪等。
INSERT INTO work_materials (
  work_id, material_no, material_code, material_name, material_type,
  rights_holder_label, is_default, remarks, acquisition_type
)
SELECT
  w.id, m.material_no, m.material_code, m.material_name, m.material_type,
  m.rights_holder, COALESCE(m.is_default, FALSE), m.remarks,
  CASE WHEN COALESCE(m.is_default, FALSE) OR m.material_type = 'original'
       THEN 'license' ELSE NULL END
FROM materials m
JOIN ledgers l ON l.id = m.ledger_id
JOIN works  w ON w.work_code = l.ledger_code AND w.kind = 'licensed_in'
WHERE NOT EXISTS (
  SELECT 1 FROM work_materials wm WHERE wm.material_code = m.material_code
);
