import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Search, ArrowRight, User, Calendar, Inbox, Plus, GitBranch, FileText, GitMerge, ShoppingCart } from "lucide-react"

import { useAppData, useDocumentSession } from "@/src/context/AppDataContext"
import {
  extractRequesterSlackId,
  findStaffBySlackId,
} from "@/src/lib/slackRequester"
import { useMergeCart } from "@/src/context/MergeCartContext"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { WorkflowPanel } from "@/src/components/workflow/WorkflowPanel"
import { QuickCreateIssueModal } from "@/src/components/backlog/QuickCreateIssueModal"
import { MatterLinkButton, type LinkedMatter } from "@/src/components/matter/MatterLinkButton"
import { TERMINAL_OFF_FLOW } from "@/src/lib/statusFlow"

// 完了/終結/キャンセル を「クローズ済み」とみなす。デフォルトで一覧から隠す。
const DONE_STATUSES = new Set<string>(["完了", ...TERMINAL_OFF_FLOW])
const statusNameOf = (i: any) =>
  String(i?.status?.name || "").trim() || "未設定"

export function RequestsPage() {
  const navigate = useNavigate()
  const { issues, staffList } = useAppData()
  const { setSelectedIssue, selectedTemplate } = useDocumentSession()
  // 課題統合カート(籠に集めて統合先を選ぶ)。実行は MergeCartPanel 側。
  const mergeCart = useMergeCart()
  const [search, setSearch] = React.useState("")
  const [batch, setBatch] = React.useState<string[]>([])
  const cartItemOf = (i: (typeof issues)[number]) => ({
    issueKey: i.issueKey,
    summary: i.summary,
    statusName: i.status?.name,
  })
  // Phase 22.6: 口頭/メール起案用のクイック起案 modal
  const [quickCreateOpen, setQuickCreateOpen] = React.useState(false)
  // Phase 22.6.2: 子課題起案時にプリセットする親 issueKey (undefined なら新規起案)
  const [quickCreateParent, setQuickCreateParent] = React.useState<
    string | undefined
  >(undefined)
  // Phase 22.21.54: ステータスフィルタ。null = ALL、それ以外は status.name で絞り込み
  const [statusFilter, setStatusFilter] = React.useState<string | null>(null)
  // 完了/終結/キャンセル をデフォルトで非表示にする。
  //   ステータスチップで明示選択したときは、その絞り込みを優先して表示する。
  const [hideDone, setHideDone] = React.useState(true)

  // 依頼 → 案件の紐づけ状況。案件一覧(GET /api/matters)を1回読み、
  //   primary_issue_key で「この依頼が主要課題の案件」を引けるマップにする。
  //   これにより案件化済みの依頼カードは「案件を開く」ピルを表示できる。
  const [matterByIssue, setMatterByIssue] = React.useState<Map<string, LinkedMatter>>(new Map())
  const refreshMatters = React.useCallback(async () => {
    try {
      const res = await fetch("/api/matters")
      const json = await res.json()
      const rows: any[] = Array.isArray(json)
        ? json
        : json?.matters || json?.rows || json?.items || json?.data || []
      const map = new Map<string, LinkedMatter>()
      for (const m of rows) {
        if (m?.primary_issue_key) {
          map.set(String(m.primary_issue_key), {
            id: Number(m.id),
            matter_code: m.matter_code ?? null,
            title: m.title ?? null,
          })
        }
      }
      setMatterByIssue(map)
    } catch {
      /* 案件一覧の取得失敗は致命的でない(ボタンは新規作成モードで動作) */
    }
  }, [])
  React.useEffect(() => {
    void refreshMatters()
  }, [refreshMatters])

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
      if (statusNameOf(i) !== statusFilter) return false
    } else if (hideDone && DONE_STATUSES.has(statusNameOf(i))) {
      // ALL 表示中はクローズ済み (完了/終結/キャンセル) を既定で隠す。
      return false
    }
    return true
  })

  // データ構造刷新 Phase A: 文書作成画面へ直行せず、課題詳細ページへ遷移する。
  //   (課題で作った文書一覧・進捗をまず見られるようにする)
  const open = (key: string) => {
    navigate(`/issues/${encodeURIComponent(key)}`)
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
          <p className="retro-tag mb-1.5">REQ · 一覧</p>
          <h2 className="text-2xl font-mono font-bold tracking-tight">
            依頼一覧（Backlog）
          </h2>
          <p className="text-[13px] font-mono text-muted-foreground mt-1.5">
            法務対応が必要な依頼をリアルタイムに一覧表示します。
          </p>
          {batch.length > 0 && (
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <Badge variant="default" className="h-6 px-2.5">
                {batch.length} 件選択
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  // 先頭の課題を開く(簡易一括)
                  open(batch[0])
                }}
              >
                先頭を開く
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  mergeCart.addMany(
                    batch
                      .map((k) => issues.find((i) => i.issueKey === k))
                      .filter((i): i is NonNullable<typeof i> => i != null)
                      .map(cartItemOf),
                    { openPanel: true }
                  )
                  setBatch([])
                }}
                className="gap-1.5"
                title="選択した課題を統合カートに入れて、統合先を選んで統合する"
              >
                <GitMerge className="h-3.5 w-3.5" />
                統合カートへ
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBatch([])}>
                クリア
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
              placeholder="キー / 件名 で検索…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          {/* 完了/終結/キャンセル の表示切替 (デフォルト: 非表示) */}
          <label
            className="flex items-center gap-1.5 text-[12px] font-mono text-muted-foreground hover:text-foreground cursor-pointer select-none"
            title="完了・終結・キャンセルの課題を一覧に含めるか"
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-foreground cursor-pointer"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
            />
            完了を隠す
          </label>
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
        <div className="flex items-center gap-2 flex-wrap text-[12px] font-mono">
          <span className="text-muted-foreground">ステータス:</span>
          <button
            type="button"
            onClick={() => setStatusFilter(null)}
            className={`px-2 py-1 rounded-sm border transition-colors ${
              statusFilter === null
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
            }`}
          >
            ALL{" "}
            <span className="opacity-70">
              ({hideDone
                ? issues.filter((i) => !DONE_STATUSES.has(statusNameOf(i))).length
                : issues.length})
            </span>
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
        <div className="p-16 text-center border border-dashed border-border rounded-xl">
          <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-[13px] font-mono text-muted-foreground">
            該当する依頼はありません。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((issue, idx) => {
            const isBatched = batch.includes(issue.issueKey)
            // Slack 起案課題は本文の「依頼者: <@U…>」をスタッフマスタで
            // 名前に解決して表示する (Slack ID のままでは誰か分からないため)。
            const requesterSlackId = extractRequesterSlackId(issue.description)
            const requesterStaff = findStaffBySlackId(staffList, requesterSlackId)
            const requesterName =
              requesterStaff?.staff_name ||
              requesterSlackId ||
              issue.registeredUser ||
              "system"
            return (
              <Card
                key={`req-${issue.issueKey || idx}`}
                className={`group cursor-pointer transition-colors hover:border-foreground/50 hover:bg-muted/30 ${
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
                      aria-label="一括選択に追加"
                      title="一括選択に追加"
                    />
                  </div>
                  <h3 className="text-sm font-mono font-bold leading-snug line-clamp-2">
                    {issue.summary}
                  </h3>
                  <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
                    <span
                      className="flex items-center gap-1"
                      title={requesterStaff?.email || requesterSlackId || undefined}
                    >
                      <User className="h-3 w-3" /> {requesterName}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />{" "}
                      {new Date().toLocaleDateString("ja-JP")}
                    </span>
                    {/* データ構造刷新 Phase A-3: 文書件数 (Dashboard と同じデータ源) */}
                    {typeof issue.documentCount === "number" &&
                      issue.documentCount > 0 && (
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" /> {issue.documentCount}
                        </span>
                      )}
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
                      {/* 統合カートへの投入/取出し。籠に集めてから統合先を選ぶ。 */}
                      <button
                        type="button"
                        onClick={() =>
                          mergeCart.has(issue.issueKey)
                            ? mergeCart.remove(issue.issueKey)
                            : mergeCart.add(cartItemOf(issue))
                        }
                        className={`inline-flex items-center gap-1 text-[11px] font-mono transition-colors border px-2 py-1 rounded-md ${
                          mergeCart.has(issue.issueKey)
                            ? "border-emerald-600 text-emerald-700 bg-emerald-500/10 hover:bg-emerald-500/20"
                            : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"
                        }`}
                        title={
                          mergeCart.has(issue.issueKey)
                            ? "統合カートから出す"
                            : "統合カートに入れる(重複課題を集めて統合)"
                        }
                      >
                        <ShoppingCart className="h-3 w-3" />
                        {mergeCart.has(issue.issueKey) ? "カート済" : "カート"}
                      </button>
                      {/* 依頼 → 案件: この依頼から案件を作成 / 既存案件へ紐づけ。
                          既に主要課題の案件があれば「案件を開く」ピルになる。 */}
                      <MatterLinkButton
                        issueKey={issue.issueKey}
                        summary={issue.summary}
                        linkedMatter={matterByIssue.get(issue.issueKey) ?? null}
                        onChanged={() => void refreshMatters()}
                      />
                      <button
                        type="button"
                        onClick={() => openQuickCreate(issue.issueKey)}
                        className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors border border-border hover:border-foreground px-2 py-1 rounded-md"
                        title={`${issue.issueKey} の子課題を起案`}
                      >
                        <GitBranch className="h-3 w-3" />
                        子課題
                      </button>
                      <button
                        type="button"
                        onClick={() => open(issue.issueKey)}
                        className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-foreground/80 hover:text-foreground transition-colors"
                      >
                        開く
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
