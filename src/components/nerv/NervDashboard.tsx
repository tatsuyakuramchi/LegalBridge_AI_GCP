import * as React from "react"
import { useNavigate } from "react-router-dom"
import { RefreshCw, ArrowRight, AlertTriangle, Loader2, ShieldAlert } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { NervPanel } from "@/src/components/nerv/NervPanel"
import { RingGauge } from "@/src/components/nerv/RingGauge"
import { MagiTriangle } from "@/src/components/nerv/MagiTriangle"

// 「完了」とみなすステータス名(Backlog 日本語 + 英語の保険)。
const DONE = ["完了", "処理済み", "クローズ", "closed", "done", "resolved"]
const isDone = (name?: string) =>
  !!name && DONE.some((d) => name.toLowerCase().includes(d.toLowerCase()))

const pctOf = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)

function Bar({
  label,
  value,
  max,
  tone,
}: {
  key?: React.Key
  label: string
  value: number
  max: number
  tone: string
}) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.12em]">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="font-bold tab-mono" style={{ color: tone }}>{value}</span>
      </div>
      <div className="h-1.5 w-full bg-border/60">
        <div className="h-full" style={{ width: `${w}%`, background: tone, boxShadow: `0 0 6px ${tone}` }} />
      </div>
    </div>
  )
}

