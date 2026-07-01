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
  Send,
  ListChecks,
  Layers,
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

// 案件管理 一覧。1行 = 1案件。Backlog課題(重複/部分)・文書・送信・条件明細を束ねる。
//   API: GET /api/matters (matter_overview_v)。詳細は /matters/:id。
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
      const params = new URLSearchParams()
      if (status) params.set("status", status)
      if (q.trim()) params.set("q", q.trim())
      const res = await fetch(`/api/matters?${params.toString()}`)
      const json = await res.json()
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
      const res = await fetch("/api/matters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || "作成に失敗しました")
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-[15px] font-semibold leading-none">案件管理</h1>
            <p className="text-[11px] text-muted-foreground mt-1">
              重複・部分発生した Backlog 課題を1案件に束ね、文書・送信履歴・条件明細を総合管理
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button size="sm" onClick={() => setOpenCreate(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> 新規案件
          </Button>
        </div>
      </div>

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
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-2 px-3 py-2 border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>案件 / 相手方</span>
            <span className="text-center">課題</span>
            <span className="text-center">文書</span>
            <span className="text-center">条件</span>
            <span className="text-center">最終送信</span>
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
                className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-2 px-3 py-2.5 border-b border-border/60 items-center text-left hover:bg-muted/40 transition-colors w-full"
              >
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
                <span className="flex items-center justify-center gap-1 text-[12px] tabular-nums">
                  <Layers className="h-3 w-3 text-muted-foreground" /> {m.issue_count}
                </span>
                <span className="flex items-center justify-center gap-1 text-[12px] tabular-nums">
                  <FileText className="h-3 w-3 text-muted-foreground" /> {m.document_count}
                </span>
                <span className="flex items-center justify-center gap-1 text-[12px] tabular-nums">
                  <ListChecks className="h-3 w-3 text-muted-foreground" /> {m.condition_count}
                </span>
                <span className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground tabular-nums">
                  <Send className="h-3 w-3" />
                  {m.last_sent_at ? new Date(m.last_sent_at).toLocaleDateString("ja-JP") : "—"}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
