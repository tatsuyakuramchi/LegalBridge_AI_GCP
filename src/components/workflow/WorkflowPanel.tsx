import * as React from "react"
import { createPortal } from "react-dom"
import { CheckCircle2, ChevronRight, Loader2, Sparkles } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  updateIssueStatus,
  getRecommendedNextStatus,
  type BacklogStatus,
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
