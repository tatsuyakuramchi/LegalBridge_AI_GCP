-- 0024_inbound_conditions.sql
-- 請求権の自動連携: 条件明細(capability_line_items)に「当社の受領(inbound)」フラグを
-- 追加し、ON の明細から請求権(sublicense_deals)を自動生成できるようにする。
--
-- 方針(ユーザー決定):
--   - 受領明細の判定 = 明細の inbound フラグ(明示的・誤検出なし)
--   - 取込先 = 既存 sublicense_deals(請求権台帳)。source_line_item_id で由来を辿り冪等化。
--
-- additive・冪等。参照先 capability_line_items(0001) / sublicense_deals(0019)。

-- ── 1) 条件明細に受領(inbound)フラグ ─────────────────────────────
ALTER TABLE capability_line_items
  ADD COLUMN IF NOT EXISTS is_inbound BOOLEAN NOT NULL DEFAULT FALSE;
  -- TRUE = 当社が相手方に請求/受領する明細(ライセンスアウト・出版印税等)

CREATE INDEX IF NOT EXISTS idx_cli_inbound ON capability_line_items(is_inbound) WHERE is_inbound = TRUE;

-- ── 2) 請求権 deal の由来(取込元の条件明細)─────────────────────
ALTER TABLE sublicense_deals
  ADD COLUMN IF NOT EXISTS source_line_item_id INTEGER;  -- capability_line_items.id(取込元・冪等キー)

-- 1 明細 = 1 deal を保証(取込の冪等性)。NULL(手動 deal)は対象外。
CREATE UNIQUE INDEX IF NOT EXISTS uq_subdeals_source_line_item
  ON sublicense_deals(source_line_item_id) WHERE source_line_item_id IS NOT NULL;
