-- 0016_line_item_ringi_status.sql
-- 条件明細(capability_line_items)に
--   (1) 稟議(ringi_records)への紐付け  ringi_id
--   (2) 明細の状態フラグ                status_flags(JSONB / 複数フラグ独立ON-OFF)
-- を追加。状態項目はアプリ側の定義配列(LINE_ITEM_STATUS_DEFS)で管理し、
-- 項目追加時にこのスキーマ変更は不要(JSONB にキーで格納)。
-- additive・冪等。参照先 ringi_records は 0001 baseline。

ALTER TABLE capability_line_items
  ADD COLUMN IF NOT EXISTS ringi_id     INTEGER REFERENCES ringi_records(id),
  ADD COLUMN IF NOT EXISTS status_flags JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_cli_ringi ON capability_line_items(ringi_id);
