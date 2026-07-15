/**
 * matters — 案件(matter)管理 API。Backlog課題・文書・条件明細を1案件で総合管理する。
 *   設計/スキーマ: migrations/0102_matter_management.sql
 *
 *   GET    /api/matters                      … 一覧（matter_overview_v + フィルタ status/q）
 *   GET    /api/matters/issue-links          … 課題キー→案件の対応表（matter_issues 全体, LB-03）
 *   POST   /api/matters                      … 案件作成（matter_code 自動採番 MTR-YYYY-NNNNN）
 *   GET    /api/matters/:id                  … 詳細（案件 + 課題 + 文書 + 条件 + 送信履歴 + タスク）
 *   PATCH  /api/matters/:id                  … 案件更新（title/status/vendor_id/counterparty/remarks/primary_issue_key
 *                                              + LB-04: lifecycle_stage/owner_staff_id/target_due_date/blocked_reason/
 *                                                drive_folder_id/drive_folder_url/completion_reason）
 *   POST   /api/matters/:id/tasks            … タスク作成（LB-05。is_primary=true で「次アクション」に指定）
 *   PATCH  /api/matters/:id/tasks/:taskId    … タスク更新（status/is_primary/担当/期限 等）
 *   DELETE /api/matters/:id/tasks/:taskId    … タスク削除
 *   DELETE /api/matters/:id                  … 案件削除（issues は CASCADE、documents.matter_id は SET NULL）
 *   POST   /api/matters/:id/issues           … Backlog課題を束ねる（relation: primary/duplicate/partial/related）
 *   DELETE /api/matters/:id/issues/:key      … 課題の束ね解除
 *   POST   /api/matters/:id/documents        … 文書を案件へ紐付け（document_id か document_number）
 *   DELETE /api/matters/:id/documents/:docId … 文書の紐付け解除
 *   GET    /api/matters/:id/sends            … 送信履歴
 *   POST   /api/matters/:id/sends            … 送信履歴を記録（channel/recipient/subject 等）
 *   POST   /api/matters/:id/absorb           … 別案件(fromMatterId)の課題/文書/送信を取り込み（重複案件の統合）
 *
 *   query インターフェースのみ依存（server.ts 非依存＝単体テスト可能）。
 */
import type { Express } from "express";
import express from "express";

