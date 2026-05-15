/**
 * Phase 22: 課題ステータスの正規化定義
 *
 * Backlog 側のステータスは 11 種類想定だが、文書種別ごとに通る経路が違う。
 * この定数で経路を hardcode で持つ (workflow_settings DB テーブルの代替)。
 *
 * 大原則:
 *   - 能動: 未着手 → 着手中 → 相手方確認中 → 承認待ち → 締結準備中 → 送信待ち → 締結待ち → 完了
 *   - 受動: トリガー待ち → 未着手 → 着手中 → 承認待ち → 締結準備中 → 送信待ち → 完了
 *   - 法務相談: 未着手 → 着手中 → 完了
 *   - 納期変更依頼: 未着手 → (法務が実行ボタン) → 完了
 *
 * 任意状態から「終結」「差戻し」「キャンセル」へ遷移可能 (= terminal exit)。
 *
 * NOTE: 本ファイルは services/worker/src/lib/statusFlow.ts と
 *       内容を同期する必要がある (手動)。
 */

export type RequestCategory =
  | "active"
  | "passive"
  | "advisory"
  | "deadline_change"

/** Slack /法務依頼 の request_type → カテゴリ */
export const REQUEST_CATEGORY: Record<string, RequestCategory> = {
  legal_consult: "advisory",
  nda: "active",
  outsourcing: "active",
  license_master: "active",
  lic_individual: "active",
  sales_master: "active",
  purchase_order: "active",
  delivery_inspec: "passive",
  license_calc: "passive",
  deadline_change: "deadline_change",
}

/**
 * Backlog 側 issue type 名 (= 既存課題 / 9 種類時代の遺産) → カテゴリ。
 * 課題が legal_requests に紐づかないケース用 fallback。
 */
const BACKLOG_TYPE_TO_CATEGORY: Record<string, RequestCategory> = {
  法務相談: "advisory",
  NDA: "active",
  業務委託基本契約: "active",
  ライセンス契約: "active",
  個別利用許諾条件: "active",
  "売買契約（当社買手）": "active",
  発注書: "active",
  納品リクエスト: "passive",
  売上報告案件: "passive",
  納期変更依頼: "deadline_change",
}

/**
 * カテゴリの解決。
 * 優先順位:
 *   1. 明示の request_type (Slack 起票のキー)
 *   2. Backlog issue type 名
 *   3. fallback "active"
 */
export function resolveCategory(opts: {
  request_type?: string | null
  backlog_issue_type_name?: string | null
}): RequestCategory {
  const rt = String(opts.request_type || "").trim()
  if (rt && REQUEST_CATEGORY[rt]) return REQUEST_CATEGORY[rt]
  const bn = String(opts.backlog_issue_type_name || "").trim()
  if (bn && BACKLOG_TYPE_TO_CATEGORY[bn]) return BACKLOG_TYPE_TO_CATEGORY[bn]
  return "active"
}

/** 標準フロー (in order) */
export const FLOW: Record<RequestCategory, string[]> = {
  active: [
    "未対応",
    "処理中",
    "相手方確認中",
    "承認待ち",
    "締結準備中",
    "送信待ち",
    "締結待ち",
    "完了",
  ],
  passive: [
    "トリガー待ち",
    "未対応",
    "処理中",
    "承認待ち",
    "締結準備中",
    "送信待ち",
    "完了",
  ],
  advisory: ["未対応", "処理中", "完了"],
  deadline_change: ["未対応", "完了"],
}

/**
 * 終了系ステータス (どこからでも遷移可能、メイン経路と独立)。
 *   - 完了        : 正常完了 (FLOW の最後にも含まれる)
 *   - 終結        : 既存課題に統合された (Phase 22 で新規)
 *   - 差戻し       : 申請内容に不備があり戻された
 *   - キャンセル   : 申請者が取り消した
 */
export const TERMINAL_OFF_FLOW = ["終結", "差戻し", "キャンセル"] as const
export type TerminalStatus = (typeof TERMINAL_OFF_FLOW)[number]

/** ステータス全部 (UI で扱う候補集合) */
export const ALL_STATUSES = [
  "トリガー待ち",
  "未対応",
  "処理中",
  "相手方確認中",
  "承認待ち",
  "締結準備中",
  "送信待ち",
  "締結待ち",
  "完了",
  "終結",
  "差戻し",
  "キャンセル",
] as const

/**
 * トリガー待ち の表示文言を文書種別で出し分け。
 * 受動 (passive) のみ意味あり。
 */
export function triggerWaitLabel(request_type: string | null | undefined): string {
  if (request_type === "delivery_inspec") return "納品待ち"
  if (request_type === "license_calc") return "利用許諾報告待ち"
  return "トリガー待ち"
}

/**
 * 締結待ち / 送信待ち の表記。
 *   - 能動: 締結待ち (相手方押印・返送待ち)
 *   - 受動: 送信待ち (担当者への引き渡し待ち)
 */
export function executionPhaseLabel(
  category: RequestCategory,
  status: string
): string {
  if (status !== "締結待ち" && status !== "送信待ち") return status
  return category === "passive" ? "送信待ち" : "締結待ち"
}

/**
 * 現在のステータスから「次の推奨ステータス」を返す。
 * パスの末尾 (= 完了) ならば null。
 */
export function getNextRecommended(
  category: RequestCategory,
  currentStatus: string | null | undefined
): string | null {
  if (!currentStatus) return null
  const flow = FLOW[category]
  if (!flow) return null
  const idx = flow.indexOf(currentStatus)
  if (idx < 0 || idx === flow.length - 1) return null
  return flow[idx + 1]
}

/** カテゴリで使う main 経路のステータス全部 */
export function visibleStatusesFor(category: RequestCategory): string[] {
  return FLOW[category] || []
}

/** 表示用ラベル変換 (UI でステータス文字列を表示するとき経由) */
export function displayStatus(opts: {
  status: string | null | undefined
  category: RequestCategory
  request_type?: string | null
}): string {
  const s = String(opts.status || "").trim()
  if (!s) return "—"
  if (s === "トリガー待ち") return triggerWaitLabel(opts.request_type)
  if (s === "締結待ち" || s === "送信待ち")
    return executionPhaseLabel(opts.category, s)
  return s
}
