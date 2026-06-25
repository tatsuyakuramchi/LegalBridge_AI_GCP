import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  Layers,
  Loader2,
  RefreshCw,
  Search,
  ChevronRight,
  User,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

// 新課題(統一課題)一覧。設計: docs/design/unified-issue-ui-plan.md
//   1行 = 1契約(capability)。締結+支払フェイズ課題・文書・条件明細を束ねた新課題。
//   API: GET /api/unified-issues

type UnifiedRow = {
  capability_id: number | null
  document_number: string | null
  contract_title: string | null
  record_type: string | null
  contract_category: string | null
  contracting_issue_key: string | null
  effective_date: string | null
  expiration_date: string | null
  vendor_name: string | null
  has_contract_doc: boolean
  line_count: number
  open_lines: number
  completed_lines: number
  remaining_amount: number | null
  event_count: number
  has_inspection: boolean
  has_royalty: boolean
  issue_count: number
  next_action_lines: number
  stage: { contracting: boolean; inspection: boolean; royalty: boolean }
  completed: boolean
  pending?: boolean
  status_name?: string | null
}

const yen = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(Number(n))

function MiniLane({ stage }: { stage: UnifiedRow["stage"] }) {
  const cells = [
    { label: "締", on: stage.contracting },
    { label: "検", on: stage.inspection },
    { label: "計", on: stage.royalty },
  ]
  return (
    <div className="flex items-center gap-0.5">
      {cells.map((c) => (
        <span
          key={c.label}
          className={cn(
            "text-[9px] font-mono w-4 h-4 flex items-center justify-center rounded-sm border",
            c.on
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-muted text-muted-foreground/50 border-border"
          )}
          title={c.label}
        >
          {c.label}
        </span>
      ))}
    </div>
  )
}

export function UnifiedIssuesListPage() {
  const navigate = useNavigate()
  const [rows, setRows] = React.useState<UnifiedRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [q, setQ] = React.useState("")
  const [hideCompleted, setHideCompleted] = React.useState(false)
  const [onlyNextAction, setOnlyNextAction] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/unified-issues")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setRows(Array.isArray(json.unified_issues) ? json.unified_issues : [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const filtered = rows.filter((r) => {
    if (hideCompleted && r.completed) return false
    if (onlyNextAction && Number(r.next_action_lines) === 0) return false
    if (q.trim()) {
      const s = q.trim().toLowerCase()
      const hay = `${r.document_number || ""} ${r.contract_title || ""} ${r.vendor_name || ""} ${r.contracting_issue_key || ""}`.toLowerCase()
      if (!hay.includes(s)) return false
    }
    return true
  })

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Layers className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-sm font-mono font-bold uppercase tracking-[0.14em]">新課題(統一課題)</h1>
        <span className="text-[11px] font-mono text-muted-foreground">契約単位で締結+支払フェイズ課題を束ねる</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className={cn(
            "text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-3 py-1.5 flex items-center gap-1.5 hover:bg-muted",
            loading && "opacity-50 cursor-not-allowed"
          )}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          更新
        </button>
      </div>

      {/* フィルタ */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="取引先 / 文書番号 / 件名 で検索"
            className="pl-8 h-8 text-[12px]"
          />
        </div>
        <label className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
          完了を隠す
        </label>
        <label className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={onlyNextAction} onChange={(e) => setOnlyNextAction(e.target.checked)} />
          次アクション有りのみ
        </label>
        <span className="text-[11px] font-mono text-muted-foreground">{filtered.length} / {rows.length} 件</span>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-900 rounded-sm px-4 py-2 text-[12px] font-mono">取得失敗: {error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
        </div>
      ) : (
        <div className="border border-border rounded-sm overflow-hidden">
          {/* ヘッダ行 */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 px-3 py-2 bg-muted/50 text-[10px] font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
            <span>契約 / 取引先</span>
            <span>段階</span>
            <span className="text-right">明細</span>
            <span className="text-right">残/進捗</span>
            <span className="text-right">課題</span>
            <span></span>
          </div>
          {filtered.length === 0 ? (
            <div className="text-center py-10 text-[12px] font-mono text-muted-foreground">該当なし</div>
          ) : (
            filtered.map((r) => (
              <button
                key={r.capability_id ?? `pending:${r.contracting_issue_key}`}
                onClick={() =>
                  navigate(
                    r.pending && r.contracting_issue_key
                      ? `/issues/${encodeURIComponent(r.contracting_issue_key)}`
                      : `/unified/${r.capability_id}`
                  )
                }
                className={cn(
                  "w-full grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 px-3 py-2.5 items-center text-left border-b border-border last:border-0 hover:bg-muted/40",
                  r.pending && "bg-amber-50/40"
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-mono font-bold truncate">
                      {r.pending ? r.contracting_issue_key : r.document_number || `cap${r.capability_id}`}
                    </span>
                    {r.pending && <Badge className="bg-amber-500 text-white hover:bg-amber-500 text-[9px]">未着手</Badge>}
                    {r.record_type && <Badge variant="outline" className="text-[9px]">{r.record_type}</Badge>}
                    {r.completed && <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 text-[9px]">完了</Badge>}
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-1 truncate">
                    <User className="w-3 h-3 flex-shrink-0" />{r.vendor_name || "—"}
                    {r.contract_title ? <span className="truncate"> · {r.contract_title}</span> : null}
                  </div>
                </div>
                <MiniLane stage={r.stage} />
                <span className="text-[11px] font-mono text-right tabular-nums">
                  {r.line_count}
                  {r.open_lines > 0 && <span className="text-sky-700"> / 開{r.open_lines}</span>}
                </span>
                <span className="text-[11px] font-mono text-right tabular-nums">
                  {r.pending ? (
                    <span className="text-amber-700">{r.status_name || "起案済"}</span>
                  ) : Number(r.remaining_amount) > 0 ? (
                    <span className="text-amber-700 font-bold">残{yen(r.remaining_amount)}</span>
                  ) : (
                    <span className="text-muted-foreground">{r.event_count}実績</span>
                  )}
                </span>
                <span className="text-[11px] font-mono text-right tabular-nums">
                  {r.issue_count}
                  {r.next_action_lines > 0 && <span className="text-amber-700"> ▲{r.next_action_lines}</span>}
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      )}

      <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
        段階レーン: 締=締結文書 / 検=検収書 / 計=計算書。残=固定費の未消化額、実績=支払イベント数。
        課題列の ▲ は「次に出すべき文書がある明細数」。行クリックで新課題詳細へ。
        「未着手」= 起案済だが締結文書が未作成の課題(クリックで課題詳細→文書作成へ)。文書作成で通常の契約に昇格。
      </p>
    </div>
  )
}
