/**
 * receivableMapService — 作品/契約を中心にした「分配構造マップ」のデータ。
 *
 * 当社がサブライセンサーとなる構造を 3 層で表す:
 *   上流(原権利者/ライセンサー)  ← 当社が分配・支払(料率×受領額)
 *   当社(サブライセンサー)
 *   下流(サブライセンシー)        → 当社が受領(サブライセンス条件明細 OUT + condition_receipts)
 *
 * 分配額(ユーザー決定): 料率 × 受領額。
 *   料率 = 上流の個別利用許諾(license-in)の capability_financial_conditions
 *          condition_no=2(サブライセンス)の rate_pct。
 *   受領額 = その作品のサブライセンス受領(condition_kind='sublicense_out' の
 *           condition_receipts 受領/計算合計)。
 */

import { query } from "../lib/db.ts";

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
    inherited?: boolean; // 上位段で計上済み(二重計上回避)
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

// 下流受領 = サブライセンス条件明細(OUT) ごとの受領合計(condition_receipts)。
//   旧 sublicense_deals から condition_kind='sublicense_out' + condition_receipts へ刷新。
//   返却 shape は従来 deal 互換({ id, work_id, receivable_kind, sublicensee_name, net, currency, status })。
async function loadAllDeals(): Promise<any[]> {
  try {
    const r = await query(
      `SELECT cfc.id, cfc.work_id,
              'sublicense' AS receivable_kind,
              COALESCE(v.vendor_name, '') AS sublicensee_name,
              '' AS source_contract_number,
              COALESCE(cfc.currency, 'JPY') AS currency,
              'active' AS status,
              COALESCE(SUM(COALESCE(cr.received_amount, cr.computed_royalty_ex_tax)), 0) AS net
         FROM capability_financial_conditions cfc
         LEFT JOIN vendors v ON v.id = cfc.counterparty_vendor_id
         LEFT JOIN condition_receipts cr ON cr.condition_id = cfc.id
        WHERE cfc.condition_kind = 'sublicense_out'
        GROUP BY cfc.id, cfc.work_id, v.vendor_name, cfc.currency`
    );
    return r.rows.map((d: any) => ({ ...d, net: Number(d.net) || 0 }));
  } catch (err: any) {
    if (err && (err.code === "42P01" || err.code === "42703")) return [];
    return [];
  }
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
         JOIN documents cc ON cc.id = cli.capability_id
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
    received: number;       // この作品のサブライセンス受領(直接)
    all_received: number;
    distributed: number;    // cascade 後の上流分配合計
    cascade_base: number;   // この段の分配基礎(この段〜最下段の受領合計)
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
  const chain = [] as WorkLineage["chain"];
  for (const w of chainRows) {
    const node = await computeNode(w, allDeals);
    chain.push({
      work: w,
      derivation_type: w.derivation_type || null,
      upstream: node.upstream,
      downstream: node.downstream,
      received: node.sublicense_received,
      all_received: node.all_received,
      distributed: node.distributed, // 直接(後で cascade に上書き)
      cascade_base: 0,
    });
  }

  // 段跨ぎの伝播(cascade): 下位(より派生)で受領した金額は上位の各段の上流へも
  //   流れる。tier i の分配基礎 = i 段から最下段(selected)までの受領合計。
  //   各段の上流分配 = 料率 × cascade_base。これで「K受領→A→C」が各段の料率で
  //   伝播する(各段は当社が当事者なので並列の分配義務として算出)。
  const seenCap = new Set<number>(); // 同一の上流契約(capability)を複数段で二重計上しない
  for (let i = 0; i < chain.length; i++) {
    let base = 0;
    for (let j = i; j < chain.length; j++) base += chain[j].received;
    chain[i].cascade_base = base;
    chain[i].upstream = chain[i].upstream.map((u: any) => {
      const cap = u.capability_id;
      const inherited = cap != null && seenCap.has(cap); // 上位段で計上済み
      if (cap != null) seenCap.add(cap);
      return {
        ...u,
        inherited,
        distribute_amount: inherited ? 0 : (u.rate_pct == null ? null : Math.round(base * (u.rate_pct / 100))),
      };
    });
    chain[i].distributed = chain[i].upstream.reduce((s, u) => s + (u.distribute_amount || 0), 0);
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
         JOIN capability_financial_conditions d ON d.work_id = w.id AND d.condition_kind = 'sublicense_out'
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

// ── 作品タイトル別名(他社/改題タイトルの名寄せ)──────────────────
export async function listWorkAliases(workId: number): Promise<any[]> {
  try {
    const res = await query(
      `SELECT a.id, a.work_id, a.alias_title, a.party_vendor_id, v.vendor_name AS party_name, a.context
         FROM work_title_aliases a
         LEFT JOIN vendors v ON v.id = a.party_vendor_id
        WHERE a.work_id = $1 ORDER BY a.id`,
      [workId]
    );
    return res.rows.map((r: any) => ({
      id: Number(r.id), work_id: Number(r.work_id), alias_title: r.alias_title || "",
      party_vendor_id: r.party_vendor_id == null ? null : Number(r.party_vendor_id),
      party_name: r.party_name || "", context: r.context || "",
    }));
  } catch (err: any) {
    if (err && (err.code === "42P01" || err.code === "42703")) return [];
    throw err;
  }
}

export async function addWorkAlias(workId: number, aliasTitle: string, partyVendorId?: number | null, context?: string | null): Promise<number> {
  const res = await query(
    `INSERT INTO work_title_aliases (work_id, alias_title, party_vendor_id, context)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [workId, aliasTitle, partyVendorId ?? null, context ?? null]
  );
  return Number(res.rows[0].id);
}

export async function deleteWorkAlias(id: number): Promise<void> {
  await query(`DELETE FROM work_title_aliases WHERE id = $1`, [id]);
}

/** タイトル文字列(他社/改題含む)から作品候補を解決する。利用報告の名寄せ用。 */
export async function resolveWorksByTitle(q: string): Promise<Array<{ id: number; work_code: string; title: string; matched_via: string; matched_text: string }>> {
  const term = (q || "").trim();
  if (!term) return [];
  const like = `%${term}%`;
  const out: Record<number, any> = {};
  // 正式タイトル / 別タイトル(alternative_titles)
  try {
    const r = await query(
      `SELECT id, work_code, title,
              CASE WHEN title ILIKE $1 THEN 'title' ELSE 'alternative_title' END AS matched_via,
              title AS matched_text
         FROM works
        WHERE title ILIKE $1
           OR EXISTS (SELECT 1 FROM unnest(COALESCE(alternative_titles,'{}')) t WHERE t ILIKE $1)
        ORDER BY work_code DESC NULLS LAST LIMIT 50`,
      [like]
    );
    for (const x of r.rows) out[Number(x.id)] = { id: Number(x.id), work_code: x.work_code || "", title: x.title || "", matched_via: x.matched_via, matched_text: x.matched_text || "" };
  } catch (err: any) {
    if (!(err && (err.code === "42P01" || err.code === "42703"))) throw err;
  }
  // 名寄せ別名(work_title_aliases)
  try {
    const r = await query(
      `SELECT w.id, w.work_code, w.title, a.alias_title
         FROM work_title_aliases a JOIN works w ON w.id = a.work_id
        WHERE a.alias_title ILIKE $1 LIMIT 50`,
      [like]
    );
    for (const x of r.rows) {
      const id = Number(x.id);
      // 別名ヒットは優先表示(matched_text にヒットした別名を出す)
      out[id] = { id, work_code: x.work_code || "", title: x.title || "", matched_via: "alias", matched_text: x.alias_title || "" };
    }
  } catch (err: any) {
    if (!(err && (err.code === "42P01" || err.code === "42703"))) throw err;
  }
  return Object.values(out);
}

/** 契約番号(document_number)から関連作品を引く(契約起点のマップ用)。 */
export async function worksByContractNumber(docNumber: string): Promise<Array<{ id: number; work_code: string; title: string }>> {
  if (!docNumber) return [];
  try {
    const res = await query(
      `SELECT DISTINCT w.id, w.work_code, w.title
         FROM capability_line_items cli
         JOIN documents cc ON cc.id = cli.capability_id
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
