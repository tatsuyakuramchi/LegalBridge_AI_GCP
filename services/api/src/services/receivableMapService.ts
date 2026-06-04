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

  // 下流(当社受領)= この作品の請求権 deal
  let deals: any[] = [];
  try {
    deals = (await listDeals()).filter((d: any) => Number(d.work_id) === workId && d.status !== "closed");
  } catch {
    deals = [];
  }
  const downstream = deals.map((d: any) => ({
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

  // 上流(当社→ライセンサー分配)= この作品の license-in 明細(NOT inbound, category license)
  //   の親契約 + condition_no=2(サブライセンス)の料率。
  let upstream: WorkDistribution["upstream"] = [];
  try {
    // 分配率 = 「当社の受領を基礎に上流へ分配する」金銭条件。
    //   license:     condition_no=2(サブライセンス)
    //   publication: condition_no=3(翻訳・海外版=被許諾者受取ライセンス収益×料率)
    //                / 2(電子書籍=被許諾者受領額×料率)
    //   契約類型で番号が違うため、condition_no 決め打ちではなく
    //   「受領/受取ベース」や region ラベル(サブライセンス/翻訳/海外)で拾う。
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
      [workId]
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
  const rateKnown = upstream.some((u) => u.rate_pct != null);

  return {
    work,
    upstream,
    downstream,
    totals: {
      sublicense_received: sublicenseReceived,
      all_received: allReceived,
      distributed,
      retained: sublicenseReceived - distributed,
      rate_known: rateKnown,
    },
  };
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
