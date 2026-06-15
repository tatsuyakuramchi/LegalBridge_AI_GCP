import * as React from "react"

import { cn } from "@/lib/utils"

// NERV 端末風パネル: 角ブラケット(.bracketed) + オレンジのタイトルバー。
//   タイトルは MAGI 端末の質感を保つため等幅(font-mono)で固定。
export function NervPanel({
  title,
  tag,
  right,
  className,
  bodyClassName,
  children,
}: {
  title: string
  tag?: string
  right?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("relative bracketed border border-border bg-card/50", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-primary leading-none">▍</span>
          <p className="truncate text-[11px] font-mono font-bold uppercase tracking-[0.2em]">
            {title}
          </p>
          {tag && (
            <span className="shrink-0 border border-primary/50 px-1 text-[8px] font-mono uppercase tracking-[0.14em] text-primary">
              {tag}
            </span>
          )}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </div>
  )
}
