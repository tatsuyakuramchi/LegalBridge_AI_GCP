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
  receivable_kind?: string; // sublicense | publication | license_out | service | other
  work_id?: number | null;
  sublicensee_id?: number | null;
  inline_sublicensee_name?: string | null;
  counterparty_name?: string | null; // サブライセンシー以外の相手方名
  counterparty_vendor_id?: number | null;
  source_contract_id?: number | null;
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

/** 1 deal を受領予定の各回に展開(売上報告があれば実績ベース)。
 *  モデル: 各回ロイヤリティ = 実績(料率×実売上[×単価]) or 見込の均等割り。
 *          MG(最低保証)= 期末までの累計が MG 未満なら最終回に不足分を上乗せ(下限保証)。
 *          前払/AG = 既受領の前払として最も早い回から相殺。
 */
export function buildReceiptRows(
  deal: SublicenseDeal,
  reports: any[]
): Array<{
  date: string;
  amount: number;
  estimated: boolean;
  mg_topup: number;
  advance_applied: number;
  reported_sales: number | null;
  reported_quantity: number | null;
}> {
  const dates = receiptDates(deal);
  if (dates.length === 0) return [];
  const rate = num(deal.rate_pct) / 100;
  const isMfg = (deal.basis || "sales") === "manufacturing";
  const repByDate: Record<string, any> = {};
  (reports || []).forEach((r) => {
    repByDate[d2s(r.period_date)] = r;
  });

  const rows = dates.map((date) => {
    const rep = repByDate[date];
    const hasActual =
      rep != null && (rep.reported_sales != null || rep.reported_quantity != null);
    if (hasActual) {
      const royalty = isMfg
        ? rate * num(deal.unit_price) * num(rep.reported_quantity)
        : rate * num(rep.reported_sales);
      return {
        date,
        amount: Math.round(royalty),
        estimated: false,
        mg_topup: 0,
        advance_applied: 0,
        reported_sales: rep.reported_sales == null ? null : Number(rep.reported_sales),
        reported_quantity: rep.reported_quantity == null ? null : Number(rep.reported_quantity),
      };
    }
    return {
      date,
      amount: 0,
      estimated: true,
      mg_topup: 0,
      advance_applied: 0,
      reported_sales: null as number | null,
      reported_quantity: null as number | null,
    };
  });

  // 見込ロイヤリティを未報告の回に均等配分
  const forecastTotal = isMfg
    ? rate * num(deal.unit_price) * num(deal.forecast_amount)
    : rate * num(deal.forecast_amount);
  if (forecastTotal > 0) {
    const share = Math.floor(forecastTotal / dates.length);
    rows.forEach((r) => {
      if (r.estimated) r.amount = share;
    });
  }

  // MG 最低保証: 累計 < MG なら最終回に不足分を上乗せ
  let sum = rows.reduce((s, r) => s + r.amount, 0);
  const mg = num(deal.mg_amount);
  if (sum < mg && rows.length > 0) {
    const topup = mg - sum;
    rows[rows.length - 1].amount += topup;
    rows[rows.length - 1].mg_topup = topup;
    sum = mg;
  }

  // 前払/AG 相殺(最も早い回から)
  let adv = num(deal.advance_amount);
  for (const r of rows) {
    if (adv <= 0) break;
    const cut = Math.min(adv, r.amount);
    r.amount -= cut;
    r.advance_applied += cut;
    adv -= cut;
  }

  return rows;
}

/** 後方互換: 売上報告なしの展開(第1段)。 */
export function expandReceipts(deal: SublicenseDeal): Array<{ date: string; amount: number }> {
  return buildReceiptRows(deal, []).map((r) => ({ date: r.date, amount: r.amount }));
}

// ── 売上報告 CRUD ───────────────────────────────────────────────
export async function listReportsByDeal(dealId: number): Promise<any[]> {
  try {
    const res = await query(
      `SELECT id, deal_id, period_date, reported_sales, reported_quantity, note, reported_at
         FROM sublicense_sales_reports WHERE deal_id = $1 ORDER BY period_date`,
      [dealId]
    );
    return res.rows.map((r: any) => ({
      id: Number(r.id),
      deal_id: Number(r.deal_id),
      period_date: d2s(r.period_date),
      reported_sales: numOrNull(r.reported_sales),
      reported_quantity: numOrNull(r.reported_quantity),
      note: r.note || "",
    }));
  } catch (err: any) {
    if (err && (err.code === "42P01" || err.code === "42703")) return [];
    throw err;
  }
}

