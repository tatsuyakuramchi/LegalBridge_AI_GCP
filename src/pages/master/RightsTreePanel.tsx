/**
 * RightsTreePanel — 作品を根にした「契約・権利ツリー」。
 *
 * 金銭のイン（受領 / receivable）/ アウト（支払 / payable）で契約構造を可視化する。
 *   - 取得した権利（当社が支払・保有）: 買い切り（固定額）は金額、ランニングは計算条件＋許諾地域＋許諾言語。
 *   - 許諾した権利（当社が受領）: 先頭に許諾地域サマリー（地域→言語→対象権利、広域許諾との重複注意）。
 *
 * データ源: GET /api/v3/works/:id/rights-tree（search-api / condition_lines 直結）。
 * admin-ui の作品詳細（/works/:id）とポータル作品検索の両方から使う共通の集計を、React 側はこの Panel で描画する。
 */
import * as React from "react"
import { ChevronDown, Coins, Infinity as InfinityIcon, AlertTriangle, RefreshCw } from "lucide-react"

type Right = {
  id: number
  direction: "payable" | "receivable"
  dir: "in" | "out"
  type: "own" | "run" | "free"
  name: string
  party: string
  amount: number | null
  amount_label: string | null
  calc: string | null
  territory: string | null
  language: string | null
  document_number: string | null
}
type TerritorySummary = { territory: string; languages: string[]; rights: string[] }
type TreeData = {
  ok: boolean
  work: { id: number; work_code: string; title: string }
  acquired: Right[]
  granted: Right[]
  territorySummary: TerritorySummary[]
  overlaps: string[]
  totals: { buyout_count: number; buyout_amount: number; acquired_count: number; granted_count: number }
}

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP")

function Badge({ kind }: { kind: Right["type"] }) {
  if (kind === "own")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-info/40 bg-info/10 text-info dark:border-info dark:bg-info dark:text-info">
        <InfinityIcon className="h-3 w-3" /> 買い切り
      </span>
    )
  if (kind === "free")
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-border text-muted-foreground">無償</span>
  return null
}

function MetaChips({ r }: { r: Right }) {
  if (r.type === "own") {
    return (
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md border border-info/40 bg-info/10 text-info dark:border-info dark:bg-info dark:text-info">
          <Coins className="h-3 w-3" /> 一時金 {r.amount_label}
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded-md border border-border bg-muted/40 text-muted-foreground">
          <span className="text-[9px] font-bold uppercase tracking-wide mr-1">期間</span>永続（買い切り）
        </span>
      </div>
    )
  }
  const chip = (label: string, value: string, tone?: string) => (
    <span className={`text-[11px] px-2 py-0.5 rounded-md border bg-muted/40 ${tone || "border-border text-foreground"}`}>
      <span className="text-[9px] font-bold uppercase tracking-wide mr-1 text-muted-foreground">{label}</span>
      {value}
    </span>
  )
  const calcTone =
    r.dir === "in"
      ? "border-success/40 text-success dark:border-success dark:text-success font-mono"
      : "border-warning/40 text-warning dark:border-warning dark:text-warning font-mono"
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {r.calc ? chip("計算条件", r.calc, calcTone) : null}
      {r.territory ? chip("許諾地域", r.territory) : null}
      {r.language ? chip("許諾言語", r.language) : null}
    </div>
  )
}