function Chip({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex flex-col border-l border-border pl-3 first:border-l-0 first:pl-0">
      <span className="text-2xl font-mono font-bold tab-mono leading-none" style={{ color: tone }}>
        {value}
      </span>
      <span className="mt-1 text-[9px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

const ORANGE = "hsl(var(--primary))"
const GREEN = "hsl(145 60% 45%)"
const RED = "hsl(4 85% 56%)"
const AMBER = "hsl(35 95% 55%)"

export function NervDashboard() {
  const navigate = useNavigate()
  const { dashboardStats, refreshDashboardStats, isRefreshingStats, contracts, vendors, templateList } =
    useAppData()

  const [alerts, setAlerts] = React.useState<{ overdue: any[]; totalAlerts: number } | null>(null)
  React.useEffect(() => {
    let cancelled = false
    fetch("/api/management/alerts")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancelled && j && setAlerts(j))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const s = dashboardStats
  const byStatus: Record<string, number> = s?.byStatus || {}
  const details: any[] = s?.issueDetails || []
  const total = s?.totalIssues || 0

  const doneCount = details.filter((i) => isDone(i?.status?.name)).length
  const withDocs = details.filter((i) => (i?.documentCount ?? 0) > 0).length
  const pending = details.filter((i) => !isDone(i?.status?.name))
  const inReview = pending.filter((i) => (i?.documentCount ?? 0) > 0).length

  const completion = pctOf(doneCount, total)
  const docCoverage = pctOf(withDocs, total)
  const reviewRate = pctOf(inReview, total)

  // 契約ステータス分布(CONTRACTS パネル)
  const contractsByStatus = React.useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of contracts || []) {
      const k = String((c as any)?.contract_status || (c as any)?.record_type || "未分類")
      m[k] = (m[k] || 0) + 1
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [contracts])

  const statusEntries = Object.entries(byStatus).sort((a, b) => b[1] - a[1])
  const statusMax = statusEntries.reduce((mx, [, v]) => Math.max(mx, v), 0)
  const now = new Date()

  const statusTone = (name: string) =>
    isDone(name) ? GREEN : name.includes("未") ? RED : ORANGE

  return (
    <div className="min-h-screen bg-background px-4 py-4 lg:px-6">
      {/* ── Title bar ───────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-primary/70 pb-3">
        <div>
          <h1 className="font-heading text-3xl lg:text-4xl font-extrabold tracking-[0.04em] leading-none glow-soft">
            LEGAL BRIDGE
          </h1>
          <p className="mt-1.5 text-[10px] font-mono uppercase tracking-[0.3em] text-primary">
            Contract Operations · Review · Approval System
          </p>
        </div>
        <div className="flex items-end gap-5">
          <Chip label="Issues" value={total} tone={ORANGE} />
          <Chip label="Documents" value={s?.totalDocuments ?? 0} tone={GREEN} />
          <Chip label="Contracts" value={(contracts || []).length} tone={ORANGE} />
          <Chip label="Vendors" value={(vendors || []).length} />
          <Chip label="Blueprints" value={(templateList || []).length} />
          <button
            onClick={refreshDashboardStats}
            disabled={isRefreshingStats}
            className="flex items-center gap-1.5 border border-primary/60 px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshingStats ? "animate-spin" : ""}`} /> Sync
          </button>
        </div>
      </header>

      <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        {now.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" })} · STATUS{" "}
        <span className="text-[hsl(145_60%_45%)] font-bold">NOMINAL</span>
      </p>

      {/* ── Grid ────────────────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-12 gap-4">
        {/* PENDING REVIEWS */}
        <NervPanel
          title="Pending Reviews"
          tag="OPS"
          className="col-span-12 lg:col-span-4"
          right={
            <span className="text-2xl font-mono font-bold tab-mono text-primary leading-none">
              {pending.length}
            </span>
          }
          bodyClassName="p-0"
        >
          <div className="max-h-[300px] overflow-y-auto custom-scrollbar divide-y divide-border/60">
            {isRefreshingStats && !s ? (
              <div className="flex flex-col items-center gap-2 p-10">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                  Synchronizing
                </span>
              </div>
            ) : pending.length === 0 ? (
              <p className="p-8 text-center text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                No pending reviews
              </p>
            ) : (
              pending.slice(0, 14).map((i, idx) => (
                <button
                  key={`${i.issueKey}-${idx}`}
                  onClick={() => navigate(`/issues/${encodeURIComponent(i.issueKey)}`)}
                  className="group flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-primary/10 transition-colors"
                >
                  <span className="h-7 w-0.5 shrink-0" style={{ background: statusTone(i?.status?.name) }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-mono font-bold">{i.summary || i.issueKey}</p>
                    <p className="text-[9px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                      {i.issueKey} · {i?.status?.name || "—"} · {i?.assignee?.name || "Unassigned"}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono font-bold tab-mono text-primary">
                    {i.documentCount ?? 0}d
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                </button>
              ))
            )}
          </div>
        </NervPanel>

        {/* REVIEW DECISION MATRIX (MAGI) */}
        <NervPanel title="Review Decision Matrix" tag="MAGI" className="col-span-12 lg:col-span-5">
          <MagiTriangle
            center={completion}
            centerLabel="APPROVED"
            nodes={[
              { key: "biz", label: "BUSINESS", pct: docCoverage },
              { key: "legal", label: "LEGAL", pct: reviewRate },
              { key: "appr", label: "APPROVAL", pct: completion },
            ]}
          />
          <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border/60 pt-2 text-center">
            <div>
              <p className="text-[8px] font-mono uppercase tracking-[0.14em] text-muted-foreground">起案率</p>
              <p className="text-[11px] font-mono">Doc coverage</p>
            </div>
            <div>
              <p className="text-[8px] font-mono uppercase tracking-[0.14em] text-muted-foreground">審査着手</p>
              <p className="text-[11px] font-mono">In review</p>
            </div>
            <div>
              <p className="text-[8px] font-mono uppercase tracking-[0.14em] text-muted-foreground">承認/完了</p>
              <p className="text-[11px] font-mono">Approved</p>
            </div>
          </div>
        </NervPanel>

        {/* GAUGES */}
        <NervPanel
          title="Operational Gauges"
          tag="SYS"
          className="col-span-12 lg:col-span-3"
          bodyClassName="grid grid-cols-1 gap-3 place-items-center"
        >
          <RingGauge value={completion} label="Completion" sub={`${doneCount}/${total} issues`} tone={GREEN} size={104} />
          <RingGauge value={docCoverage} label="Doc Coverage" sub={`${withDocs}/${total}`} tone={ORANGE} size={104} />
        </NervPanel>

        {/* RISK ALERTS */}
        <NervPanel
          title="Risk Alerts"
          tag="ALERT"
          className="col-span-12 lg:col-span-4"
          right={
            <span
              className="text-2xl font-mono font-bold tab-mono leading-none"
              style={{ color: (alerts?.totalAlerts ?? 0) > 0 ? RED : GREEN }}
            >
              {alerts?.totalAlerts ?? 0}
            </span>
          }
          bodyClassName="p-0"
        >
          <div className="max-h-[220px] overflow-y-auto custom-scrollbar divide-y divide-border/60">
            {alerts == null ? (
              <p className="p-6 text-center text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                Scanning…
              </p>
            ) : (alerts.overdue || []).length === 0 ? (
              <p className="flex items-center justify-center gap-2 p-6 text-[10px] font-mono uppercase tracking-[0.18em] text-[hsl(145_60%_45%)]">
                <ShieldAlert className="h-3.5 w-3.5" /> No overdue inspections
              </p>
            ) : (
              alerts.overdue.slice(0, 8).map((a: any, idx: number) => (
                <div key={a.id || idx} className="flex items-start gap-2 px-3 py-2">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[hsl(4_85%_56%)]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-mono font-bold">
                      {a.issue_summary || a.counterparty || a.document_number || "Overdue item"}
                    </p>
                    <p className="text-[9px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                      {a.backlog_issue_key || a.document_number || "—"} ·{" "}
                      {a.inspection_deadline
                        ? new Date(a.inspection_deadline).toLocaleDateString("ja-JP")
                        : "期限超過"}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </NervPanel>

        {/* TASK PROGRESS (status distribution) */}
        <NervPanel title="Task Progress" tag="FLOW" className="col-span-12 lg:col-span-4">
          {statusEntries.length === 0 ? (
            <p className="py-4 text-center text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              No data
            </p>
          ) : (
            <div className="space-y-2.5">
              {statusEntries.slice(0, 7).map(([name, v]) => (
                <Bar key={name} label={name} value={v} max={statusMax} tone={statusTone(name)} />
              ))}
            </div>
          )}
        </NervPanel>

        {/* CONTRACTS */}
        <NervPanel
          title="Contracts"
          tag="REG"
          className="col-span-12 lg:col-span-4"
          right={
            <span className="text-2xl font-mono font-bold tab-mono text-primary leading-none">
              {(contracts || []).length}
            </span>
          }
        >
          {contractsByStatus.length === 0 ? (
            <p className="py-4 text-center text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              No contracts
            </p>
          ) : (
            <div className="space-y-2.5">
              {contractsByStatus.slice(0, 7).map(([name, v], idx) => (
                <Bar
                  key={name}
                  label={name}
                  value={v}
                  max={contractsByStatus[0][1]}
                  tone={idx === 0 ? ORANGE : idx === 1 ? GREEN : AMBER}
                />
              ))}
            </div>
          )}
        </NervPanel>
      </div>

      {/* LATEST AGREEMENTS */}
      <div className="mt-4">
        <NervPanel title="Latest Uploaded Agreements" tag="LOG" bodyClassName="p-0">
          {(s?.recentActivity ?? []).length === 0 ? (
            <p className="p-6 text-center text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              No documents generated yet
            </p>
          ) : (
            <div className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
              {(s?.recentActivity ?? []).slice(0, 6).map((d: any, idx: number) => (
                <div key={d.id || idx} className="flex items-center gap-2 border-border/60 px-3 py-2 sm:border-l">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary blink shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-mono font-bold">{d.template_type || "Document"}</p>
                    <p className="text-[9px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                      {d.issue_key || "—"} ·{" "}
                      {d.created_at ? new Date(d.created_at).toLocaleDateString("ja-JP") : "—"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </NervPanel>
      </div>
    </div>
  )
}
