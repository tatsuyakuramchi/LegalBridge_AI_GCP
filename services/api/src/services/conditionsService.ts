/**
 * conditionsService — 条件明細(capability_line_items)の横断検索。
 *
 * 文書フォーム(LineItemTable)で入力され、worker が capability_line_items に
 * ミラーした明細行を、親契約(contract_capabilities)・取引先(vendors)・
 * 作成者(documents.created_by → staff)と結合して一覧する。
 *
 * 検索軸:
 *   - 支払日 (payment_date)   範囲
 *   - 納期   (delivery_date)  範囲
 *   - 種類   (contract_category: 業務委託=service / ライセンス=license …)
 *   - 取引先 (vendor_name / vendor_code)
 *   - 担当   (documents.created_by または staff.staff_name)
 *   - キーワード (item_name / spec / contract_title / document_number)
 */

import { query } from "../lib/db.ts";

/**
 * 明細の状態フラグ定義(複数フラグ・独立ON/OFF)。
 * 項目を増やす場合はここに 1 行追加するだけ(マイグレーション不要 / status_flags JSONB にキー格納)。
 * key は status_flags のキー、label は画面/CSV の見出し。
 */
export const LINE_ITEM_STATUS_DEFS: { key: string; label: string }[] = [
  { key: "po_signed", label: "発注書締結済" },
  { key: "inspection_issued", label: "検収書発行済" },
  { key: "payment_exported", label: "支払申請ファイル出力済" },
];

export type ConditionFilters = {
  payment_from?: string;
  payment_to?: string;
  delivery_from?: string;
  delivery_to?: string;
  category?: string; // service | license | publication | sales | nda | (exact)
  vendor?: string;
  owner?: string;
  q?: string;
  ids?: number[]; // 指定時はこの明細 id のみ(CSV の選択出力用)
  limit?: number;
  offset?: number;
};

const FROM_JOINS = `
  FROM capability_line_items cli
  JOIN contract_capabilities cc ON cc.id = cli.capability_id
  LEFT JOIN vendors v ON v.id = cc.vendor_id
  LEFT JOIN documents d ON d.document_number = cc.document_number
  LEFT JOIN staff s
    ON s.email = d.created_by
    OR s.slack_user_id = d.created_by
    OR s.staff_name = d.created_by
`;