const Leaf: React.FC<{ r: Right }> = ({ r }) => {
  const stripe = r.type === "own" ? "bg-info" : r.dir === "in" ? "bg-success" : r.type === "free" ? "bg-gray-400" : "bg-warning"
  return (
    <div className="flex items-stretch gap-2.5 rounded-lg border border-border bg-card px-3 py-2 hover:border-foreground/40">
      <span className={`w-1 rounded ${stripe} flex-none`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-[13px]">{r.name}</span>
          <span className="text-[11px] text-muted-foreground">· {r.party}</span>
          <Badge kind={r.type} />
          {r.document_number ? <span className="text-[10px] text-muted-foreground/70">{r.document_number}</span> : null}
        </div>
        <MetaChips r={r} />
      </div>
    </div>
  )
}

function Branch({ title, dir, count, children, defaultOpen = true }: {
  title: string; dir: "in" | "out"; count: number; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  const tone = dir === "in" ? "text-success dark:text-success" : "text-warning dark:text-warning"
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-[12.5px] font-bold ${tone}`}
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
        <span className="text-[11px]">{dir === "in" ? "▲" : "▼"}</span>
        {title}
        <span className="text-[10px] text-muted-foreground font-semibold">{count} 件</span>
      </button>
      {open ? <div className="mt-2 ml-3 border-l border-dashed border-border pl-4 space-y-2">{children}</div> : null}
    </div>
  )
}

function TerritorySummaryCard({ summary, overlaps }: { summary: TerritorySummary[]; overlaps: string[] }) {
  if (!summary.length) return null
  return (
    <div className="rounded-lg border border-dashed border-success/40 bg-success/10 dark:border-success dark:bg-success px-3 py-2.5">
      <div className="text-[11px] font-extrabold text-success dark:text-success flex items-center gap-1.5 mb-1">
        🌐 許諾地域サマリー
        <span className="text-[10px] text-muted-foreground bg-card border border-success/40 dark:border-success rounded px-1.5">
          {summary.length} 地域
        </span>
      </div>
      {summary.map((s, i) => (
        <div key={i} className="flex items-center gap-2.5 flex-wrap py-1 border-t border-dashed border-success/40 dark:border-success first:border-t-0 text-[12px]">
          <span className="font-bold min-w-[80px]">{s.territory}</span>
          <span className="font-mono text-[11px] border border-success/40 dark:border-success rounded px-2 bg-card">
            {s.languages.join("・") || "—"}
          </span>
          <span className="text-[11px] text-muted-foreground">{s.rights.join(" / ")}</span>
        </div>
      ))}
      {overlaps.length ? (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-warning dark:text-warning bg-warning/10 dark:bg-warning border border-warning/40 dark:border-warning rounded-md px-2.5 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 flex-none mt-0.5" />
          <span>{overlaps.join("、")} は広域許諾と範囲が重複します。媒体・独占条件をご確認ください。</span>
        </div>
      ) : null}
    </div>
  )
}

export function RightsTreePanel({ workId }: { workId: number | string }) {
  const [data, setData] = React.useState<TreeData | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!workId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v3/works/${encodeURIComponent(String(workId))}/rights-tree`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.ok === false) throw new Error(j.error || `HTTP ${res.status}`)
      setData(j)
    } catch (e: any) {
      setError(String(e?.message || e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [workId])

  React.useEffect(() => { load() }, [load])

  return (
    <section className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="retro-tag mb-1">RIGHTS · TREE</p>
          <h3 className="text-sm font-mono font-bold">契約・権利ツリー（金銭イン/アウト・買い切り）</h3>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border border-border hover:bg-muted">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> 更新
        </button>
      </div>

      {error ? <div className="text-[12px] text-destructive">読み込みに失敗しました: {error}</div> : null}
      {loading && !data ? <div className="text-[12px] text-muted-foreground">読み込み中…</div> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-md border border-border bg-card px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold">◆ 買い切り保有</div>
              <div className="text-[15px] font-bold text-info dark:text-info tabular-nums">{data.totals.buyout_count} 件</div>
              <div className="text-[10px] text-muted-foreground">一時金 {yen(data.totals.buyout_amount)}</div>
            </div>
            <div className="rounded-md border border-border bg-card px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold">▼ 取得した権利</div>
              <div className="text-[15px] font-bold text-warning dark:text-warning tabular-nums">{data.totals.acquired_count} 件</div>
              <div className="text-[10px] text-muted-foreground">支払・保有</div>
            </div>
            <div className="rounded-md border border-border bg-card px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold">▲ 許諾した権利</div>
              <div className="text-[15px] font-bold text-success dark:text-success tabular-nums">{data.totals.granted_count} 件</div>
              <div className="text-[10px] text-muted-foreground">受領</div>
            </div>
            <div className="rounded-md border border-border bg-card px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold">許諾地域</div>
              <div className="text-[15px] font-bold tabular-nums">{data.territorySummary.length} 地域</div>
              <div className="text-[10px] text-muted-foreground">{data.overlaps.length ? "重複あり注意" : "重複なし"}</div>
            </div>
          </div>

          {/* 根 */}
          <div className="inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-3 py-2">
            <span>🎬</span>
            <span className="font-bold text-[14px]">{data.work.title}</span>
            <span className="text-[10px] font-mono opacity-70">{data.work.work_code}</span>
          </div>

          <div className="ml-3 border-l border-dashed border-border pl-4 space-y-3">
            <Branch title="取得した権利（当社が支払・保有）" dir="out" count={data.acquired.length}>
              {data.acquired.length ? data.acquired.map((r: Right) => <Leaf key={r.id} r={r} />) : <div className="text-[11px] text-muted-foreground">なし</div>}
            </Branch>
            <Branch title="許諾した権利（当社が受領）" dir="in" count={data.granted.length}>
              <TerritorySummaryCard summary={data.territorySummary} overlaps={data.overlaps} />
              {data.granted.length ? data.granted.map((r: Right) => <Leaf key={r.id} r={r} />) : <div className="text-[11px] text-muted-foreground">なし</div>}
            </Branch>
          </div>

          <p className="text-[10px] text-muted-foreground border-t border-border pt-2">
            買い切り＝明細の固定額（calc_method=FIXED・ランニング率なし）を金額表示。ランニングは計算条件＋許諾地域・言語（condition_lines を直結集計）。
          </p>
        </>
      ) : null}

      {data && !data.acquired.length && !data.granted.length ? (
        <div className="text-[12px] text-muted-foreground">この作品に紐づく条件明細（権利）はまだありません。</div>
      ) : null}
    </section>
  )
}
