/**
 * MaterialEntryPanel — 原作マテリアル(work_materials)の登録・管理フォーム。
 *
 * 設計(モック master_forms_mock.html ③④)に沿った「解説付き・外部キーは ID 検索」の入力欄。
 * 原作マテリアルは金銭条件を付帯必須とし、取引形態は利用許諾条件書と同じ固定3種
 * (V3_FIXED_DEALS)から選ぶ(＝軸を揃える→過去条件の引用・A+B 合算が成立)。
 *
 * マテリアル登録 ≒ 文書作成。「文書」欄は以下の優先で器(capability)を決める:
 *   ① 既存文書を検索(DocumentNumberLookup)     → その文書番号の器へ
 *   ③ 文書リンク(従前の締結済み契約 URL)        → ARC-ILT を発番し document_url に保存
 *   ② 発番トグル                                → ARC-ILT を発番(DB登録のみ・PDFなし)
 *   ④ いずれも空                                → 原作ごとの MLC- 器(マスター登録)
 * ①〜③は任意。空入力でも ④ に落ちて必ず登録できる。
 *
 * 金銭条件は先頭行の POST 応答で capability_id を受け取り、残り行は同 capability_id で
 * 送って「1マテリアル=1文書」を守る(発番の重複を防ぐ)。
 *
 * 管理モード(mode='manage'): 原作配下の素材を一覧し、完成度・参照(文書/条件明細)を表示。
 *   編集(PUT で属性更新・金銭条件を追記) / 安全削除(参照ありは 409→強制確認)で
 *   試験作成の空データを掃除する。コード(material_code)は不変。
 */

import * as React from "react"
import { Loader2, Plus, Trash2, FileText, Pencil, X } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WorkPicker, toWorkPickerItem, type WorkPickerItem } from "@/src/components/work/WorkPicker"
import { VendorSearchSelect } from "@/src/components/document/VendorSearchSelect"
import { DocumentNumberLookup, type LookedUpDocument } from "@/src/components/document/DocumentNumberLookup"
import { V3_FIXED_DEALS, V3_CALC_MODELS } from "@/src/components/document/V3LicenseMatrix"

// ── 選択肢(モック③に準拠) ──────────────────────────────────────────────
const MATERIAL_TYPES = ["illustration", "scenario", "design", "music", "text"]
const MATERIAL_ROLES: Array<{ v: string; label: string }> = [
  { v: "core_logic", label: "core_logic（中核）" },
  { v: "sub_component", label: "sub_component（構成要素）" },
]
const RIGHTS_TYPES = ["owned", "copyright_assignment", "license", "joint"]
const ACQUISITION_TYPES = ["", "license", "buyout_commission", "in_house"]

const calcLabel = (t?: string) => V3_CALC_MODELS.find((m) => m.value === t)?.label || t || ""

// 金銭条件1行(固定3種のいずれかを選び、料率/MG/AG/通貨/地域/言語を持つ)。
type CondRow = {
  key: string
  dealId: number // V3_FIXED_DEALS.id (1/2/3)
  rate_pct: string
  mg_amount: string
  ag_amount: string
  currency: string
  region_territory: string
  region_language: string
}
let _rowSeq = 0
const newCondRow = (dealId = 1): CondRow => ({
  key: `c${++_rowSeq}`,
  dealId,
  rate_pct: "",
  mg_amount: "",
  ag_amount: "",
  currency: "JPY",
  region_territory: "全世界",
  region_language: "全言語",
})

type Refs = { condition_lines: number; documents: number }

// 小さなラベル+解説の共通ラッパ。
function Field(props: { label: string; col?: string; help?: string; req?: boolean; auto?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2 flex-wrap">
        <label className="font-mono text-[11px] font-bold">{props.label}</label>
        {props.req && <span className="text-[10px] font-mono font-bold text-rose-600">*必須</span>}
        {props.col && (
          <span className="font-mono text-[8.5px] text-muted-foreground border border-border rounded px-1 bg-muted/40">{props.col}</span>
        )}
        {props.auto && <span className="font-mono text-[8.5px] text-amber-600 border border-amber-500 rounded px-1">自動採番</span>}
      </div>
      {props.help && <p className="font-mono text-[9.5px] text-muted-foreground leading-snug">{props.help}</p>}
      {props.children}
    </div>
  )
}

