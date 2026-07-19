/**
 * AppFormShell — 全フォーム共通のシェル（設計 §11.2 AppFormShell）。
 *   最大幅・3ペイン（本体＋右パネル）・スクロール領域・レスポンシブ・readonly 制御。
 *   readonly は fieldset[disabled] で「入力不可・テキスト選択/コピーは可能」を担保する
 *   （設計 §9.3 の true readonly と同方針。UIC-06 と一致）。
 *
 *   使い方:
 *     <AppFormShell mode="edit" header={<FormHeader.../>} aside={<CompletenessPanel.../>}
 *                   actionBar={<StickyActionBar.../>} onSubmit={handleSave}>
 *       <ValidationSummary issues={...} />
 *       <FormSection ...> <AppFormField ...>...</AppFormField> </FormSection>
 *     </AppFormShell>
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type AppFormMode = "create" | "edit" | "readonly" | "execute";

export interface AppFormShellProps {
  mode: AppFormMode;
  /** タイトル・コード・状態・パンくず（FormHeader を想定）。 */
  header?: React.ReactNode;
  /** 右パネル（DataQualityPanel / RelatedDataPanel 等）。lg 以上で 2 カラム。 */
  aside?: React.ReactNode;
  /** 固定アクションバー（StickyActionBar を想定）。本体スクロール下端に固定。 */
  actionBar?: React.ReactNode;
  /** submit（Enter / 主操作）。指定時は <form onSubmit>。 */
  onSubmit?: (e: React.FormEvent) => void;
  /** 最大幅（既定 max-w-5xl、aside 併用時は自動で広がる）。 */
  maxWidthClassName?: string;
  className?: string;
  children: React.ReactNode;
}

export function AppFormShell({
  mode,
  header,
  aside,
  actionBar,
  onSubmit,
  maxWidthClassName,
  className,
  children,
}: AppFormShellProps) {
  const readOnly = mode === "readonly";

  const body = (
    <>
      {header && <header className="mb-4">{header}</header>}
      <div className={cn("grid gap-6", aside && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
        {/* 本体。readonly は fieldset で不活性化（テキスト選択は可）。 */}
        <fieldset disabled={readOnly} className="min-w-0 border-0 p-0 m-0 flex flex-col gap-5">
          {children}
        </fieldset>
        {aside && (
          <aside className="lg:sticky lg:top-4 lg:self-start flex flex-col gap-4">{aside}</aside>
        )}
      </div>
      {actionBar}
    </>
  );

  const containerCls = cn(
    "mx-auto w-full px-4 pb-2",
    maxWidthClassName || (aside ? "max-w-6xl" : "max-w-5xl"),
    className
  );

  if (onSubmit) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!readOnly) onSubmit(e);
        }}
        className={containerCls}
        data-form-mode={mode}
      >
        {body}
      </form>
    );
  }
  return (
    <div className={containerCls} data-form-mode={mode}>
      {body}
    </div>
  );
}
