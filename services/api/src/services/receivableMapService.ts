/**
 * receivableMapService — 作品/契約を中心にした「分配構造マップ」のデータ。
 *
 * 当社がサブライセンサーとなる構造を 3 層で表す:
 *   上流(原権利者/ライセンサー)  ← 当社が分配・支払(料率×受領額)
 *   当社(サブライセンサー)
 *   下流(サブライセンシー)        → 当社が受領(請求権 sublicense_deals)
 *
 * 分配額(ユーザー決定): 料率 × 受領額。
 *   料率 = 上流の個別利用許諾(license-in)の capability_financial_conditions
 *          condition_no=2(サブライセンス)の rate_pct。
 *   受領額 = その作品のサブライセンス受領(deal.net)合計。
 */

import { query } from "../lib/db.ts";
import { listDeals } from "./sublicenseService.ts";

const num = (v: any): number => (v == null || v === "" ? 0 : Number(v) || 0);
const d2s = (v: any): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : "";

export type WorkDistribution = {
  work: { id: number; title: string; work_code: string; is_original: boolean } | null;
  upstream: Array<{
    capability_id: number | null;
    document_number: string;
    licensor_name: string;
    source_ip_title: string;
    source_code: string;
    rate_pct: number | null;
    rate_basis: string; // 料率の適用基礎(region_language_label: サブライセンス/翻訳・海外版 等)
    mg_amount: number | null;
    distribute_amount: number | null; // 受領(サブライセンス)× rate
  }>;
  downstream: Array<{
    deal_id: number;
    receivable_kind: string;
    sublicensee_name: string;
    source_contract_number: string;
    received: number; // deal.net(受領予定総額)
    currency: string;
  }>;
  totals: {
    sublicense_received: number; // サブライセンス受領合計(分配の基礎)
    all_received: number; // 全請求権受領合計
    distributed: number; // 上流への分配合計
    retained: number; // 当社の留保(サブライセンス受領 − 分配)
    rate_known: boolean; // 上流料率が1つ以上判明しているか
  };
};

/** 作品単位の分配構造。 */
export async function getWorkDistribution(workId: number): Promise<WorkDistribution> {
  const empty: WorkDistribution = {
    work: null, upstream: [], downstream: [],
    totals: { sublicense_received: 0, all_received: 0, distributed: 0, retained: 0, rate_known: false },
  };
  if (!Number.isFinite(workId)) return empty;

  // 作品
  let work: any = null;
  try {
    const wr = await query(
      `SELECT id, title, work_code, COALESCE(is_original, TRUE) AS is_original FROM works WHERE id = $1`,
      [workId]
    );
    if (wr.rows.length) {
      const r = wr.rows[0];
      work = { id: Number(r.id), title: r.title || "", work_code: r.work_code || "", is_original: r.is_original === true };
    }
  } catch (err: any) {
    if (!(err && (err.code === "42P01" || err.code === "42703"))) throw err;
  }
  if (!work) return empty;

  const allDeals = await loadAllDeals();
  const node = await computeNode(work, allDeals);
  return {
    work,
    upstream: node.upstream,
    downstream: node.downstream,
    totals: {
      sublicense_received: node.sublicense_received,
      all_received: node.all_received,
      distributed: node.distributed,
      retained: node.sublicense_received - node.distributed,
      rate_known: node.rate_known,
    },
  };
}

// ── ノード(1作品)の上流分配・下流受領を計算(系譜マップで再利用)──────
type WorkRow = { id: number; title: string; work_code: string; is_original: boolean; derivation_type?: string | null; parent_work_id?: number | null };

async function loadAllDeals(): Promise<any[]> {
  try { return await listDeals(); } catch { return []; }
}

