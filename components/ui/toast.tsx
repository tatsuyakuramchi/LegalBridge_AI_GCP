import * as React from "react"
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react"

import { cn } from "@/lib/utils"

export type ToastType = "info" | "success" | "error"

export interface ToastItem {
  id: string
  message: string
  type: ToastType
}

interface ToastContextValue {
  push: (message: string, type?: ToastType) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within a ToastProvider")
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([])

  const push = React.useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).slice(2, 10)
    setItems((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id))
    }, 4500)
  }, [])

  const dismiss = (id: string) => setItems((prev) => prev.filter((t) => t.id !== id))

  const variants: Record<ToastType, { icon: React.ReactNode; cls: string }> = {
    info: {
      icon: <Info className="h-4 w-4" />,
      cls: "border-border bg-card text-foreground",
    },
    success: {
      icon: <CheckCircle2 className="h-4 w-4" />,
      cls: "border-emerald-600/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    },
    error: {
      icon: <AlertCircle className="h-4 w-4" />,
      cls: "border-destructive/40 bg-destructive/10 text-destructive",
    },
  }

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-[min(420px,90vw)] flex-col gap-2 pointer-events-none">
        {items.map((t) => (
          // Phase 23.0.4: error 通知はスクリーンリーダーに即時読み上げてほしいので
          //   role="alert" + aria-live="assertive" に分離。info/success は polite。
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            aria-live={t.type === "error" ? "assertive" : "polite"}
            className={cn(
              "pointer-events-auto flex items-start gap-3 border px-3 py-2.5 shadow-lg backdrop-blur-sm rounded-sm",
              "animate-in slide-in-from-right-4 fade-in",
              variants[t.type].cls
            )}
          >
            <span className="mt-0.5 shrink-0">{variants[t.type].icon}</span>
            <p className="flex-1 text-xs font-mono leading-snug">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-sm p-0.5 opacity-50 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
