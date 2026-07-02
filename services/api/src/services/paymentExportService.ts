/**
 * paymentExportService — 支払申請用 Excel 発行(検収書/利用許諾料計算書)。
 *
 *   GET  /payments/excel-export           … 画面 (paymentExportHtml)
 *   GET  /api/payment-exports/list        … 支払期日で期間絞込した文書一覧
 *   POST /api/payment-exports/export      … 選択文書を ZIP(PDF×N + Excel) で出力
 *   POST /api/payment-exports/assign      … 担当者未設定文書への担当者設定(admin)
 *
 * worker の Excel バッチ出力(/api/excel-batches/*)と違い、
 *   - 期間(支払期日)で絞る
 *   - excel_issued_at 済みでも再出力できる(参照用)。出力のたびに
 *     excel_issued_at = NOW() へ更新し「前回発行日」として画面に出す。
 *   - Drive へは保存せず、ブラウザへ直接 ZIP ダウンロードさせる。
 *
 * 権限:
 *   - viewer(一般担当者) … 自分が検収担当者(form_data.inspectorEmail)の文書のみ
 *   - admin              … 全担当者 + 担当者未設定の文書も対象。担当者設定も可。
 */
import { query } from "../lib/db.ts";
import { ExcelService, type InspectionExcelData } from "./excelService.ts";
import { downloadDriveFile } from "../lib/driveReadonly.ts";

const excelService = new ExcelService();

/** 対象文書の共通 WHERE (worker /api/excel-batches と同じ母集団)。 */
const DOC_BASE_WHERE = `
      d.is_primary = TRUE
  AND d.lifecycle_status = 'final'
  AND (d.template_type LIKE 'inspection_certificate%'
       OR d.template_type = 'royalty_statement')`;

export type PaymentDocRow = {
  document_number: string;
  template_type: string;
  category: "inspection_certificate" | "royalty_statement";
  category_label: string;
  po_number: string;
  vendor_name: string;
  title: string;
  payment_date: string; // YYYY-MM-DD ('' の場合あり)
  inspector_email: string;
  inspector_name: string;
  excel_issued_at: string | null; // 前回 Excel 発行日 (ISO)
  drive_link: string;
  has_pdf: boolean;
};

/**
 * 支払期日の導出。excelService.buildFromFormData の payment_date と同じ優先順位。
 * (worker の deriveExcelGroupKey は inspection で paymentDueDate を見ない旧仕様の
 *  まま残っているが、実フィールド名は paymentDueDate — buildFromFormData 側に揃える)
 */
export function derivePaymentDate(templateType: string, fd: any): string {
  const isRoyalty = templateType === "royalty_statement";
  const raw = isRoyalty
    ? fd?.paymentDueDate || fd?.documentDate || ""
    : fd?.paymentDueDate ||
      fd?.paymentDate ||
      fd?.payment_due_date ||
      fd?.documentDate ||
      "";
  return raw ? String(raw).substring(0, 10) : "";
}

function deriveInspector(fd: any): { email: string; name: string } {
  return {
    email: String(fd?.inspectorEmail || fd?.STAFF_EMAIL || "")
      .trim()
      .toLowerCase(),
    name: String(fd?.inspectorName || fd?.STAFF_NAME || "").trim(),
  };
}

function derivePoNumber(fd: any, capPoNumber: string | null): string {
  return String(
    fd?.linked_contract_number ||
      fd?.ORDER_NO ||
      fd?.orderNumber ||
      capPoNumber ||
      ""
  ).trim();
}

function deriveVendorName(fd: any): string {
  return String(fd?.counterparty || fd?.VENDOR_NAME || fd?.licensor || "").trim();
}

function deriveTitle(fd: any): string {
  return String(
    fd?.description || fd?.PROJECT_TITLE || fd?.contract_title || fd?.summary || ""
  ).trim();
}

function categoryOf(templateType: string): PaymentDocRow["category"] {
  return templateType === "royalty_statement"
    ? "royalty_statement"
    : "inspection_certificate";
}

export const CATEGORY_LABELS: Record<PaymentDocRow["category"], string> = {
  inspection_certificate: "検収書",
  royalty_statement: "利用許諾料計算書",
};

