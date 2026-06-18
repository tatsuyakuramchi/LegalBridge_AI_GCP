/**
 * conditionsService — 条件明細(capability_line_items)の横断検索。
 *
 * 文書フォーム(LineItemTable)で入力され、worker が capability_line_items に
 * ミラーした明細行を、親契約(contract_capabilities)・取引先(vendors)・
 * 作成者(documents.created_by → staff)と結合して一覧する。
 *
 * 成就/未了・検収額は「行ごとに新台帳優先」で導出する:
 *   明細に対応する condition_lines(cl)があれば導出ステータス
 *   (condition_line_status_v)と condition_events 由来の検収書番号を採り、
 *   無ければ旧 capability_line_items.inspected_amount_ex_tax から導出する。
 *   → 新台帳への移行が 100% でなくても Cockpit と整合した成就表示になる。
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
  include_all?: boolean; // true で古い版/非正本も含める(既定は正本=is_primary かつ final のみ)
  limit?: number;
  offset?: number;
};

const COMMON_JOINS = `
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

  // 既定は正本(現行)のみ。重複・旧版・再発行前の行を一覧から除外する。
  // include_all=true で全て表示(古い版の確認用)。
  if (!f.include_all) {
    where.push(`COALESCE(cc.is_primary, TRUE) = TRUE`);
    where.push(`COALESCE(cc.lifecycle_status, 'final') = 'final'`);
  }

  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const d2s = (v: any): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : "";
const num = (v: any): number | null => (v == null ? null : Number(v));

export async function listConditions(
  f: ConditionFilters
): Promise<{ rows: any[]; total: number }> {
  // 背骨は capability_line_items(cli)。全明細を出した上で、行ごとに新台帳
  //   (condition_lines=cl, source_line_item_id で対応)があれば成就/検収額を
  //   そちらから採る(新優先)。id は常に cli.id(= cl.source_line_item_id)に固定。
  const { sql: whereSql, params } = buildWhere(f);

  const fromJoins = `FROM capability_line_items cli
       JOIN contract_capabilities cc ON cc.id = cli.capability_id
       LEFT JOIN condition_lines cl ON cl.source_line_item_id = cli.id
       LEFT JOIN condition_line_status_v sv ON sv.id = cl.id ${COMMON_JOINS}`;

  let total = 0;
  try {
    const cnt = await query(`SELECT COUNT(*)::int AS c ${fromJoins} ${whereSql}`, params);
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

  // CloudSign 送信履歴の紐付け: 契約番号(cc) と、その明細の成就文書(condition_events
  //   由来の document_number)のいずれかに一致する cloudsign_requests を対象にする。
  //   明細詳細(per-event)と一覧(per-line)の表示を揃えるため、両方を見る。
  const CS_DOC_MATCH = `(cr.document_number = cc.document_number
         OR cr.document_number IN (
           SELECT d3.document_number FROM condition_events ce
             JOIN documents d3 ON d3.id = ce.document_id
            WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL
              AND d3.document_number IS NOT NULL))`;
  const baseCols = `
       cli.id, cli.line_no, cli.item_name, cli.spec, cli.calc_method, cli.payment_terms,
       cli.quantity, cli.unit_price, cli.amount_ex_tax,
       cli.delivery_date, cli.payment_date, cli.term_start, cli.term_end, cli.cycle,
       cc.id AS capability_id, cc.document_number, cc.contract_title,
       cc.contract_category, cc.contract_type, cc.record_type,
       v.vendor_code, v.vendor_name,
       COALESCE(s.staff_name, d.created_by) AS owner_name,
       d.created_by, d.issue_key`;
  // 経理照合: 検収額(消化額)と 成就/未了。行に新台帳(cl)があれば導出ステータス
  //   (condition_line_status_v)、無ければ旧 inspected_amount_ex_tax から導出する。
  const statusCols = `,
       cl.id AS condition_line_id,
       CASE WHEN cl.id IS NOT NULL THEN COALESCE(sv.status, 'open')
            WHEN COALESCE(cli.amount_ex_tax,0) > 0
                 AND COALESCE(cli.inspected_amount_ex_tax,0) >= cli.amount_ex_tax - 0.5 THEN 'fulfilled'
            WHEN COALESCE(cli.inspected_amount_ex_tax,0) > 0 THEN 'partially_fulfilled'
            ELSE 'open' END AS fulfillment_status,
       CASE WHEN cl.id IS NOT NULL THEN COALESCE(sv.consumed_amount, 0)
            ELSE COALESCE(cli.inspected_amount_ex_tax, 0) END AS consumed_amount,
       CASE WHEN cl.id IS NOT NULL THEN sv.remaining_amount
            ELSE (COALESCE(cli.amount_ex_tax,0) - COALESCE(cli.inspected_amount_ex_tax,0)) END AS remaining_amount`;
  // 成就文書(対の検収書/利用許諾料計算書): 最新番号 + 件数。新台帳(condition_events)由来。
  //   cl が無い行は subquery が NULL/0 を返す。
  const fulfillCols = `,
       (SELECT d2.document_number
          FROM condition_events ce JOIN documents d2 ON d2.id = ce.document_id
         WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL
         ORDER BY ce.occurred_at DESC NULLS LAST, ce.event_no DESC
         LIMIT 1) AS fulfilling_doc_number,
       (SELECT COUNT(*)::int FROM condition_events ce
         WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL
           AND ce.document_id IS NOT NULL) AS fulfilling_doc_count,
       (SELECT MAX(d3.email_sent_at) FROM condition_events ce
          JOIN documents d3 ON d3.id = ce.document_id
         WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL) AS fulfill_email_sent_at,
       (SELECT string_agg(DISTINCT d3.email_to, ', ') FROM condition_events ce
          JOIN documents d3 ON d3.id = ce.document_id
         WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL
           AND d3.email_to IS NOT NULL AND d3.email_to <> '') AS fulfill_email_to,
       (SELECT MAX(cr.sent_at) FROM cloudsign_requests cr
         WHERE ${CS_DOC_MATCH} AND cr.sent_at IS NOT NULL) AS fulfill_cloudsign_sent_at,
       (SELECT MAX(cr.completed_at) FROM cloudsign_requests cr
         WHERE ${CS_DOC_MATCH} AND cr.status = 'completed'
           AND cr.completed_at IS NOT NULL) AS fulfill_cloudsign_completed_at,
       (SELECT MAX(cr.created_at) FROM cloudsign_requests cr
         WHERE ${CS_DOC_MATCH} AND cr.status = 'draft'
           AND cr.sent_at IS NULL) AS fulfill_cloudsign_draft_at`;
  // 0015: 原作 / 作品 / マスター契約(v3 contracts)。 0016: 稟議 + 状態フラグ。
  const linkCols = `,
       cli.source_ip_id, si.title AS source_ip_title, si.source_code,
       cli.work_id, w.title AS work_title, w.work_code,
       cli.master_contract_id, mc.contract_title AS master_contract_title,
       mc.document_number AS master_contract_number,
       cli.ringi_id, rr.ringi_number, rr.title AS ringi_title,
       cli.status_flags, COALESCE(cli.is_inbound, FALSE) AS is_inbound,
       cli.flow_direction`;
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
      `SELECT ${baseCols}${statusCols}${fulfillCols}${linkCols} ${fromJoins}${linkJoins} ${whereSql} ${order}`,
      params
    );
  } catch (err: any) {
    // 0015 未適用環境(紐付け列なし)では従来通り列なしで返す。
    if (err && (err.code === "42703" || err.code === "42P01")) {
      res = await query(
        `SELECT ${baseCols}${statusCols}${fulfillCols} ${fromJoins} ${whereSql} ${order}`,
        params
      );
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
    // 経理照合: 検収額(消化) / 残額 / 成就・未了。行ごとに新台帳優先で導出。
    condition_line_id: r.condition_line_id == null ? null : Number(r.condition_line_id),
    consumed_amount: num(r.consumed_amount),
    remaining_amount: num(r.remaining_amount),
    fulfillment_status: r.fulfillment_status || "open",
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
    is_inbound: r.is_inbound === true, // 当社の受領(請求権)明細か(方向out相当)
    flow_direction: r.flow_direction || "", // 'in'(当社支払) / 'out'(当社受領)
    // 成就(fulfillment): 対の成就文書(検収書/利用許諾料計算書)の最新番号 + 件数。
    fulfilling_doc_number: r.fulfilling_doc_number || "",
    fulfilling_doc_count: Number(r.fulfilling_doc_count) || 0,
    // 送信履歴(成就文書のメール / 契約の CloudSign)。
    send_email_sent_at:
      r.fulfill_email_sent_at instanceof Date
        ? r.fulfill_email_sent_at.toISOString()
        : (r.fulfill_email_sent_at || ""),
    send_email_to: r.fulfill_email_to || "",
    send_cloudsign_sent_at:
      r.fulfill_cloudsign_sent_at instanceof Date
        ? r.fulfill_cloudsign_sent_at.toISOString()
        : (r.fulfill_cloudsign_sent_at || ""),
    // 締結完了日時(締結済 → 「✅ 締結済」表示用)。
    send_cloudsign_completed_at:
      r.fulfill_cloudsign_completed_at instanceof Date
        ? r.fulfill_cloudsign_completed_at.toISOString()
        : (r.fulfill_cloudsign_completed_at || ""),
    // ②: 未送信の下書き作成日時(下書保存運用で「送信準備中」を可視化)。
    send_cloudsign_draft_at:
      r.fulfill_cloudsign_draft_at instanceof Date
        ? r.fulfill_cloudsign_draft_at.toISOString()
        : (r.fulfill_cloudsign_draft_at || ""),
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
    is_inbound?: boolean | null; // 受領(請求権)明細フラグ。未指定なら据え置き
    flow_direction?: string | null; // 'in'|'out'|''(クリア)。未指定(undefined)なら据え置き
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
  // 方向(flow_direction)が指定されたら、それを正とし is_inbound(out=受領)も同期。
  //   undefined → 据え置き / '' → クリア / 'in'|'out' → 設定。
  let dir: string | null | undefined = links.flow_direction;
  let inbound = typeof links.is_inbound === "boolean" ? links.is_inbound : null;
  const dirProvided = dir !== undefined;
  if (dirProvided) {
    dir = dir === "in" || dir === "out" ? dir : null;
    inbound = dir === "out"; // out=当社受領=請求台帳対象
  }

  await query(
    `UPDATE capability_line_items
        SET source_ip_id = $2, work_id = $3, master_contract_id = $4, ringi_id = $5,
            status_flags = COALESCE($6::jsonb, status_flags),
            is_inbound = COALESCE($7::boolean, is_inbound),
            flow_direction = CASE WHEN $8::boolean THEN $9::varchar ELSE flow_direction END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [
      id,
      links.source_ip_id ?? null,
      links.work_id ?? null,
      links.master_contract_id ?? null,
      links.ringi_id ?? null,
      flagsJson,
      inbound,
      dirProvided,
      dirProvided ? dir : null,
    ]
  );

  // 2c-2: 新台帳にも即時反映(横断検索の読取が新台帳ベースのため)。旧
  //   capability_line_items も上で更新済みなので、old→new 同期に上書きされない。
  //   condition_lines 未適用環境(42P01/42703)では非致命でスキップ。
  try {
    await query(
      `UPDATE condition_lines
          SET source_ip_id = $2, work_id = $3, master_contract_id = $4, ringi_id = $5,
              status_flags = COALESCE($6::jsonb, status_flags),
              is_inbound = COALESCE($7::boolean, is_inbound),
              flow_direction = CASE WHEN $8::boolean THEN $9::varchar ELSE flow_direction END,
              updated_at = CURRENT_TIMESTAMP
        WHERE source_line_item_id = $1`,
      [
        id,
        links.source_ip_id ?? null,
        links.work_id ?? null,
        links.master_contract_id ?? null,
        links.ringi_id ?? null,
        flagsJson,
        inbound,
        dirProvided,
        dirProvided ? dir : null,
      ]
    );
  } catch (err: any) {
    if (!(err && (err.code === "42P01" || err.code === "42703"))) throw err;
  }
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
    "検収額(税抜)", "残額(税抜)", "成就状態", "成就文書",
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
      r.consumed_amount, r.remaining_amount,
      r.fulfillment_status === "fulfilled" ? "成就"
        : r.fulfillment_status === "partially_fulfilled" ? "一部" : "未了",
      r.fulfilling_doc_number,
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

// ════════════════════════════════════════════════════════════════════
//  自動紐付け(auto-link)
//   条件明細の 原作 / 作品 / 基本契約 / 稟議 を、保守的なヒューリスティクスで
//   自動推定する。既定は「空欄のみ補完」= 手動設定は温存(上書きしない)。
//   - 基本契約: 取引先一致の master 契約が一意なら採用(複数なら種別で絞る)。
//   - 作品 / 原作: 品目・仕様・契約名・文書番号テキストに作品/原作タイトルが
//     部分一致し、かつ一意に定まるもののみ採用(複数該当は曖昧として不採用)。
//   - 稟議: テキスト中の 5 桁番号が ringi_records に存在すれば採用。
//   書込先 id 空間は手動モーダルと同一(work_id/source_ip_id=works.id,
//   master_contract_id=contracts.id, ringi_id=ringi_records.id)。
// ════════════════════════════════════════════════════════════════════
export type AutoLinkProposal = {
  id: number;
  document_number: string | null;
  item_name: string | null;
  set: {
    source_ip_id?: number;
    work_id?: number;
    master_contract_id?: number;
    ringi_id?: number;
  };
};

export async function autoLinkConditions(opts: {
  ids?: number[];
  overwrite?: boolean; // true で既存の手動設定も上書き(既定 false=空欄のみ)
  dryRun?: boolean; // 既定 true(提案のみ・書込なし)
}): Promise<{
  dry_run: boolean;
  scanned: number;
  changed: number;
  counts: { master: number; work: number; source_ip: number; ringi: number };
  proposals: AutoLinkProposal[];
}> {
  const overwrite = opts.overwrite === true;
  const dryRun = opts.dryRun !== false;

  // 1) 対象明細(現在の紐付け + 突合用テキスト)を取得。
  const params: any[] = [];
  let idsClause = "";
  if (opts.ids && opts.ids.length) {
    params.push(opts.ids);
    idsClause = `AND cli.id = ANY($1::int[])`;
  }
  const linesRes = await query(
    `SELECT cli.id, cli.item_name, cli.spec,
            cli.source_ip_id, cli.work_id, cli.master_contract_id, cli.ringi_id,
            cc.vendor_id, cc.document_number, cc.contract_title, cc.contract_category
       FROM capability_line_items cli
       JOIN contract_capabilities cc ON cc.id = cli.capability_id
      WHERE 1=1 ${idsClause}
      ORDER BY cli.id`,
    params
  );
  const lines = linesRes.rows;

  // 2) 突合用マスターを一括ロード。
  const [mcRes, ownRes, ipRes, ringiRes] = await Promise.all([
    query(
      `SELECT id, primary_vendor_id, contract_category, contract_title
         FROM contracts WHERE contract_level = 'master'`
    ),
    query(
      `SELECT id, title FROM works
        WHERE COALESCE(kind,'own') = 'own' AND title IS NOT NULL AND length(title) >= 2`
    ),
    query(
      `SELECT id, title FROM works
        WHERE kind = 'licensed_in' AND title IS NOT NULL AND length(title) >= 2`
    ),
    query(`SELECT id, ringi_number FROM ringi_records WHERE ringi_number IS NOT NULL`),
  ]);

  const mcByVendor = new Map<number, any[]>();
  for (const r of mcRes.rows) {
    if (r.primary_vendor_id == null) continue;
    const k = Number(r.primary_vendor_id);
    if (!mcByVendor.has(k)) mcByVendor.set(k, []);
    mcByVendor.get(k)!.push(r);
  }
  const ownWorks = ownRes.rows as Array<{ id: number; title: string }>;
  const ipWorks = ipRes.rows as Array<{ id: number; title: string }>;
  const ringiByNum = new Map<string, number>();
  for (const r of ringiRes.rows) ringiByNum.set(String(r.ringi_number).trim(), Number(r.id));

  // タイトル部分一致(一意のみ採用)。複数該当は曖昧として null。
  const uniqueTitleMatch = (
    text: string,
    items: Array<{ id: number; title: string }>
  ): number | null => {
    let hit: number | null = null;
    for (const it of items) {
      const t = (it.title || "").trim();
      if (t.length < 2) continue;
      if (text.indexOf(t) >= 0) {
        if (hit != null && hit !== it.id) return null; // 複数該当
        hit = it.id;
      }
    }
    return hit;
  };

  const proposals: AutoLinkProposal[] = [];
  const counts = { master: 0, work: 0, source_ip: 0, ringi: 0 };

  for (const ln of lines) {
    const text = [ln.item_name, ln.spec, ln.contract_title, ln.document_number]
      .filter(Boolean)
      .join(" ");
    const set: AutoLinkProposal["set"] = {};

    // 基本契約: 取引先一致 → 一意なら採用。複数は contract_category で絞る。
    if (overwrite || ln.master_contract_id == null) {
      const cands = ln.vendor_id != null ? mcByVendor.get(Number(ln.vendor_id)) || [] : [];
      let pick: any = null;
      if (cands.length === 1) pick = cands[0];
      else if (cands.length > 1 && ln.contract_category) {
        const byCat = cands.filter(
          (c: any) => c.contract_category && String(c.contract_category) === String(ln.contract_category)
        );
        if (byCat.length === 1) pick = byCat[0];
      }
      if (pick) set.master_contract_id = Number(pick.id);
    }
    // 作品(自社作品)
    if (overwrite || ln.work_id == null) {
      const wid = uniqueTitleMatch(text, ownWorks);
      if (wid != null) set.work_id = wid;
    }
    // 原作(licensed_in works)
    if (overwrite || ln.source_ip_id == null) {
      const sid = uniqueTitleMatch(text, ipWorks);
      if (sid != null) set.source_ip_id = sid;
    }
    // 稟議: テキスト中の 5 桁番号
    if (overwrite || ln.ringi_id == null) {
      const m = text.match(/(?:^|[^0-9])(\d{5})(?:[^0-9]|$)/);
      if (m) {
        const rid = ringiByNum.get(m[1]);
        if (rid != null) set.ringi_id = rid;
      }
    }

    if (Object.keys(set).length === 0) continue;
    if (set.master_contract_id != null) counts.master++;
    if (set.work_id != null) counts.work++;
    if (set.source_ip_id != null) counts.source_ip++;
    if (set.ringi_id != null) counts.ringi++;
    proposals.push({
      id: Number(ln.id),
      document_number: ln.document_number || null,
      item_name: ln.item_name || null,
      set,
    });
  }

  // 3) 適用(dryRun でなければ)。updateConditionLinks は 4 リンクを無条件 SET する
  //    ため、変更しないスロットは現在値を温存してマージする。
  if (!dryRun) {
    const byId = new Map<number, any>();
    for (const l of lines) byId.set(Number(l.id), l);
    for (const p of proposals) {
      const ln = byId.get(p.id);
      const merge = (cur: any, prop: number | undefined) =>
        overwrite ? prop ?? cur ?? null : cur ?? prop ?? null;
      await updateConditionLinks(p.id, {
        source_ip_id: merge(ln.source_ip_id, p.set.source_ip_id),
        work_id: merge(ln.work_id, p.set.work_id),
        master_contract_id: merge(ln.master_contract_id, p.set.master_contract_id),
        ringi_id: merge(ln.ringi_id, p.set.ringi_id),
        status_flags: null, // 据え置き
        is_inbound: null, // 据え置き
        // flow_direction 未指定 → 据え置き
      });
    }
  }

  return {
    dry_run: dryRun,
    scanned: lines.length,
    changed: proposals.length,
    counts,
    proposals: proposals.slice(0, 100),
  };
}

// ════════════════════════════════════════════════════════════════════
//  状態フラグの自動判定(auto-status)
//   po_signed / inspection_issued / payment_exported を実データから判定し、
//   完全同期(証拠あり=ON / 証拠なし=OFF)で status_flags を上書きする。
//   手動切替は引き続きモーダルから可能(本処理はボタン実行時のみ走る)。
//   判定根拠:
//     po_signed          … contract_capabilities.contract_status='executed'
//     inspection_issued  … 検収満額(inspected_amount_ex_tax >= amount_ex_tax)
//     payment_exported   … 対の検収書/計算書が Excel 出力済(documents.excel_issued_at)
//   ※ payment の証拠取得に失敗する環境(condition_lines 未適用)では payment は
//     据え置き(誤って OFF にしない)。
// ════════════════════════════════════════════════════════════════════

/** 状態フラグのみを上書き更新(紐付け列には触れない)。完全同期用。 */
export async function updateConditionStatusFlags(
  id: number,
  flags: Record<string, boolean>
): Promise<void> {
  const clean: Record<string, boolean> = {};
  for (const def of LINE_ITEM_STATUS_DEFS) {
    if (flags[def.key] === true) clean[def.key] = true;
  }
  const json = JSON.stringify(clean);
  await query(
    `UPDATE capability_line_items
        SET status_flags = $2::jsonb, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [id, json]
  );
  // 新台帳へも反映(未適用環境 42P01/42703 は非致命でスキップ)。
  try {
    await query(
      `UPDATE condition_lines
          SET status_flags = $2::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE source_line_item_id = $1`,
      [id, json]
    );
  } catch (e: any) {
    if (!(e && (e.code === "42P01" || e.code === "42703"))) throw e;
  }
}

export async function autoStatusConditions(opts: {
  ids?: number[];
  dryRun?: boolean; // 既定 true(提案のみ)
}): Promise<{
  dry_run: boolean;
  scanned: number;
  changed: number;
  on: { po_signed: number; inspection_issued: number; payment_exported: number };
  off: { po_signed: number; inspection_issued: number; payment_exported: number };
  payment_evidence: boolean;
}> {
  const dryRun = opts.dryRun !== false;
  const hasIds = !!(opts.ids && opts.ids.length);
  const params: any[] = [];
  let idsClause = "";
  if (hasIds) {
    params.push(opts.ids);
    idsClause = `AND cli.id = ANY($1::int[])`;
  }

  const linesRes = await query(
    `SELECT cli.id, cli.status_flags,
            COALESCE(cc.contract_status = 'executed', false) AS ev_po,
            COALESCE(
              cli.amount_ex_tax > 0
              AND COALESCE(cli.inspected_amount_ex_tax, 0) >= cli.amount_ex_tax - 0.5,
              false
            ) AS ev_insp
       FROM capability_line_items cli
       JOIN contract_capabilities cc ON cc.id = cli.capability_id
      WHERE 1=1 ${idsClause}
      ORDER BY cli.id`,
    params
  );
  const lines = linesRes.rows;

  // 支払申請出力済の証拠: 対の文書(検収書/計算書)が Excel 出力済。
  let paymentEvidence = true;
  const paidSet = new Set<number>();
  try {
    const pr = await query(
      `SELECT DISTINCT cl.source_line_item_id AS cli_id
         FROM condition_lines cl
         JOIN condition_events ce ON ce.condition_line_id = cl.id AND ce.voided_at IS NULL
         JOIN documents d ON d.id = ce.document_id
        WHERE d.excel_issued_at IS NOT NULL
          AND cl.source_line_item_id IS NOT NULL
          ${hasIds ? "AND cl.source_line_item_id = ANY($1::int[])" : ""}`,
      hasIds ? [opts.ids] : []
    );
    for (const r of pr.rows) paidSet.add(Number(r.cli_id));
  } catch (e: any) {
    if (e && (e.code === "42P01" || e.code === "42703")) paymentEvidence = false;
    else throw e;
  }

  const on = { po_signed: 0, inspection_issued: 0, payment_exported: 0 };
  const off = { po_signed: 0, inspection_issued: 0, payment_exported: 0 };
  const updates: Array<{ id: number; flags: Record<string, boolean> }> = [];

  for (const ln of lines) {
    const cur = normalizeFlags(ln.status_flags);
    const desired: Record<string, boolean> = {
      po_signed: !!ln.ev_po,
      inspection_issued: !!ln.ev_insp,
      // 証拠が取れない環境では payment は現状維持(誤 OFF を避ける)。
      payment_exported: paymentEvidence ? paidSet.has(Number(ln.id)) : !!cur.payment_exported,
    };
    let changed = false;
    (["po_signed", "inspection_issued", "payment_exported"] as const).forEach((k) => {
      const was = !!cur[k];
      const now = desired[k];
      if (was !== now) {
        changed = true;
        if (now) on[k]++;
        else off[k]++;
      }
    });
    if (changed) updates.push({ id: Number(ln.id), flags: desired });
  }

  if (!dryRun) {
    for (const u of updates) await updateConditionStatusFlags(u.id, u.flags);
  }

  return {
    dry_run: dryRun,
    scanned: lines.length,
    changed: updates.length,
    on,
    off,
    payment_evidence: paymentEvidence,
  };
}
