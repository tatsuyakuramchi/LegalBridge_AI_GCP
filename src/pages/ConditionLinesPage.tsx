import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Search, Inbox, Loader2, ArrowRight } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

// データ構造刷新 Phase F: 条件明細管理 UI(一覧)。
//   消化・残高・当期発行状況のコックピット。アラート cron が見ているのと同じ
//   導出ビューを人間も見る。明細番号(line_code)単位で詳細へ遷移。

type ConditionLine = {
  id: number
  line_code: string | null
  subject: string | null
  payment_scheme: string
  direction: string
  status: string | null
  consumed_amount: number | null
  remaining_amount: number | null
  amount_ex_tax: number | null
  mg_remaining: number | null
  ag_remaining: number | null
  contract_title: string | null
  contract_number: string | null
  vendor_name: string | null
  has_overdue: boolean | null
}

const STATUS_LABEL: Record<string, string> = {
  open: "未消化",
  partially_fulfilled: "一部",
  fulfilled: "成就",
  closed_short: "打切",
  cancelled: "取消",
  pending: "開始前",
  active: "進行中",
  expired: "終了",
}

function StatusBadge({ status }: { status: string | null }) {
  const s = status || "—"
  const cls =
    s === "fulfilled"
      ? "bg-emerald-600 text-white"
      : s === "partially_fulfilled" || s === "active"
        ? "bg-amber-500 text-white"
        : s === "cancelled" || s === "closed_short" || s === "expired"
          ? "bg-muted text-muted-foreground line-through"
          : ""
  return (
    <Badge variant={cls ? "default" : "outline"} className={cls}>
      {STATUS_LABEL[s] || s}
    </Badge>
  )
}

const yen = (v: any) =>
  v == null ? "—" : `¥${Number(v).toLocaleString("ja-JP")}`

export function ConditionLinesPage() {
  const navigate = useNavigate()
  const [rows, setRows] = React.useState<ConditionLine[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<string | null>(null)
  const [dirFilter, setDirFilter] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/condition-lines")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setRows(Array.isArray(d) ? d : [])
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const statusBuckets = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const s = r.status || "—"
      m.set(s, (m.get(s) || 0) + 1)
    }
    return Array.from(m.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [rows])

  const filtered = rows.filter((r) => {
    if (statusFilter && (r.status || "—") !== statusFilter) return false
    if (dirFilter && r.direction !== dirFilter) return false
    const q = search.trim().toLowerCase()
    if (q) {
      const hay = `${r.line_code || ""} ${r.subject || ""} ${r.vendor_name || ""} ${r.contract_title || ""}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const open = (lineCode: string | null) => {
    if (lineCode) navigate(`/condition-lines/${encodeURIComponent(lineCode)}`)
  }

  return (
    <div className="px-6 py-6 max-w-[1500px] mx-auto space-y-5">
      <header className="flex items-end justify-between gap-6 border-b border-border pb-5">
        <div>
          <p className="retro-tag mb-1.5">COND · LINES</p>
          <h2 className="text-2xl font-mono font-bold tracking-tight">条件明細</h2>
          <p className="text-xs font-mono text-muted-foreground mt-1.5">
            消化・残高・当期発行状況の運用コックピット（導出ビュー駆動）。
          </p>
        </div>
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="line_code / 件名 / 取引先…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </header>

      {/* フィルタチップ */}
      <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono uppercase tracking-[0.16em]">
        <span className="text-muted-foreground">Status:</span>
        <button
          type="button"
          onClick={() => setStatusFilter(null)}
          className={`px-2 py-1 rounded-sm border ${statusFilter === null ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground"}`}
        >
          ALL ({rows.length})
        </button>
        {statusBuckets.map((b) => (
          <button
            key={b.name}
            type="button"
            onClick={() => setStatusFilter(statusFilter === b.name ? null : b.name)}
            className={`px-2 py-1 rounded-sm border ${statusFilter === b.name ? "bg-emerald-600 text-white border-emerald-700" : "border-border text-muted-foreground hover:border-foreground"}`}
          >
            {STATUS_LABEL[b.name] || b.name} ({b.count})
          </button>
        ))}
        <span className="text-muted-foreground ml-3">Dir:</span>
        {["payable", "receivable"].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirFilter(dirFilter === d ? null : d)}
            className={`px-2 py-1 rounded-sm border ${dirFilter === d ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground"}`}
          >
            {d === "payable" ? "支払" : "受取"}
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
            条件明細がありません（新スキーマ未適用の可能性）。
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">line_code</th>
                <th className="text-left px-3 py-2">件名</th>
                <th className="text-left px-3 py-2">契約 / 取引先</th>
                <th className="text-left px-3 py-2">方式</th>
                <th className="text-left px-3 py-2">向き</th>
                <th className="text-left px-3 py-2">状態</th>
                <th className="text-right px-3 py-2">残額 / MG残</th>
                <th className="text-center px-3 py-2">当期</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => open(r.line_code)}
                  className="border-t border-border hover:bg-muted/40 cursor-pointer"
                >
                  <td className="px-3 py-2 font-bold">{r.line_code || "—"}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate">{r.subject || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[220px] truncate">
                    {r.contract_title || r.contract_number || "—"}
                    {r.vendor_name ? ` / ${r.vendor_name}` : ""}
                  </td>
                  <td className="px-3 py-2">{r.payment_scheme}</td>
                  <td className="px-3 py-2">{r.direction === "receivable" ? "受取" : "支払"}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-right">
                    {r.payment_scheme === "royalty"
                      ? `MG ${yen(r.mg_remaining)}`
                      : yen(r.remaining_amount)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.has_overdue ? (
                      <Badge variant="default" className="bg-red-600 text-white">未発行</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground inline" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