/** 一覧取得の絞込条件。 */
export type ListPaymentDocsOpts = {
  from: string; // YYYY-MM-DD (支払期日 >=)
  to: string; // YYYY-MM-DD (支払期日 <=)
  /** 呼び出し者。非 admin はこのアドレスの担当分に強制固定。 */
  requesterEmail: string;
  isAdmin: boolean;
  /**
   * admin のみ有効:
   *   "all"   … 全担当者 (担当者未設定含む)
   *   "unset" … 担当者未設定のみ
   *   その他  … 指定メールアドレスの担当分
   * 未指定は自分の担当分。
   */
  staff?: string;
};

/** DB から母集団を引いて JS 側で支払期日・担当者を導出して絞る。 */
export async function listPaymentDocuments(
  opts: ListPaymentDocsOpts
): Promise<PaymentDocRow[]> {
  const from = String(opts.from || "").substring(0, 10);
  const to = String(opts.to || "").substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("期間(from/to)は YYYY-MM-DD 形式で指定してください");
  }
  if (from > to) throw new Error("期間の開始日が終了日より後になっています");

  const requester = String(opts.requesterEmail || "").trim().toLowerCase();
  let staffFilter: string; // "all" | "unset" | email
  if (opts.isAdmin) {
    const s = String(opts.staff || "").trim().toLowerCase();
    staffFilter = s === "all" || s === "unset" ? s : s || requester;
  } else {
    if (!requester) throw new Error("ログインユーザーのメールアドレスを特定できません");
    staffFilter = requester;
  }

  // parent_po_id(capability id) から発注書番号を引く。数値でない値はキャストしない。
  const r = await query(
    `SELECT d.document_number, d.template_type, d.form_data,
            d.excel_issued_at, d.drive_link,
            cc.document_number AS cap_po_number
       FROM documents d
       LEFT JOIN contract_capabilities cc
         ON (d.form_data->>'parent_po_id') ~ '^[0-9]+$'
        AND cc.id = (d.form_data->>'parent_po_id')::bigint
      WHERE ${DOC_BASE_WHERE}
      ORDER BY d.created_at ASC`
  );

  const rows: PaymentDocRow[] = [];
  for (const row of r.rows) {
    const fd = row.form_data || {};
    const templateType = String(row.template_type || "");
    const paymentDate = derivePaymentDate(templateType, fd);
    if (!paymentDate || paymentDate < from || paymentDate > to) continue;

    const inspector = deriveInspector(fd);
    if (staffFilter === "unset") {
      if (inspector.email) continue;
    } else if (staffFilter !== "all") {
      if (inspector.email !== staffFilter) continue;
    }
    // 非 admin には担当者未設定の文書は出さない (admin のみ表示・設定可)。
    if (!opts.isAdmin && !inspector.email) continue;

    const category = categoryOf(templateType);
    rows.push({
      document_number: String(row.document_number || ""),
      template_type: templateType,
      category,
      category_label: CATEGORY_LABELS[category],
      po_number: derivePoNumber(fd, row.cap_po_number || null),
      vendor_name: deriveVendorName(fd),
      title: deriveTitle(fd),
      payment_date: paymentDate,
      inspector_email: inspector.email,
      inspector_name: inspector.name || (inspector.email ? "" : "(担当者未設定)"),
      excel_issued_at: row.excel_issued_at
        ? new Date(row.excel_issued_at).toISOString()
        : null,
      drive_link: String(row.drive_link || ""),
      has_pdf: !!String(row.drive_link || "").trim(),
    });
  }

  rows.sort(
    (a, b) =>
      a.payment_date.localeCompare(b.payment_date) ||
      a.document_number.localeCompare(b.document_number)
  );
  return rows;
}

/**
 * 担当者未設定の文書に検収担当者を設定する (admin 専用)。
 *   staff テーブルに登録済みのメールアドレスのみ許可し、staff_name を同時に書く。
 *   既に担当者が設定されている文書は上書きしない (スキップして返す)。
 */
