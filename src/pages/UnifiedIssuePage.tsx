import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  FileText,
  ExternalLink,
  Plus,
  Send,
  User,
  Calendar,
  ListChecks,
  GitMerge,
  Loader2,
  ChevronRight,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useDocumentSession } from "@/src/context/AppDataContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

// 新課題(統一課題)詳細ページ。
//   設計: docs/design/unified-issue-ui-plan.md
//   新課題 = 1 契約(capability) を背骨に、締結フェイズ課題 + 支払フェイズ課題(N)・
//   締結文書 + 支払文書・条件明細進捗 を 1 画面に束ねる。
//   API: GET /api/unified-issues/:capabilityId
//   重い送信/署名・終結/統合は構成課題の /issues/:key(全機能あり)へ委譲する。

type UEvent = {
  event_no: number
  event_type: string
  occurred_at: string | null
  period: string | null
  amount_ex_tax: number | null
  backlog_issue_key: string | null
  document_number: string | null
  template_type: string | null
}
type ULine = {
  id: number
  line_code: string | null
  subject: string | null
  payment_scheme: string | null
  amount_ex_tax: number | null
  currency: string | null
  term_start: string | null
  term_end: string | null
  status: string | null
  consumed_amount: number | null
  remaining_amount: number | null
  event_count: number | null
  last_event_at: string | null
  mg_remaining: number | null
  ag_remaining: number | null
  next_template_type: string | null
  recent_events: UEvent[]
}
type UIssue = {
  issue_key: string
  phase: "contracting" | "payment" | "mixed"
  status_name: string | null
  merged: boolean
}
type UDoc = {
  id: number
  document_number: string | null
  template_type: string
  issue_key: string | null
  created_at: string | null
  created_by: string | null
  drive_link: string | null
  lifecycle_status: string
  is_primary: boolean
  phase: "contracting" | "payment"
}
type UnifiedDetail = {
  ok: boolean
  header: {
    id: number
    document_number: string | null
    contract_title: string | null
    record_type: string | null
    contract_category: string | null
    backlog_issue_key: string | null
    effective_date: string | null
    expiration_date: string | null
    vendor_name: string | null
  } | null
  summary: {
    line_count?: number
    open?: number
    completed?: number
    next_actions?: number
    issue_count?: number
  }
  issues: UIssue[]
  documents: UDoc[]
  lines: ULine[]
  matters?: { id: number; matter_code: string | null; title: string; status: string }[]
}

const CONTRACTING_TEMPLATES = new Set([
  "purchase_order",
  "intl_purchase_order",
  "individual_license_terms",
  "pub_license_terms",
  "license_master",
  "service_master",
  "pub_master_individual",
  "pub_master_corporate",
])
const INSPECTION_TEMPLATES = new Set(["inspection_certificate"])
const ROYALTY_TEMPLATES = new Set(["royalty_statement", "license_calculation_sheet"])

const yen = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(Number(n))

function SectionHead({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <div className="mt-1 pt-2 border-t border-border flex items-center gap-1.5">
      {icon}
      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-foreground/70">
        {label}
      </span>
    </div>
  )
}

function LifecycleBadge({ status }: { status?: string }) {
  const s = status || "final"
  if (s === "final")
    return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">final</Badge>
  if (s === "archived_draft" || s === "voided" || s === "superseded")
    return <Badge variant="outline" className="text-muted-foreground line-through">{s}</Badge>
  return <Badge variant="outline" className="text-muted-foreground">{s}</Badge>
}

function PhaseBadge({ phase }: { phase: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    contracting: { label: "締結", cls: "bg-indigo-100 text-indigo-900" },
    payment: { label: "支払", cls: "bg-amber-100 text-amber-900" },
    mixed: { label: "締結+支払", cls: "bg-violet-100 text-violet-900" },
  }
  const m = map[phase] || { label: phase, cls: "bg-muted text-foreground" }
  return <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded-sm", m.cls)}>{m.label}</span>
}

function LineStatusBadge({ status }: { status: string | null }) {
  const s = status || ""
  if (s === "fulfilled" || s === "expired")
    return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">{s === "expired" ? "期間満了" : "完済"}</Badge>
  if (s === "cancelled" || s === "closed_short")
    return <Badge variant="outline" className="text-muted-foreground line-through">{s}</Badge>
  if (s === "pending")
    return <Badge variant="outline" className="text-muted-foreground">開始前</Badge>
  // open / partially_fulfilled / active
  return <Badge className="bg-sky-600 text-white hover:bg-sky-600">{s === "active" ? "継続中" : s === "partially_fulfilled" ? "一部消化" : "未消化"}</Badge>
}

