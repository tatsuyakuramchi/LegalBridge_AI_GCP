-- 0084_per_line_work_id.sql
-- 明細ごとの作品帰属(作品1:文書N:明細N)。
--   発注書は1枚に複数タイトルが混在することが多く、受注者帰属の利用許諾条件も
--   明細(作品)単位で持つ必要があるため、明細層に work_id を追加する。
--
--   - capability_line_items.work_id        : 発注書/業務明細ごとの成果物作品。
--   - capability_financial_conditions.work_id : 利用許諾条件(明細)ごとの作品。
--   condition_lines.work_id は既存(0063)。これらから sync 時に伝播させる。
--
--   いずれも NULL = 文書単位の linked_work_id にフォールバック(従来の単一作品挙動)。
--   additive のみ。既存データへの backfill は行わない(NULL のまま、表示側で文書 work を補完)。

ALTER TABLE capability_line_items
  ADD COLUMN IF NOT EXISTS work_id INTEGER REFERENCES works(id);

ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS work_id INTEGER REFERENCES works(id);

CREATE INDEX IF NOT EXISTS idx_cli_work_id ON capability_line_items(work_id);
CREATE INDEX IF NOT EXISTS idx_cfc_work_id ON capability_financial_conditions(work_id);
