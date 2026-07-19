/**
 * RingiPanel — 稟議マスタの管理画面 (Phase 22.21.116)。
 *
 *   一覧 + 検索 + 新規作成 + 編集 + 削除 + CSV 一括インポート。
 *   ContractsPanel と同 shape。
 *
 *   API:
 *     - GET /api/ringi/search?q=&limit= — 一覧 (全フィールド + linked_document_count)
 *     - POST /api/ringi — upsert
 *     - DELETE /api/ringi/:id — 削除 (N:N リンクは CASCADE で自動削除)
 *     - POST /api/imports/bulk/ringi — CSV 一括 (BulkImportDialog 経由)
 */

import * as React from "react"
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  FileSpreadsheet,
  Link as LinkIcon,
} from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AppFormField } from "@/src/components/form"
import { useAppData } from "@/src/context/AppDataContext"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { NativeSelect } from "@/components/ui/native-select"
import { cn } from "@/lib/utils"
import { BulkImportDialog } from "@/src/components/document/BulkImportDialog"

type DecisionType = "ringi" | "board_resolution"

type RingiRecord = {
  id?: number
  ringi_number: string         // "R-00001" / "B-00001" 形式
  decision_type?: DecisionType
  title: string
  category?: string
  owner_name?: string
  owner_department?: string
  approved_at?: string | null
  backlog_issue_key?: string
  status?: string
  total_budget?: number | string
  remarks?: string
  created_at?: string
  updated_at?: string
  linked_document_count?: number
}

const empty: RingiRecord = {
  ringi_number: "",
  decision_type: "ringi",
  title: "",
  category: "",
  owner_name: "",
  owner_department: "",
  approved_at: "",
  backlog_issue_key: "",
  status: "open",
  total_budget: "",
  remarks: "",
}

// Phase 22.21.117: 決裁種別の表示ラベル
const DECISION_TYPE_LABEL: Record<DecisionType, string> = {
  ringi: "稟議",
  board_resolution: "取締役会",
}

const DECISION_TYPE_BADGE: Record<DecisionType, "info" | "phosphor"> = {
  ringi: "info",
  board_resolution: "phosphor",
}

const STATUS_OPTIONS = [
  { value: "open", label: "起案中 (open)" },
  { value: "approved", label: "承認済 (approved)" },
  { value: "rejected", label: "却下 (rejected)" },
  { value: "closed", label: "完了 (closed)" },
  { value: "cancelled", label: "取下げ (cancelled)" },
]

const STATUS_VARIANT: Record<
  string,
  "success" | "phosphor" | "info" | "outline"
> = {
  approved: "success",
  closed: "phosphor",
  open: "info",
  rejected: "outline",
  cancelled: "outline",
}

