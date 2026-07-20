export type UiSurfacePattern =
  | "overview"
  | "list"
  | "detail"
  | "document"
  | "workflow"
  | "maintenance"
  | "readonly-portal"
  | "dialog";

export type UiRenewalStatus = "planned" | "in_progress" | "partial" | "completed" | "deprecated";

export interface UiRenewalSurface {
  id: string;
  module: string;
  route: string;
  name: string;
  pattern: UiSurfacePattern;
  status: UiRenewalStatus;
  fieldReview: "pending" | "reviewed";
  targetComponents: string[];
  notes?: string;
}

/**
 * 設計書と実装のずれを防止する全画面台帳。
 * 各UI移行PRでstatus / fieldReviewを更新する。
 */
export const UI_RENEWAL_SURFACES: UiRenewalSurface[] = [
  {
    id: "DASH-home",
    module: "Dashboard",
    route: "/",
    name: "ダッシュボード",
    pattern: "overview",
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["ModuleHeader", "MetricCard", "ActionQueue", "DataQualitySummary"],
  },
  {
    id: "REQ-list",
    module: "Requests",
    route: "/requests",
    name: "依頼一覧",
    pattern: "list",
    status: "partial",
    fieldReview: "pending",
    targetComponents: ["ModuleHeader", "DataTableShell", "SearchToolbar"],
  },
  {
    id: "ISS-detail",
    module: "Issues",
    route: "/issues/:issueKey",
    name: "課題詳細",
    pattern: "detail",
    status: "partial",
    fieldReview: "pending",
    targetComponents: ["FormHeader", "RelatedDataPanel", "AuditTrail"],
  },
  {
    id: "MAT-list",
    module: "Matters",
    route: "/matters",
    name: "案件一覧",
    pattern: "list",
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["ModuleHeader", "DataTableShell", "SearchToolbar"],
  },
  {
    id: "MAT-detail",
    module: "Matters",
    route: "/matters/:matterId",
    name: "案件詳細",
    pattern: "detail",
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["AppFormShell", "FormHeader", "RelatedDataPanel", "CompactFormGrid"],
  },
  {
    id: "DOC-editor",
    module: "Documents",
    route: "/documents/new",
    name: "文書作成・閲覧",
    pattern: "document",
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["FormHeader", "FormSection", "StickyActionBar", "ValidationSummary"],
  },
  {
    id: "WRK-list",
    module: "Works",
    route: "/works",
    name: "作品一覧",
    pattern: "list",
    status: "in_progress",
    fieldReview: "reviewed",
    targetComponents: ["ModuleHeader", "DataTableShell", "SearchToolbar"],
  },
  {
    id: "WRK-detail",
    module: "Works",
    route: "/works/:id",
    name: "作品詳細・権利フロー",
    pattern: "detail",
    status: "in_progress",
    fieldReview: "reviewed",
    targetComponents: ["AppFormShell", "FormHeader", "RelatedDataPanel", "CompletenessPanel"],
  },
  {
    id: "CTR-home",
    module: "Contracts",
    route: "/contracts",
    name: "契約台帳",
    pattern: "list",
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["ModuleHeader", "DataTableShell", "RelatedDataPanel"],
  },
  {
    id: "CND-hub",
    module: "Conditions",
    route: "/condition-lines",
    name: "条件明細ハブ",
    pattern: "list",
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["ModuleHeader", "DataTableShell", "SearchToolbar", "FacetPanel"],
  },
  {
    id: "CND-detail",
    module: "Conditions",
    route: "/condition-lines/:lineCode",
    name: "条件明細詳細",
    pattern: "detail",
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["FormHeader", "RelatedDataPanel", "CompletenessPanel", "AuditTrail"],
  },
  {
    id: "FIN-home",
    module: "Finance",
    route: "/finance/*",
    name: "Finance",
    pattern: "workflow",
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["ModuleHeader", "DataTableShell", "WorkflowStepper", "LineEditor"],
  },
  {
    id: "DQ-center",
    module: "Data Quality",
    route: "/data-quality",
    name: "データ品質センター",
    pattern: "list",
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["ModuleHeader", "DataTableShell", "FacetPanel", "AuditTrail"],
  },
  {
    id: "MST-home",
    module: "Master",
    route: "/master/*",
    name: "参照マスター",
    pattern: "detail",
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["AppFormShell", "FormHeader", "CompactFormGrid", "DangerZone"],
  },
  {
    id: "DM-home",
    module: "Data Maintenance",
    route: "/data-maintenance/*",
    name: "データ保守",
    pattern: "maintenance",
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["ModuleHeader", "WorkflowStepper", "DangerZone", "AuditTrail"],
  },
  {
    id: "TPL-home",
    module: "Templates",
    route: "/templates*",
    name: "テンプレート管理",
    pattern: "maintenance",
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["ModuleHeader", "AppFormShell", "FormHeader", "DangerZone"],
  },
  {
    id: "SET-home",
    module: "Settings",
    route: "/settings",
    name: "設定",
    pattern: "detail",
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["AppFormShell", "FormHeader", "DangerZone"],
  },
  {
    id: "SRCH-portal",
    module: "Search API",
    route: "search-api SSR",
    name: "検索ポータル",
    pattern: "readonly-portal",
    status: "planned",
    fieldReview: "reviewed",
    targetComponents: ["SearchToolbar", "DataTableShell", "FieldPolicyProjection"],
    notes: "書込み・CSV取込・強制削除を撤去し、権限別read-onlyへ",
  },
  {
    id: "DLG-all",
    module: "Cross-cutting",
    route: "Dialog / Drawer / Inline",
    name: "小型入力UI",
    pattern: "dialog",
    status: "partial",
    fieldReview: "pending",
    targetComponents: ["CompactFormGrid", "CompactFormActions", "ValidationSummary"],
  },
];