async function loadReportsMap(): Promise<Record<number, any[]>> {
  const map: Record<number, any[]> = {};
  try {
    const res = await query(
      `SELECT deal_id, period_date, reported_sales, reported_quantity FROM sublicense_sales_reports`
    );
    for (const r of res.rows) {
      const k = Number(r.deal_id);
      (map[k] = map[k] || []).push(r);
    }
  } catch (err: any) {
    if (!(err && (err.code === "42P01" || err.code === "42703"))) throw err;
  }
  return map;
}

export async function upsertReport(rep: {
  deal_id: number;
  period_date: string;
  reported_sales?: number | null;
  reported_quantity?: number | null;
  note?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO sublicense_sales_reports (deal_id, period_date, reported_sales, reported_quantity, note)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (deal_id, period_date) DO UPDATE SET
       reported_sales = EXCLUDED.reported_sales,
       reported_quantity = EXCLUDED.reported_quantity,
       note = EXCLUDED.note,
       updated_at = now()`,
    [
      rep.deal_id,
      rep.period_date,
      numOrNull(rep.reported_sales),
      numOrNull(rep.reported_quantity),
      rep.note || null,
    ]
  );
}

export async function deleteReport(dealId: number, periodDate: string): Promise<void> {
  await query(`DELETE FROM sublicense_sales_reports WHERE deal_id = $1 AND period_date = $2`, [
    dealId,
    periodDate,
  ]);
}

// ── 受領確定 → payments(inbound / sublicense_income)台帳 ───────────
/** 確定済みの受領を `${deal_id}:${period_date}` で引けるマップ。 */
async function confirmedMap(): Promise<Record<string, boolean>> {
  const map: Record<string, boolean> = {};
  try {
    const res = await query(
      `SELECT sublicense_deal_id, due_date FROM payments
        WHERE direction = 'inbound' AND payment_kind = 'sublicense_income'
          AND sublicense_deal_id IS NOT NULL`
    );
    for (const r of res.rows) map[`${Number(r.sublicense_deal_id)}:${d2s(r.due_date)}`] = true;
  } catch (err: any) {
    if (!(err && (err.code === "42P01" || err.code === "42703"))) throw err;
  }
  return map;
}

/** 受領を確定して payments に記録(冪等: payment_no = SLI-<deal>-<date>)。 */
export async function confirmReceipt(dealId: number, periodDate: string): Promise<void> {
  const deals = await listDeals();
  const deal = deals.find((d: any) => d.id === dealId);
  if (!deal) throw new Error("受領条件が見つかりません");
  if (!deal.work_id) throw new Error("作品が未設定の条件は受領確定できません(条件に作品を設定してください)");
  const reports = await listReportsByDeal(dealId);
  const row = buildReceiptRows(deal, reports).find((r) => r.date === periodDate);
  if (!row) throw new Error("該当の受領予定回が見つかりません");
  const amount = row.amount;
  const cur = deal.currency || "JPY";
  const amountJpy = amount; // fx 換算は将来対応(JPY 前提)
  const paymentNo = `SLI-${dealId}-${periodDate}`;
  const period = periodDate.slice(0, 7);
  await query(
    `INSERT INTO payments
       (payment_no, direction, payment_kind, work_id, period,
        amount_ex_tax, total_amount, currency, amount_jpy, status, due_date, paid_date,
        source_document_number, sublicense_deal_id)
     VALUES ($1, 'inbound', 'sublicense_income', $2, $3, $4, $4, $5, $6, 'received', $7, CURRENT_DATE, $8, $9)
     ON CONFLICT (payment_no) DO UPDATE SET
       amount_ex_tax = EXCLUDED.amount_ex_tax,
       total_amount  = EXCLUDED.total_amount,
       amount_jpy    = EXCLUDED.amount_jpy,
       currency      = EXCLUDED.currency,
       status        = 'received',
       paid_date     = CURRENT_DATE,
       due_date      = EXCLUDED.due_date`,
    [paymentNo, deal.work_id, period, amount, cur, amountJpy, periodDate, deal.source_contract_number || null, dealId]
  );
}

/** 受領確定を取消(payments から削除)。 */
export async function unconfirmReceipt(dealId: number, periodDate: string): Promise<void> {
  await query(`DELETE FROM payments WHERE payment_no = $1`, [`SLI-${dealId}-${periodDate}`]);
}

// ── 請求状態(台帳)──────────────────────────────────────────────
// 受領予定 各回(deal × period_date)の 未請求/請求済/入金済 を保持・更新する。
// 金額・期日は deal から算出するため、ここでは状態のみ管理する(入金消込はしない)。
export const RECEIVABLE_STATUSES = [
  { key: "unbilled", label: "未請求" },
  { key: "billed", label: "請求済" },
  { key: "received", label: "入金済" },
] as const;
const VALID_STATUS = new Set(RECEIVABLE_STATUSES.map((s) => s.key));

/** `${deal_id}:${period_date}` → 状態レコード のマップ。未登録は未請求扱い。 */
async function loadStatusMap(): Promise<Record<string, any>> {
  const map: Record<string, any> = {};
  try {
    const res = await query(
      `SELECT deal_id, period_date, status, billed_date, received_date, note
         FROM receivable_statuses`
    );
    for (const r of res.rows) {
      map[`${Number(r.deal_id)}:${d2s(r.period_date)}`] = {
        status: r.status || "unbilled",
        billed_date: d2s(r.billed_date) || null,
        received_date: d2s(r.received_date) || null,
        note: r.note || "",
      };
    }
  } catch (err: any) {
    if (!(err && (err.code === "42P01" || err.code === "42703"))) throw err;
  }
  return map;
}

/** 受領予定1回の請求状態を設定。billed→billed_date、received→received_date を自動補完。 */
export async function setReceiptStatus(
  dealId: number,
  periodDate: string,
  status: string,
  note?: string | null
): Promise<void> {
  if (!VALID_STATUS.has(status as any)) throw new Error("不正な状態です: " + status);
  await query(
    `INSERT INTO receivable_statuses (deal_id, period_date, status, billed_date, received_date, note)
     VALUES ($1, $2, $3,
             CASE WHEN $3 IN ('billed','received') THEN CURRENT_DATE END,
             CASE WHEN $3 = 'received' THEN CURRENT_DATE END,
             $4)
     ON CONFLICT (deal_id, period_date) DO UPDATE SET
       status = EXCLUDED.status,
       billed_date = CASE
         WHEN EXCLUDED.status IN ('billed','received')
           THEN COALESCE(receivable_statuses.billed_date, CURRENT_DATE)
         ELSE NULL END,
       received_date = CASE
         WHEN EXCLUDED.status = 'received'
           THEN COALESCE(receivable_statuses.received_date, CURRENT_DATE)
         ELSE NULL END,
       note = COALESCE(EXCLUDED.note, receivable_statuses.note),
       updated_at = now()`,
    [dealId, periodDate, status, note ?? null]
  );
}

const SELECT_DEAL = `
  SELECT d.*,
         w.title AS work_title, w.work_code,
         COALESCE(s.name, d.counterparty_name, d.inline_sublicensee_name) AS sublicensee_name,
         s.category AS sublicensee_category
    FROM sublicense_deals d
    LEFT JOIN works w ON w.id = d.work_id
    LEFT JOIN sublicensees s ON s.id = d.sublicensee_id`;

function mapDeal(r: any) {
  return {
    id: Number(r.id),
    receivable_kind: r.receivable_kind || "sublicense",
    work_id: r.work_id == null ? null : Number(r.work_id),
    work_title: r.work_title || "",
    work_code: r.work_code || "",
    sublicensee_id: r.sublicensee_id == null ? null : Number(r.sublicensee_id),
    sublicensee_name: r.sublicensee_name || "",
    sublicensee_category: r.sublicensee_category || "",
    inline_sublicensee_name: r.inline_sublicensee_name || "",
    counterparty_name: r.counterparty_name || "",
    counterparty_vendor_id: r.counterparty_vendor_id == null ? null : Number(r.counterparty_vendor_id),
    source_contract_id: r.source_contract_id == null ? null : Number(r.source_contract_id),
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
    "receivable_kind",
    "work_id", "sublicensee_id", "inline_sublicensee_name",
    "counterparty_name", "counterparty_vendor_id", "source_contract_id", "source_contract_number",
    "basis", "rate_pct", "unit_price", "forecast_amount", "mg_amount", "advance_amount",
    "currency", "cycle", "interval_unit", "interval_count", "billing_day",
    "term_start", "term_end", "status", "remarks",
  ];
  const vals = [
    deal.receivable_kind || "sublicense",
    deal.work_id ?? null,
    deal.sublicensee_id ?? null,
    deal.inline_sublicensee_name || null,
    deal.counterparty_name || null,
    deal.counterparty_vendor_id ?? null,
    deal.source_contract_id ?? null,
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
  kind?: string; // receivable_kind で絞り込み
  status?: string; // unbilled | billed | received
  ids?: string[]; // 受領予定行の "deal:index" 形式 row_id(CSV選択用)
};

/** 全 active deal を受領予定(請求権)の各回に展開した一覧。 */
export async function listReceipts(f: ReceiptFilters): Promise<{ rows: any[]; total: number }> {
  const deals = (await listDeals()).filter((d: any) => d.status !== "closed");
  const reportsMap = await loadReportsMap();
  const confirmed = await confirmedMap();
  const statusMap = await loadStatusMap();
  const rows: any[] = [];
  for (const d of deals) {
    const sched = buildReceiptRows(d, reportsMap[d.id] || []);
    sched.forEach((s, idx) => {
      const st = statusMap[`${d.id}:${s.date}`];
      rows.push({
        row_id: `${d.id}:${idx}`,
        deal_id: d.id,
        seq: idx + 1,
        of: sched.length,
        receipt_date: s.date,
        amount: s.amount,
        confirmed: confirmed[`${d.id}:${s.date}`] === true, // 受領確定(payments記録)済み(旧)
        status: st ? st.status : "unbilled", // 未請求/請求済/入金済(台帳)
        billed_date: st ? st.billed_date : null,
        received_date: st ? st.received_date : null,
        status_note: st ? st.note : "",
        estimated: s.estimated, // true=見込 / false=実績報告ベース
        mg_topup: s.mg_topup,
        advance_applied: s.advance_applied,
        reported_sales: s.reported_sales,
        reported_quantity: s.reported_quantity,
        currency: d.currency,
        receivable_kind: d.receivable_kind,
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
  if (f.kind) out = out.filter((r) => r.receivable_kind === f.kind);
  if (f.status) out = out.filter((r) => r.status === f.status);
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
  const statusLabel: Record<string, string> = { unbilled: "未請求", billed: "請求済", received: "入金済" };
  const kindLabel: Record<string, string> = {
    sublicense: "サブライセンス", publication: "出版印税", license_out: "ライセンスアウト",
    service: "役務・その他", other: "その他",
  };
  const headers = [
    "受領予定日", "種別", "請求状態", "請求日", "入金日", "相手方", "作品コード", "作品", "参照契約番号",
    "基準", "見込/実績", "実売上/実数量", "料率(%)", "回", "金額", "通貨",
    "MG上乗せ", "前払相殺", "MG総額", "前払",
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.receipt_date,
        kindLabel[r.receivable_kind] || r.receivable_kind || "",
        statusLabel[r.status] || r.status || "",
        r.billed_date || "", r.received_date || "",
        r.sublicensee_name, r.work_code, r.work_title, r.source_contract_number,
        r.basis === "manufacturing" ? "製造数" : "売上",
        r.estimated ? "見込" : "実績",
        r.basis === "manufacturing" ? (r.reported_quantity ?? "") : (r.reported_sales ?? ""),
        r.rate_pct ?? "", `${r.seq}/${r.of}`, r.amount, r.currency,
        r.mg_topup || "", r.advance_applied || "", r.mg_amount ?? "", r.advance_amount ?? "",
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
