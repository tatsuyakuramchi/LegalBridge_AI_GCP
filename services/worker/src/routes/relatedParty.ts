/**
 * relatedParty (worker) — 関連当事者取引(RPT)の書込 API。
 *
 * GAS の RPT.gs が callWorkerApi_ 経由で叩く worker 側エンドポイント。
 * 読取は search-API 側 (services/api/src/routes/relatedPartyReads.ts) が担い、
 * ここは書込(作成/更新/無効化/起票)のみを担当する。
 *
 * パスは RPT.gs が組み立てる形に厳密一致 (worker ベースURL直下 = /api 接頭辞なし)。
 * 無効化は AIP 風カスタムメソッド (":void") のため Express では RegExp ルートで受ける。
 *
 *   POST  /rpt/entities                       … 法人 新規 (vendor_code 自動採番)
 *   PUT   /rpt/entities/:id                    … 法人 更新
 *   POST  /rpt/entities/:id:void              … 法人を RPT スコープから外す (soft)
 *   PUT   /rpt/entities/:id/shareholdings      … 株主構成 全置換
 *   PUT   /rpt/officers                        … 役員 upsert (officer_key 単位, roles 総入替)
 *   POST  /rpt/officers:void                   … 役員 soft-delete ({ officer_key })
 *   POST  /rpt/agenda                          … 議案起票 (ringi_records=board_resolution + サイドカー)
 *   PATCH /rpt/agenda/:id                      … 議案ステータス更新 ({ status })
 *
 * 認可は GAS(RPT.gs) 側 rptRequireAdmin_ で実施済み。worker は既存同様
 * アプリ層シークレット無し (Cloud Run ingress 依存)。
 */

import type { Express } from "express";
import express from "express";
import type { Pool } from "pg";

export interface RelatedPartyDeps {
  query: (text: string, params?: any[]) => Promise<any>;
  pool: Pool;
}

const RP_STATUSES = ["pending", "approved", "rejected", "deferred"];

// rp_status(pending/approved/rejected/deferred) → ringi_records.status(open/closed) ミラー
function ringiStatusFor(rpStatus: string): string {
  return rpStatus === "approved" || rpStatus === "rejected" ? "closed" : "open";
}

