import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close

type SheetSide = "right" | "left" | "top" | "bottom"

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup> & { side?: SheetSide }) {
  const sideClasses: Record<SheetSide, string> = {
    right:
      "inset-y-0 right-0 h-full w-full sm:max-w-md border-l data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full",
    left:
      "inset-y-0 left-0 h-full w-full sm:max-w-md border-r data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full",
    top:
      "inset-x-0 top-0 w-full border-b data-[starting-style]:-translate-y-full data-[ending-style]:-translate-y-full",
    bottom:
      "inset-x-0 bottom-0 w-full border-t data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full",
  }
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity"
      />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 bg-card border-border shadow-2xl outline-none flex flex-col transition-transform duration-300",
          sideClasses[side],
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute top-3 right-3 inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1 px-6 py-4 border-b border-border bg-muted/30", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-sm font-mono font-bold uppercase tracking-[0.16em]", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-xs text-muted-foreground font-mono", className)}
      {...props}
    />
  )
}

function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex-1 overflow-y-auto px-6 py-4", className)} {...props} />
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-6 py-4 border-t border-border bg-muted/30",
        className
      )}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  SheetFooter,
}
