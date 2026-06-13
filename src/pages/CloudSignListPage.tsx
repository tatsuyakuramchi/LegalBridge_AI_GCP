import * as React from "react"
import { RefreshCw, Loader2, Inbox, ExternalLink, FlaskConical } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

// クラウドサイン送信一覧。worker の /api/cloudsign/requests(全件)を表示する。
type CsRequest = {
  id: number
  document_number: string | null
  capability_id: number | null
  template_type: string | null
  cloudsign_document_id: string | null
  status: string
  title: string | null
  participants: any
  is_test: boolean
  signed_drive_link: string | null
  error: string | null
  created_by: string | null
  sent_at: string | null
  completed_at: string | null
  created_at: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "下書き", cls: "bg-muted text-muted-foreground" },
  sending: { label: "送信中", cls: "bg-amber-500/15 text-amber-600" },
  sent: { label: "締結待ち", cls: "bg-indigo-500/15 text-indigo-600" },
  completed: { label: "締結済み", cls: "bg-emerald-600 text-white" },
  declined: { label: "却下", cls: "bg-red-500/15 text-red-600" },
  canceled: { label: "取消", cls: "bg-muted text-muted-foreground line-through" },
  error: { label: "エラー", cls: "bg-red-600 text-white" },
}

const fmt = (v: string | null) =>
  v ? new Date(v).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "—"

function emails(participants: any): string {
  try {
    const arr = typeof participants === "string" ? JSON.parse(participants) : participants
    if (!Array.isArray(arr)) return "—"
    return arr.map((p: any) => p?.email).filter(Boolean).join(", ") || "—"
  } catch {
    return "—"
  }
}

export function CloudSignListPage() {
  const [rows, setRows] = React.useState<CsRequest[]>([])
  const [loading, setLoading] = React.useState(true)
  const [q, setQ] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<string | null>(null)

  const load = React.useCallback(() => {
    setLoading(true)
    fetch("/api/cloudsign/requests", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])
  React.useEffect(() => {
    load()
  }, [load])

  const buckets = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.status, (m.get(r.status) || 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [rows])

  const filtered = rows.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false
    const s = q.trim().toLowerCase()
    if (s) {
      const hay = `${r.title || ""} ${r.document_number || ""} ${emails(r.participants)}`.toLowerCase()
      if (!hay.includes(s)) return false
    }
    return true
  })

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto space-y-5">
      <header className="flex items-end justify-between gap-6 border-b border-border pb-5">
        <div>
          <p className="retro-tag mb-1.5">CLOUDSIGN · SEND</p>
          <h2 className="text-2xl font-mono font-bold tracking-tight">クラウドサイン送信一覧</h2>
          <p className="text-xs font-mono text-muted-foreground mt-1.5">
            電子契約の送信・締結状況。Webhook で締結が反映されます。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-60">
            <Input
              type="search"
              placeholder="件名 / 文書番号 / 宛先…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9"
            />
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-[11px] font-mono font-bold uppercase tracking-[0.14em] hover:bg-muted"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 更新
          </button>
        </div>
      </header>

      {/* ステータスフィルタ */}
      <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono uppercase tracking-[0.14em]">
        <button
          type="button"
          onClick={() => setStatusFilter(null)}
          className={`px-2 py-1 rounded-sm border ${statusFilter === null ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground"}`}
        >
          ALL ({rows.length})
        </button>
        {buckets.map(([name, n]) => (
          <button
            key={name}
            type="button"
            onClick={() => setStatusFilter(statusFilter === name ? null : name)}
            className={`px-2 py-1 rounded-sm border ${statusFilter === name ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground"}`}
          >
            {STATUS[name]?.label || name} ({n})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-16 text-center">
          <Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-16 text-center border border-dashed border-border rounded-md">
          <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
            送信履歴がありません
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">件名 / 文書番号</th>
                <th className="text-left px-3 py-2">宛先</th>
                <th className="text-left px-3 py-2">状態</th>
                <th className="text-left px-3 py-2">送信</th>
                <th className="text-left px-3 py-2">締結</th>
                <th className="text-left px-3 py-2">担当</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const st = STATUS[r.status] || { label: r.status, cls: "bg-muted text-muted-foreground" }
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/40">
                    <td className="px-3 py-2 max-w-[280px]">
                      <div className="font-bold truncate">{r.title || "—"}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {r.document_number || "—"}
                        {r.is_test && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-600">
                            <FlaskConical className="h-2.5 w-2.5" /> TEST
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 max-w-[220px] truncate text-muted-foreground">
                      {emails(r.participants)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="default" className={st.cls}>
                        {st.label}
                      </Badge>
                      {r.status === "error" && r.error && (
                        <div className="text-[10px] text-red-600 truncate max-w-[180px]" title={r.error}>
                          {r.error}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground tab-mono">{fmt(r.sent_at)}</td>
                    <td className="px-3 py-2 text-muted-foreground tab-mono">{fmt(r.completed_at)}</td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px]">{r.created_by || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {r.signed_drive_link && (
                        <a
                          href={r.signed_drive_link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-6 w-6 items-center justify-center border border-border rounded-sm hover:bg-muted text-muted-foreground"
                          title="締結済みPDF"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
