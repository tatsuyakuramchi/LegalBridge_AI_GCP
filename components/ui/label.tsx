import * as React from "react"

import { cn } from "@/lib/utils"

function Label({
  className,
  ...props
}: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground select-none",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
