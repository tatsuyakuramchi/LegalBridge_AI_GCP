import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Plus,
  FileText,
  Building2,
  Inbox,
  Package,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

// データ構造刷新 Phase F: 条件明細詳細(明細番号単位)。
//   取引先マスター詳細のセクション分割パターンを踏襲。

type Line = Record<string, any>
type Event = {
  id: number
  event_no: number
  event_type: string
  occurred_at: string | null
  period: string | null
  amount_ex_tax: number | null
  voided_at: string | null
  void_reason: string | null
  backlog_issue_key: string | null
  document_number: string | null
  lifecycle_status: string | null
  drive_link: string | null
  issue_key: string | null
}

const yen = (v: any) => (v == null ? "—" : `¥${Number(v).toLocaleString("ja-JP")}`)

function SectionHead({ label }: { label: string }) {
  return (
    <div className="mt-2 pt-2 border-t border-border">
      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-foreground/70">
        {label}
      </span>
    </div>
  )
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-border rounded-md px-3 py-2">
      <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-mono font-bold">{value}</div>
      {sub && <div className="text-[10px] font-mono text-muted-foreground">{sub}</div>}
    </div>
  )
}

export function ConditionLineDetailPage() {
  const { lineCode = "" } = useParams()
  const navigate = useNavigate()
  const [line, setLine] = React.useState<Line | null>(null)
  const [events, setEvents] = React.useState<Event[]>([])
  const [schedule, setSchedule] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/condition-lines/${encodeURIComponent(lineCode)}`)
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok || d?.ok === false) throw new Error(d?.error || `HTTP ${r.status}`)
        return d
      })
      .then((d) => {
        if (cancelled) return
        setLine(d.line)
        setEvents(d.events || [])
        setSchedule(d.schedule || [])
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [lineCode])

  if (loading) {
    return (
      <div className="p-16 text-center">
        <Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (error || !line) {
    return (
      <div className="px-6 py-10 max-w-[900px] mx-auto">
        <button onClick={() => navigate("/condition-lines")} className="text-xs font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> 一覧へ
        </button>
        <p className="mt-6 text-xs font-mono text-destructive">読み込み失敗: {error}</p>
      </div>
    )
  }

  const depletable = ["lump_sum", "per_unit", "installment"].includes(line.payment_scheme)
  const target = Number(line.amount_ex_tax || 0)
  const consumed = Number(line.consumed_amount || 0)
  const pct = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0
  // 実績元の課題(重複排除)
  const issues = [...new Set(events.map((e) => e.issue_key || e.backlog_issue_key).filter(Boolean))]
  const currentUnissued = schedule.filter((s) => s.overdue && !s.issued)

  return (
    <div className="px-6 py-6 max-w-[1100px] mx-auto space-y-5">
      <button
        onClick={() => navigate("/condition-lines")}
        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> 条件明細一覧へ
      </button>

      {/* ヘッダ */}
      <header className="border-b border-border pb-4 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="outline" className="font-mono text-sm">{line.line_code}</Badge>
          <Badge variant="default">{line.status || "—"}</Badge>
          <span className="text-xs font-mono text-muted-foreground">
            {line.payment_scheme} · {line.direction === "receivable" ? "受取" : "支払"}
            {line.rights_attribution ? ` · ${line.rights_attribution}` : ""}
          </span>
        </div>
        <h2 className="text-xl font-mono font-bold">{line.subject || "(件名なし)"}</h2>
        <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
          {line.vendor_name && <span>{line.vendor_name}</span>}
          {line.delivery_date && <span>納期 {String(line.delivery_date).slice(0, 10)}</span>}
          {(line.term_start || line.term_end) && (
            <span>
              期間 {String(line.term_start || "").slice(0, 10)}〜{String(line.term_end || "").slice(0, 10)}
            </span>
          )}
        </div>
      </header>

      {/* メトリクス */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {depletable ? (
          <>
            <Metric label="目標額" value={yen(target)} />
            <Metric label="消化済" value={yen(consumed)} sub={`${pct}%`} />
            <Metric label="残" value={yen(line.remaining_amount)} />
          </>
        ) : (
          <>
            <Metric label="MG 残" value={yen(line.mg_remaining)} sub={`MG ${yen(line.mg_amount)}`} />
            <Metric label="AG 残" value={yen(line.ag_remaining)} />
            <Metric
              label="当期発行"
              value={currentUnissued.length > 0 ? "未発行あり" : "OK"}
              sub={currentUnissued.length > 0 ? currentUnissued.map((s) => s.expected_period).join(", ") : undefined}
            />
          </>
        )}
      </div>
      {depletable && target > 0 && (
        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* SEC 01: 実績と対になる文書 */}
      <section className="space-y-2">
        <SectionHead label="SEC · 01 / 実績と対になる文書" />
        <div className="space-y-1.5">
          {events.length === 0 && (
            <p className="text-xs font-mono text-muted-foreground py-2">実績はまだありません。</p>
          )}
          {events.map((e) => (
            <div
              key={e.id}
              className={`flex items-center gap-3 border border-border rounded-md px-3 py-2 ${e.voided_at ? "opacity-50 line-through" : ""}`}
            >
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0 text-xs font-mono">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold">{e.event_type}</span>
                  {e.period && <span className="text-muted-foreground">{e.period}</span>}
                  <span>{yen(e.amount_ex_tax)}</span>
                  {e.document_number && <span className="text-muted-foreground">{e.document_number}</span>}
                  {e.lifecycle_status === "final" && !e.voided_at && (
                    <Badge className="bg-emerald-600 text-white">final</Badge>
                  )}
                  {e.voided_at && <Badge variant="outline" className="text-muted-foreground">取消</Badge>}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {e.occurred_at ? String(e.occurred_at).slice(0, 10) : ""}
                  {e.issue_key ? ` · ${e.issue_key}` : ""}
                  {e.void_reason ? ` · ${e.void_reason}` : ""}
                </div>
              </div>
              {e.drive_link && (
                <a href={e.drive_link} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          ))}
          {/* ghost「未実施」行 */}
          {((depletable && consumed < target) || currentUnissued.length > 0) && (
            <button
              type="button"
              onClick={() =>
                issues[0]
                  ? navigate(`/issues/${encodeURIComponent(String(issues[0]))}`)
                  : navigate("/documents/new")
              }
              className="w-full flex items-center gap-2 border border-dashed border-border rounded-md px-3 py-2 text-xs font-mono text-muted-foreground hover:border-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> 未実施 — 文書を作成
            </button>
          )}
        </div>
      </section>

      {/* SEC 02: 関連 */}
      <section className="space-y-2">
        <SectionHead label="SEC · 02 / 関連" />
        <div className="flex items-center gap-2 flex-wrap text-xs font-mono">
          {line.contract_number && (
            <span className="inline-flex items-center gap-1 border border-border rounded-sm px-2 py-1">
              <Building2 className="h-3 w-3" /> {line.contract_title || line.contract_number}
            </span>
          )}
          {issues.map((k) => (
            <button
              key={String(k)}
              onClick={() => navigate(`/issues/${encodeURIComponent(String(k))}`)}
              className="inline-flex items-center gap-1 border border-border rounded-sm px-2 py-1 hover:border-foreground"
            >
              <Inbox className="h-3 w-3" /> {String(k)}
            </button>
          ))}
          {line.work_code && (
            <span className="inline-flex items-center gap-1 border border-border rounded-sm px-2 py-1">
              <Package className="h-3 w-3" /> {line.work_title || line.work_code}
            </span>
          )}
        </div>
      </section>
    </div>
  )
}
