import * as React from "react"
import { Search, Plus, Building2 } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"

const empty = {
  vendor_name: "",
  vendor_code: "",
  trade_name: "",
  pen_name: "",
  entity_type: "corporate",
  contact_name: "",
  address: "",
  bank_name: "",
  branch_name: "",
  account_type: "普通",
  account_number: "",
  account_holder_kana: "",
  is_invoice_issuer: false,
  invoice_registration_number: "",
}

export function VendorsPanel() {
  const { vendors, refreshVendors, showNotification } = useAppData()
  const [search, setSearch] = React.useState("")
  const [editing, setEditing] = React.useState<any>(null)
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState<any>(empty)
  const [detail, setDetail] = React.useState<any>(null)

  const filtered = vendors.filter(
    (v) =>
      v.vendor_name.toLowerCase().includes(search.toLowerCase()) ||
      v.vendor_code.toLowerCase().includes(search.toLowerCase()) ||
      (v.trade_name && v.trade_name.toLowerCase().includes(search.toLowerCase()))
  )

  const open = !!editing || creating || !!detail
  const data = creating ? draft : editing || detail
  const set = (patch: any) => {
    if (creating) setDraft({ ...draft, ...patch })
    else if (editing) setEditing({ ...editing, ...patch })
  }
  const close = () => {
    setEditing(null)
    setCreating(false)
    setDetail(null)
    setDraft(empty)
  }

  const save = async () => {
    try {
      const isEdit = !!editing
      const url = isEdit
        ? `/api/master/vendors/${editing.vendor_code}`
        : "/api/master/vendors"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        showNotification("保存しました", "success")
        await refreshVendors()
        close()
      } else {
        showNotification("保存に失敗しました", "error")
      }
    } catch (e) {
      showNotification("サーバーエラー", "error")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="取引先名・取引先コードで検索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {vendors.length} entries
        </span>
        <div className="flex-1" />
        <Button
          onClick={() => {
            setDraft(empty)
            setCreating(true)
          }}
        >
          <Plus />
          取引先を追加
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map((v, idx) => (
          <Card
            key={`vendor-${v.vendor_code || idx}`}
            className="cursor-pointer hover:border-foreground transition-all"
            onClick={() =>
              fetch(`/api/master/vendors/${v.vendor_code}`)
                .then((r) => r.json())
                .then((d) => {
                  setDetail(d)
                  setEditing(d)
                })
            }
          >
            <CardContent className="px-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <Badge variant="outline" className="h-4">
                  {v.vendor_code}
                </Badge>
              </div>
              <p className="text-sm font-mono font-bold uppercase line-clamp-2">
                {v.vendor_name}
              </p>
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                {v.trade_name || "—"}
              </p>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full p-12 text-center border border-dashed border-border rounded-md">
            <p className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
              No vendors registered.
            </p>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {creating
                ? "新規取引先の登録"
                : editing
                ? "取引先の編集"
                : "取引先詳細"}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="grid grid-cols-2 gap-3">
            <Field label="取引先コード *">
              <Input
                value={data?.vendor_code || ""}
                disabled={!creating}
                onChange={(e) => set({ vendor_code: e.target.value })}
              />
            </Field>
            <Field label="区分">
              <NativeSelect
                value={data?.entity_type || "corporate"}
                disabled={!creating && !editing}
                onChange={(e) => set({ entity_type: e.target.value })}
              >
                <option value="corporate">法人</option>
                <option value="individual">個人</option>
              </NativeSelect>
            </Field>
            <Field label="正式名称 *" className="col-span-2">
              <Input
                value={data?.vendor_name || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ vendor_name: e.target.value })}
              />
            </Field>
            <Field label="屋号 / 略称">
              <Input
                value={data?.trade_name || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ trade_name: e.target.value })}
              />
            </Field>
            <Field label="ペンネーム">
              <Input
                value={data?.pen_name || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ pen_name: e.target.value })}
              />
            </Field>
            <Field label="担当者">
              <Input
                value={data?.contact_name || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ contact_name: e.target.value })}
              />
            </Field>
            <Field label="住所" className="col-span-2">
              <Input
                value={data?.address || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ address: e.target.value })}
              />
            </Field>
            <Field label="銀行名">
              <Input
                value={data?.bank_name || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ bank_name: e.target.value })}
              />
            </Field>
            <Field label="支店名">
              <Input
                value={data?.branch_name || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ branch_name: e.target.value })}
              />
            </Field>
            <Field label="口座種別">
              <NativeSelect
                value={data?.account_type || "普通"}
                disabled={!creating && !editing}
                onChange={(e) => set({ account_type: e.target.value })}
              >
                <option value="普通">普通</option>
                <option value="当座">当座</option>
                <option value="貯蓄">貯蓄</option>
              </NativeSelect>
            </Field>
            <Field label="口座番号">
              <Input
                value={data?.account_number || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ account_number: e.target.value })}
              />
            </Field>
            <Field label="口座名義 (カナ)" className="col-span-2">
              <Input
                value={data?.account_holder_kana || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ account_holder_kana: e.target.value })}
              />
            </Field>
            <Field label="インボイス登録番号" className="col-span-2">
              <Input
                value={data?.invoice_registration_number || ""}
                disabled={!creating && !editing}
                onChange={(e) =>
                  set({ invoice_registration_number: e.target.value })
                }
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              閉じる
            </Button>
            {(creating || editing) && (
              <Button onClick={save}>保存</Button>
            )}
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
