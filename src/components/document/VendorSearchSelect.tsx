/**
 * VendorSearchSelect — 検索可能な取引先セレクタ (combobox)。
 *
 * 単純な <select> だと取引先が増えると探せないので、検索 input +
 * フィルタリングされた候補リストの組み合わせに置換する。
 *
 * 入力 1 文字以上で 取引先コード / 名称 / 屋号 のいずれかにマッチ。
 * クリックで選択 → onSelect(vendor) → ドロップダウンを閉じる。
 *
 * Phase 22.6.1: Dialog 内で使われたときに親の overflow-y-auto に閉じ込められて
 * 後続の form fields とぐちゃぐちゃに重なる視認性問題があった。これを避けるため
 * ドロップダウンは createPortal で document.body にレンダリングし、トリガーの
 * getBoundingClientRect() を元に fixed 位置決めする。
 * スクロール / リサイズ時は位置を追従更新。
 */

import * as React from "react"
import { createPortal } from "react-dom"
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
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const dropdownRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  // Portal 配置用: トリガーの viewport 座標 + 幅。
  // 初期値は viewport の外 (-9999px) にして、recalcPosition 前のチラつきを完全排除。
  const [dropdownStyle, setDropdownStyle] =
    React.useState<React.CSSProperties>({
      position: "fixed",
      top: -9999,
      left: -9999,
      width: 0,
    })

  const selected = React.useMemo(
    () => vendors.find((v) => v.vendor_code === selectedCode) || null,
    [vendors, selectedCode]
  )

  // 開いている間、トリガーの座標から ドロップダウンの fixed 位置を再計算。
  // ウィンドウ / 親 scroll の都度更新するので、scroll イベントを capture phase で拾う。
  const recalcPosition = React.useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const r = trigger.getBoundingClientRect()
    // 下方向に十分なスペースがないときは上方向に開く
    const dropdownMaxH = 320
    const spaceBelow = window.innerHeight - r.bottom
    const openUpward = spaceBelow < dropdownMaxH + 12 && r.top > dropdownMaxH
    setDropdownStyle({
      position: "fixed",
      left: r.left,
      width: r.width,
      ...(openUpward
        ? { bottom: window.innerHeight - r.top + 4 }
        : { top: r.bottom + 4 }),
      // Dialog backdrop は z-50。ここは破格に高くしておけば
      // 親の stacking context に巻き込まれても確実に最前面に出る。
      zIndex: 2147483000,
      // CSS トークン (bg-popover 等) に頼らず、インラインで完全不透明な背景を強制。
      // (Tailwind v4 の @theme inline 解決によっては alpha 値が混入する可能性
      // があるため、根本的に opaque を保証する)
      backgroundColor: "#ffffff",
      // isolation で完全な stacking context を生成 → 親の transform/filter/will-change
      // 等の副作用を一切受けない
      isolation: "isolate",
    })
  }, [])

  // クリック外で閉じる (Portal も含めて判定)
  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const inTrigger =
        containerRef.current?.contains(e.target as Node) ?? false
      const inDropdown =
        dropdownRef.current?.contains(e.target as Node) ?? false
      if (!inTrigger && !inDropdown) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  // 開いたら input にフォーカス + 位置初期化
  React.useEffect(() => {
    if (!open) return
    recalcPosition()
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [open, recalcPosition])

  // ウィンドウ / 親 scroll に追従。capture phase で全ての scroll を拾う。
  React.useEffect(() => {
    if (!open) return
    const onScrollOrResize = () => recalcPosition()
    window.addEventListener("scroll", onScrollOrResize, true)
    window.addEventListener("resize", onScrollOrResize)
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true)
      window.removeEventListener("resize", onScrollOrResize)
    }
  }, [open, recalcPosition])

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

  // ドロップダウン本体 (Portal でレンダリング)。
  // 背景はインラインで #ffffff を強制 (CSS トークンに依存しない)。
  // isolation: isolate + 巨大 zIndex で親 stacking context から完全分離。
  const dropdownContent = open ? (
    <div
      ref={dropdownRef}
      style={dropdownStyle}
      className="border border-border rounded-sm shadow-2xl max-h-[320px] flex flex-col"
    >
      {/* Search input */}
      <div
        className="border-b border-border p-2 flex items-center gap-2 sticky top-0"
        style={{ backgroundColor: "#f5f5f4" }}
      >
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

      {/* Results — 親の inline bg を継承するため、ここでも explicit に white */}
      <div
        className="overflow-y-auto flex-1"
        style={{ backgroundColor: "#ffffff" }}
      >
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
                style={
                  isSelected ? undefined : { backgroundColor: "#ffffff" }
                }
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
  ) : null

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        ref={triggerRef}
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

      {/* Dropdown - rendered into document.body via Portal so it escapes any
          parent overflow / stacking context (e.g. Dialog body, scrollable cards). */}
      {typeof document !== "undefined" &&
        dropdownContent &&
        createPortal(dropdownContent, document.body)}
    </div>
  )
}
