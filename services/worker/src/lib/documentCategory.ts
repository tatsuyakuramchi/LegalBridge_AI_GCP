/**
 * documentCategory — template_type から契約カテゴリを決める単一の真実。
 *
 * 3 カテゴリ:
 *   - basic      : 基本契約 (master agreements)
 *   - individual : 個別契約 (案件単位の伝票・契約)
 *   - other      : その他 (NDA, 法務依頼など、上記以外)
 *
 * DB の documents.document_category と Slack /法務検索 の表示
 * グループ化の両方でこの関数を使う (重複ロジックを避けるため)。
 */

export type DocumentCategory = "basic" | "individual" | "other";

/**
 * 基本契約として扱うテンプレ ID の集合。
 */
const BASIC_TEMPLATES = new Set<string>([
  "license_master",
  "service_master",
  "sales_master_buyer",
  "sales_master_standard",
  "sales_master_credit",
  "intl_master",
]);

/**
 * 個別契約に該当するテンプレ ID の prefix。
 * これらに startsWith マッチしたら 'individual'。
 */
const INDIVIDUAL_PREFIXES = [
  "purchase_order",
  "planning_purchase_order",
  "intl_purchase_order",
  "individual_license_terms",
  "inspection_certificate",
  "royalty_",
  "fee_",
  "license_report",
  "payment_notice",
];

export function getDocumentCategory(
  templateType: string | null | undefined
): DocumentCategory {
  if (!templateType) return "other";
  const t = String(templateType);
  if (BASIC_TEMPLATES.has(t)) return "basic";
  if (INDIVIDUAL_PREFIXES.some((p) => t.startsWith(p))) return "individual";
  return "other";
}

/**
 * 日本語表示ラベル (Slack / Admin UI 共通)。
 */
export const CATEGORY_LABEL_JA: Record<DocumentCategory, string> = {
  basic: "基本契約",
  individual: "個別契約",
  other: "その他",
};
