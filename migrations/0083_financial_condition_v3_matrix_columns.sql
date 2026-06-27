-- 0083_financial_condition_v3_matrix_columns.sql
-- 個別利用許諾条件 v3(マトリクス構造) Stage A: 取引形態(capability_financial_conditions)へ列追加。
--   設計: docs/design/individual-license-terms-v3-migration-plan.md §3
--
-- v3 では「取引形態(条件) × 構成要素LC(=原作マテリアル)」の料率マトリクスを扱う。
--   取引形態(列)のメタを capability_financial_conditions に持たせる。料率セル(LC×取引形態)は
--   condition_lines(source_material_id × source_condition_id × rate_pct)で表現するため、ここは
--   取引形態側の新メタ列のみ追加する。
--
-- 列の意味:
--   manufacturer / seller : 1-3(A) 製造者・販売者(基準価格を決める組み合わせ)
--   max_region / max_language : 1-3(A) 当該取引形態で許諾できる最大スコープ(過去合意フレーム)
--   is_addon : 加算型(true)=適用料率は各LC料率の合算 / 非加算型(false)=実効料率(rate_pct)をそのまま使う
--             既存行は単一料率運用のため FALSE(=非加算型相当・現行計算と同挙動)を既定とする。
--   quantity : 2-1 個数(「数量」/「1」等。テキスト)
--
-- 方針: additive・冪等(IF NOT EXISTS)。既存挙動は不変。

ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS manufacturer  TEXT,
  ADD COLUMN IF NOT EXISTS seller        TEXT,
  ADD COLUMN IF NOT EXISTS max_region    TEXT,
  ADD COLUMN IF NOT EXISTS max_language  TEXT,
  ADD COLUMN IF NOT EXISTS is_addon      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS quantity      TEXT;

-- 検証:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='capability_financial_conditions'
--      AND column_name IN ('manufacturer','seller','max_region','max_language','is_addon','quantity');
