/**
 * VendorSearchSelect — 検索可能な取引先セレクタ (combobox)。
 *
 * 単純な <select> だと取引先が増えると探せないので、検索 input +
 * フィルタリングされた候補リストの組み合わせに置換する。
 *
 * 入力 1 文字以上で 取引先コード / 名称 / 屋号 のいずれかにマッチ。
 * クリックで選択 → onSelect(vendor) → ドロップダウンを閉じる。
 */

import * as React from "react"
import { Search, ChevronDown, X, Check, Building2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  vendors: any[]
  /** 既に選択済みの vendor_code (chip 表示用). 空欄なら未選択. */
  selectedCode?: string
  /** 取引先を選んだとき呼ばれる。null = 解除. */
  onSelect: (vendor: any | null) => void
  placeholder?: string
  /** "compact" だと小さい inline 用、"default" がフォーム用 */
  size?: "default" | "compact"
  disabled?: boolean
}

export const VendorSearchSelect: React.FC<Props> = ({
  vendors,
  selectedCode,
  onSelect,
  placeholder = "取引先を検索 (コード / 名称 / 屋号)",
  size = "default",
  disabled,
}) => {
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState("")
  const containerRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const selected = React.useMemo(
    () => vendors.find((v) => v.vendor_code === selectedCode) || null,
    [vendors, selectedCode]
  )

  // クリック外で閉じる
  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  // 開いたら input にフォーカス
  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return vendors.slice(0, 50) // 検索文字なしなら 50 件まで
    return vendors
      .filter((v) => {
        const fields = [
          v.vendor_code,
          v.vendor_name,
          v.trade_name,
          v.pen_name,
        ]
          .filter(Boolean)
          .map((s: string) => String(s).toLowerCase())
        return fields.some((f) => f.includes(term))
      })
      .slice(0, 100)
  }, [vendors, q])

  const handleSelect = (v: any) => {
    onSelect(v)
    setQ("")
    setOpen(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(null)
    setQ("")
  }

  const triggerCls = cn(
    "w-full text-[11px] font-mono bg-transparent",
    "border-b border-input py-1.5 px-1 focus:outline-none focus:border-foreground",
    "placeholder:text-muted-foreground/40 placeholder:text-[10px]",
    "disabled:opacity-60 disabled:cursor-not-allowed",
    "flex items-center justify-between gap-1.5",
    size === "compact" && "py-1 text-[10px]"
  )

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={triggerCls}
      >
        <span className="flex items-center gap-1.5 truncate flex-1 text-left">
          <Building2 className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          {selected ? (
            <>
              <span className="font-bold">{selected.vendor_code}</span>
              <span className="text-muted-foreground truncate">
                · {selected.vendor_name}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground/60">{placeholder}</span>
          )}
        </span>
        {selected && !disabled && (
          <span
            onClick={handleClear}
            className="text-muted-foreground/50 hover:text-foreground p-0.5"
            role="button"
            aria-label="選択を解除"
          >
            <X className="w-3 h-3" />
          </span>
        )}
        <ChevronDown
          className={cn(
            "w-3 h-3 text-muted-foreground flex-shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-sm shadow-xl z-30 max-h-[320px] flex flex-col">
          {/* Search input */}
          <div className="border-b border-border p-2 flex items-center gap-2 bg-muted/30 sticky top-0">
            <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="検索 (コード / 名称 / 屋号)"
              className="flex-1 text-[11px] font-mono bg-transparent focus:outline-none placeholder:text-muted-foreground/40"
            />
            <span className="text-[9px] font-mono text-muted-foreground/60">
              {filtered.length}/{vendors.length}
            </span>
          </div>

          {/* Results */}
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="p-3 text-center text-[10px] font-mono text-muted-foreground italic">
                該当する取引先が見つかりません
              </div>
            ) : (
              filtered.map((v) => {
                const isSelected = v.vendor_code === selectedCode
                return (
                  <button
                    key={v.id || v.vendor_code}
                    type="button"
                    onClick={() => handleSelect(v)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 hover:bg-muted text-[11px] font-mono flex items-center gap-2 border-b border-border/30 last:border-b-0",
                      isSelected && "bg-emerald-50"
                    )}
                  >
                    <span className="font-bold w-16 flex-shrink-0">
                      {v.vendor_code || "—"}
                    </span>
                    <span className="flex-1 truncate">
                      {v.vendor_name}
                      {v.trade_name && (
                        <span className="text-muted-foreground/70 ml-1">
                          ({v.trade_name})
                        </span>
                      )}
                    </span>
                    {v.entity_type && (
                      <span className="text-[9px] text-muted-foreground/70 flex-shrink-0">
                        {v.entity_type === "corporate" ||
                        v.entity_type === "法人"
                          ? "法人"
                          : "個人"}
                      </span>
                    )}
                    {isSelected && (
                      <Check className="w-3 h-3 text-emerald-700 flex-shrink-0" />
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
