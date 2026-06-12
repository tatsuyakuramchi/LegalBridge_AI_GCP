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
  ChevronRight,
  ClipboardCheck,
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

const RECORD_LABEL: Record<string, string> = {
  purchase_order: "発注書",
  inspection_certificate: "検収書",
  contract: "契約",
}
const recordLabel = (t: any) => RECORD_LABEL[String(t || "")] || "契約"

// トレースの一構成要素(契約 / 発注書)。drive_link があれば PDF を新規タブで開く。
function TraceChip({
  icon: Icon,
  label,
  title,
  sub,
  href,
}: {
  icon: any
  label: string
  title: string
  sub?: string
  href?: string | null
}) {
  const inner = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="flex flex-col items-start leading-tight min-w-0">
        <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
        <span className="font-bold truncate max-w-[220px]">{title}</span>
        {sub && sub !== title && <span className="text-[9px] text-muted-foreground">{sub}</span>}
      </span>
      {href && <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />}
    </>
  )
  const cls = "inline-flex items-center gap-2 border border-border rounded-md px-2.5 py-1.5"
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`${cls} hover:border-foreground`}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  )
}

// 明細の性質から、対になる文書の既定種別を決める。
//   発注書系(消化型/record_type=purchase_order) → 検収書
//   それ以外(利用許諾/MG・AG 等)               → 利用許諾料計算書
type DocType = "inspection_certificate" | "royalty_statement"
const DOC_TYPE_LABEL: Record<DocType, string> = {
  inspection_certificate: "検収書",
  royalty_statement: "利用許諾料計算書",
}
function defaultDocType(line: Line): DocType {
  const depletable = ["lump_sum", "per_unit", "installment"].includes(line.payment_scheme)
  if (line.contract_record_type === "purchase_order" || depletable) return "inspection_certificate"
  if (line.contract_category && String(line.contract_category).includes("license")) return "royalty_statement"
  if (Number(line.mg_amount || 0) > 0 || Number(line.ag_remaining || 0) > 0) return "royalty_statement"
  return "inspection_certificate"
}

