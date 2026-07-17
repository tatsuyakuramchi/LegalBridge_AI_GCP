import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  FolderKanban,
  Loader2,
  RefreshCw,
  Search,
  Plus,
  ChevronRight,
  FileText,
  ListChecks,
  Layers,
  AlertTriangle,
} from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { useToast } from "@/components/ui/toast"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { useAppData } from "@/src/context/AppDataContext"
import { VendorSearchSelect } from "@/src/components/document/VendorSearchSelect"
import { IssuePicker } from "@/src/components/IssuePicker"
import { STAGE_LABEL } from "@/src/components/matter/matterStages"
import { matterClient } from "@/src/lib/api/matterClient"

// 案件管理 一覧。1行 = 1案件。Backlog課題(重複/部分)・文書・送信・条件明細を束ねる。
//   API: GET /api/matters (matter_overview_v)。詳細は /matters/:id。
//   LB-06 (§5.2): 件数中心から作業中心へ。現在工程 / 次アクション / 担当 / 期限 /
//   ブロッカーを表示し、一覧から「次に何をすべき案件か」を判断できるようにする。
type MatterRow = {
  id: number
  matter_code: string | null
  title: string
  status: string
  counterparty: string | null
  primary_issue_key: string | null
  issue_count: number
  document_count: number
  condition_count: number
  last_sent_at: string | null
  updated_at: string | null
  // LB-04/05/06 (migration 0126, matter_overview_v 拡張列)
  lifecycle_stage: string | null
  owner_name: string | null
  target_due_date: string | null
  blocked_reason: string | null
  next_task_title: string | null
  next_task_due_at: string | null
  next_task_assignee_name: string | null
  open_task_count: number
}

const STATUS_LABEL: Record<string, string> = {
  open: "未着手",
  in_progress: "進行中",
  closed: "完了",
  archived: "アーカイブ",
}
const STATUS_VARIANT: Record<string, any> = {
  open: "secondary",
  in_progress: "info",
  closed: "success",
  archived: "outline",
}
const fmtShortDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) : "—"
// 期限超過: 未完了(closed/archived 以外)かつ期限が今日より前。
const isOverdue = (m: MatterRow) =>
  !!m.target_due_date &&
  !["closed", "archived"].includes(m.status) &&
  new Date(m.target_due_date).setHours(23, 59, 59, 999) < Date.now()

