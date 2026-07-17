-- 0133_condition_line_regions_languages.sql
-- 条件明細(condition_lines)の 許諾地域 / 許諾言語 を 1対N 化する子テーブル。
--   従来は region_territory / region_language の単一 TEXT(フリー入力・「北米・欧州」等の
--   結合文字列)だったが、フォームを選択式・国名単位・複数選択に変更するため、
--   明細1行に対して 国・言語を複数ぶら下げられる正規化テーブルを新設する。
--
--   後方互換: condition_lines.region_territory / region_language / condition_name
--   (=region_language_label のバック)は書込み時に子テーブルから合成して維持するため、
--   既存テンプレ/読取りは無改修で動く。本 migration は子テーブル作成＋既存値の
--   バックフィル(結合文字列を区切って1行1国/1言語へ展開)まで。冪等。

CREATE TABLE IF NOT EXISTS condition_line_regions (
  id                SERIAL PRIMARY KEY,
  condition_line_id INTEGER NOT NULL REFERENCES condition_lines(id) ON DELETE CASCADE,
  country_code      VARCHAR(16),        -- ISO alpha-2 もしくは特別値(WORLD 等)。バックフィルは NULL。
  country_name      TEXT NOT NULL,      -- 日本語表示名(例: 日本 / アメリカ合衆国 / 全世界)
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clr_line    ON condition_line_regions(condition_line_id);
CREATE INDEX IF NOT EXISTS idx_clr_country ON condition_line_regions(country_code);

CREATE TABLE IF NOT EXISTS condition_line_languages (
  id                SERIAL PRIMARY KEY,
  condition_line_id INTEGER NOT NULL REFERENCES condition_lines(id) ON DELETE CASCADE,
  language_code     VARCHAR(16),        -- ISO 639 もしくは特別値(ALL 等)。バックフィルは NULL。
  language_name     TEXT NOT NULL,      -- 日本語表示名(例: 日本語 / 英語 / 全言語)
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cll_line ON condition_line_languages(condition_line_id);
CREATE INDEX IF NOT EXISTS idx_cll_lang ON condition_line_languages(language_code);

-- ── バックフィル: 既存の結合文字列を区切り(・、,/／・スペース)で分割して1行1国/1言語へ ──
--   既に子行がある明細はスキップ(冪等)。
INSERT INTO condition_line_regions (condition_line_id, country_name, sort_order)
SELECT cl.id, trim(part.name), (part.ord - 1)::int
  FROM condition_lines cl
  CROSS JOIN LATERAL unnest(regexp_split_to_array(cl.region_territory, '[・、,/／]')) WITH ORDINALITY AS part(name, ord)
 WHERE COALESCE(cl.region_territory, '') <> ''
   AND trim(part.name) <> ''
   AND NOT EXISTS (SELECT 1 FROM condition_line_regions r WHERE r.condition_line_id = cl.id);

INSERT INTO condition_line_languages (condition_line_id, language_name, sort_order)
SELECT cl.id, trim(part.name), (part.ord - 1)::int
  FROM condition_lines cl
  CROSS JOIN LATERAL unnest(regexp_split_to_array(cl.region_language, '[・、,/／]')) WITH ORDINALITY AS part(name, ord)
 WHERE COALESCE(cl.region_language, '') <> ''
   AND trim(part.name) <> ''
   AND NOT EXISTS (SELECT 1 FROM condition_line_languages l WHERE l.condition_line_id = cl.id);
