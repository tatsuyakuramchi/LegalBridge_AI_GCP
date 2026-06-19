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

  // 統合Phase3c: 3カード統合エディタ用の権利フロー(グラフ)を返す。
  //   中=この作品(own) / 右=原作・素材調達(支払エッジ) / 左=受取(受取エッジ)。
  app.get("/api/v3/works/:id/graph", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const w = await query(`SELECT * FROM works WHERE id = $1`, [id]);
      if (w.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      const edgeCols = `cl.id, cl.line_code, cl.subject, cl.transaction_kind, cl.direction,
                        cl.payment_scheme, cl.amount_ex_tax, cl.rate_pct, cl.mg_amount,
                        cc.document_number, cc.contract_title,
                        v.vendor_name AS counterparty`;
      const [products, materials, upstream, downstream] = await Promise.all([
        query(`SELECT * FROM products WHERE work_id = $1 ORDER BY id`, [id]),
        query(
          `SELECT wm.*, v.vendor_name AS rights_holder
             FROM work_materials wm LEFT JOIN vendors v ON v.id = wm.rights_holder_vendor_id
            WHERE wm.work_id = $1 ORDER BY wm.material_no NULLS LAST, wm.id`,
          [id]
        ),
        // 右=原作/素材調達(支払エッジ: ライセンスイン原作 / 委託素材)
        query(
          `SELECT ${edgeCols},
                  sw.work_code AS source_work_code, sw.title AS source_work_title,
                  wm.material_code AS source_material_code, wm.material_name AS source_material_name
             FROM condition_lines cl
             LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
             LEFT JOIN works sw ON sw.id = cl.source_work_id
             LEFT JOIN work_materials wm ON wm.id = cl.source_material_id
             LEFT JOIN vendors v ON v.id = cl.counterparty_vendor_id
            WHERE cl.work_id = $1 AND cl.direction = 'payable'
            ORDER BY cl.id`,
          [id]
        ),
        // 左=受取(受取エッジ: ライセンスアウト派生物 / 物販アウト)
        query(
          `SELECT ${edgeCols},
                  p.product_code, p.product_name
             FROM condition_lines cl
             LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
             LEFT JOIN products p ON p.id = cl.product_id
             LEFT JOIN vendors v ON v.id = cl.counterparty_vendor_id
            WHERE cl.work_id = $1 AND cl.direction = 'receivable'
            ORDER BY cl.id`,
          [id]
        ),
      ]);
      res.json({
        work: w.rows[0],
        products: products.rows,
        materials: materials.rows,
        upstream: upstream.rows,
        downstream: downstream.rows,
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
      // 方向(condition_kind): 明示が無ければ所有 work の kind から既定化。
      //   原作IP(licensed_in) → 利用許諾(license_in) / 自社作品(own) → サブライセンス(sublicense_out)。
      let condKind = b.condition_kind ?? null;
      if (!condKind) {
        const wk = await query(`SELECT kind FROM works WHERE id = $1`, [id]);
        condKind = wk.rows[0]?.kind === "licensed_in" ? "license_in" : "sublicense_out";
      }
      const r = await query(
        `INSERT INTO capability_financial_conditions (
           work_id, capability_id, source_work_id, source_material_id, condition_no,
           region_language_label, calc_method, rate_pct, base_price_label,
           calc_period, calc_period_kind, calc_period_close_month, currency,
           formula_text, payment_terms, mg_amount, ag_amount, condition_kind,
           counterparty_vendor_id, basis, unit_price, cycle, billing_day,
           term_start, term_end, advance_amount, forecast_amount,
           condition_name, calc_type, fixed_kind, subscription_cycle, unit_amount, guarantee_type
         ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
           $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
         RETURNING *`,
        [
          id, b.source_work_id ?? null, b.source_material_id ?? null, condNo,
          b.region_language_label ?? null, b.calc_method ?? "ROYALTY",
          b.rate_pct ?? null, b.base_price_label ?? null,
          b.calc_period ?? null, b.calc_period_kind ?? null,
          b.calc_period_close_month ?? null, b.currency ?? "JPY",
          b.formula_text ?? null, b.payment_terms ?? null,
          Number(b.mg_amount) || 0, Number(b.ag_amount) || 0, condKind,
          b.counterparty_vendor_id ?? null, b.basis ?? null,
          b.unit_price ?? null, b.cycle ?? null, b.billing_day ?? null,
          b.term_start ?? null, b.term_end ?? null,
          b.advance_amount ?? null, b.forecast_amount ?? null,
          // 0045: 金銭条件の柔軟化フィールド
          b.condition_name ?? null, b.calc_type ?? null, b.fixed_kind ?? null,
          b.subscription_cycle ?? null,
          b.unit_amount != null && b.unit_amount !== "" ? Number(b.unit_amount) : null,
          b.guarantee_type ?? null,
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
            condition_no = COALESCE($15, condition_no), source_material_id = $16,
            condition_kind = COALESCE($17, condition_kind),
            counterparty_vendor_id = $18, basis = $19, unit_price = $20, cycle = $21,
            billing_day = $22, term_start = $23, term_end = $24,
            advance_amount = $25, forecast_amount = $26,
            condition_name = $27, calc_type = $28, fixed_kind = $29,
            subscription_cycle = $30, unit_amount = $31, guarantee_type = $32,
            updated_at = now()
          WHERE id = $1 RETURNING *`,
        [
          cid, b.source_work_id ?? null, b.region_language_label ?? null,
          b.calc_method ?? "ROYALTY", b.rate_pct ?? null, b.base_price_label ?? null,
          b.calc_period ?? null, b.calc_period_kind ?? null, b.calc_period_close_month ?? null,
          b.currency ?? "JPY", b.formula_text ?? null, b.payment_terms ?? null,
          Number(b.mg_amount) || 0, Number(b.ag_amount) || 0,
          b.condition_no ?? null, b.source_material_id ?? null, b.condition_kind ?? null,
          b.counterparty_vendor_id ?? null, b.basis ?? null, b.unit_price ?? null,
          b.cycle ?? null, b.billing_day ?? null, b.term_start ?? null, b.term_end ?? null,
          b.advance_amount ?? null, b.forecast_amount ?? null,
          // 0045: 金銭条件の柔軟化フィールド
          b.condition_name ?? null, b.calc_type ?? null, b.fixed_kind ?? null,
          b.subscription_cycle ?? null,
          b.unit_amount != null && b.unit_amount !== "" ? Number(b.unit_amount) : null,
          b.guarantee_type ?? null,
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

  // ── サブライセンス受領記録(condition_receipts) ───────────────────
  //   サブライセンス条件明細(OUT) → 受領記録(計算のみ・文書発行なし)。
  //   royalty = basis='manufacturing' ? 報告数量×単価×料率 : 報告売上×料率。
  //   サーバ側で computed_royalty_ex_tax を算出して保存(フロントの計算と二重化)。
  const computeRoyalty = (cond: any, rep: { reported_sales?: any; reported_quantity?: any }) => {
    const rate = Number(cond?.rate_pct) || 0;
    let base = 0;
    if (cond?.basis === "manufacturing") {
      base = (Number(rep.reported_quantity) || 0) * (Number(cond?.unit_price) || 0);
    } else {
      base = Number(rep.reported_sales) || 0;
    }
    return Math.round(base * (rate / 100) * 100) / 100;
  };

  // 受領記録 → 入金台帳(payments: inbound / sublicense_income)同期。
  //   received_amount があれば payments を upsert し payment_id を保持。空なら削除。
  //   cond は { work_id, counterparty_vendor_id, currency }。receipt は condition_receipts 行。
  const syncReceiptPayment = async (receipt: any, cond: any): Promise<number | null> => {
    const recv = receipt.received_amount;
    const hasRecv = recv != null && Number(recv) !== 0;
    if (hasRecv) {
      if (receipt.payment_id) {
        await query(
          `UPDATE payments SET amount_ex_tax = $2, total_amount = $2, paid_date = $3,
                  period = $4, counterparty_vendor_id = $5, currency = $6
             WHERE id = $1`,
          [receipt.payment_id, recv, receipt.received_date ?? null, receipt.period ?? null,
            cond.counterparty_vendor_id ?? null, cond.currency || "JPY"]
        );
        return receipt.payment_id;
      }
      const p = await query(
        `INSERT INTO payments (
           payment_no, direction, payment_kind, work_id, counterparty_vendor_id,
           period, amount_ex_tax, total_amount, currency, status, paid_date, source_document_number
         ) VALUES ($1, 'inbound', 'sublicense_income', $2, $3, $4, $5, $5, $6, 'received', $7, $8)
         RETURNING id`,
        [`SLRCV-${receipt.id}`, cond.work_id ?? null, cond.counterparty_vendor_id ?? null,
          receipt.period ?? null, recv, cond.currency || "JPY",
          receipt.received_date ?? null, `condition_receipt#${receipt.id}`]
      );
      const pid = Number(p.rows[0].id);
      await query(`UPDATE condition_receipts SET payment_id = $2 WHERE id = $1`, [receipt.id, pid]);
      return pid;
    }
    if (receipt.payment_id) {
      await query(`DELETE FROM payments WHERE id = $1`, [receipt.payment_id]);
      await query(`UPDATE condition_receipts SET payment_id = NULL WHERE id = $1`, [receipt.id]);
    }
    return null;
  };

  // GET: 作品配下の OUT 条件 × 受領記録 を一覧(条件情報を同梱)
  app.get("/api/v3/works/:id/receipts", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(
        `SELECT cr.*, cfc.condition_no, cfc.region_language_label, cfc.rate_pct,
                cfc.basis, cfc.unit_price, cfc.currency, cfc.counterparty_vendor_id,
                v.vendor_name AS counterparty_name
           FROM condition_receipts cr
           JOIN capability_financial_conditions cfc ON cfc.id = cr.condition_id
           LEFT JOIN vendors v ON v.id = cfc.counterparty_vendor_id
          WHERE cfc.work_id = $1 AND cfc.condition_kind = 'sublicense_out'
          ORDER BY cr.condition_id ASC, cr.period_date ASC NULLS LAST, cr.id ASC`,
        [id]
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // GET: 条件単位の受領記録
  app.get("/api/v3/work-conditions/:cid/receipts", ...requireRead, async (req, res) => {
    try {
      const cid = Number(req.params.cid);
      if (!Number.isFinite(cid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(
        `SELECT * FROM condition_receipts WHERE condition_id = $1
          ORDER BY period_date ASC NULLS LAST, id ASC`,
        [cid]
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // POST: 受領記録を追加(計算込み)
  app.post("/api/v3/work-conditions/:cid/receipts", ...requireWrite, express.json(), async (req, res) => {
    try {
      const cid = Number(req.params.cid);
      if (!Number.isFinite(cid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      const c = await query(
        `SELECT work_id, counterparty_vendor_id, currency, rate_pct, basis, unit_price
           FROM capability_financial_conditions WHERE id = $1`,
        [cid]
      );
      if (c.rows.length === 0) return res.status(404).json({ ok: false, error: "condition not found" });
      const royalty = computeRoyalty(c.rows[0], b);
      const r = await query(
        `INSERT INTO condition_receipts (
           condition_id, period, period_date, reported_sales, reported_quantity,
           computed_royalty_ex_tax, received_amount, received_date, status, note
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          cid, b.period ?? null, b.period_date ?? null,
          b.reported_sales ?? null, b.reported_quantity ?? null, royalty,
          b.received_amount ?? null, b.received_date ?? null,
          b.received_amount != null ? "received" : "reported", b.note ?? null,
        ]
      );
      const receipt = r.rows[0];
      receipt.payment_id = await syncReceiptPayment(receipt, c.rows[0]);
      res.status(201).json(receipt);
    } catch (e) { fail(res, e); }
  });

  // PUT: 受領記録を更新(再計算)
  app.put("/api/v3/condition-receipts/:rid", ...requireWrite, express.json(), async (req, res) => {
    try {
      const rid = Number(req.params.rid);
      if (!Number.isFinite(rid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      const cur = await query(
        `SELECT cr.condition_id, cfc.work_id, cfc.counterparty_vendor_id, cfc.currency,
                cfc.rate_pct, cfc.basis, cfc.unit_price
           FROM condition_receipts cr
           JOIN capability_financial_conditions cfc ON cfc.id = cr.condition_id
          WHERE cr.id = $1`,
        [rid]
      );
      if (cur.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      const royalty = computeRoyalty(cur.rows[0], b);
      const r = await query(
        `UPDATE condition_receipts SET
            period = $2, period_date = $3, reported_sales = $4, reported_quantity = $5,
            computed_royalty_ex_tax = $6, received_amount = $7, received_date = $8,
            status = $9, note = $10, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [
          rid, b.period ?? null, b.period_date ?? null,
          b.reported_sales ?? null, b.reported_quantity ?? null, royalty,
          b.received_amount ?? null, b.received_date ?? null,
          b.received_amount != null ? "received" : "reported", b.note ?? null,
        ]
      );
      const receipt = r.rows[0];
      receipt.payment_id = await syncReceiptPayment(receipt, cur.rows[0]);
      res.json(receipt);
    } catch (e) { fail(res, e); }
  });

  // DELETE: 受領記録を削除
  app.delete("/api/v3/condition-receipts/:rid", ...requireWrite, async (req, res) => {
    try {
      const rid = Number(req.params.rid);
      if (!Number.isFinite(rid)) return res.status(400).json({ ok: false, error: "invalid id" });
      // 紐づく入金台帳(payments)も掃除してから削除。
      const pr = await query(`SELECT payment_id FROM condition_receipts WHERE id = $1`, [rid]);
      const pid = pr.rows[0]?.payment_id;
      const r = await query(`DELETE FROM condition_receipts WHERE id = $1`, [rid]);
      if (pid) await query(`DELETE FROM payments WHERE id = $1`, [pid]);
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
      // 統合: 取得経路を推定(明示指定が無ければ rights_type / 発注書紐付けから)。
      const acq =
        b.acquisition_type ??
        (b.service_line_item_id ? "buyout_commission" : b.rights_type === "license" ? "license" : "in_house");
      // material_no / material_code({work_code}-NNN) を採番して挿入。
      const r = await query(
        `INSERT INTO work_materials (
           work_id, material_name, material_type, rights_type, rights_holder_vendor_id,
           rights_holder_label, is_royalty_bearing, license_condition_id, service_line_item_id,
           scope, remarks, acquisition_type, material_no, material_code, is_default
         )
         SELECT $1,$2,$3,$4,$5,$6,COALESCE($7,FALSE),$8,$9,$10,$11,$12,
                nextno.n,
                w.work_code || '-' || lpad(nextno.n::text, 3, '0'),
                FALSE
           FROM works w
           CROSS JOIN LATERAL (
             SELECT COALESCE(MAX(material_no), 0) + 1 AS n FROM work_materials WHERE work_id = $1
           ) nextno
          WHERE w.id = $1
         RETURNING *`,
        [
          id, b.material_name ?? null, b.material_type ?? null, b.rights_type ?? null,
          b.rights_holder_vendor_id ?? null, b.rights_holder_label ?? null,
          b.is_royalty_bearing ?? null, b.license_condition_id ?? null,
          b.service_line_item_id ?? null, b.scope ?? null, b.remarks ?? null, acq,
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
