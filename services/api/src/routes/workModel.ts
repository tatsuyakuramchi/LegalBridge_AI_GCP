// 新スキーマ(work-centric)read API。/api/v3/* 名前空間(旧 contractsV2 と非衝突)。
// 0004-0006 のテーブル + 0008-0010 backfill 済みデータを作品軸で読む。
// search-api(保守対象・D1で新プラットフォーム所有)に mount。query 注入。

import express from "express";
import type { Express } from "express";

type Query = (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }>;
type Middleware = (req: any, res: any, next: any) => void;

// Search 専用採番(master_sequences)。kind×year で原子的にインクリメント。
async function nextMasterSeq(query: Query, kind: string, year: number): Promise<number> {
  const r = await query(
    `INSERT INTO master_sequences (kind, year, current_value) VALUES ($1, $2, 1)
       ON CONFLICT (kind, year) DO UPDATE SET current_value = master_sequences.current_value + 1
     RETURNING current_value`,
    [kind, year]
  );
  return r.rows[0].current_value as number;
}
const pad4 = (n: number) => String(n).padStart(4, "0");

export function registerWorkModelRoutes(
  app: Express,
  deps: { query: Query; requireWrite: Middleware[]; requireRead?: Middleware[] }
): void {
  const { query, requireWrite } = deps;
  // B1: read も Search 流の認証で固める(既定は無印=後方互換)。
  const requireRead = deps.requireRead ?? [];
  const fail = (res: any, e: unknown) => res.status(500).json({ ok: false, error: String(e) });

  // ── 原作IP ───────────────────────────────────────────────
  app.get("/api/v3/source-ips", ...requireRead, async (_req, res) => {
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

  app.get("/api/v3/source-ips/:id", ...requireRead, async (req, res) => {
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
  app.get("/api/v3/works", ...requireRead, async (_req, res) => {
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

  app.get("/api/v3/works/:id", ...requireRead, async (req, res) => {
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
  app.get("/api/v3/contracts", ...requireRead, async (_req, res) => {
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

  app.get("/api/v3/contracts/:id", ...requireRead, async (req, res) => {
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

  // ── 書込(D1: Search がマスター/新プラットフォームを所有)─────────────
  //   IAP + admin ロール(requireWrite)。採番は master_sequences(worker と番号空間分離)。

  // POST /api/v3/source-ips — 原作IP登録
  app.post("/api/v3/source-ips", ...requireWrite, express.json(), async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.title) return res.status(400).json({ ok: false, error: "title is required" });
      const year = new Date().getFullYear();
      const code = b.source_code || `IP-${year}-${pad4(await nextMasterSeq(query, "IP", year))}`;
      const r = await query(
        `INSERT INTO source_ips (source_code, title, title_kana, alternative_titles,
            rights_holder_vendor_id, original_publisher, default_rights_holder,
            default_credit_display, default_work_supplement, default_approval_target,
            default_approval_timing, remarks)
         VALUES ($1,$2,$3,COALESCE($4,'{}'),$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [code, b.title, b.title_kana ?? null, b.alternative_titles ?? null,
         b.rights_holder_vendor_id ?? null, b.original_publisher ?? null, b.default_rights_holder ?? null,
         b.default_credit_display ?? null, b.default_work_supplement ?? null, b.default_approval_target ?? null,
         b.default_approval_timing ?? null, b.remarks ?? null]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) { fail(res, e); }
  });

  // POST /api/v3/works — 自社作品登録
  app.post("/api/v3/works", ...requireWrite, express.json(), async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.title) return res.status(400).json({ ok: false, error: "title is required" });
      const year = new Date().getFullYear();
      const code = b.work_code || `W-${year}-${pad4(await nextMasterSeq(query, "W", year))}`;
      const r = await query(
        `INSERT INTO works (work_code, title, title_kana, alternative_titles, division,
            work_type, status, publisher_vendor_id, origin_ringi_id, is_original, remarks)
         VALUES ($1,$2,$3,COALESCE($4,'{}'),COALESCE($5,'{}'),$6,$7,$8,$9,COALESCE($10,TRUE),$11) RETURNING *`,
        [code, b.title, b.title_kana ?? null, b.alternative_titles ?? null, b.division ?? null,
         b.work_type ?? null, b.status ?? null, b.publisher_vendor_id ?? null, b.origin_ringi_id ?? null,
         b.is_original ?? null, b.remarks ?? null]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) { fail(res, e); }
  });

  // POST /api/v3/contracts — 契約登録(origin='registered'、master_sequences 採番)
  //   body.works[] = [{ work_id?, source_ip_id?, product_id?, role? }] を contract_works へ。
  app.post("/api/v3/contracts", ...requireWrite, express.json(), async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.contract_title) return res.status(400).json({ ok: false, error: "contract_title is required" });
      const year = new Date().getFullYear();
      const docNo = b.document_number || `ARC-REG-${year}-${pad4(await nextMasterSeq(query, "REG", year))}`;
      const c = await query(
        `INSERT INTO contracts (document_number, contract_level, contract_category, contract_type,
            contract_title, primary_vendor_id, origin, lifecycle_stage, effective_date, expiration_date,
            auto_renewal, purpose_codes)
         VALUES ($1,$2,$3,$4,$5,$6,'registered',$7,$8,$9,COALESCE($10,FALSE),COALESCE($11,'{}'))
         RETURNING *`,
        [docNo, b.contract_level ?? "standalone", b.contract_category ?? null, b.contract_type ?? null,
         b.contract_title, b.primary_vendor_id ?? null, b.lifecycle_stage ?? "requested",
         b.effective_date ?? null, b.expiration_date ?? null, b.auto_renewal ?? null, b.purpose_codes ?? null]
      );
      const contract = c.rows[0];
      const works = Array.isArray(b.works) ? b.works : [];
      for (const w of works) {
        if (w.work_id == null && w.source_ip_id == null) continue; // CHECK 制約
        await query(
          `INSERT INTO contract_works (contract_id, work_id, source_ip_id, product_id, role)
           VALUES ($1,$2,$3,$4,$5)`,
          [contract.id, w.work_id ?? null, w.source_ip_id ?? null, w.product_id ?? null, w.role ?? null]
        );
      }
      res.status(201).json(contract);
    } catch (e) { fail(res, e); }
  });
}
