/**
 * Phase 22 (worker mirror): 課題ステータスの正規化定義
 *
 * src/lib/statusFlow.ts と内容を同期する (admin-ui frontend と共通の
 * 概念だが、TS モジュール境界の都合でファイル別)。worker 側からは
 * notifyIssueEvent のステータス表記揃え・auto-chain ロジック (Phase 22.2)
 * から利用する。
 */

export type RequestCategory =
  | "active"
  | "passive"
  | "advisory"
  | "deadline_change";

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
};

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
};

export function resolveCategory(opts: {
  request_type?: string | null;
  backlog_issue_type_name?: string | null;
}): RequestCategory {
  const rt = String(opts.request_type || "").trim();
  if (rt && REQUEST_CATEGORY[rt]) return REQUEST_CATEGORY[rt];
  const bn = String(opts.backlog_issue_type_name || "").trim();
  if (bn && BACKLOG_TYPE_TO_CATEGORY[bn]) return BACKLOG_TYPE_TO_CATEGORY[bn];
  return "active";
}

export const FLOW: Record<RequestCategory, string[]> = {
  active: [
    "未着手",
    "着手中",
    "相手方確認中",
    "承認待ち",
    "締結準備中",
    "送信待ち",
    "締結待ち",
    "完了",
  ],
  passive: [
    "トリガー待ち",
    "未着手",
    "着手中",
    "承認待ち",
    "締結準備中",
    "送信待ち",
    "完了",
  ],
  advisory: ["未着手", "着手中", "完了"],
  deadline_change: ["未着手", "完了"],
};

export const TERMINAL_OFF_FLOW = ["終結", "差戻し", "キャンセル"] as const;

export function triggerWaitLabel(
  request_type: string | null | undefined
): string {
  if (request_type === "delivery_inspec") return "納品待ち";
  if (request_type === "license_calc") return "利用許諾報告待ち";
  return "トリガー待ち";
}

export function executionPhaseLabel(
  category: RequestCategory,
  status: string
): string {
  if (status !== "締結待ち" && status !== "送信待ち") return status;
  return category === "passive" ? "送信待ち" : "締結待ち";
}

export function getNextRecommended(
  category: RequestCategory,
  currentStatus: string | null | undefined
): string | null {
  if (!currentStatus) return null;
  const flow = FLOW[category];
  if (!flow) return null;
  const idx = flow.indexOf(currentStatus);
  if (idx < 0 || idx === flow.length - 1) return null;
  return flow[idx + 1];
}

export function displayStatus(opts: {
  status: string | null | undefined;
  category: RequestCategory;
  request_type?: string | null;
}): string {
  const s = String(opts.status || "").trim();
  if (!s) return "—";
  if (s === "トリガー待ち") return triggerWaitLabel(opts.request_type);
  if (s === "締結待ち" || s === "送信待ち")
    return executionPhaseLabel(opts.category, s);
  return s;
}