export async function assignInspector(
  documentNumbers: string[],
  staffEmail: string
): Promise<{ updated: string[]; skipped: string[] }> {
  const emails = String(staffEmail || "").trim().toLowerCase();
  if (!emails) throw new Error("staff_email は必須です");
  const nums = (documentNumbers || []).map((s) => String(s).trim()).filter(Boolean);
  if (nums.length === 0) throw new Error("documentNumbers は必須です");

  const staffRes = await query(
    `SELECT staff_name, email FROM staff WHERE LOWER(email) = $1 LIMIT 1`,
    [emails]
  );
  const staff = staffRes.rows[0];
  if (!staff) throw new Error(`スタッフが見つかりません: ${emails}`);

  const docsRes = await query(
    `SELECT d.document_number, d.form_data
       FROM documents d
      WHERE d.document_number = ANY($1) AND ${DOC_BASE_WHERE}`,
    [nums]
  );

  const found = new Set(docsRes.rows.map((x: any) => String(x.document_number)));
  const missing = nums.filter((n) => !found.has(n));
  if (missing.length > 0) {
    throw new Error(`対象文書が見つかりません: ${missing.join(", ")}`);
  }

  const updated: string[] = [];
  const skipped: string[] = [];
  for (const row of docsRes.rows) {
    const fd = row.form_data || {};
    if (deriveInspector(fd).email) {
      skipped.push(row.document_number);
      continue;
    }
    await query(
      `UPDATE documents
          SET form_data = COALESCE(form_data, '{}'::jsonb) || $2::jsonb
        WHERE document_number = $1`,
      [
        row.document_number,
        JSON.stringify({
          inspectorEmail: String(staff.email || emails),
          inspectorName: String(staff.staff_name || ""),
        }),
      ]
    );
    updated.push(row.document_number);
  }
  return { updated, skipped };
}

/** 担当者選択肢 (admin の担当者フィルタ / 担当者設定用)。 */
export async function listStaffOptions(): Promise<
  Array<{ email: string; name: string }>
> {
  const r = await query(
    `SELECT LOWER(email) AS email, staff_name
       FROM staff
      WHERE email IS NOT NULL AND email <> ''
      ORDER BY staff_name`
  );
  return r.rows.map((s: any) => ({
    email: String(s.email || ""),
    name: String(s.staff_name || s.email || ""),
  }));
}

// ---------------------------------------------------------------------
// エクスポート (ZIP 同梱物の組み立て)
// ---------------------------------------------------------------------

/**
 * formData から vendor を解決。worker server.ts の resolveVendorForExcel の移植。
 * 源泉徴収(withholding_enabled)・インボイス登録番号の解決を含むため、
 * 変更する場合は worker 側と同時に更新する。
 */
