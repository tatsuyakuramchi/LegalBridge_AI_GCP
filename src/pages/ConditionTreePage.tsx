import * as React from "react"
import { ChevronRight, Loader2, Inbox, ArrowDownLeft, ArrowUpRight, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

// 条件明細(capability_line_items)の横断結果を「Request 風」のツリーで見るビュー。
//   切り口(ピボット)= 作品 / 原作 / 取引先 / 部署 を選択してグループ化する。
//   作品の切り口のみ、各作品配下を IN / OUT に分けて表示する:
//     IN  = 当社が受けている権利(支払 / flow_direction='in')
//     OUT = 当社が提供している権利(受領 / flow_direction='out')
//   データ源は search-api の /api/conditions/search(admin-ui からは apiRouter 経由)。

type Row = {
  id: number
  item_name: string
  spec: string
  amount_ex_tax: number | null
  payment_date: string
  delivery_date: string
  contract_category: string
  contract_status: string
  contract_title: string
  document_number: string
  issue_key: string
  vendor_name: string
  vendor_code: string
  owner_name: string
  department: string
  work_id: number | null
  work_title: string
  work_code: string
  source_ip_id: number | null
  source_ip_title: string
  source_code: string
  is_inbound: boolean
  flow_direction: string
  status_flags: Record<string, boolean>
}

type Axis = "work" | "source_ip" | "vendor" | "department"

const AXES: { key: Axis; label: string }[] = [
  { key: "work", label: "作品" },
  { key: "source_ip", label: "原作" },
  { key: "vendor", label: "取引先" },
  { key: "department", label: "部署" },
]

const CAT_LABEL: Record<string, string> = {
  service: "業務委託", license: "ライセンス", license_in: "ライセンス(IN)",
  license_out: "ライセンス(OUT)", publication: "出版", sales: "売買", nda: "NDA",
}

// flow_direction を正、無ければ is_inbound / contract_category の _in/_out から推定。
function dirOf(r: Row): "in" | "out" | "" {
  if (r.flow_direction === "in" || r.flow_direction === "out") return r.flow_direction
  if (r.is_inbound) return "out"
  const c = (r.contract_category || "").toLowerCase()
  if (c.endsWith("_in")) return "in"
  if (c.endsWith("_out")) return "out"
  return ""
}

const axisKey = (axis: Axis, r: Row): string => {
  switch (axis) {
    case "work": return r.work_id != null ? `w:${r.work_id}` : "none"
    case "source_ip": return r.source_ip_id != null ? `s:${r.source_ip_id}` : "none"
    case "vendor": return r.vendor_code || r.vendor_name ? `v:${r.vendor_code || r.vendor_name}` : "none"
    case "department": return r.department ? `d:${r.department}` : "none"
  }
}
const axisLabel = (axis: Axis, r: Row): string => {
  switch (axis) {
    case "work": return r.work_title ? `${r.work_code ? r.work_code + " " : ""}${r.work_title}` : "（作品なし）"
    case "source_ip": return r.source_ip_title ? `${r.source_code ? r.source_code + " " : ""}${r.source_ip_title}` : "（原作なし）"
    case "vendor": return r.vendor_name || r.vendor_code || "（取引先なし）"
    case "department": return r.department || "（部署なし）"
  }
}

const yen = (v: any) => (v == null ? "—" : `¥${Number(v).toLocaleString("ja-JP")}`)
const sum = (rows: Row[]) => rows.reduce((a, r) => a + (Number(r.amount_ex_tax) || 0), 0)

// 契約状態(contract_capabilities.contract_status)。マスター(ContractsPanel)と同一語彙。
const CONTRACT_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "作成中", cls: "bg-muted text-muted-foreground" },
  awaiting_signature: { label: "締結待ち", cls: "bg-amber-500/15 text-amber-600" },
  executed: { label: "締結中", cls: "bg-emerald-500/15 text-emerald-600" },
  expired: { label: "満了", cls: "bg-muted text-muted-foreground" },
  terminated: { label: "解約済", cls: "bg-red-500/15 text-red-600 line-through" },
}
function StatusPill({ s }: { s: string }) {
  if (!s) return null
  const m = CONTRACT_STATUS[s] || { label: s, cls: "bg-muted text-muted-foreground" }
  return (
    <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-mono font-bold", m.cls)}>
      {m.label}
    </span>
  )
}

