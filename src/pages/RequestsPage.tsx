import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Search, ArrowRight, User, Calendar, Inbox, Plus, GitBranch } from "lucide-react"

import { useAppData, useDocumentSession } from "@/src/context/AppDataContext"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { WorkflowPanel } from "@/src/components/workflow/WorkflowPanel"
import { QuickCreateIssueModal } from "@/src/components/backlog/QuickCreateIssueModal"

export function RequestsPage() {
  const navigate = useNavigate()
  const { issues } = useAppData()
  const { setSelectedIssue, selectedTemplate } = useDocumentSession()
  const [search, setSearch] = React.useState("")
  const [batch, setBatch] = React.useState<string[]>([])
  // Phase 22.6: 口頭/メール起案用のクイック起案 modal
  const [quickCreateOpen, setQuickCreateOpen] = React.useState(false)
  // Phase 22.6.2: 子課題起案時にプリセットする親 issueKey (undefined なら新規起案)
  const [quickCreateParent, setQuickCreateParent] = React.useState<
    string | undefined
  >(undefined)
  // Phase 22.21.54: ステータスフィルタ。null = ALL、それ以外は status.name で絞り込み
  const [statusFilter, setStatusFilter] = React.useState<string | null>(null)

  const openQuickCreate = (parentKey?: string) => {
    setQuickCreateParent(parentKey)
    setQuickCreateOpen(true)
  }

  // Phase 22.21.54: 全 issues からユニークな status を集計。
  //   - ステータス名 / 件数 を sort してチップ表示用に整える
  //   - status が undefined の課題は "未設定" として 1 つのバケットにまとめる
  const statusBuckets = React.useMemo(() => {
    const counter = new Map<string, number>()
    for (const i of issues) {
      const name = String((i as any)?.status?.name || "").trim() || "未設定"
      counter.set(name, (counter.get(name) || 0) + 1)
    }
    // 件数 desc → 名前 asc
    return Array.from(counter.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, "ja"))
  }, [issues])

  const filtered = issues.filter((i) => {
    // テキスト検索
    const q = search.toLowerCase()
    const matchesText =
      i.issueKey.toLowerCase().includes(q) ||
      i.summary.toLowerCase().includes(q)
    if (!matchesText) return false
    // ステータス絞り込み
    if (statusFilter !== null) {
      const sName = String((i as any)?.status?.name || "").trim() || "未設定"
      if (sName !== statusFilter) return false
    }
    return true
  })

  const open = (key: string) => {
    setSelectedIssue(key)
    navigate("/documents/new")
  }

  const toggleBatch = (key: string) => {
    setBatch((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
  }

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto space-y-6">
      <header className="flex items-end justify-between gap-6 border-b border-border pb-5">
        <div>
          <p className="retro-tag mb-1.5">REQ · INDEX</p>
          <h2 className="text-2xl font-mono font-bold tracking-tight">
            Backlog Requests
          </h2>
          <p className="text-xs font-mono text-muted-foreground mt-1.5">
            Real-time index of project-management tickets requiring legal output.
          </p>
          {batch.length > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <Badge variant="default" className="h-5">
                {batch.length} selected
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  // Light-weight batch start: open editor for the first
                  open(batch[0])
                }}
              >
                Open with {selectedTemplate}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBatch([])}>
                Clear
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Phase 22.6: クイック起案ボタン (口頭/メール依頼トリガー) */}
          <Button
            size="sm"
            variant="default"
            onClick={() => openQuickCreate()}
            className="gap-1.5"
            title="口頭/メール依頼を Backlog 課題として登録"
          >
            <Plus className="h-3.5 w-3.5" />
            新規起案
          </Button>
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Filter by key or title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
      </header>

      <QuickCreateIssueModal
        open={quickCreateOpen}
        onOpenChange={(v) => {
          setQuickCreateOpen(v)
          if (!v) setQuickCreateParent(undefined)
        }}
        defaultParentIssueKey={quickCreateParent}
      />

      {/* Phase 22.21.54: ステータスフィルタ chip 群。
          ALL + 各ステータス名(件数) をクリックで絞り込み。選択中は緑塗り。
          0 件のステータスは出さない (= statusBuckets で既に集計済み)。 */}
      {statusBuckets.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono uppercase tracking-[0.16em]">
          <span className="text-muted-foreground">Status:</span>
          <button
            type="button"
            onClick={() => setStatusFilter(null)}
            className={`px-2 py-1 rounded-sm border transition-colors ${
              statusFilter === null
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
            }`}
          >
            ALL <span className="opacity-70">({issues.length})</span>
          </button>
          {statusBuckets.map((b) => {
            const active = statusFilter === b.name
            return (
              <button
                key={`status-${b.name}`}
                type="button"
                onClick={() => setStatusFilter(active ? null : b.name)}
                className={`px-2 py-1 rounded-sm border transition-colors ${
                  active
                    ? "bg-emerald-600 text-white border-emerald-700"
                    : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                }`}
                title={active ? "クリックで解除" : `${b.name} だけ表示`}
              >
                {b.name} <span className="opacity-70">({b.count})</span>
              </button>
            )
          })}
          {statusFilter !== null && (
            <span className="text-muted-foreground">
              → {filtered.length} 件表示中
            </span>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="p-16 text-center border border-dashed border-border rounded-md">
          <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
            No tickets match.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((issue, idx) => {
            const isBatched = batch.includes(issue.issueKey)
            return (
              <Card
                key={`req-${issue.issueKey || idx}`}
                className={`group cursor-pointer transition-all hover:border-foreground hover:shadow-md ${
                  isBatched ? "ring-2 ring-foreground" : ""
                }`}
                onClick={() => open(issue.issueKey)}
              >
                <CardContent className="px-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <Badge variant="outline">{issue.issueKey}</Badge>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleBatch(issue.issueKey)
                      }}
                      className={`h-4 w-4 rounded-sm border ${
                        isBatched
                          ? "bg-foreground border-foreground"
                          : "border-border hover:border-foreground"
                      } transition-colors`}
                      aria-label="Add to batch"
                      title="Add to batch"
                    />
                  </div>
                  <h3 className="text-sm font-mono font-bold leading-snug line-clamp-2">
                    {issue.summary}
                  </h3>
                  <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />{" "}
                      {issue.registeredUser || "system"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />{" "}
                      {new Date().toLocaleDateString("ja-JP")}
                    </span>
                  </div>
                  {/* Phase 18: 行内ステータス変更ドロップダウン。click は
                      stopPropagation で Card 自体の navigate を抑止。
                      Phase 22.6.2: 「+ 子課題」ボタンを追加 (この課題を親として
                      子課題起案モーダルを開く)。 */}
                  <div
                    className="pt-2 border-t border-dashed border-border flex items-center justify-between gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <WorkflowPanel
                      issueKey={issue.issueKey}
                      currentStatus={(issue as any).status}
                      issueTypeName={
                        (issue as any).issueType?.name ||
                        (issue as any).issue_type_name
                      }
                      compact
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openQuickCreate(issue.issueKey)}
                        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors border border-border hover:border-foreground px-1.5 py-0.5 rounded-sm"
                        title={`${issue.issueKey} の子課題を起案`}
                      >
                        <GitBranch className="h-3 w-3" />
                        子課題
                      </button>
                      <button
                        type="button"
                        onClick={() => open(issue.issueKey)}
                        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Open in editor
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
