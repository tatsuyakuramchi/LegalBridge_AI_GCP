import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DangerZoneProps {
  title?: React.ReactNode;
  description: React.ReactNode;
  actions: React.ReactNode;
  className?: string;
}

/** 削除・統合・強制処理などの不可逆操作を通常操作から隔離する。 */
export function DangerZone({
  title = "危険な操作",
  description,
  actions,
  className,
}: DangerZoneProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-destructive/30 bg-destructive/5 p-4",
        className
      )}
      aria-labelledby="danger-zone-title"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="danger-zone-title" className="text-sm font-semibold text-destructive">
            {title}
          </h2>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
          <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      </div>
    </section>
  );
}
