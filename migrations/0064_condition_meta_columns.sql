-- 0064_condition_meta_columns.sql
-- データ構造刷新 Phase 2c-0: 新台帳に「旧テーブル固有メタ列」を追加する(純 DDL)。
--
--   2b の精査で、横断検索・編集タブが編集する紐付け/状態フラグ/方向が
--   capability_line_items 固有で condition_lines に無いと判明。書込カットオーバー
--   (2c) の前提として、まず新台帳側に器を用意する(additive・冪等)。
--
--   この migration は列追加のみ。データ移送は scripts/restructure_2c0_meta_backfill.ts、
--   同期(runtime)への反映は 2c-1、balance_v の再定義は 2c-1 後に行う(本 migration では
--   既存ビューを変更しない=挙動不変)。
--
--   GRANT は 0063 で condition_lines / condition_events に付与済み(テーブル付与は
--   全列に及ぶ)ため、列追加に伴う再付与は不要。

-- ---- condition_lines: 横断検索・編集の紐付け/状態/方向 ----------------------
ALTER TABLE condition_lines
  ADD COLUMN IF NOT EXISTS source_ip_id        INTEGER REFERENCES source_ips(id),
  ADD COLUMN IF NOT EXISTS master_contract_id  INTEGER REFERENCES contracts(id),
  ADD COLUMN IF NOT EXISTS ringi_id            INTEGER REFERENCES ringi_records(id),
  ADD COLUMN IF NOT EXISTS status_flags        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_inbound          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS flow_direction      VARCHAR(10);  -- 'in' / 'out' / NULL

CREATE INDEX IF NOT EXISTS idx_cl_master_contract ON condition_lines(master_contract_id);
CREATE INDEX IF NOT EXISTS idx_cl_source_ip       ON condition_lines(source_ip_id);
CREATE INDEX IF NOT EXISTS idx_cl_ringi           ON condition_lines(ringi_id);
CREATE INDEX IF NOT EXISTS idx_cl_flow            ON condition_lines(flow_direction);
CREATE INDEX IF NOT EXISTS idx_cl_inbound         ON condition_lines(is_inbound) WHERE is_inbound = TRUE;

-- ---- condition_events: 検収詳細(数量/検収率) + ロイヤリティ詳細(MG/AG 消化) ----
--   balance_v を condition_events 由来の MG/AG に再定義するための器。
--   ※ 本 migration では balance_v は変更しない(2c-1 で新列が同期されてから再定義)。
ALTER TABLE condition_events
  ADD COLUMN IF NOT EXISTS inspected_quantity     DECIMAL(10,4),
  ADD COLUMN IF NOT EXISTS acceptance_ratio       DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS manufacturing_event_id INTEGER REFERENCES manufacturing_events(id),
  ADD COLUMN IF NOT EXISTS mg_consumed_this_time  DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS ag_consumed_this_time  DECIMAL(15,2);
