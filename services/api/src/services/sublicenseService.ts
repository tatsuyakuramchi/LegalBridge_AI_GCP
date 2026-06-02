/**
 * sublicenseService — サブライセンス受領管理(第1段)。
 *
 * 「作品 × サブライセンシー」単位の受領条件(sublicense_deals)を扱い、
 * 受領予定(各回)を算出して『受領予定一覧』に展開する。
 *
 * 算定(第1段。実績売上は第2段で sales_reports から差し替え):
 *   royalty   = basis='sales'         ? rate% × forecast_amount
 *               basis='manufacturing' ? rate% × unit_price × forecast_amount
 *   gross     = max(royalty, mg_amount)        … MG は下限(最低保証)
 *   net_total = max(gross − advance_amount, 0)  … 前払 / AG を相殺
 *   各回      = net_total を期間内の受領回数で均等割り(端数は最終回で調整)
 */

import { query } from "../lib/db.ts";

export type SublicenseDeal = {
  id?: number;
  work_id?: number | null;
  sublicensee_id?: number | null;
  inline_sublicensee_name?: string | null;
  source_contract_number?: string | null;
  basis?: string; // sales | manufacturing
  rate_pct?: number | null;
  unit_price?: number | null;
  forecast_amount?: number | null;
  mg_amount?: number | null;
  advance_amount?: number | null;
  currency?: string;
  cycle?: string; // MONTHLY | QUARTERLY | SEMIANNUAL | ANNUAL | CUSTOM
  interval_unit?: string | null; // MONTH | DAY
  interval_count?: number | null;
  billing_day?: number | null;
  term_start?: string | null;
  term_end?: string | null;
  status?: string;
  remarks?: string | null;
};

const num = (v: any): number => (v == null || v === "" ? 0 : Number(v) || 0);
const numOrNull = (v: any): number | null =>
  v == null || v === "" ? null : Number(v);
const d2s = (v: any): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : "";

// ── スケジュール生成(条件明細サブスクと同じ規則)──────────────
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function isDayBased(deal: SublicenseDeal): boolean {
  return deal.cycle === "CUSTOM" && deal.interval_unit === "DAY";
}
function stepDate(base: Date, deal: SublicenseDeal): Date {
  const r = new Date(base);
  if (deal.cycle === "CUSTOM") {
    const n = Math.max(1, Number(deal.interval_count) || 1);
    if (deal.interval_unit === "DAY") r.setDate(r.getDate() + n);
    else r.setMonth(r.getMonth() + n);
  } else {
    const m =
      deal.cycle === "QUARTERLY" ? 3 : deal.cycle === "SEMIANNUAL" ? 6 : deal.cycle === "ANNUAL" ? 12 : 1;
    r.setMonth(r.getMonth() + m);
  }
  return r;
}
function applyBillingDay(d: Date, billingDay?: number | null): Date {
  if (billingDay == null) return d;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const day = billingDay === 0 || billingDay > 30 ? last : Math.min(billingDay, last);
  return new Date(d.getFullYear(), d.getMonth(), day);
}

/** 受領予定の日付リスト(term から周期で展開。最大 600 回)。 */
function receiptDates(deal: SublicenseDeal): string[] {
  if (!deal.term_start) return [];
  const start = new Date(`${deal.term_start}T00:00:00`);
  if (isNaN(start.getTime())) return [];
  const end = deal.term_end ? new Date(`${deal.term_end}T00:00:00`) : null;
  const dayBased = isDayBased(deal);
  const out: string[] = [];
  let cur = new Date(start);
  for (let i = 0; i < 600; i++) {
    const pay = dayBased ? cur : applyBillingDay(cur, deal.billing_day);
    if (end && pay.getTime() > end.getTime()) break;
    out.push(toISO(pay));
    if (!end) {
      // 終了日が無い場合は 1 年分(周期に応じた既定回数)で打ち切り
      const def =
        deal.cycle === "MONTHLY" ? 12 : deal.cycle === "QUARTERLY" ? 4 : deal.cycle === "SEMIANNUAL" ? 2 : deal.cycle === "ANNUAL" ? 1 : 12;
      if (out.length >= def) break;
    }
    cur = stepDate(cur, deal);
  }
  return out;
}

