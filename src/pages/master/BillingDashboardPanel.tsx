/**
 * BillingDashboardPanel — 請求・分配 横断ダッシュボード。
 *
 * 全作品の再許諾受領(condition_receipts)×分配を1画面で俯瞰する。期間/フリーワード/
 * 未受領/未分配 で絞り込み、受領合計・分配合計を集計。編集は「請求・分配」(作品別)画面で行う。
 *
 *   一覧: GET /api/v3/receipts-dashboard?q=&period=&unreceived=&undistributed=
 */
import * as React from "react"
import { Loader2, Search, RefreshCw, ArrowDownToLine, ArrowUpFromLine, AlertTriangle } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { cn } from "@/lib/utils"

const yen = (n: any, cur = "JPY") =>
  n == null || n === "" ? "—" : `${cur === "JPY" ? "¥" : cur + " "}${Number(n).toLocaleString("ja-JP")}`

const inputCls = "text-xs font-mono bg-transparent border border-input rounded px-2 py-1.5 focus:outline-none focus:border-foreground"

export function BillingDashboardPanel() {
  const navigate = useNavigate()
  const [q, setQ] = React.useState("")
  const [period, setPeriod] = React.useState("")
  const [unreceived, setUnreceived] = React.useState(false)
  const [undistributed, setUndistributed] = React.useState(false)
  const [rows, setRows] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (q) p.set("q", q)
      if (period) p.set("period", period)
      if (unreceived) p.set("unreceived", "true")
      if (undistributed) p.set("undistributed", "true")
      const r = await fetch(`/api/v3/receipts-dashboard?${p.toString()}`)
      const d = await r.json()
      setRows(Array.isArray(d) ? d : [])
    } catch { setRows([]) } finally { setLoading(false) }
  }, [q, period, unreceived, undistributed])

  React.useEffect(() => { const t = setTimeout(() => void load(), 300); return () => clearTimeout(t) }, [load])

  const totalRecvRoyalty = rows.reduce((s, x) => s + (Number(x.computed_royalty_ex_tax) || 0), 0)
  const totalReceived = rows.reduce((s, x) => s + (Number(x.received_amount) || 0), 0)
  const totalDist = rows.reduce((s, x) => s + (Number(x.computed_distribution_ex_tax) || 0), 0)

  return (
    <div className="space-y-5">
      <div>
        <p className="retro-tag mb-1.5">MST · BILLING DASH</p>
        <h3 className="text-lg font-mono font-bold tracking-tight">請求・分配 横断ダッシュボード</h3>
        <p className="text-xs font-mono text-muted-foreground mt-1 leading-snug">
          全作品の再許諾受領と分配を俯瞰します。編集は「請求・分配」（作品別）で。行クリックで該当作品へ。
        </p>
      </div>

      {/* サマリ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-md border border-sky-200 bg-sky-50/50 dark:bg-sky-950/20 px-3 py-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-sky-700 flex items-center gap-1"><ArrowDownToLine className="h-3 w-3" /> 受領再許諾料 合計</div>
          <div className="text-lg font-mono font-bold text-sky-800">{yen(totalRecvRoyalty)}</div>
        </div>
        <div className="rounded-md border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-emerald-700">実受領額 合計</div>
          <div className="text-lg font-mono font-bold text-emerald-800">{yen(totalReceived)}</div>
        </div>
        <div className="rounded-md border border-rose-200 bg-rose-50/50 dark:bg-rose-950/20 px-3 py-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-rose-700 flex items-center gap-1"><ArrowUpFromLine className="h-3 w-3" /> ライセンサー分配 合計</div>
          <div className="text-lg font-mono font-bold text-rose-800">{yen(totalDist)}</div>
        </div>
      </div>

      {/* フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="作品 / 再許諾先 / ライセンサーで検索" className={cn(inputCls, "w-full pl-8")} />
        </div>
        <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="期間 YYYY-MM" className={cn(inputCls, "w-32")} />
        <label className="flex items-center gap-1.5 font-mono text-[11px]"><input type="checkbox" checked={unreceived} onChange={(e) => setUnreceived(e.target.checked)} /> 未受領のみ</label>
        <label className="flex items-center gap-1.5 font-mono text-[11px]"><input type="checkbox" checked={undistributed} onChange={(e) => setUndistributed(e.target.checked)} /> 未分配のみ</label>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 border border-border rounded px-3 py-1.5 font-mono text-[11px] hover:bg-muted">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> 再読込
        </button>
      </div>

      {/* テーブル */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-[10.5px] font-mono border-collapse min-w-[980px]">
          <thead>
            <tr className="text-muted-foreground bg-muted/40 border-b border-border">
              <th className="text-left font-bold py-1.5 px-2">期間</th>
              <th className="text-left font-bold py-1.5 px-2">作品</th>
              <th className="text-left font-bold py-1.5 px-2">再許諾先</th>
              <th className="text-right font-bold py-1.5 px-2">報告売上/数量</th>
              <th className="text-right font-bold py-1.5 px-2 text-sky-700">受領再許諾料</th>
              <th className="text-right font-bold py-1.5 px-2">実受領</th>
              <th className="text-left font-bold py-1.5 px-2">ライセンサー</th>
              <th className="text-right font-bold py-1.5 px-2 text-rose-700">分配(支払)</th>
              <th className="text-center font-bold py-1.5 px-2">台帳</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin inline" /> 読み込み中…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="text-center text-muted-foreground py-6">該当する受領記録がありません。</td></tr>
            ) : rows.map((x) => (
              <tr key={x.id} className="border-b border-border/60 hover:bg-muted/30 cursor-pointer" onClick={() => x.work_id && navigate(`/master/billing`)} title="作品別の請求・分配へ">
                <td className="py-1 px-2">{x.period || "—"}</td>
                <td className="py-1 px-2 max-w-[180px] truncate">{x.work_code ? `[${x.work_code}] ` : ""}{x.work_title || `#${x.work_id}`}</td>
                <td className="py-1 px-2 max-w-[140px] truncate">{x.counterparty_name || "—"}{x.region_language_label ? ` / ${x.region_language_label}` : ""}</td>
                <td className="text-right py-1 px-2">{x.reported_sales != null ? yen(x.reported_sales, x.currency) : (x.reported_quantity != null ? `${x.reported_quantity} 個` : "—")}</td>
                <td className="text-right py-1 px-2 font-bold text-sky-700">{yen(x.computed_royalty_ex_tax, x.currency)}</td>
                <td className="text-right py-1 px-2">{yen(x.received_amount, x.currency)}</td>
                <td className="py-1 px-2 max-w-[120px] truncate">
                  {x.parent_license_condition_id == null
                    ? <span className="inline-flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" />未リンク</span>
                    : <>{x.licensor_name || "—"}{x.parent_rate_pct != null ? ` ${x.parent_rate_pct}%` : ""}</>}
                </td>
                <td className="text-right py-1 px-2 font-bold text-rose-700">{yen(x.computed_distribution_ex_tax, x.currency)}</td>
                <td className="text-center py-1 px-2">
                  <span className={cn("inline-block px-1 rounded-sm text-[9px]", x.payment_id ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>入{x.payment_id ? "✓" : "—"}</span>{" "}
                  <span className={cn("inline-block px-1 rounded-sm text-[9px]", x.distribution_payment_id ? "bg-rose-100 text-rose-700" : "bg-muted text-muted-foreground")}>出{x.distribution_payment_id ? "✓" : "—"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length >= 1000 && (
        <p className="font-mono text-[10px] text-amber-600">※ 表示は最大1000件です。期間や検索で絞り込んでください。</p>
      )}
    </div>
  )
}
