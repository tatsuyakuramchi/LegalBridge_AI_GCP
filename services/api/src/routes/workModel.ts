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
import { normalizeGenre, normalizeRole } from "../lib/materialVocab.ts";
import { getNewDocumentNumber, pool } from "../lib/db.ts";

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

// Category 昇格(2): (work_id, genre) のカテゴリを get-or-create し id を返す。
//   素材→カテゴリは genre から自動導出(手動割当しない)。genre 空なら null。
const GENRE_SORT: Record<string, number> = {
  game_design: 0, manuscript: 1, illustration: 2, graphic_design: 3, scenario: 4,
  music: 5, translation: 6, editing: 7, text: 8, data: 9, other: 99,
};
async function ensureMaterialCategory(
  query: Query, workId: number, genre: string | null | undefined
): Promise<number | null> {
  const g = String(genre ?? "").trim();
  if (!workId || !g) return null;
  const r = await query(
    `INSERT INTO material_categories (work_id, genre, sort_order)
       VALUES ($1, $2, $3)
     ON CONFLICT (work_id, genre) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [workId, g, GENRE_SORT[g.toLowerCase()] ?? 99]
  );
  return r.rows[0]?.id ? Number(r.rows[0].id) : null;
}
const pad4 = (n: number) => String(n).padStart(4, "0");

// N:N 中間表 活性化 Stage 1: condition_line の (work_id, source_material_id) から
//   work_components / work_component_lines を同期する(設計:
//   docs/design/work-nn-junction-activation-plan.md)。フラット列とのデュアル書込で、
//   1つの利用許諾条件明細を「作品が使うマテリアル」として N:N に表現する受け皿を populate する。
//   - work_id と source_material_id が両方そろう時のみ「1作品×1マテリアル=1コンポーネント」を
//     ensure(0079 の部分ユニークで冪等)し、その component に明細を紐付ける。
//   - work_id が外れた / マテリアル未設定なら、その明細のジャンクションを除去(デタッチ)。
//   - 冪等。既存フラット列(work_id/source_material_id)は壊さない(本関数は中間表のみ操作)。
async function syncWorkComponentLink(query: Query, lineId: number): Promise<void> {
  const cur = await query(
    `SELECT work_id, source_material_id FROM condition_lines WHERE id = $1`,
    [lineId]
  );
  if (cur.rows.length === 0) return;
  const workId = cur.rows[0].work_id as number | null;
  const materialId = cur.rows[0].source_material_id as number | null;

  // 不完全(作品未結合 or マテリアル未設定)なら、この明細の中間表リンクを除去して終了。
  if (workId == null || materialId == null) {
    await query(`DELETE FROM work_component_lines WHERE condition_line_id = $1`, [lineId]);
    return;
  }

  // (work_id, material_id) のコンポーネントを冪等に ensure。component_no は作品内 max+1。
  await query(
    `INSERT INTO work_components (work_id, component_no, component_kind, material_id)
       SELECT $1,
              COALESCE((SELECT MAX(component_no) + 1 FROM work_components WHERE work_id = $1), 1),
              'material', $2
     ON CONFLICT (work_id, material_id) WHERE material_id IS NOT NULL DO NOTHING`,
    [workId, materialId]
  );
  const comp = await query(
    `SELECT id FROM work_components WHERE work_id = $1 AND material_id = $2`,
    [workId, materialId]
  );
  const componentId = comp.rows[0]?.id as number | undefined;
  if (componentId == null) return;

  // Stage4 経路一本化: 「他コンポーネントのリンク除去」は撤廃(加算 N:N に統一)。
  //   同一明細を複数作品で共有する結線をピッカー(linkWorkComponent)が張っても、⑧ attach-work が
  //   それを壊さないようにする。この明細ぶんの当該コンポーネント結線を冪等に足すだけ。
  await query(
    `INSERT INTO work_component_lines (component_id, condition_line_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [componentId, lineId]
  );
}

// N:N活性化 Stage3: 中間表を「加算的(additive)」に結線する。Stage1 の syncWorkComponentLink が
//   1明細=1作品(work_id 起点・他を除去)なのに対し、本ヘルパは「同じ原作マテリアルの利用許諾条件を
//   複数作品で共有」を実現する＝他作品の結線を消さずにこの作品分を足す(ピッカーが使う)。
//   - 単位はマテリアル(work_components.material_id)。material 不明なら結線しない(false)。
//   - work_id は未設定時のみ主作品として補完(既存値=他作品共有は上書きしない)。
async function linkWorkComponent(
  query: Query, workId: number, lineId: number, materialIdArg: number | null
): Promise<boolean> {
  let materialId = materialIdArg;
  if (materialId == null) {
    const r = await query(`SELECT source_material_id FROM condition_lines WHERE id = $1`, [lineId]);
    materialId = (r.rows[0]?.source_material_id as number | null) ?? null;
  }
  if (materialId == null) return false; // N:N の単位はマテリアル。未確定なら結線不可。
  await query(
    `INSERT INTO work_components (work_id, component_no, component_kind, material_id)
       SELECT $1,
              COALESCE((SELECT MAX(component_no) + 1 FROM work_components WHERE work_id = $1), 1),
              'material', $2
     ON CONFLICT (work_id, material_id) WHERE material_id IS NOT NULL DO NOTHING`,
    [workId, materialId]
  );
  const comp = await query(
    `SELECT id FROM work_components WHERE work_id = $1 AND material_id = $2`,
    [workId, materialId]
  );
  const componentId = comp.rows[0]?.id as number | undefined;
  if (componentId == null) return false;
  await query(
    `INSERT INTO work_component_lines (component_id, condition_line_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [componentId, lineId]
  );
  // フラット列は壊さない: work_id 未設定時のみ主作品として補完(共有=他作品の既存値は上書きしない)。
  await query(
    `UPDATE condition_lines SET work_id = $2,
            source_material_id = COALESCE(source_material_id, $3), updated_at = now()
      WHERE id = $1 AND work_id IS NULL`,
    [lineId, workId, materialId]
  );
  return true;
}

// N:N活性化 Stage3: 加算結線の解除(この作品ぶんだけ外す。他作品の共有結線は残す)。
async function unlinkWorkComponent(query: Query, workId: number, lineId: number): Promise<void> {
  await query(
    `DELETE FROM work_component_lines wcl USING work_components wc
      WHERE wcl.component_id = wc.id AND wc.work_id = $1 AND wcl.condition_line_id = $2`,
    [workId, lineId]
  );
  // この作品への結線が中間表から消えたのに work_id がまだこの作品を指していれば NULL 化
  //   (フラット読みでの誤表示を防ぐ。他作品の共有結線・他の work_id は触らない)。
  await query(
    `UPDATE condition_lines SET work_id = NULL, updated_at = now()
      WHERE id = $2 AND work_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM work_component_lines wcl JOIN work_components wc ON wc.id = wcl.component_id
           WHERE wcl.condition_line_id = $2 AND wc.work_id = $1)`,
    [workId, lineId]
  );
}

// マテリアル単位 利用許諾条件 登録: 原作ごとに「マスター登録用」の器(contract_capabilities)を
//   冪等に確保する(capability_id は NOT NULL ＝条件明細は必ず文書配下、という不変条件を維持)。
//   document_number = 'MLC-<work_code>'(UNIQUE)で1原作1器。registered-origin の軽量文書。
async function ensureMasterLicenseCapability(query: Query, sw: any): Promise<number> {
  const docNo = `MLC-${sw.work_code}`;
  await query(
    `INSERT INTO documents (
             record_type,
             contract_category,
             contract_type,
             contract_title,
             document_number,
             vendor_id,
             original_work,
             work_name,
             contract_status,
             source_system,
             template_type,
             revision,
             is_primary,
             lifecycle_status
           ) VALUES (
             'license_condition',
             'license',
             'registered_master',
             $1,
             $2,
             $3,
             $4,
             $4,
             'executed',
             'master_register',
             COALESCE('registered_master', ''),
             NULL,
             NULL,
             NULL
           )
           ON CONFLICT (document_number) DO UPDATE SET
             record_type = COALESCE(EXCLUDED.record_type, documents.record_type),
             contract_category = COALESCE(EXCLUDED.contract_category, documents.contract_category),
             contract_type = COALESCE(EXCLUDED.contract_type, documents.contract_type),
             contract_title = COALESCE(EXCLUDED.contract_title, documents.contract_title),
             vendor_id = COALESCE(EXCLUDED.vendor_id, documents.vendor_id),
             original_work = COALESCE(EXCLUDED.original_work, documents.original_work),
             work_name = COALESCE(EXCLUDED.work_name, documents.work_name),
             contract_status = COALESCE(EXCLUDED.contract_status, documents.contract_status),
             source_system = COALESCE(EXCLUDED.source_system, documents.source_system),
             updated_at = now()`,
    [`原作利用許諾条件(マスター登録): ${sw.title}`, docNo, sw.rights_holder_vendor_id ?? null, sw.title ?? null]
  );
  const r = await query(`SELECT id FROM contract_capabilities WHERE document_number = $1`, [docNo]);
  return r.rows[0].id as number;
}

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
                (SELECT COUNT(*) FROM work_materials wm WHERE wm.work_id = w.id) AS material_count,
                -- 一覧サマリー: この原作にぶら下がる条件明細(マテリアル経由)の総数。
                (SELECT COUNT(*) FROM condition_lines cl WHERE cl.source_work_id = w.id) AS condition_count
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
      // 権利者(取引先)名を併せて返す。原作=複数マテリアル(権利者が異なりうる)を
      //   作品エディタのピッカーで「誰の権利か」と分かるようにするため。
      const mats = await query(
        `SELECT wm.*, v.vendor_name AS rights_holder_name,
                mc.genre AS category_genre, mc.name AS category_name, mc.sort_order AS category_sort,
                COALESCE(wm.rights_holder_vendor_id, mc.rights_holder_vendor_id) AS effective_rights_holder_vendor_id,
                COALESCE(NULLIF(trim(wm.rights_holder_label), ''), mc.rights_holder_label) AS effective_rights_holder_label,
                COALESCE(v.vendor_name, cv.vendor_name) AS effective_rights_holder_name
           FROM work_materials wm
           LEFT JOIN vendors v ON v.id = wm.rights_holder_vendor_id
           LEFT JOIN material_categories mc ON mc.id = wm.category_id
           LEFT JOIN vendors cv ON cv.id = mc.rights_holder_vendor_id
          WHERE wm.work_id = $1
          ORDER BY COALESCE(mc.sort_order, 99), wm.material_no NULLS LAST, wm.id ASC`,
        [id]
      );
      res.json({ ...s.rows[0], materials: mats.rows });
    } catch (e) { fail(res, e); }
  });

  // 増分⑥(§3.4/§3.7): この原作を利用している自社作品(own)の逆引き。
  //   condition_lines.source_work_id = :id を持つ支払エッジから work_id を集約。
  //   原作中心ビュー / 左カードのクロスリンク表示に使う。
  app.get("/api/v3/source-ips/:id/uses", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(
        `SELECT w.id, w.work_code, w.title, w.work_type, w.status,
                COUNT(cl.id) AS link_count
           FROM condition_lines cl
           JOIN works w ON w.id = cl.work_id
          WHERE cl.source_work_id = $1 AND COALESCE(w.kind, 'own') = 'own'
          GROUP BY w.id, w.work_code, w.title, w.work_type, w.status
          ORDER BY w.work_code`,
        [id]
      );
      res.json(r.rows);
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
      // ④' 許諾地域の引用: condition_lines.source_condition_id → capability_financial_conditions
      //   の region_* を引用表示。無ければ contract_capabilities の territory/language にフォールバック。
      const edgeCols = `cl.id, cl.line_code, cl.subject, cl.transaction_kind, cl.direction,
                        cl.payment_scheme, cl.amount_ex_tax, cl.rate_pct, cl.mg_amount,
                        cl.source_work_id, cl.source_material_id, cl.product_id,
                        cl.counterparty_vendor_id,
                        cc.document_number, cc.contract_title,
                        v.vendor_name AS counterparty,
                        cfc.region_territory, cfc.region_language, cfc.region_language_label,
                        COALESCE(
                          cfc.region_language_label,
                          NULLIF(btrim(concat_ws('・', cfc.region_territory, cfc.region_language)), ''),
                          NULLIF(btrim(concat_ws('・', cc.territory, cc.language)), '')
                        ) AS territory_label`;
      // N:N活性化 Stage2: この作品に紐づく condition_line を「中間表(work_component_lines)経由」
      //   ∪「フラット列(work_id)」で引く。中間表で 1明細→複数作品(N:N) が見え、移行期はフラット
      //   経由(graph-link 素材後付け・既存データ)も拾うので欠落しない。$1 = この作品 id。
      const linkedLineIds = `
        SELECT wcl.condition_line_id AS line_id
          FROM work_component_lines wcl
          JOIN work_components wc ON wc.id = wcl.component_id
         WHERE wc.work_id = $1
        UNION
        SELECT cl2.id AS line_id FROM condition_lines cl2 WHERE cl2.work_id = $1`;
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
             LEFT JOIN capability_financial_conditions cfc ON cfc.id = cl.source_condition_id
             LEFT JOIN works sw ON sw.id = cl.source_work_id
             LEFT JOIN work_materials wm ON wm.id = cl.source_material_id
             LEFT JOIN vendors v ON v.id = cl.counterparty_vendor_id
            WHERE cl.id IN (${linkedLineIds}) AND cl.direction = 'payable'
            ORDER BY cl.id`,
          [id]
        ),
        // 左=受取(受取エッジ: ライセンスアウト派生物 / 物販アウト)
        query(
          `SELECT ${edgeCols},
                  p.product_code, p.product_name
             FROM condition_lines cl
             LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
             LEFT JOIN capability_financial_conditions cfc ON cfc.id = cl.source_condition_id
             LEFT JOIN products p ON p.id = cl.product_id
             LEFT JOIN vendors v ON v.id = cl.counterparty_vendor_id
            WHERE cl.id IN (${linkedLineIds}) AND cl.direction = 'receivable'
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
                COALESCE((SELECT COUNT(*)
                            FROM condition_lines cl
                            JOIN documents d ON d.id = cl.document_id
                           WHERE d.contract_id = c.id AND cl.legacy_role = 'cfc'), 0) AS term_count
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
        // Phase 5 第3弾: v3 ミラー(contract_financial_terms / contract_line_items)は
        // 0101 以降更新が止まった残骸のため、正本 condition_lines(互換view の形)を
        // documents.contract_id 経由で読む。応答形の互換のため contract_id を別名付与。
        query(
          `SELECT f.*, d.contract_id
             FROM capability_financial_conditions f
             JOIN documents d ON d.id = f.capability_id
            WHERE d.contract_id = $1
            ORDER BY f.condition_no, f.id`,
          [id]
        ),
        query(
          `SELECT li.*, d.contract_id
             FROM capability_line_items li
             JOIN documents d ON d.id = li.capability_id
            WHERE d.contract_id = $1
            ORDER BY li.line_no, li.id`,
          [id]
        ),
        // Phase 5 第4弾: royalty_statements(trg_sync_royalty_statements 供給のミラー)ではなく
        // 正本 royalty_calculations を documents.contract_id 経由で直読み(応答キーは互換維持)。
        query(
          `SELECT rc.id, rc.period, rc.gross_royalty_ex_tax, rc.mg_amount,
                  rc.mg_remaining, rc.actual_royalty_ex_tax
             FROM royalty_calculations rc
             JOIN documents d ON d.id = rc.capability_id
            WHERE d.contract_id = $1
            ORDER BY rc.period, rc.id`,
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

  // POST /api/v3/source-ips — 原作登録 (works(kind='licensed_in') へ書込)
  //   原作IDの LO 統一: 採番を IP- → **LO-YYYY-NNNN** に変更 (設計書 §7/§9, 移行 0075 と同思想)。
  //   - LO 番号は ledgers ∪ works の当年最大 +1。worker(document_sequences) と別カウンタだが
  //     両表の実コードから直接導出するため、既存 LO とは衝突しない。
  //   - 1文(CTE)で works + ledgers(LO) + materials(台帳 -001) + work_materials(works系 -001) を
  //     原子的に作成(このルートは pool 直結を持たず query() のみのため単一文で表現)。
  //   - work_materials も作るのは、新規原作がピッカー/利用許諾条件登録の素材候補(work_materials 依存)
  //     に出るようにするため(従来は台帳 materials のみで空になっていた)。
  //   - 既存IP原作は移行 0075 で LO 再採番済み。本変更で新規も LO に統一。
  //   注: worker 側 LedgersPanel 作成は引き続き document_sequences(LO)。採番系統の完全集約は §9.3。
  app.post("/api/v3/source-ips", ...requireWrite, express.json(), async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.title) return res.status(400).json({ ok: false, error: "title is required" });
      const year = new Date().getFullYear();
      const r = await query(
        `WITH yr AS (SELECT $1::text AS y),
         maxno AS (
           SELECT COALESCE(MAX(
                    CASE WHEN code ~ ('^LO-' || (SELECT y FROM yr) || '-[0-9]+$')
                         THEN split_part(code, '-', 3)::int ELSE 0 END), 0) AS n
             FROM (SELECT ledger_code AS code FROM ledgers
                   UNION ALL SELECT work_code AS code FROM works) c
         ),
         newcode AS (
           SELECT COALESCE($16,
                    'LO-' || (SELECT y FROM yr) || '-' || lpad(((SELECT n FROM maxno) + 1)::text, 4, '0')) AS c
         ),
         ins_work AS (
           INSERT INTO works (work_code, title, title_kana, alternative_titles, division,
               is_original, kind, rights_holder_vendor_id, original_publisher, default_rights_holder,
               default_credit_display, default_work_supplement, default_approval_target,
               default_approval_timing, remarks, parent_work_id, derivation_type)
           SELECT (SELECT c FROM newcode), $2, $3, COALESCE($4::text[],'{}'), COALESCE($5::text[],'{}'),
                  FALSE, 'licensed_in', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
           RETURNING *, work_code AS source_code
         ),
         ins_ledger AS (
           -- ledgers 親は残置(原作一覧 /api/master/ledgers の親)。素材は work_materials に一本化。
           INSERT INTO ledgers (ledger_code, title, is_active)
           SELECT (SELECT c FROM newcode), $2, true
           ON CONFLICT (ledger_code) DO NOTHING
           RETURNING id
         ),
         genre AS (
           -- O5: 本体ジャンルを事業部で確定(PUB→執筆文書 / それ以外→ゲームデザイン)。
           SELECT CASE WHEN ('PUB' = ANY(COALESCE($5::text[],'{}'))
                            AND NOT ('BDG' = ANY(COALESCE($5::text[],'{}'))))
                       THEN 'manuscript' ELSE 'game_design' END AS g
         ),
         ins_cat AS (
           -- Category(2): 本体ジャンルのカテゴリを同時生成(新規 work なので常に新規)。
           INSERT INTO material_categories (work_id, genre, sort_order)
           SELECT (SELECT id FROM ins_work), (SELECT g FROM genre),
                  CASE (SELECT g FROM genre) WHEN 'manuscript' THEN 1 ELSE 0 END
           ON CONFLICT (work_id, genre) DO NOTHING
           RETURNING id
         ),
         ins_work_mat AS (
           -- マテリアル一本化(0089/0090) + O5: 原作本体素材(-001)=メイン作品(core_logic)を正準表へ。
           INSERT INTO work_materials (work_id, material_no, material_code, material_name,
               material_type, is_default, material_role, acquisition_type, rights_holder_vendor_id, category_id)
           SELECT (SELECT id FROM ins_work), 1, (SELECT c FROM newcode) || '-001', $2,
                  (SELECT g FROM genre),
                  true, 'core_logic', 'license', $6, (SELECT id FROM ins_cat)
           RETURNING id
         )
         SELECT * FROM ins_work`,
        [String(year), b.title, b.title_kana ?? null, b.alternative_titles ?? null, b.division ?? null,
         b.rights_holder_vendor_id ?? null, b.original_publisher ?? null, b.default_rights_holder ?? null,
         b.default_credit_display ?? null, b.default_work_supplement ?? null, b.default_approval_target ?? null,
         b.default_approval_timing ?? null, b.remarks ?? null, b.parent_work_id ?? null, b.derivation_type ?? null,
         b.source_code ?? null]
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
        // 0114: parent_license_condition_id は cfc ビューに無い(実体は condition_lines)。
        //   cfc.id = condition_lines.id の 1:1 なので JOIN して読み出す。
        `SELECT cfc.*, cl.parent_license_condition_id,
                sw.title AS source_work_title, sw.work_code AS source_work_code,
                sm.material_name AS source_material_name
           FROM capability_financial_conditions cfc
           LEFT JOIN condition_lines cl ON cl.id = cfc.id
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
      // Phase 4: cfc_ins トリガ(0101)の意味論で condition_lines へ直書き。
      //   契約レス条件(capability=NULL)。region_language_label / condition_kind /
      //   basis / advance・forecast_amount はトリガ無視のため除去
      //   (condition_kind は直後の実列 UPDATE(0114/0116)が従来どおり担う)。
      //   応答の形(旧 RETURNING * = ビュー行)はビュー再読取で互換維持。
      const r = await query(
        `INSERT INTO condition_lines (
           document_id, capability_id, line_no, legacy_role, line_code, direction, payment_scheme,
           status_flags, is_inbound, is_addon, transaction_kind, condition_name,
           rate_pct, mg_amount, ag_amount, currency, base_price_label, formula_text, payment_terms,
           calc_period, calc_period_kind, calc_period_close_month, counterparty_vendor_id,
           source_work_id, source_material_id, unit_price, cycle, billing_day, term_start, term_end,
           calc_type, fixed_kind, subscription_cycle, unit_amount, guarantee_type,
           amount_ex_tax, updated_at
         ) VALUES (
           NULL, NULL, $4, 'cfc', cl_next_code(), 'payable', cl_scheme($5::text, $6::numeric),
           '{}'::jsonb, false, false, 'license', $22,
           CASE WHEN cl_scheme($5::text, $6::numeric) = 'royalty' THEN $6::numeric END,
           CASE WHEN cl_scheme($5::text, $6::numeric) = 'royalty' THEN $14::numeric END,
           CASE WHEN cl_scheme($5::text, $6::numeric) = 'royalty' THEN $15::numeric END,
           COALESCE($11, 'JPY'), $7, $12, $13,
           $8, $9, $10, $16,
           COALESCE($2, $1, cl_resolve_work($3)), $3, $17, $18, $19, $20, $21,
           $23, $24, $25, $26, $27,
           CASE WHEN cl_scheme($5::text, $6::numeric) IN ('royalty','subscription')
                THEN NULL ELSE COALESCE($26::numeric, $14::numeric, 0) END,
           now()
         )
         RETURNING id`,
        [
          id, b.source_work_id ?? null, b.source_material_id ?? null, condNo,
          b.calc_method ?? "ROYALTY",
          b.rate_pct ?? null, b.base_price_label ?? null,
          b.calc_period ?? null, b.calc_period_kind ?? null,
          b.calc_period_close_month ?? null, b.currency ?? "JPY",
          b.formula_text ?? null, b.payment_terms ?? null,
          Number(b.mg_amount) || 0, Number(b.ag_amount) || 0,
          b.counterparty_vendor_id ?? null,
          b.unit_price ?? null, b.cycle ?? null, b.billing_day ?? null,
          b.term_start ?? null, b.term_end ?? null,
          // 0045: 金銭条件の柔軟化フィールド
          b.condition_name ?? null, b.calc_type ?? null, b.fixed_kind ?? null,
          b.subscription_cycle ?? null,
          b.unit_amount != null && b.unit_amount !== "" ? Number(b.unit_amount) : null,
          b.guarantee_type ?? null,
        ]
      );
      // 応答互換: 旧実装はビュー行(RETURNING *)を返していたため同じ形で再読取。
      const rRead = await query(
        `SELECT * FROM capability_financial_conditions WHERE id = $1`,
        [r.rows[0]?.id]
      );
      const row = rRead.rows[0];
      // 0114/0116: parent_license_condition_id・condition_kind は cfc ビューに無い(実体は
      //   condition_lines)。INSTEAD OF INSERT トリガ後、cfc.id = condition_lines.id で直接更新。
      const parentLc = b.parent_license_condition_id != null && b.parent_license_condition_id !== ""
        ? Number(b.parent_license_condition_id) : null;
      if (row?.id) {
        await query(
          `UPDATE condition_lines SET parent_license_condition_id = $2, condition_kind = $3 WHERE id = $1`,
          [row.id, parentLc, condKind]
        );
      }
      if (row) { row.parent_license_condition_id = parentLc; row.condition_kind = condKind; }
      res.status(201).json(row);
    } catch (e) { fail(res, e); }
  });

  // PUT: 条件明細を更新(契約レス条件 = work_id 紐付き想定)
  app.put("/api/v3/work-conditions/:cid", ...requireWrite, express.json(), async (req, res) => {
    try {
      const cid = Number(req.params.cid);
      if (!Number.isFinite(cid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      // Phase 4: 直書き化。cfc_upd トリガ(0101)の意味論を移植:
      //   - payment_scheme = cl_scheme(calc_method, rate_pct)、royalty 以外は
      //     rate/mg/ag を NULL、amount_ex_tax は royalty/subscription なら NULL・
      //     それ以外 COALESCE(unit_amount, mg, 0)。
      //   - region_language_label はトリガの SET 対象外(休眠)だったが、ビュー定義上
      //     cl.condition_name の別名のため condition_name($22) がそのまま正。
      //   - condition_kind / basis / advance_amount / forecast_amount はビューの
      //     NULL 計算列(トリガ無視)のため削除。condition_kind は直後の実列 UPDATE
      //     (0114/0116)が従来どおり担う。
      //   - 応答の形(旧 RETURNING * = ビュー行)は互換のためビュー再読取で維持。
      const r = await query(
        `UPDATE condition_lines SET
            line_no = COALESCE($14, line_no),
            payment_scheme = cl_scheme($3::text, $4::numeric),
            condition_name = $22,
            rate_pct  = CASE WHEN cl_scheme($3::text, $4::numeric) = 'royalty' THEN $4::numeric END,
            mg_amount = CASE WHEN cl_scheme($3::text, $4::numeric) = 'royalty' THEN $12::numeric END,
            ag_amount = CASE WHEN cl_scheme($3::text, $4::numeric) = 'royalty' THEN $13::numeric END,
            currency = COALESCE($9, 'JPY'),
            base_price_label = $5, formula_text = $10, payment_terms = $11,
            calc_period = $6, calc_period_kind = $7, calc_period_close_month = $8,
            counterparty_vendor_id = $16,
            source_work_id = COALESCE($2, source_work_id, cl_resolve_work($15)),
            source_material_id = $15,
            unit_price = $17, cycle = $18, billing_day = $19,
            term_start = $20, term_end = $21,
            calc_type = $23, fixed_kind = $24, subscription_cycle = $25,
            unit_amount = $26, guarantee_type = $27,
            amount_ex_tax = CASE WHEN cl_scheme($3::text, $4::numeric) IN ('royalty','subscription')
                                 THEN NULL ELSE COALESCE($26::numeric, $12::numeric, 0) END,
            updated_at = now()
          WHERE id = $1 AND legacy_role = 'cfc' RETURNING id`,
        [
          cid, b.source_work_id ?? null,
          b.calc_method ?? "ROYALTY", b.rate_pct ?? null, b.base_price_label ?? null,
          b.calc_period ?? null, b.calc_period_kind ?? null, b.calc_period_close_month ?? null,
          b.currency ?? "JPY", b.formula_text ?? null, b.payment_terms ?? null,
          Number(b.mg_amount) || 0, Number(b.ag_amount) || 0,
          b.condition_no ?? null, b.source_material_id ?? null,
          b.counterparty_vendor_id ?? null, b.unit_price ?? null,
          b.cycle ?? null, b.billing_day ?? null, b.term_start ?? null, b.term_end ?? null,
          // 0045: 金銭条件の柔軟化フィールド
          b.condition_name ?? null, b.calc_type ?? null, b.fixed_kind ?? null,
          b.subscription_cycle ?? null,
          b.unit_amount != null && b.unit_amount !== "" ? Number(b.unit_amount) : null,
          b.guarantee_type ?? null,
        ]
      );
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      // 応答互換: 旧実装はビュー行(RETURNING *)を返していたため同じ形で再読取。
      const rr = await query(
        `SELECT * FROM capability_financial_conditions WHERE id = $1`,
        [cid]
      );
      const row = rr.rows[0];
      // 0114/0116: parent_license_condition_id・condition_kind は cfc ビューに無い(実体は
      //   condition_lines)。cfc.id = condition_lines.id で直接更新(parent は null で解除可、
      //   condition_kind は未指定なら現状維持)。
      const parentLc = b.parent_license_condition_id != null && b.parent_license_condition_id !== ""
        ? Number(b.parent_license_condition_id) : null;
      await query(
        `UPDATE condition_lines SET parent_license_condition_id = $2,
                condition_kind = COALESCE($3, condition_kind) WHERE id = $1`,
        [cid, parentLc, b.condition_kind ?? null]
      );
      row.parent_license_condition_id = parentLc;
      if (b.condition_kind != null) row.condition_kind = b.condition_kind;
      res.json(row);
    } catch (e) { fail(res, e); }
  });

  // DELETE: 条件明細を削除
  app.delete("/api/v3/work-conditions/:cid", ...requireWrite, async (req, res) => {
    try {
      const cid = Number(req.params.cid);
      if (!Number.isFinite(cid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(
        `DELETE FROM condition_lines WHERE id = $1 AND legacy_role = 'cfc'`,
        [cid]
      );
      res.json({ ok: true, deleted: r.rowCount || 0 });
    } catch (e) { fail(res, e); }
  });

  // ── サブライセンス受領記録(condition_receipts) ───────────────────
  //   サブライセンス条件明細(OUT) → 受領記録(計算のみ・文書発行なし)。
  //   royalty = basis='manufacturing' ? 報告数量×単価×料率 : 報告売上×料率。
  //   サーバ側で computed_royalty_ex_tax を算出して保存(フロントの計算と二重化)。
  // 数量ベース(プロダクトアウト)=個数×単価×料率 / それ以外(権利許諾)=売上×料率。
  //   basis は cfc VIEW で NULL 固定のため、永続化される calc_type で判定する。
  const isQtyBased = (cond: any) =>
    ["BASE_QTY_RATE", "SUPPLY_QTY"].includes(String(cond?.calc_type || "").toUpperCase()) ||
    cond?.basis === "manufacturing";
  const computeRoyalty = (cond: any, rep: { reported_sales?: any; reported_quantity?: any }) => {
    const rate = Number(cond?.rate_pct) || 0;
    const base = isQtyBased(cond)
      ? (Number(rep.reported_quantity) || 0) * (Number(cond?.unit_price) || 0)
      : Number(rep.reported_sales) || 0;
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

  // ── 分配(ライセンサーへの支払) ─────────────────────────────────
  //   分配 = 基準額 × 個数 × 親ライセンスイン料率。親は condition_lines.parent_license_condition_id
  //   (0114)で辿る。基準額/個数はスマート既定(プロダクトアウト=卸値×販売数 / 権利許諾=受領再許諾料×1)
  //   ＋受領記録で手動上書き可。算出後 outbound payment(分配台帳)へ upsert。
  const resolveDistribution = async (cid: number, cond: any, receipt: any, body: any) => {
    const num = (v: any) => (v == null || v === "" ? null : Number(v));
    const pl = await query(`SELECT parent_license_condition_id FROM condition_lines WHERE id = $1`, [cid]);
    const parentId = pl.rows[0]?.parent_license_condition_id ?? null;
    let parent: any = null;
    if (parentId) {
      const pr = await query(
        `SELECT rate_pct, counterparty_vendor_id, currency, work_id
           FROM capability_financial_conditions WHERE id = $1`,
        [parentId]
      );
      parent = pr.rows[0] || null;
    }
    const parentRate = parent?.rate_pct != null ? Number(parent.rate_pct) : null;
    // 基準額/個数: 明示値優先。無ければ basis からスマート既定。
    let base = num(body?.distribution_base);
    let qty = num(body?.distribution_qty);
    if (base == null) {
      if (isQtyBased(cond)) {
        base = Number(cond?.unit_price) || 0;                       // 卸値(単価)
        if (qty == null) qty = num(receipt?.reported_quantity) ?? 1; // 販売数
      } else {
        base = Number(receipt?.computed_royalty_ex_tax) || Number(receipt?.received_amount) || 0; // 受領再許諾料
        if (qty == null) qty = 1;                                    // 権利許諾は個数1
      }
    }
    if (qty == null) qty = 1;
    const dist = parentRate != null ? Math.round(base * qty * (parentRate / 100) * 100) / 100 : null;
    return { parentId, parent, parentRate, base, qty, dist };
  };

  // 分配 → 出金台帳(payments: outbound / royalty, counterparty=ライセンサー)同期。
  const syncDistributionPayment = async (receipt: any, cond: any, parent: any, dist: number | null): Promise<number | null> => {
    const has = dist != null && Number(dist) !== 0 && parent;
    if (has) {
      const cur = parent.currency || cond.currency || "JPY";
      if (receipt.distribution_payment_id) {
        await query(
          `UPDATE payments SET amount_ex_tax = $2, total_amount = $2, paid_date = $3,
                  period = $4, counterparty_vendor_id = $5, currency = $6 WHERE id = $1`,
          [receipt.distribution_payment_id, dist, receipt.received_date ?? null, receipt.period ?? null,
            parent.counterparty_vendor_id ?? null, cur]
        );
        return receipt.distribution_payment_id;
      }
      const p = await query(
        `INSERT INTO payments (
           payment_no, direction, payment_kind, work_id, counterparty_vendor_id,
           period, amount_ex_tax, total_amount, currency, status, source_document_number
         ) VALUES ($1, 'outbound', 'royalty', $2, $3, $4, $5, $5, $6, 'calculated', $7)
         RETURNING id`,
        [`DISTR-${receipt.id}`, cond.work_id ?? null, parent.counterparty_vendor_id ?? null,
          receipt.period ?? null, dist, cur, `condition_receipt#${receipt.id}/distribution`]
      );
      const pid = Number(p.rows[0].id);
      await query(`UPDATE condition_receipts SET distribution_payment_id = $2 WHERE id = $1`, [receipt.id, pid]);
      return pid;
    }
    if (receipt.distribution_payment_id) {
      await query(`DELETE FROM payments WHERE id = $1`, [receipt.distribution_payment_id]);
      await query(`UPDATE condition_receipts SET distribution_payment_id = NULL WHERE id = $1`, [receipt.id]);
    }
    return null;
  };

  // 受領記録 1 行に対して 分配計算 → 列保存 → 出金台帳同期 をまとめて行う。
  const applyDistribution = async (cid: number, cond: any, receipt: any, body: any) => {
    const d = await resolveDistribution(cid, cond, receipt, body);
    await query(
      `UPDATE condition_receipts SET distribution_base = $2, distribution_qty = $3,
              distribution_rate_pct = $4, distribution_parent_condition_id = $5,
              computed_distribution_ex_tax = $6, updated_at = now() WHERE id = $1`,
      [receipt.id, d.base, d.qty, d.parentRate, d.parentId, d.dist]
    );
    receipt.distribution_base = d.base;
    receipt.distribution_qty = d.qty;
    receipt.distribution_rate_pct = d.parentRate;
    receipt.distribution_parent_condition_id = d.parentId;
    receipt.computed_distribution_ex_tax = d.dist;
    receipt.distribution_payment_id = await syncDistributionPayment(receipt, cond, d.parent, d.dist);
    return receipt;
  };

  // GET: 作品配下の sublicense_out 条件 + 親ライセンスイン情報(分配の料率元)。受領が0件でも返す。
  app.get("/api/v3/works/:id/sublicense-conditions", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(
        `SELECT cfc.id, cfc.condition_no, cfc.region_language_label, cfc.rate_pct, cfc.basis,
                cfc.calc_type, cfc.unit_price, cfc.currency, cfc.counterparty_vendor_id,
                v.vendor_name AS counterparty_name,
                pcl.parent_license_condition_id,
                pcfc.rate_pct AS parent_rate_pct, pcfc.currency AS parent_currency,
                pcfc.counterparty_vendor_id AS licensor_vendor_id,
                pv.vendor_name AS licensor_name, pw.title AS licensor_work_title
           FROM capability_financial_conditions cfc
           LEFT JOIN vendors v ON v.id = cfc.counterparty_vendor_id
           LEFT JOIN condition_lines pcl ON pcl.id = cfc.id
           LEFT JOIN capability_financial_conditions pcfc ON pcfc.id = pcl.parent_license_condition_id
           LEFT JOIN vendors pv ON pv.id = pcfc.counterparty_vendor_id
           LEFT JOIN works pw ON pw.id = pcfc.work_id
          WHERE cfc.work_id = $1 AND pcl.condition_kind = 'sublicense_out'
          ORDER BY cfc.condition_no ASC, cfc.id ASC`,
        [id]
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // GET: 作品配下の OUT 条件 × 受領記録 を一覧(条件情報を同梱)
  app.get("/api/v3/works/:id/receipts", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(
        `SELECT cr.*, cfc.condition_no, cfc.region_language_label, cfc.rate_pct,
                cfc.basis, cfc.calc_type, cfc.unit_price, cfc.currency, cfc.counterparty_vendor_id,
                v.vendor_name AS counterparty_name
           FROM condition_receipts cr
           JOIN capability_financial_conditions cfc ON cfc.id = cr.condition_id
           JOIN condition_lines clk ON clk.id = cfc.id
           LEFT JOIN vendors v ON v.id = cfc.counterparty_vendor_id
          WHERE cfc.work_id = $1 AND clk.condition_kind = 'sublicense_out'
          ORDER BY cr.condition_id ASC, cr.period_date ASC NULLS LAST, cr.id ASC`,
        [id]
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // GET: 横断ダッシュボード — 全作品の再許諾受領×分配を一覧(期間/フリーワード/未受領/未分配 で絞込)。
  app.get("/api/v3/receipts-dashboard", ...requireRead, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const period = String(req.query.period || "").trim();
      const unreceived = String(req.query.unreceived || "") === "true";
      const undistributed = String(req.query.undistributed || "") === "true";
      const params: any[] = [];
      const where: string[] = ["clk.condition_kind = 'sublicense_out'"];
      if (period) { params.push(period); where.push(`cr.period = $${params.length}`); }
      if (q) {
        params.push(`%${q}%`);
        const i = params.length;
        where.push(`(w.title ILIKE $${i} OR w.work_code ILIKE $${i} OR v.vendor_name ILIKE $${i} OR pv.vendor_name ILIKE $${i})`);
      }
      if (unreceived) where.push(`cr.received_amount IS NULL`);
      if (undistributed) where.push(`cr.distribution_payment_id IS NULL`);
      const r = await query(
        `SELECT cr.id, cr.condition_id, cr.period, cr.period_date, cr.reported_sales, cr.reported_quantity,
                cr.computed_royalty_ex_tax, cr.received_amount, cr.received_date, cr.status,
                cr.distribution_base, cr.distribution_qty, cr.computed_distribution_ex_tax,
                cr.payment_id, cr.distribution_payment_id,
                cfc.work_id, cfc.rate_pct, cfc.currency, cfc.region_language_label,
                w.title AS work_title, w.work_code,
                v.vendor_name AS counterparty_name,
                pcl.parent_license_condition_id, pcfc.rate_pct AS parent_rate_pct,
                pv.vendor_name AS licensor_name
           FROM condition_receipts cr
           JOIN capability_financial_conditions cfc ON cfc.id = cr.condition_id
           JOIN condition_lines clk ON clk.id = cfc.id
           LEFT JOIN works w ON w.id = cfc.work_id
           LEFT JOIN vendors v ON v.id = cfc.counterparty_vendor_id
           LEFT JOIN condition_lines pcl ON pcl.id = cfc.id
           LEFT JOIN capability_financial_conditions pcfc ON pcfc.id = pcl.parent_license_condition_id
           LEFT JOIN vendors pv ON pv.id = pcfc.counterparty_vendor_id
          WHERE ${where.join(" AND ")}
          ORDER BY cr.period_date DESC NULLS LAST, cr.id DESC
          LIMIT 1000`,
        params
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
        `SELECT work_id, counterparty_vendor_id, currency, rate_pct, basis, unit_price, calc_type
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
      // 0115: 分配(ライセンサーへ支払) = 基準額 × 個数 × 親ライセンスイン料率 を算出・台帳反映。
      await applyDistribution(cid, c.rows[0], receipt, b);
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
                cfc.rate_pct, cfc.basis, cfc.unit_price, cfc.calc_type
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
      // 0115: 分配を再計算・台帳反映(cid は受領記録の condition_id)。
      await applyDistribution(cur.rows[0].condition_id, cur.rows[0], receipt, b);
      res.json(receipt);
    } catch (e) { fail(res, e); }
  });

  // DELETE: 受領記録を削除
  app.delete("/api/v3/condition-receipts/:rid", ...requireWrite, async (req, res) => {
    try {
      const rid = Number(req.params.rid);
      if (!Number.isFinite(rid)) return res.status(400).json({ ok: false, error: "invalid id" });
      // 紐づく入金/出金台帳(payments: 受領・分配)も掃除してから削除。
      const pr = await query(`SELECT payment_id, distribution_payment_id FROM condition_receipts WHERE id = $1`, [rid]);
      const pid = pr.rows[0]?.payment_id;
      const dpid = pr.rows[0]?.distribution_payment_id;
      const r = await query(`DELETE FROM condition_receipts WHERE id = $1`, [rid]);
      if (pid) await query(`DELETE FROM payments WHERE id = $1`, [pid]);
      if (dpid) await query(`DELETE FROM payments WHERE id = $1`, [dpid]);
      res.json({ ok: true, deleted: r.rowCount || 0 });
    } catch (e) { fail(res, e); }
  });

  // ── 作品のマテリアル(翻訳/イラスト/原作素材…) ────────────────────
  //   モデル(あ): work_materials を中心に、帰属(rights_type)で
  //     相手方(license/joint) → license_condition_id(利用許諾条件明細)
  //     当社(owned/copyright_assignment) → service_line_item_id(業務委託明細)
  //   へ繋ぐ。
  // PLW-D: 作品1:文書N:明細N の集約。ある作品に「明細単位で」帰属する
  //   文書/明細/利用許諾条件を、文書(capability)ごとにまとめて返す。
  //   帰属キーは capability_line_items.work_id / condition_lines.work_id(0084)。
  app.get("/api/v3/works/:id/attributions", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ ok: false, error: "invalid id" });
      }
      const wk = await query(
        `SELECT id, work_code, title, kind FROM works WHERE id = $1`,
        [id]
      );
      if (wk.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "作品が見つかりません" });
      }
      // 明細(業務/発注)
      const li = await query(
        `SELECT cli.capability_id, cc.document_number, cc.contract_title, cc.record_type,
                cli.line_no, cli.item_name, cli.amount_ex_tax,
                cli.deliverable_ownership, cli.calc_method
           FROM capability_line_items cli
           JOIN contract_capabilities cc ON cc.id = cli.capability_id
          WHERE cli.work_id = $1
          ORDER BY cc.document_number NULLS LAST, cli.line_no`,
        [id]
      );
      // 利用許諾条件(明細)
      const cl = await query(
        `SELECT cl.capability_id, cc.document_number, cc.contract_title, cc.record_type,
                cl.line_no, cl.subject, cfc.condition_name, cfc.condition_no,
                cl.payment_scheme, cl.rate_pct, cl.amount_ex_tax, cl.calc_method
           FROM condition_lines cl
           JOIN contract_capabilities cc ON cc.id = cl.capability_id
           LEFT JOIN capability_financial_conditions cfc ON cfc.id = cl.source_condition_id
          WHERE cl.work_id = $1
          ORDER BY cc.document_number NULLS LAST, cl.line_no`,
        [id]
      );
      // capability_id ごとに文書へ束ねる。
      const byCap = new Map<number, any>();
      const ensure = (r: any) => {
        const cid = Number(r.capability_id);
        if (!byCap.has(cid)) {
          byCap.set(cid, {
            capability_id: cid,
            document_number: r.document_number || null,
            contract_title: r.contract_title || null,
            record_type: r.record_type || null,
            line_items: [],
            conditions: [],
          });
        }
        return byCap.get(cid);
      };
      for (const r of li.rows) {
        ensure(r).line_items.push({
          line_no: r.line_no,
          item_name: r.item_name,
          amount_ex_tax: r.amount_ex_tax,
          deliverable_ownership: r.deliverable_ownership,
          calc_method: r.calc_method,
        });
      }
      for (const r of cl.rows) {
        ensure(r).conditions.push({
          line_no: r.line_no,
          condition_no: r.condition_no,
          label: r.condition_name || r.subject || null,
          payment_scheme: r.payment_scheme,
          rate_pct: r.rate_pct,
          amount_ex_tax: r.amount_ex_tax,
          calc_method: r.calc_method,
        });
      }
      const documents = Array.from(byCap.values()).sort((a, b) =>
        String(a.document_number || "").localeCompare(String(b.document_number || ""))
      );
      res.json({ ok: true, work: wk.rows[0], documents });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/v3/works/:id/materials", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(
        `SELECT wm.*, v.vendor_name AS rights_holder_name,
                mc.genre AS category_genre, mc.name AS category_name,
                mc.sort_order AS category_sort, mc.rights_holder_vendor_id AS category_rights_holder_vendor_id,
                mc.rights_holder_label AS category_rights_holder_label,
                cv.vendor_name AS category_rights_holder_name,
                -- 実効権利者: 素材自身が override、無ければカテゴリから継承。
                COALESCE(wm.rights_holder_vendor_id, mc.rights_holder_vendor_id) AS effective_rights_holder_vendor_id,
                COALESCE(NULLIF(trim(wm.rights_holder_label), ''), mc.rights_holder_label) AS effective_rights_holder_label,
                COALESCE(v.vendor_name, cv.vendor_name) AS effective_rights_holder_name,
                -- スキーマ単純化(0101)で work_materials.license_condition_id / service_line_item_id は
                --   廃止済み。由来リンク由来の派生フィールドはレスポンス形状維持のため NULL 固定にする。
                NULL::int AS license_condition_no,
                NULL::text AS service_line_name,
                NULL::numeric AS service_line_amount,
                NULL::text AS service_doc_number,
                NULL::boolean AS service_inspection_issued,
                0 AS service_inspected_amount,
                NULL::text AS service_inspection_status
           FROM work_materials wm
           LEFT JOIN vendors v ON v.id = wm.rights_holder_vendor_id
           LEFT JOIN material_categories mc ON mc.id = wm.category_id
           LEFT JOIN vendors cv ON cv.id = mc.rights_holder_vendor_id
          WHERE wm.work_id = $1
          ORDER BY COALESCE(mc.sort_order, 99), wm.material_no NULLS LAST, wm.id ASC`,
        [id]
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // ── マテリアルカテゴリ(Category 昇格(2)) ───────────────────────────────────
  //   カテゴリ = (work_id, genre)。素材は genre から自動紐付け。ここでは属性
  //   (権利者/表示名/並び順)を管理する。
  app.get("/api/v3/works/:id/material-categories", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(
        `SELECT mc.*, v.vendor_name AS rights_holder_name,
                COALESCE(cnt.n, 0) AS material_count
           FROM material_categories mc
           LEFT JOIN vendors v ON v.id = mc.rights_holder_vendor_id
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS n FROM work_materials wm WHERE wm.category_id = mc.id
           ) cnt ON TRUE
          WHERE mc.work_id = $1
          ORDER BY mc.sort_order, mc.genre`,
        [id]
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  app.post("/api/v3/works/:id/material-categories", ...requireWrite, express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      const genre = normalizeGenre(b.genre ?? b.material_type);
      if (!genre) return res.status(400).json({ ok: false, error: "genre は必須" });
      const r = await query(
        `INSERT INTO material_categories
           (work_id, genre, name, rights_holder_vendor_id, rights_holder_label, sort_order)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6, 99))
         ON CONFLICT (work_id, genre) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, material_categories.name),
           updated_at = now()
         RETURNING *`,
        [id, genre, b.name ?? null, b.rights_holder_vendor_id ?? null,
         b.rights_holder_label ?? null, b.sort_order ?? null]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) { fail(res, e); }
  });

  app.put("/api/v3/material-categories/:cid", ...requireWrite, express.json(), async (req, res) => {
    try {
      const cid = Number(req.params.cid);
      if (!Number.isFinite(cid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      const r = await query(
        `UPDATE material_categories SET
            name = $2, rights_holder_vendor_id = $3, rights_holder_label = $4,
            sort_order = COALESCE($5, sort_order), is_active = COALESCE($6, is_active),
            updated_at = now()
          WHERE id = $1 RETURNING *`,
        [cid, b.name ?? null, b.rights_holder_vendor_id ?? null, b.rights_holder_label ?? null,
         b.sort_order ?? null, b.is_active ?? null]
      );
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      res.json(r.rows[0]);
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
      // O5: ジャンル正規化 + 役割(本体/サブ)確定。
      const mt = normalizeGenre(b.material_type);
      const role = normalizeRole(b.material_role, mt, b.is_default);
      // Category(2): genre から (work_id, genre) カテゴリを get-or-create し紐付け。
      const categoryId = await ensureMaterialCategory(query, id, mt);
      // material_no / material_code({work_code}-NNN) を採番して挿入。
      // 0101 で license_condition_id / service_line_item_id は廃止。列参照を外す。
      const r = await query(
        `INSERT INTO work_materials (
           work_id, material_name, material_type, material_role, rights_type, rights_holder_vendor_id,
           rights_holder_label, is_royalty_bearing, scope, remarks, acquisition_type, category_id,
           territory, language,
           material_no, material_code, is_default
         )
         SELECT $1,$2,$3,$4,$5,$6,$7,COALESCE($8,FALSE),$9,$10,$11,$12,$13,$14,
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
          id, b.material_name ?? null, mt, role, b.rights_type ?? null,
          b.rights_holder_vendor_id ?? null, b.rights_holder_label ?? null,
          b.is_royalty_bearing ?? null, b.scope ?? null, b.remarks ?? null, acq, categoryId,
          b.territory ?? null, b.language ?? null,
        ]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) { fail(res, e); }
  });

  // 増分⑦: 製品(SKU)追加。product_code は {work_code}-P-NNN で採番(未指定時)。
  app.post("/api/v3/works/:id/products", ...requireWrite, express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      if (!b.product_name) return res.status(400).json({ ok: false, error: "product_name is required" });
      const r = await query(
        `INSERT INTO products (work_id, product_code, product_name, edition, format, msrp, jan_code, isbn, release_date, status)
         SELECT $1,
                COALESCE($2, w.work_code || '-P-' || lpad(nextno.n::text, 3, '0')),
                $3, $4, $5, $6, $7, $8, $9, $10
           FROM works w
           CROSS JOIN LATERAL (
             SELECT COUNT(*) + 1 AS n FROM products WHERE work_id = $1
           ) nextno
          WHERE w.id = $1
         RETURNING *`,
        [id, b.product_code ?? null, b.product_name, b.edition ?? null, b.format ?? null,
         b.msrp ?? null, b.jan_code ?? null, b.isbn ?? null, b.release_date ?? null, b.status ?? null]
      );
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: "work not found" });
      res.status(201).json(r.rows[0]);
    } catch (e) { fail(res, e); }
  });

  // 増分⑦: 受取先(取引先) picker 用の簡易一覧(名称/コード部分一致)。
  app.get("/api/v3/vendors", ...requireRead, async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const r = await query(
        `SELECT id, vendor_code, vendor_name FROM vendors
          WHERE ($1 = '' OR vendor_name ILIKE '%' || $1 || '%' OR vendor_code ILIKE '%' || $1 || '%')
          ORDER BY vendor_name LIMIT 1000`,
        [q]
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // 増分⑧: 個別条件書(文書番号)に紐づく condition_lines を検索。
  //   エディタは明細を新規作成せず、既存明細を作品へ参照リンク(work_id 結合)するための候補一覧(§3.6/§10.7)。
  app.get("/api/v3/condition-lines/by-document", ...requireRead, async (req, res) => {
    try {
      const doc = String(req.query.document_number ?? "").trim();
      if (!doc) return res.status(400).json({ ok: false, error: "document_number is required" });
      const r = await query(
        `SELECT cl.id, cl.line_code, cl.subject, cl.direction, cl.transaction_kind,
                cl.payment_scheme, cl.amount_ex_tax, cl.rate_pct, cl.work_id,
                cl.source_seq_no, cl.source_material_id, cl.source_work_id,
                cl.mg_amount, cl.ag_amount,
                cfc.region_language_label,
                cc.document_number, cc.contract_title,
                w.work_code AS current_work_code, w.title AS current_work_title
           FROM condition_lines cl
           JOIN contract_capabilities cc ON cc.id = cl.capability_id
           LEFT JOIN works w ON w.id = cl.work_id
           LEFT JOIN capability_financial_conditions cfc ON cfc.id = cl.source_condition_id
          WHERE cc.document_number ILIKE '%' || $1 || '%'
          ORDER BY cc.document_number, cl.line_no, cl.id`,
        [doc]
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // 増分⑧ + N:N活性化 Stage1: condition_line をこの作品へ参照リンク(付替え) / 解除。
  //   §10.7: エディタは明細を新規作成しない。既存明細の主対象(work_id)結合のみ。
  //   Stage1: body に source_material_id を渡すと同時に素材も結合でき(ピッカーが
  //   work+material を一発で渡せる)、結合後に中間表(work_components/work_component_lines)を
  //   デュアル書込で同期する。source_material_id 未指定なら work_id のみ変更(後方互換)。
  app.patch("/api/v3/condition-lines/:id/attach-work", ...requireWrite, express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      const workId = b.work_id == null ? null : Number(b.work_id);
      if (workId != null && !Number.isFinite(workId)) {
        return res.status(400).json({ ok: false, error: "invalid work_id" });
      }
      const hasMaterial = Object.prototype.hasOwnProperty.call(b, "source_material_id");
      const materialId = !hasMaterial || b.source_material_id == null ? null : Number(b.source_material_id);
      if (hasMaterial && materialId != null && !Number.isFinite(materialId)) {
        return res.status(400).json({ ok: false, error: "invalid source_material_id" });
      }
      const r = hasMaterial
        ? await query(
            `UPDATE condition_lines SET work_id = $2, source_material_id = $3, updated_at = now()
              WHERE id = $1 RETURNING id`,
            [id, workId, materialId]
          )
        : await query(
            `UPDATE condition_lines SET work_id = $2, updated_at = now() WHERE id = $1 RETURNING id`,
            [id, workId]
          );
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "condition_line not found" });
      // Stage1: 中間表(N:N)をフラット列とデュアル書込で同期。
      await syncWorkComponentLink(query, id);
      res.json({ ok: true, id });
    } catch (e) { fail(res, e); }
  });

  // N:N活性化 Stage3: 原作(source)起点ピッカー — この原作にぶら下がる利用許諾条件明細を引く。
  //   条件はマテリアルにぶら下がる前提(source_material_id)。source_work_id=原作 の明細を、
  //   マテリアル順に返す。?work_id=<現作品> を渡すと、その作品に結線済みか(linked_here)も付く。
  app.get("/api/v3/source-ips/:id/condition-lines", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const workId = req.query.work_id == null ? null : Number(req.query.work_id);
      const r = await query(
        `SELECT cl.id, cl.line_code, cl.subject, cl.direction, cl.transaction_kind,
                cl.payment_scheme, cl.amount_ex_tax, cl.rate_pct,
                cl.source_material_id, wm.material_code, wm.material_name,
                cl.counterparty_vendor_id, v.vendor_name AS counterparty,
                cc.document_number, cc.contract_title,
                EXISTS (
                  SELECT 1 FROM work_component_lines wcl
                    JOIN work_components wc ON wc.id = wcl.component_id
                   WHERE wcl.condition_line_id = cl.id AND wc.work_id = $2
                ) AS linked_here
           FROM condition_lines cl
           JOIN contract_capabilities cc ON cc.id = cl.capability_id
           LEFT JOIN work_materials wm ON wm.id = cl.source_material_id
           LEFT JOIN vendors v ON v.id = cl.counterparty_vendor_id
          WHERE cl.source_work_id = $1
          ORDER BY wm.material_no NULLS LAST, cl.line_no, cl.id`,
        [id, workId]
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // マテリアル単位の利用許諾条件: この原作マテリアルに登録済みの条件明細を一覧。
  app.get("/api/v3/source-ips/:id/materials/:mid/condition-lines", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const mid = Number(req.params.mid);
      if (!Number.isFinite(id) || !Number.isFinite(mid)) {
        return res.status(400).json({ ok: false, error: "invalid id" });
      }
      const r = await query(
        `SELECT cl.id, cl.line_code, cl.subject, cl.payment_scheme, cl.rate_pct,
                cl.mg_amount, cl.ag_amount, cl.amount_ex_tax, cl.rights_attribution,
                cl.term_start, cl.term_end, cl.notes, cl.source_seq_no,
                cl.base_price_label, cl.calc_method, cl.calc_period, cl.calc_period_kind,
                cl.calc_period_close_month, cl.currency, cl.formula_text, cl.payment_terms,
                cc.document_number, cc.contract_title, cc.source_system,
                cfc.region_territory, cfc.region_language, cfc.region_language_label
           FROM condition_lines cl
           JOIN contract_capabilities cc ON cc.id = cl.capability_id
           LEFT JOIN capability_financial_conditions cfc ON cfc.id = cl.source_condition_id
          WHERE cl.source_work_id = $1 AND cl.source_material_id = $2
          ORDER BY cl.line_no, cl.id`,
        [id, mid]
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // 条件明細レコードの削除(作品管理のデータ整理用)。
  //   既定(safe): 支払実績(condition_events)/作品構成リンク(work_component_lines)が
  //     あるときは 409 を返し削除しない(blocker件数を添える)。
  //   ?force=true: 関連 condition_events / work_component_lines を先に削除→ condition_line を削除。
  //   さらに MLC マスター器(source_system='master_register')配下で、親 cfc を他の
  //   condition_line が参照していなければ親 capability_financial_conditions も削除。
  app.delete("/api/v3/condition-lines/:id", ...requireWrite, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ ok: false, error: "invalid id" });
      }
      const force = String(req.query.force || "") === "true";
      const clr = await query(
        `SELECT cl.id, cl.source_condition_id, cl.capability_id, cc.source_system
           FROM condition_lines cl
           JOIN contract_capabilities cc ON cc.id = cl.capability_id
          WHERE cl.id = $1`,
        [id]
      );
      const cl = clr.rows[0];
      if (!cl) return res.status(404).json({ ok: false, error: "not found" });
      const ev = await query(
        `SELECT COUNT(*)::int AS n FROM condition_events WHERE condition_line_id = $1`,
        [id]
      );
      const wc = await query(
        `SELECT COUNT(*)::int AS n FROM work_component_lines WHERE condition_line_id = $1`,
        [id]
      );
      const events = Number(ev.rows[0]?.n || 0);
      const links = Number(wc.rows[0]?.n || 0);
      if ((events > 0 || links > 0) && !force) {
        return res.status(409).json({
          ok: false,
          error: "has downstream references",
          blockers: events + links,
          events,
          links,
        });
      }
      if (force) {
        await query(`DELETE FROM condition_events WHERE condition_line_id = $1`, [id]);
        await query(`DELETE FROM work_component_lines WHERE condition_line_id = $1`, [id]);
      }
      await query(`DELETE FROM condition_lines WHERE id = $1`, [id]);
      // MLC マスター器: 親 cfc を他に参照する condition_line が無ければ親も削除。
      if (cl.source_condition_id && cl.source_system === "master_register") {
        const others = await query(
          `SELECT 1 FROM condition_lines WHERE source_condition_id = $1 LIMIT 1`,
          [cl.source_condition_id]
        );
        if (others.rows.length === 0) {
          await query(
            `DELETE FROM condition_lines WHERE id = $1 AND legacy_role = 'cfc'`,
            [cl.source_condition_id]
          );
        }
      }
      res.json({ ok: true, deleted: id, events, links, forced: force });
    } catch (e) { fail(res, e); }
  });

  // WMC-1: 原作素材(material_code)を跨いだ「条件コピー元候補」一覧。
  //   既存 GET .../materials/:mid/condition-lines は work_materials.id(行スコープ)で絞るため、
  //   同じ原作素材に登録した別作品の条件を引けない。ここでは安定キー material_code で
  //   横断する。material_code は ledgers.materials / work_materials の双方でミラーされる
  //   グローバル一意キー(=`<ledger_code>-NNN`)で、source_ip_material_id が未設定の
  //   新規素材でも確実にマッチする。フォームは選択中素材の material_code をそのまま渡せる。
  //   返却 shape はフォームの FinancialCondition にそのまま流し込める cfc 列で構成する。
  //   - is_template: 原作登録器(MLC-, source_system='master_register')由来 = L1 テンプレ。
  //     O6 によりコピー元は L1 を優先表示する(is_template DESC)。
  //   - source_condition_id / source_condition_line_id: コピー痕跡(O4)用の参照。
  //   query: ?exclude_capability_id= でコピー先(編集中の文書)自身の既存条件を除外できる。
  app.get(
    "/api/v3/materials/by-code/:materialCode/copy-source-conditions",
    ...requireRead,
    async (req, res) => {
      try {
        const materialCode = String(req.params.materialCode || "").trim();
        if (!materialCode) {
          return res.status(400).json({ ok: false, error: "invalid materialCode" });
        }
        const excludeCapId =
          req.query.exclude_capability_id == null ||
          req.query.exclude_capability_id === ""
            ? null
            : Number(req.query.exclude_capability_id);
        const params: any[] = [materialCode];
        let excludeClause = "";
        if (excludeCapId != null && Number.isFinite(excludeCapId)) {
          params.push(excludeCapId);
          excludeClause = ` AND cl.capability_id <> $${params.length}`;
        }
        const r = await query(
          `SELECT
                  cl.id                          AS source_condition_line_id,
                  cl.source_work_id,
                  cl.capability_id,
                  cfc.id                         AS source_condition_id,
                  cc.document_number, cc.contract_title,
                  (COALESCE(cc.source_system,'') = 'master_register') AS is_template,
                  w.work_code                    AS origin_work_code,
                  w.title                        AS origin_work_title,
                  wm.id                          AS work_material_id,
                  wm.material_code, wm.material_name,
                  -- フォーム FinancialCondition へコピーする金銭条件フィールド
                  cfc.condition_no, cfc.condition_name,
                  cfc.region_territory, cfc.region_language, cfc.region_language_label,
                  cfc.calc_method, cfc.calc_type, cfc.fixed_kind, cfc.subscription_cycle,
                  cfc.unit_amount, cfc.guarantee_type, cfc.rate_pct, cfc.base_price_label,
                  cfc.calc_period, cfc.calc_period_kind, cfc.calc_period_close_month,
                  cfc.currency, cfc.formula_text, cfc.payment_terms,
                  cfc.mg_amount, cfc.ag_amount, cfc.applies_scope
             FROM condition_lines cl
             JOIN work_materials wm ON wm.id = cl.source_material_id
             JOIN contract_capabilities cc ON cc.id = cl.capability_id
             JOIN capability_financial_conditions cfc ON cfc.id = cl.source_condition_id
             LEFT JOIN works w ON w.id = wm.work_id
            WHERE wm.material_code = $1${excludeClause}
            ORDER BY is_template DESC, cc.id DESC, cfc.condition_no NULLS LAST, cl.id`,
          params
        );
        res.json(r.rows);
      } catch (e) { fail(res, e); }
    }
  );

  // 個別利用許諾条件書フォームの「過去の契約・発注書から構成要素(LC)を取り込む」導線用。
  //   指定文書(利用許諾条件書 or 発注書)から、構成要素LC 候補を材料コード単位で返す。
  //   2ソースを統合する:
  //   (1) 受注者帰属/ライセンス条件 = condition_lines(source_material_id + source_condition_id)。
  //       material_code + 金銭条件(cfc)を持つ。発注書の受注者帰属条件もここに含まれる。
  //   (2) 発注者帰属の業務委託成果物 = capability_line_items(発注書)。work_materials への
  //       リンク(service_line_item_id)があれば material_code を持つが金銭条件は無い(＝新規入力)。
  //   フロントは material_code があればそのまま LC 行に、無ければ item_name を種にその場で
  //   マテリアル登録してから LC 行に加える。条件(rate_pct 等)があれば copied として引用する。
  app.get(
    "/api/v3/documents/:documentNumber/lc-candidates",
    ...requireRead,
    async (req, res) => {
      try {
        const doc = String(req.params.documentNumber || "").trim();
        if (!doc) {
          return res.status(400).json({ ok: false, error: "invalid documentNumber" });
        }
        // (1) 受注者帰属 / ライセンス条件（material_code + 金銭条件）
        const licenseRows = await query(
          `SELECT DISTINCT ON (wm.material_code, cfc.id)
                  'license_condition'            AS source,
                  wm.material_code, wm.material_name,
                  vh.vendor_name                 AS rights_holder,
                  cfc.id                         AS source_condition_id,
                  cfc.condition_name, cfc.rate_pct, cfc.mg_amount, cfc.ag_amount,
                  cfc.calc_method, cfc.calc_type, cfc.region_language_label, cfc.currency,
                  NULL::text AS item_name, NULL::text AS deliverable_ownership,
                  cc.document_number, cc.contract_title, cc.record_type
             FROM condition_lines cl
             JOIN contract_capabilities cc ON cc.id = cl.capability_id
             JOIN work_materials wm ON wm.id = cl.source_material_id
             LEFT JOIN capability_financial_conditions cfc ON cfc.id = cl.source_condition_id
             LEFT JOIN vendors vh ON vh.id = wm.rights_holder_vendor_id
            WHERE cc.document_number ILIKE '%' || $1 || '%'
              AND wm.material_code IS NOT NULL
            ORDER BY wm.material_code, cfc.id NULLS LAST, cl.id`,
          [doc]
        );
        // (3) 素材未リンクの利用許諾CL（source_material_id IS NULL）。
        //     文書に条件書(CL)が付いていても、原作マテリアルに紐づいていない条件は (1) の
        //     INNER JOIN work_materials から漏れるため「文書を検索しても条件が出ない」。
        //     ここで拾い、material_code=null(取込時に素材化 or 空欄で編集) の候補として返す。
        //     条件値(料率/MG/AG/計算/地域言語/通貨)は保持し、ブランクならフォームで編集させる。
        const unlinkedRows = await query(
          `SELECT 'license_condition'          AS source,
                  NULL::text                    AS material_code,
                  COALESCE(NULLIF(cl.subject, ''), cl.condition_name) AS material_name,
                  NULL::text                    AS rights_holder,
                  cl.id                         AS source_condition_id,
                  cl.condition_name, cl.rate_pct, cl.mg_amount, cl.ag_amount,
                  cl.calc_method, NULL::text    AS calc_type,
                  cl.condition_name             AS region_language_label, cl.currency,
                  NULL::text AS item_name, NULL::text AS deliverable_ownership,
                  cc.document_number, cc.contract_title, cc.record_type,
                  TRUE                          AS unlinked
             FROM condition_lines cl
             JOIN contract_capabilities cc ON cc.id = cl.capability_id
            WHERE cc.document_number ILIKE '%' || $1 || '%'
              AND cl.transaction_kind = 'license'
              AND cl.source_material_id IS NULL
            ORDER BY cl.line_no, cl.id`,
          [doc]
        );
        // (2) 発注者帰属の業務委託成果物（発注書明細）。work_materials リンクがあれば
        //     material_code を補完。金銭条件は持たない(＝取り込み後に新規入力)。
        const deliverableRows = await query(
          `SELECT 'po_deliverable'              AS source,
                  NULL::text                     AS material_code,
                  cli.item_name                  AS material_name,
                  NULL::text                     AS rights_holder,
                  NULL::int AS source_condition_id,
                  NULL::text AS condition_name,
                  cli.rate_pct, NULL::numeric AS mg_amount, NULL::numeric AS ag_amount,
                  cli.calc_method, NULL::text AS calc_type,
                  NULL::text AS region_language_label, NULL::text AS currency,
                  cli.item_name,
                  COALESCE(cli.deliverable_ownership, '発注者') AS deliverable_ownership,
                  cc.document_number, cc.contract_title, cc.record_type
             FROM capability_line_items cli
             JOIN contract_capabilities cc
               ON cc.id = cli.capability_id AND cc.record_type = 'purchase_order'
            WHERE cc.document_number ILIKE '%' || $1 || '%'
            ORDER BY cli.line_no, cli.id`,
          [doc]
        );
        // material_code をキーに重複排除。ライセンス条件(条件付き)を優先。
        //   素材リンク済み(1)を先に積み、その source_condition_id を除いた未リンクCL(3)を足す
        //   (同じ condition が両方に出た場合は素材リンク済みを優先)。
        const linkedCondIds = new Set<number>(
          licenseRows.rows
            .map((r: any) => (r.source_condition_id == null ? null : Number(r.source_condition_id)))
            .filter((n: number | null): n is number => n != null)
        );
        const seen = new Set<string>();
        const out: any[] = [];
        const ordered = [
          ...licenseRows.rows,
          ...unlinkedRows.rows.filter(
            (r: any) => !linkedCondIds.has(Number(r.source_condition_id))
          ),
          ...deliverableRows.rows,
        ];
        for (const r of ordered) {
          // 条件付きライセンス行は material_code+condition で一意、成果物は material_code か item_name で一意。
          const key =
            r.source === "license_condition"
              ? `L:${r.material_code ?? ""}:${r.source_condition_id ?? ""}`
              : `D:${r.material_code ?? r.item_name ?? Math.random()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(r);
        }
        res.json(out);
      } catch (e) { fail(res, e); }
    }
  );

  // 利用許諾条件書(契約マスター, license カテゴリ)の検索 — マテリアル条件登録の「文書を選んで補完」用。
  //   合成の MLC- 器(source_system='master_register')は候補から除外し、実在の条件書だけ返す。
  app.get("/api/v3/license-capabilities", ...requireRead, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const params: any[] = [];
      let where = `cc.contract_category = 'license' AND COALESCE(cc.source_system,'') <> 'master_register'`;
      if (q) {
        params.push(`%${q}%`);
        where += ` AND (cc.document_number ILIKE $1 OR cc.contract_title ILIKE $1)`;
      }
      const r = await query(
        `SELECT cc.id, cc.document_number, cc.contract_title, cc.record_type
           FROM contract_capabilities cc
          WHERE ${where}
          ORDER BY cc.id DESC
          LIMIT 100`,
        params
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // 文書(発注書等)配下の「未リンクの利用許諾CL」= 素材未割当の license 条件明細。
  //   発注書作成時に原作台帳/素材番号が無いと source_material_id が付かないため、CL は
  //   実在するが原作素材に紐づかない(lc-candidates に出ない)。これを素材登録側で拾って
  //   「値コピー(=二重作成)」ではなく「既存CLを素材にリンク(source_material_id を後付け)」する。
  app.get("/api/v3/documents/:documentNumber/unlinked-license-conditions", ...requireRead, async (req, res) => {
    try {
      const doc = String(req.params.documentNumber || "").trim();
      if (!doc) return res.status(400).json({ ok: false, error: "invalid documentNumber" });
      const r = await query(
        `SELECT cl.id, cl.subject, cl.payment_scheme, cl.rate_pct, cl.mg_amount, cl.ag_amount,
                cl.amount_ex_tax, cl.base_price_label, cl.calc_method, cl.currency,
                cl.region_territory, cl.region_language, cl.condition_name AS region_language_label,
                cc.document_number, cc.contract_title, cc.record_type
           FROM condition_lines cl
           JOIN contract_capabilities cc ON cc.id = cl.capability_id
          WHERE cc.document_number ILIKE '%' || $1 || '%'
            AND cl.transaction_kind = 'license'
            AND cl.source_material_id IS NULL
          ORDER BY cl.line_no, cl.id`,
        [doc]
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // 未リンクCL 棚卸し: 全文書横断で「素材未割当の利用許諾CL」を一覧(棚卸し画面用)。
  //   発注書等で発生した素材未リンクの license 条件を、まとめて原作マテリアルへリンクするための元データ。
  app.get("/api/v3/unlinked-license-conditions", ...requireRead, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const params: any[] = [];
      let where = `cl.transaction_kind = 'license' AND cl.source_material_id IS NULL`;
      if (q) {
        params.push(`%${q}%`);
        where += ` AND (cc.document_number ILIKE $1 OR cc.contract_title ILIKE $1)`;
      }
      const r = await query(
        `SELECT cl.id, cl.subject, cl.payment_scheme, cl.rate_pct, cl.mg_amount, cl.ag_amount,
                cl.amount_ex_tax, cl.base_price_label, cl.calc_method, cl.currency,
                cl.region_territory, cl.region_language, cl.condition_name AS region_language_label,
                cc.id AS capability_id, cc.document_number, cc.contract_title, cc.record_type
           FROM condition_lines cl
           JOIN contract_capabilities cc ON cc.id = cl.capability_id
          WHERE ${where}
          ORDER BY cc.document_number NULLS LAST, cl.line_no, cl.id
          LIMIT 500`,
        params
      );
      res.json(r.rows);
    } catch (e) { fail(res, e); }
  });

  // 既存の未リンク利用許諾CLを、この原作マテリアルへ後付けリンク(source_material_id/source_work_id)。
  //   新規 condition_line は作らない(=二重CLを防ぐ)。安全のため未リンクの license CL のみ対象。
  app.post("/api/v3/source-ips/:id/materials/:mid/link-conditions", ...requireWrite, express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const mid = Number(req.params.mid);
      if (!Number.isFinite(id) || !Number.isFinite(mid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      const ids: number[] = Array.isArray(b.condition_line_ids)
        ? b.condition_line_ids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))
        : [];
      if (ids.length === 0) return res.status(400).json({ ok: false, error: "condition_line_ids が空です" });
      const sw = await query(`SELECT id FROM works WHERE id = $1 AND kind = 'licensed_in'`, [id]);
      if (sw.rows.length === 0) return res.status(404).json({ ok: false, error: "原作が見つかりません" });
      const mat = await query(`SELECT id FROM work_materials WHERE id = $1 AND work_id = $2`, [mid, id]);
      if (mat.rows.length === 0) return res.status(404).json({ ok: false, error: "原作マテリアルが見つかりません" });
      const r = await query(
        `UPDATE condition_lines
            SET source_material_id = $2, source_work_id = $3, updated_at = now()
          WHERE id = ANY($1::int[])
            AND source_material_id IS NULL
            AND transaction_kind = 'license'
          RETURNING id`,
        [ids, mid, id]
      );
      res.json({ ok: true, linked: r.rowCount || 0, ids: r.rows.map((x: any) => x.id) });
    } catch (e) { fail(res, e); }
  });

  // マテリアル単位の利用許諾条件 登録 (過去分登録の単一ルート)。原作の器(capability)配下に
  //   condition_line を作る。direction='payable'/transaction_kind='license'/work_id=NULL(割当はピッカー)。
  //   地域・言語は per-行の capability_financial_conditions を作り source_condition_id で紐付け。
  app.post("/api/v3/source-ips/:id/materials/:mid/condition-lines", ...requireWrite, express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const mid = Number(req.params.mid);
      if (!Number.isFinite(id) || !Number.isFinite(mid)) {
        return res.status(400).json({ ok: false, error: "invalid id" });
      }
      const b = req.body || {};
      const scheme = String(b.payment_scheme || "");
      const SCHEMES = ["lump_sum", "per_unit", "installment", "subscription", "royalty"];
      if (!SCHEMES.includes(scheme)) {
        return res.status(400).json({ ok: false, error: "payment_scheme is invalid" });
      }
      const num = (v: any) => (v == null || v === "" ? null : Number(v));
      const amount = num(b.amount_ex_tax);
      const rate = num(b.rate_pct);
      const mg = num(b.mg_amount);
      const ag = num(b.ag_amount);
      // CHECK: royalty/subscription 以外は amount_ex_tax 必須。royalty 以外は rate/mg/ag を持てない。
      if (!["subscription", "royalty"].includes(scheme) && amount == null) {
        return res.status(400).json({ ok: false, error: "この支払方式では税抜金額(amount_ex_tax)が必須です" });
      }
      if (scheme !== "royalty" && (rate != null || mg != null || ag != null)) {
        return res.status(400).json({ ok: false, error: "rate/MG/AG は royalty のときのみ指定できます" });
      }
      // 原作・マテリアルの存在確認。
      const sw = await query(
        `SELECT id, work_code, title, rights_holder_vendor_id FROM works WHERE id = $1 AND kind = 'licensed_in'`,
        [id]
      );
      if (sw.rows.length === 0) return res.status(404).json({ ok: false, error: "原作が見つかりません" });
      const mat = await query(`SELECT id FROM work_materials WHERE id = $1 AND work_id = $2`, [mid, id]);
      if (mat.rows.length === 0) return res.status(404).json({ ok: false, error: "原作マテリアルが見つかりません" });

      // 器(capability)の決定。優先順位(マテリアル登録フォームの「文書」欄①〜④に対応):
      //   ① capability_id 明示           → その器
      //   ① document_number 明示         → その文書番号の既存 license 器を解決
      //   ②③ issue_document / file_link  → マテリアルごとに1文書=ARC-ILT を発番して器を新規作成
      //                                     (DB登録のみ・PDFなし。file_link は document_url に保存)
      //   ④ いずれも空                   → 原作ごとの MLC- 器にフォールバック(マスター登録)
      //   ※ フォームは1マテリアル=1文書のため、②③は先頭の金銭条件で発番し、
      //     返却された capability_id を残りの金銭条件で再利用する(発番の重複を防ぐ)。
      let capabilityId: number;
      let lineCodePrefix: string;
      const chosenCap = b.capability_id == null || b.capability_id === "" ? null : Number(b.capability_id);
      const docNum = b.document_number == null ? "" : String(b.document_number).trim();
      const fileLink = b.file_link == null ? "" : String(b.file_link).trim();
      const issueDoc = b.issue_document === true || b.issue_document === "true";
      // 文書種別: 'publication' = 出版等利用許諾条件書(ARC-PUBT, category=publication)、
      //           それ以外 = 個別利用許諾条件書(ARC-ILT, category=license)。
      //   固定3種の取引形態(自社製造自社販売/権利許諾/自社製造他社販売)は出版にも流用でき
      //   (紙自社出版=①/電子出版=②/紙他社出版=③)、変わるのは器のカテゴリと採番だけ。
      const isPub = b.doc_kind === "publication" || b.doc_kind === "pub";
      const CAT = isPub ? "publication" : "license";
      // ①既存 器(capability_id / document_number)は license/publication 両方を受け付ける。
      if (chosenCap != null) {
        if (!Number.isFinite(chosenCap)) {
          return res.status(400).json({ ok: false, error: "invalid capability_id" });
        }
        const cap = await query(
          `SELECT id, document_number FROM contract_capabilities
            WHERE id = $1
              AND (contract_category IN ('license','publication')
                   OR record_type = 'purchase_order')`,
          [chosenCap]
        );
        if (cap.rows.length === 0) {
          return res.status(400).json({ ok: false, error: "選択した条件書(器)が見つかりません(license/publication/発注書)" });
        }
        capabilityId = cap.rows[0].id as number;
        lineCodePrefix = (cap.rows[0].document_number as string) || `CAP-${capabilityId}`;
      } else if (docNum) {
        // ① 既存文書を文書番号で解決(DocumentNumberLookup で選択したケース)。
        // 発注書(受託者帰属の成果物には利用許諾条件が付く)も器として受け付ける。
        //   受注者帰属条件は lc-candidates(CL引用)で参照でき、器＝発注書 capability に紐づく。
        const cap = await query(
          `SELECT id, document_number FROM contract_capabilities
            WHERE document_number = $1
              AND (contract_category IN ('license','publication')
                   OR record_type = 'purchase_order')`,
          [docNum]
        );
        if (cap.rows.length === 0) {
          return res.status(400).json({ ok: false, error: `文書番号「${docNum}」の条件書(器)が見つかりません(利用許諾/出版/発注書)` });
        }
        capabilityId = cap.rows[0].id as number;
        lineCodePrefix = (cap.rows[0].document_number as string) || `CAP-${capabilityId}`;
      } else {
        // ②③④統合: capability_id も document_number も無ければ、常に「実在の条件書」を発番して器を作る。
        //   旧 MLC 合成器(source_system='master_register')は廃止。MLC は「実在の条件書だけ返す」候補
        //   リスト(lc-candidates)から除外され is_template 扱いされるため、条件明細・計算書に出なかった。
        //   ここで発番する器は source_system=NULL / contract_type=NULL / is_active=TRUE / lifecycle_status='final'
        //   の実条件書として作り、各ビュー・ピッカーに正しく載るようにする。
        //   出版=ARC-PUBT(publication) / それ以外=ARC-ILT(license)。file_link は従前契約 URL を document_url に保存。
        const numberingType = isPub ? "pub_license_terms" : "individual_license_terms";
        const recordType = isPub ? "publication_condition" : "license_condition";
        const titlePrefix = isPub ? "出版等利用許諾条件(マテリアル登録)" : "個別利用許諾条件(マテリアル登録)";
        const newNo = await getNewDocumentNumber(numberingType);
        await query(
          `INSERT INTO documents (
             record_type,
             contract_category,
             contract_type,
             contract_title,
             document_number,
             vendor_id,
             original_work,
             work_name,
             contract_status,
             source_system,
             document_url,
             is_active,
             lifecycle_status,
             template_type,
             drive_link,
             revision,
             is_primary
           ) VALUES (
             $6,
             $7,
             NULL,
             $1,
             $2,
             $3,
             $4,
             $4,
             'executed',
             NULL,
             $5,
             TRUE,
             'final',
             COALESCE(NULL, ''),
             COALESCE($5, ''),
             NULL,
             NULL
           )
           ON CONFLICT (document_number) DO UPDATE SET
             record_type = COALESCE(EXCLUDED.record_type, documents.record_type),
             contract_category = COALESCE(EXCLUDED.contract_category, documents.contract_category),
             contract_type = COALESCE(EXCLUDED.contract_type, documents.contract_type),
             contract_title = COALESCE(EXCLUDED.contract_title, documents.contract_title),
             vendor_id = COALESCE(EXCLUDED.vendor_id, documents.vendor_id),
             original_work = COALESCE(EXCLUDED.original_work, documents.original_work),
             work_name = COALESCE(EXCLUDED.work_name, documents.work_name),
             contract_status = COALESCE(EXCLUDED.contract_status, documents.contract_status),
             source_system = COALESCE(EXCLUDED.source_system, documents.source_system),
             document_url = COALESCE(EXCLUDED.document_url, documents.document_url),
             is_active = COALESCE(EXCLUDED.is_active, documents.is_active),
             lifecycle_status = COALESCE(EXCLUDED.lifecycle_status, documents.lifecycle_status),
             updated_at = now()`,
          [
            `${titlePrefix}: ${sw.rows[0].title ?? ""}`,
            newNo,
            sw.rows[0].rights_holder_vendor_id ?? null,
            sw.rows[0].title ?? null,
            fileLink || null,
            recordType,
            CAT,
          ]
        );
        const r = await query(`SELECT id FROM contract_capabilities WHERE document_number = $1`, [newNo]);
        capabilityId = r.rows[0].id as number;
        lineCodePrefix = newNo;
      }

      // 金銭条件は capability_financial_conditions(cfc) VIEW 経由で書く。
      //   0101 のスキーマ単純化で cfc は condition_lines(WHERE legacy_role='cfc') の互換 VIEW になり、
      //   INSERT は cfc_ins トリガが legacy_role='cfc' 付きの正準 condition_line を作る。これにより
      //   金銭条件検索(/api/financial-conditions/search)・条件明細ビュー・利用許諾料計算に載る。
      //   ※ 直接 condition_lines へ書くと legacy_role が付かず cfc VIEW に映らないため不可(旧実装のバグ)。
      //   素材連動は source_material_id で保持(トリガが source_work_id を素材から解決)。
      const territory = b.region_territory ? String(b.region_territory) : null;
      const language = b.region_language ? String(b.region_language) : null;
      const regionLabel = [territory, language].filter(Boolean).join("・") || null;
      const calcMethod =
        scheme === "royalty" ? "ROYALTY"
        : scheme === "subscription" ? "SUBSCRIPTION"
        : scheme === "per_unit" ? "PER_UNIT"
        : scheme === "installment" ? "INSTALLMENT"
        : "FIXED";
      const isRoyaltyLike = scheme === "royalty" || scheme === "subscription";
      // Phase 4: cfc_ins トリガ(0101)の意味論で condition_lines へ直書き。
      //   region_language_label はトリガ無視のため除去(condition_name が正)。
      //   source_work_id はトリガ同様 cl_resolve_work(素材ID) で導出。
      const ins = await query(
        `INSERT INTO condition_lines (
           document_id, capability_id, line_no, legacy_role, line_code, direction, payment_scheme,
           status_flags, is_inbound, is_addon, transaction_kind, condition_name,
           calc_type, rate_pct, mg_amount, ag_amount, unit_amount,
           currency, base_price_label, region_territory, region_language,
           source_material_id, source_work_id, amount_ex_tax, updated_at
         )
         SELECT $1, $1, v.ln, 'cfc',
                COALESCE((SELECT line_code FROM condition_lines
                           WHERE document_id = $1 AND line_no = v.ln), cl_next_code()),
                cl_dir($1), cl_scheme($3::text, $5::numeric),
                '{}'::jsonb, false, false, 'license', $2,
                $4,
                CASE WHEN cl_scheme($3::text, $5::numeric) = 'royalty' THEN $5::numeric END,
                CASE WHEN cl_scheme($3::text, $5::numeric) = 'royalty' THEN $6::numeric END,
                CASE WHEN cl_scheme($3::text, $5::numeric) = 'royalty' THEN $7::numeric END,
                $8, COALESCE($9, 'JPY'), $10, $11, $12,
                $13, cl_resolve_work($13),
                CASE WHEN cl_scheme($3::text, $5::numeric) IN ('royalty','subscription')
                     THEN NULL ELSE COALESCE($8::numeric, $6::numeric, 0) END,
                CURRENT_TIMESTAMP
           FROM (SELECT COALESCE((SELECT MAX(line_no) + 1 FROM condition_lines
                                   WHERE capability_id = $1), 1) AS ln) v
         RETURNING id, line_no AS condition_no`,
        [
          capabilityId,
          b.subject ?? b.condition_name ?? null,
          calcMethod,
          b.calc_type ? String(b.calc_type) : null,
          isRoyaltyLike ? rate : null,
          isRoyaltyLike ? mg : null,
          isRoyaltyLike ? ag : null,
          isRoyaltyLike ? null : amount, // 固定額は unit_amount へ(amount_ex_tax を上で導出)
          b.currency ?? "JPY",
          b.base_price_label ?? null,
          territory,
          language,
          mid,
        ]
      );
      // capability_id / document_number も返す。フォームは先頭の金銭条件でこれを受け取り、
      //   残りの金銭条件を同一 capability_id で送って器・発番を共有する(1マテリアル=1文書)。
      res.status(201).json({
        ok: true,
        id: ins.rows[0].id,
        condition_no: ins.rows[0].condition_no,
        line_code: `${lineCodePrefix}-L${ins.rows[0].condition_no}`,
        capability_id: capabilityId,
        document_number: lineCodePrefix,
      });
    } catch (e) { fail(res, e); }
  });

  // 登録済み利用許諾条件の編集。condition_line のスカラ項目を更新し、地域は cfc を更新/なければ作成。
  //   器(capability)/採番/source_work_id/source_material_id は不変。
  app.patch("/api/v3/condition-lines/:id/master-condition", ...requireWrite, express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      const scheme = String(b.payment_scheme || "");
      const SCHEMES = ["lump_sum", "per_unit", "installment", "subscription", "royalty"];
      if (!SCHEMES.includes(scheme)) return res.status(400).json({ ok: false, error: "payment_scheme is invalid" });
      const num = (v: any) => (v == null || v === "" ? null : Number(v));
      const amount = num(b.amount_ex_tax);
      const rate = num(b.rate_pct);
      const mg = num(b.mg_amount);
      const ag = num(b.ag_amount);
      if (!["subscription", "royalty"].includes(scheme) && amount == null) {
        return res.status(400).json({ ok: false, error: "この支払方式では税抜金額(amount_ex_tax)が必須です" });
      }
      if (scheme !== "royalty" && (rate != null || mg != null || ag != null)) {
        return res.status(400).json({ ok: false, error: "rate/MG/AG は royalty のときのみ指定できます" });
      }
      const upd = await query(
        `UPDATE condition_lines SET subject = $2, payment_scheme = $3, amount_ex_tax = $4, rate_pct = $5,
                mg_amount = $6, ag_amount = $7, rights_attribution = $8, term_start = $9, term_end = $10,
                notes = $11, updated_at = now()
          WHERE id = $1 RETURNING capability_id, source_condition_id`,
        [id, b.subject ?? null, scheme, amount, rate, mg, ag, b.rights_attribution ?? null,
         b.term_start ?? null, b.term_end ?? null, b.notes ?? null]
      );
      if (upd.rowCount === 0) return res.status(404).json({ ok: false, error: "condition_line not found" });
      const capabilityId = upd.rows[0].capability_id as number;
      const scid = upd.rows[0].source_condition_id as number | null;
      const territory = b.region_territory ? String(b.region_territory) : null;
      const language = b.region_language ? String(b.region_language) : null;
      const label = [territory, language].filter(Boolean).join("・") || null;
      if (scid != null) {
        await query(
          `UPDATE condition_lines SET region_territory = $2, region_language = $3, condition_name = COALESCE($4, condition_name), updated_at = now() WHERE id = $1 AND legacy_role = 'cfc'`,
          [scid, territory, language, label]
        );
      } else if (territory || language) {
        // Phase 4: cfc_ins トリガ(0101)の意味論で condition_lines へ直書き(地域行)。
        //   ラベルはビュー定義上 condition_name の別名のため condition_name へ保存。
        const cfc = await query(
          `INSERT INTO condition_lines
             (document_id, capability_id, line_no, legacy_role, line_code, direction, payment_scheme,
              status_flags, is_inbound, is_addon, transaction_kind, condition_name,
              currency, region_territory, region_language, amount_ex_tax, updated_at)
           SELECT $1, $1, v.ln, 'cfc',
                  COALESCE((SELECT line_code FROM condition_lines
                             WHERE document_id = $1 AND line_no = v.ln), cl_next_code()),
                  cl_dir($1), 'lump_sum',
                  '{}'::jsonb, false, false, 'license', $4,
                  'JPY', $2, $3, 0, CURRENT_TIMESTAMP
             FROM (SELECT COALESCE((SELECT MAX(line_no) + 1 FROM condition_lines
                                     WHERE capability_id = $1), 1) AS ln) v
           RETURNING id`,
          [capabilityId, territory, language, label]
        );
        await query(`UPDATE condition_lines SET source_condition_id = $2 WHERE id = $1`, [id, cfc.rows[0].id]);
      }
      res.json({ ok: true, id });
    } catch (e) { fail(res, e); }
  });

  // 利用許諾明細(FinancialConditionTable)の一括保存。表の全行を condition_lines へ upsert:
  //   __clid=既存 condition_line.id → UPDATE / 無し → INSERT / 提出に無い既存 → DELETE。
  //   地域は cfc + source_condition_id。source_work_id=原作 / source_material_id=素材 / work_id=NULL。
  app.put("/api/v3/source-ips/:id/materials/:mid/conditions", ...requireWrite, express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const mid = Number(req.params.mid);
      if (!Number.isFinite(id) || !Number.isFinite(mid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      const rows: any[] = Array.isArray(b.rows) ? b.rows : [];
      const sw = await query(`SELECT id, work_code, title, rights_holder_vendor_id FROM works WHERE id = $1 AND kind = 'licensed_in'`, [id]);
      if (sw.rows.length === 0) return res.status(404).json({ ok: false, error: "原作が見つかりません" });
      const mat = await query(`SELECT id FROM work_materials WHERE id = $1 AND work_id = $2`, [mid, id]);
      if (mat.rows.length === 0) return res.status(404).json({ ok: false, error: "原作マテリアルが見つかりません" });
      let capabilityId: number;
      let lineCodePrefix: string;
      const chosenCap = b.capability_id == null || b.capability_id === "" ? null : Number(b.capability_id);
      if (chosenCap != null) {
        if (!Number.isFinite(chosenCap)) return res.status(400).json({ ok: false, error: "invalid capability_id" });
        // 利用許諾/出版に加え、発注書(受託者帰属の利用許諾条件付き)も器として受け付ける。
        const cap = await query(`SELECT id, document_number FROM contract_capabilities WHERE id = $1 AND (contract_category IN ('license','publication') OR record_type = 'purchase_order')`, [chosenCap]);
        if (cap.rows.length === 0) return res.status(400).json({ ok: false, error: "選択した条件書(器)が見つかりません(利用許諾/出版/発注書)" });
        capabilityId = cap.rows[0].id; lineCodePrefix = cap.rows[0].document_number || `CAP-${capabilityId}`;
      } else {
        capabilityId = await ensureMasterLicenseCapability(query, sw.rows[0]);
        lineCodePrefix = `MLC-${sw.rows[0].work_code}`;
      }
      const existing = await query(`SELECT id, source_condition_id FROM condition_lines WHERE source_work_id = $1 AND source_material_id = $2`, [id, mid]);
      const existingMap = new Map<number, number | null>(existing.rows.map((r: any) => [r.id, r.source_condition_id]));
      const num = (v: any) => (v == null || v === "" ? null : Number(v));
      const SCHEMES = ["lump_sum", "per_unit", "installment", "subscription", "royalty"];
      const kept = new Set<number>();
      for (const row of rows) {
        const scheme = String(row.payment_scheme || "");
        if (!SCHEMES.includes(scheme)) continue;
        const royalty = scheme === "royalty";
        const amount = royalty ? null : num(row.amount_ex_tax);
        const rate = royalty ? num(row.rate_pct) : null;
        const mg = royalty ? num(row.mg_amount) : null;
        const ag = royalty ? num(row.ag_amount) : null;
        if (!["subscription", "royalty"].includes(scheme) && amount == null) continue; // 金額必須行はスキップ
        const territory = row.region_territory ? String(row.region_territory) : null;
        const language = row.region_language ? String(row.region_language) : null;
        const label = [territory, language].filter(Boolean).join("・") || null;
        const clid = num(row.__clid);
        let scid: number | null = clid != null ? (existingMap.get(clid) ?? null) : null;
        if (territory || language) {
          if (scid != null) {
            await query(`UPDATE condition_lines SET region_territory = $2, region_language = $3, condition_name = COALESCE($4, condition_name), updated_at = now() WHERE id = $1 AND legacy_role = 'cfc'`, [scid, territory, language, label]);
          } else {
            // 採番は condition_lines 全体(=line_no)の MAX+1 で行う。cfc ビュー
            //   (legacy_role='cfc' のみ)の MAX で採番すると、地域ホルダ行と本体行が
            //   別系列で番号採番され (capability_id, line_no) UNIQUE 制約に衝突する
            //   (地域付き条件が2件以上で duplicate key)。実体テーブル基準に統一。
            // Phase 4: cfc_ins トリガ(0101)の意味論で condition_lines へ直書き(地域行)。
            const cfc = await query(
              `INSERT INTO condition_lines
                 (document_id, capability_id, line_no, legacy_role, line_code, direction, payment_scheme,
                  status_flags, is_inbound, is_addon, transaction_kind, condition_name,
                  currency, region_territory, region_language, amount_ex_tax, updated_at)
               SELECT $1, $1, v.ln, 'cfc',
                      COALESCE((SELECT line_code FROM condition_lines
                                 WHERE document_id = $1 AND line_no = v.ln), cl_next_code()),
                      cl_dir($1), 'lump_sum',
                      '{}'::jsonb, false, false, 'license', $4,
                      'JPY', $2, $3, 0, CURRENT_TIMESTAMP
                 FROM (SELECT COALESCE((SELECT MAX(line_no)+1 FROM condition_lines
                                         WHERE capability_id = $1), 1) AS ln) v
               RETURNING id`,
              [capabilityId, territory, language, label]
            );
            scid = cfc.rows[0].id as number;
          }
        }
        const vals = [
          row.subject ?? null, scheme, amount, rate, mg, ag,
          royalty ? (row.base_price_label ?? null) : null, row.calc_method ?? null, row.calc_period ?? null,
          row.calc_period_kind ?? null, num(row.calc_period_close_month), row.currency ?? "JPY",
          row.formula_text ?? null, row.payment_terms ?? null, row.rights_attribution ?? null,
          row.term_start ?? null, row.term_end ?? null, row.notes ?? null,
        ];
        if (clid != null && existingMap.has(clid)) {
          await query(
            `UPDATE condition_lines SET subject=$2, payment_scheme=$3, amount_ex_tax=$4, rate_pct=$5, mg_amount=$6, ag_amount=$7,
               base_price_label=$8, calc_method=$9, calc_period=$10, calc_period_kind=$11, calc_period_close_month=$12,
               currency=$13, formula_text=$14, payment_terms=$15, rights_attribution=$16, term_start=$17, term_end=$18,
               notes=$19, source_seq_no=$20, source_condition_id=$21, updated_at=now() WHERE id=$1`,
            [clid, ...vals, num(row.source_seq_no), scid]
          );
          kept.add(clid);
        } else {
          const ins = await query(
            `INSERT INTO condition_lines (capability_id, line_no, line_code, subject, direction, transaction_kind,
               payment_scheme, amount_ex_tax, rate_pct, mg_amount, ag_amount, base_price_label, calc_method, calc_period,
               calc_period_kind, calc_period_close_month, currency, formula_text, payment_terms, rights_attribution,
               term_start, term_end, notes, source_seq_no, source_work_id, source_material_id, source_condition_id, work_id)
             SELECT $1, ln, $2 || '-L' || ln, $3, 'payable', 'license', $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, NULL
               FROM (SELECT COALESCE(MAX(line_no),0)+1 AS ln FROM condition_lines WHERE capability_id=$1) q RETURNING id`,
            [capabilityId, lineCodePrefix, ...vals, num(row.source_seq_no), id, mid, scid]
          );
          kept.add(ins.rows[0].id as number);
        }
      }
      for (const [eid, escid] of existingMap) {
        if (kept.has(eid)) continue;
        // 表から外された行: MLC マスター登録の器配下のみ物理削除。実在の利用許諾条件書由来は
        //   文書データ保護のためリンク解除(source_material_id=NULL)のみ。
        const cap = await query(
          `SELECT cc.source_system FROM condition_lines cl JOIN contract_capabilities cc ON cc.id = cl.capability_id WHERE cl.id = $1`,
          [eid]
        );
        if (cap.rows[0]?.source_system === "master_register") {
          await query(`DELETE FROM condition_lines WHERE id = $1`, [eid]);
          if (escid != null) await query(`DELETE FROM condition_lines WHERE id = $1 AND legacy_role = 'cfc'`, [escid]);
        } else {
          await query(`UPDATE condition_lines SET source_material_id = NULL, updated_at = now() WHERE id = $1`, [eid]);
        }
      }
      res.json({ ok: true, count: kept.size });
    } catch (e) { fail(res, e); }
  });

  // N:N活性化 Stage3: 加算結線 — この作品へ condition_line を中間表で結ぶ(共有=他作品の結線は消さない)。
  app.post("/api/v3/works/:workId/component-lines", ...requireWrite, express.json(), async (req, res) => {
    try {
      const workId = Number(req.params.workId);
      if (!Number.isFinite(workId)) return res.status(400).json({ ok: false, error: "invalid workId" });
      const b = req.body || {};
      const lineId = Number(b.condition_line_id);
      if (!Number.isFinite(lineId)) return res.status(400).json({ ok: false, error: "invalid condition_line_id" });
      const materialId = b.source_material_id == null ? null : Number(b.source_material_id);
      if (materialId != null && !Number.isFinite(materialId)) {
        return res.status(400).json({ ok: false, error: "invalid source_material_id" });
      }
      const ok = await linkWorkComponent(query, workId, lineId, materialId);
      if (!ok) {
        return res.status(400).json({
          ok: false,
          error: "source_material_id を特定できません(明細にマテリアルが紐付いていません)",
        });
      }
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // N:N活性化 Stage3: 加算結線の解除 — この作品ぶんだけ外す(他作品の共有結線は残す)。
  app.delete("/api/v3/works/:workId/component-lines/:lineId", ...requireWrite, async (req, res) => {
    try {
      const workId = Number(req.params.workId);
      const lineId = Number(req.params.lineId);
      if (!Number.isFinite(workId) || !Number.isFinite(lineId)) {
        return res.status(400).json({ ok: false, error: "invalid id" });
      }
      await unlinkWorkComponent(query, workId, lineId);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  app.put("/api/v3/work-materials/:mid", ...requireWrite, express.json(), async (req, res) => {
    try {
      const mid = Number(req.params.mid);
      if (!Number.isFinite(mid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      // O5: ジャンル正規化 + 役割確定。
      const mt = normalizeGenre(b.material_type);
      const role = normalizeRole(b.material_role, mt, b.is_default);
      // Category(2): 更新後 genre に対応するカテゴリへ付け替え(work_id は素材から解決)。
      const wr = await query(`SELECT work_id FROM work_materials WHERE id = $1`, [mid]);
      const wmWorkId = wr.rows[0]?.work_id ? Number(wr.rows[0].work_id) : null;
      const categoryId = wmWorkId ? await ensureMaterialCategory(query, wmWorkId, mt) : null;
      // 0101 で license_condition_id / service_line_item_id は廃止。列参照を外す。
      const r = await query(
        `UPDATE work_materials SET
            material_name = $2, material_type = $3, material_role = $10, rights_type = $4,
            rights_holder_vendor_id = $5, rights_holder_label = $6,
            is_royalty_bearing = COALESCE($7,FALSE), scope = $8, remarks = $9,
            category_id = $11, territory = $12, language = $13, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [
          mid, b.material_name ?? null, mt, b.rights_type ?? null,
          b.rights_holder_vendor_id ?? null, b.rights_holder_label ?? null,
          b.is_royalty_bearing ?? null, b.scope ?? null, b.remarks ?? null, role, categoryId,
          b.territory ?? null, b.language ?? null,
        ]
      );
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: "not found" });
      res.json(r.rows[0]);
    } catch (e) { fail(res, e); }
  });

  // マテリアルの参照件数(削除前チェック用)。文書(form_data スナップショット)と
  //   条件明細(live FK)から、この素材がどれだけ参照されているかを返す。
  //   - condition_lines: source_material_id = mid の live リンク(金銭条件)。
  //   - documents: form_data に material_code を含む文書(v3_lcs 等のスナップショット)。
  //     material_code は一意で特徴的な文字列のため form_data::text の部分一致で拾う。
  async function materialReferences(mid: number): Promise<{
    material_code: string | null;
    condition_lines: number;
    documents: number;
    condition_line_rows: any[];
    document_rows: any[];
  }> {
    const m = await query(`SELECT id, material_code FROM work_materials WHERE id = $1`, [mid]);
    const materialCode = (m.rows[0]?.material_code as string) || null;
    const cl = await query(
      `SELECT cl.id, cl.line_code, cl.subject, cc.document_number
         FROM condition_lines cl
         JOIN contract_capabilities cc ON cc.id = cl.capability_id
        WHERE cl.source_material_id = $1
        ORDER BY cl.id`,
      [mid]
    );
    let docRows: any[] = [];
    if (materialCode) {
      const d = await query(
        `SELECT id, document_number, template_type
           FROM documents
          WHERE form_data::text ILIKE '%' || $1 || '%'
          ORDER BY id DESC
          LIMIT 50`,
        [materialCode]
      );
      docRows = d.rows;
    }
    return {
      material_code: materialCode,
      condition_lines: cl.rows.length,
      documents: docRows.length,
      condition_line_rows: cl.rows,
      document_rows: docRows,
    };
  }

  app.get("/api/v3/work-materials/:mid/references", ...requireRead, async (req, res) => {
    try {
      const mid = Number(req.params.mid);
      if (!Number.isFinite(mid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const refs = await materialReferences(mid);
      res.json({ ok: true, ...refs });
    } catch (e) { fail(res, e); }
  });

  // 安全削除: 文書/条件明細から参照中なら 409 でブロック(件数を返す)。
  //   ?force=true で強制削除 — この素材の condition_lines も一緒に削除する(不可逆)。
  //   文書(form_data)は履歴スナップショットのため触らない(コード不変の原則)。
  app.delete("/api/v3/work-materials/:mid", ...requireWrite, async (req, res) => {
    try {
      const mid = Number(req.params.mid);
      if (!Number.isFinite(mid)) return res.status(400).json({ ok: false, error: "invalid id" });
      const force = req.query.force === "true" || req.query.force === "1";
      const refs = await materialReferences(mid);
      if (!force && (refs.condition_lines > 0 || refs.documents > 0)) {
        return res.status(409).json({
          ok: false,
          error: "この素材は参照中のため削除できません",
          condition_lines: refs.condition_lines,
          documents: refs.documents,
          condition_line_rows: refs.condition_line_rows,
          document_rows: refs.document_rows,
        });
      }
      if (force && refs.condition_lines > 0) {
        await query(`DELETE FROM condition_lines WHERE source_material_id = $1`, [mid]);
      }
      const r = await query(`DELETE FROM work_materials WHERE id = $1`, [mid]);
      res.json({
        ok: true,
        deleted: r.rowCount || 0,
        deleted_condition_lines: force ? refs.condition_lines : 0,
      });
    } catch (e) { fail(res, e); }
  });

  // 原作(source_ips = works kind='licensed_in')の参照件数(削除前チェック)。
  //   マテリアル / 条件明細(source_work_id・work_id・素材経由) / 文書(form_data スナップショット)。
  async function sourceIpReferences(id: number): Promise<{
    work_code: string | null; title: string | null;
    materials: number; condition_lines: number; documents: number;
  } | null> {
    const w = await query(`SELECT id, work_code, title FROM works WHERE id = $1 AND kind = 'licensed_in'`, [id]);
    if (w.rows.length === 0) return null;
    const workCode = (w.rows[0].work_code as string) || null;
    const mats = await query(`SELECT COUNT(*)::int AS n FROM work_materials WHERE work_id = $1`, [id]);
    const cls = await query(
      `SELECT COUNT(*)::int AS n FROM condition_lines
        WHERE source_work_id = $1 OR work_id = $1
           OR source_material_id IN (SELECT id FROM work_materials WHERE work_id = $1)`,
      [id]
    );
    let docs = 0;
    if (workCode) {
      const d = await query(
        `SELECT COUNT(*)::int AS n FROM documents WHERE form_data::text ILIKE '%' || $1 || '%'`,
        [workCode]
      );
      docs = d.rows[0].n;
    }
    return {
      work_code: workCode, title: w.rows[0].title ?? null,
      materials: mats.rows[0].n, condition_lines: cls.rows[0].n, documents: docs,
    };
  }

  app.get("/api/v3/source-ips/:id/references", ...requireRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const refs = await sourceIpReferences(id);
      if (!refs) return res.status(404).json({ ok: false, error: "原作が見つかりません" });
      res.json({ ok: true, ...refs });
    } catch (e) { fail(res, e); }
  });

  // 原作の安全削除。参照(条件明細/文書)ありは 409 でブロック。?force=true で強制削除。
  //   強制時はトランザクションで: 条件明細 → contract_works → works(CASCADE で素材/カテゴリ/構成) →
  //   ledger の順に削除。文書(form_data スナップショット)は履歴として残す。
  app.delete("/api/v3/source-ips/:id", ...requireWrite, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
    const force = req.query.force === "true" || req.query.force === "1";
    try {
      const refs = await sourceIpReferences(id);
      if (!refs) return res.status(404).json({ ok: false, error: "原作が見つかりません" });
      if (!force && (refs.condition_lines > 0 || refs.documents > 0)) {
        return res.status(409).json({
          ok: false, error: "この原作は参照中のため削除できません",
          materials: refs.materials, condition_lines: refs.condition_lines, documents: refs.documents,
        });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `DELETE FROM condition_lines
            WHERE source_work_id = $1 OR work_id = $1
               OR source_material_id IN (SELECT id FROM work_materials WHERE work_id = $1)`,
          [id]
        );
        await client.query(`DELETE FROM contract_works WHERE work_id = $1 OR source_ip_id = $1`, [id]);
        const delWork = await client.query(
          `DELETE FROM works WHERE id = $1 AND kind = 'licensed_in' RETURNING id`, [id]
        );
        if (refs.work_code) {
          await client.query(`DELETE FROM ledgers WHERE ledger_code = $1`, [refs.work_code]);
        }
        await client.query("COMMIT");
        res.json({
          ok: true, deleted: delWork.rowCount || 0,
          deleted_condition_lines: refs.condition_lines, deleted_materials: refs.materials,
        });
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
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
  const ENTITIES = new Set<V3Entity>(["source-ips", "works", "contracts", "work-materials"]);

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
