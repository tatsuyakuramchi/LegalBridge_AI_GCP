/**
 * ④ 権利根源 — マテリアルの権利根源（material_rights_sources, 0139 / WM-04）＋ 原作/調達（支払）。
 *   マテリアルごとに「権利がどこ由来か」を複数根拠で管理する（主要根源は1件）。
 *   設計 §6.5 / 最重要修正4。API 呼び方は context 経由（v3=search-api）。
 */
import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/EmptyState"
import { NativeSelect } from "@/components/ui/native-select"
import { EntityCombobox } from "@/src/components/form"
import { useWorkDetail } from "@/src/pages/works/WorkDetailContext"
import { EdgeRow } from "./shared"

const SOURCE_TYPES: [string, string][] = [
  ["direct_contract", "直接契約（取引先）"],
  ["work", "派生元作品"],
  ["work_family", "シリーズ源流"],
  ["company_owned", "自社保有"],
  ["custom", "その他（名目直接）"],
]
const SOURCE_TYPE_LABEL: Record<string, string> = Object.fromEntries(SOURCE_TYPES)
const SOURCE_ROLES: [string, string][] = [
  ["", "役割 —"],
  ["original_work", "原作"],
  ["underlying_work", "原著"],
  ["character_source", "キャラクター"],
  ["other", "その他"],
]

const emptyForm = () => ({
  source_type: "direct_contract",
  rights_holder_vendor_id: "",
  source_work_id: "",
  fee_subject_name: "",
  source_role: "",
  is_primary: false,
})

