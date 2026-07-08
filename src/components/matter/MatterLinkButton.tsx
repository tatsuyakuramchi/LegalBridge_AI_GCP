/**
 * MatterLinkButton — 依頼(Backlog課題)から案件(Matter)を「作成」または「既存へ紐づけ」する導線。
 *
 * 動線: 依頼を確認 → その場で案件化(この依頼を主要課題に) / 既存案件へ束ねる。
 *   - linkedMatter が渡されていれば(＝この依頼が既に案件の主要課題)、案件を開くピルを表示。
 *   - それ以外は「案件へ」ボタン → モーダルで [新規作成] / [既存へ紐づけ] を選ぶ。
 *
 * API(いずれも既存):
 *   - 新規作成 : POST /api/matters                 { title, primary_issue_key, status }
 *   - 既存紐づけ: POST /api/matters/:id/issues      { backlog_issue_key, relation, summary_snapshot }
 *   - 既存案件検索: EntitySearchSelect entity="matter" (GET /api/matters)
 */
import * as React from "react"
import { useNavigate } from "react-router-dom"
import { FolderKanban, FolderPlus, Link2, Loader2, ArrowUpRight } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"
import { EntitySearchSelect } from "@/src/components/search/EntitySearch"

export type LinkedMatter = {
  id: number
  matter_code?: string | null
  title?: string | null
} | null

export function MatterLinkButton({
  issueKey,
  summary,
  linkedMatter,
  onChanged,
  className,
}: {
  issueKey: string
  summary: string
  linkedMatter?: LinkedMatter
  onChanged?: () => void
  className?: string
}) {
  const navigate = useNavigate()
  const { push } = useToast()
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState(summary || "")
  const [saving, setSaving] = React.useState(false)

  // モーダルを開くたびに案件名の初期値を依頼件名に戻す。
  React.useEffect(() => {
    if (open) setTitle(summary || "")
  }, [open, summary])

  // 既に主要課題として案件に紐づいている依頼は「案件を開く」ピルにする。
  if (linkedMatter) {
    return (
      <button
        type="button"
        onClick={() => navigate(`/matters/${linkedMatter.id}`)}
        className={
          "inline-flex items-center gap-1 text-[11px] font-mono transition-colors border px-2 py-1 rounded-md border-sky-600 text-sky-700 bg-sky-500/10 hover:bg-sky-500/20 " +
          (className || "")
        }
        title={`案件 ${linkedMatter.matter_code || `#${linkedMatter.id}`} を開く`}
      >
        <FolderKanban className="h-3 w-3" />
        {linkedMatter.matter_code || "案件"}
        <ArrowUpRight className="h-3 w-3" />
      </button>
    )
  }

  async function createMatter() {
    const t = title.trim()
    if (!t) {
      push("案件名を入力してください", "error")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/matters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t,
          primary_issue_key: issueKey,
          status: "open",
        }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || "作成に失敗しました")
      push("案件を作成しました", "success")
      setOpen(false)
      onChanged?.()
      navigate(`/matters/${json.matter.id}`)
    } catch (e: any) {
      push(String(e?.message || e), "error")
    } finally {
      setSaving(false)
    }
  }

  async function linkExisting(matterId: number) {
    setSaving(true)
    try {
      const res = await fetch(`/api/matters/${matterId}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backlog_issue_key: issueKey,
          relation: "related",
          summary_snapshot: summary || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok === false) throw new Error(json?.error || "紐づけに失敗しました")
      push("既存案件へ紐づけました", "success")
      setOpen(false)
      onChanged?.()
      navigate(`/matters/${matterId}`)
    } catch (e: any) {
      push(String(e?.message || e), "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          "inline-flex items-center gap-1 text-[11px] font-mono transition-colors border px-2 py-1 rounded-md border-border text-muted-foreground hover:text-foreground hover:border-foreground " +
          (className || "")
        }
        title="この依頼から案件を作成 / 既存案件へ紐づけ"
      >
        <FolderPlus className="h-3 w-3" />
        案件へ
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-mono text-[15px]">案件へ — {issueKey}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* 1) この依頼から新規案件を作成(この依頼を主要課題に) */}
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center gap-1.5 text-[12px] font-mono font-bold">
                <FolderPlus className="h-3.5 w-3.5 text-emerald-600" />
                新規案件を作成（この依頼を主要課題に）
              </div>
              <div className="space-y-1">
                <Label className="text-[12px]">案件名 *</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例: 株式会社〇〇 ライセンス案件"
                  className="h-8 text-[12px]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      void createMatter()
                    }
                  }}
                />
                <p className="text-[10px] font-mono text-muted-foreground/70">
                  依頼「{summary || issueKey}」を主要課題として新しい案件を作成します。
                </p>
              </div>
              <Button size="sm" onClick={() => void createMatter()} disabled={saving} className="gap-1.5">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                案件を作成して開く
              </Button>
            </div>

            <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              または
              <span className="h-px flex-1 bg-border" />
            </div>

            {/* 2) 既存案件へ紐づけ */}
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center gap-1.5 text-[12px] font-mono font-bold">
                <Link2 className="h-3.5 w-3.5 text-sky-600" />
                既存案件へ紐づけ
              </div>
              <div className="space-y-1">
                <Label className="text-[12px]">案件を検索（コード / 案件名）</Label>
                <EntitySearchSelect
                  entity="matter"
                  onSelect={(o) => {
                    if (o) void linkExisting(Number(o.id))
                  }}
                  placeholder="案件を検索して選ぶと即紐づけ"
                />
                <p className="text-[10px] font-mono text-muted-foreground/70">
                  選択すると、この依頼を関連課題としてその案件に束ねます。
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              キャンセル
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
