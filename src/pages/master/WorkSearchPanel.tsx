/**
 * WorkSearchPanel — 作品検索(専用画面 / admin-ui)。
 *
 * 従来の作品モデル(WorkModelPanel)は works を全件ロードしてクライアント側で
 * 絞り込んでいたため件数が増えると重い。本ページは DB 直結の
 *   GET /api/v3/works/search?q=&type=&status=&division=&limit=&offset=
 * (search-api 所有 / BFF 経由)でサーバ側検索し、ページング付きで軽量に返す。
 * 行の「開く」から統一エディタ /works/:id へ遷移する。
 */
import * as React from "react"
import { Link } from "react-router-dom"
import { Search, RefreshCw, ExternalLink } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { Badge } from "@/components/ui/badge"

const TYPE: Record<string, string> = {
  board_game: "ボードゲーム",
  trpg_book: "TRPG書籍",
  supplement: "サプリメント",
  digital: "デジタル",
}
const STATUS: Record<string, string> = {
  planning: "企画",
  in_production: "制作中",
  released: "発売済",
  suspended: "停止",
  discontinued: "終売",
}
const LIMIT = 50

type WorkRow = {
  id: number
  work_code: string
  title: string
  title_kana?: string | null
  alternative_titles?: string[] | null
  division?: string[] | null
  work_type?: string | null
  status?: string | null
  is_original?: boolean
  is_active?: boolean
  product_count?: number
  material_count?: number
}

export function WorkSearchPanel() {
  const [q, setQ] = React.useState("")
  const [type, setType] = React.useState("")
  const [status, setStatus] = React.useState("")
  const [division, setDivision] = React.useState("")
  const [offset, setOffset] = React.useState(0)
  const [rows, setRows] = React.useState<WorkRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const runSearch = React.useCallback(
    async (nextOffset: number) => {
      setLoading(true)
      setError(null)
      try {
        const p = new URLSearchParams()
        if (q.trim()) p.set("q", q.trim())
        if (type) p.set("type", type)
        if (status) p.set("status", status)
        if (division) p.set("division", division)
        p.set("limit", String(LIMIT))
        p.set("offset", String(nextOffset))
        const res = await fetch(`/api/v3/works/search?${p.toString()}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
        setRows(Array.isArray(data.rows) ? data.rows : [])
        setTotal(Number(data.total || 0))
        setOffset(nextOffset)
      } catch (e: any) {
        setError(String(e?.message || e))
        setRows([])
        setTotal(0)
      } finally {
        setLoading(false)
      }
    },
    [q, type, status, division]
  )

  // 初回 + フィルタ変更で先頭ページから再検索(q はデバウンス)。
  React.useEffect(() => {
    const t = setTimeout(() => runSearch(0), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type, status, division])

  const page = Math.floor(offset / LIMIT) + 1
  const pages = Math.max(1, Math.ceil(total / LIMIT))

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Search className="h-4 w-4" /> 作品検索
        </h1>
        <p className="text-[12px] text-muted-foreground mt-1">
          自社作品を DB 直結で横断検索します（タイトル / 別題 / 作品コード / よみ）。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="作品を検索…"
            className="pl-8 h-9"
            autoFocus
          />
        </div>
        <NativeSelect value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-auto text-[12px]">
          <option value="">種別: すべて</option>
          {Object.entries(TYPE).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-auto text-[12px]">
          <option value="">状態: すべて</option>
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={division} onChange={(e) => setDivision(e.target.value)} className="h-9 w-auto text-[12px]">
          <option value="">区分: すべて</option>
          <option value="BDG">BDG</option>
          <option value="PUB">PUB</option>
        </NativeSelect>
        <Button variant="outline" size="sm" onClick={() => runSearch(offset)} disabled={loading} className="h-9 gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 更新
        </Button>
      </div>

      <div className="text-[12px] text-muted-foreground">
        {error ? (
          <span className="text-red-600">検索に失敗しました: {error}</span>
        ) : loading ? (
          "検索中…"
        ) : total ? (
          `${total} 件ヒット${total > LIMIT ? `（${offset + 1}–${Math.min(offset + LIMIT, total)} 件を表示）` : ""}`
        ) : (
          "該当する作品がありません。"
        )}
      </div>

      <div className="border border-border rounded-md overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/50">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 font-semibold">作品コード</th>
              <th className="px-3 py-2 font-semibold">タイトル</th>
              <th className="px-3 py-2 font-semibold">種別</th>
              <th className="px-3 py-2 font-semibold">状態</th>
              <th className="px-3 py-2 font-semibold">区分</th>
              <th className="px-3 py-2 font-semibold text-right">製品</th>
              <th className="px-3 py-2 font-semibold text-right">権利</th>
              <th className="px-3 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap">{w.work_code}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{w.title}</div>
                  {w.title_kana ? <div className="text-[10px] text-muted-foreground">{w.title_kana}</div> : null}
                  {w.alternative_titles && w.alternative_titles.filter(Boolean).length > 0 ? (
                    <div className="text-[10px] text-muted-foreground">別題: {w.alternative_titles.filter(Boolean).join(" / ")}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{w.work_type ? TYPE[w.work_type] || w.work_type : "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{w.status ? STATUS[w.status] || w.status : "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {(w.division || []).map((d) => (
                    <Badge key={d} variant="outline" className="mr-1 text-[10px]">{d}</Badge>
                  ))}
                  {w.is_original ? <Badge variant="secondary" className="text-[10px]">オリジナル</Badge> : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{w.product_count ?? 0}</td>
                <td className="px-3 py-2 text-right tabular-nums">{w.material_count ?? 0}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link to={`/works/${w.id}`} className="inline-flex items-center gap-1 text-sky-700 hover:underline">
                    <ExternalLink className="h-3 w-3" /> 開く
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  該当なし。条件を変えてお試しください。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {total > LIMIT ? (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={offset <= 0 || loading} onClick={() => runSearch(offset - LIMIT)}>
            ← 前へ
          </Button>
          <span className="text-[12px] text-muted-foreground">{page} / {pages}</span>
          <Button variant="outline" size="sm" disabled={offset + LIMIT >= total || loading} onClick={() => runSearch(offset + LIMIT)}>
            次へ →
          </Button>
        </div>
      ) : null}
    </div>
  )
}