export async function resolveVendorForExcel(formData: any): Promise<any> {
  let vendorRow: any = null;

  const masterId = Number(formData?.selected_master_contract_id) || 0;
  if (masterId > 0) {
    const r = await query(
      `SELECT v.vendor_code, v.vendor_name, v.entity_type,
              v.account_holder_kana, v.withholding_enabled,
              v.invoice_registration_number
         FROM contract_capabilities cc
         LEFT JOIN vendors v ON v.id = cc.vendor_id
        WHERE cc.id = $1 LIMIT 1`,
      [masterId]
    );
    if (r.rows[0]?.vendor_code) vendorRow = r.rows[0];
  }

  if (!vendorRow) {
    const poId = Number(formData?.parent_po_id) || 0;
    if (poId > 0) {
      const r = await query(
        `SELECT v.vendor_code, v.vendor_name, v.entity_type,
                v.account_holder_kana, v.withholding_enabled,
                v.invoice_registration_number
           FROM contract_capabilities cc
           LEFT JOIN vendors v ON v.id = cc.vendor_id
          WHERE cc.id = $1 AND cc.record_type = 'purchase_order'
          LIMIT 1`,
        [poId]
      );
      if (r.rows[0]?.vendor_code) vendorRow = r.rows[0];
    }
  }

  if (!vendorRow) {
    const vcode = (formData?.VENDOR_CODE as string) || "";
    if (vcode) {
      const r = await query(
        `SELECT vendor_code, vendor_name, entity_type,
                account_holder_kana, withholding_enabled,
                invoice_registration_number
           FROM vendors WHERE vendor_code = $1 LIMIT 1`,
        [vcode]
      );
      vendorRow = r.rows[0] || null;
    }
  }

  if (!vendorRow) {
    const vname =
      (formData?.VENDOR_NAME as string) ||
      (formData?.counterparty as string) ||
      (formData?.licensor as string) ||
      "";
    if (vname) {
      const r = await query(
        `SELECT vendor_code, vendor_name, entity_type,
                account_holder_kana, withholding_enabled,
                invoice_registration_number
           FROM vendors WHERE vendor_name = $1 LIMIT 1`,
        [vname]
      );
      vendorRow = r.rows[0] || null;
    }
  }

  // 個人取引先は withholding_enabled 未設定でも源泉対象とみなす。
  if (vendorRow) {
    const et = String(vendorRow.entity_type || "").toLowerCase();
    const isIndividual = et === "個人" || et === "individual";
    if (isIndividual && vendorRow.withholding_enabled !== true) {
      vendorRow = { ...vendorRow, withholding_enabled: true };
    }
  }
  // formData の VENDOR_WITHHOLDING_ENABLED を最優先で採用（保険）。
  if (formData?.VENDOR_WITHHOLDING_ENABLED === true) {
    vendorRow = vendorRow
      ? { ...vendorRow, withholding_enabled: true }
      : {
          vendor_code: formData.VENDOR_CODE || "",
          vendor_name: formData.licensor || formData.counterparty || "",
          withholding_enabled: true,
        };
  }
  return vendorRow;
}

export type ExportBundle = {
  zipName: string;
  /** 種別ごとの Excel (1 行 = 1 文書)。 */
  excelFiles: Array<{ name: string; buffer: Buffer }>;
  /** 検収書等の PDF 実体。 */
  pdfFiles: Array<{ name: string; buffer: Buffer }>;
  /** PDF が取得できなかった文書 (ZIP 内の一覧テキストにも出す)。 */
  pdfFailures: Array<{ document_number: string; reason: string }>;
  /** Excel 行にできた文書番号 (excel_issued_at 更新対象)。 */
  issuedNumbers: string[];
};

