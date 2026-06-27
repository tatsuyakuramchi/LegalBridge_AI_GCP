-- 0092_material_categories.sql
-- Category 実体テーブル昇格(2): マテリアルをジャンル単位で束ね、カテゴリ単位の
--   権利者・並び順・表示名を一元管理する。consolidation-plan §4.5 の (1)→(2)。
--   方針: カテゴリ = (work_id, genre) で一意。素材→カテゴリは genre から自動導出。
--   additive・冪等(新テーブル＋ nullable FK＋バックフィル)。語彙は lib/materialVocab と一致。

-- ── (1) material_categories ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS material_categories (
  id                      SERIAL PRIMARY KEY,
  work_id                 INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  genre                   VARCHAR(50) NOT NULL,             -- 正準ジャンル(material_type と同語彙)
  name                    TEXT,                             -- 任意の表示名(既定は genre ラベル)
  rights_holder_vendor_id INTEGER REFERENCES vendors(id),   -- カテゴリ単位の権利者(素材が継承)
  rights_holder_label     TEXT,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_id, genre)
);
CREATE INDEX IF NOT EXISTS idx_material_categories_work ON material_categories(work_id);

-- ── (2) work_materials.category_id ───────────────────────────────────────────
ALTER TABLE work_materials
  ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES material_categories(id);
CREATE INDEX IF NOT EXISTS idx_wm_category ON work_materials(category_id);

-- 正準ジャンルの並び順(UI 既定順)。
CREATE OR REPLACE FUNCTION pg_temp.genre_sort(g TEXT) RETURNS INTEGER AS $$
  SELECT CASE lower(coalesce(g,''))
    WHEN 'game_design' THEN 0 WHEN 'manuscript' THEN 1 WHEN 'illustration' THEN 2
    WHEN 'graphic_design' THEN 3 WHEN 'scenario' THEN 4 WHEN 'music' THEN 5
    WHEN 'translation' THEN 6 WHEN 'editing' THEN 7 WHEN 'text' THEN 8
    WHEN 'data' THEN 9 ELSE 99 END;
$$ LANGUAGE sql IMMUTABLE;

-- ── (3) バックフィル: 既存 (work_id, material_type) ごとに1カテゴリ ──────────────
--   権利者は「グループ内の非NULLが1種類だけ」なら集約、複数あれば NULL。
INSERT INTO material_categories (work_id, genre, sort_order, rights_holder_vendor_id, rights_holder_label)
SELECT
  wm.work_id,
  wm.material_type AS genre,
  pg_temp.genre_sort(wm.material_type) AS sort_order,
  CASE WHEN COUNT(DISTINCT wm.rights_holder_vendor_id) FILTER (WHERE wm.rights_holder_vendor_id IS NOT NULL) = 1
       THEN MAX(wm.rights_holder_vendor_id) ELSE NULL END,
  CASE WHEN COUNT(DISTINCT wm.rights_holder_label) FILTER (WHERE NULLIF(trim(wm.rights_holder_label), '') IS NOT NULL) = 1
       THEN MAX(NULLIF(trim(wm.rights_holder_label), '')) ELSE NULL END
FROM work_materials wm
WHERE wm.material_type IS NOT NULL AND trim(wm.material_type) <> ''
GROUP BY wm.work_id, wm.material_type
ON CONFLICT (work_id, genre) DO NOTHING;

-- (3b) 素材へ category_id を割当(genre 一致)。
UPDATE work_materials wm
   SET category_id = mc.id
  FROM material_categories mc
 WHERE mc.work_id = wm.work_id
   AND mc.genre = wm.material_type
   AND wm.category_id IS NULL;
