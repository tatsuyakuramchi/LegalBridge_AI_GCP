import * as React from "react"
import { createPortal } from "react-dom"
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Sparkles,
  X,
} from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  updateIssueStatus,
  getRecommendedNextStatus,
  getIssueLineItems,
  updateLineItemDeadline,
  type BacklogStatus,
  type OrderLineItem,
} from "@/src/lib/backlog"

type Props = {
  /** 対象の Backlog Issue Key (例: "LEGAL-123")。空のとき何も描画しない */
  issueKey: string | null | undefined
  /**
   * Issue の現在ステータス。AppDataContext の issues から取り出して渡す。
   * { id, name } 形式。Backlog API の status オブジェクトと同じ構造。
   */
  currentStatus?: { id?: number; name?: string } | null
  /**
   * Issue の type 名 (例: "発注書" / "NDA")。推奨次ステータスを引くキー。
   */
  issueTypeName?: string | null
  /** ステータス変更が完了した後に呼ばれる (一覧の refresh などに使用) */
  onChanged?: (newStatus: BacklogStatus) => void
  /** コンパクト表示 (RequestsPage の行内ドロップダウン用)。デフォルト false */
  compact?: boolean
  className?: string
}

/**
 * Phase 18: 起案された Issue のステータスを手動で進めるパネル。
 *
 * AppDataContext の `statuses` (= /api/backlog/statuses の結果) と
 * workflow_settings の推奨次ステータスをマージして、ユーザーが
 * クリック一発で Backlog のステータスを変更できる UI を提供する。
 *
 * compact モードは React Portal で document.body にメニューを描画する。
 * これは親 Card が overflow-hidden (components/ui/card.tsx) で
 * absolute 配置の dropdown を切り抜いてしまう問題への対策。
 */