function sanitizeFileName(s: string): string {
  return String(s || "").replace(/[\\/:*?"<>|]/g, "_").trim() || "_";
}

/**
 * 選択された文書番号から ZIP 同梱物 (Excel + PDF) を組み立てる。
 *   非 admin は自分が担当者の文書のみ許可 (混在していたら全体を 403 相当で拒否)。
 */
export async function buildExportBundle(
  documentNumbers: string[],
  opts: { requesterEmail: string; isAdmin: boolean }
): Promise<ExportBundle> {
  const nums = (documentNumbers || []).map((s) => String(s).trim()).filter(Boolean);
  if (nums.length === 0) throw new Error("documentNumbers は必須です");
  if (nums.length > 200) throw new Error("一度に出力できるのは 200 件までです");

  const r = await query(
    `SELECT d.document_number, d.template_type, d.form_data, d.drive_link,
            cc.document_number AS cap_po_number
       FROM documents d
       LEFT JOIN contract_capabilities cc
         ON (d.form_data->>'parent_po_id') ~ '^[0-9]+$'
        AND cc.id = (d.form_data->>'parent_po_id')::bigint
      WHERE d.document_number = ANY($1) AND ${DOC_BASE_WHERE}`,
    [nums]
  );
  if (r.rows.length === 0) throw new Error("対象の文書が見つかりません");
  const foundNums = new Set(r.rows.map((x: any) => String(x.document_number)));
  const notFound = nums.filter((n) => !foundNums.has(n));
  if (notFound.length > 0) {
    throw new Error(`対象の文書が見つかりません: ${notFound.join(", ")}`);
  }

  const requester = String(opts.requesterEmail || "").trim().toLowerCase();
  if (!opts.isAdmin) {
    const denied = r.rows.filter(
      (row: any) => deriveInspector(row.form_data || {}).email !== requester
    );
    if (denied.length > 0) {
      const e: any = new Error(
        `自分が担当者でない文書が含まれています: ` +
          denied.map((d: any) => d.document_number).join(", ")
      );
      e.status = 403;
      throw e;
    }
  }

  // 種別ごとに Excel 化 (行順は支払期日 → 文書番号)。
  const sorted = [...r.rows].sort((a: any, b: any) => {
    const pa = derivePaymentDate(String(a.template_type || ""), a.form_data || {});
    const pb = derivePaymentDate(String(b.template_type || ""), b.form_data || {});
    return (
      pa.localeCompare(pb) ||
      String(a.document_number).localeCompare(String(b.document_number))
    );
  });

  const byCategory = new Map<PaymentDocRow["category"], InspectionExcelData[]>();
  const issuedNumbers: string[] = [];
  const pdfFiles: ExportBundle["pdfFiles"] = [];
  const pdfFailures: ExportBundle["pdfFailures"] = [];
  const usedPdfNames = new Set<string>();
  let minDate = "";
  let maxDate = "";

  for (const row of sorted) {
    const fd = row.form_data || {};
    const templateType = String(row.template_type || "");
    const vendorRow = await resolveVendorForExcel(fd);
    const xl = excelService.buildFromFormData(fd, templateType, vendorRow);
    if (!xl) {
      pdfFailures.push({
        document_number: String(row.document_number),
        reason: "Excel 行を生成できません (明細なし)",
      });
      continue;
    }
    const category = categoryOf(templateType);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(xl);
    issuedNumbers.push(String(row.document_number));

    const pd = derivePaymentDate(templateType, fd);
    if (pd) {
      if (!minDate || pd < minDate) minDate = pd;
      if (!maxDate || pd > maxDate) maxDate = pd;
    }

    // PDF 取得 (drive_link)。失敗しても Excel は出す。
    const driveLink = String(row.drive_link || "").trim();
    const poNumber = derivePoNumber(fd, row.cap_po_number || null);
    let pdfName = sanitizeFileName(
      poNumber
        ? `${row.document_number}_${poNumber}.pdf`
        : `${row.document_number}.pdf`
    );
    let seq = 2;
    while (usedPdfNames.has(pdfName)) {
      pdfName = pdfName.replace(/\.pdf$/i, "") + `_${seq++}.pdf`;
    }
    if (!driveLink) {
      pdfFailures.push({
        document_number: String(row.document_number),
        reason: "PDF リンク (drive_link) が未登録です",
      });
      continue;
    }
    try {
      const buf = await downloadDriveFile(driveLink);
      usedPdfNames.add(pdfName);
      pdfFiles.push({ name: pdfName, buffer: buf });
    } catch (e: any) {
      pdfFailures.push({
        document_number: String(row.document_number),
        reason: `PDF 取得失敗: ${String(e?.message || e)}`,
      });
    }
  }

  if (issuedNumbers.length === 0) {
    throw new Error("Excel データを生成できませんでした");
  }

  const excelFiles: ExportBundle["excelFiles"] = [];
  for (const [category, dataList] of byCategory) {
    const label = CATEGORY_LABELS[category];
    const buffer = excelService.generateInspectionExcelBatch(dataList, label);
    const range =
      minDate && maxDate
        ? minDate === maxDate
          ? `_${minDate}`
          : `_${minDate}_${maxDate}`
        : "";
    excelFiles.push({ name: sanitizeFileName(`${label}${range}.xlsx`), buffer });
  }

  const zipRange =
    minDate && maxDate
      ? minDate === maxDate
        ? `_${minDate}`
        : `_${minDate}_${maxDate}`
      : "";
  return {
    zipName: sanitizeFileName(`支払申請${zipRange}.zip`),
    excelFiles,
    pdfFiles,
    pdfFailures,
    issuedNumbers,
  };
}

/** 出力済みマーク: excel_issued_at を毎回 NOW() へ更新 (前回発行日として表示)。 */
export async function markExcelIssued(documentNumbers: string[]): Promise<void> {
  const nums = (documentNumbers || []).filter(Boolean);
  if (nums.length === 0) return;
  await query(
    `UPDATE documents SET excel_issued_at = NOW() WHERE document_number = ANY($1)`,
    [nums]
  );
}
