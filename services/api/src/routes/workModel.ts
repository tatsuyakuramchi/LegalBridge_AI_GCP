// 新スキーマ(work-centric)read API。/api/v3/* 名前空間(旧 contractsV2 と非衝突)。
// 0004-0006 のテーブル + 0008-0010 backfill 済みデータを作品軸で読む。
// search-api(保守対象・D1で新プラットフォーム所有)に mount。query 注入。

import type { Express } from "express";

type Query = (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }>;

export function registerWorkModelRoutes(app: Express, deps: { query: Query }): void {
  const { query } = deps;
  const fail = (res: any, e: unknown) => res.status(500).json({ ok: false, error: String(e) });

  // ── 原作IP ───────────────────────────────────────────────
  app.get("/api/v3/source-ips", async (_req, res) => {
    try {
      const r = await query(
        `SELECT s.*, COUNT(sim.id) AS material_count
           FROM source_ips s
           LEFT JOIN source_ip_materials sim ON sim.source_ip_id = s.id
          GROUP BY s.id
          ORDER BY s.id DESC`
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  app.get("/api/v3/source-ips/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const s = await query(`SELECT * FROM source_ips WHERE id = $1`, [id]);
      if (s.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      const mats = await query(
        `SELECT * FROM source_ip_materials WHERE source_ip_id = $1 ORDER BY material_no ASC NULLS LAST, id ASC`,
        [id]
      );
      res.json({ ...s.rows[0], materials: mats.rows });
    } catch (e) { fail(res, e); }
  });

  // ── 自社作品 ─────────────────────────────────────────────
  app.get("/api/v3/works", async (_req, res) => {
    try {
      const r = await query(
        `SELECT w.*, COUNT(p.id) AS product_count
           FROM works w
           LEFT JOIN products p ON p.work_id = w.id
          GROUP BY w.id
          ORDER BY w.id DESC`
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  app.get("/api/v3/works/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const w = await query(`SELECT * FROM works WHERE id = $1`, [id]);
      if (w.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      const [products, materials, contracts, payments] = await Promise.all([
        query(`SELECT * FROM products WHERE work_id = $1 ORDER BY id`, [id]),
        // 権利台帳(work_materials)
        query(
          `SELECT wm.*, v.vendor_name AS rights_holder
             FROM work_materials wm
             LEFT JOIN vendors v ON v.id = wm.rights_holder_vendor_id
            WHERE wm.work_id = $1 ORDER BY wm.id`,
          [id]
        ),
        // 紐づく契約(contract_works 経由)
        query(
          `SELECT DISTINCT c.id, c.document_number, c.contract_title, c.contract_category,
                  c.lifecycle_stage, c.expiration_date
             FROM contract_works cw
             JOIN contracts c ON c.id = cw.contract_id
            WHERE cw.work_id = $1 ORDER BY c.id DESC`,
          [id]
        ),
        // 作品軸の支払集計(種別×方向)
        query(
          `SELECT payment_kind, direction, COALESCE(SUM(amount_jpy), 0) AS total_jpy
             FROM payments WHERE work_id = $1 GROUP BY payment_kind, direction`,
          [id]
        ),
      ]);
      res.json({
        ...w.rows[0],
        products: products.rows,
        rights: materials.rows,
        contracts: contracts.rows,
        payment_summary: payments.rows,
      });
    } catch (e) { fail(res, e); }
  });

  // ── 契約(新モデル)────────────────────────────────────────
  app.get("/api/v3/contracts", async (_req, res) => {
    try {
      const r = await query(
        `SELECT c.id, c.document_number, c.contract_level, c.contract_category, c.contract_type,
                c.contract_title, c.lifecycle_stage, c.effective_date, c.expiration_date,
                v.vendor_name AS primary_vendor,
                COALESCE((SELECT COUNT(*) FROM contract_financial_terms t WHERE t.contract_id = c.id), 0) AS term_count
           FROM contracts c
           LEFT JOIN vendors v ON v.id = c.primary_vendor_id
          ORDER BY c.id DESC`
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  app.get("/api/v3/contracts/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const c = await query(
        `SELECT c.*, v.vendor_name AS primary_vendor FROM contracts c
           LEFT JOIN vendors v ON v.id = c.primary_vendor_id WHERE c.id = $1`,
        [id]
      );
      if (c.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      const [works, parties, terms, lineItems, royalties] = await Promise.all([
        query(
          `SELECT cw.*, w.title AS work_title, s.title AS source_ip_title, p.product_name
             FROM contract_works cw
             LEFT JOIN works w ON w.id = cw.work_id
             LEFT JOIN source_ips s ON s.id = cw.source_ip_id
             LEFT JOIN products p ON p.id = cw.product_id
            WHERE cw.contract_id = $1 ORDER BY cw.id`,
          [id]
        ),
        query(
          `SELECT cp.*, v.vendor_name FROM contract_parties cp
             LEFT JOIN vendors v ON v.id = cp.vendor_id
            WHERE cp.contract_id = $1 ORDER BY cp.sort_order, cp.id`,
          [id]
        ),
        query(`SELECT * FROM contract_financial_terms WHERE contract_id = $1 ORDER BY condition_no`, [id]),
        query(`SELECT * FROM contract_line_items WHERE contract_id = $1 ORDER BY line_no`, [id]),
        query(
          `SELECT id, period, gross_royalty_ex_tax, mg_amount, mg_remaining, actual_royalty_ex_tax
             FROM royalty_statements WHERE contract_id = $1 ORDER BY period`,
          [id]
        ),
      ]);
      res.json({
        ...c.rows[0],
        works: works.rows,
        parties: parties.rows,
        financial_terms: terms.rows,
        line_items: lineItems.rows,
        royalty_statements: royalties.rows,
      });
    } catch (e) { fail(res, e); }
  });
}
