import * as React from "react"
import { Plus, Search, Edit2, Trash2, ExternalLink } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"
import { NativeSelect } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"

const empty = {
  vendor_id: "",
  record_type: "master_contract",
  contract_category: "service",
  contract_type: "service_basic",
  contract_title: "",
  document_number: "",
  contract_status: "executed",
  effective_date: "",
  expiration_date: "",
  auto_renewal: false,
  // Phase 20: 自動更新契約の通告期限アラート用 (auto_renewal=true のみ意味あり)
  renewal_notice_months: "",
  alert_lead_months: "",
  original_work: "",
  product_name: "",
  work_name: "",
  media: "",
  territory: "",
  language: "",
  document_url: "",
  condition_number: "",
}

export function ContractsPanel() {
  const { contracts, vendors, refreshContracts, showNotification } = useAppData()
  const [search, setSearch] = React.useState("")
  const [editing, setEditing] = React.useState<any>(null)
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState<any>(empty)

  const filtered = contracts.filter((c) => {
    const q = search.toLowerCase()
    return (
      (c.contract_title && c.contract_title.toLowerCase().includes(q)) ||
      (c.vendor_name && c.vendor_name.toLowerCase().includes(q)) ||
      (c.document_number && c.document_number.toLowerCase().includes(q)) ||
      (c.original_work && c.original_work.toLowerCase().includes(q)) ||
      (c.product_name && c.product_name.toLowerCase().includes(q))
    )
  })

  const open = !!editing || creating
  const data = creating ? draft : editing
  const set = (patch: any) => {
    if (creating) setDraft({ ...draft, ...patch })
    else setEditing({ ...editing, ...patch })
  }
  const close = () => {
    setEditing(null)
    setCreating(false)
    setDraft(empty)
  }

  const [saving, setSaving] = React.useState(false)
  const save = async () => {
    setSaving(true)
    try {
      const isEdit = !!data?.id
      const url = isEdit ? `/api/master/contracts/${data.id}` : "/api/master/contracts"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        showNotification(
          isEdit ? "契約情報を更新しました" : "契約情報を追加しました",
          "success"
        )
        await refreshContracts()
        close()
      } else {
        let detail = ""
        try {
          const j = await res.json()
          detail = j?.error ? `: ${j.error}` : ""
        } catch {}
        showNotification(
          `保存に失敗しました (HTTP ${res.status})${detail}`,
          "error"
        )
      }
    } catch (e: any) {
      showNotification(`サーバーエラー: ${e?.message || e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    if (!confirm("この契約情報を削除しますか？")) return
    const res = await fetch(`/api/master/contracts/${id}`, { method: "DELETE" })
    if (res.ok) {
      showNotification("削除しました", "success")
      await refreshContracts()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="契約タイトル、取引先、原作、管理番号で検索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button
          onClick={() => {
            setDraft({ ...empty, vendor_id: vendors[0]?.id || "" })
            setCreating(true)
            setEditing(null)
          }}
        >
          <Plus />
          契約情報を追加
        </Button>
      </div>

      <div className="border border-border rounded-md overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>契約タイトル / 管理番号</TableHead>
              <TableHead>取引先</TableHead>
              <TableHead>区分</TableHead>
              <TableHead>スコープ</TableHead>
              <TableHead>有効期限</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={`contract-${c.id}`}>
                <TableCell>
                  <div className="font-bold truncate max-w-[280px]">{c.contract_title}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Badge variant="outline" className="h-4">
                      {c.document_number || "N/A"}
                    </Badge>
                    <Badge
                      variant={c.contract_status === "executed" ? "success" : "phosphor"}
                      className="h-4"
                    >
                      {c.contract_status === "executed" ? "締結済" : c.contract_status}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="font-bold">{c.vendor_name || "未設定"}</TableCell>
                <TableCell className="space-y-1 text-[10px]">
                  <Badge variant="info" className="h-4">{c.record_type}</Badge>
                  <div>
                    <Badge variant="phosphor" className="h-4">{c.contract_category}</Badge>
                  </div>
                </TableCell>
                <TableCell className="text-[10px] space-y-0.5 text-muted-foreground">
                  {c.original_work && (
                    <div>
                      <span className="opacity-50">作品:</span>{" "}
                      <span className="font-bold">{c.original_work}</span>
                    </div>
                  )}
                  {c.product_name && (
                    <div>
                      <span className="opacity-50">製品:</span> {c.product_name}
                    </div>
                  )}
                  {c.territory && (
                    <div>
                      <span className="opacity-50">地域:</span> {c.territory}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-[10px]">
                  <div className="font-mono">
                    {c.effective_date ? c.effective_date.substring(0, 10) : "未設定"}
                  </div>
                  <div className="font-mono">
                    〜 {c.expiration_date ? c.expiration_date.substring(0, 10) : "無期限"}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        c.auto_renewal ? "bg-emerald-500" : "bg-muted-foreground/40"
                      }`}
                    />
                    <span className="text-muted-foreground">
                      {c.auto_renewal ? "自動更新あり" : "更新なし"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {c.document_url && (
                      <a
                        href={c.document_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 w-7 items-center justify-center border border-border rounded-sm hover:bg-muted text-muted-foreground"
                        title="原本"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(c)
                        setCreating(false)
                      }}
                    >
                      <Edit2 />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="destructive"
                      onClick={() => remove(c.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="p-12 text-center text-muted-foreground">
                  登録された契約情報がありません
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {creating ? "新規契約情報の登録" : "契約情報の編集"}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="取引先 *">
              <NativeSelect
                value={data?.vendor_id || ""}
                onChange={(e) => set({ vendor_id: e.target.value })}
              >
                <option value="">— 取引先を選択 —</option>
                {vendors.map((v) => (
                  <option key={`opt-${v.id}`} value={v.id}>
                    {v.vendor_name} ({v.vendor_code})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="レコード区分">
              <NativeSelect
                value={data?.record_type || "master_contract"}
                onChange={(e) => set({ record_type: e.target.value })}
              >
                <option value="master_contract">基本契約</option>
                <option value="license_condition">個別ライセンス</option>
                <option value="individual_contract">個別契約</option>
              </NativeSelect>
            </Field>
            <Field label="カテゴリ">
              <NativeSelect
                value={data?.contract_category || "service"}
                onChange={(e) => set({ contract_category: e.target.value })}
              >
                <option value="service">業務委託・サービス</option>
                <option value="license">ライセンス・知的財産</option>
                <option value="publication">出版関連</option>
              </NativeSelect>
            </Field>
            <Field label="契約書名 *" className="col-span-2">
              <Input
                value={data?.contract_title || ""}
                onChange={(e) => set({ contract_title: e.target.value })}
                placeholder="例：基本システム開発業務委託契約書"
              />
            </Field>
            <Field label="管理番号">
              <Input
                value={data?.document_number || ""}
                onChange={(e) => set({ document_number: e.target.value })}
                placeholder="DOC-2026-0001"
              />
            </Field>
            <Field label="ステータス">
              <NativeSelect
                value={data?.contract_status || "executed"}
                onChange={(e) => set({ contract_status: e.target.value })}
              >
                <option value="executed">締結済</option>
                <option value="draft">草案・作成中</option>
                <option value="expired">満了</option>
                <option value="terminated">解約済</option>
              </NativeSelect>
            </Field>
            <Field label="発効日">
              <Input
                type="date"
                value={
                  data?.effective_date
                    ? String(data.effective_date).substring(0, 10)
                    : ""
                }
                onChange={(e) => set({ effective_date: e.target.value })}
              />
            </Field>
            <Field label="満了日">
              <Input
                type="date"
                value={
                  data?.expiration_date
                    ? String(data.expiration_date).substring(0, 10)
                    : ""
                }
                onChange={(e) => set({ expiration_date: e.target.value })}
              />
            </Field>
            <Field label="自動更新">
              <div className="flex items-center gap-2 h-9">
                <Switch
                  checked={!!data?.auto_renewal}
                  onCheckedChange={(v) => set({ auto_renewal: v })}
                />
                <span className="text-xs font-mono">
                  {data?.auto_renewal ? "あり" : "なし"}
                </span>
              </div>
            </Field>
            {/* Phase 20: 自動更新契約の通告期限アラート */}
            <Field label="解約通告期限 (カ月前)">
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="例: 1"
                value={
                  data?.renewal_notice_months == null
                    ? ""
                    : String(data.renewal_notice_months)
                }
                onChange={(e) =>
                  set({ renewal_notice_months: e.target.value })
                }
                disabled={!data?.auto_renewal}
              />
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                満期の何カ月前までに通告が必要か (自動更新あり時のみ)
              </p>
            </Field>
            <Field label="アラート前倒し (カ月)">
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="例: 2"
                value={
                  data?.alert_lead_months == null
                    ? ""
                    : String(data.alert_lead_months)
                }
                onChange={(e) => set({ alert_lead_months: e.target.value })}
                disabled={!data?.auto_renewal}
              />
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                通告期限の何カ月前にアラートを出すか
              </p>
            </Field>
            <Field label="作品 / 原作">
              <Input
                value={data?.original_work || ""}
                onChange={(e) => set({ original_work: e.target.value })}
              />
            </Field>
            <Field label="製品名">
              <Input
                value={data?.product_name || ""}
                onChange={(e) => set({ product_name: e.target.value })}
              />
            </Field>
            <Field label="メディア">
              <Input
                value={data?.media || ""}
                onChange={(e) => set({ media: e.target.value })}
              />
            </Field>
            <Field label="地域">
              <Input
                value={data?.territory || ""}
                onChange={(e) => set({ territory: e.target.value })}
              />
            </Field>
            <Field label="言語">
              <Input
                value={data?.language || ""}
                onChange={(e) => set({ language: e.target.value })}
              />
            </Field>
            <Field label="文書 URL" className="col-span-2 md:col-span-3">
              <Input
                value={data?.document_url || ""}
                onChange={(e) => set({ document_url: e.target.value })}
                placeholder="https://drive.google.com/…"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>
              キャンセル
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "保存中…" : "保存して同期"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`space-y-1 ${className || ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  )
}
