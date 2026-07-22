import * as React from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export type WorkflowStepStatus = "done" | "current" | "todo";

export interface WorkflowStep {
  key: string;
  label: React.ReactNode;
  /** 補足(任意)。 */
  sub?: React.ReactNode;
  status?: WorkflowStepStatus;
}

export interface WorkflowStepperProps {
  steps: WorkflowStep[];
  /** status 未指定時に current を決める現在ステップ key(任意)。 */
  currentKey?: string;
  /** ステップ選択(任意・クリックで遷移させたい場合)。 */
  onSelect?: (key: string) => void;
  className?: string;
}

/**
 * 工程の進捗を横並びで示す共通ステッパー(Finance の受領→分配、データ保守の一括工程等)。
 * status を明示するか、currentKey を渡すと「それ以前=done / それ=current / それ以降=todo」で自動導出。
 */
export function WorkflowStepper({
  steps,
  currentKey,
  onSelect,
  className,
}: WorkflowStepperProps) {
  const curIdx = currentKey ? steps.findIndex((s) => s.key === currentKey) : -1;

  const statusOf = (s: WorkflowStep, i: number): WorkflowStepStatus => {
    if (s.status) return s.status;
    if (curIdx < 0) return "todo";
    if (i < curIdx) return "done";
    if (i === curIdx) return "current";
    return "todo";
  };

  return (
    <ol className={cn("flex w-full items-center gap-1 overflow-x-auto", className)}>
      {steps.map((s, i) => {
        const st = statusOf(s, i);
        const clickable = !!onSelect;
        return (
          <li key={s.key} className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              disabled={!clickable}
              onClick={clickable ? () => onSelect!(s.key) : undefined}
              aria-current={st === "current" ? "step" : undefined}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                clickable && "hover:bg-muted/50",
                st === "current"
                  ? "border-primary bg-primary/5"
                  : st === "done"
                    ? "border-border bg-card"
                    : "border-dashed border-border bg-card/50",
                !clickable && "cursor-default"
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums",
                  st === "done"
                    ? "bg-emerald-500 text-white dark:bg-emerald-600"
                    : st === "current"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {st === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block truncate text-[12px] font-semibold",
                    st === "todo" ? "text-muted-foreground" : "text-foreground"
                  )}
                >
                  {s.label}
                </span>
                {s.sub && <span className="block truncate text-[10px] text-muted-foreground">{s.sub}</span>}
              </span>
            </button>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn("h-px w-4 shrink-0", i < curIdx ? "bg-emerald-500/60" : "bg-border")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default WorkflowStepper;
