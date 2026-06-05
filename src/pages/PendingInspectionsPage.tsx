import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Search, RefreshCw, ClipboardCheck, FileCheck2 } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

// 検収待ち: 発注書(purchase_order)があるのに検収書が未作成/未完了のものを一覧し、
//   そこから検収書を作成(個別)する。検収進捗は /api/contracts/search が返す
//   inspected_amount / remaining_amount を使う。

type Row = Record<string, any>

const yen = (n: any) => {
  const v = Number(n)
  return isFinite(v) ? "¥" + v.toLocaleString("ja-JP") : "—"
}

export function PendingInspectionsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = React.useState<Row[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [q, setQ] = React.useState("")
  const [onlyUninspected, setOnlyUninspected] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/contracts/search?record_types=purchase_order&limit=500")
      if (!res.ok) throw new Error("HTTP " + res.status)
      const data = await res.json()
      setRows(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message || String(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  // 残額 > 0 = まだ全額検収されていない発注書。
  const pending = React.useMemo(() => {
    const kw = q.trim().toLowerCase()
    return rows
      .filter((r) => (Number(r.remaining_amount) || 0) > 0)
      .filter((r) => (onlyUninspected ? (Number(r.inspected_amount) || 0) === 0 : true))
      .filter((r) =>
        !kw
          ? true
          : `${r.document_number} ${r.contract_title} ${r.vendor_name} ${r.vendor_code}`
              .toLowerCase()
              .includes(kw)
      )
      .sort((a, b) => String(b.issue_date_po || "").localeCompare(String(a.issue_date_po || "")))
  }, [rows, q, onlyUninspected])

  const totalRemaining = pending.reduce((s, r) => s + (Number(r.remaining_amount) || 0), 0)

  const createInspection = (id: number) => {
    navigate(`/documents/new?template=inspection_certificate&parent_po=${id}`)
  }

  return (
    <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-sm font-mono font-bold uppercase tracking-[0.14em]">検収待ち 発注書</h1>
        <span className="text-[11px] font-mono text-muted-foreground">
          発注書はあるが検収書が未作成 / 未完了のもの
        </span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw />
          更新
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="発注書番号・取引先・件名で検索…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground cursor-pointer">
          <input type="checkbox" className="h-4 w-4" checked={onlyUninspected} onChange={(e) => setOnlyUninspected(e.target.checked)} />
          未検収のみ（一度も検収していない）
        </label>
        <div className="flex-1" />
        <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
          {loading ? "読み込み中…" : `${pending.length} 件 / 残額合計 ${yen(totalRemaining)}`}
        </span>
      </div>

      <div className="border border-border rounded-lg overflow-x-auto">
        {error ? (
          <div className="p-8 text-center text-sm text-destructive">読み込み失敗: {error}</div>
        ) : pending.length === 0 && !loading ? (
          <div className="p-12 text-center text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
            検収待ちの発注書はありません 🎉
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground">
              <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:whitespace-nowrap">
                <th>状態</th>
                <th>発注書番号</th>
                <th>取引先</th>
                <th>件名</th>
                <th className="text-right">発注額(税抜)</th>
                <th className="text-right">既検収</th>
                <th className="text-right">残額</th>
                <th className="text-right">検収率</th>
                <th>発注日</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => {
                const ordered = Number(r.amount_ex_tax) || 0
                const inspected = Number(r.inspected_amount) || 0
                const pct = ordered > 0 ? Math.round((inspected / ordered) * 100) : 0
                const uninspected = inspected === 0
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/30 [&>td]:px-2 [&>td]:py-2 align-top">
                    <td className="whitespace-nowrap">
                      {uninspected ? (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">未検収</Badge>
                      ) : (
                        <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100">一部検収 {pct}%</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap font-mono">
                      {r.document_number || "—"}
                      {r.is_imported && (
                        <Badge variant="outline" className="ml-1 text-[9px]">取込</Badge>
                      )}
                    </td>
                    <td className="min-w-[120px]">{r.vendor_name || r.vendor_code || "—"}</td>
                    <td className="min-w-[160px] whitespace-normal">{r.contract_title || "—"}</td>
                    <td className="text-right whitespace-nowrap font-mono">{yen(ordered)}</td>
                    <td className="text-right whitespace-nowrap font-mono text-muted-foreground">{yen(inspected)}</td>
                    <td className="text-right whitespace-nowrap font-mono font-bold">{yen(r.remaining_amount)}</td>
                    <td className="text-right whitespace-nowrap">{pct}%</td>
                    <td className="whitespace-nowrap text-muted-foreground">{r.issue_date_po || "—"}</td>
                    <td className="whitespace-nowrap text-right">
                      <Button size="sm" onClick={() => createInspection(Number(r.id))}>
                        <FileCheck2 />
                        検収書を作成
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        「検収書を作成」を押すと、検収書フォームがその発注書を親に事前選択した状態で開きます。
        明細別の検収数量・検収日・検収者を確認して発行してください（分割検収にも対応）。
      </p>
    </div>
  )
}