function DirPill({ dir }: { dir: "in" | "out" | "" }) {
  if (!dir) return null
  const isOut = dir === "out"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-[0.08em]",
        isOut ? "bg-emerald-500/15 text-emerald-600" : "bg-indigo-500/15 text-indigo-600"
      )}
      title={isOut ? "アウト：当社が提供している権利（受領）" : "イン：当社が受けている権利（支払）"}
    >
      {isOut ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownLeft className="h-2.5 w-2.5" />}
      {isOut ? "OUT 提供" : "IN 受領中"}
    </span>
  )
}

function LeafRow({ r }: { key?: React.Key; r: Row }) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border/50 hover:bg-muted/40">
      <span className="text-[10px] font-mono text-muted-foreground tab-mono w-20 shrink-0">
        {r.payment_date || r.delivery_date || "—"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-mono">{r.item_name || r.contract_title || "—"}</p>
        <p className="truncate text-[10px] font-mono text-muted-foreground">
          {[CAT_LABEL[r.contract_category] || r.contract_category, r.vendor_name, r.document_number]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <StatusPill s={r.contract_status} />
      <DirPill dir={dirOf(r)} />
      <span className="text-xs font-mono font-bold tab-mono w-24 text-right shrink-0">
        {yen(r.amount_ex_tax)}
      </span>
    </div>
  )
}

// 折りたたみノード(Request 風)。
function Node({
  id, expanded, toggle, depth, icon, label, count, total, accent, children,
}: {
  key?: React.Key
  id: string
  expanded: Set<string>
  toggle: (id: string) => void
  depth: number
  icon?: React.ReactNode
  label: React.ReactNode
  count: number
  total: number
  accent?: string
  children: React.ReactNode
}) {
  const open = expanded.has(id)
  return (
    <div>
      <button
        type="button"
        onClick={() => toggle(id)}
        className="group flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        {accent && <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: accent }} />}
        {icon}
        <span className="min-w-0 flex-1 truncate text-[13px] font-mono font-bold">{label}</span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono font-bold text-muted-foreground tab-mono">
          {count}
        </span>
        <span className="shrink-0 w-28 text-right text-[11px] font-mono tab-mono text-muted-foreground">
          {yen(total)}
        </span>
      </button>
      {open && <div className="border-l border-border/60" style={{ marginLeft: 18 + depth * 18 }}>{children}</div>}
    </div>
  )
}

