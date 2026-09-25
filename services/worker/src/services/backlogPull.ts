/**
 * backlogPull — Backlog を読みに行く（pull）取得ジョブ。v3 依頼受付箱 R1。
 *   設計: docs/design/v3-backlog-request-scheme.md §4 / §12 R1
 *   スキーマ: migrations/0154_request_inbox_r1.sql（backlog_pull_runs / legal_requests 拡張列 / request_events）
 *
 * 1回の実行で:
 *   1. 前回成功時の watermark（見た課題の最大 updated）− 5分 以降に更新された課題を、
 *      GET /issues を sort=updated&order=asc で 100件ずつページングして全件取得する
 *      （Backlog の updatedSince は日付単位なので 1日前の日付で取り、時刻で絞り込む）。
 *   2. 課題 ID（無ければ課題キー）で legal_requests と突き合わせ、Backlog スナップショット列を更新する。
 *      ステータスが変わっていれば request_events(kind=backlog_changed) に記録する。
 *   3. LB に無い課題は「未登録」として件数とキーを取得ログに残すだけにする。
 *      R1 は現行パイプライン（Slack/webhook 起票）が行を作るため、ここで行を作ると
 *      webhook 側が「処理済み」と判断して起票パイプラインを飛ばしてしまう。受付箱への登録は R2。
 *   4. full_reconcile は updatedSince なしで全件を見て、LB にあって Backlog に無い課題も数える。
 *
 * 同時実行は 1本まで（backlog_pull_runs の未終了行は uq_backlog_pull_running で最大1行）。
 * 失敗した回は watermark を進めないので、次の回で同じ範囲を取り直す。
 * Backlog へは書き込まない。
 *
 * query / fetchIssues のみに依存（server.ts 非依存。src/services/backlogPull.selftest.ts で検証）。
 */

export type PullTrigger = "scheduled" | "manual" | "webhook" | "full_reconcile";

export interface BacklogPullDeps {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
  /** Backlog GET /api/v2/issues（projectId は実装側で付与）。失敗時は throw すること。 */
  fetchIssues: (params: Record<string, any>) => Promise<any[]>;
  /** Backlog プロジェクトキー（full_reconcile で LB 側の対象行を絞るのに使う）。 */
  projectKey?: string;
  now?: () => Date;
}

export interface PullResult {
  ok: boolean;
  skipped?: boolean;
  run_id?: number;
  running_run_id?: number;
  trigger: PullTrigger;
  updated_since: string | null;
  watermark: string | null;
  fetched: number;
  matched: number;
  updated: number;
  unmatched: number;
  missing_in_backlog?: number;
  error?: string;
}

export const PAGE_SIZE = 100;
/** 1回あたりの上限ページ数（100件 × 300 = 30,000件）。暴走防止。 */
export const MAX_PAGES = 300;
/** watermark から巻き戻す幅（更新時刻の境界ぶれ・取りこぼし対策）。 */
export const OVERLAP_MS = 5 * 60 * 1000;
/** 初回（成功実績なし）の取得範囲。 */
export const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** これより古い未終了の実行は異常終了とみなして閉じる。 */
export const STALE_RUN_MINUTES = 15;
/** 取得ログ detail に残すキーの上限。 */
export const DETAIL_LIST_LIMIT = 200;

