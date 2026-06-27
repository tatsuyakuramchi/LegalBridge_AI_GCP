-- 0091_material_genre_canonical.sql
-- O5(Category 正式化): 既存 work_materials.material_type を正準ジャンル語彙へ寄せる。
--   方針: material_type = 純粋な「ジャンル」、material_role = 本体/サブ(0089 導入)に分離。
--   additive・冪等(UPDATE のみ・表/列の変更なし)。語彙は lib/materialVocab と一致。
--   正準ジャンル: game_design / manuscript / illustration / graphic_design / scenario /
--                 music / translation / editing / text / data / other。

-- ── (1) 本体 'original' → 事業部(division)でジャンル確定 ───────────────────────
--   works.division が PUB のみ → manuscript(執筆文書)、それ以外 → game_design。
--   (2) より前に実行(下の mapping は 'original' を扱わないため)。
UPDATE work_materials wm SET material_type = CASE
    WHEN ('PUB' = ANY(COALESCE(w.division, '{}'))
          AND NOT ('BDG' = ANY(COALESCE(w.division, '{}'))))
    THEN 'manuscript' ELSE 'game_design' END
  FROM works w
 WHERE wm.work_id = w.id
   AND lower(trim(wm.material_type)) = 'original';

-- ── (2) 旧自由語彙/別表記 → 正準ジャンル ──────────────────────────────────────
--   構造的レガシー値(派生/キャラクター/関連アセット/設定資料)はジャンル不明 → other。
--   本体/派生の区別は material_role が担う。
UPDATE work_materials SET material_type = CASE lower(trim(material_type))
    WHEN 'ゲームデザイン'       THEN 'game_design'
    WHEN 'コアデザイン'         THEN 'game_design'
    WHEN 'gamedesign'           THEN 'game_design'
    WHEN '執筆'                 THEN 'manuscript'
    WHEN '執筆文書'             THEN 'manuscript'
    WHEN '原稿'                 THEN 'manuscript'
    WHEN 'イラスト'             THEN 'illustration'
    WHEN 'illust'               THEN 'illustration'
    WHEN 'グラフィック'         THEN 'graphic_design'
    WHEN 'グラフィックデザイン' THEN 'graphic_design'
    WHEN 'graphic'              THEN 'graphic_design'
    WHEN 'design'               THEN 'graphic_design'
    WHEN 'デザイン'             THEN 'graphic_design'
    WHEN 'シナリオ'             THEN 'scenario'
    WHEN '音楽'                 THEN 'music'
    WHEN '翻訳'                 THEN 'translation'
    WHEN '編集'                 THEN 'editing'
    WHEN '校閲'                 THEN 'editing'
    WHEN '編集校閲'             THEN 'editing'
    WHEN 'テキスト'             THEN 'text'
    WHEN 'データ'               THEN 'data'
    WHEN 'その他'               THEN 'other'
    WHEN 'derivative'           THEN 'other'
    WHEN '派生作品'             THEN 'other'
    WHEN 'character'            THEN 'other'
    WHEN 'キャラクター'         THEN 'other'
    WHEN 'asset'                THEN 'other'
    WHEN '関連アセット'         THEN 'other'
    WHEN 'setting'              THEN 'other'
    WHEN '設定資料'             THEN 'other'
    ELSE material_type  -- 既に正準 or 未知値は維持(grandfathered)
  END
 WHERE material_type IS NOT NULL;

-- ── (3) material_role 補完(0089 で実施済だが冪等保険) ─────────────────────────
UPDATE work_materials SET material_role = 'core_logic'
 WHERE material_role IS NULL
   AND (COALESCE(is_default, FALSE) OR material_type IN ('game_design', 'manuscript'));
UPDATE work_materials SET material_role = 'sub_component'
 WHERE material_role IS NULL;
