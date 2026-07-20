import * as React from "react"
import { useNavigate } from "react-router-dom"
import { FolderKanban, X, GitMerge, Loader2, Crown, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { useMatterMergeCart } from "@/src/context/MatterMergeCartContext"
import { matterClient } from "@/src/lib/api/matterClient"

// 案件統合カート(フローティングパネル)。AppShell に常駐し、どの画面からでも
//   籠に入れた案件を確認しながら統合できる。
//   - 各行のラジオで「残す案件(統合先)」を選ぶ。それ以外が統合元になる。
//   - 実行は 統合元ごとに POST /api/matters/:target/absorb を順に呼ぶ。
//     課題/タスク/文書/ファイル/送信履歴/Drive フォルダを統合先へ移し、統合元は削除。
export function MatterMergeCartPanel() {
  const navigate = useNavigate()
  const { push } = useToast()
  const cart = useMatterMergeCart()
  const [merging, setMerging] = React.useState(false)

  const target = cart.targetId
  const sources = cart.items.filter((i) => i.id !== target)
  const canMerge = !merging && target != null && cart.items.length >= 2

  const label = (m: { matter_code?: string | null; title?: string | null }) =>
    m.matter_code || m.title || "(無題)"

  const doMerge = async () => {
    if (target == null || sources.length === 0) return
    const targetItem = cart.items.find((i) => i.id === target)
    if (
      !window.confirm(
        `${sources.length} 件の案件を「${label(targetItem || {})}」へ統合します。\n\n` +
          `各統合元の 課題・タスク・文書・ファイル・送信履歴 を統合先へ移し、` +
          `Drive 案件フォルダは統合先フォルダ配下へ移動（統合先にフォルダが無ければ引き継ぎ）します。\n` +
          `統合元 ${sources.length} 件は削除されます。この操作は元に戻せません。\n\n` +
          `よろしいですか？`
      )
    ) {
      return
    }
    setMerging(true)
    const acc = { issues: 0, tasks: 0, documents: 0, files: 0 }
    let foldersMoved = 0
    let foldersAdopted = 0
    let foldersFailed = 0
    const failedIds: number[] = []
    try {
      // 統合元を1件ずつ統合先へ吸収する(絞り込み衝突を避けるため直列)。
      for (const src of sources) {
        try {
          const json: any = await matterClient.absorb(target, { fromMatterId: src.id })
          const mv = json?.moved || {}
          acc.issues += mv.issues || 0
          acc.tasks += mv.tasks || 0
          acc.documents += mv.documents || 0
          acc.files += mv.files || 0
          if (json?.folder?.action === "moved") foldersMoved++
          else if (json?.folder?.action === "adopted") foldersAdopted++
          else if (json?.folder?.action === "failed") foldersFailed++
        } catch (e: any) {
          console.warn("[matter-merge-cart] absorb failed:", src.id, e?.message || e)
          failedIds.push(src.id)
        }
      }

      const okCount = sources.length - failedIds.length
      const parts = [
        acc.issues ? `課題${acc.issues}` : "",
        acc.tasks ? `タスク${acc.tasks}` : "",
        acc.documents ? `文書${acc.documents}` : "",
        acc.files ? `ファイル${acc.files}` : "",
      ].filter(Boolean)
      const folderBits = [
        foldersMoved ? `移動${foldersMoved}` : "",
        foldersAdopted ? `引き継ぎ${foldersAdopted}` : "",
        foldersFailed ? `失敗${foldersFailed}` : "",
      ].filter(Boolean)
      const msg =
        `${okCount}/${sources.length} 件を統合しました` +
        (parts.length ? `（${parts.join("・")}）` : "") +
        (folderBits.length ? ` / Driveフォルダ: ${folderBits.join("・")}` : "") +
        (failedIds.length ? `（統合失敗 ${failedIds.length} 件: #${failedIds.join(", #")}）` : "")
      push(msg, failedIds.length || foldersFailed ? "error" : "success")

      // 成功した統合元をカートから外し、統合先だけ残す。全成功ならカートを空に。
      if (failedIds.length === 0) {
        cart.clear()
        navigate(`/matters/${target}`)
      } else {
        for (const src of sources) if (!failedIds.includes(src.id)) cart.remove(src.id)
      }
    } finally {
      setMerging(false)
    }
  }

  // カートが空でパネルも閉じているときは何も出さない。
  if (cart.items.length === 0 && !cart.open) return null

  return (
    <>
      {/* フローティングのカートボタン(課題カートの左隣に並べる) */}
      <button
        type="button"
        onClick={() => cart.setOpen(!cart.open)}
        className={cn(
          "fixed bottom-5 right-[12.5rem] z-40 flex items-center gap-2 rounded-full border shadow-lg px-4 h-11 font-mono text-[12px] transition-colors",
          cart.open
            ? "bg-[hsl(var(--foreground))] text-[hsl(var(--background))] border-foreground"
            : "bg-[hsl(var(--background))] text-foreground border-border hover:border-foreground"
        )}
        title="案件統合カートを開く/閉じる"
      >
        <FolderKanban className="h-4 w-4" />
        案件統合
        {cart.items.length > 0 && (
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-primary text-white text-[10px] font-bold">
            {cart.items.length}
          </span>
        )}
      </button>

      {cart.open && (
        <div className="fixed bottom-[4.5rem] right-[12.5rem] z-50 w-[420px] max-w-[calc(100vw-2.5rem)] max-h-[72vh] flex flex-col rounded-md border border-border bg-[hsl(var(--card))] shadow-2xl">
          {/* ヘッダ */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
            <GitMerge className="h-4 w-4 text-primary" />
            <span className="text-[12px] font-mono font-bold">案件統合カート</span>
            <span className="text-[10px] text-muted-foreground">{cart.items.length} 件</span>
            <div className="flex-1" />
            {cart.items.length > 0 && (
              <button
                type="button"
                onClick={() => cart.clear()}
                className="text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-1"
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
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              重複案件を籠に集め、<Crown className="inline h-3 w-3 text-warning" /> で「残す案件(統合先)」を選ぶと、
              他の案件の 課題・タスク・文書・ファイル・送信履歴・Drive フォルダ がそこへ移り、統合元は削除されます。
            </p>

            {/* カートの中身 */}
            {cart.items.length === 0 ? (
              <div className="text-center text-[11px] text-muted-foreground border border-dashed border-border rounded-sm py-6">
                カートは空です。案件一覧・案件詳細の「統合カートに追加」から入れてください。
              </div>
            ) : (
              <div className="space-y-1.5">
                {cart.items.map((item) => {
                  const isTarget = item.id === target
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-start gap-2 rounded-sm border px-2 py-1.5",
                        isTarget ? "border-warning bg-warning/10 dark:bg-warning" : "border-border"
                      )}
                    >
                      <label
                        className="flex items-center gap-1 pt-0.5 cursor-pointer shrink-0"
                        title="この案件を残す(統合先にする)"
                      >
                        <input
                          type="radio"
                          name="matter-merge-cart-target"
                          className="accent-amber-600"
                          checked={isTarget}
                          onChange={() => cart.setTarget(item.id)}
                        />
                        {isTarget && <Crown className="h-3 w-3 text-warning" />}
                      </label>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-mono font-bold truncate">
                            {item.matter_code || `#${item.id}`}
                          </span>
                          {isTarget && (
                            <span className="text-[9px] font-mono text-warning shrink-0">統合先(残す)</span>
                          )}
                        </div>
                        <div className="text-[11px] truncate">{item.title || "(無題)"}</div>
                        {item.counterparty && (
                          <div className="text-[10px] text-muted-foreground truncate">{item.counterparty}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => cart.remove(item.id)}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        title="カートから外す"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* フッタ: 実行 */}
          <div className="border-t border-border px-3 py-2.5 space-y-2">
            <div className="text-[10px] text-muted-foreground">
              統合元 {sources.length} 件 → 統合先{" "}
              {target != null ? (
                <span className="text-foreground font-bold">
                  {label(cart.items.find((i) => i.id === target) || {})}
                </span>
              ) : (
                <span className="text-destructive">未選択</span>
              )}
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={!canMerge}
              onClick={doMerge}
            >
              {merging ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <GitMerge className="h-3.5 w-3.5 mr-1" />
              )}
              {sources.length} 件を統合先へ取り込む
            </Button>
            {target != null && cart.items.length < 2 && (
              <p className="text-[10px] text-muted-foreground">統合するには 2 件以上をカートに入れてください。</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
