/**
 * WorksListPanel — 作品統合 増分④（work-3card-unified-editor-spec §2.1）
 *
 * 原作(works.kind='licensed_in') と 自社作品(works.kind='own') を
 * kind フィルタ付きの単一一覧で表示し、カードから 3カード統合エディタ
 * (/works/:id) へ遷移する。サイドバー「作品管理」の入口。
 *
 * データ源（正準 works テーブル。pk空間は kind 共通）:
 *   - 自社作品: GET /api/v3/works           (kind='own')
 *   - 原作:     GET /api/v3/source-ips       (kind='licensed_in', work_code=source_code)
 *
 * 注: LO- 原作(ledgers)の works 統合は設計書 §8 #4 のデータ移行後に本一覧へ反映。
 *     エディタ内 CRUD / 原作中心ビュー / 許諾地域引用 は増分⑤〜⑧で追加。
 */
import * as React from "react"
import { useNavigate, Link } from "react-router-dom"
import { Plus, Search, RefreshCw, BookMarked, Boxes, Network } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/EmptyState"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type Kind = "source" | "own"
type Filter = "all" | Kind

type WorkRow = {
  id: number
  kind: Kind
  code: string
  title: string
  title_kana?: string
  sub: string
  is_active: boolean
}

const KIND_META: Record<Kind, { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  source: { label: "原作", cls: "border-sky-300 text-sky-700", icon: BookMarked },
  own: { label: "自社作品", cls: "border-violet-300 text-violet-700", icon: Boxes },
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "source", label: "原作 (LO/source)" },
  { key: "own", label: "自社作品 (W/own)" },
]