export function RingiPanel() {
  const { showNotification } = useAppData()
  const [search, setSearch] = React.useState("")
  const [rows, setRows] = React.useState<RingiRecord[]>([])
  const [loading, setLoading] = React.useState(false)
  const [editing, setEditing] = React.useState<RingiRecord | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState<RingiRecord>(empty)
  const [saving, setSaving] = React.useState(false)
  const [bulkOpen, setBulkOpen] = React.useState(false)

  const fetchRows = React.useCallback(async () => {
    setLoading(true)
    try {
      const url = `/api/ringi/search?q=${encodeURIComponent(search)}&limit=100`
      const res = await fetch(url)
      const data = await res.json().catch(() => ({}))
      if (Array.isArray(data?.rows)) setRows(data.rows)
    } catch (e: any) {
      showNotification(`稟議一覧の取得に失敗: ${e?.message || e}`, "error")
    } finally {
      setLoading(false)
    }
  }, [search, showNotification])

  React.useEffect(() => {
    const t = window.setTimeout(fetchRows, 250)
    return () => window.clearTimeout(t)
  }, [fetchRows])

  const open = !!editing || creating
  const data = creating ? draft : editing
  const set = (patch: Partial<RingiRecord>) => {
    if (creating) setDraft({ ...draft, ...patch })
    else if (editing) setEditing({ ...editing, ...patch })
  }
  const close = () => {
    setEditing(null)
    setCreating(false)
    setDraft(empty)
  }

  const save = async () => {
    if (!data) return
    setSaving(true)
    try {
      const body: any = {
        // Phase 22.21.117: decision_type を Worker に渡す。
        //   ringi_number は "R-NNNNN" / "B-NNNNN" or 5 桁数字どちらでも OK。
        //   Worker 側で正規化される。
        decision_type: data.decision_type || "ringi",
        ringi_number: String(data.ringi_number || "").trim(),
        title: String(data.title || "").trim(),
        category: data.category || "",
        owner_name: data.owner_name || "",
        owner_department: data.owner_department || "",
        approved_at: data.approved_at || null,
        backlog_issue_key: data.backlog_issue_key || "",
        status: data.status || "open",
        total_budget:
          data.total_budget !== "" && data.total_budget != null
            ? Number(data.total_budget)
            : null,
        remarks: data.remarks || "",
      }
      const res = await fetch("/api/ringi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) {
        showNotification(
          creating
            ? `稟議 ${body.ringi_number} を登録しました`
            : `稟議 ${body.ringi_number} を更新しました`,
          "success"
        )
        close()
        await fetchRows()
      } else {
        showNotification(j?.error || `HTTP ${res.status}`, "error")
      }
    } catch (e: any) {
      showNotification(`保存に失敗: ${e?.message || e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (r: RingiRecord) => {
    if (!r.id) return
    if (
      r.linked_document_count &&
      r.linked_document_count > 0 &&
      !window.confirm(
        `稟議 ${r.ringi_number} には ${r.linked_document_count} 件の文書が紐付いています。リンクも削除されます。続行しますか?`
      )
    ) {
      return
    }
    if (
      !r.linked_document_count &&
      !window.confirm(`稟議 ${r.ringi_number} を削除しますか?`)
    ) {
      return
    }
    try {
      const res = await fetch(`/api/ringi/${r.id}`, { method: "DELETE" })
      if (res.ok) {
        showNotification(`削除しました (${r.ringi_number})`, "success")
        await fetchRows()
      } else {
        const j = await res.json().catch(() => ({}))
        showNotification(j?.error || `HTTP ${res.status}`, "error")
      }
    } catch (e: any) {
      showNotification(`削除に失敗: ${e?.message || e}`, "error")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="稟議番号 / タイトル / 起案者 / カテゴリ で検索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setBulkOpen(true)}
          title="CSV テンプレを DL してまとめて取込"
        >
          <FileSpreadsheet />
          CSV 一括取込
        </Button>
        <Button
          onClick={() => {
            setDraft({ ...empty })
            setCreating(true)
            setEditing(null)
          }}
        >
          <Plus />
          稟議を追加
        </Button>
      </div>

      <div className="border border-border rounded-md overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">種別</TableHead>
              <TableHead className="w-[110px]">決裁番号</TableHead>
              <TableHead>タイトル</TableHead>
              <TableHead className="w-[140px]">起案者 / 部署</TableHead>
              <TableHead className="w-[120px]">承認日</TableHead>
              <TableHead className="w-[110px]">ステータス</TableHead>
              <TableHead className="w-[140px] text-right">予算 / 紐付</TableHead>
              <TableHead className="text-right w-[100px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`ringi-${r.id}`}>
                <TableCell>
                  <Badge
                    variant={
                      DECISION_TYPE_BADGE[
                        (r.decision_type || "ringi") as DecisionType
                      ]
                    }
                    className="h-5"
                  >
                    {
                      DECISION_TYPE_LABEL[
                        (r.decision_type || "ringi") as DecisionType
                      ]
                    }
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="font-mono font-bold">{r.ringi_number}</div>
                  {r.backlog_issue_key && (
                    <div className="text-[10px] font-mono text-muted-foreground">
                      {r.backlog_issue_key}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="font-bold truncate max-w-[320px]">
                    {r.title}
                  </div>
                  {r.category && (
                    <Badge variant="outline" className="h-4 mt-1">
                      {r.category}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-[11px] font-mono">
                  <div>{r.owner_name || "—"}</div>
                  {r.owner_department && (
                    <div className="text-muted-foreground">
                      {r.owner_department}
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-mono text-[11px]">
                  {r.approved_at
                    ? String(r.approved_at).substring(0, 10)
                    : "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={STATUS_VARIANT[r.status || "open"] || "info"}
                    className="h-4"
                  >
                    {r.status || "open"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-[11px] font-mono">
                  <div>
                    {r.total_budget != null && r.total_budget !== ""
                      ? `¥${Number(r.total_budget).toLocaleString("ja-JP")}`
                      : "—"}
                  </div>
                  <div
                    className={cn(
                      "text-[10px] flex items-center justify-end gap-1 mt-1",
                      r.linked_document_count && r.linked_document_count > 0
                        ? "text-emerald-700"
                        : "text-muted-foreground"
                    )}
                  >
                    <LinkIcon className="h-2.5 w-2.5" />
                    {r.linked_document_count || 0} 件
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(r)
                        setCreating(false)
                      }}
                      title="編集"
                    >
                      <Edit2 />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="destructive"
                      onClick={() => remove(r)}
                      title={
                        r.linked_document_count && r.linked_document_count > 0
                          ? `紐付き ${r.linked_document_count} 件あり — 削除には確認あり`
                          : "削除"
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="p-12 text-center text-muted-foreground text-sm"
                >
                  {loading
                    ? "読み込み中…"
                    : search
                      ? "該当する稟議が見つかりません"
                      : "登録された稟議がありません。「+ 稟議を追加」から登録してください。"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {creating ? "新規稟議の登録" : "稟議の編集"}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[70vh] overflow-y-auto">
            {/* Phase 22.21.117: 決裁種別 (稟議 / 取締役会) */}
            <Field label="決裁種別 *">
              <NativeSelect
                value={data?.decision_type || "ringi"}
                onChange={(e) =>
                  set({ decision_type: e.target.value as DecisionType })
                }
                disabled={!creating && !!editing?.id}
              >
                <option value="ringi">稟議 (R-NNNNN)</option>
                <option value="board_resolution">取締役会 (B-NNNNN)</option>
              </NativeSelect>
            </Field>
            <Field label="決裁番号 * (R-NNNNN or 5 桁数字)">
              <Input
                value={data?.ringi_number || ""}
                onChange={(e) => {
                  // 大文字化 + R-/B- 形式と 5 桁数字どちらも許容
                  const v = e.target.value.toUpperCase().replace(/[^0-9RB\-]/g, "")
                  set({ ringi_number: v })
                }}
                maxLength={8}
                placeholder="R-00001 / 00001"
                disabled={!creating && !!editing?.id}
              />
              {creating && (
                <p className="text-[10px] font-mono text-muted-foreground mt-1">
                  5 桁数字を入力すると、種別から自動でプレフィックスが付きます
                  (例: ringi → R-00001)
                </p>
              )}
              {!creating && (
                <p className="text-[10px] font-mono text-muted-foreground mt-1">
                  既存番号は変更不可。削除→再登録してください。
                </p>
              )}
            </Field>
            <Field label="ステータス">
              <NativeSelect
                value={data?.status || "open"}
                onChange={(e) => set({ status: e.target.value })}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="承認日">
              <Input
                type="date"
                value={
                  data?.approved_at
                    ? String(data.approved_at).substring(0, 10)
                    : ""
                }
                onChange={(e) => set({ approved_at: e.target.value })}
              />
            </Field>
            <Field label="タイトル *" className="col-span-2 md:col-span-3">
              <Input
                value={data?.title || ""}
                onChange={(e) => set({ title: e.target.value })}
                placeholder="例: 商品開発稟議 ◯◯シリーズ"
              />
            </Field>
            <Field label="カテゴリ">
              <Input
                value={data?.category || ""}
                onChange={(e) => set({ category: e.target.value })}
                placeholder="例: 商品開発 / 業務委託 / ライセンス取得"
              />
            </Field>
            <Field label="起案者">
              <Input
                value={data?.owner_name || ""}
                onChange={(e) => set({ owner_name: e.target.value })}
                placeholder="例: 山田 太郎"
              />
            </Field>
            <Field label="起案者部署">
              <Input
                value={data?.owner_department || ""}
                onChange={(e) => set({ owner_department: e.target.value })}
                placeholder="例: 法務部"
              />
            </Field>
            <Field label="Backlog 課題キー">
              <Input
                value={data?.backlog_issue_key || ""}
                onChange={(e) => set({ backlog_issue_key: e.target.value })}
                placeholder="例: ARC-1001"
              />
            </Field>
            <Field label="予算 (税抜)">
              <Input
                type="number"
                min="0"
                step="1"
                value={(data?.total_budget as any) ?? ""}
                onChange={(e) => set({ total_budget: e.target.value })}
                placeholder="500000"
              />
            </Field>
            {!creating && editing?.linked_document_count != null && (
              <Field label="紐付き文書">
                <div className="text-xs font-mono px-2 py-1.5 border border-input rounded-sm bg-muted/30">
                  {editing.linked_document_count} 件
                </div>
              </Field>
            )}
            <Field label="備考" className="col-span-2 md:col-span-3">
              <textarea
                value={data?.remarks || ""}
                onChange={(e) => set({ remarks: e.target.value })}
                rows={3}
                className="w-full text-xs font-mono px-2 py-1 border border-input rounded-sm bg-transparent focus:outline-none focus:border-foreground"
                placeholder="任意"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>
              キャンセル
            </Button>
            <Button
              onClick={save}
              disabled={
                saving ||
                // Phase 22.21.117: R-NNNNN / B-NNNNN / 5 桁数字 のいずれか
                !(
                  data?.ringi_number?.match(/^(R|B)-[0-9]{5}$/) ||
                  data?.ringi_number?.match(/^[0-9]{5}$/)
                ) ||
                !data?.title?.trim()
              }
            >
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkImportDialog
        kind="ringi"
        label="稟議マスタ"
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onCompleted={() => fetchRows()}
      />
    </div>
  )
}

// FRM-07: 共通フォーム基盤へ委譲。ページ独自の field 描画を廃し AppFormField に一本化
//   (設計 §11.3)。末尾 " *" は必須マーカーとして解釈し AppFormField.required へ。
function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  const required = /\*\s*$/.test(label)
  const cleanLabel = label.replace(/\s*\*\s*$/, "")
  return (
    <AppFormField label={cleanLabel} required={required} className={className}>
      {children}
    </AppFormField>
  )
}
