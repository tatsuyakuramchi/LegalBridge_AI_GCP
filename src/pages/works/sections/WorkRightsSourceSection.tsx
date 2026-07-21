/**
 * ④ 権利根源 — 原作 / 調達（支払）。8タブ移行 Phase 6。
 *   旧 WorkGraphPanel 左カード（支払エッジ upstream ＋「原作を新規」）を移設。
 *   API 呼び方・結線ロジックは context 経由で不変（§20）。
 */
import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/EmptyState"
import { useWorkDetail } from "@/src/pages/works/WorkDetailContext"
import { EdgeRow } from "./shared"

export const WorkRightsSourceSection: React.FC = () => {
  const {
    work, upstream, isSource, materials, products, sourceWorks, linkEdge,
    showNewSource, setShowNewSource, newSourceTitle, setNewSourceTitle, creatingSource, createSource,
  } = useWorkDetail()

  if (!work) return <EmptyState title="作品を選択してください" />

  return (
    <Card>
      <CardContent className="px-3.5 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-mono font-bold">原作 / 調達（支払）▶</h3>
          <Badge variant="outline" className="border-warning/40 text-warning">支払 {upstream.length}</Badge>
        </div>
        {/* 原作をその場で新規登録 → 候補一覧に追加し各支払エッジで選択可に */}
        {!isSource && (
          <div className="border-b border-border/60 pb-2">
            {!showNewSource ? (
              <button
                type="button"
                onClick={() => setShowNewSource(true)}
                className="text-[11px] font-mono px-2 py-0.5 rounded border border-success text-success hover:bg-success/10"
              >
                ＋ 原作を新規
              </button>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input
                    value={newSourceTitle}
                    onChange={(e) => setNewSourceTitle(e.target.value)}
                    placeholder="原作タイトル *"
                    autoFocus
                    className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
                  />
                  <button
                    type="button"
                    onClick={createSource}
                    disabled={creatingSource || !newSourceTitle.trim()}
                    className="text-[11px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-50"
                  >
                    {creatingSource ? "作成中…" : "作成"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowNewSource(false); setNewSourceTitle("") }}
                    className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                  >
                    取消
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground/70">
                  作成後、各支払エッジの「原作に紐付け」から選べます（LO- 採番）。
                </p>
              </div>
            )}
          </div>
        )}
        {upstream.length === 0 ? (
          <p className="text-[11px] text-muted-foreground py-1">支払エッジはありません。</p>
        ) : (
          upstream.map((e) => (
            <React.Fragment key={e.id}>
              <EdgeRow e={e} side="up" materials={materials} products={products} sourceWorks={sourceWorks} onLink={linkEdge} />
            </React.Fragment>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export default WorkRightsSourceSection