/** Backlog の updatedSince 用（JST の yyyy-MM-dd）。 */
export function jstDate(d: Date): string {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 課題 JSON から保存するスナップショット（原票の表示と受付時の推定に使う項目）。 */
export function toSnapshot(issue: any) {
  const pick = (u: any) => (u ? { id: u.id ?? null, name: u.name ?? null, userId: u.userId ?? null } : null);
  return {
    issueKey: issue.issueKey ?? null,
    summary: issue.summary ?? null,
    description: typeof issue.description === "string" ? issue.description.slice(0, 20000) : null,
    issueType: issue.issueType?.name ?? null,
    status: issue.status?.name ?? null,
    priority: issue.priority?.name ?? null,
    category: Array.isArray(issue.category) ? issue.category.map((c: any) => c?.name).filter(Boolean) : [],
    assignee: pick(issue.assignee),
    createdUser: pick(issue.createdUser),
    updatedUser: pick(issue.updatedUser),
    parentIssueId: issue.parentIssueId ?? null,
    dueDate: issue.dueDate ?? null,
    created: issue.created ?? null,
    updated: issue.updated ?? null,
    customFields: Array.isArray(issue.customFields)
      ? issue.customFields.map((cf: any) => ({
          id: cf?.id ?? null,
          name: cf?.name ?? null,
          value: Array.isArray(cf?.value)
            ? cf.value.map((v: any) => (v && typeof v === "object" ? v.name ?? v.id ?? null : v))
            : cf?.value && typeof cf.value === "object"
              ? cf.value.name ?? cf.value.id ?? null
              : cf?.value ?? null,
        }))
      : [],
  };
}

const toDate = (v: any): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function runBacklogPull(
  deps: BacklogPullDeps,
  opts: { trigger?: PullTrigger; startedBy?: string | null } = {}
): Promise<PullResult> {
  const { query } = deps;
  const now = deps.now || (() => new Date());
  const trigger: PullTrigger = opts.trigger || "manual";
  const full = trigger === "full_reconcile";

  // 1. 異常終了した実行を閉じる（未終了のまま残ると以後の実行が永久に止まるため）。
  await query(
    `UPDATE backlog_pull_runs
        SET finished_at = now(), error = COALESCE(error, 'stale: 終了しないまま ${STALE_RUN_MINUTES} 分を超えたため打ち切り')
      WHERE finished_at IS NULL AND started_at < now() - interval '${STALE_RUN_MINUTES} minutes'`
  );

  // 2. 取得範囲。
  let since: Date | null = null;
  let prevWatermark: Date | null = null;
  if (!full) {
    const last = await query(
      `SELECT watermark FROM backlog_pull_runs
        WHERE finished_at IS NOT NULL AND error IS NULL AND watermark IS NOT NULL
        ORDER BY id DESC LIMIT 1`
    );
    prevWatermark = toDate(last.rows[0]?.watermark);
    since = prevWatermark
      ? new Date(prevWatermark.getTime() - OVERLAP_MS)
      : new Date(now().getTime() - FIRST_RUN_LOOKBACK_MS);
  }

  const base: PullResult = {
    ok: true,
    trigger,
    updated_since: since ? since.toISOString() : null,
    watermark: null,
    fetched: 0,
    matched: 0,
    updated: 0,
    unmatched: 0,
  };

  // 3. 実行行を作る（同時実行なら skipped）。
  let runId: number;
  try {
    const ins = await query(
      `INSERT INTO backlog_pull_runs (trigger, updated_since, started_by) VALUES ($1, $2, $3) RETURNING id`,
      [trigger, since ? since.toISOString() : null, opts.startedBy || null]
    );
    runId = Number(ins.rows[0].id);
  } catch (e: any) {
    if (e?.code === "23505") {
      const running = await query(
        `SELECT id FROM backlog_pull_runs WHERE finished_at IS NULL ORDER BY id DESC LIMIT 1`
      );
      return { ...base, ok: true, skipped: true, running_run_id: running.rows[0]?.id != null ? Number(running.rows[0].id) : undefined };
    }
    throw e;
  }

  let maxUpdated: Date | null = null;
  const unmatchedList: any[] = [];
  const seenKeys = new Set<string>();
  let pages = 0;
  let fetched = 0, matched = 0, updated = 0, unmatched = 0;

  try {
    // 4. ページング取得。
    for (let offset = 0; pages < MAX_PAGES; offset += PAGE_SIZE) {
      const params: Record<string, any> = { count: PAGE_SIZE, offset, sort: "updated", order: "asc" };
      if (since) params.updatedSince = jstDate(new Date(since.getTime() - 24 * 3600 * 1000));
      const page = await deps.fetchIssues(params);
      pages++;
      if (!Array.isArray(page)) throw new Error("Backlog から課題一覧を取得できませんでした（配列以外の応答）");

      for (const issue of page) {
        const upd = toDate(issue?.updated);
        if (since && upd && upd < since) continue; // 日付単位で多めに取った分を除く
        fetched++;
        if (upd && (!maxUpdated || upd > maxUpdated)) maxUpdated = upd;
        const key = String(issue?.issueKey || "").toUpperCase();
        if (key) seenKeys.add(key);
        const r = await applyIssue(query, issue);
        if (r === "unmatched") {
          unmatched++;
          if (unmatchedList.length < DETAIL_LIST_LIMIT) {
            unmatchedList.push({
              key,
              summary: issue?.summary ?? null,
              issueType: issue?.issueType?.name ?? null,
              created: issue?.created ?? null,
              createdUser: issue?.createdUser?.name ?? null,
            });
          }
        } else {
          matched++;
          if (r === "updated") updated++;
        }
      }
      if (page.length < PAGE_SIZE) break;
    }
    if (pages >= MAX_PAGES) {
      throw new Error(`取得ページ数が上限（${MAX_PAGES}）に達しました。範囲を分けて取り直してください`);
    }

    // 5. 全件照合: LB にあって Backlog に無い課題。
    let missing: string[] = [];
    let missingCount = 0;
    if (full && deps.projectKey) {
      const lb = await query(
        `SELECT backlog_issue_key FROM legal_requests WHERE backlog_issue_key LIKE $1 ORDER BY id`,
        [`${deps.projectKey.toUpperCase()}-%`]
      );
      for (const row of lb.rows) {
        const k = String(row.backlog_issue_key || "").toUpperCase();
        if (k && !seenKeys.has(k)) {
          missingCount++;
          if (missing.length < DETAIL_LIST_LIMIT) missing.push(k);
        }
      }
    }

    // 課題が1件も無かった回は前回の watermark を引き継ぐ（巻き戻さない）。
    const watermark = maxUpdated || prevWatermark || (full ? now() : since);
    await query(
      `UPDATE backlog_pull_runs
          SET finished_at = now(), watermark = $2,
              fetched_count = $3, matched_count = $4, updated_count = $5, unmatched_count = $6,
              detail = $7
        WHERE id = $1`,
      [
        runId,
        watermark ? watermark.toISOString() : null,
        fetched, matched, updated, unmatched,
        JSON.stringify({
          pages,
          unmatched: unmatchedList,
          ...(full ? { missing_in_backlog: missing, missing_in_backlog_count: missingCount } : {}),
        }),
      ]
    );
    return {
      ...base,
      run_id: runId,
      watermark: watermark ? watermark.toISOString() : null,
      fetched, matched, updated, unmatched,
      ...(full ? { missing_in_backlog: missingCount } : {}),
    };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 2000);
    // watermark は進めない（次の回で同じ範囲を取り直す）。
    await query(
      `UPDATE backlog_pull_runs
          SET finished_at = now(), error = $2,
              fetched_count = $3, matched_count = $4, updated_count = $5, unmatched_count = $6,
              detail = $7
        WHERE id = $1`,
      [runId, msg, fetched, matched, updated, unmatched, JSON.stringify({ pages, unmatched: unmatchedList })]
    );
    return { ...base, ok: false, run_id: runId, fetched, matched, updated, unmatched, error: msg };
  }
}

