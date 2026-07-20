import * as React from "react";
import { cn } from "@/lib/utils";

export interface FormHeaderMetadata {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

export interface FormHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  back?: React.ReactNode;
  status?: React.ReactNode;
  metadata?: FormHeaderMetadata[];
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Detail / Edit / Workflow 画面で使用する共通ヘッダー。
 * 戻る導線、種別、タイトル、状態、メタ情報、主操作の順序を統一する。
 */
export function FormHeader({
  eyebrow,
  title,
  description,
  back,
  status,
  metadata = [],
  actions,
  className,
}: FormHeaderProps) {
  return (
    <header
      className={cn(
        "rounded-xl border border-border bg-card px-5 py-5 shadow-sm md:px-6",
        className
      )}
    >
      {(back || eyebrow) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">{back}</div>
          {eyebrow && (
            <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {eyebrow}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
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

          {metadata.length > 0 && (
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {metadata.map((item) => (
                <div key={item.label} className="flex min-w-0 items-baseline gap-2 text-xs">
                  <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
                  <dd
                    className={cn(
                      "min-w-0 truncate font-medium text-foreground",
                      item.mono && "font-mono"
                    )}
                  >
                    {item.value}
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
    </header>
  );
}