export function MattersListPage() {
  const navigate = useNavigate()
  const { push } = useToast()
  const { vendors, issues } = useAppData()
  const [rows, setRows] = React.useState<MatterRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [q, setQ] = React.useState("")
  const [status, setStatus] = React.useState("")
  const [openCreate, setOpenCreate] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({
    title: "",
    counterparty: "",
    vendor_id: null as number | null,
    vendor_code: "",
    primary_issue_key: "",
    status: "open",
  })

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const json: any = await matterClient.list({ status, q: q.trim() })
      setRows(Array.isArray(json?.matters) ? json.matters : [])
    } catch (e) {
      push("案件一覧の取得に失敗しました", "error")
    } finally {
      setLoading(false)
    }
  }, [q, status, push])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  async function createMatter() {
    if (!form.title.trim()) {
      push("案件名は必須です", "error")
      return
    }
    setSaving(true)
    try {
      const json: any = await matterClient.create(form)
      push("案件を作成しました", "success")
      setOpenCreate(false)
      setForm({ title: "", counterparty: "", vendor_id: null, vendor_code: "", primary_issue_key: "", status: "open" })
      navigate(`/matters/${json.matter.id}`)
    } catch (e: any) {
      push(String(e?.message || e), "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto space-y-5">
      {/* Header */}
      <header className="flex items-end justify-between gap-6 border-b border-border pb-5">
        <div>
          <p className="retro-tag mb-1.5">MAT · 一覧</p>
          <h2 className="text-2xl font-mono font-bold tracking-tight flex items-center gap-2">
            <FolderKanban className="h-6 w-6 text-muted-foreground" /> 案件管理
          </h2>
          <p className="text-[13px] font-mono text-muted-foreground mt-1.5">
            重複・部分発生した Backlog 課題を1案件に束ね、文書・送信履歴・条件明細を総合管理します。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading} title="更新">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1">更新</span>
          </Button>
          <Button size="sm" onClick={() => setOpenCreate(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> 新規案件
          </Button>
        </div>
      </header>

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && refresh()}
            placeholder="案件名 / コード / 相手方 / 代表課題で検索"
            className="pl-8 h-8 text-[12px]"
          />
        </div>
        <NativeSelect
          value={status}
          onChange={(e: any) => setStatus(e.target.value)}
          className="h-8 text-[12px] w-32"
        >
          <option value="">全ステータス</option>
          <option value="open">未着手</option>
          <option value="in_progress">進行中</option>
          <option value="closed">完了</option>
          <option value="archived">アーカイブ</option>
        </NativeSelect>
        <span className="text-[11px] text-muted-foreground">{rows.length} 件</span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {/* LB-06 (§5.2): 作業中心の列構成。
              案件/相手方 | 現在工程(+ブロッカー) | 次アクション | 担当 | 期限 | 文書等 | 更新 */}
          <div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_92px_minmax(0,1fr)_72px_64px_90px_56px_20px] gap-2 px-3 py-2.5 border-b border-border text-[11px] font-mono font-bold text-muted-foreground">
            <span>案件 / 相手方</span>
            <span>工程</span>
            <span>次アクション</span>
            <span>担当</span>
            <span className="text-center">期限</span>
            <span className="text-center">課題/文書/条件</span>
            <span className="text-center">更新</span>
            <span />
          </div>
          {loading ? (
            <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" />読み込み中…
            </div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">
              案件がありません。「新規案件」から作成してください。
            </div>
          ) : (
            rows.map((m) => (
              <button
                key={m.id}
                onClick={() => navigate(`/matters/${m.id}`)}
                className="grid grid-cols-1 md:grid-cols-[minmax(0,1.3fr)_92px_minmax(0,1fr)_72px_64px_90px_56px_20px] gap-y-1 md:gap-2 px-3 py-2.5 border-b border-border/60 items-center text-left hover:bg-muted/40 transition-colors w-full"
              >
                {/* 案件 / 相手方 */}
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">{m.matter_code || `#${m.id}`}</span>
                    <Badge variant={STATUS_VARIANT[m.status] || "secondary"} className="text-[10px]">
                      {STATUS_LABEL[m.status] || m.status}
                    </Badge>
                  </span>
                  <span className="block text-[13px] font-medium truncate mt-0.5">{m.title}</span>
                  {m.counterparty && (
                    <span className="block text-[11px] text-muted-foreground truncate">{m.counterparty}</span>
                  )}
                </span>
                {/* 現在工程 + ブロッカー */}
                <span className="min-w-0">
                  <span className="block text-[12px] font-mono truncate">
                    {m.lifecycle_stage ? STAGE_LABEL[m.lifecycle_stage] || m.lifecycle_stage : "—"}
                  </span>
                  {m.blocked_reason && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-destructive"
                      title={`ブロッカー: ${m.blocked_reason}`}
                    >
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span className="truncate max-w-[70px]">{m.blocked_reason}</span>
                    </span>
                  )}
                </span>
                {/* 次アクション(primary の未完了タスク) */}
                <span className="min-w-0">
                  {m.next_task_title ? (
                    <>
                      <span className="block text-[12px] truncate" title={m.next_task_title}>
                        {m.next_task_title}
                      </span>
                      <span className="block text-[10px] font-mono text-muted-foreground truncate">
                        {m.next_task_assignee_name || ""}
                        {m.next_task_due_at ? ` 〜${fmtShortDate(m.next_task_due_at)}` : ""}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {m.open_task_count > 0 ? `未完了 ${m.open_task_count} 件(次アクション未選定)` : "—"}
                    </span>
                  )}
                </span>
                {/* 担当 */}
                <span className="text-[11px] font-mono truncate" title={m.owner_name || ""}>
                  {m.owner_name || "—"}
                </span>
                {/* 期限 */}
                <span
                  className={`text-center text-[11px] font-mono tabular-nums ${
                    isOverdue(m) ? "text-destructive font-bold" : "text-muted-foreground"
                  }`}
                  title={isOverdue(m) ? "期限超過" : undefined}
                >
                  {fmtShortDate(m.target_due_date)}
                </span>
                {/* 課題/文書/条件 (従来の件数はコンパクトに1列へ) */}
                <span className="flex items-center justify-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
                  <span className="inline-flex items-center gap-0.5" title="課題">
                    <Layers className="h-3 w-3" /> {m.issue_count}
                  </span>
                  <span className="inline-flex items-center gap-0.5" title="文書">
                    <FileText className="h-3 w-3" /> {m.document_count}
                  </span>
                  <span className="inline-flex items-center gap-0.5" title="条件明細">
                    <ListChecks className="h-3 w-3" /> {m.condition_count}
                  </span>
                </span>
                {/* 最終更新 */}
                <span className="text-center text-[11px] font-mono text-muted-foreground tabular-nums">
                  {fmtShortDate(m.updated_at)}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground hidden md:block" />
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新規案件</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-[12px]">案件名 *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="例: 株式会社〇〇 ライセンス案件"
                className="h-8 text-[12px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">相手方（取引先マスタから検索）</Label>
              <VendorSearchSelect
                vendors={vendors}
                selectedCode={form.vendor_code}
                onSelect={(v: any) =>
                  setForm({
                    ...form,
                    vendor_id: v?.id ?? null,
                    vendor_code: v?.vendor_code ?? "",
                    counterparty: v?.vendor_name ?? "",
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">代表 Backlog 課題（Request から検索）</Label>
              <IssuePicker
                issues={issues as any}
                value={form.primary_issue_key || undefined}
                onSelect={(i) => setForm({ ...form, primary_issue_key: i?.issueKey ?? "" })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">ステータス</Label>
              <NativeSelect
                value={form.status}
                onChange={(e: any) => setForm({ ...form, status: e.target.value })}
                className="h-8 text-[12px]"
              >
                <option value="open">未着手</option>
                <option value="in_progress">進行中</option>
                <option value="closed">完了</option>
                <option value="archived">アーカイブ</option>
              </NativeSelect>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpenCreate(false)}>
              キャンセル
            </Button>
            <Button size="sm" onClick={createMatter} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}作成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
