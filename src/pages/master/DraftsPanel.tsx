/**
 * DraftsPanel — Phase 22.21.81
 *
 * document_drafts (= 文書作成途中の form_data 一時保存) の一覧・削除 UI。
 *
 *   - Phase 22.21.79 で導入した /api/document-drafts に対応
 *   - 一覧: GET /api/document-drafts (worker)
 *   - 単一削除: DELETE /api/document-drafts/:issueKey?template_type=...
 *   - 一括削除: POST /api/document-drafts/bulk-delete  body: { ids:[], all? }
 *   - 「フォームを開く」 → /documents/new?issue=<key> に遷移して DBSYNC を促す
 *
 * 通常 PDF 発行 (= /api/documents/generate) と「📦 一括完了」では worker 側で
 * 自動削除されるが、課題を捨てた等の理由で残った draft の掃除に使う。
 */

import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  RefreshCw,
  Search,
  Trash2,
  ExternalLink,
  AlertTriangle,
  Loader2,
  CheckSquare,
  Square,
} from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface DraftRow {
  id: number
  issue_key: string
  template_type: string
  updated_at: string
  updated_by: string | null
  keys_count?: number
  size_bytes?: number
}

const formatBytes = (n: number | undefined): string => {
  if (n == null) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

const formatDateTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

export function DraftsPanel() {
  const { showNotification } = useAppData()
  const navigate = useNavigate()
  const [rows, setRows] = React.useState<DraftRow[]>([])
  const [query, setQuery] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [busy, setBusy] = React.useState(false)

  const refresh = React.useCallback(async (q?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      const qq = (q ?? query).trim()
      if (qq) params.set("q", qq)
      params.set("limit", "500")
      const res = await fetch(`/api/document-drafts?${params.toString()}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      const list: DraftRow[] = Array.isArray(data?.drafts) ? data.drafts : []
      setRows(list)
      // 表示中の selected から無くなった ID は外す
      setSelected((prev) => {
        const next = new Set<number>()
        for (const r of list) if (prev.has(r.id)) next.add(r.id)
        return next
      })
    } catch (e: any) {
      showNotification(`一覧取得失敗: ${e?.message || e}`, "error")
      setRows([])
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, showNotification])

  React.useEffect(() => {
    refresh("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    if (selected.size === rows.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(rows.map((r) => r.id)))
    }
  }

  const deleteOne = async (row: DraftRow) => {
    if (
      !window.confirm(
        `この draft を削除します。\n\n課題: ${row.issue_key}\nテンプレ: ${row.template_type}\n更新: ${formatDateTime(row.updated_at)}\n\n復元できません。よろしいですか?`
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const res = await fetch(
        `/api/document-drafts/${encodeURIComponent(row.issue_key)}?template_type=${encodeURIComponent(row.template_type)}`,
        { method: "DELETE" }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      showNotification(`削除しました (${row.issue_key})`, "success")
      await refresh()
    } catch (e: any) {
      showNotification(`削除失敗: ${e?.message || e}`, "error")
    } finally {
      setBusy(false)
    }
  }

  const deleteBulk = async (mode: "selected" | "all") => {
    const targetCount = mode === "all" ? rows.length : selected.size
    if (targetCount === 0) {
      showNotification(
        mode === "all" ? "削除対象が 0 件です" : "選択された行がありません",
        "info"
      )
      return
    }
    const label = mode === "all" ? "全件 (表示中)" : `選択中の ${targetCount} 件`
    if (
      !window.confirm(
        `${label} を一括削除します。\n\n復元できません。よろしいですか?`
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const body =
        mode === "all"
          ? // Phase 22.21.81: 「全件」 = 表示中の id 配列で消す
            //   q で絞り込み中の場合は絞り込み結果のみ削除する直感的な挙動。
            { ids: rows.map((r) => r.id) }
          : { ids: Array.from(selected) }
      const res = await fetch("/api/document-drafts/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      showNotification(`${data?.deleted || 0} 件削除しました`, "success")
      setSelected(new Set())
      await refresh()
    } catch (e: any) {
      showNotification(`一括削除失敗: ${e?.message || e}`, "error")
    } finally {
      setBusy(false)
    }
  }

  const openInEditor = (row: DraftRow) => {
    // 既存ルート: /documents/new?issue=<key>
    // 編集側で issue を select すると自動で DBSYNC → draft 復元される。
    navigate(`/documents/new?issue=${encodeURIComponent(row.issue_key)}`)
  }

  const allChecked = rows.length > 0 && selected.size === rows.length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {rows.length} drafts {selected.size > 0 && `· ${selected.size} 選択中`}
        </span>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                refresh()
              }
            }}
            placeholder="課題番号 / テンプレ種別 / updater で部分検索"
            className="pl-7 w-[300px] text-[11px] font-mono"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refresh()}
          disabled={loading}
        >
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          再読み込み
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => deleteBulk("selected")}
          disabled={busy || selected.size === 0}
          title="チェックを入れた draft をまとめて削除"
        >
          <Trash2 />
          選択削除
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => deleteBulk("all")}
          disabled={busy || rows.length === 0}
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
          title="現在表示中のすべての draft を削除 (q で絞り込み中なら絞り込み結果のみ)"
        >
          <AlertTriangle />
          表示中をすべて削除
        </Button>
      </div>

      <div className="rounded-sm border border-input bg-background overflow-hidden">
        <div className="grid grid-cols-[36px_1fr_180px_180px_120px_100px_140px] gap-2 px-3 py-2 border-b border-input bg-muted/30 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          <button
            type="button"
            onClick={toggleAll}
            className="flex items-center justify-center text-foreground/70 hover:text-foreground"
            title={allChecked ? "全選択解除" : "全選択"}
          >
            {allChecked ? (
              <CheckSquare className="h-3.5 w-3.5" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
          </button>
          <div>課題番号</div>
          <div>テンプレ種別</div>
          <div>最終更新</div>
          <div>更新者</div>
          <div className="text-right">サイズ</div>
          <div className="text-right">操作</div>
        </div>

        {rows.length === 0 && !loading && (
          <div className="px-3 py-6 text-center text-[11px] font-mono text-muted-foreground">
            {query ? `"${query}" に該当する draft はありません` : "draft はありません"}
          </div>
        )}

        {rows.map((r) => {
          const checked = selected.has(r.id)
          return (
            <div
              key={r.id}
              className={cn(
                "grid grid-cols-[36px_1fr_180px_180px_120px_100px_140px] gap-2 px-3 py-2 border-b border-input/60 text-[11px] font-mono items-center",
                "hover:bg-muted/30 transition-colors",
                checked && "bg-sky-50/60"
              )}
            >
              <button
                type="button"
                onClick={() => toggle(r.id)}
                className="flex items-center justify-center text-foreground/70 hover:text-foreground"
              >
                {checked ? (
                  <CheckSquare className="h-3.5 w-3.5" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
              </button>
              <div className="truncate font-bold" title={r.issue_key}>
                {r.issue_key}
              </div>
              <div className="truncate text-foreground/80" title={r.template_type}>
                {r.template_type}
              </div>
              <div className="text-foreground/80">
                {formatDateTime(r.updated_at)}
              </div>
              <div className="truncate text-muted-foreground" title={r.updated_by || ""}>
                {r.updated_by || "—"}
              </div>
              <div className="text-right text-muted-foreground">
                {formatBytes(r.size_bytes)}
                {r.keys_count != null && (
                  <span className="ml-1 text-[11px] opacity-70">({r.keys_count}k)</span>
                )}
              </div>
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => openInEditor(r)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider border border-input rounded-sm hover:bg-muted text-foreground"
                  title="文書作成画面でこの課題を開く (DBSYNC で draft が自動復元)"
                >
                  <ExternalLink className="h-3 w-3" />
                  開く
                </button>
                <button
                  type="button"
                  onClick={() => deleteOne(r)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider border border-destructive/40 text-destructive rounded-sm hover:bg-destructive/10 disabled:opacity-50"
                  title="この draft を削除"
                >
                  <Trash2 className="h-3 w-3" />
                  削除
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="text-[10px] font-mono text-muted-foreground leading-relaxed">
        ※ 通常 PDF 発行 / 📦 一括完了 では draft は自動削除されます。<br />
        ※ 課題を破棄した場合などに残った draft をここから掃除できます。<br />
        ※ 「サイズ」列は form_data の JSON バイト数、(数字k) はキー数。
      </div>
    </div>
  )
}