export function WorksListPanel() {
  const navigate = useNavigate()
  const [rows, setRows] = React.useState<WorkRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [filter, setFilter] = React.useState<Filter>("all")
  const [q, setQ] = React.useState("")

  // 新規作成ダイアログ
  const [createKind, setCreateKind] = React.useState<Kind | null>(null)
  const [newTitle, setNewTitle] = React.useState("")
  const [creating, setCreating] = React.useState(false)
  const [createErr, setCreateErr] = React.useState<string | null>(null)

  const loadAll = React.useCallback(async () => {
    setLoading(true)
    try {
      const [ownR, srcR] = await Promise.all([
        fetch("/api/v3/works").then((r) => r.json()).catch(() => []),
        fetch("/api/v3/source-ips").then((r) => r.json()).catch(() => []),
      ])
      const own: WorkRow[] = (Array.isArray(ownR) ? ownR : []).map((w: any) => ({
        id: w.id,
        kind: "own",
        code: w.work_code || `#${w.id}`,
        title: w.title || `#${w.id}`,
        title_kana: w.title_kana || undefined,
        sub: `${w.work_type || "—"} / ${w.status || "—"} / 製品 ${w.product_count ?? 0}`,
        is_active: w.is_active !== false,
      }))
      const src: WorkRow[] = (Array.isArray(srcR) ? srcR : []).map((w: any) => ({
        id: w.id,
        kind: "source",
        code: w.source_code || w.work_code || `#${w.id}`,
        title: w.title || `#${w.id}`,
        title_kana: w.title_kana || undefined,
        sub: `権利者: ${w.default_rights_holder || "—"} / 素材 ${w.material_count ?? 0} / 条件 ${w.condition_count ?? 0}`,
        is_active: w.is_active !== false,
      }))
      setRows([...src, ...own])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadAll()
  }, [loadAll])

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter !== "all" && r.kind !== filter) return false
      if (!needle) return true
      return (
        r.title.toLowerCase().includes(needle) ||
        r.code.toLowerCase().includes(needle) ||
        (r.title_kana || "").toLowerCase().includes(needle)
      )
    })
  }, [rows, filter, q])

  const openCreate = (kind: Kind) => {
    setCreateKind(kind)
    setNewTitle("")
    setCreateErr(null)
  }

  const submitCreate = async () => {
    if (!createKind || !newTitle.trim()) return
    setCreating(true)
    setCreateErr(null)
    try {
      const url = createKind === "own" ? "/api/v3/works" : "/api/v3/source-ips"
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const created = await r.json()
      setCreateKind(null)
      if (created?.id) navigate(`/works/${created.id}`)
      else await loadAll()
    } catch (e: any) {
      setCreateErr(`作成に失敗しました（${e?.message || "unknown"}）`)
    } finally {
      setCreating(false)
    }
  }

  const counts = React.useMemo(
    () => ({
      all: rows.length,
      source: rows.filter((r) => r.kind === "source").length,
      own: rows.filter((r) => r.kind === "own").length,
    }),
    [rows]
  )

  return (
    <div className="px-6 py-6 max-w-[1500px] mx-auto space-y-6">
      {/* ヘッダ */}
      <header className="flex items-end justify-between gap-6 border-b border-border pb-5">
        <div>
          <p className="retro-tag mb-1.5">MST · WORKS</p>
          <h2 className="text-2xl font-mono font-bold tracking-tight flex items-center gap-2">
            <Network className="h-5 w-5" />
            作品管理
          </h2>
          <p className="text-xs font-mono text-muted-foreground mt-1.5">
            原作・自社作品・派生を一元管理し、権利フローを 3カードで編集する。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadAll()}>
            <RefreshCw />
            再読込
          </Button>
          <Button size="sm" onClick={() => openCreate("source")}>
            <Plus />
            原作を登録
          </Button>
          <Button size="sm" variant="secondary" onClick={() => openCreate("own")}>
            <Plus />
            自社作品を登録
          </Button>
        </div>
      </header>

      {/* kind フィルタ + 検索 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-[0.14em] rounded-sm border transition-colors",
                filter === f.key
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
              <span className="opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </nav>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="原作名 / コード / カナで検索"
            className="pl-8 font-mono text-xs"
          />
        </div>
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="text-xs font-mono text-muted-foreground py-12 text-center">読み込み中…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Network />}
          title={q || filter !== "all" ? "該当する作品がありません" : "作品がまだありません"}
          description="「原作を登録」または「自社作品を登録」から追加できます。"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => {
            const meta = KIND_META[r.kind]
            const KindIcon = meta.icon
            return (
              <Card
                key={`${r.kind}-${r.id}`}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/works/${r.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    navigate(`/works/${r.id}`)
                  }
                }}
                className="cursor-pointer transition-colors hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <CardContent className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-mono font-bold">
                      {r.code}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className={cn("gap-1", meta.cls)}>
                        <KindIcon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                      {!r.is_active && (
                        <Badge variant="outline" className="border-slate-300 text-slate-500">
                          無効
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="font-mono font-bold text-sm truncate">{r.title}</div>
                  {r.title_kana && (
                    <div className="text-[11px] font-mono text-muted-foreground truncate">{r.title_kana}</div>
                  )}
                  <div className="text-[11px] font-mono text-muted-foreground truncate">{r.sub}</div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 増分⑨: works 未統合の LO- 原作(旧台帳)への導線。データ移行(§8 #4)完了後に撤去予定。 */}
      <p className="text-[11px] font-mono text-muted-foreground/70 pt-2 border-t border-border/60">
        ※ 一覧は正準 works を表示します。works 未統合の LO- 原作は{" "}
        <Link to="/master/ledgers" className="underline hover:text-foreground">
          原作台帳（レガシー）
        </Link>{" "}
        にあります（順次 works へ統合）。
      </p>

      {/* 新規作成ダイアログ（増分④は title のみ。詳細編集はエディタ増分⑤で） */}
      <Dialog open={createKind !== null} onOpenChange={(o) => !o && setCreateKind(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {createKind === "own" ? "自社作品を登録" : "原作を登録"}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">
                タイトル
              </label>
              <Input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTitle.trim()) void submitCreate()
                }}
                placeholder={createKind === "own" ? "例: 〇〇ゲーム" : "例: 原作タイトル"}
                className="font-mono"
              />
              <p className="text-[11px] font-mono text-muted-foreground">
                登録後、3カードエディタが開きます。詳細項目はエディタで編集します。
              </p>
            </div>
            {createErr && (
              <p role="alert" className="text-[11px] font-mono text-red-600">
                {createErr}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateKind(null)} disabled={creating}>
              キャンセル
            </Button>
            <Button size="sm" onClick={() => void submitCreate()} disabled={creating || !newTitle.trim()}>
              {creating ? "作成中…" : "作成して開く"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
