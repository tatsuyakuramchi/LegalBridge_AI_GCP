/**
 * LedgersPanel — 原作マスター (Phase 22.18)
 *
 * 1 画面で原作 + 配下の素材 (派生作品 / キャラクター等) を編集する。
 * 原作登録時に自動で -001 (原作本体) 素材が作成され、ユーザーは派生素材を
 * 追加していく形 (-002, -003, ...)。素材の枝番は ledger 内独立カウンタ。
 *
 * ID 体系:
 *   ledgers.ledger_code      : LO-YYYY-NNNN
 *   materials.material_code  : {ledger_code}-NNN (枝番)
 * 1 契約 = 1 素材で license_contracts に紐付く想定。
 */

import * as React from "react"
import {
  Plus,
  Edit2,
  Trash2,
  BookMarked,
  Layers,
  Search,
  ChevronRight,
  Star,
} from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { NativeSelect } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { MATERIAL_GENRES, genreLabel } from "@/lib/materialVocab"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { LegacyWorksBanner } from "@/src/components/LegacyWorksBanner"
import { useNavigate } from "react-router-dom"

type Material = {
  id?: number
  ledger_id?: number
  material_no?: number
  material_code?: string
  material_name: string
  material_type?: string
  rights_holder?: string
  remarks?: string
  is_default?: boolean
  is_active?: boolean
}

type Ledger = {
  id?: number
  ledger_code?: string
  title: string
  title_kana?: string
  alternative_titles?: string[]
  creator_name?: string
  publisher_name?: string
  remarks?: string
  is_active?: boolean
  materials?: Material[]
  // Phase 22.20: 個別利用許諾条件書フォームで自動引用されるデフォルト値
  default_rights_holder?: string
  default_credit_display?: string
  default_work_supplement?: string
  // Phase 22.21.7: 承認条件 / 承認時期 のデフォルト
  default_approval_target?: string
  default_approval_timing?: string
  // Phase 26: 事業部タグ (BDG=ボードゲーム / PUB=出版)。複数付与可。
  division?: string[]
}

const DIVISION_OPTIONS: { value: string; label: string }[] = [
  { value: "BDG", label: "BDG (ボードゲーム)" },
  { value: "PUB", label: "PUB (出版)" },
]

const emptyLedger: Ledger = {
  title: "",
  title_kana: "",
  alternative_titles: [],
  creator_name: "",
  publisher_name: "",
  remarks: "",
  is_active: true,
  default_rights_holder: "",
  default_credit_display: "",
  default_work_supplement: "",
  default_approval_target: "",
  default_approval_timing: "",
  division: ["BDG"],
}

const emptyMaterial: Material = {
  material_name: "",
  material_type: "", // O5: ジャンル未選択(ユーザー選択)。空はバックエンドで正規化。
  rights_holder: "",
  remarks: "",
}