const selCls =
  "w-full h-8 rounded-md border border-border bg-background px-2.5 text-[12px] font-mono focus:outline-none focus:ring-1 focus:ring-ring"

export function MaterialEntryPanel() {
  const { vendors, showNotification } = useAppData() as any

  const [mode, setMode] = React.useState<"create" | "manage">("create")

  // 原作(source-ips = works kind='licensed_in')。金銭条件の器は原作配下に作るため原作限定。
  const [sources, setSources] = React.useState<any[]>([])
  const [workId, setWorkId] = React.useState<string>("")

  // 属性(create/edit 共用)
  const [editingId, setEditingId] = React.useState<number | null>(null)
  const [editingCode, setEditingCode] = React.useState<string>("")
  const [materialName, setMaterialName] = React.useState("")
  const [materialType, setMaterialType] = React.useState("illustration")
  const [materialRole, setMaterialRole] = React.useState("sub_component")
  const [rightsType, setRightsType] = React.useState("license")
  const [acquisitionType, setAcquisitionType] = React.useState("")
  const [rightsVendorCode, setRightsVendorCode] = React.useState("")
  const [rightsVendorId, setRightsVendorId] = React.useState<number | null>(null)
  const [rightsHolderLabel, setRightsHolderLabel] = React.useState("")
  const [isRoyaltyBearing, setIsRoyaltyBearing] = React.useState(true)
  const [scope, setScope] = React.useState("")
  const [remarks, setRemarks] = React.useState("")

  // 金銭条件(固定3種)。新規は付帯必須で1行、編集は既存があれば追記のみ(0行スタート)。
  const [conds, setConds] = React.useState<CondRow[]>([newCondRow(1)])

  // 文書欄(①検索 / ②発番 / ③リンク / ④空)
  const [pickedDoc, setPickedDoc] = React.useState<LookedUpDocument | null>(null)
  const [issueToggle, setIssueToggle] = React.useState(false)
  const [fileLink, setFileLink] = React.useState("")

  const [saving, setSaving] = React.useState(false)

  // 管理モード
  const [materials, setMaterials] = React.useState<any[]>([])
  const [refsById, setRefsById] = React.useState<Record<number, Refs>>({})
  const [listLoading, setListLoading] = React.useState(false)

  React.useEffect(() => {
    fetch("/api/v3/source-ips")
      .then((r) => r.json())
      .then((d) => setSources(Array.isArray(d) ? d : []))
      .catch(() => setSources([]))
  }, [])

  const pickerItems: WorkPickerItem[] = React.useMemo(
    () => sources.map((s) => toWorkPickerItem(s, { code: s.source_code || s.work_code, sub: "原作" })),
    [sources]
  )
  const selectedSource = React.useMemo(() => sources.find((s) => String(s.id) === workId) || null, [sources, workId])

  const addCond = () => setConds((cs) => [...cs, newCondRow(1)])
  const removeCond = (key: string) => setConds((cs) => cs.filter((c) => c.key !== key))
  const patchCond = (key: string, patch: Partial<CondRow>) =>
    setConds((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)))

  const resetForm = () => {
    setEditingId(null)
    setEditingCode("")
    setMaterialName("")
    setMaterialType("illustration")
    setMaterialRole("sub_component")
    setRightsType("license")
    setAcquisitionType("")
    setRightsVendorCode("")
    setRightsVendorId(null)
    setRightsHolderLabel("")
    setIsRoyaltyBearing(true)
    setScope("")
    setRemarks("")
    setConds([newCondRow(1)])
    setPickedDoc(null)
    setIssueToggle(false)
    setFileLink("")
  }

  // ── 管理モード: 一覧 + 参照読み込み ──────────────────────────────────
  const loadMaterials = React.useCallback(async (wid: string) => {
    if (!wid) {
      setMaterials([])
      setRefsById({})
      return
    }
    setListLoading(true)
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(wid)}/materials`)
      const rows = await r.json()
      const list = Array.isArray(rows) ? rows : []
      setMaterials(list)
      // 参照件数(文書/条件明細)を並列取得。件数は掃除対象を見極める補助表示。
      const entries = await Promise.all(
        list.map(async (m: any) => {
          try {
            const rr = await fetch(`/api/v3/work-materials/${m.id}/references`)
            const j = await rr.json()
            return [m.id, { condition_lines: j.condition_lines || 0, documents: j.documents || 0 }] as const
          } catch {
            return [m.id, { condition_lines: 0, documents: 0 }] as const
          }
        })
      )
      setRefsById(Object.fromEntries(entries))
    } catch {
      setMaterials([])
      setRefsById({})
    } finally {
      setListLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (mode === "manage") loadMaterials(workId)
  }, [mode, workId, loadMaterials])

  // 編集開始: 属性を prefill。金銭条件は「追記のみ」(既存は一覧/参照で確認)。
  const startEdit = (m: any) => {
    setEditingId(m.id)
    setEditingCode(m.material_code || "")
    setMaterialName(m.material_name || "")
    setMaterialType(m.material_type || "illustration")
    setMaterialRole(m.material_role || "sub_component")
    setRightsType(m.rights_type || "license")
    setAcquisitionType(m.acquisition_type || "")
    setRightsVendorCode("")
    setRightsVendorId(m.rights_holder_vendor_id ?? null)
    setRightsHolderLabel(m.rights_holder_label || "")
    setIsRoyaltyBearing(!!m.is_royalty_bearing)
    setScope(m.scope || "")
    setRemarks(m.remarks || "")
    setConds([]) // 編集では金銭条件は追記のみ。必要なら「追加」で足す。
    setPickedDoc(null)
    setIssueToggle(false)
    setFileLink("")
    setMode("create")
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const deleteMaterial = async (m: any, force = false) => {
    try {
      const url = `/api/v3/work-materials/${m.id}${force ? "?force=true" : ""}`
      const r = await fetch(url, { method: "DELETE" })
      if (r.status === 409) {
        const info = await r.json().catch(() => ({} as any))
        const msg =
          `「${m.material_code || m.material_name || m.id}」は参照中です:\n` +
          `・条件明細(金銭条件): ${info.condition_lines ?? 0} 件\n` +
          `・文書(スナップショット): ${info.documents ?? 0} 件\n\n` +
          `強制削除しますか？（この素材の条件明細も一緒に削除＝不可逆。文書スナップショットは残ります）`
        if (!window.confirm(msg)) return
        return deleteMaterial(m, true)
      }
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e?.error || `HTTP ${r.status}`)
      }
      const j = await r.json()
      showNotification?.(
        `削除しました: ${m.material_code || m.material_name}${j.deleted_condition_lines ? `（条件明細 ${j.deleted_condition_lines} 件も削除）` : ""}`,
        "success"
      )
      await loadMaterials(workId)
    } catch (e: any) {
      showNotification?.(`削除に失敗: ${String(e?.message || e)}`, "error")
    }
  }

  // 文書欄→condition-lines の器指定 payload(先頭行のみ渡す)。
  const docPayload = (): Record<string, any> => {
    if (pickedDoc?.document_number) return { document_number: pickedDoc.document_number }
    const link = fileLink.trim()
    if (link) return { issue_document: true, file_link: link }
    if (issueToggle) return { issue_document: true }
    return {} // ④ MLC フォールバック
  }

  // 金銭条件を順に登録(先頭で器を確定し残りは capability_id 再利用)。mid 宛。
  const postConditions = async (mid: number): Promise<string> => {
    let capabilityId: number | null = null
    let docNumber = ""
    for (let i = 0; i < conds.length; i++) {
      const c = conds[i]
      const deal = V3_FIXED_DEALS.find((d) => d.id === c.dealId) || V3_FIXED_DEALS[0]
      const body: Record<string, any> = {
        payment_scheme: "royalty",
        subject: deal.name,
        rate_pct: c.rate_pct || null,
        mg_amount: c.mg_amount || null,
        ag_amount: c.ag_amount || null,
        region_territory: c.region_territory || null,
        region_language: c.region_language || null,
        notes: `取引形態: ${deal.name} / 計算モデル: ${calcLabel(deal.calc_type)}`,
      }
      if (i === 0) Object.assign(body, docPayload())
      else if (capabilityId != null) body.capability_id = capabilityId

      const r = await fetch(`/api/v3/source-ips/${encodeURIComponent(workId)}/materials/${mid}/condition-lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e?.error || `金銭条件 #${i + 1} の登録に失敗 (HTTP ${r.status})`)
      }
      const j = await r.json()
      if (i === 0) {
        capabilityId = j.capability_id ?? null
        docNumber = j.document_number || ""
      }
    }
    return docNumber
  }

  const submit = async () => {
    if (!workId) return showNotification?.("所属する原作を選択してください。", "error")
    if (!materialName.trim()) return showNotification?.("素材名を入力してください。", "error")
    const link = fileLink.trim()
    if (link && !/^https:\/\//i.test(link)) {
      return showNotification?.("文書リンクは https:// で始まる URL を入力してください。", "error")
    }
    // 新規は金銭条件を付帯必須。編集は追記のみ(0行可)。
    if (!editingId && conds.length === 0) {
      return showNotification?.("原作マテリアルには金銭条件が付帯必須です(1件以上)。", "error")
    }
    setSaving(true)
    try {
      const attrs = {
        material_name: materialName.trim(),
        material_type: materialType,
        material_role: materialRole,
        rights_type: rightsType,
        acquisition_type: acquisitionType || undefined,
        rights_holder_vendor_id: rightsVendorId ?? undefined,
        rights_holder_label: rightsHolderLabel.trim() || undefined,
        is_royalty_bearing: isRoyaltyBearing,
        scope: scope.trim() || undefined,
        remarks: remarks.trim() || undefined,
      }

      if (editingId) {
        // 編集: 属性を PUT(コード不変)。金銭条件は追記行があれば POST。
        const uRes = await fetch(`/api/v3/work-materials/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(attrs),
        })
        if (!uRes.ok) {
          const e = await uRes.json().catch(() => ({}))
          throw new Error(e?.error || `マテリアル更新に失敗 (HTTP ${uRes.status})`)
        }
        let docNumber = ""
        if (conds.length > 0) docNumber = await postConditions(editingId)
        showNotification?.(
          `更新しました: ${editingCode}${conds.length ? `（金銭条件 ${conds.length} 件を追記 / 文書: ${docNumber || "MLC"}）` : ""}`,
          "success"
        )
        resetForm()
        setMode("manage")
        await loadMaterials(workId)
      } else {
        // 新規: マテリアル作成 → 金銭条件登録。
        const mRes = await fetch(`/api/v3/works/${encodeURIComponent(workId)}/materials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(attrs),
        })
        if (!mRes.ok) {
          const e = await mRes.json().catch(() => ({}))
          throw new Error(e?.error || `マテリアル作成に失敗 (HTTP ${mRes.status})`)
        }
        const material = await mRes.json()
        const docNumber = await postConditions(material.id)
        showNotification?.(
          `マテリアルを登録しました: ${material.material_code}（金銭条件 ${conds.length} 件 / 文書: ${docNumber || "MLC マスター登録"}）`,
          "success"
        )
        resetForm()
      }
    } catch (e: any) {
      showNotification?.(String(e?.message || e), "error")
    } finally {
      setSaving(false)
    }
  }

  // 完成度バッジ。名称なし=空 / 金銭条件0=金銭条件なし / それ以外=完成。
  const completeness = (m: any) => {
    const refs = refsById[m.id]
    if (!m.material_name || !String(m.material_name).trim()) return { label: "⛔ 空", cls: "text-rose-600 border-rose-500 bg-rose-500/10" }
    if (refs && refs.condition_lines === 0) return { label: "⚠ 金銭条件なし", cls: "text-amber-600 border-amber-500 bg-amber-500/10" }
    return { label: "✓ 完成", cls: "text-emerald-600 border-emerald-500 bg-emerald-500/10" }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="retro-tag mb-1.5">MST · MATERIAL ENTRY</p>
        <h3 className="text-lg font-mono font-bold">原作マテリアル 登録・管理（work_materials）</h3>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          原作にぶら下がる素材。金銭条件を付帯必須で登録し、結合キー material_code は自動採番。
        </p>
        <div className="flex gap-2 mt-3">
          <Button
            variant={mode === "create" ? "default" : "outline"}
            size="sm"
            className="font-mono text-[11px]"
            onClick={() => { setMode("create"); if (editingId) resetForm() }}
          >
            {editingId ? "編集中" : "新規登録"}
          </Button>
          <Button
            variant={mode === "manage" ? "default" : "outline"}
            size="sm"
            className="font-mono text-[11px]"
            onClick={() => setMode("manage")}
          >
            管理・編集
          </Button>
        </div>
      </div>

      {/* 原作セレクタ(両モード共通) */}
      <div className="rounded-xl border border-border bg-card p-4">
        <Field
          label="所属する原作"
          col="work_id → works.id"
          req
          help="この素材が属する原作(licensed_in)を検索。material_code の接頭辞になる。金銭条件は原作配下の器に登録する。"
        >
          <WorkPicker
            items={pickerItems}
            value={workId}
            onSelect={(it) => setWorkId(it?.id || "")}
            placeholder="原作コード / タイトル / 別名 で検索"
            disabled={!!editingId}
          />
        </Field>
      </div>

      {mode === "manage" ? (
        <div className="rounded-xl border border-border border-t-[3px] border-t-rose-500 bg-card p-5 space-y-3">
          <h4 className="font-mono text-[13px] font-bold text-rose-600">管理・編集（空データのクリーンアップ）</h4>
          <p className="font-mono text-[9.5px] text-muted-foreground leading-snug">
            既存レコードを一覧→編集(属性更新・金銭条件追記) / 安全削除。コード(material_code)は不変=結合キー。
            削除は参照(文書 form_data / 条件明細)をチェックし、参照ありは強制確認。文書スナップショットは残る。
          </p>
          {!workId ? (
            <p className="font-mono text-[11px] text-muted-foreground py-4">原作を選択してください。</p>
          ) : listLoading ? (
            <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 読み込み中…
            </div>
          ) : materials.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground py-4">この原作に素材はありません。</p>
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full font-mono text-[10.5px]">
                <thead>
                  <tr className="bg-muted/40 text-muted-foreground">
                    <th className="text-left px-2 py-1.5 font-semibold">コード</th>
                    <th className="text-left px-2 py-1.5 font-semibold">名称</th>
                    <th className="text-left px-2 py-1.5 font-semibold">金銭条件</th>
                    <th className="text-left px-2 py-1.5 font-semibold">完成度</th>
                    <th className="text-left px-2 py-1.5 font-semibold">参照(文書/条件)</th>
                    <th className="text-right px-2 py-1.5 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {materials.map((m) => {
                    const refs = refsById[m.id]
                    const comp = completeness(m)
                    return (
                      <tr key={m.id} className="border-t border-border">
                        <td className="px-2 py-1.5 text-sky-700">{m.material_code || `#${m.id}`}</td>
                        <td className={`px-2 py-1.5 ${!m.material_name ? "text-rose-600" : ""}`}>
                          {m.material_name || "（名称なし）"}
                        </td>
                        <td className="px-2 py-1.5">{refs ? `${refs.condition_lines} 件` : "…"}</td>
                        <td className="px-2 py-1.5">
                          <span className={`inline-block border rounded px-1.5 py-0.5 text-[8.5px] font-bold ${comp.cls}`}>{comp.label}</span>
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {refs ? `文書 ${refs.documents} / 条件 ${refs.condition_lines}` : "…"}
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 border border-sky-500 text-sky-600 rounded px-1.5 py-0.5 mr-1 hover:bg-sky-500/10"
                            onClick={() => startEdit(m)}
                          >
                            <Pencil className="h-3 w-3" /> 編集
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 border border-rose-500 text-rose-600 rounded px-1.5 py-0.5 hover:bg-rose-500/10"
                            onClick={() => deleteMaterial(m)}
                          >
                            <Trash2 className="h-3 w-3" /> 削除
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
          {editingId && (
            <div className="flex items-center gap-2 rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-2 font-mono text-[11px]">
              <Pencil className="h-3.5 w-3.5 text-sky-600" />
              編集中: <b>{editingCode}</b>（コードは不変。金銭条件は下で追記できます）
              <button type="button" className="ml-auto text-muted-foreground hover:text-destructive inline-flex items-center gap-1" onClick={() => { resetForm(); setMode("manage") }}>
                <X className="h-3.5 w-3.5" /> 編集をやめる
              </button>
            </div>
          )}

          {/* 属性 */}
          <div className="rounded-xl border border-border border-t-[3px] border-t-violet-500 bg-card p-5 space-y-4">
            <Field label="素材コード" col="material_code" auto={!editingId} help="〈原作コード〉-NNN で登録時に自動採番。手入力不可・不変。">
              <div className={`${selCls} flex items-center text-muted-foreground`}>
                {editingId
                  ? editingCode
                  : selectedSource
                    ? `（登録時に自動: ${selectedSource.source_code || selectedSource.work_code}-NNN）`
                    : "（原作を選ぶと採番プレビュー）"}
              </div>
            </Field>

            <Field label="素材名" col="material_name" req>
              <Input value={materialName} onChange={(e) => setMaterialName(e.target.value)} placeholder="例: New ito 用イラスト" className="h-8 text-[12px]" />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="種別（ジャンル）" col="material_type">
                <select className={selCls} value={materialType} onChange={(e) => setMaterialType(e.target.value)}>
                  {MATERIAL_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
              </Field>
              <Field label="役割" col="material_role" help="core_logic=中核 / sub_component=構成要素">
                <select className={selCls} value={materialRole} onChange={(e) => setMaterialRole(e.target.value)}>
                  {MATERIAL_ROLES.map((r) => (<option key={r.v} value={r.v}>{r.label}</option>))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="権利区分" col="rights_type">
                <select className={selCls} value={rightsType} onChange={(e) => setRightsType(e.target.value)}>
                  {RIGHTS_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
              </Field>
              <Field label="取得経路" col="acquisition_type" help="未指定で rights_type から自動推定。">
                <select className={selCls} value={acquisitionType} onChange={(e) => setAcquisitionType(e.target.value)}>
                  {ACQUISITION_TYPES.map((t) => (<option key={t || "auto"} value={t}>{t || "（自動推定）"}</option>))}
                </select>
              </Field>
            </div>

            <Field label="権利元（取引先）" col="rights_holder_vendor_id" help="権利者を取引先マスタから ID 検索。未登録なら下のラベルで手書き。">
              <VendorSearchSelect
                vendors={vendors || []}
                selectedCode={rightsVendorCode}
                onSelect={(v) => { setRightsVendorCode(v?.vendor_code || ""); setRightsVendorId(v?.id ?? null) }}
              />
              {editingId && rightsVendorId != null && !rightsVendorCode && (
                <p className="font-mono text-[9px] text-muted-foreground">現在の権利元 vendor ID: {rightsVendorId}（変更する場合のみ選択）</p>
              )}
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="権利元ラベル" col="rights_holder_label" help="vendor 未登録時の表記(任意)。">
                <Input value={rightsHolderLabel} onChange={(e) => setRightsHolderLabel(e.target.value)} placeholder="（任意）" className="h-8 text-[12px]" />
              </Field>
              <Field label="ロイヤリティ対象" col="is_royalty_bearing">
                <label className="flex items-center gap-2 h-8 font-mono text-[11px]">
                  <input type="checkbox" checked={isRoyaltyBearing} onChange={(e) => setIsRoyaltyBearing(e.target.checked)} />
                  {isRoyaltyBearing ? "対象（ロイヤリティあり）" : "対象外"}
                </label>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="利用範囲" col="scope">
                <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="（任意）" className="h-8 text-[12px]" />
              </Field>
              <Field label="備考" col="remarks">
                <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="（任意）" className="h-8 text-[12px]" />
              </Field>
            </div>
          </div>

          {/* 金銭条件(固定3種) */}
          <div className="rounded-xl border border-border border-t-[3px] border-t-violet-500 bg-card p-5 space-y-4">
            <div>
              <h4 className="font-mono text-[13px] font-bold text-violet-600">
                金銭条件{editingId ? "（追記）" : "（この素材の初回登録＝L1）"}
              </h4>
              <p className="font-mono text-[9.5px] text-muted-foreground leading-snug mt-1">
                {editingId
                  ? "編集モードでは金銭条件は追記のみ(既存は管理一覧の「条件」件数で確認)。追加不要なら空でも保存できます。"
                  : "素材には金銭条件を付帯必須。取引形態は利用許諾条件書と同じ固定3種から選ぶ(＝軸を揃える)。取引形態ごとに1行。"}
              </p>
            </div>

            {/* 文書欄 */}
            {conds.length > 0 && (
              <div className="rounded-lg border border-dashed border-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/20 p-3 space-y-2">
                <Field
                  label="文書（この素材の利用許諾条件書）"
                  col="capability_id / document_number"
                  help="マテリアル登録＝文書作成。既存があれば検索して紐づけ、無ければ ARC-ILT を発番して新規登録(DB登録のみ・PDFなし)。空なら原作ごとの MLC- 器に登録。"
                >
                  <DocumentNumberLookup
                    filterTemplateTypes={["individual_license_terms"]}
                    onApply={(d) => setPickedDoc(d)}
                    placeholder="ARC-ILT / 件名 で検索"
                    includeMaster
                  />
                </Field>
                {pickedDoc && (
                  <div className="flex items-center gap-2 font-mono text-[11px] bg-background border border-border rounded px-2 py-1">
                    <FileText className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                    <span className="font-bold">{pickedDoc.document_number}</span>
                    <span className="text-muted-foreground truncate">{pickedDoc.derived_title}</span>
                    <button type="button" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setPickedDoc(null)}>解除</button>
                  </div>
                )}
                {!pickedDoc && (
                  <>
                    <label className="flex items-center gap-2 font-mono text-[10px]">
                      <input type="checkbox" checked={issueToggle} onChange={(e) => setIssueToggle(e.target.checked)} />
                      見つからなければ <b>ARC-ILT を発番して登録</b>（documents 器 + condition_lines を作成）
                    </label>
                    <Field label="文書リンク（従前の締結済み契約 PDF・任意）" col="file_link → document_url" help="従前に契約がある場合、締結済み PDF/Drive の URL を貼ると新規 PDF を作らずそのリンクで登録(https:// 始まり)。">
                      <Input value={fileLink} onChange={(e) => setFileLink(e.target.value)} placeholder="https://drive.google.com/…（任意）" className="h-8 text-[12px]" />
                    </Field>
                  </>
                )}
              </div>
            )}

            {/* 条件行 */}
            {conds.map((c, idx) => {
              const deal = V3_FIXED_DEALS.find((d) => d.id === c.dealId) || V3_FIXED_DEALS[0]
              return (
                <div key={c.key} className="rounded-lg border border-violet-400 bg-violet-50/40 dark:bg-violet-950/20 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[9.5px] font-bold text-violet-600">条件 #{idx + 1}</span>
                    <button type="button" className="text-rose-600 hover:text-rose-700" onClick={() => removeCond(c.key)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="取引形態" col="固定3種">
                      <select className={selCls} value={c.dealId} onChange={(e) => patchCond(c.key, { dealId: Number(e.target.value) })}>
                        {V3_FIXED_DEALS.map((d, i) => (
                          <option key={d.id} value={d.id}>{["①", "②", "③"][i] || ""} {d.name}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="計算モデル" help="取引形態に紐づき自動。">
                      <div className={`${selCls} flex items-center text-emerald-600 font-bold`}>{calcLabel(deal.calc_type)}</div>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Field label="料率(%)" col="rate_pct">
                      <Input value={c.rate_pct} onChange={(e) => patchCond(c.key, { rate_pct: e.target.value })} placeholder="5" className="h-8 text-[12px]" />
                    </Field>
                    <Field label="MG" col="mg_amount">
                      <Input value={c.mg_amount} onChange={(e) => patchCond(c.key, { mg_amount: e.target.value })} placeholder="0" className="h-8 text-[12px]" />
                    </Field>
                    <Field label="AG" col="ag_amount">
                      <Input value={c.ag_amount} onChange={(e) => patchCond(c.key, { ag_amount: e.target.value })} placeholder="0" className="h-8 text-[12px]" />
                    </Field>
                    <Field label="通貨" col="currency">
                      <Input value={c.currency} onChange={(e) => patchCond(c.key, { currency: e.target.value })} placeholder="JPY" className="h-8 text-[12px]" />
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="地域" col="region_territory">
                      <Input value={c.region_territory} onChange={(e) => patchCond(c.key, { region_territory: e.target.value })} placeholder="全世界" className="h-8 text-[12px]" />
                    </Field>
                    <Field label="言語" col="region_language">
                      <Input value={c.region_language} onChange={(e) => patchCond(c.key, { region_language: e.target.value })} placeholder="全言語" className="h-8 text-[12px]" />
                    </Field>
                  </div>
                </div>
              )
            })}

            <Button variant="outline" size="sm" onClick={addCond} className="font-mono text-[11px]">
              <Plus className="h-3.5 w-3.5" />
              金銭条件を追加
            </Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={resetForm} disabled={saving} className="font-mono text-[11px]">
              クリア
            </Button>
            <Button size="sm" onClick={submit} disabled={saving} className="font-mono text-[11px]">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {editingId ? "変更を保存" : "マテリアルを登録"}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export default MaterialEntryPanel
