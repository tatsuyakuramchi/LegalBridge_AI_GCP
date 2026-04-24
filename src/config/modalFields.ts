/**
 * modalFields.ts
 * Slackモーダルのフィールド定義マスタ
 *
 * 課題種別ごとに「どのフィールドを表示するか」を管理する。
 * Backlogカスタム属性IDは env 経由で解決する。
 */

export type FieldType = "text" | "textarea" | "date" | "select";

export interface ModalField {
  blockId: string;          // Slack block_id
  actionId: string;         // Slack action_id
  label: string;            // モーダル表示ラベル
  type: FieldType;
  placeholder?: string;
  optional?: boolean;
  options?: { text: string; value: string }[];  // select用
  backlogFieldEnvKey?: string;  // 対応するBacklogカスタム属性のenv変数名
  backlogNativeField?: string;  // Backlog標準フィールド ("summary"|"description")
}

// ─────────────────────────────────────────────────────────
// 全課題種別で共通のフィールド
// ─────────────────────────────────────────────────────────
const COMMON_FIELDS: ModalField[] = [
  {
    blockId:  "summary_block",
    actionId: "summary_input",
    label:    "件名",
    type:     "text",
    placeholder: "例: 〇〇社とのNDA締結依頼",
    backlogNativeField: "summary",
  },
  {
    blockId:  "counterparty_block",
    actionId: "counterparty_input",
    label:    "相手方名称",
    type:     "text",
    placeholder: "例: 株式会社〇〇",
    backlogFieldEnvKey: "BACKLOG_FIELD_COUNTERPARTY",
  },
  {
    blockId:  "remarks_block",
    actionId: "remarks_input",
    label:    "備考",
    type:     "textarea",
    placeholder: "補足・特記事項があれば記載してください",
    optional: true,
    backlogFieldEnvKey: "BACKLOG_FIELD_REMARKS",
  },
];

// ─────────────────────────────────────────────────────────
// 契約系（締結日・期間終了日・契約番号）
// ─────────────────────────────────────────────────────────
const CONTRACT_FIELDS: ModalField[] = [
  {
    blockId:  "contract_date_block",
    actionId: "contract_date_input",
    label:    "契約日",
    type:     "date",
    optional: true,
    backlogFieldEnvKey: "BACKLOG_FIELD_CONTRACT_DATE",
  },
  {
    blockId:  "contract_end_date_block",
    actionId: "contract_end_date_input",
    label:    "契約期間終了日",
    type:     "date",
    optional: true,
    backlogFieldEnvKey: "BACKLOG_FIELD_CONTRACT_END_DATE",
  },
  {
    blockId:  "contract_no_block",
    actionId: "contract_no_input",
    label:    "契約番号（既存の場合）",
    type:     "text",
    placeholder: "例: LIC-2026-0001",
    optional: true,
    backlogFieldEnvKey: "BACKLOG_FIELD_CONTRACT_NO",
  },
];

// ─────────────────────────────────────────────────────────
// ライセンス固有
// ─────────────────────────────────────────────────────────
const LICENSE_FIELDS: ModalField[] = [
  {
    blockId:  "original_work_block",
    actionId: "original_work_input",
    label:    "原著作物名",
    type:     "text",
    placeholder: "例: ボードゲーム『〇〇』",
    backlogFieldEnvKey: "BACKLOG_FIELD_ORIGINAL_WORK",
  },
  {
    blockId:  "royalty_rate_block",
    actionId: "royalty_rate_input",
    label:    "料率（わかれば）",
    type:     "text",
    placeholder: "例: 5% / 製造数×MSRP×5%",
    optional: true,
    backlogFieldEnvKey: "BACKLOG_FIELD_ROYALTY_RATE",
  },
];

// ─────────────────────────────────────────────────────────
// 発注・委託・売買系
// ─────────────────────────────────────────────────────────
const PURCHASE_FIELDS: ModalField[] = [
  {
    blockId:  "deadline_block",
    actionId: "deadline_input",
    label:    "最終納期",
    type:     "date",
    optional: true,
    backlogFieldEnvKey: "BACKLOG_FIELD_DEADLINE",
  },
  {
    blockId:  "payment_terms_block",
    actionId: "payment_terms_input",
    label:    "支払条件",
    type:     "text",
    placeholder: "例: 月末締め翌月払い / 前払い",
    optional: true,
    backlogFieldEnvKey: "BACKLOG_FIELD_PAYMENT_TERMS",
  },
];

