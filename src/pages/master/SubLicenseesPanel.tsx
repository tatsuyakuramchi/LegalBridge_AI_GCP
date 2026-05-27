/**
 * SubLicenseesPanel — サブライセンシー マスター (Phase 22.20-C)
 *
 * 個別利用許諾条件書フォームの SubLicenseeTable で頻出するサブライセンシーを
 * マスター化したもの。区分 (製造販売 / 翻訳出版 / デジタル等) や典型的な地域・言語
 * をマスターで保持し、契約ごとの金銭条件 / 料率 / MGAG は各契約の Repeater に持つ。
 */

import * as React from "react"
import {
  Plus,
  Edit2,
  Trash2,
  Search,
  GitBranch,
} from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { NativeSelect } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"

type Sublicensee = {
  id?: number
  name: string
  name_kana?: string
  category?: string
  default_region?: string
  default_language?: string
  rights_holder?: string
  contact_email?: string
  contact_phone?: string
  remarks?: string
  is_active?: boolean
}

const empty: Sublicensee = {
  name: "",
  name_kana: "",
  category: "翻訳販売 - プロダクトアウト",
  default_region: "",
  default_language: "",
  rights_holder: "",
  contact_email: "",
  contact_phone: "",
  remarks: "",
  is_active: true,
}

// Phase 22.21.4: 業務実態に合わせて区分を再ラベル。
//   - プロダクトアウト (当社で製造、相手方が販売) → 翻訳系は『翻訳販売』
//   - ライセンスアウト (相手方が翻訳+製造+販売)   → 翻訳系は『翻訳製造販売』
//   - IPコラボ は呼称そのまま
const CATEGORIES = [
  "翻訳販売 - プロダクトアウト",
  "翻訳製造販売 - ライセンスアウト",
  "IPコラボ - プロダクトアウト",
  "IPコラボ - ライセンスアウト",
  "デジタル",
  "配信",
  "グッズ",
  "音声化",
  "その他",
]

