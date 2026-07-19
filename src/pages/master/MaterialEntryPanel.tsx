/**
 * MaterialEntryPanel — 原作マテリアル(work_materials)の登録・編集・管理。
 *
 * 入口は「検索が先」: 原作を選ぶ → その配下の既存素材を一覧/検索して選ぶ(→編集・削除) か、
 * 無ければ「新規マテリアルを作成」(→登録)。試験作成の空データ掃除もこの一覧から行う。
 *
 * 原作マテリアルは金銭条件を付帯必須とし、取引形態は利用許諾条件書と同じ固定3種
 * (V3_FIXED_DEALS)から選ぶ(＝軸を揃える→過去条件の引用・A+B 合算が成立)。
 *
 * マテリアル登録 ≒ 文書作成。「文書」欄は以下の優先で器(capability)を決める:
 *   ① 既存文書を検索(DocumentNumberLookup)     → その文書番号の器へ
 *   ③ 文書リンク(従前の締結済み契約 URL)        → ARC-ILT を発番し document_url に保存
 *   ② 発番トグル                                → ARC-ILT を発番(DB登録のみ・PDFなし)
 *   ④ いずれも空                                → 実在の条件書(ARC-ILT/PUBT)を自動発番(合成MLC器は廃止)
 * ①〜③は任意。空入力でも ④ に落ちて必ず登録できる。先頭の金銭条件で器を確定し、
 * 残り行は返却 capability_id を再利用して「1マテリアル=1文書」を守る。
 *
 * 安全削除: 文書(form_data スナップショット)/条件明細(condition_lines)から参照中は 409 でブロック
 * →強制確認。コード(material_code)は不変。
 */

import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, Plus, Trash2, FileText, Pencil, X, Search, FileOutput, Link2 } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WorkPicker, toWorkPickerItem, type WorkPickerItem } from "@/src/components/work/WorkPicker"
import { VendorSearchSelect } from "@/src/components/document/VendorSearchSelect"
import { DocumentNumberLookup, type LookedUpDocument } from "@/src/components/document/DocumentNumberLookup"
import { MATERIAL_GENRES, normalizeGenre } from "@/lib/materialVocab"
import { evaluateEntity } from "@/src/lib/api/dataQualityClient"

// 種別(ジャンル)は正準語彙 MATERIAL_GENRES(lib/materialVocab)を使う(ゲームデザイン等を含む)。
//   旧来のローカル固定リストは廃止し、3ファイル同期の正準ジャンルへ一本化。
const MATERIAL_ROLES: Array<{ v: string; label: string }> = [
  { v: "core_logic", label: "core_logic（中核）" },
  { v: "sub_component", label: "sub_component（構成要素）" },
]
const RIGHTS_TYPES = ["owned", "copyright_assignment", "license", "joint"]
const ACQUISITION_TYPES = ["", "license", "buyout_commission", "in_house"]

// UIC-03: 金銭条件エディタ(固定3種の CondRow/取引形態ラベル/計算モデル表示)は撤去。
//   条件値の作成・修正は文書フォームへ一本化したため、関連の定数・型はここでは持たない。

