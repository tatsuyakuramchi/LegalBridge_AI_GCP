-- 0090_drop_legacy_material_tables.sql
-- マテリアル表一本化 Stage 2（destructive・DROP）。
--   前提: 0089 で work_materials が materials / source_ip_materials の完全なスーパーセットに
--         なっている(role/genre 付与・legacy_*_id 保全・冪等トップアップ済)。
--   本 migration はレガシー2表への参照を解消し、物理 DROP する。
--   コード側(worker/api)の読み書きは全て work_materials へ repoint 済。

-- ── (0) 検証ガード: work_materials がスーパーセットでなければ中断(データ消失防止) ──────
DO $guard$
DECLARE
  miss_mat   INTEGER := 0;
  miss_sim   INTEGER := 0;
BEGIN
  IF to_regclass('public.materials') IS NOT NULL THEN
    SELECT COUNT(*) INTO miss_mat
      FROM materials m
     WHERE m.material_code IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM work_materials wm WHERE wm.material_code = m.material_code
       );
    IF miss_mat > 0 THEN
      RAISE EXCEPTION 'work_materials に未取込の materials 行が % 件あります。0089 を先に適用してください。0090 を中断します。', miss_mat;
    END IF;
  END IF;

  IF to_regclass('public.source_ip_materials') IS NOT NULL THEN
    SELECT COUNT(*) INTO miss_sim
      FROM source_ip_materials m
     WHERE NOT EXISTS (
       SELECT 1 FROM work_materials wm
        WHERE wm.legacy_source_ip_material_id = m.id
           OR wm.source_ip_material_id = m.id
     );
    IF miss_sim > 0 THEN
      RAISE EXCEPTION 'work_materials に未取込の source_ip_materials 行が % 件あります。0089 を先に適用してください。0090 を中断します。', miss_sim;
    END IF;
  END IF;
END
$guard$;

-- ── (1) contract_capabilities.material_ref_id を materials.id → work_materials.id へ再マップ ──
--   フォーム(個別利用許諾条件書)の素材参照。material_code(=<ledger_code>-NNN)で確定的に対応付け。
--   一回限り(DROP前)に実行。material_code 一致で work_materials.id に張り替える。
DO $remap$
BEGIN
  IF to_regclass('public.materials') IS NOT NULL THEN
    UPDATE contract_capabilities cc
       SET material_ref_id = wm.id
      FROM materials m
      JOIN work_materials wm ON wm.material_code = m.material_code
     WHERE cc.material_ref_id = m.id;
  END IF;
END
$remap$;

-- ── (2) 被DROP表への FK参照を除去 ────────────────────────────────────────────
-- (2a) condition_lines.material_id(→materials・デッド列)。現役は source_material_id(→work_materials)。
ALTER TABLE condition_lines DROP COLUMN IF EXISTS material_id;

-- (2b) work_materials.source_ip_material_id(→source_ip_materials)。provenance は legacy_source_ip_material_id に保全済。
--   DROP COLUMN が当該 FK制約・関連 index を自動撤去する。
ALTER TABLE work_materials DROP COLUMN IF EXISTS source_ip_material_id;

-- (2c) contract_financial_terms.source_ip_material_id(→source_ip_materials・コード未使用)。
ALTER TABLE contract_financial_terms DROP COLUMN IF EXISTS source_ip_material_id;

-- ── (3) レガシー2表を物理 DROP ───────────────────────────────────────────────
DROP TABLE IF EXISTS source_ip_materials;
DROP TABLE IF EXISTS materials;
