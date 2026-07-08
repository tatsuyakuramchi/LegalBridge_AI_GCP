import * as React from "react"
import { useNavigate } from "react-router-dom"
import { ShoppingCart, X, GitMerge, Loader2, Crown, Trash2, ExternalLink, FolderPlus, Link2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { IssuePicker } from "@/src/components/IssuePicker"
import { EntitySearchSelect } from "@/src/components/search/EntitySearch"
import { useAppData } from "@/src/context/AppDataContext"
import { useMergeCart } from "@/src/context/MergeCartContext"

// 課題統合カート(フローティングパネル)。AppShell に常駐し、どの画面からでも
//   籠に入れた課題を確認しながら統合できる。
//   - 各行のラジオで「残す課題(統合先)」を選ぶ。それ以外が統合元になる。
//   - パネル内の検索からも課題を追加できる(キー手入力は不要)。
//   - 実行は POST /api/backlog/issues/merge-bulk。失敗した統合元はカートに残す。
export function MergeCartPanel() {
  const navigate = useNavigate()
  const { issues, refreshIssues, showNotification } = useAppData()
  const cart = useMergeCart()

  // パネルの用途: 統合(重複整理) / 案件へ紐づけ(束ねて案件化)。
  const [panelMode, setPanelMode] = React.useState<"merge" | "matter">("merge")
  const [mode, setMode] = React.useState<"child" | "delete">("child")
  const [moveData, setMoveData] = React.useState(true)
  const [reason, setReason] = React.useState("")
  const [merging, setMerging] = React.useState(false)
  // 案件モード: 新規案件名 と 実行中フラグ。
  const [matterTitle, setMatterTitle] = React.useState("")
  const [linking, setLinking] = React.useState(false)

  // 表示はカート投入時のスナップショットより最新の issues を優先する。
  const enriched = cart.items.map((item) => {
    const live = issues.find((i) => i.issueKey === item.issueKey)
    return {
      issueKey: item.issueKey,
      summary: live?.summary ?? item.summary ?? "",
      statusName: live?.status?.name ?? item.statusName ?? "",
    }
  })

  const target = cart.targetKey
  const sources = enriched.filter((i) => i.issueKey !== target)
  const canMerge = !merging && target != null && enriched.length >= 2

  const addable = issues.filter((i) => !cart.has(i.issueKey))

  const doMerge = async () => {
    if (!target || sources.length === 0) return
    if (
      mode === "delete" &&
      !window.confirm(
        `${sources.map((s) => s.issueKey).join(", ")} を Backlog から削除して ${target} に統合します。\nこの操作は元に戻せません。よろしいですか？`
      )
    )
      return
    setMerging(true)
    try {
      const res = await fetch(`/api/backlog/issues/merge-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_key: target,
          source_keys: sources.map((s) => s.issueKey),
          mode,
          move_data: moveData,
          reason: reason.trim() || undefined,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`)
      const failedKeys: string[] = (Array.isArray(d.results) ? d.results : [])
        .filter((r: any) => r && r.ok === false)
        .map((r: any) => String(r.source))
      showNotification?.(
        `${d.merged}/${d.total} 件を ${target} へ統合しました${d.failed ? `（失敗 ${d.failed} 件: ${failedKeys.join(", ")}）` : ""}`,
        d.failed ? "error" : "success"
      )
      if (failedKeys.length > 0) {
        // 失敗した統合元 + 統合先だけ残して再試行できるようにする。
        for (const item of cart.items) {
          if (item.issueKey !== target && !failedKeys.includes(item.issueKey)) cart.remove(item.issueKey)
        }
      } else {
        cart.clear()
        cart.setOpen(false)
        setReason("")
      }
      await refreshIssues?.()
    } catch (e: any) {
      showNotification?.(`統合に失敗しました: ${e?.message || e}`, "error")
    } finally {
      setMerging(false)
    }
  }

  // 案件モード: 👑(target)= 新規案件の「主要課題」。未選択なら先頭を主要課題にする。
  const primaryKey = target ?? enriched[0]?.issueKey ?? null
  const canLinkMatter = !linking && enriched.length >= 1

  // 案件モードに入ったら、主要課題の件名を新規案件名の初期値にする(未入力時のみ)。
  React.useEffect(() => {
    if (panelMode !== "matter") return
    if (matterTitle.trim()) return
    const primarySummary = enriched.find((i) => i.issueKey === primaryKey)?.summary || ""
    if (primarySummary) setMatterTitle(primarySummary)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelMode, primaryKey])

  // カートの1課題を案件へ紐づける(POST /api/matters/:id/issues)。失敗した issueKey を返す。
  const linkIssueToMatter = async (
    matterId: number,
    it: { issueKey: string; summary: string },
    relation: "primary" | "related"
  ): Promise<string | null> => {
    try {
      const res = await fetch(`/api/matters/${matterId}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backlog_issue_key: it.issueKey,
          relation,
          summary_snapshot: it.summary || null,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d?.ok === false) throw new Error(d?.error || `HTTP ${res.status}`)
      return null
    } catch {
      return it.issueKey
    }
  }

  // 新規案件を作成し、カートの全課題を束ねる(主要課題=👑、他=関連)。
  const createMatterFromCart = async () => {
    const title = matterTitle.trim()
    if (!title) {
      showNotification?.("案件名を入力してください", "error")
      return
    }
    if (!primaryKey) return
    setLinking(true)
    try {
      const res = await fetch("/api/matters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, primary_issue_key: primaryKey, status: "open" }),
      })
      const d = await res.json()
      if (!res.ok || !d?.ok) throw new Error(d?.error || "案件の作成に失敗しました")
      const matterId = Number(d.matter.id)
      // 主要課題以外を関連課題として紐づけ。
      const others = enriched.filter((i) => i.issueKey !== primaryKey)
      const failed: string[] = []
      for (const it of others) {
        const f = await linkIssueToMatter(matterId, it, "related")
        if (f) failed.push(f)
      }
      showNotification?.(
        `案件を作成し ${others.length - failed.length + 1}/${enriched.length} 件を束ねました${failed.length ? `（紐づけ失敗 ${failed.length} 件: ${failed.join(", ")}）` : ""}`,
        failed.length ? "error" : "success"
      )
      cart.clear()
      cart.setOpen(false)
      setMatterTitle("")
      navigate(`/matters/${matterId}`)
    } catch (e: any) {
      showNotification?.(`案件の作成に失敗しました: ${e?.message || e}`, "error")
    } finally {
      setLinking(false)
    }
  }

  // 既存案件へカートの全課題を関連課題として紐づける。
  const linkExistingFromCart = async (matterId: number) => {
    if (!matterId || enriched.length === 0) return
    setLinking(true)
    try {
      const failed: string[] = []
      for (const it of enriched) {
        const f = await linkIssueToMatter(matterId, it, "related")
        if (f) failed.push(f)
      }
      showNotification?.(
        `${enriched.length - failed.length}/${enriched.length} 件を既存案件へ紐づけました${failed.length ? `（失敗 ${failed.length} 件: ${failed.join(", ")}）` : ""}`,
        failed.length ? "error" : "success"
      )
      if (failed.length === 0) {
        cart.clear()
        cart.setOpen(false)
      }
      navigate(`/matters/${matterId}`)
    } catch (e: any) {
      showNotification?.(`紐づけに失敗しました: ${e?.message || e}`, "error")
    } finally {
      setLinking(false)
    }
  }

  // カートが空でパネルも閉じているときは何も出さない。
  if (cart.items.length === 0 && !cart.open) return null

  return (
    <>
      {/* フローティングのカートボタン */}
      <button
        type="button"
        onClick={() => cart.setOpen(!cart.open)}
        className={cn(
          // このテーマでは bg-background 等が透過になるため、hsl() を明示して不透明にする。
          "fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border shadow-lg px-4 h-11 font-mono text-[12px] transition-colors",
          cart.open
            ? "bg-[hsl(var(--foreground))] text-[hsl(var(--background))] border-foreground"
            : "bg-[hsl(var(--background))] text-foreground border-border hover:border-foreground"
        )}
        title="統合カートを開く/閉じる"
      >
        <ShoppingCart className="h-4 w-4" />
        統合カート
        {cart.items.length > 0 && (
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold">
            {cart.items.length}
          </span>
        )}
      </button>

      {cart.open && (
        <div className="fixed bottom-[4.5rem] right-5 z-50 w-[420px] max-w-[calc(100vw-2.5rem)] max-h-[72vh] flex flex-col rounded-md border border-border bg-[hsl(var(--card))] shadow-2xl">
          {/* ヘッダ */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
            <GitMerge className="h-4 w-4 text-indigo-700" />
            <span className="text-[12px] font-mono font-bold">統合カート</span>
            <span className="text-[10px] font-mono text-muted-foreground">{cart.items.length} 件</span>
            <div className="flex-1" />
            {cart.items.length > 0 && (
              <button
                type="button"
                onClick={() => cart.clear()}
                className="text-[10px] font-mono text-muted-foreground hover:text-destructive flex items-center gap-1"
                title="カートを空にする"
              >
                <Trash2 className="h-3 w-3" />
                空にする
              </button>
            )}
            <button
              type="button"
              onClick={() => cart.setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              title="閉じる"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {/* 用途トグル: 統合(重複整理) / 案件へ紐づけ(束ねて案件化)。 */}
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border p-0.5 bg-muted/30">
              {([
                { k: "merge", label: "統合", icon: GitMerge },
                { k: "matter", label: "案件へ紐づけ", icon: FolderPlus },
              ] as const).map((t) => {
                const Icon = t.icon
                const active = panelMode === t.k
                return (
                  <button
                    key={t.k}
                    type="button"
                    onClick={() => setPanelMode(t.k)}
                    className={cn(
                      "inline-flex items-center justify-center gap-1.5 rounded-[5px] py-1.5 text-[11px] font-mono font-bold transition-colors",
                      active
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                )
              })}
            </div>

            <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
              {panelMode === "merge" ? (
                <>
                  重複/誤起票の課題を籠に集め、<Crown className="inline h-3 w-3 text-amber-600" /> で「残す課題(統合先)」を選ぶと、他の課題がそこへ統合されます。
                </>
              ) : (
                <>
                  籠に集めた課題を1つの案件に束ねます。<Crown className="inline h-3 w-3 text-amber-600" /> は新規作成時の「主要課題」になります（既存案件へはすべて関連課題として紐づきます）。
                </>
              )}
            </p>

            {/* パネル内からの追加 (キー手入力ではなく検索で) */}
            <IssuePicker
              issues={addable}
              onSelect={(i) => {
                if (i) cart.add({ issueKey: i.issueKey, summary: i.summary, statusName: (i as any)?.status?.name })
              }}
              placeholder="課題を検索してカートに追加 (キー / 件名)"
            />

            {/* カートの中身 */}
            {enriched.length === 0 ? (
              <div className="text-center text-[11px] font-mono text-muted-foreground border border-dashed border-border rounded-sm py-6">
                カートは空です。課題一覧・課題詳細の「カートに入れる」か、上の検索から追加してください。
              </div>
            ) : (
              <div className="space-y-1.5">
                {enriched.map((item) => {
                  const isTarget = item.issueKey === target
                  return (
                    <div
                      key={item.issueKey}
                      className={cn(
                        "flex items-start gap-2 rounded-sm border px-2 py-1.5",
                        isTarget ? "border-amber-400 bg-amber-50/60 dark:bg-amber-950/30" : "border-border"
                      )}
                    >
                      <label
                        className="flex items-center gap-1 pt-0.5 cursor-pointer shrink-0"
                        title="この課題を残す(統合先にする)"
                      >
                        <input
                          type="radio"
                          name="merge-cart-target"
                          className="accent-amber-600"
                          checked={isTarget}
                          onChange={() => cart.setTarget(item.issueKey)}
                        />
                        <Crown className={cn("h-3.5 w-3.5", isTarget ? "text-amber-600" : "text-muted-foreground/40")} />
                      </label>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => navigate(`/issues/${encodeURIComponent(item.issueKey)}`)}
                            className="font-mono text-[11px] font-bold text-sky-700 hover:underline inline-flex items-center gap-0.5"
                            title="課題詳細を開いて中身を確認"
                          >
                            {item.issueKey}
                            <ExternalLink className="h-3 w-3 opacity-60" />
                          </button>
                          {item.statusName && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0">
                              {item.statusName}
                            </Badge>
                          )}
                          {panelMode === "matter" ? (
                            isTarget ? (
                              <span className="text-[9px] font-mono text-amber-700 font-bold">主要課題</span>
                            ) : (
                              <span className="text-[9px] font-mono text-muted-foreground">関連課題として紐づけ</span>
                            )
                          ) : isTarget ? (
                            <span className="text-[9px] font-mono text-amber-700 font-bold">残す(統合先)</span>
                          ) : (
                            <span className="text-[9px] font-mono text-muted-foreground">統合されて{mode === "delete" ? "削除" : "終結"}</span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">{item.summary || "(件名未取得)"}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => cart.remove(item.issueKey)}
                        className="text-muted-foreground hover:text-destructive shrink-0 pt-0.5"
                        title="カートから出す"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {panelMode === "merge" && enriched.length === 1 && (
              <p className="text-[10px] font-mono text-amber-700">
                統合にはもう1件以上必要です。統合相手の課題を追加してください。
              </p>
            )}

            {/* 統合オプション (統合モードのみ) */}
            {panelMode === "merge" && (
              <div className="space-y-2 border-t border-dashed border-border pt-3">
                <div className="space-y-1">
                  <Label className="text-[11px]">統合元(残さない側)の処理</Label>
                  <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as "child" | "delete")}>
                    <option value="child">子課題化＋終結（非破壊・推奨）</option>
                    <option value="delete">Backlog から削除（不可逆）</option>
                  </NativeSelect>
                  <p className="text-[10px] text-muted-foreground">
                    {mode === "delete"
                      ? "統合元は完全に削除されます。統合先にコメントのみ残ります。"
                      : "統合元を統合先の子課題にし「終結」にします。履歴が残ります。"}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-[11px]">
                  <input type="checkbox" checked={moveData} onChange={(e) => setMoveData(e.target.checked)} />
                  紐づく文書・明細を統合先へ引き継ぐ（推奨）
                </label>
                <div className="space-y-1">
                  <Label className="text-[11px]">理由（任意）</Label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="重複起票のため 等" />
                </div>
              </div>
            )}

            {/* 案件へ紐づけ (案件モードのみ): 既存案件検索。新規作成はフッタで。 */}
            {panelMode === "matter" && (
              <div className="space-y-2 border-t border-dashed border-border pt-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold">
                    <Link2 className="h-3.5 w-3.5 text-sky-600" />
                    既存案件へ紐づけ
                  </div>
                  <EntitySearchSelect
                    entity="matter"
                    onSelect={(o) => {
                      if (o && canLinkMatter) void linkExistingFromCart(Number(o.id))
                    }}
                    placeholder="案件を検索して選ぶと即紐づけ"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    選択すると、カートの {enriched.length} 件すべてを関連課題としてその案件に束ねます。
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* フッタ: モード別の実行 */}
          <div className="border-t border-border px-3 py-2.5 space-y-2">
            {panelMode === "merge" ? (
              <>
                {canMerge && (
                  <p className="text-[10px] font-mono text-muted-foreground break-all leading-relaxed">
                    {sources.map((s) => s.issueKey).join(", ")} → <span className="font-bold text-amber-700">{target}</span> へ統合
                  </p>
                )}
                <Button size="sm" className="w-full gap-1.5" disabled={!canMerge} onClick={doMerge}>
                  {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
                  {merging ? "統合中…" : `統合を実行（${sources.length} 件 → ${target || "未選択"}）`}
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">新規案件名（主要課題: {primaryKey || "—"}）</Label>
                  <Input
                    value={matterTitle}
                    onChange={(e) => setMatterTitle(e.target.value)}
                    placeholder="例: 株式会社〇〇 ライセンス案件"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canLinkMatter) {
                        e.preventDefault()
                        void createMatterFromCart()
                      }
                    }}
                  />
                </div>
                <Button
                  size="sm"
                  className="w-full gap-1.5"
                  disabled={!canLinkMatter || !matterTitle.trim()}
                  onClick={() => void createMatterFromCart()}
                >
                  {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
                  {linking ? "処理中…" : `新規案件を作成して束ねる（${enriched.length} 件）`}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
