import * as React from "react"
import { Search, Plus, Building2, Trash2, Star } from "lucide-react"

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
import { cn } from "@/lib/utils"

// Phase 22.13: 担当者 (vendor_contacts) の型
type VendorContact = {
  id?: number
  contact_name: string
  contact_department?: string
  title?: string
  email?: string
  phone?: string
  is_primary?: boolean
  sort_order?: number
  remarks?: string
}

const empty = {
  vendor_name: "",
  vendor_code: "",
  trade_name: "",
  pen_name: "",
  entity_type: "corporate",
  contact_name: "",
  phone: "",
  email: "",
  address: "",
  bank_name: "",
  branch_name: "",
  account_type: "普通",
  account_number: "",
  account_holder_kana: "",
  is_invoice_issuer: false,
  invoice_registration_number: "",
  // Phase 22.13
  vendor_rep: "",
  contacts: [] as VendorContact[],
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

  const [saving, setSaving] = React.useState(false)

  // Worker /api/master/vendors は POST のみ (ON CONFLICT DO UPDATE で upsert)
  // なので新規・編集とも同じ POST で送る。旧コードは PUT を使っていたが
  // 該当ハンドラが無く 404 で詰まっていた。
  const save = async () => {
    setSaving(true)
    try {
      const isEdit = !!editing
      const res = await fetch("/api/master/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        showNotification(
          isEdit
            ? `「${data?.vendor_name || data?.vendor_code}」を更新しました`
            : `「${data?.vendor_name || data?.vendor_code}」を登録しました`,
          "success"
        )
        await refreshVendors()
        close()
      } else {
        let detail = ""
        try {
          const j = await res.json()
          detail = j?.error ? `: ${j.error}` : ""
        } catch {
          // body は text のことも
        }
        showNotification(`保存に失敗しました (HTTP ${res.status})${detail}`, "error")
      }
    } catch (e: any) {
      showNotification(`サーバーエラー: ${e?.message || e}`, "error")
    } finally {
      setSaving(false)
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
          <DialogBody className="grid grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto">
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
            {/* Phase 22.13: 法人のみ 代表者欄を表示 (個人は不要) */}
            {data?.entity_type !== "individual" && (
              <Field label="代表者名" className="col-span-2">
                <Input
                  placeholder="例: 代表取締役 山田太郎"
                  value={data?.vendor_rep || ""}
                  disabled={!creating && !editing}
                  onChange={(e) => set({ vendor_rep: e.target.value })}
                />
                <p className="text-[10px] font-mono text-muted-foreground mt-1">
                  契約書 / 発注書の代表者欄に転記されます。肩書込みの形式で
                  記入してください (個人事業主は省略可)。
                </p>
              </Field>
            )}
            <Field label="電話番号 (代表 / メイン)">
              <Input
                type="tel"
                placeholder="03-1234-5678"
                value={data?.phone || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </Field>
            <Field label="メールアドレス" className="col-span-2">
              <Input
                type="email"
                placeholder="contact@example.com"
                value={data?.email || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ email: e.target.value })}
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

            {/* Phase 22.13: 取引先側 窓口担当者リスト (1 取引先 N 担当者)。
                 ※ ここで言う「担当者」は取引先側の窓口担当者 (相手方の人)。
                   当社側の担当者はマスター > スタッフ で管理。
                 ★ primary 1 件の名前が vendor.contact_name にミラーされ、
                   発注書 / 検収書テンプレの「取引先担当者」フィールドに転記。 */}
            <div className="col-span-2 mt-2 border-t border-border pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-mono font-bold uppercase tracking-[0.16em]">
                  取引先 窓口担当者 ({Array.isArray(data?.contacts) ? data.contacts.length : 0} 件)
                </Label>
                {(creating || editing) && (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => {
                      const next: VendorContact[] = Array.isArray(data?.contacts)
                        ? [...data.contacts]
                        : []
                      next.push({
                        contact_name: "",
                        contact_department: "",
                        title: "",
                        email: "",
                        phone: "",
                        is_primary: next.length === 0, // 1 件目は自動 primary
                        sort_order: next.length,
                      })
                      set({ contacts: next })
                    }}
                  >
                    <Plus className="h-3 w-3" />
                    窓口担当者を追加
                  </Button>
                )}
              </div>
              <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                <strong>取引先側</strong>の窓口になる人を登録 (= 相手方の連絡先)。
                当社側の担当者は <strong>マスター &gt; スタッフ</strong> 画面で別途管理してください。
                <br />
                ★ マーク = メイン窓口。発注書 / 検収書 PDF の「取引先担当者」欄に
                この名前 / 部署が転記されます。複数登録時は 1 件だけ ★ にしてください
                (なければ先頭を自動で ★)。
              </p>
              {!Array.isArray(data?.contacts) || data.contacts.length === 0 ? (
                <div className="text-[11px] font-mono text-muted-foreground italic py-3 text-center border border-dashed border-border rounded-sm">
                  担当者がまだ登録されていません{creating || editing ? " — 上の「追加」ボタンから追加してください" : ""}
                </div>
              ) : (
                <div className="space-y-2">
                  {data.contacts.map((c: VendorContact, idx: number) => (
                    <div
                      key={idx}
                      className={cn(
                        "rounded-sm border p-2.5 space-y-2",
                        c.is_primary
                          ? "border-emerald-300 bg-emerald-50/50"
                          : "border-border bg-card"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={!creating && !editing}
                          onClick={() => {
                            const next = data.contacts.map(
                              (x: VendorContact, i: number) => ({
                                ...x,
                                is_primary: i === idx,
                              })
                            )
                            set({ contacts: next })
                          }}
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 border rounded-sm transition-colors",
                            c.is_primary
                              ? "border-emerald-500 bg-emerald-100 text-emerald-800"
                              : "border-border text-muted-foreground hover:border-foreground"
                          )}
                          title="このメンバーをメイン担当者にする"
                        >
                          <Star
                            className={cn(
                              "h-3 w-3",
                              c.is_primary && "fill-emerald-600"
                            )}
                          />
                          {c.is_primary ? "メイン担当者" : "メインに設定"}
                        </button>
                        {(creating || editing) && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = data.contacts.filter(
                                (_: any, i: number) => i !== idx
                              )
                              // primary を消したら先頭を昇格
                              if (
                                c.is_primary &&
                                next.length > 0 &&
                                !next.some((x: VendorContact) => x.is_primary)
                              ) {
                                next[0].is_primary = true
                              }
                              set({ contacts: next })
                            }}
                            className="text-muted-foreground hover:text-destructive p-1"
                            title="この担当者を削除"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1 col-span-2">
                          <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                            氏名 *
                          </Label>
                          <Input
                            placeholder="例: 田中 一郎"
                            value={c.contact_name || ""}
                            disabled={!creating && !editing}
                            onChange={(e) => {
                              const next = [...data.contacts]
                              next[idx] = { ...c, contact_name: e.target.value }
                              set({ contacts: next })
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                            部署
                          </Label>
                          <Input
                            placeholder="例: 営業部"
                            value={c.contact_department || ""}
                            disabled={!creating && !editing}
                            onChange={(e) => {
                              const next = [...data.contacts]
                              next[idx] = {
                                ...c,
                                contact_department: e.target.value,
                              }
                              set({ contacts: next })
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                            役職
                          </Label>
                          <Input
                            placeholder="例: 課長"
                            value={c.title || ""}
                            disabled={!creating && !editing}
                            onChange={(e) => {
                              const next = [...data.contacts]
                              next[idx] = { ...c, title: e.target.value }
                              set({ contacts: next })
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                            メール
                          </Label>
                          <Input
                            type="email"
                            placeholder="example@vendor.co.jp"
                            value={c.email || ""}
                            disabled={!creating && !editing}
                            onChange={(e) => {
                              const next = [...data.contacts]
                              next[idx] = { ...c, email: e.target.value }
                              set({ contacts: next })
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                            電話
                          </Label>
                          <Input
                            type="tel"
                            placeholder="03-xxxx-xxxx"
                            value={c.phone || ""}
                            disabled={!creating && !editing}
                            onChange={(e) => {
                              const next = [...data.contacts]
                              next[idx] = { ...c, phone: e.target.value }
                              set({ contacts: next })
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>
              閉じる
            </Button>
            {(creating || editing) && (
              <Button onClick={save} disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </Button>
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
