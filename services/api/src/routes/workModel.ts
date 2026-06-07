// 新スキーマ(work-centric)read API。/api/v3/* 名前空間(旧 contractsV2 と非衝突)。
// 0004-0006 のテーブル + 0008-0010 backfill 済みデータを作品軸で読む。
// search-api(保守対象・D1で新プラットフォーム所有)に mount。query 注入。

import express from "express";
import type { Express } from "express";
import {
  importWorkModelCsv,
  getWorkModelSampleCsv,
  type V3Entity,
} from "../services/workModelImportService.ts";

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

  // ── 原作IP (P2-5: works(kind='licensed_in') を正準として読み書き) ──────
  //   応答 shape は従来の source_ips 互換(work_code→source_code 別名)。id は works.id。
  app.get("/api/v3/source-ips", ...requireRead, async (_req, res) => {
    try {
      const r = await query(
        `SELECT w.id, w.work_code AS source_code, w.title, w.title_kana, w.alternative_titles,
                w.division,
                w.rights_holder_vendor_id, w.original_publisher, w.default_rights_holder,
                w.default_credit_display, w.default_work_supplement, w.default_approval_target,
                w.default_approval_timing, w.remarks, w.is_active, w.created_at, w.updated_at,
                (SELECT COUNT(*) FROM work_materials wm WHERE wm.work_id = w.id) AS material_count
           FROM works w
          WHERE w.kind = 'licensed_in'
          ORDER BY w.id DESC`
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  app.get("/api/v3/source-ips/:id", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const s = await query(
        `SELECT w.*, w.work_code AS source_code FROM works w
          WHERE w.id = $1 AND w.kind = 'licensed_in'`,
        [id]
      );
      if (s.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      const mats = await query(
        `SELECT * FROM work_materials WHERE work_id = $1 ORDER BY id ASC`,
        [id]
      );
      res.json({ ...s.rows[0], materials: mats.rows });
    } catch (e) { fail(res, e); }
  });

  // ── 自社作品 ─────────────────────────────────────────────
  app.get("/api/v3/works", ...requireRead, async (_req, res) => {
    try {
      const r = await query(
        // Part2 移行ガード: 自社作品一覧は kind='own' のみ。
        //   backfill された原作IP(kind='licensed_in')は原作IPタブ側で扱う。
        `SELECT w.*, COUNT(p.id) AS product_count
           FROM works w
           LEFT JOIN products p ON p.work_id = w.id
          WHERE COALESCE(w.kind, 'own') = 'own'
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
          `SELECT cw.*, w.title AS work_title, w.kind AS work_kind, s.title AS source_ip_title, p.product_name
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

  // POST /api/v3/source-ips — 原作IP登録 (P2-5: works(kind='licensed_in') へ書込)
  app.post("/api/v3/source-ips", ...requireWrite, express.json(), async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.title) return res.status(400).json({ ok: false, error: "title is required" });
      const year = new Date().getFullYear();
      const code = b.source_code || `IP-${year}-${pad4(await nextMasterSeq(query, "IP", year))}`;
      const r = await query(
        `INSERT INTO works (work_code, title, title_kana, alternative_titles, division,
            is_original, kind, rights_holder_vendor_id, original_publisher, default_rights_holder,
            default_credit_display, default_work_supplement, default_approval_target,
            default_approval_timing, remarks, parent_work_id, derivation_type)
         VALUES ($1,$2,$3,COALESCE($4::text[],'{}'),COALESCE($5::text[],'{}'),FALSE,'licensed_in',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *, work_code AS source_code`,
        [code, b.title, b.title_kana ?? null, b.alternative_titles ?? null, b.division ?? null,
         b.rights_holder_vendor_id ?? null, b.original_publisher ?? null, b.default_rights_holder ?? null,
         b.default_credit_display ?? null, b.default_work_supplement ?? null, b.default_approval_target ?? null,
         b.default_approval_timing ?? null, b.remarks ?? null, b.parent_work_id ?? null, b.derivation_type ?? null]
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
      // 整理①: publisher_vendor_id / is_original は廃止(列はdefault/既存値のまま)。kind='own'。
      const r = await query(
        `INSERT INTO works (work_code, title, title_kana, alternative_titles, division,
            work_type, status, origin_ringi_id, remarks, parent_work_id, derivation_type, kind)
         VALUES ($1,$2,$3,COALESCE($4::text[],'{}'),COALESCE($5::text[],'{}'),$6,$7,$8,$9,$10,$11,'own') RETURNING *`,
        [code, b.title, b.title_kana ?? null, b.alternative_titles ?? null, b.division ?? null,
         b.work_type ?? null, b.status ?? null, b.origin_ringi_id ?? null,
         b.remarks ?? null, b.parent_work_id ?? null, b.derivation_type ?? null]
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
         VALUES ($1,$2,$3,$4,$5,$6,'registered',$7,$8,$9,COALESCE($10,FALSE),COALESCE($11::text[],'{}'))
         RETURNING *`,
        [docNo, b.contract_level ?? "standalone", b.contract_category ?? null, b.contract_type ?? null,
         b.contract_title, b.primary_vendor_id ?? null, b.lifecycle_stage ?? "requested",
         b.effective_date ?? null, b.expiration_date ?? null, b.auto_renewal ?? null, b.purpose_codes ?? null]
      );
      const contract = c.rows[0];
      const works = Array.isArray(b.works) ? b.works : [];
      for (const w of works) {
        if (w.work_id == null && w.source_ip_id == null) continue; // CHECK 制約
        // P2-3: source_ip_id しか無いときは works(legacy_source_ip_id)から work_id を補完(統一)
        await query(
          `INSERT INTO contract_works (contract_id, work_id, source_ip_id, product_id, role)
           VALUES ($1, COALESCE($2, (SELECT id FROM works WHERE legacy_source_ip_id = $3)), $3, $4, $5)`,
          [contract.id, w.work_id ?? null, w.source_ip_id ?? null, w.product_id ?? null, w.role ?? null]
        );
      }
      res.status(201).json(contract);
    } catch (e) { fail(res, e); }
  });

  // ── 更新(PUT)─────────────────────────────────────────────
  //   コード列(source_code / work_code / document_number)は不変。スカラ項目を更新。

  app.put("/api/v3/source-ips/:id", ...requireWrite, express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      if (!b.title) return res.status(400).json({ ok: false, error: "title is required" });
      const r = await query(
        // P2-5: 原作IP は works(kind='licensed_in') を更新。
        `UPDATE works SET
            title = $2, title_kana = $3, alternative_titles = COALESCE($4::text[],'{}'),
            division = COALESCE($13::text[],'{}'),
            rights_holder_vendor_id = $5, original_publisher = $6, default_rights_holder = $7,
            default_credit_display = $8, default_work_supplement = $9, default_approval_target = $10,
            default_approval_timing = $11, remarks = $12,
            parent_work_id = $14, derivation_type = $15, updated_at = now()
          WHERE id = $1 AND kind = 'licensed_in' RETURNING *, work_code AS source_code`,
        [id, b.title, b.title_kana ?? null, b.alternative_titles ?? null,
         b.rights_holder_vendor_id ?? null, b.original_publisher ?? null, b.default_rights_holder ?? null,
         b.default_credit_display ?? null, b.default_work_supplement ?? null, b.default_approval_target ?? null,
         b.default_approval_timing ?? null, b.remarks ?? null, b.division ?? null,
         b.parent_work_id ?? null, b.derivation_type ?? null]
      );
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      res.json(r.rows[0]);
    } catch (e) { fail(res, e); }
  });

  app.put("/api/v3/works/:id", ...requireWrite, express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      if (!b.title) return res.status(400).json({ ok: false, error: "title is required" });
      // 整理①: publisher_vendor_id / is_original は更新対象から除外(廃止)。
      const r = await query(
        `UPDATE works SET
            title = $2, title_kana = $3, alternative_titles = COALESCE($4::text[],'{}'),
            division = COALESCE($5::text[],'{}'), work_type = $6, status = $7,
            remarks = $8, parent_work_id = $9, derivation_type = $10, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, b.title, b.title_kana ?? null, b.alternative_titles ?? null, b.division ?? null,
         b.work_type ?? null, b.status ?? null, b.remarks ?? null,
         b.parent_work_id ?? null, b.derivation_type ?? null]
      );
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      res.json(r.rows[0]);
    } catch (e) { fail(res, e); }
  });

  app.put("/api/v3/contracts/:id", ...requireWrite, express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      if (!b.contract_title) return res.status(400).json({ ok: false, error: "contract_title is required" });
      const r = await query(
        `UPDATE contracts SET
            contract_level = $2, contract_category = $3, contract_type = $4, contract_title = $5,
            primary_vendor_id = $6, lifecycle_stage = $7, effective_date = $8, expiration_date = $9,
            auto_renewal = COALESCE($10, auto_renewal), purpose_codes = COALESCE($11::text[],'{}'), updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, b.contract_level ?? null, b.contract_category ?? null, b.contract_type ?? null, b.contract_title,
         b.primary_vendor_id ?? null, b.lifecycle_stage ?? null, b.effective_date ?? null,
         b.expiration_date ?? null, b.auto_renewal ?? null, b.purpose_codes ?? null]
      );
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      // 対象作品(contract_works)の更新。works[] が渡されたときだけ置換する
      //   (未指定のスカラ更新では既存の紐付けを壊さない)。
      if (Array.isArray(b.works)) {
        await query(`DELETE FROM contract_works WHERE contract_id = $1`, [id]);
        for (const w of b.works) {
          if (w.work_id == null && w.source_ip_id == null) continue; // CHECK 制約
          // P2-3: source_ip_id しか無いときは works(legacy_source_ip_id)から work_id を補完
          await query(
            `INSERT INTO contract_works (contract_id, work_id, source_ip_id, product_id, role)
             VALUES ($1, COALESCE($2, (SELECT id FROM works WHERE legacy_source_ip_id = $3)), $3, $4, $5)`,
            [id, w.work_id ?? null, w.source_ip_id ?? null, w.product_id ?? null, w.role ?? null]
          );
        }
      }
      res.json(r.rows[0]);
    } catch (e) { fail(res, e); }
  });

  // ── 作品の利用許諾条件(条件明細・契約レス可) ───────────────────
  //   作品(work_id) に直接ぶら下げる capability_financial_conditions を CRUD。
  //   capability_id=NULL(契約レス)、source_work_id=原作IP(works kind='licensed_in')。
  //   モデル(A): 作品 → 条件明細 → 原作IP。

  // GET: 作品の条件明細一覧(原作IPの表示名も同梱)
  app.get("/api/v3/works/:id/conditions", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(
        `SELECT cfc.*, sw.title AS source_work_title, sw.work_code AS source_work_code,
                sm.material_name AS source_material_name
           FROM capability_financial_conditions cfc
           LEFT JOIN works sw ON sw.id = cfc.source_work_id
           LEFT JOIN work_materials sm ON sm.id = cfc.source_material_id
          WHERE cfc.work_id = $1
          ORDER BY cfc.condition_no ASC, cfc.id ASC`,
        [id]
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // POST: 作品に条件明細を追加(契約レス)
  app.post("/api/v3/works/:id/conditions", ...requireWrite, express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      // condition_no 未指定なら max+1
      let condNo = Number(b.condition_no);
      if (!Number.isFinite(condNo) || condNo <= 0) {
        const m = await query(
          `SELECT COALESCE(MAX(condition_no), 0) + 1 AS n
             FROM capability_financial_conditions WHERE work_id = $1`,
          [id]
        );
        condNo = Number(m.rows[0]?.n) || 1;
      }
      const r = await query(
        `INSERT INTO capability_financial_conditions (
           work_id, capability_id, source_work_id, source_material_id, condition_no,
           region_language_label, calc_method, rate_pct, base_price_label,
           calc_period, calc_period_kind, calc_period_close_month, currency,
           formula_text, payment_terms, mg_amount, ag_amount
         ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        [
          id, b.source_work_id ?? null, b.source_material_id ?? null, condNo,
          b.region_language_label ?? null, b.calc_method ?? "ROYALTY",
          b.rate_pct ?? null, b.base_price_label ?? null,
          b.calc_period ?? null, b.calc_period_kind ?? null,
          b.calc_period_close_month ?? null, b.currency ?? "JPY",
          b.formula_text ?? null, b.payment_terms ?? null,
          Number(b.mg_amount) || 0, Number(b.ag_amount) || 0,
        ]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) { fail(res, e); }
  });

  // PUT: 条件明細を更新(契約レス条件 = work_id 紐付き想定)
  app.put("/api/v3/work-conditions/:cid", ...requireWrite, express.json(), async (req, res) => {
    try {
      const cid = Number(req.params.cid);
      if (!Number.isFinite(cid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      const r = await query(
        `UPDATE capability_financial_conditions SET
            source_work_id = $2, region_language_label = $3, calc_method = $4,
            rate_pct = $5, base_price_label = $6, calc_period = $7,
            calc_period_kind = $8, calc_period_close_month = $9, currency = $10,
            formula_text = $11, payment_terms = $12, mg_amount = $13, ag_amount = $14,
            condition_no = COALESCE($15, condition_no), source_material_id = $16, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [
          cid, b.source_work_id ?? null, b.region_language_label ?? null,
          b.calc_method ?? "ROYALTY", b.rate_pct ?? null, b.base_price_label ?? null,
          b.calc_period ?? null, b.calc_period_kind ?? null, b.calc_period_close_month ?? null,
          b.currency ?? "JPY", b.formula_text ?? null, b.payment_terms ?? null,
          Number(b.mg_amount) || 0, Number(b.ag_amount) || 0,
          b.condition_no ?? null, b.source_material_id ?? null,
        ]
      );
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      res.json(r.rows[0]);
    } catch (e) { fail(res, e); }
  });

  // DELETE: 条件明細を削除
  app.delete("/api/v3/work-conditions/:cid", ...requireWrite, async (req, res) => {
    try {
      const cid = Number(req.params.cid);
      if (!Number.isFinite(cid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(
        `DELETE FROM capability_financial_conditions WHERE id = $1`,
        [cid]
      );
      res.json({ ok: true, deleted: r.rowCount || 0 });
    } catch (e) { fail(res, e); }
  });

  // ── 作品のマテリアル(翻訳/イラスト/原作素材…) ────────────────────
  //   モデル(あ): work_materials を中心に、帰属(rights_type)で
  //     相手方(license/joint) → license_condition_id(利用許諾条件明細)
  //     当社(owned/copyright_assignment) → service_line_item_id(業務委託明細)
  //   へ繋ぐ。
  app.get("/api/v3/works/:id/materials", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(
        `SELECT wm.*, v.vendor_name AS rights_holder_name,
                c.condition_no AS license_condition_no,
                sli.item_name AS service_line_name,
                sli.amount_ex_tax AS service_line_amount,
                scc.document_number AS service_doc_number,
                COALESCE(sli.status_flags->>'inspection_issued','') = 'true' AS service_inspection_issued,
                COALESCE(sli_dli.inspected_amount, 0) AS service_inspected_amount,
                CASE
                  WHEN sli.id IS NULL THEN NULL
                  WHEN COALESCE(sli_dli.inspected_amount,0) <= 0 THEN 'pending'
                  WHEN COALESCE(sli.amount_ex_tax,0) > 0
                       AND COALESCE(sli_dli.inspected_amount,0) >= COALESCE(sli.amount_ex_tax,0) THEN 'accepted'
                  ELSE 'partial'
                END AS service_inspection_status
           FROM work_materials wm
           LEFT JOIN vendors v ON v.id = wm.rights_holder_vendor_id
           LEFT JOIN capability_financial_conditions c ON c.id = wm.license_condition_id
           LEFT JOIN capability_line_items sli ON sli.id = wm.service_line_item_id
           LEFT JOIN contract_capabilities scc ON scc.id = sli.capability_id
           LEFT JOIN LATERAL (
             SELECT SUM(d.inspected_amount_ex_tax) AS inspected_amount
               FROM delivery_line_items d
              WHERE d.capability_line_item_id = sli.id
           ) sli_dli ON TRUE
          WHERE wm.work_id = $1
          ORDER BY wm.id ASC`,
        [id]
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  app.post("/api/v3/works/:id/materials", ...requireWrite, express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      const r = await query(
        `INSERT INTO work_materials (
           work_id, material_name, material_type, rights_type, rights_holder_vendor_id,
           rights_holder_label, is_royalty_bearing, license_condition_id, service_line_item_id,
           scope, remarks
         ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,FALSE),$8,$9,$10,$11) RETURNING *`,
        [
          id, b.material_name ?? null, b.material_type ?? null, b.rights_type ?? null,
          b.rights_holder_vendor_id ?? null, b.rights_holder_label ?? null,
          b.is_royalty_bearing ?? null, b.license_condition_id ?? null,
          b.service_line_item_id ?? null, b.scope ?? null, b.remarks ?? null,
        ]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) { fail(res, e); }
  });

  app.put("/api/v3/work-materials/:mid", ...requireWrite, express.json(), async (req, res) => {
    try {
      const mid = Number(req.params.mid);
      if (!Number.isFinite(mid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      const r = await query(
        `UPDATE work_materials SET
            material_name = $2, material_type = $3, rights_type = $4,
            rights_holder_vendor_id = $5, rights_holder_label = $6,
            is_royalty_bearing = COALESCE($7,FALSE), license_condition_id = $8,
            service_line_item_id = $9, scope = $10, remarks = $11, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [
          mid, b.material_name ?? null, b.material_type ?? null, b.rights_type ?? null,
          b.rights_holder_vendor_id ?? null, b.rights_holder_label ?? null,
          b.is_royalty_bearing ?? null, b.license_condition_id ?? null,
          b.service_line_item_id ?? null, b.scope ?? null, b.remarks ?? null,
        ]
      );
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      res.json(r.rows[0]);
    } catch (e) { fail(res, e); }
  });

  app.delete("/api/v3/work-materials/:mid", ...requireWrite, async (req, res) => {
    try {
      const mid = Number(req.params.mid);
      if (!Number.isFinite(mid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(`DELETE FROM work_materials WHERE id = $1`, [mid]);
      res.json({ ok: true, deleted: r.rowCount || 0 });
    } catch (e) { fail(res, e); }
  });

  // 業務委託明細(capability_line_items)の候補検索 — 当社帰属マテリアルの紐付け用。
  //   発注書(purchase_order) または fee_type='production'(制作対価) の明細を対象。
  app.get("/api/v3/service-line-items", ...requireRead, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const params: any[] = [];
      let where = `(cc.record_type = 'purchase_order' OR cli.fee_type = 'production')`;
      if (q) {
        params.push(`%${q}%`);
        where += ` AND (cli.item_name ILIKE $1 OR cc.document_number ILIKE $1 OR v.vendor_name ILIKE $1)`;
      }
      const r = await query(
        `SELECT cli.id, cli.item_name, cli.amount_ex_tax, cli.work_id,
                cc.document_number, cc.contract_title, v.vendor_name,
                COALESCE(cli.status_flags->>'inspection_issued','') = 'true' AS inspection_issued,
                COALESCE(dli.inspected_amount, 0) AS inspected_amount,
                CASE
                  WHEN COALESCE(dli.inspected_amount,0) <= 0 THEN 'pending'
                  WHEN COALESCE(cli.amount_ex_tax,0) > 0
                       AND COALESCE(dli.inspected_amount,0) >= COALESCE(cli.amount_ex_tax,0) THEN 'accepted'
                  ELSE 'partial'
                END AS inspection_status
           FROM capability_line_items cli
           JOIN contract_capabilities cc ON cc.id = cli.capability_id
           LEFT JOIN vendors v ON v.id = cc.vendor_id
           LEFT JOIN LATERAL (
             SELECT SUM(d.inspected_amount_ex_tax) AS inspected_amount
               FROM delivery_line_items d
              WHERE d.capability_line_item_id = cli.id
           ) dli ON TRUE
          WHERE ${where}
          ORDER BY cli.id DESC
          LIMIT 50`,
        params
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // ── CSV 一括取込 ───────────────────────────────────────────
  //   POST /api/v3/import/:entity  body: { csv, dry_run, duplicate_mode }
  //   GET  /api/v3/import/:entity/template.csv
  const ENTITIES = new Set<V3Entity>(["source-ips", "works", "contracts"]);

  app.post("/api/v3/import/:entity", ...requireWrite, express.json({ limit: "12mb" }), async (req, res) => {
    try {
      const entity = req.params.entity as V3Entity;
      if (!ENTITIES.has(entity)) return res.status(400).json({ ok: false, error: "unknown entity" });
      const b = req.body || {};
      const csv = String(b.csv || "");
      if (!csv.trim()) return res.status(400).json({ ok: false, error: "csv is required" });
      const out = await importWorkModelCsv(query, entity, csv, {
        dry_run: !!b.dry_run,
        duplicate_mode: b.duplicate_mode,
      });
      res.json({ ok: true, ...out });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/v3/import/:entity/template.csv", ...requireRead, (req, res) => {
    const entity = req.params.entity as V3Entity;
    if (!ENTITIES.has(entity)) return res.status(400).json({ ok: false, error: "unknown entity" });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${entity}-template.csv"`);
    res.send(getWorkModelSampleCsv(entity));
  });
}