export function ConditionTreePage() {
  const [rows, setRows] = React.useState<Row[]>([])
  const [loading, setLoading] = React.useState(true)
  const [axis, setAxis] = React.useState<Axis>("work")
  const [q, setQ] = React.useState("")
  const [category, setCategory] = React.useState("")
  const [includeAll, setIncludeAll] = React.useState(false)
  const [statusFilter, setStatusFilter] = React.useState<"all" | "executed" | "terminated">("all")
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())

  const fetchRows = React.useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams()
    if (q.trim()) p.set("q", q.trim())
    if (category) p.set("category", category)
    if (includeAll) p.set("include_all", "1")
    p.set("limit", "1000")
    fetch(`/api/conditions/search?${p.toString()}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d) => setRows(Array.isArray(d?.rows) ? d.rows : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [q, category, includeAll])

  React.useEffect(() => { fetchRows() }, []) // 初回のみ。以降は「検索」ボタン

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  // 契約状態フィルタ(有効中=executed / 解約済=terminated)。
  const shown = React.useMemo(
    () => (statusFilter === "all" ? rows : rows.filter((r) => r.contract_status === statusFilter)),
    [rows, statusFilter]
  )

  // 選択中の切り口でグループ化(キー順は件数→ラベル)。
  const groups = React.useMemo(() => {
    const m = new Map<string, { label: string; rows: Row[] }>()
    for (const r of shown) {
      const k = axisKey(axis, r)
      if (!m.has(k)) m.set(k, { label: axisLabel(axis, r), rows: [] })
      m.get(k)!.rows.push(r)
    }
    return Array.from(m.entries())
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label, "ja"))
  }, [shown, axis])

  const expandAll = () => {
    const all = new Set<string>()
    for (const g of groups) {
      all.add(g.key)
      if (axis === "work") { all.add(g.key + "/in"); all.add(g.key + "/out"); all.add(g.key + "/na") }
    }
    setExpanded(all)
  }

  return (
    <div className="px-6 py-6 max-w-[1200px] mx-auto space-y-4">
      {/* 切り口セレクタ + 検索 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {AXES.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => { setAxis(a.key); setExpanded(new Set()) }}
              className={cn(
                "px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-[0.14em] rounded-sm transition-colors",
                axis === a.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* 契約状態フィルタ(有効中 / 解約済) */}
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {([
            ["all", "すべて", "bg-foreground text-background"],
            ["executed", "有効中", "bg-emerald-600 text-white"],
            ["terminated", "解約済", "bg-red-600 text-white"],
          ] as const).map(([v, label, onCls]) => (
            <button
              key={v}
              type="button"
              onClick={() => setStatusFilter(v)}
              className={cn(
                "px-3 py-1.5 text-[11px] font-mono font-bold tracking-[0.08em] rounded-sm transition-colors",
                statusFilter === v ? onCls : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="品目 / 契約名 / 文書番号…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchRows()}
            className="pl-8 h-9"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-md border border-input bg-card px-2 text-xs font-mono"
        >
          <option value="">全種類</option>
          <option value="service">業務委託</option>
          <option value="license">ライセンス</option>
          <option value="publication">出版</option>
          <option value="sales">売買</option>
          <option value="nda">NDA</option>
        </select>
        <label className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
          <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
          旧版も
        </label>
        <button
          type="button"
          onClick={fetchRows}
          className="h-9 rounded-md bg-foreground px-4 text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-background"
        >
          検索
        </button>
        <div className="ml-auto flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
          <span>{shown.length} 件 / {groups.length} {AXES.find((a) => a.key === axis)?.label}</span>
          <button type="button" onClick={expandAll} className="underline hover:text-foreground">全展開</button>
          <button type="button" onClick={() => setExpanded(new Set())} className="underline hover:text-foreground">全閉じ</button>
        </div>
      </div>

      {/* ツリー本体 */}
      {loading ? (
        <div className="p-16 text-center"><Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" /></div>
      ) : groups.length === 0 ? (
        <div className="p-16 text-center border border-dashed border-border rounded-md">
          <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">該当する条件明細がありません</p>
        </div>
      ) : (
        <div className="border border-border rounded-md overflow-hidden divide-y divide-border">
          {groups.map((g) => {
            if (axis !== "work") {
              return (
                <Node
                  key={g.key} id={g.key} depth={0} expanded={expanded} toggle={toggle}
                  label={g.label} count={g.rows.length} total={sum(g.rows)}
                >
                  {g.rows.map((r) => <LeafRow key={r.id} r={r} />)}
                </Node>
              )
            }
            // 作品: IN / OUT / 不明 に分割
            const inRows = g.rows.filter((r) => dirOf(r) === "in")
            const outRows = g.rows.filter((r) => dirOf(r) === "out")
            const naRows = g.rows.filter((r) => dirOf(r) === "")
            const sub = (
              key: string, label: string, icon: React.ReactNode, accent: string, sr: Row[],
            ) =>
              sr.length === 0 ? null : (
                <Node
                  key={key} id={g.key + key} depth={1} expanded={expanded} toggle={toggle}
                  icon={icon} accent={accent} label={label} count={sr.length} total={sum(sr)}
                >
                  {sr.map((r) => <LeafRow key={r.id} r={r} />)}
                </Node>
              )
            return (
              <Node
                key={g.key} id={g.key} depth={0} expanded={expanded} toggle={toggle}
                label={g.label} count={g.rows.length} total={sum(g.rows)}
              >
                {sub("/out", "OUT ・ 当社が提供している権利（受領）",
                  <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />, "rgb(16 185 129)", outRows)}
                {sub("/in", "IN ・ 当社が受けている権利（支払）",
                  <ArrowDownLeft className="h-3.5 w-3.5 text-indigo-600" />, "rgb(99 102 241)", inRows)}
                {sub("/na", "方向未設定", null, "hsl(var(--border))", naRows)}
              </Node>
            )
          })}
        </div>
      )}
    </div>
  )
}