// 調整: 既存文書(検収書 / 利用許諾料計算書)を検索して明細にリンクするパネル。
function LinkDocumentPanel({
  lineId,
  defaultType,
  remaining,
  onDone,
}: {
  lineId: number
  defaultType: DocType
  remaining: number
  onDone: () => void
}) {
  const [docType, setDocType] = React.useState<DocType>(defaultType)
  const [q, setQ] = React.useState("")
  const [results, setResults] = React.useState<any[]>([])
  const [searching, setSearching] = React.useState(false)
  const [sel, setSel] = React.useState<any>(null)
  const [amount, setAmount] = React.useState<string>(remaining > 0.5 ? String(Math.round(remaining)) : "")
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)

  const search = React.useCallback(async () => {
    setSearching(true)
    setMsg(null)
    try {
      const u = `/api/documents/search?template_types=${encodeURIComponent(docType)}&q=${encodeURIComponent(q)}&limit=20`
      const r = await fetch(u)
      const d = await r.json()
      const list = Array.isArray(d?.results) ? d.results : Array.isArray(d) ? d : []
      setResults(list)
      if (list.length === 0) setMsg("該当する文書がありません。")
    } catch (e: any) {
      setMsg("検索に失敗しました: " + (e?.message || e))
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [docType, q])

  // 種別を変えたら選択と結果をリセット。
  React.useEffect(() => {
    setSel(null)
    setResults([])
  }, [docType])

  const link = async () => {
    if (!sel || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch(`/api/condition-lines/${lineId}/link-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: sel.id,
          amount_ex_tax: amount === "" ? undefined : Number(amount),
        }),
      })
      const d = await r.json()
      if (!r.ok || d?.ok === false) throw new Error(d?.error || `HTTP ${r.status}`)
      onDone()
    } catch (e: any) {
      setMsg("リンクに失敗しました: " + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-dashed border-border rounded-md p-3 space-y-2 bg-muted/20">
      <div className="flex items-center gap-2 flex-wrap text-xs font-mono">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">対になる文書の種別</span>
        {(["inspection_certificate", "royalty_statement"] as DocType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setDocType(t)}
            className={`px-2 py-0.5 rounded-full border ${
              docType === t ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {DOC_TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder={`${DOC_TYPE_LABEL[docType]}を文書番号・課題で検索…`}
          className="flex-1 h-8 px-2 text-xs font-mono border border-border rounded-md bg-background"
        />
        <Button size="sm" variant="outline" onClick={search} disabled={searching}>
          {searching ? "検索中…" : "検索"}
        </Button>
      </div>
      {results.length > 0 && (
        <div className="max-h-48 overflow-y-auto border border-border rounded-md divide-y divide-border">
          {results.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => setSel(doc)}
              className={`w-full text-left px-2.5 py-1.5 text-xs font-mono flex items-center gap-2 hover:bg-muted/40 ${
                sel?.id === doc.id ? "bg-muted/60" : ""
              }`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 min-w-0">
                <span className="font-bold">{doc.document_number || "(採番なし)"}</span>
                <span className="text-muted-foreground">
                  {doc.issue_key ? ` · ${doc.issue_key}` : ""}
                  {doc.created_at ? ` · ${String(doc.created_at).slice(0, 10)}` : ""}
                </span>
              </span>
              {sel?.id === doc.id && <Badge className="bg-foreground text-background">選択</Badge>}
            </button>
          ))}
        </div>
      )}
      {sel && (
        <div className="flex items-center gap-2 flex-wrap text-xs font-mono pt-1">
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">計上額(税抜)</span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="未指定=残額全額"
            className="w-36 h-8 px-2 text-xs font-mono border border-border rounded-md bg-background text-right"
          />
          <Button size="sm" onClick={link} disabled={busy}>
            {busy ? "リンク中…" : `${sel.document_number || "文書"} をリンク`}
          </Button>
        </div>
      )}
      {msg && <p className="text-[11px] font-mono text-muted-foreground">{msg}</p>}
    </div>
  )
}

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
  // 調整(手動リンク)モード
  const [adjust, setAdjust] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/condition-lines/${encodeURIComponent(lineCode)}`)
      const d = await r.json()
      if (!r.ok || d?.ok === false) throw new Error(d?.error || `HTTP ${r.status}`)
      setLine(d.line)
      setEvents(d.events || [])
      setSchedule(d.schedule || [])
      setError(null)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [lineCode])

  React.useEffect(() => {
    load()
  }, [load])

  // 文書リンクを 1 件だけ解除(イベント void)。文書自体は残る。
  const unlink = async (eventId: number) => {
    if (busy) return
    if (!window.confirm("この文書リンクを解除します（文書は残ります）。よろしいですか？")) return
    setBusy(true)
    try {
      const r = await fetch(`/api/condition-events/${eventId}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "manual unlink" }),
      })
      const d = await r.json()
      if (!r.ok || d?.ok === false) throw new Error(d?.error || `HTTP ${r.status}`)
      await load()
    } catch (e: any) {
      alert("解除に失敗しました: " + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }

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
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono text-muted-foreground">
            検収書 / 利用許諾料計算書を明細に手作業でリンクし、ステータスを調整できます。
          </span>
          <button
            type="button"
            onClick={() => setAdjust((v) => !v)}
            className={`text-[10px] font-mono uppercase tracking-[0.16em] px-2 py-1 rounded-md border shrink-0 ${
              adjust
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {adjust ? "調整モード ON" : "調整(手動リンク)"}
          </button>
        </div>
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
              {adjust && !e.voided_at && (
                <button
                  type="button"
                  onClick={() => unlink(e.id)}
                  disabled={busy}
                  className="text-[10px] font-mono px-2 py-1 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 shrink-0"
                >
                  リンク解除
                </button>
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
          {adjust && (
            <LinkDocumentPanel
              lineId={Number(line.id)}
              defaultType={defaultDocType(line)}
              remaining={Number(line.remaining_amount || 0)}
              onDone={load}
            />
          )}
        </div>
      </section>

      {/* SEC 02: トレース(契約 → 発注書 → 検収) */}
      <section className="space-y-2">
        <SectionHead label="SEC · 02 / トレース 契約 → 発注書 → 検収" />
        <div className="flex items-center gap-2 flex-wrap text-xs font-mono">
          {/* 上位(マスター)契約 — 親 capability がある場合 */}
          {line.parent_contract_number && (
            <>
              <TraceChip
                icon={Building2}
                label={recordLabel(line.parent_record_type)}
                title={line.parent_contract_title || line.parent_contract_number}
                sub={line.parent_contract_number}
                href={line.parent_drive_link}
              />
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </>
          )}
          {/* この明細が属する 発注書 / 契約 */}
          {line.contract_number ? (
            <TraceChip
              icon={line.contract_record_type === "purchase_order" ? FileText : Building2}
              label={recordLabel(line.contract_record_type)}
              title={line.contract_title || line.contract_number}
              sub={line.contract_number}
              href={line.contract_drive_link}
            />
          ) : (
            <span className="text-muted-foreground">契約未紐付け</span>
          )}
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          {/* 検収・実績(下の SEC·01 に対応) */}
          <div className="inline-flex items-center gap-2 border border-border rounded-md px-2.5 py-1.5">
            <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="flex flex-col items-start leading-tight">
              <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">検収・実績</span>
              <span className="font-bold">
                {events.filter((e) => !e.voided_at).length} 件
                {depletable && target > 0 ? ` · ${pct}%` : ""}
              </span>
            </span>
          </div>
        </div>

        {/* 課題 / 作品 */}
        {(issues.length > 0 || line.work_code) && (
          <div className="flex items-center gap-2 flex-wrap text-xs font-mono pt-1">
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
        )}
      </section>
    </div>
  )
}
