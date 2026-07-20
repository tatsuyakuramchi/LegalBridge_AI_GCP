import * as React from "react";
import { cn } from "@/lib/utils";

export interface CompactFormGridProps {
  columns?: 1 | 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}

const COLUMN_CLASS: Record<NonNullable<CompactFormGridProps["columns"]>, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
};

/** Dialog / Drawer / インライン追加で使う小型フォームの共通グリッド。 */
export function CompactFormGrid({ columns = 2, children, className }: CompactFormGridProps) {
  return <div className={cn("grid gap-4", COLUMN_CLASS[columns], className)}>{children}</div>;
}

export interface CompactFormActionsProps {
  children: React.ReactNode;
  className?: string;
}

export function CompactFormActions({ children, className }: CompactFormActionsProps) {
  return (
    <div
      className={cn(
        "mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4",
        className
      )}
    >
      {children}
    </div>
  );
}
