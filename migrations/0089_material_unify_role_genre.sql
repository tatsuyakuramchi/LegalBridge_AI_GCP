-- 0089_material_unify_role_genre.sql
-- マテリアル表一本化 Stage 1（additive・非破壊）。
--   設計: docs/design/work-tables-consolidation-plan.md / work-source-ip-unification.md
--   方針: work_materials を唯一の正準にする準備。役割2層(material_role)＋ジャンル正規化
--         (material_type)を追加し、レガシー2表(materials / source_ip_materials)を
--         work_materials へ冪等トップアップして完全なスーパーセットを保証する。
--   破壊的操作(列/表DROP)は後続 0090 で行う。本 migration は ADD/UPDATE のみ。
--
-- マテリアル定義(業務確定):
--   core_logic     = メイン作品(最初の利用許諾条件から登録)。
--                    ボードゲーム=ゲームコアデザイン / 出版=執筆文書。
--   sub_component  = サブコンポーネント(業務委託明細から登録)。
--                    イラスト / グラフィック / ゲームデザイン / 編集・校閲成果物 等。

-- ── (1) work_materials: 役割2層 + レガシー provenance 保全列 ──────────────────
ALTER TABLE work_materials
  ADD COLUMN IF NOT EXISTS material_role               VARCHAR(20),  -- 'core_logic' | 'sub_component'
  ADD COLUMN IF NOT EXISTS legacy_material_id          INTEGER,      -- 旧 materials.id (DROP前に保全)
  ADD COLUMN IF NOT EXISTS legacy_source_ip_material_id INTEGER;     -- 旧 source_ip_materials.id (DROP前に保全)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wm_material_role_chk') THEN
    ALTER TABLE work_materials
      ADD CONSTRAINT wm_material_role_chk
      CHECK (material_role IS NULL OR material_role IN ('core_logic','sub_component'))
      NOT VALID;
  END IF;
END $$;

-- ── (2) 冪等スーパーセット トップアップ ───────────────────────────────────────
--   DROP(0090)前に「レガシー2表の全行が work_materials に存在する」状態を確実にする。

-- (2a) materials(台帳) → work_materials（0082 と同基準・material_code で冪等）。
DO $$
BEGIN
  IF to_regclass('public.materials') IS NOT NULL AND to_regclass('public.ledgers') IS NOT NULL THEN
    INSERT INTO work_materials (
      work_id, material_no, material_code, material_name, material_type,
      rights_holder_label, is_default, remarks, acquisition_type, legacy_material_id
    )
    SELECT
      w.id, m.material_no, m.material_code, m.material_name, m.material_type,
      m.rights_holder, COALESCE(m.is_default, FALSE), m.remarks,
      CASE WHEN COALESCE(m.is_default, FALSE) OR m.material_type = 'original'
           THEN 'license' ELSE NULL END,
      m.id
    FROM materials m
    JOIN ledgers l ON l.id = m.ledger_id
    JOIN works  w ON w.work_code = l.ledger_code AND w.kind = 'licensed_in'
    WHERE NOT EXISTS (
      SELECT 1 FROM work_materials wm WHERE wm.material_code = m.material_code
    );

    -- 既存 work_materials の legacy_material_id を material_code 一致で補完(トレーサビリティ)。
    UPDATE work_materials wm
       SET legacy_material_id = m.id
      FROM materials m
     WHERE wm.legacy_material_id IS NULL
       AND wm.material_code IS NOT NULL
       AND wm.material_code = m.material_code;
  END IF;
END $$;

-- (2b) source_ip_materials → work_materials（0033 と同基準・source_ip_material_id で冪等）。
DO $$
BEGIN
  IF to_regclass('public.source_ip_materials') IS NOT NULL THEN
    INSERT INTO work_materials (
      work_id, material_name, material_type, rights_type,
      rights_holder_vendor_id, rights_holder_label,
      source_ip_id, source_ip_material_id, remarks, acquisition_type,
      legacy_source_ip_material_id
    )
    SELECT
      w.id, m.material_name, m.material_type, 'license',
      m.rights_holder_vendor_id, m.rights_holder_label,
      m.source_ip_id, m.id, m.remarks,
      CASE WHEN COALESCE(m.is_default, FALSE) OR m.material_type = 'original'
           THEN 'license' ELSE NULL END,
      m.id
    FROM source_ip_materials m
    JOIN works w ON w.legacy_source_ip_id = m.source_ip_id
    WHERE NOT EXISTS (
      SELECT 1 FROM work_materials wm WHERE wm.source_ip_material_id = m.id
    );

    -- 既存行の legacy_source_ip_material_id を現役 source_ip_material_id から保全。
    UPDATE work_materials
       SET legacy_source_ip_material_id = source_ip_material_id
     WHERE legacy_source_ip_material_id IS NULL
       AND source_ip_material_id IS NOT NULL;
  END IF;
END $$;

-- ── (3) material_type ジャンル正規化（既知シノニムのみ・曖昧は現状維持） ──────────
--   正準語彙: game_design / manuscript / illustration / graphic_design / scenario /
--             music / translation / editing / text / data / other / original(本体互換)。
UPDATE work_materials SET material_type = CASE lower(trim(material_type))
    WHEN 'ゲームデザイン'           THEN 'game_design'
    WHEN 'コアデザイン'             THEN 'game_design'
    WHEN 'gamedesign'               THEN 'game_design'
    WHEN '執筆'                     THEN 'manuscript'
    WHEN '執筆文書'                 THEN 'manuscript'
    WHEN '原稿'                     THEN 'manuscript'
    WHEN 'イラスト'                 THEN 'illustration'
    WHEN 'illust'                   THEN 'illustration'
    WHEN 'グラフィック'             THEN 'graphic_design'
    WHEN 'グラフィックデザイン'     THEN 'graphic_design'
    WHEN 'graphic'                  THEN 'graphic_design'
    WHEN 'シナリオ'                 THEN 'scenario'
    WHEN '音楽'                     THEN 'music'
    WHEN '翻訳'                     THEN 'translation'
    WHEN '編集'                     THEN 'editing'
    WHEN '校閲'                     THEN 'editing'
    WHEN '編集校閲'                 THEN 'editing'
    WHEN 'テキスト'                 THEN 'text'
    WHEN 'データ'                   THEN 'data'
    WHEN 'その他'                   THEN 'other'
    ELSE material_type
  END
 WHERE material_type IS NOT NULL;

-- 注: material_type は歴史的に自由運用(UI/PUT が日本語ラベル等を書き込む)。DB CHECK は
--   既存の書込み経路を壊すため設けない。正準語彙への寄せは本 UPDATE と CSV 取込時の
--   正規化(workModelImportService.normalizeGenre)で段階的に行う。

-- ── (4) material_role バックフィル ───────────────────────────────────────────
--   メイン作品(本体) = core_logic、それ以外 = sub_component。
UPDATE work_materials
   SET material_role = 'core_logic'
 WHERE material_role IS NULL
   AND (COALESCE(is_default, FALSE) = TRUE
        OR material_type IN ('original','game_design','manuscript'));

UPDATE work_materials
   SET material_role = 'sub_component'
 WHERE material_role IS NULL;

CREATE INDEX IF NOT EXISTS idx_wm_material_role ON work_materials(material_role);