// 納品・検収固有
const DELIVERY_FIELDS: ModalField[] = [
  {
    blockId:  "delivery_no_block",
    actionId: "delivery_no_input",
    label:    "納品回次（第N回）",
    type:     "text",
    placeholder: "1",
    backlogNativeField: "description", // descriptionに埋め込む
  },
  {
    blockId:  "delivery_date_block",
    actionId: "delivery_date_input",
    label:    "納品日",
    type:     "date",
    backlogFieldEnvKey: "BACKLOG_FIELD_DEADLINE",
  },
];

// 売買固有
const SALES_TYPE_FIELD: ModalField = {
  blockId:  "sales_type_block",
  actionId: "sales_type_input",
  label:    "契約種別",
  type:     "select",
  options: [
    { text: "買主版（アークライトが仕入れる）", value: "sales_master_buyer" },
    { text: "売主版・前払/代引",               value: "sales_master_standard" },
    { text: "売主版・掛け売り（月次締め）",     value: "sales_master_credit" },
  ],
  backlogNativeField: "description",
};

// ─────────────────────────────────────────────────────────
// 課題種別 → フィールド構成マップ
// ─────────────────────────────────────────────────────────
export const MODAL_FIELDS: Record<string, ModalField[]> = {

  legal_consultation: [
    ...COMMON_FIELDS,
  ],

  nda: [
    ...COMMON_FIELDS,
    ...CONTRACT_FIELDS,
  ],

  license_master: [
    ...COMMON_FIELDS,
    ...LICENSE_FIELDS,
    ...CONTRACT_FIELDS,
  ],

  individual_license_terms: [
    ...COMMON_FIELDS,
    ...LICENSE_FIELDS,
    {
      blockId:  "parent_issue_block",
      actionId: "parent_issue_input",
      label:    "親課題キー（ライセンス基本契約）",
      type:     "text",
      placeholder: "例: ARC-12",
      optional: true,
      backlogNativeField: "parentIssueId",
    },
    ...CONTRACT_FIELDS,
  ],

  manufacturing: [
    ...COMMON_FIELDS,
    {
      blockId:  "parent_issue_block",
      actionId: "parent_issue_input",
      label:    "親課題キー（個別利用許諾条件）",
      type:     "text",
      placeholder: "例: ARC-14",
      optional: true,
      backlogNativeField: "parentIssueId",
    },
    {
      blockId:  "original_work_block",
      actionId: "original_work_input",
      label:    "原著作物名・対象製品名",
      type:     "text",
      placeholder: "例: ボードゲーム『〇〇』 通常版",
      backlogFieldEnvKey: "BACKLOG_FIELD_ORIGINAL_WORK",
    },
    {
      blockId:  "royalty_rate_block",
      actionId: "royalty_rate_input",
      label:    "料率",
      type:     "text",
      placeholder: "例: 5%",
      optional: true,
      backlogFieldEnvKey: "BACKLOG_FIELD_ROYALTY_RATE",
    },
  ],

  outsourcing: [
    ...COMMON_FIELDS,
    ...CONTRACT_FIELDS,
    ...PURCHASE_FIELDS,
  ],

  purchase_order: [
    ...COMMON_FIELDS,
    ...PURCHASE_FIELDS,
    {
      blockId:  "parent_issue_block",
      actionId: "parent_issue_input",
      label:    "親課題キー（業務委託基本契約）",
      type:     "text",
      placeholder: "例: ARC-10",
      optional: true,
      backlogNativeField: "parentIssueId",
    },
  ],

  delivery_inspection: [
    ...COMMON_FIELDS,
    ...DELIVERY_FIELDS,
    {
      blockId:  "parent_issue_block",
      actionId: "parent_issue_input",
      label:    "親課題キー（発注書）",
      type:     "text",
      placeholder: "例: ARC-15",
      optional: true,
      backlogNativeField: "parentIssueId",
    },
  ],

  payment: [
    ...COMMON_FIELDS,
    ...PURCHASE_FIELDS,
    {
      blockId:  "parent_issue_block",
      actionId: "parent_issue_input",
      label:    "親課題キー（納品 / 検収書）",
      type:     "text",
      placeholder: "例: ARC-16",
      optional: true,
      backlogNativeField: "parentIssueId",
    },
  ],

  sales_master: [
    ...COMMON_FIELDS,
    SALES_TYPE_FIELD,
    ...CONTRACT_FIELDS,
    {
      blockId:  "payment_terms_block",
      actionId: "payment_terms_input",
      label:    "支払条件",
      type:     "text",
      placeholder: "例: 月末締め翌月払い",
      optional: true,
      backlogFieldEnvKey: "BACKLOG_FIELD_PAYMENT_TERMS",
    },
  ],
};

// ─────────────────────────────────────────────────────────
// ヘルパー: env からカスタム属性IDを解決
// ─────────────────────────────────────────────────────────
export function resolveFieldId(envKey: string): string | null {
  return process.env[envKey] || null;
}