type Refs = { condition_lines: number; documents: number }

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
  const navigate = useNavigate()

  // 検索ゲート: 原作選択 → 一覧(既存を選ぶ) / 新規作成。
  const [view, setView] = React.useState<"gate" | "form">("gate")

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
  // 許諾地域・言語(枠)。work_materials.territory/language。1-3 で表示。
  const [territory, setTerritory] = React.useState("")
  const [language, setLanguage] = React.useState("")

  // UIC-03: 編集時に既存条件を read-only 表示するための状態(書込みはしない)。
  const [existingConds, setExistingConds] = React.useState<any[]>([])
  const [existingLoading, setExistingLoading] = React.useState(false)

  const [pickedDoc, setPickedDoc] = React.useState<LookedUpDocument | null>(null)
  const [fileLink, setFileLink] = React.useState("")
  // CL引用(リンク方式): 選んだ文書(発注書等)配下の「未リンクの利用許諾CL」=素材未割当の
  //   license 条件明細。値コピー(=二重作成)ではなく、既存CLをこの素材へ後付けリンクする。
  //   GET /api/v3/documents/:num/unlinked-license-conditions。
  const [unlinkedCLs, setUnlinkedCLs] = React.useState<any[]>([])
  const [unlinkedLoading, setUnlinkedLoading] = React.useState(false)
  // 文書種別: license=個別利用許諾条件書(ARC-ILT) / publication=出版等利用許諾条件書(ARC-PUBT)。
  //   固定3種の取引形態は出版にも流用(紙自社出版=①/電子出版=②/紙他社出版=③)。器のカテゴリと採番だけ切替。
  const [docKind, setDocKind] = React.useState<"license" | "publication">("license")
  // 出版の基本契約書(ARC-PUB): 条件書は基本契約番号を参照する。既存を検索して紐づけるか、無ければ先に作成。
  const [pubBaseDoc, setPubBaseDoc] = React.useState<LookedUpDocument | null>(null)
  const [pubBaseType, setPubBaseType] = React.useState<"individual" | "corporate">("individual")

  const [saving, setSaving] = React.useState(false)

  // 一覧
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

  // CL引用: 選んだ文書配下の「未リンクの利用許諾CL」を取得(発注書の受託者帰属条件など)。
  React.useEffect(() => {
    const num = pickedDoc?.document_number
    if (!num) { setUnlinkedCLs([]); return }
    let alive = true
    setUnlinkedLoading(true)
    fetch(`/api/v3/documents/${encodeURIComponent(num)}/unlinked-license-conditions`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: any) => { if (alive) setUnlinkedCLs(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (alive) setUnlinkedCLs([]) })
      .finally(() => { if (alive) setUnlinkedLoading(false) })
    return () => { alive = false }
  }, [pickedDoc?.document_number])

  // CL引用(リンク): 既存の未リンクCLをこの素材へ後付けリンク(source_material_id セット)。新規作成しない。
  const linkExistingCL = async (cl: any) => {
    if (!editingId) {
      showNotification?.("先に「マテリアルを登録」で素材を保存してから紐づけてください（既存CLのリンクには保存済みの素材が必要です）。", "error")
      return
    }
    try {
      const r = await fetch(
        `/api/v3/source-ips/${encodeURIComponent(workId)}/materials/${editingId}/link-conditions`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ condition_line_ids: [cl.id] }) }
      )
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok || !(Number(j.linked) > 0)) throw new Error(j.error || `HTTP ${r.status}`)
      setUnlinkedCLs((cs) => cs.filter((x) => x.id !== cl.id))
      showNotification?.(`既存の利用許諾条件(CL #${cl.id})をこの素材に紐づけました（新規作成なし＝二重化なし）。`, "success")
      await loadMaterials(workId)
    } catch (e: any) {
      showNotification?.(`リンクに失敗しました: ${String(e?.message || e)}`, "error")
    }
  }

  const clearFields = () => {
    setEditingId(null); setEditingCode("")
    setMaterialName(""); setMaterialType("illustration"); setMaterialRole("sub_component")
    setRightsType("license"); setAcquisitionType("")
    setRightsVendorCode(""); setRightsVendorId(null); setRightsHolderLabel("")
    setIsRoyaltyBearing(true); setScope(""); setRemarks("")
    setTerritory(""); setLanguage("")
    setExistingConds([]); setExistingLoading(false)
    setPickedDoc(null); setFileLink(""); setDocKind("license")
    setPubBaseDoc(null); setPubBaseType("individual")
  }

  const loadMaterials = React.useCallback(async (wid: string) => {
    if (!wid) { setMaterials([]); setRefsById({}); return }
    setListLoading(true)
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(wid)}/materials`)
      const rows = await r.json()
      const list = Array.isArray(rows) ? rows : []
      setMaterials(list)
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
      setMaterials([]); setRefsById({})
    } finally {
      setListLoading(false)
    }
  }, [])

  // 原作を選んだら一覧を読み込み、ゲートに戻す。
  React.useEffect(() => {
    setView("gate")
    clearFields()
    loadMaterials(workId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, loadMaterials])

  const startNew = () => { clearFields(); setView("form") }

  const startEdit = (m: any) => {
    setEditingId(m.id)
    setEditingCode(m.material_code || "")
    setMaterialName(m.material_name || "")
    setMaterialType(normalizeGenre(m.material_type) || "illustration")
    setMaterialRole(m.material_role || "sub_component")
    setRightsType(m.rights_type || "license")
    setAcquisitionType(m.acquisition_type || "")
    setRightsVendorCode("")
    setRightsVendorId(m.rights_holder_vendor_id ?? null)
    setRightsHolderLabel(m.rights_holder_label || "")
    setIsRoyaltyBearing(!!m.is_royalty_bearing)
    setScope(m.scope || "")
    setRemarks(m.remarks || "")
    setTerritory(m.territory || "")
    setLanguage(m.language || "")
    // UIC-03: 既存の金銭条件は read-only 表示のみ(このフォームでは編集しない)。
    setExistingConds([]); void loadExistingConds(m.id)
    setPickedDoc(null); setFileLink("")
    setView("form")
  }

  const backToGate = () => { clearFields(); setView("gate") }

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

  // UIC-03(設計 v1.4 Phase C): 条件の作成(postConditions)・全置換(putConditions)は撤去。
  //   条件値は「利用許諾条件書」文書フォーム(Document Command)でのみ作成・修正する。
  //   この画面は素材属性の CRUD と、既存条件の閲覧(read-only)＋既存CLのリンクに専念する。
  //   編集時の既存条件は read-only 表示のみ(GET は残置。書込みはしない)。
  const loadExistingConds = async (mid: number) => {
    setExistingLoading(true)
    try {
      const r = await fetch(
        `/api/v3/source-ips/${encodeURIComponent(workId)}/materials/${mid}/condition-lines`
      )
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const rows = await r.json()
      setExistingConds(Array.isArray(rows) ? rows : [])
    } catch {
      setExistingConds([])
    } finally {
      setExistingLoading(false)
    }
  }

  const jpToday = () => {
    const d = new Date()
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  }

  // 出版基本契約書(ARC-PUB)を先に作成する導線。許諾者(vendor)/締結日を prefill して pub_master フォームへ。
  //   基本契約は許諾者↔アークライトの契約(素材非依存)なので、素材作成は伴わない。
  const handoffToBaseContract = () => {
    if (!rightsVendorCode) {
      return showNotification?.("基本契約書の作成には、先に権利元(許諾者)を取引先マスタから選択してください。", "error")
    }
    const template = pubBaseType === "corporate" ? "pub_master_corporate" : "pub_master_individual"
    const prefill = {
      template,
      formData: {
        vendor_code: rightsVendorCode,
        契約締結日: jpToday(),
      },
    }
    sessionStorage.setItem("lb_material_prefill", JSON.stringify(prefill))
    showNotification?.("出版等許諾基本契約書の作成フォームへ移動します。生成後、その番号で条件書を作成してください。", "success")
    navigate(`/documents/new?template=${encodeURIComponent(template)}&prefill_material=1`)
  }

  // PDF出力: 素材＋金銭条件を文書フォームの formData へ写像し、sessionStorage 経由で受け渡す。
  //   ILT  = v3_conds(固定3種)/v3_lcs(構成要素×料率)、PUBT = 紙/電子の印税率フラット項目。
  //   翻訳は別権利(発注書由来)のため PUBT では常に「許諾しない」。言語/地域は許諾範囲・許諾言語で制御。
  // UIC-03: 条件値(料率など)は文書フォームで入力するため、prefill は素材・原作・当事者の
  //   コンテキストのみを引き継ぐ(条件明細は文書フォーム側で作成)。地域/言語は素材の枠(territory/language)から。
  const buildPrefill = (material: any): { template: string; formData: Record<string, any> } => {
    const src = selectedSource || {}
    const srcTitle = src.title || ""
    const ledgerCode = src.source_code || src.work_code || ""
    const common: Record<string, any> = {
      原著作物名: srcTitle,
      素材番号: material.material_code,
      ledger_code: ledgerCode,
      is_work_linked: true,
      許諾地域: territory.trim() || "",
      許諾言語: language.trim() || "",
      // 許諾者(取引先)を vendor_code で渡すと、フォームが dbField(vendor.*)で氏名/住所/口座を解決。
      vendor_code: rightsVendorCode || undefined,
    }
    if (docKind === "publication") {
      return {
        template: "pub_license_terms",
        formData: {
          ...common,
          対象出版物名: material.material_name || srcTitle,
          締結日: jpToday(),
          著作者名: rightsHolderLabel.trim() || "",
          基本契約番号: pubBaseDoc?.document_number || "",
        },
      }
    }
    return {
      template: "individual_license_terms",
      formData: {
        ...common,
        許諾範囲: scope || "",
        対象製品予定名: material.material_name || "",
        // 素材を構成要素(LC)として引き継ぐ(料率は文書フォームで入力)。
        v3_lcs: [
          {
            material_code: material.material_code,
            name: material.material_name || "",
            holder: rightsHolderLabel.trim() || "",
            rates: {},
            source_doc: "（この条件書・新規）",
          },
        ],
      },
    }
  }

  // PDF出力: 素材を作成/更新 → prefill を退避 → 文書フォームへ遷移。condition-lines は生成しない
  //   (文書フォームの generate が capability/明細/PDF を作り、material_code で素材へ連動)。
  const handoffToDocForm = async () => {
    if (!workId) return showNotification?.("所属する原作を選択してください。", "error")
    if (!materialName.trim()) return showNotification?.("素材名を入力してください。", "error")
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
        territory: territory.trim() || undefined,
        language: language.trim() || undefined,
      }
      let material: any
      if (editingId) {
        const uRes = await fetch(`/api/v3/work-materials/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(attrs),
        })
        if (!uRes.ok) {
          const e = await uRes.json().catch(() => ({}))
          throw new Error(e?.error || `マテリアル更新に失敗 (HTTP ${uRes.status})`)
        }
        material = { id: editingId, material_code: editingCode, material_name: materialName.trim() }
      } else {
        const mRes = await fetch(`/api/v3/works/${encodeURIComponent(workId)}/materials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(attrs),
        })
        if (!mRes.ok) {
          const e = await mRes.json().catch(() => ({}))
          throw new Error(e?.error || `マテリアル作成に失敗 (HTTP ${mRes.status})`)
        }
        material = await mRes.json()
      }
      const prefill = buildPrefill(material)
      sessionStorage.setItem("lb_material_prefill", JSON.stringify(prefill))
      showNotification?.(
        `マテリアル ${material.material_code} を保存しました。文書フォームで金銭条件を入力してください。`,
        "success"
      )
      navigate(`/documents/new?template=${encodeURIComponent(prefill.template)}&prefill_material=1`)
    } catch (e: any) {
      showNotification?.(String(e?.message || e), "error")
      setSaving(false)
    }
  }

  // UIC-03: 素材属性のみを保存(条件の作成・全置換は撤去)。条件は文書フォームで入力する。
  const submit = async () => {
    if (!workId) return showNotification?.("所属する原作を選択してください。", "error")
    if (!materialName.trim()) return showNotification?.("素材名を入力してください。", "error")
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
        territory: territory.trim() || undefined,
        language: language.trim() || undefined,
      }

      if (editingId) {
        const uRes = await fetch(`/api/v3/work-materials/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(attrs),
        })
        if (!uRes.ok) {
          const e = await uRes.json().catch(() => ({}))
          throw new Error(e?.error || `マテリアル更新に失敗 (HTTP ${uRes.status})`)
        }
        showNotification?.(`属性を更新しました: ${editingCode}（金銭条件は文書フォームで編集します）`, "success")
        // DQ 自動発火(§8.4): 保存した素材だけ差分再評価(MAT-ID-001/MAT-RGT-002)。worker 未反映でも degrade。
        await evaluateEntity("material", editingId)
      } else {
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
        showNotification?.(
          `マテリアルを登録しました: ${material.material_code}（金銭条件は文書フォームで登録してください）`,
          "success"
        )
        // DQ 自動発火(§8.4): 新規素材を差分再評価(MAT-ID-001/MAT-RGT-002)。
        if (material?.id != null) await evaluateEntity("material", Number(material.id))
      }
      await loadMaterials(workId)
      backToGate()
    } catch (e: any) {
      showNotification?.(String(e?.message || e), "error")
    } finally {
      setSaving(false)
    }
  }

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
        <h3 className="text-lg font-mono font-bold">原作マテリアル 登録・編集（work_materials）</h3>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          原作を選ぶ → 既存素材を検索して編集/削除、無ければ新規作成。金銭条件を付帯必須で登録し、結合キー material_code は自動採番・不変。
        </p>
      </div>

      {/* 原作セレクタ(入口の検索) */}
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
            disabled={view === "form" && !!editingId}
          />
        </Field>
      </div>

      {!workId ? (
        <p className="font-mono text-[11px] text-muted-foreground py-4">まず原作を選択してください。</p>
      ) : view === "gate" ? (
        /* 検索ゲート: 既存素材の一覧(選んで編集/削除) + 新規作成 */
        <div className="rounded-xl border border-border border-t-[3px] border-t-violet-500 bg-card p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="font-mono text-[13px] font-bold text-violet-600">既存の原作マテリアル</h4>
            <Button size="sm" onClick={startNew} className="font-mono text-[11px]">
              <Plus className="h-3.5 w-3.5" />
              新規マテリアルを作成
            </Button>
          </div>
          <p className="font-mono text-[9.5px] text-muted-foreground leading-snug">
            まず既存を確認。完成度(空/金銭条件なし/完成)と参照(文書/条件明細)を表示。編集は属性 PUT＋金銭条件 追記、
            削除は参照チェック付き(参照ありは強制確認・文書スナップショットは残す)。コードは不変。
          </p>
          {listLoading ? (
            <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 読み込み中…
            </div>
          ) : materials.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground py-4">この原作に素材はありません。「新規マテリアルを作成」から登録してください。</p>
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full font-mono text-[10.5px]" style={{ fontVariantNumeric: "tabular-nums" }}>
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
                        <td className={`px-2 py-1.5 ${!m.material_name ? "text-rose-600" : ""}`}>{m.material_name || "（名称なし）"}</td>
                        <td className="px-2 py-1.5">{refs ? `${refs.condition_lines} 件` : "…"}</td>
                        <td className="px-2 py-1.5">
                          <span className={`inline-block border rounded px-1.5 py-0.5 text-[8.5px] font-bold ${comp.cls}`}>{comp.label}</span>
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">{refs ? `文書 ${refs.documents} / 条件 ${refs.condition_lines}` : "…"}</td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          <button type="button" className="inline-flex items-center gap-1 border border-sky-500 text-sky-600 rounded px-1.5 py-0.5 mr-1 hover:bg-sky-500/10" onClick={() => startEdit(m)}>
                            <Pencil className="h-3 w-3" /> 編集
                          </button>
                          <button type="button" className="inline-flex items-center gap-1 border border-rose-500 text-rose-600 rounded px-1.5 py-0.5 hover:bg-rose-500/10" onClick={() => deleteMaterial(m)}>
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
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-[11px]">
            {editingId ? <Pencil className="h-3.5 w-3.5 text-sky-600" /> : <Plus className="h-3.5 w-3.5 text-emerald-600" />}
            {editingId ? <>編集中: <b>{editingCode}</b>（コードは不変。既存の金銭条件を読み込んで編集・追加・削除できます）</> : <>新規マテリアルを作成</>}
            <button type="button" className="ml-auto text-muted-foreground hover:text-destructive inline-flex items-center gap-1" onClick={backToGate}>
              <Search className="h-3.5 w-3.5" /> 一覧に戻る
            </button>
          </div>

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
                  {/* 旧値(正準ジャンルに無い値)は選択表示できるよう先頭に退避表示 */}
                  {materialType && !MATERIAL_GENRES.some((g) => g.value === materialType) && (
                    <option value={materialType}>{materialType}（旧値）</option>
                  )}
                  {MATERIAL_GENRES.map((g) => (<option key={g.value} value={g.value}>{g.label}</option>))}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="許諾地域" col="territory" help="この構成要素が上流権利で許諾できる地域の枠。空=1-1に準ずる。1-3(A)に表示。">
                <Input value={territory} onChange={(e) => setTerritory(e.target.value)} placeholder="例: 全世界 / 日本国内" className="h-8 text-[12px]" />
              </Field>
              <Field label="許諾言語" col="language" help="この構成要素が上流権利で許諾できる言語の枠。空=1-1に準ずる。1-3(A)に表示。">
                <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="例: 全言語 / 日本語" className="h-8 text-[12px]" />
              </Field>
            </div>
          </div>

          {/* UIC-03: 金銭条件は文書フォームで登録・修正(素材CRUDへ限定)。条件明細の唯一の書込み口＝Document Command。 */}
          <div className="rounded-xl border border-border border-t-[3px] border-t-emerald-500 bg-card p-5 space-y-3">
            <div>
              <h4 className="font-mono text-[13px] font-bold text-emerald-600">金銭条件（文書フォームで登録）</h4>
              <p className="font-mono text-[9.5px] text-muted-foreground leading-snug mt-1">
                条件値（取引形態・料率など）の作成・修正は「利用許諾条件書」文書フォームで行います（データの唯一の入力口＝文書作成）。
                下のボタンで素材を保存し、原作・素材・許諾者を引き継いで文書フォームへ移動します。
              </p>
            </div>

            <Field label="文書種別" col="doc_kind" help="出版作品は出版側を選ぶ。文書フォームのテンプレートを切り替えます。">
              <select className={selCls} value={docKind} onChange={(e) => setDocKind(e.target.value as any)}>
                <option value="license">個別利用許諾条件書（ARC-ILT）</option>
                <option value="publication">出版等利用許諾条件書（ARC-PUBT）</option>
              </select>
            </Field>

            {/* 出版: 基本契約書(ARC-PUB)。条件書は基本契約番号を参照する。 */}
            {docKind === "publication" && (
              <div className="rounded-md border border-sky-500 bg-sky-500/10 p-2.5 space-y-2">
                <div className="font-mono text-[10px] font-bold text-sky-700">出版等許諾基本契約書（ARC-PUB）</div>
                <p className="font-mono text-[9px] text-muted-foreground leading-snug">
                  条件書は基本契約に紐づきます。既存の基本契約書を検索して番号を引き継ぐか、無ければ先に作成してください。
                </p>
                <DocumentNumberLookup
                  filterTemplateTypes={["pub_master_individual", "pub_master_corporate"]}
                  onApply={(d) => setPubBaseDoc(d)}
                  placeholder="ARC-PUB / 件名 で基本契約を検索"
                  includeMaster
                />
                {pubBaseDoc ? (
                  <div className="flex items-center gap-2 font-mono text-[11px] bg-background border border-border rounded px-2 py-1">
                    <FileText className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                    <span className="font-bold">{pubBaseDoc.document_number}</span>
                    <span className="text-muted-foreground truncate">{pubBaseDoc.derived_title}</span>
                    <button type="button" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setPubBaseDoc(null)}>解除</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[9px] text-muted-foreground">基本契約書が無い場合:</span>
                    <select className="h-7 rounded border border-border bg-background px-1.5 text-[10px] font-mono" value={pubBaseType} onChange={(e) => setPubBaseType(e.target.value as any)}>
                      <option value="individual">個人版</option>
                      <option value="corporate">法人版</option>
                    </select>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 border border-sky-500 text-sky-600 rounded px-2 py-1 font-mono text-[10px] hover:bg-sky-500/10"
                      onClick={handoffToBaseContract}
                    >
                      <FileOutput className="h-3 w-3" /> 基本契約書を先に作成
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handoffToDocForm}
              disabled={saving}
              className="inline-flex items-center gap-2 font-mono text-[11px] font-bold px-3 py-2 rounded-md border border-emerald-500 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <FileOutput className="h-3.5 w-3.5" />
              {editingId ? "保存して文書フォームで条件を登録／修正" : "保存して文書フォームで条件を登録"}
              （{docKind === "publication" ? "出版等利用許諾条件書" : "個別利用許諾条件書"}）
            </button>

            {/* 編集: この素材の登録済み条件を read-only 表示(修正は文書フォーム/元文書で) */}
            {editingId && (
              <div className="rounded-lg border border-violet-300 bg-violet-50/40 dark:bg-violet-950/20 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold text-violet-600">この素材の登録済み条件（閲覧のみ）</span>
                  {existingLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
                {!existingLoading && existingConds.length === 0 ? (
                  <p className="font-mono text-[10px] text-muted-foreground">登録済みの金銭条件はありません。上のボタンから文書フォームで登録してください。</p>
                ) : (
                  <ul className="space-y-1">
                    {existingConds.map((cl: any) => (
                      <li key={cl.id} className="rounded-sm border border-violet-200 bg-background/70 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                        <span className="font-bold text-foreground">{cl.subject || "（取引形態未設定）"}</span>
                        {cl.rate_pct != null ? ` / 料率${cl.rate_pct}%` : ""}
                        {cl.mg_amount != null && Number(cl.mg_amount) > 0 ? ` / MG ${cl.mg_amount}` : ""}
                        {cl.ag_amount != null && Number(cl.ag_amount) > 0 ? ` / AG ${cl.ag_amount}` : ""}
                        {cl.region_language_label ? ` / ${cl.region_language_label}` : ""}
                        {cl.document_number ? <span className="text-sky-600"> · 参照文書: {cl.document_number}</span> : ""}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="font-mono text-[9px] text-muted-foreground/70 leading-snug">
                  条件値の修正は上のボタン（文書フォーム）または参照文書の再編集で行います。この画面からは条件を変更しません。
                </p>
              </div>
            )}
          </div>

          {/* 既存の利用許諾条件(CL)をこの素材に紐づけ(link-conditions・維持)。値は書かず既存CLをリンク。 */}
          <div className="rounded-xl border border-border border-t-[3px] border-t-sky-500 bg-card p-5 space-y-3">
            <div>
              <h4 className="font-mono text-[13px] font-bold text-sky-600">既存の利用許諾条件(CL)をこの素材に紐づけ</h4>
              <p className="font-mono text-[9.5px] text-muted-foreground leading-snug mt-1">
                既に文書配下にある条件明細（発注書の受託者帰属条件など）を、値コピーせずこの素材へ後付けリンクします（新規作成しない＝二重化なし）。
              </p>
            </div>
            <Field label="文書を検索して未リンクCLを表示" col="capability_id / document_number">
              <DocumentNumberLookup
                filterTemplateTypes={docKind === "publication" ? ["pub_license_terms"] : ["individual_license_terms", "purchase_order"]}
                onApply={(d) => setPickedDoc(d)}
                placeholder={docKind === "publication" ? "ARC-PUBT / 件名 で検索" : "ARC-ILT / ARC-PO(発注書) / 件名 で検索"}
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
            {pickedDoc && unlinkedLoading && (
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground py-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> この文書の未リンク利用許諾条件(CL)を確認中…
              </div>
            )}
            {pickedDoc && !unlinkedLoading && unlinkedCLs.length === 0 && (
              <p className="font-mono text-[10px] text-muted-foreground py-1">この文書に素材未割当の利用許諾条件(CL)はありません。</p>
            )}
            {pickedDoc && !unlinkedLoading && unlinkedCLs.length > 0 && (
              <div className="rounded-md border border-amber-400 bg-amber-50/60 dark:bg-amber-950/20 px-2.5 py-2 space-y-2">
                <p className="font-mono text-[10px] font-bold text-amber-700 dark:text-amber-300">
                  この文書は素材未割当の利用許諾条件（CL）を {unlinkedCLs.length} 件持っています。
                </p>
                {!editingId && (
                  <p className="font-mono text-[9.5px] text-rose-600 leading-snug">
                    ※ リンクには保存済みの素材が必要です。先に「マテリアルを登録」で保存してから紐づけてください。
                  </p>
                )}
                <ul className="space-y-1">
                  {unlinkedCLs.map((cl) => (
                    <li key={cl.id} className="flex items-center gap-2 rounded-sm border border-amber-200 bg-white/70 dark:bg-black/20 px-2 py-1">
                      <div className="min-w-0 flex-1 font-mono text-[10px]">
                        <span className="font-bold">CL #{cl.id}</span>
                        {cl.subject ? ` / ${cl.subject}` : ""}
                        {cl.rate_pct != null ? ` / 料率${cl.rate_pct}%` : ""}
                        {cl.region_language_label ? ` / ${cl.region_language_label}` : ""}
                        {cl.payment_scheme && cl.payment_scheme !== "royalty" ? ` / ${cl.payment_scheme}` : ""}
                      </div>
                      <button
                        type="button"
                        disabled={!editingId}
                        onClick={() => linkExistingCL(cl)}
                        className="inline-flex items-center gap-1 border border-amber-500 text-amber-700 dark:text-amber-300 rounded px-2 py-1 font-mono text-[10px] hover:bg-amber-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="この既存CLをこの素材にリンク(新規作成しない)"
                      >
                        <Link2 className="h-3 w-3" /> この素材に紐づける
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={backToGate} disabled={saving} className="font-mono text-[11px]">キャンセル</Button>
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
