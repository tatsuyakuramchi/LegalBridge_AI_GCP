-- 0083_cfc_copied_from.sql
-- WMC O4(コピー痕跡): 利用許諾条件のコピー(原作素材の既存条件 → 別作品の条件書)で、
--   どの条件から値引用したかを残すためのトレース列。
--
--   capability_financial_conditions.copied_from_condition_id
--     = コピー元の capability_financial_conditions.id(通常 L1 = MLC- 原作登録器の条件)。
--
--   condition_lines 側は派生表(cfc から sync 生成)で、
--   condition_lines.source_condition_id → cfc.id を既に保持するため、
--     condition_line → cfc(source_condition_id) → copied_from_condition_id
--   で完全に辿れる。condition_lines へのスキーマ追加は不要(additive 最小)。
--
--   NULL = コピー由来でない(通常入力)。自己参照 FK。元条件が消えても痕跡を残せるよう
--   ON DELETE SET NULL とする。

ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS copied_from_condition_id INTEGER
    REFERENCES capability_financial_conditions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cfc_copied_from
  ON capability_financial_conditions(copied_from_condition_id);
