/**
 * AppFormField — 全フォーム共通のフィールド primitive（設計 §11.4）。
 *   ラベル / 必須・推奨 / 状態Badge / 説明・入力根拠 / [コントロール] 単位 /
 *   エラー・警告・DB引用元・最終確認 を「同じ順序・意味」で表示する。
 *   コントロール本体は children で受ける（input/select/combobox 等は呼び出し側が渡す）。
 *   状態色は UIC-24 のトークン（warning / destructive / muted）を使用。
 *
 * ページ側で個別に function Field() を作らない（設計 §11.3 の禁止事項）。マスタ/業務
 * フォームはこの primitive を使う。
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type FieldState =
  | "required"
  | "recommended"
  | "derived"
  | "referenced"
  | "verified"
  | "incomplete"
  | "readOnly";

export interface AppFormFieldProps {
  /** ラベル文言。 */
  label: React.ReactNode;
  /** コントロールの id（label の htmlFor と説明/エラーの aria 紐付けに使う）。 */
  htmlFor?: string;
  required?: boolean;
  /** 業務上の推奨（未入力で警告）。required と併用しない。 */
  recommended?: boolean;
  /** 説明・入力根拠。 */
  description?: React.ReactNode;
  /** 入力単位（右端に淡色表示）。 */
  unit?: React.ReactNode;
  /** データキー/カラム名の小チップ（例: material_code）。技術参照用。 */
  code?: string;
  /** エラー（赤・セクション/サマリーへも集約される想定）。 */
  error?: string | null;
  /** 警告（アンバー）。 */
  warning?: string | null;
  /** 導出元・引用元・確認情報 等の補足（淡色）。 */
  hint?: React.ReactNode;
  /** derived/referenced/verified/incomplete などの状態バッジ。 */
  state?: Exclude<FieldState, "required" | "recommended" | "readOnly">;
  className?: string;
  children: React.ReactNode;
}

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  derived: { label: "導出", cls: "text-muted-foreground border-border" },
  referenced: { label: "引用", cls: "text-info border-info/40" },
  verified: { label: "確認済", cls: "text-success border-success/40" },
  incomplete: { label: "要確認", cls: "text-warning border-warning/40" },
};

export function AppFormField({
  label,
  htmlFor,
  required,
  recommended,
  description,
  unit,
  code,
  error,
  warning,
  hint,
  state,
  className,
  children,
}: AppFormFieldProps) {
  const descId = htmlFor ? `${htmlFor}-desc` : undefined;
  const errId = htmlFor ? `${htmlFor}-err` : undefined;
  const badge = state ? STATE_BADGE[state] : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
          {required && (
            <span className="ml-0.5 text-destructive" aria-hidden>
              *
            </span>
          )}
        </label>
        {recommended && !required ? (
          <span className="text-[11px] font-medium text-warning" aria-hidden>
            推奨
          </span>
        ) : !required && !recommended ? (
          <span className="text-[11px] text-muted-foreground" aria-hidden>
            任意
          </span>
        ) : null}
        {badge && (
          <span
            className={cn(
              "text-[10px] font-medium uppercase tracking-wide rounded-full border px-1.5 py-px",
              badge.cls
            )}
          >
            {badge.label}
          </span>
        )}
        {code && (
          <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1 bg-muted/50">
            {code}
          </span>
        )}
      </div>

      {description && (
        <p id={descId} className="text-xs text-muted-foreground leading-snug">
          {description}
        </p>
      )}

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        {unit && (
          <span className="shrink-0 text-xs text-muted-foreground">{unit}</span>
        )}
      </div>

      {error ? (
        <p id={errId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : warning ? (
        <p className="text-xs text-warning">{warning}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground italic">{hint}</p>
      ) : null}
    </div>
  );
}
