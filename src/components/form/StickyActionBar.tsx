/**
 * StickyActionBar — 全フォーム共通の固定アクションバー（設計 §11.2 StickyActionBar）。
 *   保存状態 / 主操作 / 二重送信防止 / 破壊操作との分離 を内包する。
 *   破壊操作(danger)は主操作から視覚的・配置的に隔離する。
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface StickyActionBarProps {
  /** 未保存の変更あり。 */
  dirty?: boolean;
  /** 保存中（主操作を無効化して二重送信を防ぐ）。 */
  saving?: boolean;
  /** 保存エラーの短い表示（画面に状態を残す）。 */
  error?: string | null;
  /** 主操作（保存など）。 */
  primary?: { label: React.ReactNode; onClick: () => void; disabled?: boolean };
  /** 副操作（下書き保存・取消など）。 */
  secondary?: { label: React.ReactNode; onClick: () => void; disabled?: boolean }[];
  /** 破壊操作（削除・統合など）。右端から隔離して配置。 */
  danger?: { label: React.ReactNode; onClick: () => void; disabled?: boolean };
  className?: string;
}

export function StickyActionBar({
  dirty,
  saving,
  error,
  primary,
  secondary,
  danger,
  className,
}: StickyActionBarProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-20 -mx-4 mt-4 flex items-center gap-3 border-t border-border",
        "bg-card/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/80",
        className
      )}
    >
      {/* 状態表示（toast だけに頼らない・設計 §11.3） */}
      <span className="text-[11px] font-mono text-muted-foreground" aria-live="polite">
        {saving ? "保存中…" : error ? <span className="text-destructive">{error}</span> : dirty ? "未保存の変更" : "保存済み"}
      </span>

      <div className="ml-auto flex items-center gap-2">
        {danger && (
          <>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={danger.onClick}
              disabled={danger.disabled || saving}
            >
              {danger.label}
            </Button>
            {/* 破壊操作と主操作の区切り */}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          </>
        )}
        {secondary?.map((s, i) => (
          <Button
            key={i}
            type="button"
            variant="outline"
            size="sm"
            onClick={s.onClick}
            disabled={s.disabled || saving}
          >
            {s.label}
          </Button>
        ))}
        {primary && (
          <Button
            type="button"
            size="sm"
            onClick={primary.onClick}
            disabled={primary.disabled || saving}
            aria-busy={saving || undefined}
          >
            {primary.label}
          </Button>
        )}
      </div>
    </div>
  );
}