/** 受領予定総額(net)を算定。 */
export function computeNetTotal(deal: SublicenseDeal): { royalty: number; gross: number; net: number } {
  const rate = num(deal.rate_pct) / 100;
  const royalty =
    (deal.basis || "sales") === "manufacturing"
      ? rate * num(deal.unit_price) * num(deal.forecast_amount)
      : rate * num(deal.forecast_amount);
  const gross = Math.max(royalty, num(deal.mg_amount));
  const net = Math.max(gross - num(deal.advance_amount), 0);
  return { royalty: Math.round(royalty), gross: Math.round(gross), net: Math.round(net) };
}

/** 1 deal を受領予定の各回(date, amount)に展開。 */
export function expandReceipts(
  deal: SublicenseDeal
): Array<{ date: string; amount: number }> {
  const dates = receiptDates(deal);
  if (dates.length === 0) return [];
  const { net } = computeNetTotal(deal);
  const per = Math.floor(net / dates.length);
  const rows = dates.map((date) => ({ date, amount: per }));
  // 端数は最終回に寄せる
  const remainder = net - per * dates.length;
  if (rows.length > 0) rows[rows.length - 1].amount += remainder;
  return rows;
}

const SELECT_DEAL = `
  SELECT d.*,
         w.title AS work_title, w.work_code,
         COALESCE(s.name, d.inline_sublicensee_name) AS sublicensee_name,
         s.category AS sublicensee_category
    FROM sublicense_deals d
    LEFT JOIN works w ON w.id = d.work_id
    LEFT JOIN sublicensees s ON s.id = d.sublicensee_id`;

function mapDeal(r: any) {
  return {
    id: Number(r.id),
    work_id: r.work_id == null ? null : Number(r.work_id),
    work_title: r.work_title || "",
    work_code: r.work_code || "",
    sublicensee_id: r.sublicensee_id == null ? null : Number(r.sublicensee_id),
    sublicensee_name: r.sublicensee_name || "",
    sublicensee_category: r.sublicensee_category || "",
    inline_sublicensee_name: r.inline_sublicensee_name || "",
    source_contract_number: r.source_contract_number || "",
    basis: r.basis || "sales",
    rate_pct: numOrNull(r.rate_pct),
    unit_price: numOrNull(r.unit_price),
    forecast_amount: numOrNull(r.forecast_amount),
    mg_amount: numOrNull(r.mg_amount),
    advance_amount: numOrNull(r.advance_amount),
    currency: r.currency || "JPY",
    cycle: r.cycle || "QUARTERLY",
    interval_unit: r.interval_unit || null,
    interval_count: numOrNull(r.interval_count),
    billing_day: numOrNull(r.billing_day),
    term_start: d2s(r.term_start),
    term_end: d2s(r.term_end),
    status: r.status || "active",
    remarks: r.remarks || "",
  };
}

export async function listDeals(): Promise<any[]> {
  try {
    const res = await query(`${SELECT_DEAL} ORDER BY d.updated_at DESC, d.id DESC`);
    return res.rows.map(mapDeal).map((d: any) => ({ ...d, ...computeNetTotal(d) }));
  } catch (err: any) {
    if (err && (err.code === "42P01" || err.code === "42703")) return [];
    throw err;
  }
}

export async function upsertDeal(deal: SublicenseDeal): Promise<number> {
  const cols = [
    "work_id", "sublicensee_id", "inline_sublicensee_name", "source_contract_number",
    "basis", "rate_pct", "unit_price", "forecast_amount", "mg_amount", "advance_amount",
    "currency", "cycle", "interval_unit", "interval_count", "billing_day",
    "term_start", "term_end", "status", "remarks",
  ];
  const vals = [
    deal.work_id ?? null,
    deal.sublicensee_id ?? null,
    deal.inline_sublicensee_name || null,
    deal.source_contract_number || null,
    deal.basis || "sales",
    numOrNull(deal.rate_pct),
    numOrNull(deal.unit_price),
    numOrNull(deal.forecast_amount),
    numOrNull(deal.mg_amount),
    numOrNull(deal.advance_amount),
    deal.currency || "JPY",
    deal.cycle || "QUARTERLY",
    deal.interval_unit || null,
    numOrNull(deal.interval_count),
    numOrNull(deal.billing_day),
    deal.term_start || null,
    deal.term_end || null,
    deal.status || "active",
    deal.remarks || null,
  ];
  if (deal.id) {
    const set = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
    await query(
      `UPDATE sublicense_deals SET ${set}, updated_at = now() WHERE id = $1`,
      [deal.id, ...vals]
    );
    return deal.id;
  }
  const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
  const res = await query(
    `INSERT INTO sublicense_deals (${cols.join(", ")}) VALUES (${ph}) RETURNING id`,
    vals
  );
  return Number(res.rows[0].id);
}

