/**
 * Data Quality API(設計 v1.4 DQ-02 / §14.4)。
 *   POST  /api/data-quality/rescan                       … 全件再評価 + サマリー再計算
 *   GET   /api/data-quality/rules                         … ルール台帳
 *   GET   /api/data-quality/issues                        … Issue 一覧(entity_type/entity_id/status/severity で絞込)
 *   GET   /api/data-quality/entities/:type/:id/summary    … エンティティ別 完全性サマリー
 *   PATCH /api/data-quality/issues/:id                    … 担当/期限/メモ の更新
 *   POST  /api/data-quality/issues/:id/waive              … 例外(waive)
 *
 * 実体ロジックは src/services/dataQualityService.ts(db.query のみ依存)。
 */
import type { Express, RequestHandler } from "express";
import express from "express";
import { rescan, evaluateEntity } from "../services/dataQualityService.ts";

export interface DataQualityDeps {
  query: (text: string, params?: any[]) => Promise<any>;
  requirePortalSecret?: RequestHandler;
}

export function registerDataQualityRoutes(app: Express, deps: DataQualityDeps) {
  const db = { query: deps.query };
  const guard: RequestHandler = deps.requirePortalSecret || ((_req, _res, next) => next());
  const jsonBody = express.json({ limit: "256kb" });

  // DQ-09 監査ログ: Issue への操作を data_quality_issue_events に記録する。
  //   actor は IAP 由来の x-user-email(無ければ NULL=不明)。記録失敗は本処理を止めない。
  const actorOf = (req: any): string | null =>
    (req.headers["x-user-email"] as string) || (req.headers["x-lb-user-email"] as string) || null;
  const logEvent = async (
    issueId: number,
    eventType: string,
    actor: string | null,
    detail?: any,
    note?: string | null
  ) => {
    try {
      await db.query(
        `INSERT INTO data_quality_issue_events (issue_id, event_type, actor, detail, note)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [issueId, eventType, actor, detail != null ? JSON.stringify(detail) : null, note || null]
      );
    } catch {
      /* 監査ログの失敗は握りつぶす(本処理を優先) */
    }
  };

  // 全件再評価 + サマリー再計算。
  app.post("/api/data-quality/rescan", guard, async (_req, res) => {
    try {
      const out = await rescan(db);
      res.json({ ok: true, ...out });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 単一エンティティの差分評価(DQ 自動発火 §8.4)。保存後に該当1件だけ再評価する。
  app.post("/api/data-quality/entities/:type/:id/evaluate", guard, async (req, res) => {
    try {
      const type = String(req.params.type);
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const out = await evaluateEntity(db, type, id);
      res.json({ ok: true, ...out });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ルール台帳。
  app.get("/api/data-quality/rules", guard, async (_req, res) => {
    try {
      const r = await db.query(
        `SELECT rule_code, entity_type, stage, severity, remediation_type, title, description, is_active
           FROM data_quality_rules ORDER BY rule_code`
      );
      res.json({ ok: true, rules: r.rows });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Issue 一覧。既定は open のみ。ルール台帳を join して title/remediation/stage を返す。
  app.get("/api/data-quality/issues", guard, async (req, res) => {
    try {
      const where: string[] = [];
      const params: any[] = [];
      const push = (cond: string, val: any) => { params.push(val); where.push(cond.replace("$?", `$${params.length}`)); };
      const status = String(req.query.status || "open");
      if (status !== "all") push("i.status = $?", status);
      if (req.query.entity_type) push("i.entity_type = $?", String(req.query.entity_type));
      if (req.query.entity_id) push("i.entity_id = $?", Number(req.query.entity_id));
      if (req.query.severity) push("i.severity = $?", String(req.query.severity));
      if (req.query.assignee_staff_id) push("i.assignee_staff_id = $?", Number(req.query.assignee_staff_id));
      const limit = Math.min(Number(req.query.limit) || 500, 2000);
      // 修正導線(admin-ui)のため、条件/素材 issue に「親 work_id」と条件の line_code を解決して載せる。
      //   condition → condition_lines(work_id, line_code) / material → work_materials(work_id)。
      //   work は entity_id 自身。これで DataQualityCenter の「修正」を実画面へ接続できる。
      const sql = `
        SELECT i.id, i.entity_type, i.entity_id, i.rule_code, i.severity, i.status,
               i.detected_at, i.last_detected_at, i.resolved_at, i.assignee_staff_id,
               i.due_at, i.resolution_type, i.resolution_note, i.detail,
               r.title AS rule_title, r.remediation_type, r.stage,
               CASE i.entity_type
                 WHEN 'work' THEN i.entity_id
                 WHEN 'condition' THEN cl.work_id
                 WHEN 'material' THEN wm.work_id
               END AS resolved_work_id,
               cl.line_code AS condition_line_code
          FROM data_quality_issues i
          JOIN data_quality_rules r ON r.rule_code = i.rule_code
          LEFT JOIN condition_lines cl ON i.entity_type = 'condition' AND cl.id = i.entity_id
          LEFT JOIN work_materials wm ON i.entity_type = 'material' AND wm.id = i.entity_id
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY CASE i.severity WHEN 'BLOCKER' THEN 0 WHEN 'ERROR' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
                  i.last_detected_at DESC
         LIMIT ${limit}`;
      const r = await db.query(sql, params);
      res.json({ ok: true, issues: r.rows });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // エンティティ別 完全性サマリー(無ければ既定=満点扱いで返す)。
  app.get("/api/data-quality/entities/:type/:id/summary", guard, async (req, res) => {
    try {
      const type = String(req.params.type);
      const id = Number(req.params.id);
      const r = await db.query(
        `SELECT * FROM entity_completeness_summary WHERE entity_type = $1 AND entity_id = $2`,
        [type, id]
      );
      const summary = r.rows[0] || {
        entity_type: type, entity_id: id,
        identity_status: "unknown", relationship_status: "unknown", contract_status: "unknown",
        financial_status: "unknown", evidence_status: "unknown",
        blocker_count: 0, error_count: 0, warning_count: 0, score: 0, evaluated_at: null,
      };
      const issues = await db.query(
        `SELECT i.rule_code, i.severity, i.status, r.title AS rule_title, r.remediation_type, r.stage
           FROM data_quality_issues i JOIN data_quality_rules r ON r.rule_code = i.rule_code
          WHERE i.entity_type = $1 AND i.entity_id = $2 AND i.status = 'open'
          ORDER BY CASE i.severity WHEN 'BLOCKER' THEN 0 WHEN 'ERROR' THEN 1 ELSE 2 END`,
        [type, id]
      );
      res.json({ ok: true, summary, open_issues: issues.rows });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Issue の 担当/期限/メモ 更新。
  app.patch("/api/data-quality/issues/:id", guard, jsonBody, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const sets: string[] = [];
      const params: any[] = [];
      const set = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };
      if ("assignee_staff_id" in b) set("assignee_staff_id", b.assignee_staff_id === null ? null : Number(b.assignee_staff_id));
      if ("due_at" in b) set("due_at", b.due_at || null);
      if ("resolution_note" in b) set("resolution_note", b.resolution_note || null);
      if (!sets.length) return res.status(400).json({ ok: false, error: "no updatable fields" });
      params.push(id);
      const r = await db.query(
        `UPDATE data_quality_issues SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not found" });
      await logEvent(id, "update", actorOf(req), b, b.resolution_note ?? null);
      res.json({ ok: true, issue: r.rows[0] });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Issue を waive(例外)。再評価では再オープンしない(サービス側で status<>'waived' を尊重)。
  app.post("/api/data-quality/issues/:id/waive", guard, jsonBody, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const note = String((req.body || {}).resolution_note || "");
      const r = await db.query(
        `UPDATE data_quality_issues
            SET status = 'waived', resolution_type = 'waived', resolution_note = $2, resolved_at = now()
          WHERE id = $1 RETURNING *`,
        [id, note || null]
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not found" });
      await logEvent(id, "waive", actorOf(req), null, note || null);
      res.json({ ok: true, issue: r.rows[0] });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // DQ-09 監査ログ: Issue の操作履歴(誰が/いつ/何を)。
  app.get("/api/data-quality/issues/:id/events", guard, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const r = await db.query(
        `SELECT id, event_type, actor, detail, note, created_at
           FROM data_quality_issue_events
          WHERE issue_id = $1
          ORDER BY created_at DESC
          LIMIT 100`,
        [id]
      );
      res.json({ ok: true, events: r.rows });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
