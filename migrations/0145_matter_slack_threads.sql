-- 0145_matter_slack_threads.sql
-- 案件×Slack 連携: 案件ごとに「法務相談」チャンネルへ立てたスレッドを記録する。
--   案件詳細の「法務相談スレッド」ボタンでルート投稿を作成し、その (channel_id, thread_ts) を保存。
--   以降のメッセージ送信・会話取得(conversations.replies)はこの thread_ts に紐づく。
--   1 案件 = 1 スレッド(UNIQUE matter_id)。additive・冪等・可逆。
--   ロールバック: DROP TABLE matter_slack_threads;

CREATE TABLE IF NOT EXISTS matter_slack_threads (
  id          BIGSERIAL PRIMARY KEY,
  matter_id   INTEGER NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  channel_id  TEXT NOT NULL,
  thread_ts   TEXT NOT NULL,
  root_text   TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (matter_id)
);

CREATE INDEX IF NOT EXISTS idx_matter_slack_threads_matter ON matter_slack_threads(matter_id);