function buildWhere(f: ConditionFilters): { sql: string; params: any[] } {
  const where: string[] = [];
  const params: any[] = [];
  const p = (v: any) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (f.payment_from) where.push(`cli.payment_date >= ${p(f.payment_from)}`);
  if (f.payment_to) where.push(`cli.payment_date <= ${p(f.payment_to)}`);
  if (f.delivery_from) where.push(`cli.delivery_date >= ${p(f.delivery_from)}`);
  if (f.delivery_to) where.push(`cli.delivery_date <= ${p(f.delivery_to)}`);

  if (f.category) {
    const c = String(f.category).trim().toLowerCase();
    if (c === "license") {
      // license_in / license_out / license をまとめる
      where.push(`cc.contract_category ILIKE ${p("license%")}`);
    } else if (c) {
      where.push(`cc.contract_category = ${p(c)}`);
    }
  }

  if (f.vendor) {
    const ph = p(`%${f.vendor}%`);
    where.push(`(v.vendor_name ILIKE ${ph} OR v.vendor_code ILIKE ${ph})`);
  }
  if (f.owner) {
    const ph = p(`%${f.owner}%`);
    where.push(`(d.created_by ILIKE ${ph} OR s.staff_name ILIKE ${ph})`);
  }
  if (f.q) {
    const ph = p(`%${f.q}%`);
    where.push(
      `(cli.item_name ILIKE ${ph} OR cli.spec ILIKE ${ph} OR cc.contract_title ILIKE ${ph} OR cc.document_number ILIKE ${ph})`
    );
  }
  if (Array.isArray(f.ids) && f.ids.length) {
    const ids = f.ids.map((n) => Number(n)).filter((n) => Number.isFinite(n));
    if (ids.length) where.push(`cli.id = ANY(${p(ids)}::int[])`);
  }

  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const d2s = (v: any): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : "";
const num = (v: any): number | null => (v == null ? null : Number(v));

export async function listConditions(
  f: ConditionFilters
): Promise<{ rows: any[]; total: number }> {
  const { sql: whereSql, params } = buildWhere(f);

  let total = 0;
  try {
    const cnt = await query(
      `SELECT COUNT(*)::int AS c ${FROM_JOINS} ${whereSql}`,
      params
    );
    total = Number(cnt.rows[0]?.c || 0);
  } catch (err: any) {
    // 列/テーブル未整備(42703/42P01)なら空で返す(worker 未デプロイ環境)
    if (err && (err.code === "42703" || err.code === "42P01")) return { rows: [], total: 0 };
    throw err;
  }

  const limit = Math.max(1, Math.min(1000, Number(f.limit ?? 300)));
  const offset = Math.max(0, Number(f.offset ?? 0));
  const lp = (params.push(limit), params.length);
  const op = (params.push(offset), params.length);

  const baseCols = `
       cli.id, cli.line_no, cli.item_name, cli.spec, cli.calc_method, cli.payment_terms,
       cli.quantity, cli.unit_price, cli.amount_ex_tax,
       cli.delivery_date, cli.payment_date, cli.term_start, cli.term_end, cli.cycle,
       cc.id AS capability_id, cc.document_number, cc.contract_title,
       cc.contract_category, cc.contract_type, cc.record_type,
       v.vendor_code, v.vendor_name,
       COALESCE(s.staff_name, d.created_by) AS owner_name,
       d.created_by, d.issue_key`;
  // 0015: 原作 / 作品 / マスター契約(v3 contracts)。 0016: 稟議 + 状態フラグ。
  const linkCols = `,
       cli.source_ip_id, si.title AS source_ip_title, si.source_code,
       cli.work_id, w.title AS work_title, w.work_code,
       cli.master_contract_id, mc.contract_title AS master_contract_title,
       mc.document_number AS master_contract_number,
       cli.ringi_id, rr.ringi_number, rr.title AS ringi_title,
       cli.status_flags`;
  const linkJoins = `
    LEFT JOIN source_ips si ON si.id = cli.source_ip_id
    LEFT JOIN works w ON w.id = cli.work_id
    LEFT JOIN contracts mc ON mc.id = cli.master_contract_id
    LEFT JOIN ringi_records rr ON rr.id = cli.ringi_id`;
  const order = `ORDER BY cli.payment_date DESC NULLS LAST, cli.delivery_date DESC NULLS LAST,
              cc.document_number DESC, cli.line_no ASC
     LIMIT $${lp} OFFSET $${op}`;

  let res: any;
  try {
    res = await query(
      `SELECT ${baseCols}${linkCols} ${FROM_JOINS}${linkJoins} ${whereSql} ${order}`,
      params
    );
  } catch (err: any) {
    // 0015 未適用環境(紐付け列なし)では従来通り列なしで返す。
    if (err && (err.code === "42703" || err.code === "42P01")) {
      res = await query(`SELECT ${baseCols} ${FROM_JOINS} ${whereSql} ${order}`, params);
    } else {
      throw err;
    }
  }

  const rows = res.rows.map((r: any) => ({
    id: Number(r.id),
    line_no: Number(r.line_no) || 0,
    item_name: r.item_name || "",
    spec: r.spec || "",
    calc_method: r.calc_method || "",
    payment_terms: r.payment_terms || "",
    quantity: num(r.quantity),
    unit_price: num(r.unit_price),
    amount_ex_tax: num(r.amount_ex_tax),
    delivery_date: d2s(r.delivery_date),
    payment_date: d2s(r.payment_date),
    term_start: d2s(r.term_start),
    term_end: d2s(r.term_end),
    cycle: r.cycle || "",
    capability_id: Number(r.capability_id),
    document_number: r.document_number || "",
    contract_title: r.contract_title || "",
    contract_category: r.contract_category || "",
    contract_type: r.contract_type || "",
    record_type: r.record_type || "",
    vendor_code: r.vendor_code || "",
    vendor_name: r.vendor_name || "",
    owner_name: r.owner_name || "",
    issue_key: r.issue_key || "",
    // 紐付け(0015)
    source_ip_id: r.source_ip_id == null ? null : Number(r.source_ip_id),
    source_ip_title: r.source_ip_title || "",
    source_code: r.source_code || "",
    work_id: r.work_id == null ? null : Number(r.work_id),
    work_title: r.work_title || "",
    work_code: r.work_code || "",
    master_contract_id: r.master_contract_id == null ? null : Number(r.master_contract_id),
    master_contract_title: r.master_contract_title || "",
    master_contract_number: r.master_contract_number || "",
    // 稟議 + 状態(0016)
    ringi_id: r.ringi_id == null ? null : Number(r.ringi_id),
    ringi_number: r.ringi_number || "",
    ringi_title: r.ringi_title || "",
    status_flags: normalizeFlags(r.status_flags),
  }));

  return { rows, total };
}

/** status_flags(JSONB / text / null)を { key: true } 形に正規化(true のキーのみ)。 */
function normalizeFlags(v: any): Record<string, boolean> {
  let obj: any = v;
  if (typeof v === "string") {
    try {
      obj = JSON.parse(v);
    } catch {
      obj = {};
    }
  }
  const out: Record<string, boolean> = {};
  if (obj && typeof obj === "object") {
    for (const def of LINE_ITEM_STATUS_DEFS) {
      if (obj[def.key] === true) out[def.key] = true;
    }
  }
  return out;
}

/**
 * 明細行(capability_line_items)の 原作/作品/マスター契約/稟議 の紐付けと
 * 状態フラグを更新。status_flags は渡された場合のみ更新(未指定なら据え置き)。
 */
export async function updateConditionLinks(
  id: number,
  links: {
    source_ip_id?: number | null;
    work_id?: number | null;
    master_contract_id?: number | null;
    ringi_id?: number | null;
    status_flags?: Record<string, boolean> | null;
  }
): Promise<void> {
  // status_flags は定義済みキーのうち true のものだけを残して JSON 化。
  let flagsJson: string | null = null;
  if (links.status_flags && typeof links.status_flags === "object") {
    const clean: Record<string, boolean> = {};
    for (const def of LINE_ITEM_STATUS_DEFS) {
      if (links.status_flags[def.key] === true) clean[def.key] = true;
    }
    flagsJson = JSON.stringify(clean);
  }

  await query(
    `UPDATE capability_line_items
        SET source_ip_id = $2, work_id = $3, master_contract_id = $4, ringi_id = $5,
            status_flags = COALESCE($6::jsonb, status_flags),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [
      id,
      links.source_ip_id ?? null,
      links.work_id ?? null,
      links.master_contract_id ?? null,
      links.ringi_id ?? null,
      flagsJson,
    ]
  );
}

/** 稟議ピッカー用の一覧(新しい承認順)。 */
export async function listRingiOptions(): Promise<any[]> {
  try {
    const res = await query(
      `SELECT id, ringi_number, title, category, owner_name, approved_at
         FROM ringi_records
        ORDER BY approved_at DESC NULLS LAST, ringi_number DESC
        LIMIT 2000`
    );
    return res.rows.map((r: any) => ({
      id: Number(r.id),
      ringi_number: r.ringi_number || "",
      title: r.title || "",
      category: r.category || "",
      owner_name: r.owner_name || "",
      approved_at: d2s(r.approved_at),
    }));
  } catch (err: any) {
    if (err && (err.code === "42703" || err.code === "42P01")) return [];
    throw err;
  }
}

const csvCell = (v: any): string => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 条件明細を CSV 文字列で返す(全件 or ids 指定。Excel 向け BOM 付き)。 */
export async function exportConditionsCsv(f: ConditionFilters): Promise<string> {
  const { rows } = await listConditions({ ...f, limit: 100000, offset: 0 });
  const headers = [
    "支払日", "納期", "種類", "取引先コード", "取引先", "担当",
    "品目", "仕様", "計算方法", "支払条件", "数量", "単価", "金額(税抜)",
    "文書番号", "契約名", "課題キー",
    "原作コード", "原作", "作品コード", "作品",
    "マスター契約番号", "マスター契約名", "稟議番号", "稟議件名",
    ...LINE_ITEM_STATUS_DEFS.map((d) => d.label),
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) {
    const cells = [
      r.payment_date, r.delivery_date, r.contract_category, r.vendor_code, r.vendor_name, r.owner_name,
      r.item_name, r.spec, r.calc_method, r.payment_terms, r.quantity, r.unit_price, r.amount_ex_tax,
      r.document_number, r.contract_title, r.issue_key,
      r.source_code, r.source_ip_title, r.work_code, r.work_title,
      r.master_contract_number, r.master_contract_title, r.ringi_number, r.ringi_title,
      ...LINE_ITEM_STATUS_DEFS.map((d) => (r.status_flags && r.status_flags[d.key] ? "済" : "")),
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  // Excel(Windows)で文字化けしないよう BOM + CRLF。
  return "﻿" + lines.join("\r\n");
}
