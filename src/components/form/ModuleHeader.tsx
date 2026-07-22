import * as React from "react";
import { cn } from "@/lib/utils";

export interface ModuleHeaderMetric {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "muted" | "warning" | "success";
}

export interface ModuleHeaderProps {
  /** モジュール種別の小見出し(例: 案件管理 / 契約台帳)。 */
  eyebrow?: React.ReactNode;
  /** モジュール名(H1)。 */
  title: React.ReactNode;
  /** 補足説明(1〜2行)。 */
  description?: React.ReactNode;
  /** タイトル右の状態バッジ等。 */
  status?: React.ReactNode;
  /** 件数・集計などのメトリクス(横並びの小タイル)。 */
  metrics?: ModuleHeaderMetric[];
  /** 主操作(新規作成・エクスポート等)。 */
  actions?: React.ReactNode;
  /** ヘッダ下のタブ/セグメント等(任意)。 */
  tabs?: React.ReactNode;
  className?: string;
}

const TONE_CLS: Record<NonNullable<ModuleHeaderMetric["tone"]>, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  success: "text-emerald-600 dark:text-emerald-400",
};

/**
 * 一覧 / モジュールランディング画面で使用する共通ヘッダー。
 * 種別・タイトル・説明・メトリクス・主操作・タブの順序を全モジュールで統一する
 * (共通シェル: FormHeader が Detail/Edit 用、ModuleHeader が List/Module 用)。
 */
export function ModuleHeader({
  eyebrow,
  title,
  description,
  status,
  metrics = [],
  actions,
  tabs,
  className,
}: ModuleHeaderProps) {
  return (
    <header
      className={cn(
        "rounded-xl border border-border bg-card px-5 py-5 shadow-sm md:px-6",
        className
      )}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className="mb-1.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {eyebrow}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {title}
            </h1>
            {status}
          </div>
          {description && (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          )}

          {metrics.length > 0 && (
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {metrics.map((m) => (
                <div key={m.label} className="flex min-w-0 items-baseline gap-2 text-xs">
                  <dt className="shrink-0 text-muted-foreground">{m.label}</dt>
                  <dd className={cn("min-w-0 truncate font-semibold tabular-nums", TONE_CLS[m.tone ?? "default"])}>
                    {m.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
            {actions}
          </div>
        )}
      </div>

      {tabs && <div className="mt-4 border-t border-border/60 pt-3">{tabs}</div>}
    </header>
  );
}

export default ModuleHeader;