// 段階レーン(締結 → 検収 → 計算)。書類が出ている段階を点灯。
function StageLane({ documents }: { documents: UDoc[] }) {
  const reached = {
    contracting: documents.some((d) => CONTRACTING_TEMPLATES.has(d.template_type)),
    inspection: documents.some((d) => INSPECTION_TEMPLATES.has(d.template_type)),
    royalty: documents.some((d) => ROYALTY_TEMPLATES.has(d.template_type)),
  }
  const stages = [
    { key: "contracting", label: "締結", on: reached.contracting },
    { key: "delivery", label: "納品/利用", on: reached.inspection || reached.royalty },
    { key: "inspection", label: "検収", on: reached.inspection },
    { key: "royalty", label: "計算", on: reached.royalty },
  ]
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {stages.map((s, i) => (
        <React.Fragment key={s.key}>
          {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground/50" />}
          <span
            className={cn(
              "text-[10px] font-mono px-2 py-0.5 rounded-sm border",
              s.on
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-muted text-muted-foreground border-border"
            )}
          >
            {s.label}
          </span>
        </React.Fragment>
      ))}
    </div>
  )
}

export function UnifiedIssuePage() {
  const { capabilityId = "" } = useParams()
  const navigate = useNavigate()
  const { setSelectedIssue, setFormData } = useDocumentSession()

  const [data, setData] = React.useState<UnifiedDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  // U3-2: 支払フェイズの起票→作成。処理中の condition_line.id とエラー。
  const [creatingLine, setCreatingLine] = React.useState<number | null>(null)
  const [createError, setCreateError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!capabilityId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await fetch(`/api/unified-issues/${encodeURIComponent(capabilityId)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json: UnifiedDetail = await res.json()
        if (!cancelled) setData(json)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [capabilityId])

  // 締結課題をヒントに直接エディタへ(支払以外/フォールバック用)。
  const createDocument = (template: string) => {
    const hintIssue = data?.header?.backlog_issue_key || ""
    if (hintIssue) setSelectedIssue(hintIssue)
    setFormData({ サブライセンシー一覧: [] })
    navigate(`/documents/new?template=${encodeURIComponent(template)}&prefill=1`)
  }

  // U3-2: 支払フェイズを「起票してから作成」。
  //   ① quick-create で支払 Backlog 課題を作成(締結課題の子課題に。無ければ独立)。
  //   ② 新課題キーを選択状態にしてエディタへ。文書保存で condition_events に
  //      その課題キーが入り、統一課題の構成課題(支払フェイズ)に出る。
  //   これによりバラバラ起案を抑制し、締結↔支払が Backlog 上でも親子で繋がる。
  const PAYMENT_TYPE_MAP: Record<string, { label: string; req: string }> = {
    inspection_certificate: { label: "納品・検収", req: "delivery_inspec" },
    royalty_statement: { label: "利用許諾計算", req: "license_calc" },
  }
  const startPaymentDoc = async (line: ULine) => {
    const tmpl = line.next_template_type
    if (!tmpl) return
    const m = PAYMENT_TYPE_MAP[tmpl]
    if (!m) {
      // 支払系以外は従来どおり直接作成。
      createDocument(tmpl)
      return
    }
    const hdr = data?.header
    setCreatingLine(line.id)
    setCreateError(null)
    try {
      const res = await fetch("/api/backlog/issues/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueTypeLabel: m.label,
          requestType: m.req,
          counterpartyName: hdr?.vendor_name || "",
          subTopic: `${hdr?.document_number || ""} ${line.line_code || ""}`.trim() || hdr?.contract_title || "",
          parentIssueKey: hdr?.backlog_issue_key || "", // 締結課題の子課題に(無ければ top-level)
          details: `統一課題(${hdr?.document_number || `cap${hdr?.id}`})の支払フェイズ起票。条件明細 ${line.line_code || ""}。`,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`)
      const newKey: string | undefined = d.issueKey
      if (newKey) setSelectedIssue(newKey)
      setFormData({ サブライセンシー一覧: [] })
      navigate(`/documents/new?template=${encodeURIComponent(tmpl)}&prefill=1`)
    } catch (e: any) {
      setCreateError(`起票に失敗: ${e?.message || e}`)
    } finally {
      setCreatingLine(null)
    }
  }

  const h = data?.header
  const lines = data?.lines || []
  const issues = data?.issues || []
  const documents = data?.documents || []
  const ghostLines = lines.filter((l) => l.next_template_type)

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate("/unified")} className="gap-1">
          <ArrowLeft className="w-4 h-4" /> 新課題一覧
        </Button>
        <span className="text-[11px] font-mono text-muted-foreground">統一課題(契約単位)</span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
        </div>
      )}
      {error && (
        <div className="border border-red-200 bg-red-50 text-red-900 rounded-sm px-4 py-2 text-[12px] font-mono">
          取得失敗: {error}
        </div>
      )}
      {createError && (
        <div className="border border-red-200 bg-red-50 text-red-900 rounded-sm px-4 py-2 text-[12px] font-mono">
          {createError}
        </div>
      )}

      {!loading && h && (
        <>
          {/* ── ヘッダ ───────────────────────────────── */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-mono font-bold">{h.document_number || `cap${h.id}`}</span>
                {h.record_type && (
                  <Badge variant="outline" className="text-[10px]">{h.record_type}</Badge>
                )}
              </div>
              {h.contract_title && (
                <div className="text-[13px] text-foreground/90">{h.contract_title}</div>
              )}
              <div className="flex items-center gap-4 flex-wrap text-[11px] font-mono text-muted-foreground">
                <span className="flex items-center gap-1"><User className="w-3 h-3" />{h.vendor_name || "—"}</span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {(h.effective_date || "—")}{h.expiration_date ? ` 〜 ${h.expiration_date}` : ""}
                </span>
                {h.backlog_issue_key && (
                  <button
                    className="flex items-center gap-1 hover:text-foreground underline"
                    onClick={() => navigate(`/issues/${encodeURIComponent(h.backlog_issue_key!)}`)}
                  >
                    締結課題 {h.backlog_issue_key}
                  </button>
                )}
              </div>
              {(data?.matters?.length ?? 0) > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-muted-foreground">所属案件:</span>
                  {data!.matters!.map((mt) => (
                    <button
                      key={mt.id}
                      onClick={() => navigate(`/matters/${mt.id}`)}
                      className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[11px] hover:bg-muted/60"
                      title={mt.title}
                    >
                      <span className="font-mono text-sky-700">{mt.matter_code || `#${mt.id}`}</span>
                      <span className="text-muted-foreground truncate max-w-[160px]">{mt.title}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="pt-1"><StageLane documents={documents} /></div>
            </CardContent>
          </Card>

          {/* ── 取引循環進捗(条件明細) ───────────────────── */}
          <div>
            <SectionHead label="SEC · 01 / 取引循環進捗(条件明細)" icon={<ListChecks className="w-3 h-3 text-foreground/60" />} />
            {lines.length === 0 ? (
              <div className="text-[11px] font-mono text-muted-foreground py-3">条件明細はまだありません。</div>
            ) : (
              <div className="mt-2 space-y-2">
                {lines.map((l) => (
                  <div key={l.id} className="border border-border rounded-sm p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        className="text-[11px] font-mono font-bold underline hover:text-foreground"
                        onClick={() => l.line_code && navigate(`/condition-lines/${encodeURIComponent(l.line_code)}`)}
                        title="条件明細詳細"
                      >
                        {l.line_code || `#${l.id}`}
                      </button>
                      <Badge variant="outline" className="text-[10px]">{l.payment_scheme}</Badge>
                      <LineStatusBadge status={l.status} />
                      <span className="text-[11px] text-foreground/80 truncate max-w-[40ch]">{l.subject || ""}</span>
                      <div className="flex-1" />
                      {l.next_template_type && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-[10px]"
                          onClick={() => startPaymentDoc(l)}
                          disabled={creatingLine === l.id}
                          title="支払フェイズ課題を起票してから文書を作成(締結課題の子課題)"
                        >
                          {creatingLine === l.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                          {l.next_template_type === "inspection_certificate" ? "検収書を起票して作成" : l.next_template_type === "royalty_statement" ? "計算書を起票して作成" : "次の文書を起票"}
                        </Button>
                      )}
                    </div>
                    {/* 完了条件: 固定費=残額 / ロイヤリティ=期間+MG/AG */}
                    <div className="mt-1.5 text-[10px] font-mono text-muted-foreground flex items-center gap-4 flex-wrap">
                      {["lump_sum", "per_unit", "installment"].includes(l.payment_scheme || "") ? (
                        <>
                          <span>契約 {yen(l.amount_ex_tax)}</span>
                          <span>消化 {yen(l.consumed_amount)}</span>
                          <span className={cn(Number(l.remaining_amount) > 0 && "text-amber-700 font-bold")}>
                            残 {l.remaining_amount == null ? "—" : yen(l.remaining_amount)}
                          </span>
                        </>
                      ) : (
                        <>
                          <span>期間 {l.term_start || "—"}〜{l.term_end || "—"}</span>
                          {l.mg_remaining != null && <span>MG残 {yen(l.mg_remaining)}</span>}
                          {l.ag_remaining != null && <span>AG残 {yen(l.ag_remaining)}</span>}
                        </>
                      )}
                      <span>実績 {l.event_count ?? 0}件</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {ghostLines.length > 0 && (
              <div className="mt-2 text-[10px] font-mono text-amber-700">
                次に出すべき文書: {ghostLines.length}件(各明細の「作成」から起案)
              </div>
            )}
          </div>

          {/* ── 構成課題(締結 + 支払) ───────────────────── */}
          <div>
            <SectionHead label={`SEC · 02 / 構成課題(${issues.length})`} icon={<GitMerge className="w-3 h-3 text-foreground/60" />} />
            {issues.length === 0 ? (
              <div className="text-[11px] font-mono text-muted-foreground py-3">紐づく Backlog 課題はありません。</div>
            ) : (
              <div className="mt-2 space-y-1.5">
                {issues.map((i) => (
                  <div key={i.issue_key} className="border border-border rounded-sm px-3 py-2 flex items-center gap-2 flex-wrap">
                    <PhaseBadge phase={i.phase} />
                    <button
                      className="text-[12px] font-mono font-bold underline hover:text-foreground"
                      onClick={() => navigate(`/issues/${encodeURIComponent(i.issue_key)}`)}
                    >
                      {i.issue_key}
                    </button>
                    {i.status_name && (
                      <span className="text-[10px] font-mono text-muted-foreground">{i.status_name}</span>
                    )}
                    {i.merged && <Badge variant="outline" className="text-[10px] text-muted-foreground">統合済</Badge>}
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-[10px]"
                      onClick={() => navigate(`/issues/${encodeURIComponent(i.issue_key)}`)}
                      title="課題詳細(終結・統合・送信はこちら)"
                    >
                      開く <ChevronRight className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-1 text-[10px] font-mono text-muted-foreground">
              終結・統合は各課題の詳細画面から実行できます。
            </div>
          </div>

          {/* ── 文書一覧(締結 + 支払) ───────────────────── */}
          <div>
            <SectionHead label={`SEC · 03 / 文書(${documents.length})`} icon={<FileText className="w-3 h-3 text-foreground/60" />} />
            {documents.length === 0 ? (
              <div className="text-[11px] font-mono text-muted-foreground py-3">文書はまだありません。</div>
            ) : (
              <div className="mt-2 space-y-1.5">
                {documents.map((d) => (
                  <div key={d.id} className="border border-border rounded-sm px-3 py-2 flex items-center gap-2 flex-wrap">
                    <PhaseBadge phase={d.phase} />
                    <span className="text-[12px] font-mono font-bold">{d.document_number || `#${d.id}`}</span>
                    <Badge variant="outline" className="text-[10px]">{d.template_type}</Badge>
                    <LifecycleBadge status={d.lifecycle_status} />
                    {!d.is_primary && <Badge variant="outline" className="text-[10px] text-muted-foreground">旧版</Badge>}
                    <div className="flex-1" />
                    {d.drive_link && (
                      <a
                        href={d.drive_link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-mono underline text-muted-foreground hover:text-foreground flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" /> Drive
                      </a>
                    )}
                    {d.issue_key && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-[10px]"
                        onClick={() => navigate(`/issues/${encodeURIComponent(d.issue_key!)}`)}
                        title="送信・署名・再編集は課題詳細から"
                      >
                        <Send className="w-3 h-3" /> 送信/編集
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {!loading && !h && !error && (
        <div className="text-center py-12 text-[12px] font-mono text-muted-foreground">
          新課題が見つかりません。
        </div>
      )}
    </div>
  )
}
