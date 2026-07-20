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
    status: "partial",
    fieldReview: "pending",
    targetComponents: ["AppFormShell", "WorkDetailTabs", "WorkDetailContext", "EntityCombobox", "CompletenessPanel"],
    notes:
      "8タブ移行(UIC-09)完了: 旧 WorkGraphPanel(3カード1866行)を WorkDetailContext(state基盤)＋" +
      "タブ別 section(①概要/②系譜/③マテリアル/④権利根源/⑤契約条件/⑥製品/⑦文書/⑧監査)へ分解・物理配置し旧パネルは撤去。" +
      "API 呼び方・保存ペイロードは不変(§20)。視覚検証はレビュアー側。残: LineEditor/DataTableShell の本格採用、" +
      "work_relations 複数関係の正本化(別PR・バックエンド)。",
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
    status: "partial",
    fieldReview: "reviewed",
    targetComponents: ["SearchToolbar", "DataTableShell", "FieldPolicyProjection"],
    notes:
      "PR #424/#425 で実装: §12 機密フィルタ(viewer に口座/反社/与信を返さない・JSON/CSV/SSR)、" +
      "master 書込み(staff role/vendors/conditions-links/aliases)を worker へ移設、" +
      "SSR 編集 UI を read-only 化し write ルートを撤去、統合検索 /api/search/{works,vendors,contracts,conditions}。" +
      "残: CSV 一括取込の撤去(現状 admin-ui は search-api /imports/vendor へ委譲のため要 admin-ui 側新設)、" +
      "統合検索の補助 API(unified/facets/suggestions/data-quality)。",
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
