import * as React from "react"
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
 * 現在 status は無効ボタン (= 押せない) として表示し、それ以外を
 * クリック可能ボタンとして並べる。displayOrder が信頼できないため、
 * id 順で安定ソートしている。
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
      // バックエンドへの反映を待ってから一覧 refetch
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
  const ref = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
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
      {open && (
        <div
          className="absolute right-0 z-40 mt-1 w-48 rounded-md border border-border bg-popover shadow-lg p-1"
          onClick={(e) => e.stopPropagation()}
        >
          {statuses.map((s) => {
            const isCurrent = s.id === currentStatus?.id
            const isRecommended =
              !isCurrent && recommendedId != null && s.id === recommendedId
            return (
              <button
                key={s.id}
                disabled={isCurrent || pending != null}
                onClick={async () => {
                  setOpen(false)
                  await onPick(s)
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left",
                  "font-mono text-[11px] uppercase tracking-[0.12em]",
                  "hover:bg-accent transition-colors",
                  isCurrent &&
                    "opacity-50 cursor-not-allowed pointer-events-none"
                )}
              >
                {isCurrent ? (
                  <CheckCircle2 className="h-3 w-3 text-phosphor" />
                ) : isRecommended ? (
                  <Sparkles className="h-3 w-3 text-phosphor" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
                <span className="flex-1">{s.name}</span>
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
          })}
        </div>
      )}
    </div>
  )
}