async function computeNode(work: WorkRow, allDeals: any[]) {
  const downstream = allDeals
    .filter((d: any) => Number(d.work_id) === work.id && d.status !== "closed")
    .map((d: any) => ({
      deal_id: d.id,
      receivable_kind: d.receivable_kind || "sublicense",
      sublicensee_name: d.sublicensee_name || "",
      source_contract_number: d.source_contract_number || "",
      received: num(d.net),
      currency: d.currency || "JPY",
    }));
  const sublicenseReceived = downstream
    .filter((r) => r.receivable_kind === "sublicense")
    .reduce((s, r) => s + r.received, 0);
  const allReceived = downstream.reduce((s, r) => s + r.received, 0);

  // 上流(当社→ライセンサー分配)= この作品の license-in/publication 明細(NOT inbound)の親契約 +
  //   「受領/受取ベース」金銭条件(サブライセンス/翻訳・海外版)の料率。
  let upstream: WorkDistribution["upstream"] = [];
  try {
    const ur = await query(
      `SELECT DISTINCT cc.id AS capability_id, cc.document_number, cc.contract_category,
              v.vendor_name AS licensor_name,
              si.title AS source_ip_title, si.source_code,
              fc.rate_pct, fc.mg_amount, fc.region_language_label AS rate_basis
         FROM capability_line_items cli
         JOIN contract_capabilities cc ON cc.id = cli.capability_id
         LEFT JOIN vendors v ON v.id = cc.vendor_id
         LEFT JOIN source_ips si ON si.id = cli.source_ip_id
         LEFT JOIN LATERAL (
           SELECT f.rate_pct, f.mg_amount, f.region_language_label
             FROM capability_financial_conditions f
            WHERE f.capability_id = cc.id
              AND (
                f.region_language_label ILIKE '%サブライセンス%'
                OR f.region_language_label ILIKE '%翻訳%'
                OR f.region_language_label ILIKE '%海外%'
                OR f.base_price_label ILIKE '%受領%' OR f.base_price_label ILIKE '%受取%'
                OR f.formula_text ILIKE '%受領%'   OR f.formula_text ILIKE '%受取%'
                OR (cc.contract_category ILIKE 'license%' AND f.condition_no = 2)
              )
            ORDER BY f.rate_pct DESC NULLS LAST
            LIMIT 1
         ) fc ON TRUE
        WHERE cli.work_id = $1
          AND COALESCE(cli.is_inbound, FALSE) = FALSE
          AND (cc.contract_category ILIKE 'license%' OR cc.contract_category = 'publication')`,
      [work.id]
    );
    upstream = ur.rows.map((r: any) => {
      const rate = r.rate_pct == null ? null : Number(r.rate_pct);
      return {
        capability_id: r.capability_id == null ? null : Number(r.capability_id),
        document_number: r.document_number || "",
        licensor_name: r.licensor_name || "",
        source_ip_title: r.source_ip_title || "",
        source_code: r.source_code || "",
        rate_pct: rate,
        rate_basis: r.rate_basis || "",
        mg_amount: r.mg_amount == null ? null : Number(r.mg_amount),
        distribute_amount: rate == null ? null : Math.round(sublicenseReceived * (rate / 100)),
      };
    });
  } catch (err: any) {
    if (!(err && (err.code === "42P01" || err.code === "42703"))) throw err;
    upstream = [];
  }
  const distributed = upstream.reduce((s, u) => s + (u.distribute_amount || 0), 0);
  return {
    upstream,
    downstream,
    sublicense_received: sublicenseReceived,
    all_received: allReceived,
    distributed,
    rate_known: upstream.some((u) => u.rate_pct != null),
  };
}

export type WorkLineage = {
  selected_work_id: number;
  chain: Array<{
    work: WorkRow;
    derivation_type: string | null;
    upstream: WorkDistribution["upstream"];
    downstream: WorkDistribution["downstream"];
    received: number;       // この作品のサブライセンス受領
    all_received: number;
    distributed: number;
  }>;
  children: Array<{ id: number; work_code: string; title: string; derivation_type: string | null }>;
  totals: { received: number; distributed: number; retained: number };
};

async function loadWorkRow(id: number): Promise<WorkRow | null> {
  try {
    const r = await query(
      `SELECT id, title, work_code, COALESCE(is_original, TRUE) AS is_original,
              parent_work_id, derivation_type
         FROM works WHERE id = $1`,
      [id]
    );
    if (!r.rows.length) return null;
    const x = r.rows[0];
    return {
      id: Number(x.id), title: x.title || "", work_code: x.work_code || "",
      is_original: x.is_original === true,
      parent_work_id: x.parent_work_id == null ? null : Number(x.parent_work_id),
      derivation_type: x.derivation_type || null,
    };
  } catch (err: any) {
    if (err && (err.code === "42P01" || err.code === "42703")) return null;
    throw err;
  }
}

