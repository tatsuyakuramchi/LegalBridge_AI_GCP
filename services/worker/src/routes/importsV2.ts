/**
 * Phase 23 — 統一インポートAPI
 *
 * 旧 /api/imports/order, /license-contract, /license-master, /service-master,
 * /api/imports/bulk/{order,inspection,license-contract,license-master,
 *  service-master,service-contract,nda,sales-master} を全て置き換える。
 *
 * すべて contract_capabilities + capability_line_items +
 * capability_financial_conditions + capability_expenses + capability_other_fees
 * + documents + external_assets を一括 upsert する。
 *
 * 入力ペイロード(単発):
 *   POST /api/imports/v2/contract
 *   {
 *     record_type: "purchase_order" | "individual_contract" | "standalone_contract" | "master_contract",
 *     contract_category: "service" | "license" | "nda" | "sales" | "publication",
 *     contract_title?: string,
 *     document_number?: string,
 *     backlog_issue_key?: string,
 *     vendor_code?: string,
 *     vendor_name?: string,  // fallback lookup
 *     effective_date?: string,
 *     expiration_date?: string,
 *     auto_renewal?: boolean,
 *     drive_link?: string,
 *     ringi_numbers?: string,
 *     // PO 系
 *     tax_rate?: number,
 *     due_date?: string,
 *     issue_date_po?: string,
 *     // License 系
 *     original_work?: string,
 *     ledger_code?: string,
 *     // 子テーブル
 *     line_items?: Array<...>,
 *     financial_conditions?: Array<...>,
 *     expenses?: Array<...>,
 *     other_fees?: Array<...>,
 *     // 任意追加保存
 *     form_data?: Record<string, any>,
 *   }
 *
 * バルク版:
 *   POST /api/imports/v2/bulk
 *   { rows: Array<row> }
 *     行は import_key でグルーピング → 同一グループは 1 契約として upsert。
 *     row_type='line' / 'expense' / 'fee' / 'condition' で子テーブル種別を切替。
 *
 * テンプレ DL:
 *   GET /api/imports/v2/templates?record_type=X
 *     UTF-8 BOM + CRLF の CSV ヘッダを返す。
 */

import type { Express, RequestHandler } from "express";
import express from "express";
import type { Pool } from "pg";

export type RecordType =
  | "purchase_order"
  | "individual_contract"
  | "standalone_contract"
  | "master_contract";

export type ContractCategory =
  | "service"
  | "license"
  | "nda"
  | "sales"
  | "publication";

export interface ImportsV2Deps {
  query: (text: string, params?: any[]) => Promise<any>;
  pool: Pool;
  getNewDocumentNumber: (type: string, issueTypeName?: string) => Promise<string>;
  resolveVendorIdForImport: (
    vendorCode?: string | null,
    vendorName?: string | null
  ) => Promise<number | null>;
  linkRingiByDocNumber: (
    documentNumber: string,
    ringiNumbersCsv?: string | null
  ) => Promise<void>;
  requirePortalSecret: RequestHandler;
}

interface LineItemIn {
  line_no: number;
  item_name?: string;
  spec?: string;
  category?: string;
  calc_method?: string;
  payment_terms?: string;
  payment_method?: string;
  quantity?: number;
  unit_price?: number;
  amount_ex_tax?: number;
  delivery_date?: string | null;
  payment_date?: string | null;
  cycle?: string | null;
  billing_day?: number | null;
  term_start?: string | null;
  term_end?: string | null;
}

interface FinCondIn {
  condition_no: number;
  region_language_label?: string;
  calc_method?: string;
  rate_pct?: number;
  base_price_label?: string;
  calc_period?: string;
  calc_period_kind?: string;
  calc_period_close_month?: number;
  currency?: string;
  formula_text?: string;
  payment_terms?: string;
  mg_amount?: number;
  ag_amount?: number;
}

interface ExpenseIn {
  line_no: number;
  expense_name: string;
  spec?: string;
  spent_date?: string | null;
  amount_inc_tax?: number;
  remarks?: string;
}

interface OtherFeeIn {
  line_no: number;
  fee_name: string;
  amount: number;
  remarks?: string;
}

export interface ContractImportPayload {
  record_type: RecordType;
  contract_category: ContractCategory;
  contract_title?: string;
  document_number?: string;
  backlog_issue_key?: string;
  vendor_code?: string | null;
  vendor_name?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  auto_renewal?: boolean;
  drive_link?: string;
  ringi_numbers?: string;
  tax_rate?: number;
  due_date?: string | null;
  issue_date_po?: string | null;
  original_work?: string;
  ledger_code?: string;
  line_items?: LineItemIn[];
  financial_conditions?: FinCondIn[];
  expenses?: ExpenseIn[];
  other_fees?: OtherFeeIn[];
  form_data?: Record<string, any>;
}

const RECORD_TYPES: RecordType[] = [
  "purchase_order",
  "individual_contract",
  "standalone_contract",
  "master_contract",
];

const CATEGORIES: ContractCategory[] = [
  "service",
  "license",
  "nda",
  "sales",
  "publication",
];

