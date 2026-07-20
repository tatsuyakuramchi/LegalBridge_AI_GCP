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
import { useToast } from "@/components/ui/toast"

const IndividualLicenseTermsForm: React.FC<{ ctx: FkCtx }> = ({ ctx }) => {
  const { push } = useToast()
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
      push(
        j?.matched
          ? `同名の既存原作「${j.title || title}」を選択しました（重複作成を防止）`
          : `原作「${title}」を新規登録しました`,
        "success"
      )
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
      push(
        created?.matched
          ? `同名の既存作品「${created.title || title}」を選択しました（重複作成を防止）`
          : `作品「${title}」を新規登録しました`,
        "success"
      )
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

  // 自社側の担当者(通知先)はサイドバー選択中スタッフから組み立てる(空欄は既存値を保持)。
  const staffPersonStr = (s: any) =>
    [s?.department, s?.staff_name].filter((x) => x && String(x).trim() !== "").join(" ")
  const staffContactLine = (s: any) =>
    [staffPersonStr(s), s?.phone, s?.email].filter((x) => x && String(x).trim() !== "").join(" / ")

  const fillLicensorFromSelf = () =>
    setFormData({
      ...formData,
      Licensor_名称: companyProfile?.name || "",
      Licensor_住所: companyProfile?.address || "",
      Licensor_氏名会社名: companyProfile?.name || "",
      Licensor_代表者名: companyProfile?.representative || "",
      // C案(自社版): 担当/電話/メールを選択中スタッフから充填([取引先]と対称)。
      Licensor_担当者: staffPersonStr(selectedStaff) || formData.Licensor_担当者 || "",
      Licensor_電話: selectedStaff?.phone || formData.Licensor_電話 || "",
      Licensor_メール: selectedStaff?.email || formData.Licensor_メール || "",
      LICENSOR_IS_CORPORATION: true,
    })

  // 取引先マスタ(vendors)の担当者・電話・メールから通知先文字列を組み立てる。
  //   担当者 = 部署 + 氏名、通知先(Licensee側1欄)は「担当 / 電話 / メール」を連結。
  const vendorContactPerson = (v: any) =>
    [v?.contact_department, v?.contact_name].filter((x) => x && String(x).trim() !== "").join(" ")
  const vendorContactLine = (v: any) =>
    [vendorContactPerson(v), v?.phone, v?.email].filter((x) => x && String(x).trim() !== "").join(" / ")

  // 任意の取引先 v から Licensor を充填([取引先]ボタンとフォーム内検索補完で共用)。
  //   C案: 通知先(担当者/電話/メール)も取引先マスタから自動充填(空欄は既存値を保持=手入力で上書き可)。
  const fillLicensorFrom = (v: any) => {
    if (!v) return
    const person = vendorContactPerson(v)
    setFormData({
      ...formData,
      Licensor_名称: v.vendor_name || "",
      Licensor_住所: v.address || "",
      Licensor_氏名会社名: v.trade_name || v.vendor_name || "",
      Licensor_代表者名: v.vendor_rep || v.contact_name || "",
      Licensor_担当者: person || formData.Licensor_担当者 || "",
      Licensor_電話: v.phone || formData.Licensor_電話 || "",
      Licensor_メール: v.email || formData.Licensor_メール || "",
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
      // 連絡先(1欄)は選択中スタッフの 担当 / 電話 / メール を連結([取引先]と対称)。
      Licensee_連絡先: staffContactLine(selectedStaff) || formData.Licensee_連絡先 || "",
      LICENSEE_IS_CORPORATION: true,
    })

  const fillLicenseeFrom = (v: any) => {
    if (!v) return
    // Licensee 側の通知先は1欄(連絡先)のため、担当/電話/メールを連結して充填。
    const line = vendorContactLine(v)
    setFormData({
      ...formData,
      Licensee_名称: v.vendor_name || "",
      Licensee_住所: v.address || "",
      Licensee_氏名会社名: v.trade_name || v.vendor_name || "",
      Licensee_代表者名: v.vendor_rep || v.contact_name || "",
      Licensee_連絡先: line || formData.Licensee_連絡先 || "",
      LICENSEE_IS_CORPORATION: isCorporation(v),
    })
  }
  const fillLicenseeFromPartner = () => fillLicenseeFrom(activeVendor)

  const fillStaffAsSupervisor = () => fillSupervisorFrom(selectedStaff)
  // 任意のスタッフ s を監修者に充填(Sync Staff ボタンと staff 検索の双方から使う)。
  const fillSupervisorFrom = (s: any) => {
    if (!s) return
    const name = s.staff_name || s.name || ""
    setFormData({
      ...formData,
      監修者: name,
      クレジット表示: `© Arclight / ${name}`,
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
      // 構成要素マスタ(work_materials)由来の許諾地域・言語(枠)。1-3 に表示。
      region: m?.region || "",
      language: m?.language || "",
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
            // 構成要素マスタの許諾地域・言語(枠)を行へ取り込む(work_materials.territory/language)。
            region: m?.territory ?? row.region ?? "",
            language: m?.language ?? row.language ?? "",
          }
        : row
    )
    commitMaterials(next)
  }
  // 検索でヒットしない素材をその場でスコープ付き新規登録して行に確定する
  //   (MaterialSearchSelect の onCreate)。素材名に加え 種別/権利者/許諾地域/許諾言語 を渡し、
  //   1-3 許諾範囲表に穴が空かないようにする。
  const createRowMaterial = async (
    i: number,
    payload: {
      material_name: string
      material_type?: string
      rights_holder?: string
      territory?: string
      language?: string
    }
  ) => {
    const lid = formData.ledger_ref_id
    if (!lid) return
    const r = await fetch(`/api/master/ledgers/${lid}/materials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!r.ok) {
      // サーバのエラー本文({ ok:false, error:"..." })をそのまま可視化する。
      //   コンソール/Network を開かずに原因(列不整合/参照不整合/採番衝突 等)を確認できる。
      const bodyText = await r.text().catch(() => "")
      console.error("createRowMaterial failed:", r.status, bodyText)
      window.alert(`マテリアル登録に失敗しました (HTTP ${r.status})\n\n${bodyText}`)
      throw new Error(`HTTP ${r.status}: ${bodyText}`)
    }
    const j = await r.json()
    await refreshLedgers().catch(() => {})
    if (!j?.material_code) return
    const next = masterMaterials.map((row: any, idx: number) =>
      idx === i
        ? {
            ...row,
            material_code: j.material_code,
            name: j.material_name || payload.material_name,
            holder: resolveRightsHolder(j, selectedLedger) || payload.rights_holder || row.holder || "",
            territory: j.territory ?? payload.territory ?? row.territory ?? "",
            language: j.language ?? payload.language ?? row.language ?? "",
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
  // 取り込んだCL(引用条件)の料率を行レベルで編集する。ブランク(未入力)で取り込んだ
  //   未リンクCLの料率をここで補える。commitMaterials 経由で加算型取引形態の seed に反映。
  const setRowCopiedRate = (i: number, value: string) => {
    const next = masterMaterials.map((row: any, idx: number) => {
      if (idx !== i) return row
      const base = row.copied || {}
      return { ...row, copied: { ...base, rate_pct: value === "" ? undefined : value } }
    })
    commitMaterials(next)
  }
  // 案X: マテリアル行から「加算型取引形態ごとの料率(金銭条件)」を直接入力する。
  //   v3_lcs(material_code × cond.id の rates)を更新。section 3 マトリクスと同一データ。
  //   これで各マテリアルが自分の取引形態×料率を持ち、加算(構成要素の料率合算)が成立する。
  const setRowRate = (materialCode: string, condId: any, value: string) => {
    if (!materialCode) return
    const lcs = Array.isArray(formData.v3_lcs) ? (formData.v3_lcs as any[]) : []
    const next = lcs.map((lc: any) =>
      lc.material_code === materialCode
        ? { ...lc, rates: { ...(lc.rates || {}), [String(condId)]: value } }
        : lc
    )
    setFormData({ ...formData, v3_lcs: next })
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
            ? "bg-success/10 border-success/40 text-success"
            : "bg-warning/10 border-warning/40 text-warning"
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
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-1.5">
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
              className="text-xs font-bold uppercase tracking-[0.14em] text-foreground cursor-pointer"
            >
              作品連動する契約
            </label>
            <p className="text-[11px] text-muted-foreground">
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
            <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
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
                className="text-[11px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-50"
              >
                {creatingWork ? "作成中…" : "＋作成"}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              「どの作品のための契約か」を指定します。一覧に無ければ作品タイトルを入力して作成。選択すると「対象製品（予定）名」へ反映します。
            </p>
          </div>
        )}

        {/* 許諾期間（テンプレ頭書「期間」）。開始日は頭書の契約開始日に反映。 */}
        <div className="col-span-full mt-2 pt-3 border-t border-border/60">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-1.5">
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
            <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
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
              <span className="text-[10px] text-muted-foreground shrink-0">または新規:</span>
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
                className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-50"
              >
                {iltCreatingSource ? "作成中…" : "＋原作を新規作成"}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              マスター &gt; Ledgers で登録した原作 (LO-YYYY-NNNN)。原著作物名・クレジット表示の既定値を補完します。未登録の原作はタイトル入力で作成でき、原作本体素材 -001 も同時生成されます。
            </p>
          </div>

          {/* 原作マテリアル(複数) ＋ 過去の利用許諾条件コピー/新規。 */}
          <div className="col-span-full mt-3 rounded-md border border-success/40 bg-success/10 px-3 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-success">
                原作マテリアル検索（複数可）＋ 過去条件の再利用
              </div>
              <button
                type="button"
                onClick={addMaterialRow}
                className="text-[11px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10"
              >
                ＋マテリアルを追加
              </button>
            </div>

            {materialPool.length === 0 && (
              <p className="text-[10px] text-muted-foreground">
                原作マスター(Ledgers)にマテリアルがありません。上で原作を選択/作成し、「＋マテリアルを追加」の検索欄に素材名を入力するとその場で新規登録できます。
              </p>
            )}

            {masterMaterials.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">
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
                      className="rounded-md border border-success/40 bg-white/70 px-2.5 py-2 space-y-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-success shrink-0">
                          #{i + 1}
                        </span>
                        <MaterialSearchSelect
                          materials={materialPool}
                          value={row.material_code}
                          onPick={(code) => setRowMaterial(i, code)}
                          onCreate={(payload) => createRowMaterial(i, payload)}
                          createDisabledReason={
                            formData.ledger_ref_id
                              ? undefined
                              : "新規登録には上で「原作 (Ledger)」を選択/作成してください"
                          }
                        />
                        <button
                          type="button"
                          onClick={() => removeMaterialRow(i)}
                          className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-destructive hover:bg-destructive/10"
                        >
                          削除
                        </button>
                      </div>
                      {row.material_code && (
                        <div className="flex items-center gap-2 pl-6 flex-wrap">
                          <span className="text-[9px] text-muted-foreground">
                            根拠文書:{" "}
                            <span className="font-bold text-primary">
                              {row.source_doc || "この条件書(新規)"}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border",
                              row.copied
                                ? "text-teal-700 border-teal-300 bg-teal-50"
                                : "text-warning border-warning/40 bg-warning/10"
                            )}
                          >
                            {row.copied ? "A 過去条件を引用" : "B この条件書で新規登録"}
                          </span>
                        </div>
                      )}
                      {row.copied && (
                        <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono text-success pl-6">
                          <span>引用条件: {row.copied.condition_name || "(無題)"}</span>
                          <span className="inline-flex items-center gap-0.5">
                            料率
                            <input
                              type="number"
                              step="0.01"
                              value={row.copied.rate_pct ?? ""}
                              onChange={(e) => setRowCopiedRate(i, e.target.value)}
                              placeholder="未入力"
                              className="w-16 text-[10px] font-mono bg-transparent border-b border-success/40 py-0.5 text-right focus:outline-none focus:border-foreground"
                            />
                            %
                          </span>
                          {(row.copied.rate_pct == null || row.copied.rate_pct === "") && (
                            <span className="text-[9px] text-warning">
                              ブランク条件 — 料率を入力してください
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setRowCopied(i, null)}
                            className="ml-1 text-[9px] underline text-muted-foreground hover:text-destructive"
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
                        <p className="pl-6 text-[10px] text-muted-foreground/70">
                          マテリアルを選ぶと、その原作素材の過去条件を引用(コピー)できます。新規条件はそのまま金銭条件で入力します。
                        </p>
                      )}
                      {/* 案X: この構成要素の金銭条件を「2-1と同じ表構成」で入力する。取引形態(行)×
                          [種別 / 料率(このLC) / MG / AG / 通貨]。編集先は section 3 の v3_lcs と同一
                          データ(rates[cond.id])。料率(このLC)＝加算の合算に効くこの構成要素の料率。
                          MG/AG/通貨/計算モデルは取引形態共通(cond)のため読み取り表示(3.の2-1で編集)。 */}
                      {row.material_code && (() => {
                        const allConds = Array.isArray(formData.v3_conds)
                          ? (formData.v3_conds as any[])
                          : []
                        const lc = (
                          Array.isArray(formData.v3_lcs) ? (formData.v3_lcs as any[]) : []
                        ).find((l: any) => l.material_code === row.material_code)
                        if (allConds.length === 0) {
                          return (
                            <div className="pl-6 text-[10px] font-mono text-warning">
                              金銭条件（取引形態 × 料率）は、下の「3. 金銭条件」で取引形態を初期化後に入力できます。
                            </div>
                          )
                        }
                        const calcShort = (t?: string) =>
                          (({
                            BASE_QTY_RATE: "価格×個数×料率",
                            BASE_RATE: "実効料率",
                            FIXED: "固定額",
                            SUBSCRIPTION: "サブスク",
                            SUPPLY_QTY: "供給×個数×料率",
                          } as Record<string, string>)[String(t || "")] || "")
                        const thc = "px-2 py-1 border-b border-primary/40 whitespace-nowrap"
                        const tdc = "px-2 py-1 border-b border-border/50 align-middle"
                        return (
                          <div className="pl-6 space-y-1">
                            <div className="text-[9px] font-mono font-bold text-primary">
                              金銭条件（取引形態 × 料率）— 2-1と同じ構成
                            </div>
                            <div className="overflow-x-auto rounded-md border border-primary/40">
                              <table className="w-full text-[10px] font-mono border-collapse">
                                <thead className="bg-primary/10 text-muted-foreground">
                                  <tr>
                                    <th className={`${thc} text-left`}>取引形態</th>
                                    <th className={`${thc} text-center w-24`}>種別</th>
                                    <th className={`${thc} text-center w-24`}>料率(このLC)</th>
                                    <th className={`${thc} text-center w-12`}>MG</th>
                                    <th className={`${thc} text-center w-12`}>AG</th>
                                    <th className={`${thc} text-center w-14`}>通貨</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {allConds.map((c: any, ci: number) => (
                                    <tr key={c.id}>
                                      <td className={`${tdc} font-bold`}>{c.name || `取引形態${ci + 1}`}</td>
                                      <td className={`${tdc} text-center`}>
                                        <div className="text-[8px] font-bold">{c.addon ? "加算型" : "非加算型"}</div>
                                        <div className="text-[8px] text-success">{calcShort(c.calc_type)}</div>
                                      </td>
                                      <td className={`${tdc} text-center`}>
                                        {c.addon ? (
                                          <span className="inline-flex items-center gap-0.5">
                                            <input
                                              type="number"
                                              step="0.01"
                                              value={lc?.rates?.[String(c.id)] ?? ""}
                                              onChange={(e) => setRowRate(row.material_code, c.id, e.target.value)}
                                              placeholder="料率"
                                              className="w-14 text-[10px] font-mono bg-transparent border-b border-input py-0.5 text-right focus:outline-none focus:border-foreground"
                                            />
                                            <span className="text-muted-foreground">%</span>
                                          </span>
                                        ) : (
                                          <span className="text-[9px] text-muted-foreground/70">実効料率は3.の2-1</span>
                                        )}
                                      </td>
                                      <td className={`${tdc} text-center text-muted-foreground`}>{c.mg ?? "0"}</td>
                                      <td className={`${tdc} text-center text-muted-foreground`}>{c.ag ?? "0"}</td>
                                      <td className={`${tdc} text-center text-muted-foreground`}>{c.cur || "JPY"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="text-[9px] text-muted-foreground/70">
                              料率(このLC)＝この構成要素の当該取引形態の料率。加算型は各構成要素の料率を合算して適用料率になります。MG/AG/通貨・計算モデルは取引形態共通（3. の 2-1 で編集）。ここの入力は 3. マトリクスにも反映されます。
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground/70">
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
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-1.5">
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
          <span className="text-[11px] text-muted-foreground italic">
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
            <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
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
            <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
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
        <div className="col-span-full space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            担当者を検索して監修者を充填（DB検索補完）
          </label>
          <EntitySearchSelect
            entity="staff"
            onSelect={(o) => o && fillSupervisorFrom(o.raw)}
            placeholder="担当者を検索（氏名 / 部署 / メール）"
          />
        </div>
        {renderField("監修者")}
        {renderField("クレジット表示")}
        {renderField("承認時期")}
        <div className="col-span-full mt-1 pt-2 border-t border-dashed border-input">
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
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
              className="text-[10px] px-2 py-0.5 uppercase border border-foreground/30 text-foreground hover:bg-muted rounded-sm transition-colors"
            >
              クリア
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/70 mt-1">
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
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-1.5">
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