export function WorkflowPanel({
  issueKey,
  currentStatus,
  issueTypeName,
  onChanged,
  compact = false,
  className,
}: Props) {
  const { statuses, refreshIssues, showNotification } = useAppData()
  const [pending, setPending] = React.useState<number | null>(null)
  const [recommendedId, setRecommendedId] = React.useState<number | null>(null)

  // Phase 20 (修正版): 業務明細単位の納期編集 state
  // - lineItems: GET /api/management/issues/:issueKey/line-items の結果
  // - editingLineId: 現在編集中の line_item_id (null = 全部閉じている)
  // - lineDateInput: date input の値 (YYYY-MM-DD)
  // - lineReasonInput: 変更理由 (任意)
  // - linePending: 保存中の line_item_id
  const [lineItems, setLineItems] = React.useState<OrderLineItem[]>([])
  const [lineItemsLoading, setLineItemsLoading] = React.useState(false)
  const [editingLineId, setEditingLineId] = React.useState<number | null>(null)
  const [lineDateInput, setLineDateInput] = React.useState("")
  const [lineReasonInput, setLineReasonInput] = React.useState("")
  const [linePending, setLinePending] = React.useState<number | null>(null)

  const loadLineItems = React.useCallback(async () => {
    if (!issueKey) return
    setLineItemsLoading(true)
    try {
      const items = await getIssueLineItems(issueKey)
      setLineItems(items)
    } catch (e) {
      // 失敗時は無視 (line_items が無い issue タイプもある)
      setLineItems([])
    } finally {
      setLineItemsLoading(false)
    }
  }, [issueKey])

  React.useEffect(() => {
    void loadLineItems()
  }, [loadLineItems])

  const handleExtendLine = async (item: OrderLineItem) => {
    if (!lineDateInput) {
      showNotification("新しい納期を入力してください", "error")
      return
    }
    const d = new Date(lineDateInput)
    if (Number.isNaN(d.getTime())) {
      showNotification("無効な日付形式です", "error")
      return
    }
    const oldStr = item.delivery_date
      ? new Date(item.delivery_date).toLocaleDateString("ja-JP")
      : "(未設定)"
    if (
      !window.confirm(
        `業務明細 #${item.line_no} (${item.item_name || "—"}) の納期を変更します。\n\n` +
          `${oldStr} → ${d.toLocaleDateString("ja-JP")}\n\n` +
          `Backlog 課題にコメントで変更履歴が残り、申請者と部署チャンネルへ通知されます。\nよろしいですか？`
      )
    ) {
      return
    }
    setLinePending(item.line_item_id)
    try {
      const r = await updateLineItemDeadline(
        item.line_item_id,
        d,
        lineReasonInput.trim() || undefined
      )
      showNotification(
        `明細 #${r.line_no} の納期を ${r.new_date} に変更しました${
          r.backlog_commented ? " (Backlog コメント追加済み)" : ""
        }`,
        "success"
      )
      setEditingLineId(null)
      setLineDateInput("")
      setLineReasonInput("")
      await loadLineItems()
      await refreshIssues?.()
    } catch (e: any) {
      showNotification(`納期変更に失敗: ${e?.message || e}`, "error")
    } finally {
      setLinePending(null)
    }
  }

  const startEditLine = (item: OrderLineItem) => {
    setEditingLineId(item.line_item_id)
    setLineDateInput(
      item.delivery_date
        ? new Date(item.delivery_date).toISOString().slice(0, 10)
        : ""
    )
    setLineReasonInput("")
  }
  const cancelEditLine = () => {
    setEditingLineId(null)
    setLineDateInput("")
    setLineReasonInput("")
  }

  // 推奨次ステータスを workflow_settings から取得
  React.useEffect(() => {
    if (!issueTypeName) {
      setRecommendedId(null)
      return
    }
    let cancelled = false
    getRecommendedNextStatus(issueTypeName).then((id) => {
      if (!cancelled) setRecommendedId(id)
    })
    return () => {
      cancelled = true
    }
  }, [issueTypeName])

  const orderedStatuses: BacklogStatus[] = React.useMemo(() => {
    const arr = Array.isArray(statuses) ? [...(statuses as any[])] : []
    arr.sort((a: any, b: any) => {
      const ao = a.displayOrder ?? a.id ?? 0
      const bo = b.displayOrder ?? b.id ?? 0
      return ao - bo
    })
    return arr as BacklogStatus[]
  }, [statuses])

  const handleAdvance = async (target: BacklogStatus) => {
    if (!issueKey) return
    if (target.id === currentStatus?.id) return
    if (pending != null) return

    const ok = window.confirm(
      `Backlog ${issueKey} のステータスを「${target.name}」に変更します。\n\nよろしいですか？`
    )
    if (!ok) return

    setPending(target.id)
    try {
      await updateIssueStatus(issueKey, target.id)
      showNotification(
        `${issueKey} → ${target.name} に変更しました`,
        "success"
      )
      onChanged?.(target)
      await refreshIssues?.()
    } catch (e: any) {
      showNotification(`ステータス変更に失敗: ${e?.message || e}`, "error")
    } finally {
      setPending(null)
    }
  }

  if (!issueKey) return null

  // ─── Compact (行内ドロップダウン) ─────────────────────────────
  if (compact) {
    return (
      <CompactDropdown
        issueKey={issueKey}
        currentStatus={currentStatus}
        statuses={orderedStatuses}
        pending={pending}
        recommendedId={recommendedId}
        onPick={handleAdvance}
        className={className}
      />
    )
  }

  // ─── Expanded (DocumentEditorPage 用) ────────────────────────
  return (
    <div
      className={cn(
        "border border-border rounded-md bg-card p-4 space-y-3",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="retro-tag">STATUS · WORKFLOW</p>
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mt-1">
            {issueKey}
          </p>
        </div>
        <Badge
          variant="outline"
          className="h-6 font-mono text-[11px] uppercase tracking-wider"
        >
          <CheckCircle2 className="h-3 w-3 mr-1 text-phosphor" />
          {currentStatus?.name || "—"}
        </Badge>
      </div>

      <div className="retro-rule" />

      <div>
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-2">
          Advance to:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {orderedStatuses.map((s) => {
            const isCurrent = s.id === currentStatus?.id
            const isRecommended =
              !isCurrent && recommendedId != null && s.id === recommendedId
            const isPending = pending === s.id
            return (
              <Button
                key={s.id}
                size="sm"
                variant={
                  isCurrent ? "ghost" : isRecommended ? "default" : "outline"
                }
                disabled={isCurrent || pending != null}
                onClick={() => handleAdvance(s)}
                className={cn(
                  "h-8 font-mono text-[11px] uppercase tracking-[0.14em]",
                  isCurrent && "opacity-50 cursor-not-allowed"
                )}
                title={
                  isCurrent
                    ? "現在のステータス"
                    : `Backlog ${issueKey} を「${s.name}」に進める`
                }
              >
                {isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : isRecommended ? (
                  <Sparkles className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {s.name}
              </Button>
            )
          })}
        </div>
        {recommendedId != null && (
          <p className="text-[10px] font-mono text-muted-foreground mt-2">
            <Sparkles className="inline h-3 w-3 mr-1 text-phosphor" />
            <span className="tracking-[0.14em] uppercase">Recommended</span>
            <span className="ml-1.5">
              ({issueTypeName} → workflow_settings)
            </span>
          </p>
        )}
      </div>

      {/* Phase 20 (修正版): 業務明細毎の納期管理 ────────────────────── */}
      {(lineItemsLoading || lineItems.length > 0) && (
        <>
          <div className="retro-rule" />
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-2 flex items-center gap-1.5">
              <CalendarClock className="h-3 w-3" />
              Deliveries · Line items
            </p>

            {lineItemsLoading ? (
              <p className="text-[10px] font-mono text-muted-foreground">
                <Loader2 className="inline h-3 w-3 animate-spin mr-1" />
                Loading…
              </p>
            ) : (
              <div className="space-y-1">
                {lineItems.map((item) => {
                  const isEditing = editingLineId === item.line_item_id
                  const isPending = linePending === item.line_item_id
                  const dateStr = item.delivery_date
                    ? new Date(item.delivery_date).toLocaleDateString("ja-JP")
                    : "—"
                  const today = new Date()
                  today.setHours(0, 0, 0, 0)
                  const d = item.delivery_date ? new Date(item.delivery_date) : null
                  const daysUntil = d
                    ? Math.round((d.getTime() - today.getTime()) / 86400000)
                    : null
                  let dateBadge: React.ReactNode = null
                  if (item.accepted) {
                    dateBadge = (
                      <span className="text-[9px] font-mono tracking-[0.14em] text-emerald-600 uppercase ml-1">
                        accepted
                      </span>
                    )
                  } else if (daysUntil != null) {
                    if (daysUntil < 0) {
                      dateBadge = (
                        <span className="text-[9px] font-mono tracking-[0.14em] text-destructive uppercase ml-1">
                          {Math.abs(daysUntil)}d overdue
                        </span>
                      )
                    } else if (daysUntil <= 7) {
                      dateBadge = (
                        <span className="text-[9px] font-mono tracking-[0.14em] text-phosphor uppercase ml-1">
                          in {daysUntil}d
                        </span>
                      )
                    } else {
                      dateBadge = (
                        <span className="text-[9px] font-mono tracking-[0.14em] text-muted-foreground uppercase ml-1">
                          in {daysUntil}d
                        </span>
                      )
                    }
                  }

                  return (
                    <div
                      key={item.line_item_id}
                      className={cn(
                        "rounded-sm border border-border px-2 py-1.5",
                        isEditing ? "bg-accent/30" : "bg-card"
                      )}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] shrink-0">
                          #{item.line_no}
                        </span>
                        <span className="text-xs font-mono flex-1 truncate">
                          {item.item_name || "—"}
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground tab-mono">
                          {dateStr}
                        </span>
                        {dateBadge}
                        {!isEditing && !item.accepted && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEditLine(item)}
                            disabled={linePending != null}
                            className="h-6 font-mono text-[10px] uppercase tracking-[0.14em]"
                            title="この明細の納期を変更"
                          >
                            <CalendarClock className="h-2.5 w-2.5" />
                            延長
                          </Button>
                        )}
                      </div>

                      {isEditing && (
                        <div className="mt-2 space-y-1.5">
                          <div className="flex flex-wrap gap-1.5 items-center">
                            <Input
                              type="date"
                              value={lineDateInput}
                              onChange={(e) => setLineDateInput(e.target.value)}
                              disabled={isPending}
                              className="h-7 w-36 font-mono text-xs"
                              min={new Date().toISOString().slice(0, 10)}
                            />
                            <Input
                              type="text"
                              placeholder="変更理由 (任意)"
                              value={lineReasonInput}
                              onChange={(e) => setLineReasonInput(e.target.value)}
                              disabled={isPending}
                              maxLength={500}
                              className="h-7 flex-1 min-w-[160px] font-mono text-xs"
                            />
                            <Button
                              size="sm"
                              onClick={() => handleExtendLine(item)}
                              disabled={isPending || !lineDateInput}
                              className="h-7 font-mono text-[10px] uppercase tracking-[0.14em]"
                            >
                              {isPending ? (
                                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              ) : (
                                <ChevronRight className="h-2.5 w-2.5" />
                              )}
                              実行
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelEditLine}
                              disabled={isPending}
                              className="h-7 font-mono text-[10px] uppercase tracking-[0.14em]"
                            >
                              <X className="h-2.5 w-2.5" />
                            </Button>
                          </div>
                          <p className="text-[10px] font-mono text-muted-foreground">
                            DB の delivery_date を更新し、Backlog 課題にコメントを追加します。
                            申請者と部署チャンネルにも通知されます。
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- */

type CompactProps = {
  issueKey: string
  currentStatus?: { id?: number; name?: string } | null
  statuses: BacklogStatus[]
  pending: number | null
  recommendedId: number | null
  onPick: (target: BacklogStatus) => void | Promise<void>
  className?: string
}

const MENU_WIDTH = 220
const MENU_PADDING = 8
const ITEM_HEIGHT = 30 // 1 行の実測高さ
const MENU_CHROME = 12 // メニュー自身の padding + border 分

type MenuCoords = {
  top: number
  left: number
  maxHeight: number
  /** ボタンの上側に出るとき true (caret 方向の判定にも使う) */
  above: boolean
}

function CompactDropdown({
  issueKey,
  currentStatus,
  statuses,
  pending,
  recommendedId,
  onPick,
  className,
}: CompactProps) {
  const [open, setOpen] = React.useState(false)
  const [coords, setCoords] = React.useState<MenuCoords | null>(null)
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)

  const placeMenu = React.useCallback(() => {
    const el = wrapperRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()

    // 横位置: ボタンの左端基準で右に展開 (左揃え)。
    // ビューポート右端からはみ出るときだけ右端寄せに切り替える。
    let left = rect.left
    if (left + MENU_WIDTH > window.innerWidth - MENU_PADDING) {
      left = window.innerWidth - MENU_WIDTH - MENU_PADDING
    }
    if (left < MENU_PADDING) left = MENU_PADDING

    // 縦位置: 下側に十分な空間があれば下に出す。
    // 下側が狭く、上側のほうが広ければ上に出す (反転)。
    const spaceBelow = window.innerHeight - rect.bottom - MENU_PADDING
    const spaceAbove = rect.top - MENU_PADDING
    const needed = Math.min(
      statuses.length * ITEM_HEIGHT + MENU_CHROME,
      360 // 絶対上限
    )

    let top: number
    let maxHeight: number
    let above: boolean

    if (spaceBelow >= needed || spaceBelow >= spaceAbove) {
      // 下に出す
      top = rect.bottom + 4
      maxHeight = Math.min(needed, spaceBelow - 4)
      above = false
    } else {
      // 上に出す。max は空き分まで切り詰める (= 必ずビューポートに収まる)
      maxHeight = Math.min(needed, spaceAbove - 4)
      top = rect.top - maxHeight - 4
      above = true
    }

    setCoords({ top, left, maxHeight, above })
  }, [statuses.length])

  React.useEffect(() => {
    if (open) placeMenu()
    else setCoords(null)
  }, [open, placeMenu])

  // 外側クリック / スクロール / リサイズ で閉じる
  React.useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (
        !wrapperRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    const onReflow = () => placeMenu()
    document.addEventListener("mousedown", onMouseDown)
    window.addEventListener("scroll", onReflow, true)
    window.addEventListener("resize", onReflow)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("scroll", onReflow, true)
      window.removeEventListener("resize", onReflow)
    }
  }, [open, placeMenu])

  const menu =
    open && coords && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: MENU_WIDTH,
              maxHeight: coords.maxHeight,
              zIndex: 1000,
              // ─── 重要: Tailwind v4 @theme inline + HSL components のため
              // bg-card / border-border クラスが透明色に展開されるケースが
              // ある。Portal で document.body にレンダリングしているので
              // 不透明な背景を絶対に確保したい。よって明示的に hsl(var())
              // を inline style で指定する。
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              borderWidth: 1,
              borderStyle: "solid",
              borderRadius: "0.375rem",
              boxShadow:
                "0 18px 40px -8px hsl(var(--foreground) / 0.22), " +
                "0 6px 16px -4px hsl(var(--foreground) / 0.14), " +
                "0 0 0 1px hsl(var(--foreground) / 0.06)",
              padding: 4,
              overflowY: "auto",
            }}
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            {/* メニューヘッダ: 何を変更しようとしているか明示 */}
            <div
              className="px-2 py-1 mb-1 flex items-center justify-between gap-2"
              style={{
                borderBottom: "1px solid hsl(var(--border))",
              }}
            >
              <span className="text-[9px] font-mono uppercase tracking-[0.22em] text-muted-foreground">
                ▍ STATUS · {issueKey}
              </span>
              <span className="text-[8px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                {statuses.length}
              </span>
            </div>

            {statuses.length === 0 ? (
              <div className="px-2 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                no statuses
              </div>
            ) : (
              statuses.map((s) => {
                const isCurrent = s.id === currentStatus?.id
                const isRecommended =
                  !isCurrent && recommendedId != null && s.id === recommendedId
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={isCurrent || pending != null}
                    onClick={async () => {
                      setOpen(false)
                      await onPick(s)
                    }}
                    style={{
                      backgroundColor: "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (isCurrent) return
                      ;(e.currentTarget as HTMLElement).style.backgroundColor =
                        "hsl(var(--accent))"
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLElement).style.backgroundColor =
                        "transparent"
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left",
                      "font-mono text-[11px] uppercase tracking-[0.12em]",
                      "transition-colors",
                      isCurrent &&
                        "opacity-50 cursor-not-allowed pointer-events-none"
                    )}
                  >
                    {isCurrent ? (
                      <CheckCircle2 className="h-3 w-3 text-phosphor shrink-0" />
                    ) : isRecommended ? (
                      <Sparkles className="h-3 w-3 text-phosphor shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    <span className="flex-1 truncate">{s.name}</span>
                    {isCurrent && (
                      <span className="text-[9px] tracking-[0.18em] text-muted-foreground">
                        現在
                      </span>
                    )}
                    {isRecommended && !isCurrent && (
                      <span className="text-[9px] tracking-[0.18em] text-phosphor">
                        推奨
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>,
          document.body
        )
      : null

  return (
    <div
      ref={wrapperRef}
      className={cn("relative inline-block", className)}
    >
      <Button
        size="sm"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        disabled={pending != null}
        className="h-7 font-mono text-[10px] uppercase tracking-[0.14em]"
        title={`Backlog ${issueKey} のステータスを変更`}
      >
        {pending != null ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3 w-3 text-phosphor" />
        )}
        {currentStatus?.name || "—"}
        <ChevronRight className="h-3 w-3 rotate-90" />
      </Button>
      {menu}
    </div>
  )
}
