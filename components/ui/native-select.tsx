import * as React from "react"
import { ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * NativeSelect — a lightweight wrapper around the platform <select>
 * with shadcn/retro-future styling. Use this for forms with many
 * options (vendors, staff, templates) where the native picker
 * keeps things fast and accessible.
 *
 * For richer, fully-controlled menus prefer the base-ui Select
 * primitive directly.
 */
function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          "flex h-9 w-full appearance-none rounded-md border border-input bg-card pl-3 pr-8 text-sm font-mono shadow-xs transition-[color,box-shadow] outline-none",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
    </div>
  )
}

export { NativeSelect }
