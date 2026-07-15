/**
 * matterStages — 案件ライフサイクル工程(LB-04, 計画 §4)の共有定義。
 *   DB: matters.lifecycle_stage (migration 0126, CHECK 制約と同値)。
 *   status(open/in_progress/closed/archived) は粗い運用状態として併存し、
 *   工程はこの詳細ステージで管理する(DB 同期はしない)。
 */
export const MATTER_STAGES = [
  "intake",
  "triage",
  "drafting",
  "internal_review",
  "counterparty_review",
  "signing",
  "performance",
  "inspection",
  "invoicing_payment",
  "completion_check",
  "completed",
  "cancelled",
] as const

export type MatterStage = (typeof MATTER_STAGES)[number]

export const STAGE_LABEL: Record<string, string> = {
  intake: "受付",
  triage: "振分け",
  drafting: "起案",
  internal_review: "社内レビュー",
  counterparty_review: "相手方調整",
  signing: "署名・締結",
  performance: "履行",
  inspection: "検収",
  invoicing_payment: "請求・支払",
  completion_check: "完了確認",
  completed: "完了",
  cancelled: "中止",
}

export const stageLabel = (stage: string | null | undefined): string =>
  stage ? STAGE_LABEL[stage] || stage : "—"

// matter_tasks.status (LB-05)
export const TASK_STATUS_LABEL: Record<string, string> = {
  open: "未着手",
  in_progress: "進行中",
  done: "完了",
  cancelled: "取消",
}
