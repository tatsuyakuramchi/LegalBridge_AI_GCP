import * as React from "react"
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/**
 * Phase 22.21.50: コントラストを強化。
 *   - 枠線を常時表示 (border-foreground/30)
 *   - OFF 時は bg-muted (薄いが視認できる) + Thumb 端に border
 *   - ON 時は bg-emerald-600 で 「ON」 が一目で分かる (旧 bg-foreground は黒で
 *     OFF (灰) と区別はつくが、状態が直感的でなかった)
 *   - Thumb は shadow-md + ring-1 で立体感を出す
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full",
        "border border-foreground/30",
        "transition-colors outline-none",
        // ON / OFF の背景色を明確化（UIC-24: success トークンで light/dark 両対応）
        "data-[checked]:bg-success data-[checked]:border-success",
        "data-[unchecked]:bg-muted",
        "focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-background",
          "shadow-md ring-1 ring-foreground/20",
          "transition-transform",
          "data-[checked]:translate-x-4 data-[unchecked]:translate-x-0.5"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