export function registerRelatedParty(app: Express, deps: RelatedPartyDeps) {
  const { query, pool } = deps;

  // ── 法人 新規 ───────────────────────────────────────────────────────────
  app.post("/rpt/entities", express.json(), async (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ ok: false, error: "name is required" });
    const hasBoard = !!req.body?.has_board;
    try {
      // 同名 vendor があれば RPT スコープに入れて has_board 更新 (既存マスタ流用/再追加)
      const existing = await query(
        `SELECT id FROM vendors WHERE vendor_name = $1 ORDER BY id LIMIT 1`,
        [name]
      );
      if (existing.rows.length > 0) {
        const id = existing.rows[0].id;
        await query(`UPDATE vendors SET rpt_entity = TRUE, has_board = $2 WHERE id = $1`, [id, hasBoard]);
        return res.json({ ok: true, id: String(id), reused: true });
      }
      const seq = await query(
        `SELECT COALESCE(MAX((substring(vendor_code from 5))::int), 0) + 1 AS n
           FROM vendors WHERE vendor_code ~ '^RPT-[0-9]+$'`
      );
      const vendorCode = "RPT-" + String(seq.rows[0].n).padStart(4, "0");
      const ins = await query(
        `INSERT INTO vendors (vendor_code, vendor_name, entity_type, has_board, rpt_entity)
         VALUES ($1, $2, 'corporate', $3, TRUE)
         RETURNING id`,
        [vendorCode, name, hasBoard]
      );
      res.json({ ok: true, id: String(ins.rows[0].id), vendor_code: vendorCode });
    } catch (err: any) {
      console.error("[POST /rpt/entities] error:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // ── 法人 更新 ───────────────────────────────────────────────────────────
  app.put("/rpt/entities/:id", express.json(), async (req, res) => {
    const id = Number(req.params.id);
    const name = String(req.body?.name || "").trim();
    const hasBoard = !!req.body?.has_board;
    try {
      const r = await query(
        `UPDATE vendors
            SET vendor_name = COALESCE(NULLIF($2,''), vendor_name),
                has_board   = $3,
                rpt_entity  = TRUE
          WHERE id = $1
          RETURNING id`,
        [id, name, hasBoard]
      );
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: "entity not found" });
      res.json({ ok: true, id: String(id) });
    } catch (err: any) {
      console.error("[PUT /rpt/entities/:id] error:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // ── 法人 無効化 (RPT スコープから外す soft-remove) — POST /rpt/entities/:id:void ──
  app.post(/^\/rpt\/entities\/([^/:]+):void$/, express.json(), async (req, res) => {
    const id = Number((req.params as any)[0]);
    try {
      const r = await query(`UPDATE vendors SET rpt_entity = FALSE WHERE id = $1 RETURNING id`, [id]);
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: "entity not found" });
      res.json({ ok: true, id: String(id) });
    } catch (err: any) {
      console.error("[POST /rpt/entities/:id:void] error:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // ── 株主構成 全置換 ──────────────────────────────────────────────────────
  app.put("/rpt/entities/:id/shareholdings", express.json(), async (req, res) => {
    const entityId = Number(req.params.id);
    const list = Array.isArray(req.body?.shareholdings) ? req.body.shareholdings : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM vendor_shareholdings WHERE entity_id = $1`, [entityId]);
      for (const s of list) {
        const kind = s.holder_kind === "entity" ? "entity" : "officer";
        let holderEntityId: number | null = null;
        let holderOfficerId: number | null = null;
        if (kind === "entity") {
          if (s.holder_entity_id == null) continue;
          holderEntityId = Number(s.holder_entity_id);
        } else {
          // 個人株主: holder_officer_key (= officers.officer_key) を id に解決
          if (s.holder_officer_key == null || s.holder_officer_key === "") continue;
          const o = await client.query(
            `SELECT id FROM officers WHERE officer_key = $1 LIMIT 1`,
            [String(s.holder_officer_key)]
          );
          if (o.rows.length === 0) continue;
          holderOfficerId = o.rows[0].id;
        }
        await client.query(
          `INSERT INTO vendor_shareholdings
             (entity_id, holder_kind, holder_entity_id, holder_officer_id, voting_pct)
           VALUES ($1, $2, $3, $4, $5)`,
          [entityId, kind, holderEntityId, holderOfficerId, Number(s.voting_pct) || 0]
        );
      }
      await client.query("COMMIT");
      res.json({ ok: true, entity_id: String(entityId), count: list.length });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[PUT /rpt/entities/:id/shareholdings] error:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    } finally {
      client.release();
    }
  });

  // ── 役員 upsert (officer_key 単位, roles 総入替) ─────────────────────────
  app.put("/rpt/officers", express.json(), async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const staffId = req.body?.staff_id ? String(req.body.staff_id).trim() : null;
    const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];
    if (!name) return res.status(400).json({ ok: false, error: "name is required" });
    const officerKey = staffId || name; // 社員役員=staff_id、社外役員=氏名
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const up = await client.query(
        `INSERT INTO officers (officer_key, name, staff_id, voided_at)
         VALUES ($1, $2, $3, NULL)
         ON CONFLICT (officer_key) DO UPDATE SET
           name       = EXCLUDED.name,
           staff_id   = EXCLUDED.staff_id,
           voided_at  = NULL,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [officerKey, name, staffId]
      );
      const officerId = up.rows[0].id;
      await client.query(`DELETE FROM officer_roles WHERE officer_id = $1`, [officerId]);
      for (const r of roles) {
        const entityId = r.entity_id != null ? Number(r.entity_id) : null;
        const title = String(r.title || "").trim();
        if (!entityId || !title) continue;
        await client.query(
          `INSERT INTO officer_roles (officer_id, entity_id, title, is_director)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (officer_id, entity_id, title) DO NOTHING`,
          [officerId, entityId, title, !!r.is_director]
        );
      }
      await client.query("COMMIT");
      res.json({ ok: true, officer_key: officerKey, id: String(officerId) });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[PUT /rpt/officers] error:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    } finally {
      client.release();
    }
  });

  // ── 役員 無効化 — POST /rpt/officers:void ({ officer_key }) ──────────────
  app.post(/^\/rpt\/officers:void$/, express.json(), async (req, res) => {
    const officerKey = String(req.body?.officer_key || "");
    if (!officerKey) return res.status(400).json({ ok: false, error: "officer_key is required" });
    try {
      const r = await query(
        `UPDATE officers SET voided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE officer_key = $1 AND voided_at IS NULL
          RETURNING id`,
        [officerKey]
      );
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: "officer not found" });
      res.json({ ok: true, officer_key: officerKey });
    } catch (err: any) {
      console.error("[POST /rpt/officers:void] error:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // ── 議案起票: ringi_records(board_resolution) + サイドカーを 1 トランザクションで ──
  app.post("/rpt/agenda", express.json(), async (req, res) => {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    if (!title) return res.status(400).json({ ok: false, error: "title is required" });
    const rpStatus = RP_STATUSES.includes(b.status) ? b.status : "pending";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const seq = await client.query(
        `SELECT COALESCE(MAX((substring(ringi_number from 3))::int), 0) + 1 AS n
           FROM ringi_records
          WHERE ringi_number ~ '^B-[0-9]{5}$'`
      );
      const ringiNumber = "B-" + String(seq.rows[0].n).padStart(5, "0");
      const ins = await client.query(
        `INSERT INTO ringi_records (ringi_number, decision_type, title, category, owner_name, status)
         VALUES ($1, 'board_resolution', $2, '関連当事者取引', $3, $4)
         RETURNING id, ringi_number`,
        [ringiNumber, title, b.owner_name || null, ringiStatusFor(rpStatus)]
      );
      const ringiId = ins.rows[0].id;
      await client.query(
        `INSERT INTO ringi_related_party (
           ringi_id, entity_id, meeting_date, txn_type, party_a, party_b, amount_ex_tax,
           is_conflict, is_related_party, related_category, conflict_types, excluded_officers,
           rp_status, note
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14)`,
        [
          ringiId,
          b.entity_id != null && b.entity_id !== "" ? Number(b.entity_id) : null,
          b.meeting_date || null,
          b.txn_type || null,
          b.party_a || null,
          b.party_b || null,
          b.amount_ex_tax != null ? Number(b.amount_ex_tax) : null,
          !!b.is_conflict,
          !!b.is_related_party,
          b.related_category || null,
          JSON.stringify(Array.isArray(b.conflict_types) ? b.conflict_types : []),
          JSON.stringify(Array.isArray(b.excluded_officers) ? b.excluded_officers : []),
          rpStatus,
          b.note || null,
        ]
      );
      await client.query("COMMIT");
      res.json({ ok: true, id: String(ringiId), ringi_number: ins.rows[0].ringi_number });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[POST /rpt/agenda] error:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    } finally {
      client.release();
    }
  });

  // ── 議案ステータス更新 (rp_status + ringi_records.status ミラー) ──────────
  app.patch("/rpt/agenda/:id", express.json(), async (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status || "");
    if (!RP_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: `status must be one of ${RP_STATUSES.join("/")}` });
    }
    try {
      const r = await query(
        `UPDATE ringi_related_party SET rp_status = $2, updated_at = CURRENT_TIMESTAMP
          WHERE ringi_id = $1 RETURNING ringi_id`,
        [id, status]
      );
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: "agenda not found" });
      await query(
        `UPDATE ringi_records SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id, ringiStatusFor(status)]
      );
      res.json({ ok: true, id: String(id), status });
    } catch (err: any) {
      console.error("[PATCH /rpt/agenda/:id] error:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });
}
