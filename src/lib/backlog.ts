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

export type OrderLineItem = {
  line_item_id: number
  order_item_id: number
  line_no: number
  item_name: string | null
  spec?: string | null
  unit_price?: number | string | null
  quantity?: number | string | null
  amount_ex_tax?: number | string | null
  delivery_date: string | null
  last_alert_at?: string | null
  alert_count?: number | null
  accepted: boolean
}

/**
 * 指定 Backlog 課題に紐づく業務明細 (order_line_items) を取得する。
 * 並び順は line_no 昇順。
 */
export async function getIssueLineItems(
  issueKey: string
): Promise<OrderLineItem[]> {
  const res = await fetch(
    `/api/management/issues/${encodeURIComponent(issueKey)}/line-items`
  )
  if (!res.ok) {
    let detail = ""
    try {
      const j = await res.json()
      detail = j?.error ? `: ${j.error}` : ""
    } catch {
      /* noop */
    }
    throw new Error(`HTTP ${res.status}${detail}`)
  }
  const data = await res.json()
  return (data?.line_items as OrderLineItem[]) || []
}

/**
 * 業務明細 (order_line_items.delivery_date) の納期を変更する。
 *
 * worker の `PATCH /api/management/order-line-items/:id/deadline` を叩く。
 * worker 側で:
 *   - DB の delivery_date 更新 + last_alert_at リセット
 *   - Backlog 課題にコメントで変更履歴を追加 (Q3=a)
 *   - 申請者 + 部署チャンネルに Slack 通知
 *
 * @param lineItemId   対象の order_line_items.id
 * @param newDate      新しい納期 (Date or "YYYY-MM-DD" 文字列)
 * @param reason       変更理由 (任意、Backlog コメントに含まれる)
 */
export async function updateLineItemDeadline(
  lineItemId: number,
  newDate: string | Date,
  reason?: string
): Promise<{
  ok: true
  line_item_id: number
  line_no: number
  item_name: string
  backlog_issue_key: string
  previous_date: string | null
  new_date: string
  backlog_commented: boolean
}> {
  const dateStr =
    newDate instanceof Date ? newDate.toISOString().slice(0, 10) : String(newDate)
  const body: Record<string, string> = { delivery_date: dateStr }
  if (reason) body.reason = reason
  const res = await fetch(
    `/api/management/order-line-items/${lineItemId}/deadline`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) {
    let detail = ""
    try {
      const j = await res.json()
      detail = j?.error ? `: ${j.error}` : ""
    } catch {
      /* noop */
    }
    throw new Error(`HTTP ${res.status}${detail}`)
  }
  return res.json()
}

/**
 * @deprecated Phase 20a 時点の delivery_events ベース。
 * 業務明細毎に納期を持つべき → updateLineItemDeadline を使ってください。
 */
export async function updateDeliveryDeadline(
  issueKey: string,
  newDeadline: string | Date
): Promise<{
  ok: true
  id: number
  backlog_issue_key: string
  previous_deadline: string | null
  new_deadline: string
  backlog_synced: boolean
}> {
  const iso =
    newDeadline instanceof Date
      ? newDeadline.toISOString()
      : String(newDeadline)
  const res = await fetch(
    `/api/management/issues/${encodeURIComponent(issueKey)}/deadline`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inspection_deadline: iso }),
    }
  )
  if (!res.ok) {
    let detail = ""
    try {
      const j = await res.json()
      detail = j?.error ? `: ${j.error}` : ""
    } catch {
      /* noop */
    }
    throw new Error(`HTTP ${res.status}${detail}`)
  }
  return res.json()
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
