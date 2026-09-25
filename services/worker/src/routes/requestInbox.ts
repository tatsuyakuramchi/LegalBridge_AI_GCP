/**
 * requestInbox — v3 依頼受付箱 API（R1: Backlog 取得ジョブと取得ログ）。
 *   設計: docs/design/v3-backlog-request-scheme.md §4 / §10 / §12 R1
 *   スキーマ: migrations/0154_request_inbox_r1.sql
 *
 *   POST /api/inbox/pull            … Backlog を読みに行く。body.trigger: manual(既定) / scheduled / webhook / full_reconcile
 *                                     Cloud Scheduler から 5 分ごとに {"trigger":"scheduled"}、深夜に {"trigger":"full_reconcile"}。
 *                                     実行中なら { skipped: true, running_run_id } を返す（200）。
 *   GET  /api/inbox/pull-runs       … 取得ログ一覧（?limit=20、detail なし）
 *   GET  /api/inbox/pull-runs/:id   … 取得ログ 1 件（detail: 未登録課題・Backlog に無い課題）
 *
 * いずれも requirePortalSecret（admin-ui BFF / Cloud Scheduler の X-LB-PORTAL-SECRET）で保護する。
 * query / fetchIssues のみ依存（server.ts 非依存）。
 */
import type { Express, RequestHandler } from "express";
import express from "express";
import { runBacklogPull, type BacklogPullDeps, type PullTrigger } from "../services/backlogPull.ts";

export interface RequestInboxDeps extends BacklogPullDeps {
  requirePortalSecret?: RequestHandler;
}

const TRIGGERS: PullTrigger[] = ["manual", "scheduled", "webhook", "full_reconcile"];

export function registerRequestInbox(app: Express, deps: RequestInboxDeps) {
  const { query } = deps;
  const guard: RequestHandler = deps.requirePortalSecret || ((_req, _res, next) => next());
  const isMissingSchema = (e: any) => e && (e.code === "42P01" || e.code === "42703");
  const schemaMissing = (res: any) =>
    res.status(503).json({ ok: false, error: "依頼受付箱のテーブルがありません（migration 0154 未適用）" });
  const actorOf = (req: any): string | null =>
    (req.headers["x-user-email"] as string) ||
    (req.headers["x-lb-user-email"] as string) ||
    (req.headers["x-goog-authenticated-user-email"] as string)?.replace(/^accounts\.google\.com:/, "") ||
    null;

  app.post("/api/inbox/pull", guard, express.json({ limit: "16kb" }), async (req, res) => {
    const t = String(req.body?.trigger || "manual") as PullTrigger;
    if (!TRIGGERS.includes(t)) {
      return res.status(400).json({ ok: false, error: `trigger は ${TRIGGERS.join(" / ")} のいずれかです` });
    }
    try {
      const startedBy = actorOf(req) || (t === "manual" ? null : `system:${t}`);
      const result = await runBacklogPull(deps, { trigger: t, startedBy });
      if (!result.ok) {
        console.warn(`[inbox/pull] run ${result.run_id} failed: ${result.error}`);
        return res.status(502).json(result);
      }
      console.log(
        `[inbox/pull] ${t} run=${result.run_id ?? "-"} skipped=${!!result.skipped} ` +
          `fetched=${result.fetched} matched=${result.matched} updated=${result.updated} unmatched=${result.unmatched}`
      );
      res.json(result);
    } catch (e: any) {
      if (isMissingSchema(e)) return schemaMissing(res);
      console.error("POST /api/inbox/pull failed:", e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/api/inbox/pull-runs", guard, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    try {
      const r = await query(
        `SELECT id, trigger, updated_since, watermark, started_at, finished_at,
                fetched_count, matched_count, updated_count, created_count, unmatched_count,
                (detail->>'missing_in_backlog_count')::int AS missing_in_backlog_count,
                error, started_by
           FROM backlog_pull_runs
          ORDER BY id DESC
          LIMIT $1`,
        [limit]
      );
      const last = await query(
        `SELECT finished_at, watermark FROM backlog_pull_runs
          WHERE finished_at IS NOT NULL AND error IS NULL
          ORDER BY id DESC LIMIT 1`
      );
      res.json({ ok: true, runs: r.rows, last_success: last.rows[0] || null });
    } catch (e: any) {
      if (isMissingSchema(e)) return schemaMissing(res);
      console.error("GET /api/inbox/pull-runs failed:", e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/api/inbox/pull-runs/:id", guard, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "id が不正です" });
    try {
      const r = await query(`SELECT * FROM backlog_pull_runs WHERE id = $1`, [id]);
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "取得ログが見つかりません" });
      res.json({ ok: true, run: r.rows[0] });
    } catch (e: any) {
      if (isMissingSchema(e)) return schemaMissing(res);
      console.error("GET /api/inbox/pull-runs/:id failed:", e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
