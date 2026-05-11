import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-[0.14em] whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive [a]:hover:bg-destructive/20",
        outline: "border-border text-foreground [a]:hover:bg-muted",
        ghost: "border-transparent hover:bg-muted hover:text-muted-foreground",
        phosphor:
          "border-amber-600/40 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
        success:
          "border-emerald-600/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
        info:
          "border-cyan-600/40 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
