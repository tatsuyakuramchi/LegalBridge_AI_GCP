/**
 * matters — 案件(matter)管理 API。Backlog課題・文書・条件明細を1案件で総合管理する。
 *   設計/スキーマ: migrations/0102_matter_management.sql
 *
 *   GET    /api/matters                      … 一覧（matter_overview_v + フィルタ status/q）
 *   GET    /api/matters/issue-links          … 課題キー→案件の対応表（matter_issues 全体, LB-03）
 *   POST   /api/matters                      … 案件作成（matter_code 自動採番 MTR-YYYY-NNNNN）
 *   GET    /api/matters/:id                  … 詳細（案件 + 課題 + 文書 + 条件 + 送信履歴）
 *   PATCH  /api/matters/:id                  … 案件更新（title/status/vendor_id/counterparty/remarks/primary_issue_key）
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
      const [issues, documents, conditions, sends] = await Promise.all([
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
      ]);
      res.json({
        ok: true,
        matter: m.rows[0],
        issues: issues.rows,
        documents: documents.rows,
        conditions: conditions.rows,
        sends: sends.rows,
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
