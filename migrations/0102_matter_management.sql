-- 0102_matter_management.sql
-- 案件(matter)管理レイヤー: Backlog課題・文書・条件明細を1つの「案件」で総合管理する。
--   目的:
--     ① 重複/部分発生した Backlog 課題を1案件に束ねる（matter_issues.relation）
--     ② 文書の送信を履歴として残す（document_sends。既存の単発 email_* を1行へ移送）
--     ③ 条件明細を案件配下で総合管理（documents.matter_id 経由でロールアップ）
--   非破壊・追加のみ。既存テーブルは documents に matter_id 列を足すだけ。

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. matters（案件マスタ）
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matters (
  id                SERIAL PRIMARY KEY,
  matter_code       VARCHAR(40) UNIQUE,                 -- MTR-YYYY-NNNNN（採番はアプリ側）
  title             TEXT NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'open',-- open / in_progress / closed / archived
  vendor_id         INTEGER REFERENCES vendors(id),
  counterparty      TEXT,                               -- 相手方（スナップショット/自由記述）
  primary_issue_key VARCHAR(50),                        -- 代表 Backlog 課題キー
  remarks           TEXT,
  created_by        VARCHAR(120),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_matters_status ON matters(status);
CREATE INDEX IF NOT EXISTS idx_matters_vendor ON matters(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matters_primary_issue ON matters(primary_issue_key) WHERE primary_issue_key IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. matter_issues（案件 ⇄ Backlog課題。重複/部分発生の束ね）
--    relation: primary(代表) / duplicate(重複) / partial(部分発生) / related(関連)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matter_issues (
  id                SERIAL PRIMARY KEY,
  matter_id         INTEGER NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  backlog_issue_key VARCHAR(50) NOT NULL,
  relation          VARCHAR(20) NOT NULL DEFAULT 'related',
  summary_snapshot  TEXT,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (matter_id, backlog_issue_key)
);
CREATE INDEX IF NOT EXISTS idx_matter_issues_matter ON matter_issues(matter_id);
CREATE INDEX IF NOT EXISTS idx_matter_issues_key    ON matter_issues(backlog_issue_key);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. documents.matter_id（文書 → 案件。条件明細は document_id 経由でロールアップ）
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS matter_id INTEGER REFERENCES matters(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_documents_matter ON documents(matter_id) WHERE matter_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. document_sends（文書送信履歴。複数回・チャネル別）
--    既存の documents.email_* は「最後の送信」のみ。ここに履歴として全件残す。
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_sends (
  id           SERIAL PRIMARY KEY,
  document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  matter_id    INTEGER REFERENCES matters(id) ON DELETE SET NULL,  -- 非正規化（案件横断履歴の高速化）
  channel      VARCHAR(20) NOT NULL DEFAULT 'email',               -- email / slack / drive / manual
  recipient    TEXT,                                               -- 宛先(メール/チャネル)
  status       VARCHAR(20) NOT NULL DEFAULT 'sent',                -- sent / failed / queued
  subject      TEXT,
  body_preview TEXT,
  message_id   TEXT,
  error        TEXT,
  sent_by      VARCHAR(120),
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  remarks      TEXT
);
CREATE INDEX IF NOT EXISTS idx_docsends_document ON document_sends(document_id);
CREATE INDEX IF NOT EXISTS idx_docsends_matter   ON document_sends(matter_id) WHERE matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docsends_sent_at  ON document_sends(sent_at);

-- 既存の email 送信実績を履歴へ1行バックフィル（重複登録を避け、未登録のものだけ）。
INSERT INTO document_sends (document_id, channel, recipient, status, message_id, sent_at)
SELECT d.id, 'email', d.email_to, 'sent', d.email_message_id, d.email_sent_at
  FROM documents d
 WHERE d.email_sent_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM document_sends s
      WHERE s.document_id = d.id AND s.channel = 'email' AND s.sent_at = d.email_sent_at
   );

-- ───────────────────────────────────────────────────────────────────────────
-- 5. matter_overview_v（案件サマリ。UI 一覧用）
--    案件ごとに 課題数 / 文書数 / 条件明細数 / 最終送信日時 を集計。
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW matter_overview_v AS
SELECT
  m.id,
  m.matter_code,
  m.title,
  m.status,
  m.vendor_id,
  m.counterparty,
  m.primary_issue_key,
  m.created_at,
  m.updated_at,
  COALESCE(iss.issue_count, 0)::int      AS issue_count,
  COALESCE(doc.document_count, 0)::int   AS document_count,
  COALESCE(doc.condition_count, 0)::int  AS condition_count,
  snd.last_sent_at
FROM matters m
LEFT JOIN (
  SELECT matter_id, COUNT(*)::int AS issue_count
    FROM matter_issues GROUP BY matter_id
) iss ON iss.matter_id = m.id
LEFT JOIN (
  SELECT d.matter_id,
         COUNT(DISTINCT d.id)::int  AS document_count,
         COUNT(cl.id)::int          AS condition_count
    FROM documents d
    LEFT JOIN condition_lines cl ON cl.document_id = d.id
   WHERE d.matter_id IS NOT NULL
   GROUP BY d.matter_id
) doc ON doc.matter_id = m.id
LEFT JOIN (
  SELECT matter_id, MAX(sent_at) AS last_sent_at
    FROM document_sends WHERE matter_id IS NOT NULL GROUP BY matter_id
) snd ON snd.matter_id = m.id;

COMMIT;