export async function deleteDeal(id: number): Promise<void> {
  await query(`DELETE FROM sublicense_deals WHERE id = $1`, [id]);
}

export type ReceiptFilters = {
  from?: string;
  to?: string;
  sublicensee?: string;
  work?: string;
  q?: string;
  ids?: string[]; // 受領予定行の "deal:index" 形式 row_id(CSV選択用)
};

/** 全 active deal を受領予定の各回に展開した一覧。 */
export async function listReceipts(f: ReceiptFilters): Promise<{ rows: any[]; total: number }> {
  const deals = (await listDeals()).filter((d: any) => d.status !== "closed");
  const rows: any[] = [];
  for (const d of deals) {
    const sched = expandReceipts(d);
    sched.forEach((s, idx) => {
      rows.push({
        row_id: `${d.id}:${idx}`,
        deal_id: d.id,
        seq: idx + 1,
        of: sched.length,
        receipt_date: s.date,
        amount: s.amount,
        currency: d.currency,
        work_title: d.work_title,
        work_code: d.work_code,
        sublicensee_name: d.sublicensee_name,
        source_contract_number: d.source_contract_number,
        basis: d.basis,
        rate_pct: d.rate_pct,
        mg_amount: d.mg_amount,
        advance_amount: d.advance_amount,
        net_total: d.net,
      });
    });
  }
  // フィルタ
  let out = rows;
  if (f.from) out = out.filter((r) => r.receipt_date >= f.from!);
  if (f.to) out = out.filter((r) => r.receipt_date <= f.to!);
  if (f.sublicensee) {
    const q = f.sublicensee.toLowerCase();
    out = out.filter((r) => (r.sublicensee_name || "").toLowerCase().includes(q));
  }
  if (f.work) {
    const q = f.work.toLowerCase();
    out = out.filter(
      (r) => (r.work_title || "").toLowerCase().includes(q) || (r.work_code || "").toLowerCase().includes(q)
    );
  }
  if (f.q) {
    const q = f.q.toLowerCase();
    out = out.filter(
      (r) =>
        (r.work_title || "").toLowerCase().includes(q) ||
        (r.sublicensee_name || "").toLowerCase().includes(q) ||
        (r.source_contract_number || "").toLowerCase().includes(q)
    );
  }
  if (Array.isArray(f.ids) && f.ids.length) {
    const set = new Set(f.ids.map(String));
    out = out.filter((r) => set.has(r.row_id));
  }
  out.sort((a, b) => (a.receipt_date < b.receipt_date ? -1 : a.receipt_date > b.receipt_date ? 1 : 0));
  return { rows: out, total: out.length };
}

const csvCell = (v: any): string => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportReceiptsCsv(f: ReceiptFilters): Promise<string> {
  const { rows } = await listReceipts(f);
  const headers = [
    "受領予定日", "サブライセンシー", "作品コード", "作品", "参照契約番号",
    "基準", "料率(%)", "回", "金額", "通貨", "MG総額", "前払", "受領予定総額(net)",
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.receipt_date, r.sublicensee_name, r.work_code, r.work_title, r.source_contract_number,
        r.basis === "manufacturing" ? "製造数" : "売上", r.rate_pct ?? "",
        `${r.seq}/${r.of}`, r.amount, r.currency, r.mg_amount ?? "", r.advance_amount ?? "", r.net_total,
      ].map(csvCell).join(",")
    );
  }
  return "﻿" + lines.join("\r\n");
}

/** ピッカー用: サブライセンシー一覧。 */
export async function listSublicenseeOptions(): Promise<any[]> {
  try {
    const res = await query(
      `SELECT id, name, category FROM sublicensees WHERE is_active <> FALSE ORDER BY name`
    );
    return res.rows.map((r: any) => ({ id: Number(r.id), name: r.name || "", category: r.category || "" }));
  } catch (err: any) {
    if (err && (err.code === "42P01" || err.code === "42703")) return [];
    throw err;
  }
}

/** ピッカー用: 作品一覧。 */
export async function listWorkOptions(): Promise<any[]> {
  try {
    const res = await query(
      `SELECT id, work_code, title FROM works ORDER BY work_code DESC NULLS LAST, id DESC LIMIT 2000`
    );
    return res.rows.map((r: any) => ({ id: Number(r.id), work_code: r.work_code || "", title: r.title || "" }));
  } catch (err: any) {
    if (err && (err.code === "42P01" || err.code === "42703")) return [];
    throw err;
  }
}