function isRecordType(v: any): v is RecordType {
  return RECORD_TYPES.includes(v);
}
function isCategory(v: any): v is ContractCategory {
  return CATEGORIES.includes(v);
}

/**
 * record_type + contract_category から、documents.template_type と
 * 採番 prefix を解決する。
 */
function templateTypeFor(rt: RecordType, cat: ContractCategory): string {
  if (rt === "purchase_order") return "purchase_order";
  if (cat === "license") {
    if (rt === "master_contract") return "license_master";
    return "individual_license_terms";
  }
  if (cat === "service") {
    if (rt === "master_contract") return "service_master";
    return "service_master"; // 個別/単独も同テンプレを使う想定
  }
  if (cat === "nda") return "nda";
  if (cat === "sales") return "sales_master_standard";
  if (cat === "publication") return "publication_license";
  return "external_contract";
}

function contractTypeLabel(rt: RecordType, cat: ContractCategory): string {
  if (rt === "purchase_order") return "purchase_order";
  return `${cat}_${rt.replace("_contract", "")}`; // e.g. license_individual, service_standalone
}

async function upsertContract(
  deps: ImportsV2Deps,
  p: ContractImportPayload
): Promise<{ capability_id: number; document_number: string }> {
  if (!isRecordType(p.record_type)) {
    throw new Error(`invalid record_type: ${p.record_type}`);
  }
  if (!isCategory(p.contract_category)) {
    throw new Error(`invalid contract_category: ${p.contract_category}`);
  }

  // 子テーブル NOT NULL カラム (capability_expenses.expense_name / capability_other_fees.fee_name)
  // を空で渡すと INSERT 失敗 → トランザクションが ROLLBACK される。
  // 早めに 400 系で弾いた方がユーザに親切なので、トランザクション開始前にチェック。
  const expenses = Array.isArray(p.expenses) ? p.expenses : [];
  for (const e of expenses) {
    if (!e?.expense_name || !String(e.expense_name).trim()) {
      throw new Error(
        `expense_name is required (line_no=${e?.line_no ?? "?"})`
      );
    }
  }
  const fees = Array.isArray(p.other_fees) ? p.other_fees : [];
  for (const f of fees) {
    if (!f?.fee_name || !String(f.fee_name).trim()) {
      throw new Error(`fee_name is required (line_no=${f?.line_no ?? "?"})`);
    }
  }

  // vendor 解決と採番はトランザクション外でも安全 (別 INSERT の副作用なし)。
  const vendorId = await deps.resolveVendorIdForImport(
    p.vendor_code,
    p.vendor_name
  );

  const tmplType = templateTypeFor(p.record_type, p.contract_category);
  const docNumber =
    p.document_number && p.document_number.trim()
      ? p.document_number.trim()
      : await deps.getNewDocumentNumber(tmplType);

  const issueKey =
    p.backlog_issue_key && p.backlog_issue_key.trim()
      ? p.backlog_issue_key.trim()
      : `IMPORT-${Date.now()}`;

  // contract_capabilities + 子テーブル + documents + external_assets は
  // 単一トランザクションで atomic に書き込む。
  // 途中で失敗すると ROLLBACK され、子テーブルが「半分消えた」状態は発生しない。
  const client = await deps.pool.connect();
  let capabilityId: number;
  try {
    await client.query("BEGIN");

    // 1. contract_capabilities upsert (document_number UNIQUE)
    const ccRes = await client.query(
      `INSERT INTO contract_capabilities (
         vendor_id, record_type, contract_category, contract_type, contract_title,
         document_number, contract_status, source_system,
         backlog_issue_key, effective_date, expiration_date, auto_renewal,
         tax_rate, due_date, issue_date_po, original_work, ledger_code,
         drive_url
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (document_number) DO UPDATE SET
         vendor_id         = COALESCE(EXCLUDED.vendor_id, contract_capabilities.vendor_id),
         record_type       = EXCLUDED.record_type,
         contract_category = EXCLUDED.contract_category,
         contract_type     = EXCLUDED.contract_type,
         contract_title    = COALESCE(NULLIF(EXCLUDED.contract_title, ''), contract_capabilities.contract_title),
         backlog_issue_key = COALESCE(EXCLUDED.backlog_issue_key, contract_capabilities.backlog_issue_key),
         effective_date    = COALESCE(EXCLUDED.effective_date, contract_capabilities.effective_date),
         expiration_date   = COALESCE(EXCLUDED.expiration_date, contract_capabilities.expiration_date),
         auto_renewal      = EXCLUDED.auto_renewal,
         tax_rate          = COALESCE(EXCLUDED.tax_rate, contract_capabilities.tax_rate),
         due_date          = COALESCE(EXCLUDED.due_date, contract_capabilities.due_date),
         issue_date_po     = COALESCE(EXCLUDED.issue_date_po, contract_capabilities.issue_date_po),
         original_work     = COALESCE(NULLIF(EXCLUDED.original_work, ''), contract_capabilities.original_work),
         ledger_code       = COALESCE(NULLIF(EXCLUDED.ledger_code, ''), contract_capabilities.ledger_code),
         drive_url         = COALESCE(NULLIF(EXCLUDED.drive_url, ''), contract_capabilities.drive_url),
         updated_at        = CURRENT_TIMESTAMP
       RETURNING id`,
      [
        vendorId,
        p.record_type,
        p.contract_category,
        contractTypeLabel(p.record_type, p.contract_category),
        p.contract_title || docNumber,
        docNumber,
        "executed",
        "import-v2",
        issueKey,
        p.effective_date || null,
        p.expiration_date || null,
        !!p.auto_renewal,
        Number(p.tax_rate) || 10,
        p.due_date || null,
        p.issue_date_po || null,
        p.original_work || null,
        p.ledger_code || null,
        p.drive_link || null,
      ]
    );
    capabilityId = Number(ccRes.rows[0].id);

    // 2. line_items 一括 upsert
    const lines = Array.isArray(p.line_items) ? p.line_items : [];
    if (lines.length > 0) {
      await client.query(
        `DELETE FROM capability_line_items WHERE capability_id = $1`,
        [capabilityId]
      );
      let totalExTax = 0;
      for (const l of lines) {
        const qty = Number(l.quantity) || 0;
        const unit = Number(l.unit_price) || 0;
        const amount =
          Number(l.amount_ex_tax) || (qty && unit ? Math.round(qty * unit) : 0);
        totalExTax += amount;
        await client.query(
          `INSERT INTO capability_line_items (
             capability_id, line_no, category, item_name, spec, calc_method,
             payment_method, payment_terms,
             quantity, unit_price, amount_ex_tax,
             delivery_date, payment_date,
             cycle, billing_day, term_start, term_end
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            capabilityId,
            Number(l.line_no) || 1,
            l.category || "",
            l.item_name || "",
            l.spec || "",
            l.calc_method || "FIXED",
            l.payment_method || "",
            l.payment_terms || "",
            qty,
            unit,
            amount,
            l.delivery_date || null,
            l.payment_date || null,
            l.cycle || null,
            l.billing_day == null ? null : Number(l.billing_day),
            l.term_start || null,
            l.term_end || null,
          ]
        );
      }
      // PO 系 (record_type='purchase_order') は合計を contract_capabilities にも反映
      if (p.record_type === "purchase_order") {
        const taxRate = Number(p.tax_rate) || 10;
        const taxAmount = Math.ceil((totalExTax * taxRate) / 100);
        const incTax = totalExTax + taxAmount;
        await client.query(
          `UPDATE contract_capabilities
              SET amount_ex_tax = $2,
                  tax_amount    = $3,
                  amount_inc_tax= $4,
                  tax_rate      = $5,
                  updated_at    = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [capabilityId, totalExTax, taxAmount, incTax, taxRate]
        );
      }
    }

    // 3. financial_conditions 一括 upsert
    const conds = Array.isArray(p.financial_conditions)
      ? p.financial_conditions
      : [];
    for (const c of conds) {
      await client.query(
        `INSERT INTO capability_financial_conditions (
           capability_id, condition_no, region_language_label, calc_method,
           rate_pct, base_price_label, calc_period, calc_period_kind, calc_period_close_month,
           currency, formula_text, payment_terms, mg_amount, ag_amount
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (capability_id, condition_no) DO UPDATE SET
           region_language_label  = EXCLUDED.region_language_label,
           calc_method            = EXCLUDED.calc_method,
           rate_pct               = EXCLUDED.rate_pct,
           base_price_label       = EXCLUDED.base_price_label,
           calc_period            = EXCLUDED.calc_period,
           calc_period_kind       = EXCLUDED.calc_period_kind,
           calc_period_close_month= EXCLUDED.calc_period_close_month,
           currency               = EXCLUDED.currency,
           formula_text           = EXCLUDED.formula_text,
           payment_terms          = EXCLUDED.payment_terms,
           mg_amount              = EXCLUDED.mg_amount,
           ag_amount              = EXCLUDED.ag_amount,
           updated_at             = CURRENT_TIMESTAMP`,
        [
          capabilityId,
          Number(c.condition_no) || 1,
          c.region_language_label || null,
          c.calc_method || null,
          c.rate_pct == null ? null : Number(c.rate_pct),
          c.base_price_label || null,
          c.calc_period || null,
          c.calc_period_kind || null,
          c.calc_period_close_month == null
            ? null
            : Number(c.calc_period_close_month),
          c.currency || "JPY",
          c.formula_text || null,
          c.payment_terms || null,
          Number(c.mg_amount) || 0,
          Number(c.ag_amount) || 0,
        ]
      );
    }

    // 4. expenses 一括 upsert (expense_name は事前バリデーション済)
    if (expenses.length > 0) {
      await client.query(
        `DELETE FROM capability_expenses WHERE capability_id = $1`,
        [capabilityId]
      );
      for (const e of expenses) {
        await client.query(
          `INSERT INTO capability_expenses (
             capability_id, line_no, expense_name, spec, spent_date,
             amount_inc_tax, remarks
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            capabilityId,
            Number(e.line_no) || 1,
            String(e.expense_name).trim(),
            e.spec || "",
            e.spent_date || null,
            Number(e.amount_inc_tax) || 0,
            e.remarks || "",
          ]
        );
      }
    }

    // 5. other_fees 一括 upsert (fee_name は事前バリデーション済)
    if (fees.length > 0) {
      await client.query(
        `DELETE FROM capability_other_fees WHERE capability_id = $1`,
        [capabilityId]
      );
      for (const f of fees) {
        await client.query(
          `INSERT INTO capability_other_fees (
             capability_id, line_no, fee_name, amount, remarks
           ) VALUES ($1,$2,$3,$4,$5)`,
          [
            capabilityId,
            Number(f.line_no) || 1,
            String(f.fee_name).trim(),
            Number(f.amount) || 0,
            f.remarks || "",
          ]
        );
      }
    }

    // 6. documents 行も登録 (PDF生成履歴の役割)
    await client.query(
      `INSERT INTO documents (
         document_number, issue_key, template_type, form_data,
         drive_link, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (document_number) DO UPDATE SET
         form_data  = EXCLUDED.form_data,
         drive_link = EXCLUDED.drive_link`,
      [
        docNumber,
        issueKey,
        tmplType,
        JSON.stringify({
          ...(p.form_data || {}),
          VENDOR_CODE: p.vendor_code || "",
          VENDOR_NAME: p.vendor_name || "",
          CONTRACT_TITLE: p.contract_title || "",
          record_type: p.record_type,
          contract_category: p.contract_category,
          line_items: p.line_items || [],
          financial_conditions: p.financial_conditions || [],
          expenses: p.expenses || [],
          other_fees: p.other_fees || [],
          __imported: true,
          __v2: true,
          // PDF未作成キューに出すための明示フラグ。
          // drive_link が空 (PDF未生成) のときだけ立てる。
          __pdf_pending: !(p.drive_link && p.drive_link.trim()),
        }),
        p.drive_link || "",
        "import-v2",
      ]
    );

    // 7. external_assets (drive_link あれば)
    if (p.drive_link) {
      await client.query(
        `INSERT INTO external_assets
           (asset_number, asset_name, asset_type, counterparty, file_link, backlog_issue_key)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (asset_number) DO UPDATE SET
           file_link    = EXCLUDED.file_link,
           counterparty = EXCLUDED.counterparty`,
        [
          docNumber,
          p.contract_title || docNumber,
          p.record_type === "master_contract" ? "master_contract" : "individual",
          p.vendor_name || p.vendor_code || "Imported",
          p.drive_link,
          issueKey,
        ]
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("upsertContract: ROLLBACK failed:", rollbackErr);
    }
    throw e;
  } finally {
    client.release();
  }

  // 8. 稟議番号紐付け (トランザクション外 — ringi 側 INSERT は別テーブルで
  //    独立。失敗しても契約本体は保持される。)
  if (p.ringi_numbers) {
    await deps.linkRingiByDocNumber(docNumber, p.ringi_numbers);
  }

  return { capability_id: capabilityId, document_number: docNumber };
}

/**
 * CSV 行 (record_type 列を含むフラット形式) を ContractImportPayload[] に集約。
 * import_key でグルーピングし、row_type で子テーブルを振り分ける。
 *
 *   row_type:
 *     'header' or '' (default) — 親情報 (record_type, contract_category, vendor_*, etc.)
 *     'line'    — line_items
 *     'expense' — expenses
 *     'fee'     — other_fees
 *     'condition' — financial_conditions
 */
function groupRows(rows: any[]): Map<string, ContractImportPayload> {
  const groups = new Map<string, ContractImportPayload>();
  for (const raw of rows) {
    const importKey =
      String(raw.import_key || raw.document_number || "").trim() || `_row_${groups.size}`;
    let g = groups.get(importKey);
    if (!g) {
      g = {
        record_type: raw.record_type,
        contract_category: raw.contract_category,
        contract_title: raw.contract_title,
        document_number: raw.document_number,
        backlog_issue_key: raw.backlog_issue_key || raw.issue_key,
        vendor_code: raw.vendor_code,
        vendor_name: raw.vendor_name,
        effective_date: raw.effective_date,
        expiration_date: raw.expiration_date,
        auto_renewal:
          raw.auto_renewal === "true" || raw.auto_renewal === true,
        drive_link: raw.drive_link,
        ringi_numbers: raw.ringi_numbers,
        tax_rate: raw.tax_rate ? Number(raw.tax_rate) : undefined,
        due_date: raw.due_date,
        issue_date_po: raw.issue_date_po || raw.order_date,
        original_work: raw.original_work,
        ledger_code: raw.ledger_code,
        line_items: [],
        financial_conditions: [],
        expenses: [],
        other_fees: [],
        form_data: {},
      };
      groups.set(importKey, g);
    }
    const rowType = String(raw.row_type || "").toLowerCase();
    if (rowType === "line" || (raw.line_no && rowType === "")) {
      g.line_items!.push({
        line_no: Number(raw.line_no) || g.line_items!.length + 1,
        item_name: raw.item_name,
        spec: raw.spec,
        category: raw.category,
        calc_method: raw.calc_method || "FIXED",
        payment_terms: raw.payment_terms,
        payment_method: raw.payment_method,
        quantity: raw.quantity ? Number(raw.quantity) : undefined,
        unit_price: raw.unit_price ? Number(raw.unit_price) : undefined,
        amount_ex_tax: raw.amount_ex_tax ? Number(raw.amount_ex_tax) : undefined,
        delivery_date: raw.delivery_date,
        payment_date: raw.payment_date,
        cycle: raw.cycle,
        billing_day: raw.billing_day ? Number(raw.billing_day) : undefined,
        term_start: raw.term_start,
        term_end: raw.term_end,
      });
    } else if (rowType === "expense") {
      g.expenses!.push({
        line_no: Number(raw.line_no) || g.expenses!.length + 1,
        expense_name: raw.expense_name,
        spec: raw.spec,
        spent_date: raw.spent_date,
        amount_inc_tax: Number(raw.amount_inc_tax) || 0,
        remarks: raw.remarks,
      });
    } else if (rowType === "fee") {
      g.other_fees!.push({
        line_no: Number(raw.line_no) || g.other_fees!.length + 1,
        fee_name: raw.fee_name,
        amount: Number(raw.amount) || 0,
        remarks: raw.remarks,
      });
    } else if (rowType === "condition") {
      g.financial_conditions!.push({
        condition_no: Number(raw.condition_no) || 1,
        region_language_label: raw.region_language_label,
        calc_method: raw.calc_method,
        rate_pct: raw.rate_pct ? Number(raw.rate_pct) : undefined,
        base_price_label: raw.base_price_label,
        calc_period: raw.calc_period,
        calc_period_kind: raw.calc_period_kind,
        calc_period_close_month: raw.calc_period_close_month
          ? Number(raw.calc_period_close_month)
          : undefined,
        currency: raw.currency || "JPY",
        formula_text: raw.formula_text,
        payment_terms: raw.payment_terms,
        mg_amount: Number(raw.mg_amount) || 0,
        ag_amount: Number(raw.ag_amount) || 0,
      });
    }
  }
  return groups;
}

function csvTemplate(recordType: RecordType): string {
  // 共通列 + record_type 固有列を含むテンプレ
  const commonHeader = [
    "import_key",
    "record_type",
    "contract_category",
    "contract_title",
    "document_number",
    "backlog_issue_key",
    "vendor_code",
    "vendor_name",
    "effective_date",
    "expiration_date",
    "auto_renewal",
    "drive_link",
    "ringi_numbers",
  ];
  const poExtra = ["tax_rate", "due_date", "issue_date_po"];
  const licenseExtra = ["original_work", "ledger_code"];
  const lineHeader = [
    "row_type",
    "line_no",
    "item_name",
    "spec",
    "category",
    "calc_method",
    "payment_terms",
    "quantity",
    "unit_price",
    "amount_ex_tax",
    "delivery_date",
    "payment_date",
    "cycle",
    "billing_day",
    "term_start",
    "term_end",
  ];
  const expenseHeader = [
    "row_type",
    "line_no",
    "expense_name",
    "spec",
    "spent_date",
    "amount_inc_tax",
    "remarks",
  ];
  const condHeader = [
    "row_type",
    "condition_no",
    "region_language_label",
    "calc_method",
    "rate_pct",
    "base_price_label",
    "calc_period",
    "calc_period_kind",
    "calc_period_close_month",
    "currency",
    "formula_text",
    "payment_terms",
    "mg_amount",
    "ag_amount",
  ];

  const headers = [
    ...commonHeader,
    ...(recordType === "purchase_order" ? poExtra : []),
    ...(recordType !== "purchase_order" ? licenseExtra : []),
    "row_type",
    "line_no",
    "item_name",
    "spec",
    "category",
    "calc_method",
    "payment_terms",
    "quantity",
    "unit_price",
    "amount_ex_tax",
    "delivery_date",
    "payment_date",
    "cycle",
    "billing_day",
    "term_start",
    "term_end",
    "expense_name",
    "spent_date",
    "amount_inc_tax",
    "remarks",
    "condition_no",
    "region_language_label",
    "rate_pct",
    "base_price_label",
    "calc_period",
    "currency",
    "formula_text",
    "mg_amount",
    "ag_amount",
  ];
  // 重複排除 (順序保持)
  const seen = new Set<string>();
  const uniq = headers.filter((h) => {
    if (seen.has(h)) return false;
    seen.add(h);
    return true;
  });
  // サンプル行（コメント的に1行）
  const sample = uniq
    .map((h) => {
      if (h === "import_key") return "ROW001";
      if (h === "record_type") return recordType;
      if (h === "contract_category")
        return recordType === "purchase_order" ? "service" : "license";
      if (h === "row_type") return "";
      return "";
    })
    .join(",");
  return uniq.join(",") + "\r\n" + sample + "\r\n";
}

/**
 * 発注書(purchase_order)を 1 枚に統合する。
 *
 *   複数の発注書(= contract_capabilities)の業務明細・経費・その他手数料を統合先(target)に
 *   寄せ、統合元(source)は削除する。「1明細=1発注書」で取り込んでしまったものを、
 *   後から「複数明細の1枚」にまとめ直す用途。
 *
 * 制約(満たさない場合はエラーで中断):
 *   - 対象は全て record_type='purchase_order'
 *   - 全て同一 vendor_id(取引先)— 取引先が違うものは混ぜない
 *   - 全て未発行(documents.drive_link が空)— PDF発行済は統合不可(安全策)
 *   - いずれの業務明細にも検収/納品(delivery_line_items)が紐付いていないこと
 *
 * 動作(単一トランザクション):
 *   1. target の業務明細/経費/その他手数料を全削除し、target+source 全件を結合して
 *      line_no=1.. で target capability に再INSERT(import と同じ DELETE+INSERT 方式)。
 *   2. target.amount_* を再計算、documents.form_data(line_items/expenses)も更新。
 *   3. v3 ミラー(contract_line_items)を target 分だけ作り直し。
 *   4. source の contract_capabilities / contracts / documents / external_assets を削除
 *      (capability/contract の子テーブルは ON DELETE CASCADE)。
 */
async function mergePurchaseOrders(
  deps: ImportsV2Deps,
  targetDocNumber: string,
  sourceDocNumbers: string[]
): Promise<{
  target_document_number: string;
  merged_count: number;
  line_item_count: number;
  amount_ex_tax: number;
}> {
  const norm = (s: any) => String(s || "").trim();
  const target = norm(targetDocNumber);
  const sources = Array.from(
    new Set(sourceDocNumbers.map(norm).filter((s) => s && s !== target))
  );
  if (!target) throw new Error("target_document_number is required");
  if (sources.length === 0) {
    throw new Error("統合元(source)が指定されていません");
  }
  const allDocNumbers = [target, ...sources];

  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");

    // 1. 対象を取得(documents + contract_capabilities)。documents をロック。
    const { rows } = await client.query(
      `SELECT d.id AS doc_id, d.document_number, d.drive_link, d.form_data,
              cc.id AS cap_id, cc.vendor_id, cc.record_type,
              cc.contract_category, cc.contract_title, cc.tax_rate
         FROM documents d
         LEFT JOIN contract_capabilities cc ON cc.document_number = d.document_number
        WHERE d.document_number = ANY($1::text[])
        FOR UPDATE OF d`,
      [allDocNumbers]
    );
    const byNumber = new Map<string, any>(
      rows.map((r: any) => [r.document_number, r])
    );

    // バリデーション
    for (const dn of allDocNumbers) {
      const r = byNumber.get(dn);
      if (!r) throw new Error(`発注書が見つかりません: ${dn}`);
      if (!r.cap_id) {
        throw new Error(`契約データ(capability)が見つかりません: ${dn}`);
      }
      if (r.record_type !== "purchase_order") {
        throw new Error(`発注書(purchase_order)以外は統合できません: ${dn}`);
      }
      if (r.drive_link && String(r.drive_link).trim()) {
        throw new Error(`発行済(PDFあり)の発注書は統合できません: ${dn}`);
      }
    }
    const targetRow = byNumber.get(target);
    const sourceRows = sources.map((dn) => byNumber.get(dn));

    // 取引先(vendor_id)が全件一致か
    const vendorId = targetRow.vendor_id;
    if (vendorId == null) {
      throw new Error(`取引先が未設定の発注書は統合できません: ${target}`);
    }
    for (const r of sourceRows) {
      if (r.vendor_id !== vendorId) {
        throw new Error(
          `取引先が異なるため統合できません(${r.document_number})。同じ取引先の発注書のみ統合できます。`
        );
      }
    }

    const capIds: number[] = allDocNumbers.map((dn) => byNumber.get(dn).cap_id);
    const capOrder = new Map<number, number>(
      capIds.map((id, idx) => [id, idx])
    );

    // 2. 検収/納品が紐付いた明細が無いことを確認(あると CASCADE 削除が RESTRICT で失敗)
    const delChk = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM delivery_line_items dli
         JOIN capability_line_items cli ON cli.id = dli.capability_line_item_id
        WHERE cli.capability_id = ANY($1::int[])`,
      [capIds]
    );
    if (Number(delChk.rows[0].n) > 0) {
      throw new Error(
        "検収/納品が紐付いた発注書が含まれるため統合できません。未検収の発注書のみ統合できます。"
      );
    }

    // 3. 全件の業務明細を capability_line_items から取得(DB を正とする)
    const cliRows = (
      await client.query(
        `SELECT capability_id, line_no, category, item_name, spec, calc_method,
                payment_method, payment_terms, quantity, unit_price, amount_ex_tax,
                delivery_date, payment_date, cycle, billing_day, term_start, term_end
           FROM capability_line_items
          WHERE capability_id = ANY($1::int[])`,
        [capIds]
      )
    ).rows;
    cliRows.sort(
      (a: any, b: any) =>
        (capOrder.get(a.capability_id)! - capOrder.get(b.capability_id)!) ||
        (Number(a.line_no) || 0) - (Number(b.line_no) || 0)
    );

    const expRows = (
      await client.query(
        `SELECT capability_id, line_no, expense_name, spec, spent_date,
                amount_inc_tax, remarks
           FROM capability_expenses
          WHERE capability_id = ANY($1::int[])`,
        [capIds]
      )
    ).rows;
    expRows.sort(
      (a: any, b: any) =>
        (capOrder.get(a.capability_id)! - capOrder.get(b.capability_id)!) ||
        (Number(a.line_no) || 0) - (Number(b.line_no) || 0)
    );

    const feeRows = (
      await client.query(
        `SELECT capability_id, line_no, fee_name, amount, remarks
           FROM capability_other_fees
          WHERE capability_id = ANY($1::int[])`,
        [capIds]
      )
    ).rows;
    feeRows.sort(
      (a: any, b: any) =>
        (capOrder.get(a.capability_id)! - capOrder.get(b.capability_id)!) ||
        (Number(a.line_no) || 0) - (Number(b.line_no) || 0)
    );

    const targetCap: number = targetRow.cap_id;

    // 4. target の子テーブルを全削除して結合済みを再INSERT
    await client.query(
      `DELETE FROM capability_line_items WHERE capability_id = $1`,
      [targetCap]
    );
    await client.query(
      `DELETE FROM capability_expenses WHERE capability_id = $1`,
      [targetCap]
    );
    await client.query(
      `DELETE FROM capability_other_fees WHERE capability_id = $1`,
      [targetCap]
    );

    let totalExTax = 0;
    const mergedLines: any[] = [];
    for (let i = 0; i < cliRows.length; i++) {
      const l = cliRows[i];
      const lineNo = i + 1;
      const amount = Number(l.amount_ex_tax) || 0;
      totalExTax += amount;
      await client.query(
        `INSERT INTO capability_line_items (
           capability_id, line_no, category, item_name, spec, calc_method,
           payment_method, payment_terms, quantity, unit_price, amount_ex_tax,
           delivery_date, payment_date, cycle, billing_day, term_start, term_end
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          targetCap,
          lineNo,
          l.category,
          l.item_name,
          l.spec,
          l.calc_method,
          l.payment_method,
          l.payment_terms,
          l.quantity,
          l.unit_price,
          l.amount_ex_tax,
          l.delivery_date,
          l.payment_date,
          l.cycle,
          l.billing_day,
          l.term_start,
          l.term_end,
        ]
      );
      mergedLines.push({
        line_no: lineNo,
        category: l.category || "",
        item_name: l.item_name || "",
        spec: l.spec || "",
        calc_method: l.calc_method || "FIXED",
        payment_method: l.payment_method || "",
        payment_terms: l.payment_terms || "",
        quantity: l.quantity == null ? undefined : Number(l.quantity),
        unit_price: l.unit_price == null ? undefined : Number(l.unit_price),
        amount_ex_tax: amount,
        delivery_date: l.delivery_date || null,
        payment_date: l.payment_date || null,
        cycle: l.cycle || null,
        billing_day: l.billing_day == null ? null : Number(l.billing_day),
        term_start: l.term_start || null,
        term_end: l.term_end || null,
      });
    }

    const mergedExpenses: any[] = [];
    for (let i = 0; i < expRows.length; i++) {
      const e = expRows[i];
      const lineNo = i + 1;
      await client.query(
        `INSERT INTO capability_expenses (
           capability_id, line_no, expense_name, spec, spent_date,
           amount_inc_tax, remarks
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          targetCap,
          lineNo,
          e.expense_name,
          e.spec,
          e.spent_date,
          e.amount_inc_tax,
          e.remarks,
        ]
      );
      mergedExpenses.push({
        line_no: lineNo,
        expense_name: e.expense_name || "",
        spec: e.spec || "",
        spent_date: e.spent_date || null,
        amount_inc_tax: Number(e.amount_inc_tax) || 0,
        remarks: e.remarks || "",
      });
    }

    for (let i = 0; i < feeRows.length; i++) {
      const f = feeRows[i];
      await client.query(
        `INSERT INTO capability_other_fees (
           capability_id, line_no, fee_name, amount, remarks
         ) VALUES ($1,$2,$3,$4,$5)`,
        [targetCap, i + 1, f.fee_name, f.amount, f.remarks]
      );
    }

    // 5. target の金額を再計算
    const taxRate = Number(targetRow.tax_rate) || 10;
    const taxAmount = Math.ceil((totalExTax * taxRate) / 100);
    const incTax = totalExTax + taxAmount;
    await client.query(
      `UPDATE contract_capabilities
          SET amount_ex_tax = $2, tax_amount = $3, amount_inc_tax = $4,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [targetCap, totalExTax, taxAmount, incTax]
    );

    // 6. documents.form_data を結合済みで更新(PDF生成は form_data を読むため必須)
    const newFd = {
      ...(targetRow.form_data || {}),
      line_items: mergedLines,
      expenses: mergedExpenses,
      grandTotalExTax: totalExTax,
      __merged_from: sources,
      __pdf_pending: true,
      __imported: true,
    };
    await client.query(`UPDATE documents SET form_data = $2 WHERE id = $1`, [
      targetRow.doc_id,
      JSON.stringify(newFd),
    ]);

    // 7. v3 ミラー(contract_line_items)を target 分だけ作り直し
    const hasMirror =
      (await client.query(`SELECT 1 FROM contracts WHERE id = $1`, [targetCap]))
        .rows.length > 0;
    if (hasMirror) {
      await client.query(
        `DELETE FROM contract_line_items WHERE contract_id = $1`,
        [targetCap]
      );
      await client.query(
        `INSERT INTO contract_line_items (
           id, contract_id, line_no, category, item_name, spec, calc_method,
           payment_method, payment_terms, quantity, unit_price, amount_ex_tax,
           delivery_date, payment_date, cycle, billing_day, term_start, term_end,
           created_at, updated_at
         )
         SELECT id, capability_id, line_no, category, item_name, spec, calc_method,
                payment_method, payment_terms, quantity, unit_price, amount_ex_tax,
                delivery_date, payment_date, cycle, billing_day, term_start, term_end,
                created_at, updated_at
           FROM capability_line_items WHERE capability_id = $1
         ON CONFLICT (id) DO NOTHING`,
        [targetCap]
      );
    }

    // 8. source を削除(子テーブルは ON DELETE CASCADE)
    const sourceCaps = sourceRows.map((r) => r.cap_id);
    await client.query(
      `DELETE FROM contract_capabilities WHERE id = ANY($1::int[])`,
      [sourceCaps]
    );
    await client.query(`DELETE FROM contracts WHERE id = ANY($1::int[])`, [
      sourceCaps,
    ]);
    await client.query(
      `DELETE FROM documents WHERE document_number = ANY($1::text[])`,
      [sources]
    );
    await client.query(
      `DELETE FROM external_assets WHERE asset_number = ANY($1::text[])`,
      [sources]
    );

    await client.query("COMMIT");
    return {
      target_document_number: target,
      merged_count: sources.length,
      line_item_count: mergedLines.length,
      amount_ex_tax: totalExTax,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export function registerImportsV2(app: Express, deps: ImportsV2Deps) {
  app.post(
    "/api/imports/v2/contract",
    deps.requirePortalSecret,
    express.json({ limit: "5mb" }),
    async (req, res) => {
      try {
        const p = req.body as ContractImportPayload;
        const r = await upsertContract(deps, p);
        res.json({ ok: true, ...r });
      } catch (e: any) {
        console.error("/api/imports/v2/contract failed:", e);
        res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    }
  );

  // バルクインポート (CSV パース済みの rows[])
  app.post(
    "/api/imports/v2/bulk",
    deps.requirePortalSecret,
    express.json({ limit: "20mb" }),
    async (req, res) => {
      try {
        const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
        if (rows.length === 0) {
          return res.status(400).json({ ok: false, error: "rows[] is required" });
        }
        const groups = groupRows(rows);
        const succeeded: any[] = [];
        const failed: any[] = [];
        for (const [importKey, payload] of groups) {
          try {
            const r = await upsertContract(deps, payload);
            succeeded.push({ import_key: importKey, ...r });
          } catch (e: any) {
            console.error(`/api/imports/v2/bulk group=${importKey} failed:`, e);
            failed.push({
              import_key: importKey,
              error: String(e?.message || e),
            });
          }
        }
        res.json({
          ok: true,
          total_rows: rows.length,
          groups: groups.size,
          succeeded,
          failed,
        });
      } catch (e: any) {
        console.error("/api/imports/v2/bulk failed:", e);
        res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    }
  );

  // 発注書 統合(複数の発注書を1枚=複数明細にまとめる)
  app.post(
    "/api/imports/v2/merge-pos",
    express.json({ limit: "5mb" }),
    async (req, res) => {
      try {
        const targetDocNumber = String(
          req.body?.target_document_number || ""
        ).trim();
        const sourceDocNumbers: string[] = Array.isArray(
          req.body?.source_document_numbers
        )
          ? req.body.source_document_numbers
          : [];
        if (!targetDocNumber) {
          return res
            .status(400)
            .json({ ok: false, error: "target_document_number is required" });
        }
        if (sourceDocNumbers.length === 0) {
          return res.status(400).json({
            ok: false,
            error: "source_document_numbers[] is required",
          });
        }
        const r = await mergePurchaseOrders(
          deps,
          targetDocNumber,
          sourceDocNumbers
        );
        res.json({ ok: true, ...r });
      } catch (e: any) {
        console.error("/api/imports/v2/merge-pos failed:", e);
        res.status(400).json({ ok: false, error: String(e?.message || e) });
      }
    }
  );

  // CSV テンプレ DL
  app.get("/api/imports/v2/templates", async (req, res) => {
    const rt = String(req.query.record_type || "").trim();
    if (!isRecordType(rt)) {
      return res
        .status(400)
        .json({ error: `record_type must be one of: ${RECORD_TYPES.join(", ")}` });
    }
    const csv = "﻿" + csvTemplate(rt);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="import_v2_${rt}_template.csv"`
    );
    res.send(csv);
  });
}
