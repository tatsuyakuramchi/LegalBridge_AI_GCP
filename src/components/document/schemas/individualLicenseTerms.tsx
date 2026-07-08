/**
 * individualLicenseTerms — 個別利用許諾条件書(individual_license_terms) の入力フォーム。
 *
 * 旧 DocumentForm の per-template 分岐(約1060行)をこのモジュールへ移設し、
 * SchemaDocumentForm 経由で描画する。UI/挙動・formData キー・PDF テンプレは
 * 不変(バイト等価の移設)。原作マスタ(ledgers)/refreshLedgers は AppDataContext
 * から直接取得。作品一覧(worksList)とその更新(setWorksList)は出版フォールバックと
 * 共有のため DocumentForm 側から ctx で受け取る。v3_conds 初期化 effect は
 * DocumentForm に残置(マウント時に実行)。
 *
 * 独自レイアウト(ウィザードレール・マテリアルプール・v3マトリクス)のため、
 * 単一の bare セクションで本体をまるごと差し込む。
 */
import * as React from "react"
import { useAppData } from "@/src/context/AppDataContext"
import { Switch } from "@/components/ui/switch"
import { FormSection } from "../FormSection"
import { LicenseWizardRail, type WizardStep } from "../LicenseWizardRail"
import { WorkPicker, toWorkPickerItem } from "@/src/components/work/WorkPicker"
import { MaterialSearchSelect } from "../MaterialSearchSelect"
import { ConditionCopyPanel } from "../ConditionCopyPanel"
import { LcImportPanel, type LcCandidate } from "../LcImportPanel"
import {
  V3LicenseMatrix,
  V3CalcBaseEditor,
  SublicenseeEditor,
  SpecialExtrasEditor,
} from "../V3LicenseMatrix"
import { EntitySearchSelect } from "../../search/EntitySearch"
import { DocumentNumberLookup } from "../DocumentNumberLookup"
import { FkField } from "../formkit/DocFormKit"
import type { DocFormSchema, FkCtx } from "../SchemaDocumentForm"
import { Briefcase, Coins, Building2, User, ShieldCheck, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

const IndividualLicenseTermsForm: React.FC<{ ctx: FkCtx }> = ({ ctx }) => {
  const {
    metadata,
    formData,
    setFormData,
    companyProfile,
    activeVendor,
    selectedStaff,
    worksList = [],
    setWorksList,
  } = ctx
  const { ledgers: allLedgers, refreshLedgers } = useAppData()

  const [newWorkTitle, setNewWorkTitle] = React.useState("")
  const [creatingWork, setCreatingWork] = React.useState(false)
  const [iltNewSourceTitle, setIltNewSourceTitle] = React.useState("")
  const [iltCreatingSource, setIltCreatingSource] = React.useState(false)

  // group メタ → {group → 全fieldIds}(hidden も含む: 旧 groupedVars と等価)。
  const groupedVars = React.useMemo(() => {
    const groups: Record<string, string[]> = {}
    Object.entries(metadata?.vars || {}).forEach(([id, meta]: [string, any]) => {
      const groupName = meta?.group || "General (基本共通)"
      if (!groups[groupName]) groups[groupName] = []
      groups[groupName].push(id)
    })
    return groups
  }, [metadata])

  const renderField = (id: string, customLabel?: string) => (
    <FkField
      key={id}
      id={id}
      metadata={metadata}
      formData={formData}
      setFormData={setFormData}
      labelOverride={customLabel}
    />
  )

  const isCorporation = (vendor: any) =>
    (vendor?.entity_type || "").toLowerCase() === "corporate" ||
    (vendor?.entity_type || "") === "法人"

  // Phase 22.19: 原作 / 素材 セレクタ用ヘルパー。選ぶと formData の関連フィールドを自動補完。
  const ledgerList: any[] = Array.isArray(allLedgers) ? allLedgers : []
  const selectedLedger = formData.ledger_ref_id
    ? ledgerList.find((l: any) => Number(l.id) === Number(formData.ledger_ref_id))
    : null

  // WTC-1 誘導フロー: 「作品→原作→マテリアル→条件→当事者→完成」を可視化。達成判定は formData から算出。
  const isWorkLinked = formData.is_work_linked !== false
  const hasConditions =
    (Array.isArray(formData.v3_conds) &&
      formData.v3_conds.length > 0 &&
      Array.isArray(formData.v3_lcs) &&
      formData.v3_lcs.length > 0) ||
    (Array.isArray(formData.financial_conditions) && formData.financial_conditions.length > 0)
  const partiesDone =
    Object.entries(formData).some(([k, v]) => /^Licensor/i.test(k) && String(v ?? "").trim() !== "") &&
    Object.entries(formData).some(([k, v]) => /^Licensee/i.test(k) && String(v ?? "").trim() !== "")
  const wizardSteps: WizardStep[] = isWorkLinked
    ? [
        { key: "work", label: "作品", hint: "対象の自社作品を選択（なければその場で作成）", anchorId: "wiz-source", done: !!formData.linked_work_id },
        { key: "source", label: "原作", hint: "帰属先の原作を選択（なければ作成。自社原作も可）", anchorId: "wiz-source", done: !!formData.ledger_ref_id },
        { key: "material", label: "マテリアル", hint: "既存の原作マテリアルを選択、または件名で新規", anchorId: "wiz-source", done: !!(formData.material_ref_id || (formData.素材番号 && String(formData.素材番号).trim())) },
        { key: "conditions", label: "条件", hint: "従前条件を採用（コピー）または新規入力", anchorId: "wiz-conditions", done: hasConditions },
        { key: "parties", label: "当事者", hint: "許諾者・被許諾者を設定（[自社]/[取引先]で充填）", anchorId: "wiz-parties", done: partiesDone },
        { key: "done", label: "完成", hint: "内容を確認して文書を生成", done: false },
      ]
    : [
        { key: "parties", label: "当事者", hint: "許諾者・被許諾者を設定（[自社]/[取引先]で充填）", anchorId: "wiz-parties", done: partiesDone },
        { key: "done", label: "完成", hint: "内容を確認して文書を生成", done: false },
      ]

  // Phase 22.21.2: 素材権利者 / クレジット表示 の fallback チェーン。
  const resolveRightsHolder = (material: any, ledger: any): string =>
    material?.rights_holder ||
    ledger?.default_rights_holder ||
    ledger?.publisher_name ||
    ledger?.creator_name ||
    ""
  const resolveCreditDisplay = (ledger: any): string => {
    if (ledger?.default_credit_display) return ledger.default_credit_display
    if (ledger?.title) return `© ${ledger.title}`
    return ""
  }

  // 原作(Ledger)を選択状態にして既定値を補完する本体(onLedgerChange / createIltSourceIp から使う)。
  const applyLedger = (lid: number, ledger: any) => {
    const defaultMaterial =
      ledger?.materials?.find((m: any) => m.is_default) || ledger?.materials?.[0]
    setFormData({
      ...formData,
      ledger_ref_id: lid,
      material_ref_id: defaultMaterial?.id || undefined,
      素材番号: defaultMaterial?.material_code || "",
      素材名: defaultMaterial?.material_name || "",
      素材権利者: resolveRightsHolder(defaultMaterial, ledger),
      原著作物名: defaultMaterial?.is_default
        ? ledger?.title || formData.原著作物名 || ""
        : formData.原著作物名 || ledger?.title || "",
      クレジット表示: resolveCreditDisplay(ledger) || formData.クレジット表示 || "",
      原著作物補記: ledger?.default_work_supplement || formData.原著作物補記 || "",
      承認対象: ledger?.default_approval_target || formData.承認対象 || "",
      承認時期: ledger?.default_approval_timing || formData.承認時期 || "",
    })
  }

  const onLedgerChange = (ledgerId: string) => {
    const lid = Number(ledgerId)
    if (!lid) {
      setFormData({
        ...formData,
        ledger_ref_id: undefined,
        material_ref_id: undefined,
        素材番号: "",
        素材名: "",
        素材権利者: "",
        原著作物名: "",
      })
      return
    }
    const ledger = (Array.isArray(allLedgers) ? allLedgers : []).find(
      (l: any) => Number(l.id) === lid
    )
    applyLedger(lid, ledger)
  }

  // 完全に新しい原作IPをその場で作成(works+ledgers+素材-001 を原子生成)。
  const createIltSourceIp = async () => {
    const title = iltNewSourceTitle.trim()
    if (!title) return
    setIltCreatingSource(true)
    try {
      const r = await fetch("/api/v3/source-ips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      const code = j.work_code || j.source_code || ""
      await refreshLedgers().catch(() => {})
      let created: any = null
      try {
        const lr = await fetch("/api/master/ledgers")
        const ls = await lr.json()
        created = (Array.isArray(ls) ? ls : []).find((l: any) => l.ledger_code === code) || null
      } catch {
        /* 引き直し失敗時は選択なしで続行(refreshLedgers 済みなので一覧には出る) */
      }
      setIltNewSourceTitle("")
      if (created?.id != null) applyLedger(Number(created.id), created)
    } catch (e) {
      console.error("createIltSourceIp failed", e)
    } finally {
      setIltCreatingSource(false)
    }
  }

  // Stage 1: 「どの作品のための契約か」を指定する作品(own)を、なければその場で作成する。
  const createOwnWork = async () => {
    const title = newWorkTitle.trim()
    if (!title) return
    setCreatingWork(true)
    try {
      const r = await fetch("/api/v3/works", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const created = await r.json()
      try {
        const listRes = await fetch("/api/v3/works")
        const list = await listRes.json()
        setWorksList?.(Array.isArray(list) ? list : [])
      } catch {
        /* 一覧再取得失敗は致命的でない */
      }
      setNewWorkTitle("")
      if (created?.id != null) {
        setFormData({
          ...formData,
          linked_work_id: String(created.id),
          対象製品予定名: title || formData.対象製品予定名 || "",
        })
      }
    } catch (e) {
      console.error("createOwnWork failed", e)
    } finally {
      setCreatingWork(false)
    }
  }

  const fillLicensorFromSelf = () =>
    setFormData({
      ...formData,
      Licensor_名称: companyProfile?.name || "",
      Licensor_住所: companyProfile?.address || "",
      Licensor_氏名会社名: companyProfile?.name || "",
      Licensor_代表者名: companyProfile?.representative || "",
      LICENSOR_IS_CORPORATION: true,
    })

  // 任意の取引先 v から Licensor を充填([取引先]ボタンとフォーム内検索補完で共用)。
  const fillLicensorFrom = (v: any) => {
    if (!v) return
    setFormData({
      ...formData,
      Licensor_名称: v.vendor_name || "",
      Licensor_住所: v.address || "",
      Licensor_氏名会社名: v.trade_name || v.vendor_name || "",
      Licensor_代表者名: v.vendor_rep || v.contact_name || "",
      LICENSOR_IS_CORPORATION: isCorporation(v),
    })
  }
  const fillLicensorFromPartner = () => fillLicensorFrom(activeVendor)

  const fillLicenseeFromSelf = () =>
    setFormData({
      ...formData,
      Licensee_名称: companyProfile?.name || "",
      Licensee_住所: companyProfile?.address || "",
      Licensee_氏名会社名: companyProfile?.name || "",
      Licensee_代表者名: companyProfile?.representative || "",
      LICENSEE_IS_CORPORATION: true,
    })

  const fillLicenseeFrom = (v: any) => {
    if (!v) return
    setFormData({
      ...formData,
      Licensee_名称: v.vendor_name || "",
      Licensee_住所: v.address || "",
      Licensee_氏名会社名: v.trade_name || v.vendor_name || "",
      Licensee_代表者名: v.vendor_rep || v.contact_name || "",
      LICENSEE_IS_CORPORATION: isCorporation(v),
    })
  }
  const fillLicenseeFromPartner = () => fillLicenseeFrom(activeVendor)

  const fillStaffAsSupervisor = () => {
    if (!selectedStaff) return
    setFormData({
      ...formData,
      監修者: selectedStaff.staff_name || "",
      クレジット表示: `© Arclight / ${selectedStaff.staff_name || ""}`,
    })
  }

  const sideButton = (label: string, onClick: () => void, disabled: boolean) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-[10px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors",
        disabled
          ? "border-input text-muted-foreground/40 cursor-not-allowed"
          : "border-foreground/30 text-foreground hover:bg-muted"
      )}
      title={disabled ? "上部で対象を選択してください" : undefined}
    >
      {label}
    </button>
  )

  // Required-completion summary (counts unfilled required fields).
  const requiredIds = Object.entries(metadata.vars || {})
    .filter(([, m]: [string, any]) => m?.required === true)
    .map(([id]) => id)
  const missingRequired = requiredIds.filter((id) => {
    const v = formData[id]
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "")
  })

  const renderGroup = (groupName: string) =>
    (groupedVars[groupName] || []).map((fid) => renderField(fid))

  // ---------------------------------------------------------------
  // マスター条件: 複数原作マテリアル選択 ＋ 過去条件コピー。選んだマテリアル(master_materials)を
  //   正準とし、そこから v3 マトリクスの構成要素LC(v3_lcs)を導出する。
  // ---------------------------------------------------------------
  const masterMaterials: any[] = Array.isArray(formData.master_materials)
    ? (formData.master_materials as any[])
    : []
  // 跨ぎ原作対応: 全原作のマテリアルをプール(原作タイトル付き)。
  const masterMaterialGroups = ledgerList.map((l: any) => ({
    id: l.id,
    title: l.title,
    code: l.ledger_code,
    materials: Array.isArray(l.materials) ? l.materials : [],
  }))
  const materialPool: any[] = masterMaterialGroups.flatMap((g: any) =>
    (g.materials as any[]).map((m: any) => ({
      ...m,
      _ledger_title: g.title,
      _ledger_code: g.code,
    }))
  )

  // 1 マテリアル(＋コピー条件) → LC 行。prevLc があれば編集済み rates を保持。
  const lcFromMaterial = (m: any, prevLc: any, conds: any[]) => {
    const rates: Record<string, any> = { ...(prevLc?.rates || {}) }
    const copiedRate = m?.copied?.rate_pct
    if (copiedRate != null && copiedRate !== "") {
      ;(Array.isArray(conds) ? conds : [])
        .filter((c: any) => c?.addon)
        .forEach((c: any) => {
          const k = String(c.id)
          if (rates[k] == null || rates[k] === "") rates[k] = String(copiedRate)
        })
    }
    return {
      material_code: m?.material_code || "",
      name: m?.name || "",
      holder: m?.holder || "",
      rates,
      copied_from_condition_id: m?.copied?.copied_from_condition_id,
      source_doc: m?.source_doc || "",
    }
  }
  // 選択マテリアル群 → v3_lcs(編集済み rates は material_code で突合し保持)。
  const rebuildV3Lcs = (materials: any[], prevLcs: any[], conds: any[]) => {
    const byCode = new Map(
      (Array.isArray(prevLcs) ? prevLcs : []).map((l: any) => [l.material_code, l])
    )
    return (Array.isArray(materials) ? materials : [])
      .filter((m: any) => m?.material_code)
      .map((m: any) => lcFromMaterial(m, byCode.get(m.material_code), conds))
  }

  // master_materials を更新し、派生する v3_lcs / アンカー素材の補完値も同時に書く。
  const commitMaterials = (next: any[]) => {
    const conds = Array.isArray(formData.v3_conds) ? (formData.v3_conds as any[]) : []
    const lcs = rebuildV3Lcs(
      next,
      Array.isArray(formData.v3_lcs) ? (formData.v3_lcs as any[]) : [],
      conds
    )
    const anchor = next.find((m: any) => m?.material_code) || null
    const anchorMat = anchor
      ? materialPool.find((x: any) => x.material_code === anchor.material_code)
      : null
    setFormData({
      ...formData,
      master_materials: next,
      v3_lcs: lcs,
      ...(anchor
        ? {
            material_ref_id: anchorMat?.id ?? formData.material_ref_id,
            素材番号: anchor.material_code || formData.素材番号,
            素材名: anchor.name || formData.素材名,
            素材権利者: anchor.holder || formData.素材権利者,
          }
        : {}),
    })
  }
  const addMaterialRow = () =>
    commitMaterials([...masterMaterials, { material_code: "", name: "", holder: "", copied: null }])
  const removeMaterialRow = (i: number) =>
    commitMaterials(masterMaterials.filter((_: any, idx: number) => idx !== i))
  const setRowMaterial = (i: number, code: string) => {
    const m = materialPool.find((x: any) => x.material_code === code) || null
    const next = masterMaterials.map((row: any, idx: number) =>
      idx === i
        ? {
            ...row,
            material_code: code,
            name: m?.material_name || "",
            holder: resolveRightsHolder(m, null) || row.holder || "",
            source_doc:
              m?.service_doc_number ||
              m?.source_doc_number ||
              m?.source_document_number ||
              row.source_doc ||
              "",
          }
        : row
    )
    commitMaterials(next)
  }
  // 検索でヒットしない素材をその場で新規登録して行に確定する(MaterialSearchSelect の onCreate)。
  const createRowMaterial = async (i: number, name: string) => {
    const lid = formData.ledger_ref_id
    if (!lid) return
    const r = await fetch(`/api/master/ledgers/${lid}/materials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material_name: name }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = await r.json()
    await refreshLedgers().catch(() => {})
    if (!j?.material_code) return
    const next = masterMaterials.map((row: any, idx: number) =>
      idx === i
        ? {
            ...row,
            material_code: j.material_code,
            name: j.material_name || name,
            holder: resolveRightsHolder(j, selectedLedger) || row.holder || "",
            source_doc: "この条件書(新規)",
          }
        : row
    )
    commitMaterials(next)
  }
  const setRowCopied = (i: number, cond: any) => {
    const next = masterMaterials.map((row: any, idx: number) =>
      idx === i
        ? {
            ...row,
            copied: cond,
            source_doc: cond?.source_document_number || row.source_doc || "",
          }
        : row
    )
    commitMaterials(next)
  }
  // 金銭条件側で取引形態(conds)が変わった時、LC の rates(新規 addon 列の seed)を再同期。
  const syncLcsForConds = (conds: any[]) =>
    rebuildV3Lcs(
      masterMaterials,
      Array.isArray(formData.v3_lcs) ? (formData.v3_lcs as any[]) : [],
      conds
    )

  // 過去の契約・発注書から選んだ構成要素候補(LcImportPanel)を master_materials 行に取り込む。
  const importLcCandidates = async (cands: LcCandidate[]) => {
    const additions: any[] = []
    const seen = new Set(masterMaterials.map((m: any) => m.material_code).filter(Boolean))
    for (const c of cands) {
      let code = c.material_code || ""
      let name = c.material_name || c.item_name || ""
      let holder = c.rights_holder || ""
      if (!code) {
        const lid = formData.ledger_ref_id
        if (!lid) {
          window.alert("未登録の成果物を取り込むには、先に上で「原作 (Ledger)」を選択してください。")
          continue
        }
        try {
          const r = await fetch(`/api/master/ledgers/${lid}/materials`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ material_name: name || "成果物" }),
          })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const j = await r.json()
          code = j?.material_code || ""
          name = j?.material_name || name
          if (!holder) holder = resolveRightsHolder(j, selectedLedger) || ""
        } catch {
          continue
        }
      }
      if (!code || seen.has(code)) continue
      seen.add(code)
      const copied =
        c.source_condition_id != null || c.rate_pct != null
          ? {
              rate_pct: c.rate_pct ?? undefined,
              copied_from_condition_id: c.source_condition_id ?? undefined,
              condition_name: c.condition_name ?? undefined,
            }
          : null
      additions.push({
        material_code: code,
        name,
        holder,
        copied,
        source_doc: c.document_number || "",
      })
    }
    if (additions.length > 0) {
      await refreshLedgers().catch(() => {})
      commitMaterials([...masterMaterials, ...additions])
    }
  }

  return (
    <div className="space-y-10">
      {/* Required-progress banner */}
      <div
        className={`flex items-center justify-between gap-3 px-4 py-2 rounded-sm border ${
          missingRequired.length === 0
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-amber-50 border-amber-200 text-amber-800"
        }`}
      >
        <div className="text-[11px] font-mono">
          {missingRequired.length === 0 ? (
            <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
          ) : (
            <>
              必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
              <span className="ml-2 text-[10px] opacity-75">
                未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(", ")}
                {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
              </span>
            </>
          )}
        </div>
      </div>

      {/* WTC-1 誘導フロー: 作品→原作→マテリアル→条件→当事者→完成 を上部に常時表示。 */}
      <LicenseWizardRail steps={wizardSteps} />

      {/* 1. 前提条件 — 誰と / どの基本契約 / 作品連動の有無 / どの作品 を一括設定。 */}
      <FormSection title="1. 前提条件" variant="default" icon={<Briefcase className="w-4 h-4" />}>
        {renderField("発行日")}
        {renderField("台帳ID")}
        {renderField("契約書番号")}

        {/* 基本契約設定 — 基本契約の紐づけ(唯一の入力点) */}
        <div className="col-span-full mt-2 pt-3 border-t border-border/60">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground mb-1.5">
            基本契約設定
          </div>
          <DocumentNumberLookup
            label="基本契約をマスタ・アーカイブから検索 (部分一致 / 空欄で最新一覧)"
            placeholder="例: 株式会社X / GCT / ARC-LIC-2026-0001"
            initialQuery={formData.基本契約番号 || ""}
            filterTemplateTypes={[
              "license_master",
              "service_master",
              "individual_license_terms",
              "sales_master_buyer",
              "sales_master_credit",
              "sales_master_standard",
            ]}
            includeMaster={true}
            onApply={(doc) => {
              setFormData({
                ...formData,
                基本契約名: doc.derived_title,
                基本契約番号: doc.document_number,
                基本契約リンク: doc.drive_link || formData.基本契約リンク,
              })
            }}
          />
        </div>
        {renderField("基本契約名")}

        {/* 作品連動契約の有無 — OFF で原作・素材の紐付けをスキップ。既定 ON。 */}
        <div className="col-span-full mt-2 flex items-start justify-between gap-4 rounded-md border border-border bg-muted/20 px-4 py-3">
          <div className="space-y-0.5">
            <label
              htmlFor="is_work_linked"
              className="text-xs font-mono font-bold uppercase tracking-[0.14em] text-foreground cursor-pointer"
            >
              作品連動する契約
            </label>
            <p className="text-[11px] font-mono text-muted-foreground">
              ON: 原作・原作マテリアルを紐付け、作品の構成・条件明細に連動させます。
              OFF: 作品に関わらない契約（NDA・一般業務委託 等）として原作・素材の紐付けを行いません。
            </p>
          </div>
          <Switch
            id="is_work_linked"
            checked={formData.is_work_linked !== false}
            onCheckedChange={(checked: boolean) =>
              setFormData({ ...formData, is_work_linked: checked })
            }
          />
        </div>

        {/* 作品設定 — 対象作品(own)。作品連動 ON のみ。なければその場で作成。 */}
        {formData.is_work_linked !== false && (
          <div className="col-span-full space-y-1">
            <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
              作品設定 — 対象作品（自社作品）
            </label>
            <WorkPicker
              items={worksList.filter((w: any) => w.title).map((w: any) => toWorkPickerItem(w))}
              value={formData.linked_work_id ? String(formData.linked_work_id) : undefined}
              onSelect={(w) =>
                setFormData({
                  ...formData,
                  linked_work_id: w?.id,
                  対象製品予定名: w?.title || formData.対象製品予定名 || "",
                })
              }
              placeholder="この契約の対象作品を検索 (コード / タイトル / 別名)"
            />
            <div className="flex items-center gap-1.5 pt-1">
              <input
                value={newWorkTitle}
                onChange={(e) => setNewWorkTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    void createOwnWork()
                  }
                }}
                placeholder="なければ作成: 作品タイトル"
                className="flex-1 text-xs font-mono bg-transparent border-b border-input py-1.5 focus:outline-none focus:border-foreground"
              />
              <button
                type="button"
                onClick={() => void createOwnWork()}
                disabled={creatingWork || !newWorkTitle.trim()}
                className="text-[11px] font-mono px-2 py-1 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >
                {creatingWork ? "作成中…" : "＋作成"}
              </button>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground/70">
              「どの作品のための契約か」を指定します。一覧に無ければ作品タイトルを入力して作成。選択すると「対象製品（予定）名」へ反映します。
            </p>
          </div>
        )}

        {/* 許諾期間（テンプレ頭書「期間」）。開始日は頭書の契約開始日に反映。 */}
        <div className="col-span-full mt-2 pt-3 border-t border-border/60">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground mb-1.5">
            許諾期間（頭書）
          </div>
        </div>
        {renderField("許諾開始日")}
        {renderField("許諾期間注記")}
      </FormSection>

      {/* 2. 許諾の内容 — 原作・原作マテリアル(複数)。作品連動 OFF のときは非表示。 */}
      {formData.is_work_linked !== false && (
        <FormSection
          id="wiz-source"
          title="2. 許諾の内容 — 原作・原作マテリアル（構成要素LC）"
          variant="emerald"
          icon={<Briefcase className="w-4 h-4" />}
        >
          {/* 原作(Ledger): マテリアル候補のコンテキスト。未登録の原作はその場で新規作成できる。 */}
          <div className="col-span-full space-y-1">
            <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
              原作 (Ledger) — 既存を選択 or 新規作成
            </label>
            <WorkPicker
              items={ledgerList
                .filter((l: any) => l.is_active !== false)
                .map((l: any) => toWorkPickerItem(l))}
              value={formData.ledger_ref_id ? String(formData.ledger_ref_id) : undefined}
              onSelect={(l) => onLedgerChange(l?.id || "")}
              placeholder="原作を検索 (LO-コード / タイトル / 別名)"
            />
            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">または新規:</span>
              <input
                value={iltNewSourceTitle}
                onChange={(e) => setIltNewSourceTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    void createIltSourceIp()
                  }
                }}
                placeholder="なければ作成: 原作タイトル"
                className="flex-1 text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground"
              />
              <button
                type="button"
                onClick={() => void createIltSourceIp()}
                disabled={iltCreatingSource || !iltNewSourceTitle.trim()}
                className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >
                {iltCreatingSource ? "作成中…" : "＋原作を新規作成"}
              </button>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground/70">
              マスター &gt; Ledgers で登録した原作 (LO-YYYY-NNNN)。原著作物名・クレジット表示の既定値を補完します。未登録の原作はタイトル入力で作成でき、原作本体素材 -001 も同時生成されます。
            </p>
          </div>

          {/* 原作マテリアル(複数) ＋ 過去の利用許諾条件コピー/新規。 */}
          <div className="col-span-full mt-3 rounded-md border border-emerald-200 bg-emerald-50/30 px-3 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-emerald-700">
                原作マテリアル検索（複数可）＋ 過去条件の再利用
              </div>
              <button
                type="button"
                onClick={addMaterialRow}
                className="text-[11px] font-mono px-2 py-1 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-100"
              >
                ＋マテリアルを追加
              </button>
            </div>

            {materialPool.length === 0 && (
              <p className="text-[10px] font-mono text-muted-foreground">
                原作マスター(Ledgers)にマテリアルがありません。上で原作を選択/作成し、「＋マテリアルを追加」の検索欄に素材名を入力するとその場で新規登録できます。
              </p>
            )}

            {masterMaterials.length === 0 ? (
              <p className="text-[10px] font-mono text-muted-foreground">
                「＋マテリアルを追加」で、この契約が利用する原作マテリアルを選択します。検索でヒットしなければ入力した素材名のままその場で新規登録できます（登録先は上の原作）。各マテリアルに過去条件があればコピーして再利用、無ければ新規として金銭条件で入力します。
              </p>
            ) : (
              <div className="space-y-2.5">
                {masterMaterials.map((row: any, i: number) => {
                  const picked =
                    materialPool.find((x: any) => x.material_code === row.material_code) || null
                  const label = picked
                    ? `[${picked.material_code}]${picked.is_default ? " ★" : ""} ${picked._ledger_title ? picked._ledger_title + "　" : ""}${picked.material_name || ""}`
                    : row.material_code || ""
                  return (
                    <div
                      key={i}
                      className="rounded-md border border-emerald-200 bg-white/70 px-2.5 py-2 space-y-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-emerald-700 shrink-0">
                          #{i + 1}
                        </span>
                        <MaterialSearchSelect
                          materials={materialPool}
                          value={row.material_code}
                          onPick={(code) => setRowMaterial(i, code)}
                          onCreate={(name) => createRowMaterial(i, name)}
                          createDisabledReason={
                            formData.ledger_ref_id
                              ? undefined
                              : "新規登録には上で「原作 (Ledger)」を選択/作成してください"
                          }
                        />
                        <button
                          type="button"
                          onClick={() => removeMaterialRow(i)}
                          className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-red-600 hover:bg-red-50"
                        >
                          削除
                        </button>
                      </div>
                      {row.material_code && (
                        <div className="flex items-center gap-2 pl-6 flex-wrap">
                          <span className="text-[9px] font-mono text-muted-foreground">
                            根拠文書:{" "}
                            <span className="font-bold text-indigo-700">
                              {row.source_doc || "この条件書(新規)"}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border",
                              row.copied
                                ? "text-teal-700 border-teal-300 bg-teal-50"
                                : "text-amber-700 border-amber-300 bg-amber-50"
                            )}
                          >
                            {row.copied ? "A 過去条件を引用" : "B この条件書で新規登録"}
                          </span>
                        </div>
                      )}
                      {row.copied && (
                        <div className="text-[10px] font-mono text-emerald-800 pl-6">
                          コピー済み条件: {row.copied.condition_name || "(無題)"}{" "}
                          {row.copied.rate_pct != null ? `料率 ${row.copied.rate_pct}%` : ""}
                          <button
                            type="button"
                            onClick={() => setRowCopied(i, null)}
                            className="ml-2 text-[9px] underline text-muted-foreground hover:text-red-600"
                          >
                            解除
                          </button>
                        </div>
                      )}
                      {row.material_code ? (
                        <ConditionCopyPanel
                          materialCode={row.material_code}
                          materialLabel={label}
                          existing={row.copied ? [row.copied] : []}
                          onCopy={(cond) => setRowCopied(i, cond)}
                        />
                      ) : (
                        <p className="pl-6 text-[10px] font-mono text-muted-foreground/70">
                          マテリアルを選ぶと、その原作素材の過去条件を引用(コピー)できます。新規条件はそのまま金銭条件で入力します。
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-[10px] font-mono text-muted-foreground/70">
              選択したマテリアルは下の「金銭条件」の構成要素(LC)になります。コピーした条件の料率は加算型取引形態の初期値に反映されます（金銭条件側で修正可）。
            </p>

            {/* 過去の利用許諾条件書・発注書から構成要素を取り込む。 */}
            <LcImportPanel
              existingCodes={
                new Set(masterMaterials.map((m: any) => m.material_code).filter(Boolean) as string[])
              }
              onImport={importLcCandidates}
            />
          </div>

          {/* 1-1 許諾概要。対象製品・独占性・許諾地域/言語/範囲を入力する。 */}
          <div className="col-span-full mt-3 pt-3 border-t border-border/60">
            <div className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground mb-1.5">
              1-1 許諾概要
            </div>
          </div>
          {renderField("対象製品予定名")}
          {renderField("独占性")}
          {renderField("対象製品の定義")}
          {renderField("許諾地域")}
          {renderField("許諾言語")}
          {renderField("許諾範囲")}
        </FormSection>
      )}

      {/* 3. 許諾対象台帳・対価 — v3 マトリクス(取引形態 × 構成要素LC)に一本化。 */}
      <FormSection
        id="wiz-conditions"
        title="3. 許諾対象台帳・対価（1-3 基準価格表 / 1-3(B) 料率表 / 2-1 金銭条件マスタ）"
        variant="indigo"
        icon={<Coins className="w-4 h-4" />}
        headerActions={
          <span className="text-[11px] font-mono text-muted-foreground italic">
            加算型＝LC料率の合算 / 非加算型＝実効料率
          </span>
        }
      >
        <V3LicenseMatrix
          conds={Array.isArray(formData.v3_conds) ? formData.v3_conds : []}
          lcs={Array.isArray(formData.v3_lcs) ? formData.v3_lcs : []}
          onChangeConds={(next) =>
            setFormData({
              ...formData,
              v3_conds: next,
              v3_lcs: syncLcsForConds(next),
            })
          }
          onChangeLcs={(next) => setFormData({ ...formData, v3_lcs: next })}
        />
        {/* 2-3(A) 計算基準日 — 版ごとに支払期日の起点事由を定める(v3_calc_base_rows)。 */}
        <V3CalcBaseEditor
          rows={Array.isArray(formData.v3_calc_base_rows) ? formData.v3_calc_base_rows : []}
          onChange={(next) => setFormData({ ...formData, v3_calc_base_rows: next })}
        />
      </FormSection>

      {/* 4. 再許諾（テンプレ 1-4 Sub-license 台帳）。formData.v3_sublicensees を produce。 */}
      <FormSection title="4. 再許諾（1-4 Sub-license 台帳）" variant="indigo" icon={<Coins className="w-4 h-4" />}>
        <SublicenseeEditor
          rows={Array.isArray(formData.v3_sublicensees) ? formData.v3_sublicensees : []}
          onChange={(next) => setFormData({ ...formData, v3_sublicensees: next })}
        />
      </FormSection>

      {/* 5. 当事者 (Licensor / Licensee) — テンプレ頭書「当事者・通知先」/ 5.署名 に反映。 */}
      <div id="wiz-parties" className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <FormSection
          title="5. 当事者 — II. Licensor (許諾者)"
          variant="blue"
          icon={<Building2 className="w-4 h-4" />}
          headerActions={
            <>
              {sideButton("自社", fillLicensorFromSelf, !companyProfile)}
              {sideButton("取引先", fillLicensorFromPartner, !activeVendor)}
            </>
          }
        >
          <div className="col-span-full space-y-1">
            <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
              取引先を検索して許諾者を充填（DB検索補完）
            </label>
            <EntitySearchSelect entity="vendor" onSelect={(o) => o && fillLicensorFrom(o.raw)} placeholder="取引先を検索（名称 / コード）" />
          </div>
          {renderGroup("II. Licensor (許諾者)")}
        </FormSection>

        <FormSection
          title="5. 当事者 — III. Licensee (被許諾者)"
          variant="amber"
          icon={<User className="w-4 h-4" />}
          headerActions={
            <>
              {sideButton("自社", fillLicenseeFromSelf, !companyProfile)}
              {sideButton("取引先", fillLicenseeFromPartner, !activeVendor)}
            </>
          }
        >
          <div className="col-span-full space-y-1">
            <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
              取引先を検索して被許諾者を充填（DB検索補完）
            </label>
            <EntitySearchSelect entity="vendor" onSelect={(o) => o && fillLicenseeFrom(o.raw)} placeholder="取引先を検索（名称 / コード）" />
          </div>
          {renderGroup("III. Licensee (被許諾者)")}
        </FormSection>
      </div>

      {/* 6. 運用条件 — 監修（テンプレ 3.）。クレジット表示にクイック選択チップ群を追加。 */}
      <FormSection
        title="6. 運用条件 — 監修（テンプレ 3.）"
        variant="default"
        icon={<ShieldCheck className="w-4 h-4" />}
        headerActions={sideButton("Sync Staff", fillStaffAsSupervisor, !selectedStaff)}
      >
        {renderField("監修者")}
        {renderField("クレジット表示")}
        {renderField("承認時期")}
        <div className="col-span-full mt-1 pt-2 border-t border-dashed border-input">
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
              クレジット表示 プリセット:
            </span>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, クレジット表示: "別途協議" })}
              className={cn(
                "text-[10px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors",
                formData.クレジット表示 === "別途協議"
                  ? "border-foreground bg-foreground text-background"
                  : "border-foreground/30 text-foreground hover:bg-muted"
              )}
            >
              別途協議
            </button>
            <button
              type="button"
              onClick={() => {
                const t = selectedLedger?.title || formData.原著作物名 || ""
                if (!t) return
                setFormData({ ...formData, クレジット表示: `© ${t}` })
              }}
              disabled={!selectedLedger?.title && !formData.原著作物名}
              className={cn(
                "text-[10px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors",
                "border-foreground/30 text-foreground hover:bg-muted",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
              title={
                selectedLedger?.title || formData.原著作物名
                  ? `© ${selectedLedger?.title || formData.原著作物名} を入力`
                  : "原作タイトル未確定 (Ledger を選択 or 原著作物名 を入力)"
              }
            >
              © {selectedLedger?.title || formData.原著作物名 || "(原作名)"}
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, クレジット表示: "" })}
              className="text-[10px] font-mono px-2 py-0.5 uppercase border border-foreground/30 text-foreground hover:bg-muted rounded-sm transition-colors"
            >
              クリア
            </button>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground/70 mt-1">
            クイック選択で値を上書きできます。手入力も可。
          </p>
        </div>
      </FormSection>

      {/* 7. 特約事項（テンプレ 4.）。4-1/4-2 は固定文、4-3 以降を追加特約として入力。 */}
      <FormSection title="7. 特約事項（テンプレ 4.）" variant="red" icon={<AlertCircle className="w-4 h-4" />}>
        <SpecialExtrasEditor
          rows={Array.isArray(formData.v3_special_extras) ? formData.v3_special_extras : []}
          onChange={(next) => setFormData({ ...formData, v3_special_extras: next })}
        />
        <div className="col-span-full mt-3 pt-3 border-t border-border/60">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground mb-1.5">
            特記事項（自由記述）
          </div>
        </div>
        <div className="col-span-full">{renderGroup("IX. 特記事項")}</div>
      </FormSection>
    </div>
  )
}

/**
 * individualLicenseTermsBuilder — 個別利用許諾条件書スキーマ。
 * 独自レイアウト全体を単一の bare セクションで差し込む(FkSection chrome なし)。
 * 独自のウィザード/マテリアルプール/v3マトリクスを持つため DbFillBar は出さない。
 */
export function individualLicenseTermsBuilder(_metadata: any): DocFormSchema {
  return {
    fillBar: false,
    sections: [
      {
        bare: true,
        custom: (ctx) => <IndividualLicenseTermsForm ctx={ctx} />,
      },
    ],
  }
}
