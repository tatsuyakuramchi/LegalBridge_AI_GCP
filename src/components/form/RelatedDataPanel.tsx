import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RelatedDataItem {
  id: string | number;
  label: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "default" | "info" | "warning" | "danger" | "success";
}

export interface RelatedDataPanelProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  items?: RelatedDataItem[];
  empty?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

const TONE_CLASS: Record<NonNullable<RelatedDataItem["tone"]>, string> = {
  default: "border-border bg-card",
  info: "border-info/30 bg-info/5",
  warning: "border-warning/30 bg-warning/5",
  danger: "border-destructive/30 bg-destructive/5",
  success: "border-success/30 bg-success/5",
};

/** 関連契約・文書・作品・条件・証憑を同じ表現で表示する右パネル。 */
export function RelatedDataPanel({
  title,
  description,
  items = [],
  empty = "関連データはありません。",
  footer,
  className,
}: RelatedDataPanelProps) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-4 shadow-sm", className)}>
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>

      {items.length > 0 ? (
        <div className="mt-4 space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3",
                TONE_CLASS[item.tone ?? "default"]
              )}
            >
              {item.icon && (
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
                  {item.icon}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{item.label}</div>
                    {item.description && (
                      <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        {item.description}
                      </div>
                    )}
                    {item.meta && <div className="mt-1 text-[11px] text-muted-foreground">{item.meta}</div>}
                  </div>
                  <div className="shrink-0">
                    {item.action ?? <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-5 text-center text-xs text-muted-foreground">
          {empty}
        </div>
      )}

      {footer && <div className="mt-4 border-t border-border pt-3">{footer}</div>}
    </section>
  );
}