/** マテリアル1件分の権利根源ブロック（一覧＋追加フォーム）。 */
const MaterialRightsBlock: React.FC<{ material: any; sources: any[] }> = ({ material, sources }) => {
  const { addRightsSource, updateRightsSource, deleteRightsSource, parentCandidates } = useWorkDetail()
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState<any>(emptyForm())

  const workItems = parentCandidates.map((w) => ({ id: w.id, code: w.code, label: w.title, sub: w.sub, raw: w }))

  const submit = async () => {
    const payload: any = {
      source_type: form.source_type,
      source_role: form.source_role || null,
      is_primary: form.is_primary,
    }
    if (form.source_type === "direct_contract")
      payload.rights_holder_vendor_id = form.rights_holder_vendor_id ? Number(form.rights_holder_vendor_id) : null
    if (form.source_type === "work")
      payload.source_work_id = form.source_work_id ? Number(form.source_work_id) : null
    if (form.source_type === "custom") payload.fee_subject_name = form.fee_subject_name || null
    setSaving(true)
    const ok = await addRightsSource(material.id, payload)
    setSaving(false)
    if (ok) { setForm(emptyForm()); setOpen(false) }
  }

  const setPrimary = (s: any) =>
    updateRightsSource(s.id, {
      source_type: s.source_type,
      source_work_id: s.source_work_id,
      rights_holder_vendor_id: s.rights_holder_vendor_id,
      source_role: s.source_role,
      fee_subject_name: s.fee_subject_name,
      fee_subject_suffix: s.fee_subject_suffix,
      is_primary: true,
    })

  const sourceLabel = (s: any) => {
    if (s.source_type === "direct_contract")
      return s.vendor_name ? `${s.vendor_name}${s.vendor_code ? ` (${s.vendor_code})` : ""}` : "（取引先未設定）"
    if (s.source_type === "work")
      return s.source_work_title ? `${s.source_work_code || ""} ${s.source_work_title}`.trim() : "（作品未設定）"
    if (s.source_type === "custom") return s.fee_subject_name || "（名目未設定）"
    if (s.source_type === "company_owned") return "自社保有"
    return "—"
  }

  return (
    <div className="rounded-md border border-border/70 p-2.5 space-y-1.5">
      <div className="text-[11px] font-mono font-semibold">
        <span className="text-success">◦ マテリアル</span> {material.material_code || "—"} {material.material_name}
      </div>
      {sources.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">権利根源が未登録です。</p>
      ) : (
        <div className="space-y-1">
          {sources.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 text-[11px] font-mono border border-border/50 rounded px-2 py-1">
              <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                {s.is_primary ? (
                  <Badge variant="outline" className="border-primary/50 text-primary">主要</Badge>
                ) : null}
                <Badge variant="outline" className="border-border text-muted-foreground">
                  {SOURCE_TYPE_LABEL[s.source_type] || s.source_type || "—"}
                </Badge>
                <span className="truncate">{sourceLabel(s)}</span>
                {s.source_role ? (
                  <span className="text-[10px] text-muted-foreground">
                    （{SOURCE_ROLES.find(([v]) => v === s.source_role)?.[1] || s.source_role}）
                  </span>
                ) : null}
              </div>
              <div className="shrink-0 flex items-center gap-1">
                {!s.is_primary && (
                  <button
                    type="button"
                    onClick={() => void setPrimary(s)}
                    className="text-[9px] px-1.5 py-0.5 rounded border border-primary/40 text-primary hover:bg-primary/10"
                    title="この根源を主要にする"
                  >
                    主要に
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void deleteRightsSource(s.id)}
                  className="text-[9px] px-1.5 py-0.5 rounded border border-destructive/40 text-destructive hover:bg-destructive/10"
                  title="削除"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[10px] font-mono px-2 py-0.5 rounded border border-success text-success hover:bg-success/10"
        >
          ＋ 権利根源を追加
        </button>
      ) : (
        <div className="rounded border border-primary/40 bg-primary/5 p-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <label className="space-y-0.5">
              <span className="text-[9px] text-muted-foreground">種別</span>
              <NativeSelect
                value={form.source_type}
                onChange={(e) => setForm((f: any) => ({ ...f, source_type: e.target.value }))}
                className="h-7 text-[11px]"
              >
                {SOURCE_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </NativeSelect>
            </label>
            <label className="space-y-0.5">
              <span className="text-[9px] text-muted-foreground">役割</span>
              <NativeSelect
                value={form.source_role}
                onChange={(e) => setForm((f: any) => ({ ...f, source_role: e.target.value }))}
                className="h-7 text-[11px]"
              >
                {SOURCE_ROLES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </NativeSelect>
            </label>
          </div>

          {form.source_type === "direct_contract" && (
            <EntityCombobox
              entity="vendor"
              value={form.rights_holder_vendor_id || null}
              onSelect={(opt) => setForm((f: any) => ({ ...f, rights_holder_vendor_id: opt ? String(opt.id) : "" }))}
              placeholder="権利者（取引先）を検索"
            />
          )}
          {form.source_type === "work" && (
            <EntityCombobox
              items={workItems}
              value={form.source_work_id || null}
              onSelect={(opt) => setForm((f: any) => ({ ...f, source_work_id: opt ? String(opt.id) : "" }))}
              placeholder="根源作品を検索"
            />
          )}
          {form.source_type === "custom" && (
            <input
              value={form.fee_subject_name}
              onChange={(e) => setForm((f: any) => ({ ...f, fee_subject_name: e.target.value }))}
              placeholder="権利者名・利用料名目"
              className="w-full text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
            />
          )}

          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              className="h-3 w-3 accent-primary"
              checked={form.is_primary}
              onChange={(e) => setForm((f: any) => ({ ...f, is_primary: e.target.checked }))}
            />
            主要な権利根源にする（他の主要根源は解除されます）
          </label>

          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => { setOpen(false); setForm(emptyForm()) }}
              disabled={saving}
              className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="text-[10px] px-2 py-0.5 rounded border border-success bg-success/10 text-success font-bold disabled:opacity-50"
            >
              {saving ? "追加中…" : "追加"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export const WorkRightsSourceSection: React.FC = () => {
  const {
    work, materials, upstream, isSource, products, sourceWorks, linkEdge,
    showNewSource, setShowNewSource, newSourceTitle, setNewSourceTitle, creatingSource, createSource,
    rightsSources, rightsSourcesLoading,
  } = useWorkDetail()

  if (!work) return <EmptyState title="作品を選択してください" />

  // マテリアル別に権利根源をグルーピング。
  const byMaterial = React.useMemo(() => {
    const m = new Map<number, any[]>()
    for (const s of rightsSources) {
      const k = Number(s.material_id)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(s)
    }
    return m
  }, [rightsSources])

  return (
    <div className="space-y-5">
      {/* 権利根源（マテリアル別）*/}
      <section className="rounded-md border border-border p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
            権利根源（マテリアル別）
          </span>
          <Badge variant="outline" className="border-success/40 text-success">
            マテリアル {materials.length}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground -mt-1">
          各マテリアルの権利がどこ由来か（取引先・派生元作品・自社保有 等）を登録します。主要根源は利用料名目・データ品質の基準になります。
        </p>
        {rightsSourcesLoading ? (
          <p className="text-[11px] text-muted-foreground">読み込み中…</p>
        ) : materials.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            マテリアルがありません。③マテリアルで素材を追加してください。
          </p>
        ) : (
          <div className="space-y-2">
            {materials.map((m: any) => (
              <MaterialRightsBlock key={m.id} material={m} sources={byMaterial.get(Number(m.id)) || []} />
            ))}
          </div>
        )}
      </section>

      {/* 原作 / 調達（支払）*/}
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
    </div>
  )
}

export default WorkRightsSourceSection
