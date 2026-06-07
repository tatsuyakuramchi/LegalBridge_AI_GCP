/**
 * capabilityFormMapping — データモデル整理 Step 1 (SSOT)。
 *
 * 同じ「発注条件 / 検収条件」が、作成経路(通常作成 / インポート)ごとに
 * documents.form_data の中で別キー名・別形で保存され、読み手とズレて
 * 不具合(件名・発注日・明細が空 / PDFの明細表が空 等)を起こしていた。
 *
 * 本モジュールは「キー別名の吸収」を 1 箇所に集約する:
 *   - normalizeDocumentFormData(): form_data 内の別名キーを相互に埋めて揃える(additive)。
 *   - extractCapabilityFields(): 経路非依存で capability の構造化フィールドを取り出す。
 *
 * 方針: 破壊しない(additive)。既存値は上書きせず、欠けている別名だけ補完する。
 *   これにより読み手(PDFテンプレ / エディタ / capability同期)がどの別名で
 *   参照しても同じ値を得られる。
 *
 * 別名対応 (発注書 purchase_order):
 *   明細      : items            <-> line_items
 *   経費      : expenses         (共通)
 *   その他手数料: other_fees       (共通)
 *   件名      : PROJECT_TITLE <-> CONTRACT_TITLE <-> contract_title
 *   発注日    : 発注日           <-> order_date
 * 別名対応 (検収書 inspection_certificate):
 *   発注日    : orderDate        <-> order_date
 */

export type AnyForm = Record<string, any>;

function asArray(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

function isPurchaseOrder(t: string): boolean {
  return t === "purchase_order" || t.startsWith("purchase_order");
}
function isInspection(t: string): boolean {
  return t.startsWith("inspection_certificate");
}

/**
 * form_data の別名キーを相互補完して揃える。元オブジェクトは変更せず新規返却。
 */
export function normalizeDocumentFormData(
  templateType: string,
  fdIn: AnyForm | null | undefined
): AnyForm {
  const fd: AnyForm = { ...(fdIn || {}) };
  const t = String(templateType || "");

  if (isPurchaseOrder(t)) {
    // 明細: items <-> line_items を同じ配列で揃える
    //   (PDFテンプレ purchase_order.html は {{#each items}}、
    //    インポートは line_items、capability同期は items を読むため両方必要)
    const lines = asArray(fd.items).length
      ? asArray(fd.items)
      : asArray(fd.line_items);
    if (lines.length) {
      fd.items = lines;
      fd.line_items = lines;
    }
    // 件名
    const title =
      fd.PROJECT_TITLE ||
      fd.CONTRACT_TITLE ||
      fd.contract_title ||
      fd.description ||
      "";
    if (title) {
      if (!fd.PROJECT_TITLE) fd.PROJECT_TITLE = title;
      if (!fd.CONTRACT_TITLE) fd.CONTRACT_TITLE = title;
      if (!fd.contract_title) fd.contract_title = title;
    }
    // 発注日
    const od = fd["発注日"] || fd.order_date || "";
    if (od) {
      if (!fd["発注日"]) fd["発注日"] = od;
      if (!fd.order_date) fd.order_date = od;
    }
  }

  if (isInspection(t)) {
    // 発注日: orderDate <-> order_date
    const od = fd.orderDate || fd.order_date || "";
    if (od) {
      if (!fd.orderDate) fd.orderDate = od;
      if (!fd.order_date) fd.order_date = od;
    }
  }

  return fd;
}

/**
 * form_data から capability の構造化フィールドを経路非依存で取り出す。
 * (Step 2 以降で各書込経路を capability 正準へ寄せる際に使用)
 */
export function extractCapabilityFields(
  templateType: string,
  fdIn: AnyForm | null | undefined
): {
  contract_title: string;
  issue_date_po: string | null;
  tax_rate: number | null;
  line_items: any[];
  expenses: any[];
  other_fees: any[];
} {
  const fd = normalizeDocumentFormData(templateType, fdIn);
  const taxRaw = fd.taxRate != null ? fd.taxRate : fd.tax_rate;
  return {
    contract_title:
      fd.PROJECT_TITLE ||
      fd.CONTRACT_TITLE ||
      fd.contract_title ||
      fd.description ||
      "",
    issue_date_po: fd["発注日"] || fd.order_date || null,
    tax_rate:
      taxRaw != null && taxRaw !== "" && Number.isFinite(Number(taxRaw))
        ? Number(taxRaw)
        : null,
    line_items: asArray(fd.items).length ? asArray(fd.items) : asArray(fd.line_items),
    expenses: asArray(fd.expenses),
    other_fees: asArray(fd.other_fees),
  };
}
