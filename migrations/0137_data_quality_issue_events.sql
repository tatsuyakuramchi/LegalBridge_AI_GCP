-- 0137_data_quality_issue_events.sql
-- DQ-09: データ品質 Issue の監査ログ。担当割当・期限設定・メモ・waive・状態遷移を
--   「誰が・いつ・何を」で永続記録する。additive・冪等・可逆(DROP TABLE で戻せる)。
--   actor は worker が受け取る x-user-email(IAP 由来)。無い場合は NULL(=不明/system)。

CREATE TABLE IF NOT EXISTS data_quality_issue_events (
  id          BIGSERIAL PRIMARY KEY,
  issue_id    BIGINT NOT NULL REFERENCES data_quality_issues (id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,           -- update / waive / resolve / reopen 等
  actor       TEXT,                     -- 操作者(x-user-email)。NULL=不明/system。
  detail      JSONB,                    -- 変更内容(担当/期限/メモ 等の差分)
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dq_issue_events_issue
  ON data_quality_issue_events (issue_id, created_at DESC);