export function SubLicenseesPanel() {
  const { sublicensees, refreshSublicensees, showNotification } = useAppData()
  const [search, setSearch] = React.useState("")
  const [editing, setEditing] = React.useState<Sublicensee | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState<Sublicensee>(empty)
  const [saving, setSaving] = React.useState(false)

  const filtered = (sublicensees || []).filter((s: Sublicensee) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.name_kana && s.name_kana.toLowerCase().includes(q)) ||
      (s.category && s.category.toLowerCase().includes(q)) ||
      (s.rights_holder && s.rights_holder.toLowerCase().includes(q))
    )
  })

  const open = !!editing || creating
  const data = creating ? draft : editing
  const set = (patch: Partial<Sublicensee>) => {
    if (creating) setDraft({ ...draft, ...patch })
    else if (editing) setEditing({ ...editing, ...patch })
  }
  const close = () => {
    setEditing(null)
    setCreating(false)
    setDraft(empty)
  }

  const save = async () => {
    if (!data?.name?.trim()) {
      showNotification("name は必須です", "error")
      return
    }
    setSaving(true)
    try {
      const isEdit = !!data?.id
      const url = isEdit
        ? `/api/master/sublicensees/${data.id}`
        : "/api/master/sublicensees"
      const method = isEdit ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      const result = await res.json()
      if (!res.ok || result.ok === false) {
        throw new Error(result?.error || `HTTP ${res.status}`)
      }
      showNotification(
        isEdit ? `${data.name} を更新しました` : `${data.name} を登録しました`,
        "success"
      )
      await refreshSublicensees()
      close()
    } catch (e: any) {
      showNotification(`保存失敗: ${e?.message || e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number, name: string) => {
    if (!window.confirm(`${name} を削除しますか?`)) return
    try {
      const res = await fetch(`/api/master/sublicensees/${id}`, {
        method: "DELETE",
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok || result.ok === false) {
        throw new Error(result?.error || `HTTP ${res.status}`)
      }
      showNotification(`削除しました`, "success")
      await refreshSublicensees()
    } catch (e: any) {
      showNotification(`削除失敗: ${e?.message || e}`, "error")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="名称 / かな / 区分 / 権利者で検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button
          onClick={() => {
            setCreating(true)
            setEditing(null)
            setDraft(empty)
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          新規登録
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="p-16 text-center border border-dashed border-border rounded-md">
          <GitBranch className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
            サブライセンシー マスターは空です。「新規登録」から追加してください。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s: Sublicensee) => (
            <Card
              key={`sublicensee-${s.id}`}
              className="group hover:border-foreground transition-all"
            >
              <CardContent className="px-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  {s.category && (
                    <Badge variant="info" className="text-[11px]">
                      {s.category}
                    </Badge>
                  )}
                  <Badge
                    variant={s.is_active === false ? "phosphor" : "success"}
                    className="h-4 text-[11px]"
                  >
                    {s.is_active === false ? "無効" : "有効"}
                  </Badge>
                </div>
                <h3 className="text-sm font-bold leading-snug truncate">
                  {s.name}
                </h3>
                {s.name_kana && (
                  <p className="text-[10px] font-mono text-muted-foreground/70">
                    {s.name_kana}
                  </p>
                )}
                <div className="text-[10px] font-mono text-muted-foreground space-y-0.5">
                  {s.default_region && <div>地域: {s.default_region}</div>}
                  {s.default_language && (
                    <div>言語: {s.default_language}</div>
                  )}
                  {s.rights_holder && (
                    <div className="truncate">権利者: {s.rights_holder}</div>
                  )}
                </div>
                <div className="pt-2 border-t border-dashed border-border flex justify-end gap-1">
                  <Button
                    size="icon-sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(s)
                      setCreating(false)
                    }}
                  >
                    <Edit2 />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="destructive"
                    onClick={() => s.id && remove(s.id, s.name)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {creating ? "新規サブライセンシー登録" : "サブライセンシー編集"}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="overflow-y-auto flex-1 min-h-0 grid grid-cols-2 gap-3">
            <Field label="名称 *" className="col-span-2">
              <Input
                placeholder="例: 株式会社XX出版"
                value={data?.name || ""}
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
            <Field label="ふりがな">
              <Input
                placeholder="かぶしきがいしゃ えっくす..."
                value={data?.name_kana || ""}
                onChange={(e) => set({ name_kana: e.target.value })}
              />
            </Field>
            <Field label="区分">
              <NativeSelect
                value={data?.category || ""}
                onChange={(e) => set({ category: e.target.value })}
              >
                <option value="">— 選択 —</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="想定地域 (デフォルト)">
              <Input
                placeholder="例: 日本国内"
                value={data?.default_region || ""}
                onChange={(e) => set({ default_region: e.target.value })}
              />
            </Field>
            <Field label="想定言語 (デフォルト)">
              <Input
                placeholder="例: 日本語"
                value={data?.default_language || ""}
                onChange={(e) => set({ default_language: e.target.value })}
              />
            </Field>
            <Field label="権利者表記" className="col-span-2">
              <Input
                placeholder="例: 株式会社XX出版"
                value={data?.rights_holder || ""}
                onChange={(e) => set({ rights_holder: e.target.value })}
              />
            </Field>
            <Field label="連絡先メール">
              <Input
                type="email"
                placeholder="contact@example.com"
                value={data?.contact_email || ""}
                onChange={(e) => set({ contact_email: e.target.value })}
              />
            </Field>
            <Field label="連絡先電話">
              <Input
                type="tel"
                placeholder="03-1234-5678"
                value={data?.contact_phone || ""}
                onChange={(e) => set({ contact_phone: e.target.value })}
              />
            </Field>
            <Field label="備考" className="col-span-2">
              <Input
                value={data?.remarks || ""}
                onChange={(e) => set({ remarks: e.target.value })}
              />
            </Field>
            <Field label="有効 / 無効" className="col-span-2">
              <div className="flex items-center gap-2 h-9">
                <Switch
                  checked={data?.is_active !== false}
                  onCheckedChange={(v) => set({ is_active: v })}
                />
                <span className="text-xs font-mono">
                  {data?.is_active !== false ? "有効" : "無効"}
                </span>
              </div>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>
              閉じる
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "保存中…" : "保存"}
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
      <Label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}