/** 作品の派生系譜(root→selected)＋直下の派生作品。多段分配を段ごとに表示する用。 */
export async function getWorkLineage(workId: number): Promise<WorkLineage> {
  const empty: WorkLineage = { selected_work_id: workId, chain: [], children: [], totals: { received: 0, distributed: 0, retained: 0 } };
  if (!Number.isFinite(workId)) return empty;
  const selected = await loadWorkRow(workId);
  if (!selected) return empty;

  // 祖先チェーン(selected→…→root)を作り反転(root→selected)。循環/暴走ガード。
  const chainRows: WorkRow[] = [];
  const seen = new Set<number>();
  let cur: WorkRow | null = selected;
  for (let i = 0; i < 20 && cur; i++) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    chainRows.push(cur);
    cur = cur.parent_work_id ? await loadWorkRow(cur.parent_work_id) : null;
  }
  chainRows.reverse(); // root → selected

  // 直下の派生作品(子)
  let children: WorkLineage["children"] = [];
  try {
    const cr = await query(
      `SELECT id, work_code, title, derivation_type FROM works WHERE parent_work_id = $1 ORDER BY id`,
      [workId]
    );
    children = cr.rows.map((r: any) => ({
      id: Number(r.id), work_code: r.work_code || "", title: r.title || "", derivation_type: r.derivation_type || null,
    }));
  } catch { children = []; }

  const allDeals = await loadAllDeals();
  const chain = [];
  for (const w of chainRows) {
    const node = await computeNode(w, allDeals);
    chain.push({
      work: w,
      derivation_type: w.derivation_type || null,
      upstream: node.upstream,
      downstream: node.downstream,
      received: node.sublicense_received,
      all_received: node.all_received,
      distributed: node.distributed,
    });
  }
  const received = chain.reduce((s, n) => s + n.received, 0);
  const distributed = chain.reduce((s, n) => s + n.distributed, 0);
  return { selected_work_id: workId, chain, children, totals: { received, distributed, retained: received - distributed } };
}

/** マップ対象になりうる作品(請求権 deal がある作品)の一覧(ピッカー用)。 */
export async function listMappableWorks(): Promise<Array<{ id: number; work_code: string; title: string; deal_count: number }>> {
  try {
    const res = await query(
      `SELECT w.id, w.work_code, w.title, COUNT(d.id)::int AS deal_count
         FROM works w
         JOIN sublicense_deals d ON d.work_id = w.id AND d.status <> 'closed'
        GROUP BY w.id, w.work_code, w.title
        ORDER BY w.work_code DESC NULLS LAST, w.id DESC
        LIMIT 1000`
    );
    return res.rows.map((r: any) => ({
      id: Number(r.id),
      work_code: r.work_code || "",
      title: r.title || "",
      deal_count: Number(r.deal_count) || 0,
    }));
  } catch (err: any) {
    if (err && (err.code === "42P01" || err.code === "42703")) return [];
    throw err;
  }
}

/** 契約番号(document_number)から関連作品を引く(契約起点のマップ用)。 */
export async function worksByContractNumber(docNumber: string): Promise<Array<{ id: number; work_code: string; title: string }>> {
  if (!docNumber) return [];
  try {
    const res = await query(
      `SELECT DISTINCT w.id, w.work_code, w.title
         FROM capability_line_items cli
         JOIN contract_capabilities cc ON cc.id = cli.capability_id
         JOIN works w ON w.id = cli.work_id
        WHERE cc.document_number = $1
        ORDER BY w.work_code`,
      [docNumber]
    );
    return res.rows.map((r: any) => ({ id: Number(r.id), work_code: r.work_code || "", title: r.title || "" }));
  } catch (err: any) {
    if (err && (err.code === "42P01" || err.code === "42703")) return [];
    throw err;
  }
}

export const _internal = { num, d2s };
