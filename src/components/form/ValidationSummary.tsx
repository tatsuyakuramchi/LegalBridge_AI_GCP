/**
 * ValidationSummary — エラー・警告の集約表示（設計 §11.2 / §11.3）。
 *   toast だけで通知して画面に状態を残さない、を禁止するための常設サマリー。
 *   各項目クリックで該当フィールド（fieldId）へフォーカス移動する。
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface ValidationIssue {
  id: string;
  level: "error" | "warning";
  message: React.ReactNode;
  /** フォーカス対象コントロールの id（AppFormField の htmlFor と一致させる）。 */
  fieldId?: string;
}

export interface ValidationSummaryProps {
  issues: ValidationIssue[];
  className?: string;
  /** 見出し。既定「入力の確認」。 */
  title?: React.ReactNode;
}

function focusField(fieldId?: string) {
  if (!fieldId) return;
  const el = document.getElementById(fieldId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  // input/select 等はフォーカス、それ以外は一時 tabindex で寄せる。
  if (typeof (el as HTMLElement).focus === "function") {
    (el as HTMLElement).focus({ preventScroll: true });
  }
}

export function ValidationSummary({ issues, className, title = "入力の確認" }: ValidationSummaryProps) {
  if (!issues.length) return null;
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const tone = errors.length ? "error" : "warning";

  return (
    <div
      role={errors.length ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-[12px]",
        tone === "error"
          ? "border-destructive/40 bg-destructive/10"
          : "border-warning/40 bg-warning/10",
        className
      )}
    >
      <p className="font-mono font-bold uppercase tracking-wider text-[11px] mb-1">
        {title}
        <span className="ml-2 font-normal text-muted-foreground">
          {errors.length > 0 && `エラー ${errors.length}`}
          {errors.length > 0 && warnings.length > 0 && " / "}
          {warnings.length > 0 && `警告 ${warnings.length}`}
        </span>
      </p>
      <ul className="flex flex-col gap-0.5">
        {issues.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => focusField(i.fieldId)}
              disabled={!i.fieldId}
              className={cn(
                "text-left leading-snug",
                i.fieldId && "hover:underline cursor-pointer",
                i.level === "error" ? "text-destructive" : "text-warning"
              )}
            >
              <span aria-hidden className="mr-1">
                {i.level === "error" ? "✕" : "!"}
              </span>
              {i.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