export function LedgersPanel() {
  const navigate = useNavigate()
  const { ledgers, refreshLedgers, showNotification } = useAppData()
  const [search, setSearch] = React.useState("")
  const [divFilter, setDivFilter] = React.useState<string>("")
  const [editing, setEditing] = React.useState<Ledger | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState<Ledger>(emptyLedger)
  const [saving, setSaving] = React.useState(false)

  // 派生素材追加用のローカル state
  const [addingMaterial, setAddingMaterial] = React.useState(false)
  const [newMaterial, setNewMaterial] = React.useState<Material>(emptyMaterial)

  const filtered = (ledgers || []).filter((l: Ledger) => {
    if (
      divFilter &&
      !(Array.isArray(l.division) && l.division.includes(divFilter))
    )
      return false
    const q = search.toLowerCase()
    if (!q) return true
    return (
      (l.title && l.title.toLowerCase().includes(q)) ||
      (l.title_kana && l.title_kana.toLowerCase().includes(q)) ||
      (l.ledger_code && l.ledger_code.toLowerCase().includes(q)) ||
      (l.creator_name && l.creator_name.toLowerCase().includes(q)) ||
      (Array.isArray(l.alternative_titles) &&
        l.alternative_titles.some((t) => t && t.toLowerCase().includes(q)))
    )
  })

  const open = !!editing || creating
  const data = creating ? draft : editing
  const set = (patch: Partial<Ledger>) => {
    if (creating) setDraft({ ...draft, ...patch })
    else if (editing) setEditing({ ...editing, ...patch })
  }
  const close = () => {
    setEditing(null)
    setCreating(false)
    setDraft(emptyLedger)
    setAddingMaterial(false)
    setNewMaterial(emptyMaterial)
  }

  const save = async () => {
    if (!data?.title?.trim()) {
      showNotification("title は必須です", "error")
      return
    }
    setSaving(true)
    try {
      const isEdit = !!data?.id
      const url = isEdit
        ? `/api/master/ledgers/${data.id}`
        : "/api/master/ledgers"
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
        isEdit
          ? `原作 ${data.ledger_code} を更新しました`
          : `原作 ${result.ledger_code} を登録しました (素材 ${result.default_material_code} 自動作成)`,
        "success"
      )
      await refreshLedgers()
      close()
    } catch (e: any) {
      showNotification(`保存失敗: ${e?.message || e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number, code: string) => {
    if (!window.confirm(`原作 ${code} を削除しますか? (素材も全削除されます)`)) return
    try {
      const res = await fetch(`/api/master/ledgers/${id}`, { method: "DELETE" })
      const result = await res.json().catch(() => ({}))
      if (!res.ok || result.ok === false) {
        throw new Error(result?.error || `HTTP ${res.status}`)
      }
      showNotification(`削除しました`, "success")
      await refreshLedgers()
    } catch (e: any) {
      showNotification(`削除失敗: ${e?.message || e}`, "error")
    }
  }

  // 派生素材を追加 (編集モードのみ)
  const addMaterial = async () => {
    if (!data?.id) return
    if (!newMaterial.material_name?.trim()) {
      showNotification("素材名は必須です", "error")
      return
    }
    try {
      const res = await fetch(`/api/master/ledgers/${data.id}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMaterial),
      })
      const result = await res.json()
      if (!res.ok || result.ok === false) {
        throw new Error(result?.error || `HTTP ${res.status}`)
      }
      showNotification(`素材 ${result.material_code} を追加しました`, "success")
      await refreshLedgers()
      // 更新後の編集対象を再取得
      const updated = (ledgers || []).find((l: Ledger) => l.id === data.id)
      if (updated) setEditing(updated)
      setNewMaterial(emptyMaterial)
      setAddingMaterial(false)
    } catch (e: any) {
      showNotification(`素材追加失敗: ${e?.message || e}`, "error")
    }
  }

  const removeMaterial = async (mid: number, code: string) => {
    if (!window.confirm(`素材 ${code} を削除しますか?`)) return
    try {
      const res = await fetch(`/api/master/materials/${mid}`, { method: "DELETE" })
      const result = await res.json().catch(() => ({}))
      if (!res.ok || result.ok === false) {
        throw new Error(result?.error || `HTTP ${res.status}`)
      }
      showNotification("素材を削除しました", "success")
      await refreshLedgers()
      if (data?.id) {
        const updated = (ledgers || []).find((l: Ledger) => l.id === data.id)
        if (updated) setEditing(updated)
      }
    } catch (e: any) {
      showNotification(`削除失敗: ${e?.message || e}`, "error")
    }
  }

  return (
    <div className="space-y-4">
      <LegacyWorksBanner what="原作" />
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="原作名 / コード / 著作者で検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <NativeSelect
          value={divFilter}
          onChange={(e) => setDivFilter(e.target.value)}
          className="h-9 w-44"
          aria-label="事業部で絞り込み"
        >
          <option value="">全事業部</option>
          {DIVISION_OPTIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </NativeSelect>
        {/* 回帰防止(§8 #4): 原作の新規作成は作品管理(/works)に一本化。
            ここでの新規作成は works ミラーを作らず再びギャップを生むため無効化し誘導する。
            既存原作の編集(カードの編集ボタン)は引き続き可能。 */}
        <Button onClick={() => navigate("/works")}>
          <Plus className="h-3.5 w-3.5" />
          作品管理で原作を登録
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="p-16 text-center border border-dashed border-border rounded-md">
          <BookMarked className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
            原作マスターは空です。原作の登録は「作品管理」(/works) から行ってください。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((l: Ledger) => (
            <Card
              key={`ledger-${l.id}`}
              className="group hover:border-foreground transition-all"
            >
              <CardContent className="px-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {l.ledger_code}
                  </Badge>
                  <Badge variant={l.is_active === false ? "phosphor" : "success"} className="h-4 text-[11px]">
                    {l.is_active === false ? "無効" : "有効"}
                  </Badge>
                </div>
                <h3 className="text-sm font-bold leading-snug truncate">
                  {l.title}
                </h3>
                {l.title_kana && (
                  <p className="text-[10px] font-mono text-muted-foreground/70">
                    {l.title_kana}
                  </p>
                )}
                {Array.isArray(l.division) && l.division.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {l.division.map((d) => (
                      <Badge key={d} variant="phosphor" className="h-4 text-[10px]">
                        {d}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                  <Layers className="h-3 w-3" />
                  <span>素材 {Array.isArray(l.materials) ? l.materials.length : 0} 件</span>
                </div>
                {l.creator_name && (
                  <p className="text-[10px] font-mono text-muted-foreground truncate">
                    著: {l.creator_name}
                  </p>
                )}
                <div className="pt-2 border-t border-dashed border-border flex justify-end gap-1">
                  <Button
                    size="icon-sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(l)
                      setCreating(false)
                    }}
                  >
                    <Edit2 />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="destructive"
                    onClick={() => l.id && remove(l.id, l.ledger_code || "")}
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
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {creating ? "新規原作登録" : `原作編集: ${data?.ledger_code || ""}`}
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              {creating
                ? "登録すると LO-YYYY-NNNN 形式の原作コードが自動採番され、配下に原作本体素材 (-001) が自動作成されます。"
                : "編集モード。配下の素材リストから派生素材の追加・削除が可能。原作本体素材 (-001) は削除できません。"}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="overflow-y-auto flex-1 min-h-0 space-y-4">
            {/* 原作 属性 */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="正式名称 *" className="col-span-2">
                <Input
                  placeholder="例: トーネードスプラッシュ"
                  value={data?.title || ""}
                  onChange={(e) => set({ title: e.target.value })}
                />
              </Field>
              <Field label="ふりがな">
                <Input
                  placeholder="とーねーどすぷらっしゅ"
                  value={data?.title_kana || ""}
                  onChange={(e) => set({ title_kana: e.target.value })}
                />
              </Field>
              <Field label="著作者">
                <Input
                  placeholder="例: 山田太郎"
                  value={data?.creator_name || ""}
                  onChange={(e) => set({ creator_name: e.target.value })}
                />
              </Field>
              <Field label="元出版元 / 権利元" className="col-span-2">
                <Input
                  placeholder="例: 株式会社XX出版"
                  value={data?.publisher_name || ""}
                  onChange={(e) => set({ publisher_name: e.target.value })}
                />
              </Field>
              <Field label="別名・略称 (カンマ区切り)" className="col-span-2">
                <Input
                  placeholder="例: TS, トネスプ, Tornado Splash"
                  value={
                    Array.isArray(data?.alternative_titles)
                      ? data?.alternative_titles.join(", ")
                      : ""
                  }
                  onChange={(e) =>
                    set({
                      alternative_titles: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter((s) => s.length > 0),
                    })
                  }
                />
              </Field>
              <Field label="備考" className="col-span-2">
                <Input
                  value={data?.remarks || ""}
                  onChange={(e) => set({ remarks: e.target.value })}
                />
              </Field>
              <Field label="有効 / 無効">
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
              <Field label="事業部タグ (複数可)">
                <div className="flex items-center gap-4 h-9">
                  {DIVISION_OPTIONS.map((d) => {
                    const cur = data?.division || []
                    const on = cur.includes(d.value)
                    return (
                      <label
                        key={d.value}
                        className="flex items-center gap-1.5 cursor-pointer text-xs font-mono"
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            set({
                              division: on
                                ? cur.filter((x) => x !== d.value)
                                : [...cur, d.value],
                            })
                          }
                        />
                        {d.label}
                      </label>
                    )
                  })}
                </div>
              </Field>
            </div>

            {/* Phase 22.20: 個別利用許諾条件書フォームで自動引用されるデフォルト値 */}
            <div className="border-t border-border pt-3 space-y-2">
              <Label className="text-xs font-mono font-bold uppercase tracking-[0.16em]">
                個別利用許諾条件書フォーム自動引用 (任意)
              </Label>
              <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                ここで設定した値は、個別利用許諾条件書フォームで原作を選択した時に
                <strong>素材権利者 / クレジット表記 / 原著作物 補記</strong>
                の各フィールドに自動入力されます。空欄なら何もしません。
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="素材権利者 デフォルト" className="col-span-2">
                  <Input
                    placeholder="例: 株式会社XX出版"
                    value={data?.default_rights_holder || ""}
                    onChange={(e) =>
                      set({ default_rights_holder: e.target.value })
                    }
                  />
                  <p className="text-[10px] font-mono text-muted-foreground mt-1">
                    各素材の rights_holder が空のときに fallback されます。
                    新規派生素材を追加するときの初期値にも使われます。
                  </p>
                </Field>
                <Field label="クレジット表記 デフォルト" className="col-span-2">
                  <Input
                    placeholder="例: © トーネードスプラッシュ製作委員会"
                    value={data?.default_credit_display || ""}
                    onChange={(e) =>
                      set({ default_credit_display: e.target.value })
                    }
                  />
                </Field>
                <Field label="原著作物 補記 デフォルト" className="col-span-2">
                  <Input
                    placeholder="例: 原作および派生作品を含む"
                    value={data?.default_work_supplement || ""}
                    onChange={(e) =>
                      set({ default_work_supplement: e.target.value })
                    }
                  />
                </Field>
                {/* Phase 22.21.7: 承認条件 / 承認時期 デフォルト */}
                <Field label="承認条件 (承認対象) デフォルト" className="col-span-2">
                  <Input
                    placeholder="例: ゲームルール・テーマ・文面・記号・名称の変更、追加、削除、商品としての仕様変更、パッケージ・広告宣伝材料"
                    value={data?.default_approval_target || ""}
                    onChange={(e) =>
                      set({ default_approval_target: e.target.value })
                    }
                  />
                  <p className="text-[10px] font-mono text-muted-foreground mt-1">
                    PDF Section 2「承認対象」欄に自動入力されます。
                  </p>
                </Field>
                <Field label="承認時期 デフォルト" className="col-span-2">
                  <Input
                    placeholder="例: 製造前・変更前（書面による事前承諾）"
                    value={data?.default_approval_timing || ""}
                    onChange={(e) =>
                      set({ default_approval_timing: e.target.value })
                    }
                  />
                  <p className="text-[10px] font-mono text-muted-foreground mt-1">
                    PDF Section 2「承認時期」欄に自動入力されます。
                  </p>
                </Field>
              </div>
            </div>

            {/* 素材リスト (編集モードのみ) */}
            {!creating && data?.id && (
              <div className="border-t border-border pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-mono font-bold uppercase tracking-[0.16em]">
                    配下素材 ({Array.isArray(data.materials) ? data.materials.length : 0} 件)
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAddingMaterial(true)
                      setNewMaterial(emptyMaterial)
                    }}
                  >
                    <Plus className="h-3 w-3" />
                    派生素材を追加
                  </Button>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground">
                  原作本体 (-001) は自動作成済み・削除不可。派生作品 / キャラクター / 関連アセット
                  は枝番 (-002, -003 ...) を持つ別行として追加可能。
                </p>

                {Array.isArray(data.materials) && data.materials.length > 0 && (
                  <div className="space-y-1.5">
                    {data.materials.map((m: Material) => (
                      <div
                        key={m.id}
                        className={cn(
                          "rounded-sm border p-2 flex items-center gap-3",
                          m.is_default
                            ? "border-emerald-300 bg-emerald-50/50"
                            : "border-border bg-card"
                        )}
                      >
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px] flex-shrink-0"
                        >
                          {m.material_code}
                        </Badge>
                        {m.is_default && (
                          <Star className="h-3 w-3 text-emerald-700 fill-emerald-600 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-mono font-bold truncate">
                            {m.material_name}
                          </div>
                          <div className="text-[11px] font-mono text-muted-foreground/70">
                            {genreLabel(m.material_type)}
                            {m.rights_holder && ` / ${m.rights_holder}`}
                          </div>
                        </div>
                        {!m.is_default && (
                          <Button
                            size="icon-sm"
                            variant="destructive"
                            onClick={() =>
                              m.id && removeMaterial(m.id, m.material_code || "")
                            }
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {addingMaterial && (
                  <div className="rounded-sm border border-amber-200 bg-amber-50/30 p-3 space-y-2">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-amber-700">
                      新しい派生素材 (枝番自動)
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="素材名 *" className="col-span-2">
                        <Input
                          placeholder="例: トーネードスプラッシュ2"
                          value={newMaterial.material_name}
                          onChange={(e) =>
                            setNewMaterial({
                              ...newMaterial,
                              material_name: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="種別">
                        <NativeSelect
                          value={newMaterial.material_type || ""}
                          onChange={(e) =>
                            setNewMaterial({
                              ...newMaterial,
                              material_type: e.target.value,
                            })
                          }
                        >
                          <option value="">(ジャンル)</option>
                          {MATERIAL_GENRES.map((g) => (
                            <option key={g.value} value={g.value}>
                              {g.label}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field label="権利者">
                        <Input
                          placeholder="原作と同じなら省略可"
                          value={newMaterial.rights_holder || ""}
                          onChange={(e) =>
                            setNewMaterial({
                              ...newMaterial,
                              rights_holder: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="備考" className="col-span-2">
                        <Input
                          value={newMaterial.remarks || ""}
                          onChange={(e) =>
                            setNewMaterial({
                              ...newMaterial,
                              remarks: e.target.value,
                            })
                          }
                        />
                      </Field>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAddingMaterial(false)
                          setNewMaterial(emptyMaterial)
                        }}
                      >
                        キャンセル
                      </Button>
                      <Button size="sm" onClick={addMaterial}>
                        <ChevronRight className="h-3 w-3" />
                        追加して枝番採番
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
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