/**
 * 課題1件を legal_requests に反映する。
 *   "unmatched" … LB に行が無い（R1 では作らない）
 *   "updated"   … スナップショットを更新した（初回取得・Backlog 側の更新）
 *   "unchanged" … 既に同じ updated を取得済み（last_pulled_at のみ更新）
 */
export async function applyIssue(
  query: BacklogPullDeps["query"],
  issue: any
): Promise<"unmatched" | "updated" | "unchanged"> {
  const key = String(issue?.issueKey || "").toUpperCase();
  const issueId = issue?.id != null ? Number(issue.id) : null;
  if (!key && issueId == null) return "unmatched";

  const found = await query(
    `SELECT id, backlog_issue_id, backlog_status_name, backlog_updated_at
       FROM legal_requests
      WHERE ($1::bigint IS NOT NULL AND backlog_issue_id = $1::bigint)
         OR backlog_issue_key = $2
      ORDER BY (backlog_issue_id = $1::bigint) DESC NULLS LAST, id
      LIMIT 1`,
    [issueId, key]
  );
  const row = found.rows[0];
  if (!row) return "unmatched";

  const newUpdated = toDate(issue?.updated);
  const oldUpdated = toDate(row.backlog_updated_at);
  const changed = !oldUpdated || !newUpdated || newUpdated.getTime() > oldUpdated.getTime();
  if (!changed) {
    await query(`UPDATE legal_requests SET last_pulled_at = now() WHERE id = $1`, [row.id]);
    return "unchanged";
  }

  const newStatus: string | null = issue?.status?.name ?? null;
  await query(
    `UPDATE legal_requests
        SET backlog_issue_id        = COALESCE(backlog_issue_id, $2::bigint),
            backlog_issue_type_name = $3,
            backlog_status_name     = $4,
            backlog_created_at      = $5,
            backlog_updated_at      = $6,
            backlog_snapshot        = $7,
            last_pulled_at          = now()
      WHERE id = $1`,
    [
      row.id,
      issueId,
      issue?.issueType?.name ?? null,
      newStatus,
      toDate(issue?.created)?.toISOString() ?? null,
      newUpdated?.toISOString() ?? null,
      JSON.stringify(toSnapshot(issue)),
    ]
  );

  // 取得済みの行でステータスが変わった場合だけ履歴に残す（初回取得は記録しない）。
  if (row.backlog_status_name != null && newStatus != null && row.backlog_status_name !== newStatus) {
    await query(
      `INSERT INTO request_events (request_id, kind, origin, detail)
       VALUES ($1, 'backlog_changed', 'backlog', $2)`,
      [
        row.id,
        JSON.stringify({
          field: "status",
          from: row.backlog_status_name,
          to: newStatus,
          updated: issue?.updated ?? null,
          by: issue?.updatedUser?.name ?? null,
        }),
      ]
    );
  }
  return "updated";
}