export interface MatterDeps {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

const s = (v: any): string | null =>
  v == null || String(v).trim() === "" ? null : String(v).trim();
const RELATIONS = new Set(["primary", "duplicate", "partial", "related"]);
const STATUSES = new Set(["open", "in_progress", "closed", "archived"]);
// LB-04 (§4): 案件ライフサイクル工程。status(粗い運用状態)と併存し、DB同期はしない。
const LIFECYCLE_STAGES = new Set([
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
]);
// LB-05: matter_tasks.status
const TASK_STATUSES = new Set(["open", "in_progress", "done", "cancelled"]);

async function nextMatterCode(query: MatterDeps["query"]): Promise<string> {
  const year = new Date().getFullYear();
  const seq = await query(
    `INSERT INTO document_sequences (kind, year, current_value) VALUES ('matter', $1, 1)
       ON CONFLICT (kind, year) DO UPDATE SET current_value = document_sequences.current_value + 1
     RETURNING current_value`,
    [year]
  );
  return `MTR-${year}-${String(Number(seq.rows[0].current_value)).padStart(5, "0")}`;
}

export function registerMatters(app: Express, deps: MatterDeps): void {
  const { query } = deps;
  const json = express.json({ limit: "1mb" });

  // ── 一覧 ──────────────────────────────────────────────────────────────────
  app.get("/api/matters", async (req, res) => {
    try {
      const status = s(req.query.status);
      const q = s(req.query.q);
      const where: string[] = [];
      const params: any[] = [];
      if (status && STATUSES.has(status)) {
        params.push(status);
        where.push(`status = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        const p = `$${params.length}`;
        where.push(
          `(title ILIKE ${p} OR matter_code ILIKE ${p} OR counterparty ILIKE ${p} OR primary_issue_key ILIKE ${p})`
        );
      }
      const sql = `SELECT * FROM matter_overview_v
                   ${where.length ? "WHERE " + where.join(" AND ") : ""}
                   ORDER BY updated_at DESC LIMIT 500`;
      const r = await query(sql, params);
      res.json({ ok: true, matters: r.rows });
    } catch (e: any) {
      console.error("[matters] list failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── 課題→案件リンク一覧（LB-03） ────────────────────────────────────────────
  //   Requests 画面等の「この依頼は案件化済みか」判定を、matters.primary_issue_key
  //   だけでなく matter_issues 全体(primary/duplicate/partial/related)へ拡張する
  //   ための軽量マップ。同一課題が複数案件に束ねられている場合は primary を優先し、
  //   次に更新が新しい案件を返す。
  //   ※ ルート登録順に依存: /api/matters/:id より先に登録すること
  //     (後だと "issue-links" が :id にマッチして 500 になる)。
  app.get("/api/matters/issue-links", async (_req, res) => {
    try {
      const r = await query(
        `SELECT DISTINCT ON (mi.backlog_issue_key)
                mi.backlog_issue_key, mi.relation,
                m.id AS matter_id, m.matter_code, m.title
           FROM matter_issues mi
           JOIN matters m ON m.id = mi.matter_id
          ORDER BY mi.backlog_issue_key,
                   (mi.relation = 'primary') DESC,
                   m.updated_at DESC`
      );
      res.json({ ok: true, links: r.rows });
    } catch (e: any) {
      console.error("[matters] issue-links failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── 作成 ──────────────────────────────────────────────────────────────────
  app.post("/api/matters", json, async (req, res) => {
    try {
      const b = req.body || {};
      const title = s(b.title);
      if (!title) return res.status(400).json({ ok: false, error: "title は必須です" });
      const status = STATUSES.has(String(b.status)) ? String(b.status) : "open";
      const code = s(b.matter_code) || (await nextMatterCode(query));
      const r = await query(
        `INSERT INTO matters (matter_code, title, status, vendor_id, counterparty, primary_issue_key, remarks, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [code, title, status, b.vendor_id ?? null, s(b.counterparty), s(b.primary_issue_key), s(b.remarks), s(b.created_by)]
      );
      const matter = r.rows[0];
      // 代表課題が指定されていれば matter_issues にも primary として登録。
      if (matter.primary_issue_key) {
        await query(
          `INSERT INTO matter_issues (matter_id, backlog_issue_key, relation)
           VALUES ($1,$2,'primary') ON CONFLICT (matter_id, backlog_issue_key) DO NOTHING`,
          [matter.id, matter.primary_issue_key]
        );
      }
      res.json({ ok: true, matter });
    } catch (e: any) {
      console.error("[matters] create failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── 詳細（集約） ────────────────────────────────────────────────────────────
  app.get("/api/matters/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const m = await query(`SELECT * FROM matters WHERE id = $1`, [id]);
      if (!m.rows[0]) return res.status(404).json({ ok: false, error: "案件が見つかりません" });
      const [issues, documents, conditions, sends, tasks] = await Promise.all([
        query(`SELECT * FROM matter_issues WHERE matter_id = $1 ORDER BY relation, backlog_issue_key`, [id]),
        query(
          `SELECT d.id, d.document_number, d.template_type, d.contract_title, d.contract_status,
                  d.issue_key, d.backlog_issue_key, d.created_at, d.drive_link
             FROM documents d WHERE d.matter_id = $1 ORDER BY d.created_at DESC`,
          [id]
        ),
        query(
          `SELECT cl.id, cl.document_id, cl.line_no, cl.line_code, cl.legacy_role, cl.direction,
                  cl.payment_scheme, cl.rate_pct, cl.amount_ex_tax, cl.condition_name, cl.source_work_id
             FROM condition_lines cl
             JOIN documents d ON d.id = cl.document_id
            WHERE d.matter_id = $1 ORDER BY cl.document_id, cl.line_no`,
          [id]
        ),
        query(`SELECT * FROM document_sends WHERE matter_id = $1 ORDER BY sent_at DESC`, [id]),
        // LB-05: タスク(次アクション優先 → 未完了 → 期限昇順)
        query(
          `SELECT t.*, st.staff_name AS assignee_name
             FROM matter_tasks t
             LEFT JOIN staff st ON st.id = t.assignee_staff_id
            WHERE t.matter_id = $1
            ORDER BY t.is_primary DESC,
                     (t.status IN ('open','in_progress')) DESC,
                     t.due_at NULLS LAST,
                     t.id`,
          [id]
        ),
      ]);
      // 案件担当者名も返す(matters.owner_staff_id → staff)。
      let ownerName: string | null = null;
      const ownerId = m.rows[0]?.owner_staff_id;
      if (ownerId != null) {
        const o = await query(`SELECT staff_name FROM staff WHERE id = $1`, [ownerId]);
        ownerName = o.rows[0]?.staff_name ?? null;
      }
      res.json({
        ok: true,
        matter: { ...m.rows[0], owner_name: ownerName },
        issues: issues.rows,
        documents: documents.rows,
        conditions: conditions.rows,
        sends: sends.rows,
        tasks: tasks.rows,
      });
    } catch (e: any) {
      console.error("[matters] detail failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── 更新 ──────────────────────────────────────────────────────────────────
  app.patch("/api/matters/:id", json, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const sets: string[] = [];
      const params: any[] = [];
      const set = (col: string, val: any) => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (b.title !== undefined) set("title", s(b.title));
      if (b.status !== undefined && STATUSES.has(String(b.status))) set("status", String(b.status));
      if (b.vendor_id !== undefined) set("vendor_id", b.vendor_id ?? null);
      if (b.counterparty !== undefined) set("counterparty", s(b.counterparty));
      if (b.primary_issue_key !== undefined) set("primary_issue_key", s(b.primary_issue_key));
      if (b.remarks !== undefined) set("remarks", s(b.remarks));
      // LB-04 (§6.1): 工程 / 担当 / 期限 / ブロッカー / Drive フォルダ / 完了情報。
      if (b.lifecycle_stage !== undefined) {
        const stage = s(b.lifecycle_stage);
        if (stage !== null && !LIFECYCLE_STAGES.has(stage)) {
          return res.status(400).json({ ok: false, error: `lifecycle_stage が不正です: ${stage}` });
        }
        set("lifecycle_stage", stage);
      }
      if (b.owner_staff_id !== undefined) set("owner_staff_id", b.owner_staff_id ?? null);
      if (b.target_due_date !== undefined) set("target_due_date", s(b.target_due_date));
      if (b.blocked_reason !== undefined) set("blocked_reason", s(b.blocked_reason));
      if (b.drive_folder_id !== undefined) set("drive_folder_id", s(b.drive_folder_id));
      if (b.drive_folder_url !== undefined) set("drive_folder_url", s(b.drive_folder_url));
      if (b.completion_reason !== undefined) set("completion_reason", s(b.completion_reason));
      // 完了スタンプの整合(トリガ同期はせずアプリ側で最小限):
      //   status=closed または lifecycle_stage=completed へ倒すとき completed_at を自動記録。
      //   status を open/in_progress へ戻すときはクリア(再開)。
      const closing =
        (b.status !== undefined && String(b.status) === "closed") ||
        (b.lifecycle_stage !== undefined && String(b.lifecycle_stage) === "completed");
      const reopening =
        b.status !== undefined && ["open", "in_progress"].includes(String(b.status));
      if (closing) {
        sets.push(`completed_at = COALESCE(completed_at, now())`);
        if (b.completed_by !== undefined) set("completed_by", s(b.completed_by));
      } else if (reopening) {
        sets.push(`completed_at = NULL`, `completed_by = NULL`);
      }
      if (!sets.length) return res.status(400).json({ ok: false, error: "更新項目がありません" });
      params.push(id);
      const r = await query(
        `UPDATE matters SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "案件が見つかりません" });
      res.json({ ok: true, matter: r.rows[0] });
    } catch (e: any) {
      console.error("[matters] update failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── 削除 ──────────────────────────────────────────────────────────────────
  app.delete("/api/matters/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const r = await query(`DELETE FROM matters WHERE id = $1 RETURNING id`, [id]);
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "案件が見つかりません" });
      res.json({ ok: true, deleted: id });
    } catch (e: any) {
      console.error("[matters] delete failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── タスク・次アクション（LB-05, §5.4/§6.3） ─────────────────────────────────
  //   is_primary=TRUE の未完了タスクが「現在の次アクション」(案件につき最大1件。
  //   部分ユニーク索引 uq_matter_tasks_primary で DB でも保証)。
  //   primary 指定時は既存 primary を先に解除してから設定する。
  //   done/cancelled へ倒すと completed_at を記録し、primary も自動解除する
  //   (解除しないと次のタスクを次アクションに指定できない)。
  app.post("/api/matters/:id/tasks", json, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const title = s(b.title);
      if (!title) return res.status(400).json({ ok: false, error: "title は必須です" });
      const status = TASK_STATUSES.has(String(b.status)) ? String(b.status) : "open";
      const isPrimary = b.is_primary === true;
      const m = await query(`SELECT id FROM matters WHERE id = $1`, [id]);
      if (!m.rows[0]) return res.status(404).json({ ok: false, error: "案件が見つかりません" });
      if (isPrimary) {
        await query(`UPDATE matter_tasks SET is_primary = FALSE, updated_at = now()
                      WHERE matter_id = $1 AND is_primary`, [id]);
      }
      const r = await query(
        `INSERT INTO matter_tasks
           (matter_id, task_type, title, description, assignee_staff_id, due_at,
            status, blocked_reason, source_entity_type, source_entity_id, is_primary, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          id,
          s(b.task_type),
          title,
          s(b.description),
          b.assignee_staff_id ?? null,
          s(b.due_at),
          status,
          s(b.blocked_reason),
          s(b.source_entity_type),
          s(b.source_entity_id),
          isPrimary,
          s(b.created_by),
        ]
      );
      await query(`UPDATE matters SET updated_at = now() WHERE id = $1`, [id]);
      res.json({ ok: true, task: r.rows[0] });
    } catch (e: any) {
      console.error("[matters] task create failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.patch("/api/matters/:id/tasks/:taskId", json, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const taskId = Number(req.params.taskId);
      const b = req.body || {};
      const sets: string[] = [];
      const params: any[] = [];
      const set = (col: string, val: any) => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (b.title !== undefined) {
        const t = s(b.title);
        if (!t) return res.status(400).json({ ok: false, error: "title を空にはできません" });
        set("title", t);
      }
      if (b.task_type !== undefined) set("task_type", s(b.task_type));
      if (b.description !== undefined) set("description", s(b.description));
      if (b.assignee_staff_id !== undefined) set("assignee_staff_id", b.assignee_staff_id ?? null);
      if (b.due_at !== undefined) set("due_at", s(b.due_at));
      if (b.blocked_reason !== undefined) set("blocked_reason", s(b.blocked_reason));
      if (b.status !== undefined) {
        const st = String(b.status);
        if (!TASK_STATUSES.has(st)) {
          return res.status(400).json({ ok: false, error: `status が不正です: ${st}` });
        }
        set("status", st);
        if (st === "done" || st === "cancelled") {
          sets.push(`completed_at = COALESCE(completed_at, now())`, `is_primary = FALSE`);
        } else {
          sets.push(`completed_at = NULL`);
        }
      }
      if (b.is_primary === true) {
        await query(`UPDATE matter_tasks SET is_primary = FALSE, updated_at = now()
                      WHERE matter_id = $1 AND is_primary AND id <> $2`, [id, taskId]);
        sets.push(`is_primary = TRUE`);
      } else if (b.is_primary === false) {
        sets.push(`is_primary = FALSE`);
      }
      if (!sets.length) return res.status(400).json({ ok: false, error: "更新項目がありません" });
      params.push(id, taskId);
      const r = await query(
        `UPDATE matter_tasks SET ${sets.join(", ")}, updated_at = now()
          WHERE matter_id = $${params.length - 1} AND id = $${params.length}
          RETURNING *`,
        params
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "タスクが見つかりません" });
      await query(`UPDATE matters SET updated_at = now() WHERE id = $1`, [id]);
      res.json({ ok: true, task: r.rows[0] });
    } catch (e: any) {
      console.error("[matters] task update failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.delete("/api/matters/:id/tasks/:taskId", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const taskId = Number(req.params.taskId);
      const r = await query(
        `DELETE FROM matter_tasks WHERE matter_id = $1 AND id = $2 RETURNING id`,
        [id, taskId]
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "タスクが見つかりません" });
      await query(`UPDATE matters SET updated_at = now() WHERE id = $1`, [id]);
      res.json({ ok: true, deleted: taskId });
    } catch (e: any) {
      console.error("[matters] task delete failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── 課題を束ねる / 解除 ──────────────────────────────────────────────────────
  app.post("/api/matters/:id/issues", json, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const key = s(b.backlog_issue_key);
      if (!key) return res.status(400).json({ ok: false, error: "backlog_issue_key は必須です" });
      const relation = RELATIONS.has(String(b.relation)) ? String(b.relation) : "related";
      const r = await query(
        `INSERT INTO matter_issues (matter_id, backlog_issue_key, relation, summary_snapshot, note)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (matter_id, backlog_issue_key)
           DO UPDATE SET relation = EXCLUDED.relation,
                         summary_snapshot = COALESCE(EXCLUDED.summary_snapshot, matter_issues.summary_snapshot),
                         note = COALESCE(EXCLUDED.note, matter_issues.note)
         RETURNING *`,
        [id, key, relation, s(b.summary_snapshot), s(b.note)]
      );
      await query(`UPDATE matters SET updated_at = now() WHERE id = $1`, [id]);
      res.json({ ok: true, issue: r.rows[0] });
    } catch (e: any) {
      console.error("[matters] add issue failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.delete("/api/matters/:id/issues/:key", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const key = String(req.params.key);
      await query(`DELETE FROM matter_issues WHERE matter_id = $1 AND backlog_issue_key = $2`, [id, key]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── 文書の紐付け / 解除 ──────────────────────────────────────────────────────
  app.post("/api/matters/:id/documents", json, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const docId = b.document_id != null ? Number(b.document_id) : null;
      const docNum = s(b.document_number);
      const r = docId
        ? await query(`UPDATE documents SET matter_id = $1 WHERE id = $2 RETURNING id, document_number`, [id, docId])
        : docNum
          ? await query(`UPDATE documents SET matter_id = $1 WHERE document_number = $2 RETURNING id, document_number`, [id, docNum])
          : { rows: [] as any[] };
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "文書が見つかりません" });
      await query(`UPDATE matters SET updated_at = now() WHERE id = $1`, [id]);
      res.json({ ok: true, document: r.rows[0] });
    } catch (e: any) {
      console.error("[matters] attach doc failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.delete("/api/matters/:id/documents/:docId", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const docId = Number(req.params.docId);
      await query(`UPDATE documents SET matter_id = NULL WHERE id = $1 AND matter_id = $2`, [docId, id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── 送信履歴 ────────────────────────────────────────────────────────────────
  app.get("/api/matters/:id/sends", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const r = await query(`SELECT * FROM document_sends WHERE matter_id = $1 ORDER BY sent_at DESC`, [id]);
      res.json({ ok: true, sends: r.rows });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/matters/:id/sends", json, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const documentId = b.document_id != null ? Number(b.document_id) : null;
      if (!documentId) return res.status(400).json({ ok: false, error: "document_id は必須です" });
      const r = await query(
        `INSERT INTO document_sends (document_id, matter_id, channel, recipient, status, subject, body_preview, message_id, sent_by, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          documentId, id, s(b.channel) || "email", s(b.recipient), s(b.status) || "sent",
          s(b.subject), s(b.body_preview), s(b.message_id), s(b.sent_by), s(b.remarks),
        ]
      );
      await query(`UPDATE matters SET updated_at = now() WHERE id = $1`, [id]);
      res.json({ ok: true, send: r.rows[0] });
    } catch (e: any) {
      console.error("[matters] record send failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── 統合（重複案件の取り込み） ────────────────────────────────────────────────
  //   fromMatterId の 課題/文書/送信履歴 を :id へ移し、空になった from を削除する。
  app.post("/api/matters/:id/absorb", json, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const fromId = Number((req.body || {}).fromMatterId);
      if (!fromId || fromId === id) return res.status(400).json({ ok: false, error: "fromMatterId が不正です" });
      // 課題: 衝突(同一 backlog_issue_key)は from 側を捨てて id 側を残す。
      await query(
        `UPDATE matter_issues mi SET matter_id = $1
          WHERE mi.matter_id = $2
            AND NOT EXISTS (SELECT 1 FROM matter_issues x WHERE x.matter_id = $1 AND x.backlog_issue_key = mi.backlog_issue_key)`,
        [id, fromId]
      );
      await query(`UPDATE documents SET matter_id = $1 WHERE matter_id = $2`, [id, fromId]);
      await query(`UPDATE document_sends SET matter_id = $1 WHERE matter_id = $2`, [id, fromId]);
      await query(`DELETE FROM matters WHERE id = $1`, [fromId]);
      await query(`UPDATE matters SET updated_at = now() WHERE id = $1`, [id]);
      res.json({ ok: true, absorbedInto: id, removed: fromId });
    } catch (e: any) {
      console.error("[matters] absorb failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
