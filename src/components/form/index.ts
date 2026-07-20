/**
 * 共通フォーム基盤（設計 FRM-02 / §11.2）。
 *   マスタ/業務フォームはページ独自の Field/保存ボタンを新設せず、ここを使う（§11.3 禁止事項）。
 *   状態色は UIC-24 のトークン（success/warning/info/destructive/severity-*）に統一。
 */
export { AppFormShell } from "./AppFormShell";
export type { AppFormShellProps, AppFormMode } from "./AppFormShell";

export { AppFormField } from "./AppFormField";
export type { AppFormFieldProps, FieldState } from "./AppFormField";

export { ValidationSummary } from "./ValidationSummary";
export type { ValidationSummaryProps, ValidationIssue } from "./ValidationSummary";

export { StickyActionBar } from "./StickyActionBar";
export type { StickyActionBarProps } from "./StickyActionBar";

export { FormHeader } from "./FormHeader";
export type { FormHeaderProps, FormHeaderMetadata } from "./FormHeader";

export { RelatedDataPanel } from "./RelatedDataPanel";
export type { RelatedDataPanelProps, RelatedDataItem } from "./RelatedDataPanel";

export { DangerZone } from "./DangerZone";
export type { DangerZoneProps } from "./DangerZone";

export { CompactFormGrid, CompactFormActions } from "./CompactFormGrid";
export type { CompactFormGridProps, CompactFormActionsProps } from "./CompactFormGrid";

// 作品詳細8タブ移行(§10.4)向け共通部品（Phase 1: 追加型）。
export { EntityCombobox } from "./EntityCombobox";
export type { EntityComboboxProps, EntityKind, EntityOption } from "./EntityCombobox";

export { LineEditor } from "./LineEditor";
export type { LineEditorProps, LineEditorColumn } from "./LineEditor";

export { DataTableShell } from "./DataTableShell";
export type { DataTableShellProps, DataTableColumn } from "./DataTableShell";

export { AuditTrail } from "./AuditTrail";
export type { AuditTrailProps, AuditItem, AuditTone } from "./AuditTrail";

export { SearchToolbar } from "./SearchToolbar";
export type { SearchToolbarProps } from "./SearchToolbar";
