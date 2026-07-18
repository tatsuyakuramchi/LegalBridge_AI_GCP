/**
 * dataQualityClient — データ完全性 API(worker /api/data-quality/*)の薄いクライアント(DQ-04)。
 *
 * 重要: worker(DQ-01/02)が未デプロイの環境でも admin-ui を壊さないため、
 *   取得系は失敗を握りつぶして null / [] を返す(Badge/Panel は「表示しない」で degrade)。
 */
import { apiGet, apiSend } from "./httpClient";

export type DqStatus = "ok" | "warning" | "error" | "blocker" | "unknown";

export type DqSummary = {
  entity_type: string;
  entity_id: number;
  identity_status: DqStatus;
  relationship_status: DqStatus;
  contract_status: DqStatus;
  financial_status: DqStatus;
  evidence_status: DqStatus;
  blocker_count: number;
  error_count: number;
  warning_count: number;
  score: number;
  evaluated_at: string | null;
};

export type DqIssue = {
  id: number;
  entity_type: string;
  entity_id: number;
  rule_code: string;
  severity: "BLOCKER" | "ERROR" | "WARNING" | "INFO";
  status: "open" | "resolved" | "waived";
  rule_title: string;
  remediation_type: string | null;
  stage: string | null;
  due_at?: string | null;
  assignee_staff_id?: number | null;
  detected_at?: string | null;
  last_detected_at?: string | null;
  resolution_note?: string | null;
  // 修正導線用: worker が解決した親 work_id / 条件の line_code(条件明細詳細への直リンク)。
  resolved_work_id?: number | null;
  condition_line_code?: string | null;
};

export type DqIssueFilters = {
  status?: string; // 既定 open。"all" で全件。
  entity_type?: string;
  severity?: string;
  assignee_staff_id?: number;
};

export type DqEntityResult = { summary: DqSummary; open_issues: DqIssue[] };

/** エンティティの完全性サマリー + 未解消 Issue。失敗時は null(未デプロイ環境で degrade)。 */
export async function getEntityCompleteness(
  entityType: string,
  entityId: number | string
): Promise<DqEntityResult | null> {
  try {
    const r = await apiGet<{ ok: boolean; summary: DqSummary; open_issues: DqIssue[] }>(
      `/api/data-quality/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(String(entityId))}/summary`
    );
    if (!r || r.ok === false || !r.summary) return null;
    return { summary: r.summary, open_issues: r.open_issues || [] };
  } catch {
    return null;
  }
}

/** 作品の完全性(entity_type='work')。 */
export function getWorkCompleteness(workId: number | string): Promise<DqEntityResult | null> {
  return getEntityCompleteness("work", workId);
}

/** Issue 一覧。失敗(未デプロイ等)時は null、成功で配列(0 件は [])。 */
export async function getIssues(filters: DqIssueFilters = {}): Promise<DqIssue[] | null> {
  try {
    const qs = new URLSearchParams();
    if (filters.status) qs.set("status", filters.status);
    if (filters.entity_type) qs.set("entity_type", filters.entity_type);
    if (filters.severity) qs.set("severity", filters.severity);
    if (filters.assignee_staff_id != null) qs.set("assignee_staff_id", String(filters.assignee_staff_id));
    const r = await apiGet<{ ok: boolean; issues: DqIssue[] }>(`/api/data-quality/issues?${qs.toString()}`);
    if (!r || r.ok === false) return null;
    return r.issues || [];
  } catch {
    return null;
  }
}

/** Issue の 担当/期限/メモ 更新。失敗時は null。 */
export async function patchIssue(
  id: number,
  body: { assignee_staff_id?: number | null; due_at?: string | null; resolution_note?: string | null }
): Promise<DqIssue | null> {
  try {
    const r = await apiSend<{ ok: boolean; issue: DqIssue }>("PATCH", `/api/data-quality/issues/${id}`, body);
    return r?.issue || null;
  } catch {
    return null;
  }
}

/** Issue を waive(例外)。失敗時は null。 */
export async function waiveIssue(id: number, note: string): Promise<DqIssue | null> {
  try {
    const r = await apiSend<{ ok: boolean; issue: DqIssue }>("POST", `/api/data-quality/issues/${id}/waive`, {
      resolution_note: note,
    });
    return r?.issue || null;
  } catch {
    return null;
  }
}

/** 全件再評価 + サマリー再計算。失敗時は null。 */
export async function rescanDataQuality(): Promise<{ evaluated: number } | null> {
  try {
    return await apiSend<{ ok: boolean; evaluated: number }>("POST", "/api/data-quality/rescan", {});
  } catch {
    return null;
  }
}
