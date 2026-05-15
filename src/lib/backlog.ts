/**
 * Backlog API ヘルパー (Phase 18 — Manual Workflow)
 *
 * Admin UI から Backlog のステータスを手動で進めるためのフロント
 * エンドユーティリティ。すべての書き込みは worker (`WRITE_URL`)
 * 経由で行う (apiRouter が PATCH 系を WRITE_URL に飛ばす)。
 */

export type BacklogStatus = {
  id: number;
  name: string;
  color?: string;
  projectId?: number;
  displayOrder?: number;
};

export type BacklogIssueRef = {
  issueKey: string;
  status?: { id?: number; name?: string };
};

/**
 * Backlog Issue のステータスを変更する。
 *
 * worker の `PATCH /api/backlog/issues/:key/status` を叩く。
 * 成功時は Backlog API が返した issue オブジェクトを返す。
 *
 * @throws fetch 4xx/5xx 時は Error をスロー (caller で toast 表示する想定)
 */
export async function updateIssueStatus(
  issueKey: string,
  statusId: number
): Promise<any> {
  const res = await fetch(
    `/api/backlog/issues/${encodeURIComponent(issueKey)}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusId }),
    }
  );
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error ? `: ${j.error}` : "";
    } catch {
      /* body は text のことも */
    }
    throw new Error(`HTTP ${res.status}${detail}`);
  }
  return res.json().catch(() => ({}));
}

/**
 * workflow_settings から「この issue type の推奨次ステータス ID」を取得する。
 *
 * worker の `GET /api/master/workflow-settings?issue_type_name=...` を叩く。
 * 設定が無いケースは null を返す (= 推奨無し)。
 */
export async function getRecommendedNextStatus(
  issueTypeName: string
): Promise<number | null> {
  if (!issueTypeName) return null;
  try {
    const url =
      `/api/master/workflow-settings?issue_type_name=` +
      encodeURIComponent(issueTypeName);
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data) return null;
    // 想定レスポンス: { issue_type_name, next_status_id } または配列
    if (Array.isArray(data)) {
      const hit = data.find(
        (d) =>
          d?.issue_type_name === issueTypeName && d?.next_status_id != null
      );
      return hit?.next_status_id != null ? Number(hit.next_status_id) : null;
    }
    return data?.next_status_id != null ? Number(data.next_status_id) : null;
  } catch (e) {
    console.warn("getRecommendedNextStatus failed:", e);
    return null;
  }
}
