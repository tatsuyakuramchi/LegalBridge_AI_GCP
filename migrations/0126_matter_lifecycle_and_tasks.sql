-- 0126_matter_lifecycle_and_tasks.sql
-- Phase 2「Matter・フォーム中心化」の DB スライス。
--   修正計画書 docs/plans/legalbridge-remediation-plan-20260714.md §6.1 / §6.3 / §9 Phase 2
--     ① matters へ lifecycle / owner / due / blocked / drive folder / completion 列を追加 (LB-04)
--     ② matter_tasks を新設し「現在の次アクション」を1件選定できるようにする (LB-05)
--     ③ matter_overview_v を作業中心の一覧(工程/次アクション/担当/期限/ブロッカー)へ拡張 (LB-06)
--   非破壊・追加のみ。既存列・既存VIEW列の順序は変えない(末尾追加のみ)。
--
--   status と lifecycle_stage の整合方針(Phase 0 §3 で要決定とされた点):
--     - status(open/in_progress/closed/archived) は既存 API・一覧フィルタ互換の粗い運用状態として維持。
--     - lifecycle_stage は §4 の工程(intake〜cancelled)を表す詳細状態。NULL = 未設定(既存案件)。
--     - DB トリガでの自動同期はしない(段階移行)。アプリ側で status=closed 時に
--       completed_at を自動スタンプする程度に留める。対応の目安:
--         open → intake/triage、in_progress → drafting〜completion_check、
--         closed → completed、archived → completed/cancelled

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. matters 拡張列 (§6.1)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE matters
  ADD COLUMN IF NOT EXISTS lifecycle_stage   VARCHAR(30),
  ADD COLUMN IF NOT EXISTS owner_staff_id    INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_due_date   DATE,
  ADD COLUMN IF NOT EXISTS blocked_reason    TEXT,
  ADD COLUMN IF NOT EXISTS drive_folder_id   TEXT,
  ADD COLUMN IF NOT EXISTS drive_folder_url  TEXT,
  ADD COLUMN IF NOT EXISTS completed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by      VARCHAR(120),
  ADD COLUMN IF NOT EXISTS completion_reason TEXT;

-- lifecycle_stage の許容値 (§4 Matterライフサイクル)。NULL は「未設定」。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'matters_lifecycle_stage_chk'
  ) THEN
    ALTER TABLE matters
      ADD CONSTRAINT matters_lifecycle_stage_chk CHECK (
        lifecycle_stage IS NULL OR lifecycle_stage IN (
          'intake','triage','drafting','internal_review','counterparty_review',
          'signing','performance','inspection','invoicing_payment',
          'completion_check','completed','cancelled'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_matters_lifecycle ON matters(lifecycle_stage)
  WHERE lifecycle_stage IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matters_owner ON matters(owner_staff_id)
  WHERE owner_staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matters_due ON matters(target_due_date)
  WHERE target_due_date IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. matter_tasks (§6.3) — 案件のタスク・次アクション
--    is_primary = TRUE の行が「現在の次アクション」(案件につき最大1件)。
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matter_tasks (
  id                 SERIAL PRIMARY KEY,
  matter_id          INTEGER NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  task_type          VARCHAR(40),                          -- draft / review / send / sign / inspect / invoice / pay / other 等(自由記述可)
  title              TEXT NOT NULL,
  description        TEXT,
  assignee_staff_id  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  due_at             TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  status             VARCHAR(20) NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','in_progress','done','cancelled')),
  blocked_reason     TEXT,
  source_entity_type VARCHAR(40),                          -- document / condition_line / issue 等(由来の追跡用)
  source_entity_id   TEXT,
  is_primary         BOOLEAN NOT NULL DEFAULT FALSE,
  created_by         VARCHAR(120),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_matter_tasks_matter ON matter_tasks(matter_id);
CREATE INDEX IF NOT EXISTS idx_matter_tasks_assignee ON matter_tasks(assignee_staff_id)
  WHERE assignee_staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matter_tasks_due ON matter_tasks(due_at)
  WHERE due_at IS NOT NULL AND status IN ('open','in_progress');
-- 次アクションは案件につき1件のみ(DB でも保証)。API は先に既存 primary を解除してから設定する。
CREATE UNIQUE INDEX IF NOT EXISTS uq_matter_tasks_primary ON matter_tasks(matter_id)
  WHERE is_primary;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. matter_overview_v 拡張 (LB-06)
--    既存列の順序・型は維持し、末尾に列を追加する(CREATE OR REPLACE VIEW の制約)。
--    追加: 工程 / 担当 / 期限 / ブロッカー / 完了日時 / 次アクション(primary かつ未完了のタスク) / 未完了タスク数
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
  snd.last_sent_at,
  m.lifecycle_stage,
  m.owner_staff_id,
  os.staff_name                          AS owner_name,
  m.target_due_date,
  m.blocked_reason,
  m.completed_at,
  nx.id                                  AS next_task_id,
  nx.title                               AS next_task_title,
  nx.due_at                              AS next_task_due_at,
  nx.status                              AS next_task_status,
  nx.blocked_reason                      AS next_task_blocked_reason,
  ns.staff_name                          AS next_task_assignee_name,
  COALESCE(tsk.open_task_count, 0)::int  AS open_task_count
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
) snd ON snd.matter_id = m.id
LEFT JOIN staff os ON os.id = m.owner_staff_id
LEFT JOIN matter_tasks nx
  ON nx.matter_id = m.id AND nx.is_primary AND nx.status IN ('open','in_progress')
LEFT JOIN staff ns ON ns.id = nx.assignee_staff_id
LEFT JOIN (
  SELECT matter_id, COUNT(*)::int AS open_task_count
    FROM matter_tasks WHERE status IN ('open','in_progress') GROUP BY matter_id
) tsk ON tsk.matter_id = m.id;

COMMIT;
