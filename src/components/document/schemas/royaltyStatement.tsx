/**
 * royaltyStatement — 利用許諾料計算書(royalty_statement) の入力フォーム。
 *
 * 旧 DocumentForm の per-template 分岐(約 1040 行)＋関連の 3 effects/helper を
 * このモジュールへ移設し、SchemaDocumentForm 経由で描画する。UI/挙動・formData
 * キー・PDF テンプレは不変(バイト等価の移設)。契約/原作マスタは AppDataContext
 * (useAppData) から直接取得するため FkCtx への追加は不要。
 *
 * 独自レイアウト(進捗バナー・ステップ・ライブ計算)のため、単一の bare セクションで
 * 本体をまるごと差し込む(SchemaDocumentForm の chrome を被せない)。
 */
import * as React from "react"
import { useAppData } from "@/src/context/AppDataContext"
import { FormSection } from "../FormSection"
import { UnifiedContractPicker } from "../UnifiedContractPicker"
import { FinancialConditionPicker } from "../FinancialConditionPicker"
import { EntitySearchSelect } from "../../search/EntitySearch"
import { RoyaltyPreviewPanel } from "../RoyaltyPreviewPanel"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { DocFormSchema, FkCtx } from "../SchemaDocumentForm"
import { Briefcase, Coins, Scale, User } from "lucide-react"
import { cn } from "@/lib/utils"

// UnifiedContractPicker/FinancialConditionPicker の detail(ContractDetail) を
//   licenseMasters(AppDataContext の契約行)と同じ形へ合成する。allContracts に
//   未掲載の契約(新規 import 直後 等)でも選択・表示を成立させるための吸収ヘルパ。
const detailToLicenseMaster = (d: any) => {
  if (!d || !d.contract) return undefined
  return {
    id: d.contract.id,
    contract_title: d.contract.contract_title || "",
    document_number: d.contract.document_number || "",
    backlog_issue_key: d.contract.backlog_issue_key || "",
    record_type: d.contract.record_type,
    contract_category: d.contract.contract_category,
    contract_type: d.contract.contract_type,
    vendor_id: d.vendor?.id ?? null,
    vendor_code: d.vendor?.vendor_code || "",
    vendor_name: d.vendor?.vendor_name || "",
    vendor_entity_type: d.vendor?.entity_type || d.vendor?.vendor_entity_type || "",
    vendor_bank_name: d.vendor?.bank_name || "",
    vendor_branch_name: d.vendor?.branch_name || "",
    vendor_account_type: d.vendor?.account_type || "",
    vendor_account_number: d.vendor?.account_number || "",
    vendor_account_holder_kana: d.vendor?.account_holder_kana || d.vendor?.account_holder || "",
    vendor_invoice_registration_number: d.vendor?.invoice_registration_number || "",
    vendor_withholding_enabled: d.vendor?.withholding_enabled === true,
    ledger_code: d.contract.ledger_code || "",
    original_work: d.contract.original_work || "",
    work_name: d.contract.original_work || "",
    financial_conditions: Array.isArray(d.financial_conditions) ? d.financial_conditions : [],
    amount_ex_tax: d.contract.amount_ex_tax ?? null,
    effective_date: d.contract.effective_date || null,
    expiration_date: d.contract.expiration_date || null,
  }
}

const RoyaltyStatementForm: React.FC<{ ctx: FkCtx }> = ({ ctx }) => {
  const { formData, setFormData, companyProfile, selectedStaff } = ctx
  const { contracts: allContracts, ledgers: allLedgers } = useAppData()

  // Phase 23.0.4: UnifiedContractPicker の onPick で受け取った detail は
  //   allContracts に必ずしも載っていない (新規 import 直後 等)。最後に onPick した
  //   detail を保持して selectMasterContract / selectedContract lookup を成立させる。
  const [royaltyPickedDetail, setRoyaltyPickedDetail] = React.useState<any>(null)
  // 条件一覧ピッカーで条件を直接選んだとき、契約読込(financial_conditions)後に
  //   その条件を確定するための pending id。0 のとき無効。
  const [pendingRoyaltyCondId, setPendingRoyaltyCondId] = React.useState<number>(0)

  // taxRate / documentDate の初期化(未操作でもテンプレの {{taxRate}}/{{documentDate}}
  //   が空欄にならないよう本日日付・10% で補填)。
  React.useEffect(() => {
    const patch: Record<string, any> = {}
    if (!formData.taxRate) patch.taxRate = "10"
    if (!formData.documentDate) patch.documentDate = new Date().toISOString().slice(0, 10)
    // Phase 29: 計算書タイプ (single=従来1件 / multi=サブライセンス受領→支払の多明細)。
    if (!formData.statementMode) patch.statementMode = "single"
    if (!formData.intakeCurrency) patch.intakeCurrency = "JPY"
    if (Object.keys(patch).length > 0) setFormData({ ...formData, ...patch })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 条件一覧ピッカーで条件を直接選んだとき、契約の financial_conditions が読み込まれた
  //   タイミングで、その条件を確定(capability_financial_condition_id + 計算系を auto-fill)する。
  React.useEffect(() => {
    if (!pendingRoyaltyCondId) return
    const fcs = Array.isArray(formData.financial_conditions)
      ? (formData.financial_conditions as any[])
      : []
    const fc = fcs.find((c) => Number(c.id) === pendingRoyaltyCondId)
    if (!fc) return // まだ契約条件が読み込まれていない
    if (Number(formData.capability_financial_condition_id) === pendingRoyaltyCondId) {
      setPendingRoyaltyCondId(0)
      return
    }
    const calcType =
      fc.calc_method === "SUBSCRIPTION"
        ? "sublicense"
        : fc.calc_method === "FIXED"
        ? "sales"
        : "manufacturing"
    setFormData({
      ...formData,
      capability_financial_condition_id: pendingRoyaltyCondId,
      license_financial_condition_id: 0,
      calcType,
      royaltyRatePct: fc.rate_pct != null ? String(fc.rate_pct) : "",
      mgAmount: fc.mg_amount != null && Number(fc.mg_amount) > 0 ? String(fc.mg_amount) : "",
      agAmount: fc.ag_amount != null && Number(fc.ag_amount) > 0 ? String(fc.ag_amount) : "",
      currency: fc.currency || formData.currency || "JPY",
      paymentConditionSummary: fc.payment_terms || formData.paymentConditionSummary || "",
      料率: fc.rate_pct != null ? String(fc.rate_pct) : formData.料率,
    })
    setPendingRoyaltyCondId(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRoyaltyCondId, formData.financial_conditions])

  // Phase 22.21.101: contract master を選択済みなら、PDF ヘッダ用フィールドが
  //   formData に揃っているか検査し、不足していたら master から静かに補填(上書きしない)。
  React.useEffect(() => {
    if (!Array.isArray(allContracts) || allContracts.length === 0) return
    const selectedId = Number(formData.selected_master_contract_id) || 0
    if (!selectedId) return
    const c: any = allContracts.find((x: any) => Number(x.id) === selectedId)
    if (!c) return

    const patch: Record<string, any> = {}
    if (!formData.linked_contract_number && c.document_number) {
      patch.linked_contract_number = c.document_number
    }
    if (!formData.LICENSOR_SUFFIX) {
      const vt = String(c.vendor_entity_type || c.entity_type || "").toLowerCase()
      const isCorp = vt === "corporate" || vt === "法人"
      patch.LICENSOR_SUFFIX = isCorp ? "御中" : "様"
      patch.LICENSOR_IS_CORPORATION = isCorp ? "法人" : "個人"
    }
    if (!formData.licensor && c.vendor_name) {
      patch.licensor = c.vendor_name
    }
    if (!formData.VENDOR_CODE && c.vendor_code) {
      patch.VENDOR_CODE = c.vendor_code
    }
    if (
      formData.VENDOR_WITHHOLDING_ENABLED == null &&
      c.vendor_withholding_enabled === true
    ) {
      patch.VENDOR_WITHHOLDING_ENABLED = true
    }
    if (!formData.bankName && c.vendor_bank_name) {
      patch.bankName = c.vendor_bank_name
    }
    if (!formData.branchName && c.vendor_branch_name) {
      patch.branchName = c.vendor_branch_name
    }
    if (!formData.accountType && c.vendor_account_type) {
      patch.accountType = c.vendor_account_type
    }
    if (!formData.accountNo && c.vendor_account_number) {
      patch.accountNo = c.vendor_account_number
    }
    if (!formData.accountHolder && c.vendor_account_holder_kana) {
      patch.accountHolder = c.vendor_account_holder_kana
    }
    if (
      !formData.invoiceRegistrationNumber &&
      c.vendor_invoice_registration_number
    ) {
      patch.invoiceRegistrationNumber = c.vendor_invoice_registration_number
    }

    if (Object.keys(patch).length > 0) {
      setFormData({ ...formData, ...patch })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formData.selected_master_contract_id,
    formData.linked_contract_number,
    formData.LICENSOR_SUFFIX,
    formData.licensor,
    formData.bankName,
    formData.accountNo,
    allContracts.length,
  ])

  // ---- データ参照 ---------------------------------------------------
  // 候補となる契約マスタ: license カテゴリの 単独/個別 で financial_conditions[] を持つもの。
  const licenseMasters = (allContracts || []).filter((c: any) => {
    const cat = String(c.contract_category || "").toLowerCase()
    const hasConds =
      Array.isArray(c.financial_conditions) && c.financial_conditions.length > 0
    if (!hasConds) return false
    const isLicense =
      cat === "license" &&
      (c.record_type === "standalone_contract" ||
        c.record_type === "individual_contract" ||
        c.record_type === "license_condition")
    // Phase 26.10: 出版等利用許諾条件書 (publication_condition) の金銭条件も対象に含める。
    const isPublication =
      cat === "publication" && c.record_type === "publication_condition"
    return isLicense || isPublication
  })

  const selectedContractId = Number(formData.selected_master_contract_id) || 0
  const selectedContract = (() => {
    const fromList = licenseMasters.find(
      (c: any) => Number(c.id) === selectedContractId
    )
    if (fromList) return fromList
    if (
      royaltyPickedDetail &&
      Number(royaltyPickedDetail.contract.id) === selectedContractId
    ) {
      return detailToLicenseMaster(royaltyPickedDetail)
    }
    return undefined
  })()
  const selectedConditionId = Number(formData.capability_financial_condition_id) || 0
  const ledgerForContract = selectedContract?.ledger_code
    ? (allLedgers || []).find((l: any) => l.ledger_code === selectedContract.ledger_code)
    : null

  // A案: 明細行に親契約(イン側)を割り当てる。選んだ契約の第1金銭条件の料率を
  //   その行の初期料率にし, 契約タイトル/番号も記録する(行ごとに上書き可)。
  const setLineContract = (i: number, contractId: string) => {
    const c = (licenseMasters || []).find(
      (x: any) => String(x.id) === String(contractId)
    )
    const firstCond =
      c && Array.isArray(c.financial_conditions) && c.financial_conditions.length > 0
        ? c.financial_conditions[0]
        : null
    const rate =
      firstCond && firstCond.rate_pct != null ? String(firstCond.rate_pct) : ""
    const method = firstCond ? methodFromCalc(firstCond.calc_method) : undefined
    updateLine(i, {
      contractId: contractId || "",
      contractTitle: c?.contract_title || "",
      contractNumber: c?.document_number || "",
      // 契約選択時は料率・計算方式をその契約の条件で上書き(未取得なら現状維持)。
      ...(rate !== "" ? { ratePct: rate } : {}),
      ...(method ? { calcMethod: method } : {}),
    })
  }

  // ---- イベントハンドラ -------------------------------------------
  // 契約マスタを選ぶと、当事者 / 原作 / 金銭条件配列 / デフォルト通貨を一括 auto-fill。
  // インボイス番号の先頭 T を除去(表示は T 無しで統一。テンプレ側で付す)。
  const stripLeadingT = (s?: string | null): string =>
    String(s || "").replace(/^[Tt]/, "")
  // 取引先の法人/個人 判定(発注書 fillVendorFrom と同一ロジック)。
  const isCorporation = (v: any) => {
    const et = String(v?.entity_type || v?.vendor_entity_type || "")
      .trim()
      .toLowerCase()
    if (et === "individual" || et === "個人") return false
    if (et.includes("corp") || et.includes("法人")) return true
    if (String(v?.corporate_number || "").trim()) return true
    return /株式会社|有限会社|合同会社|合名会社|合資会社|相互会社|社団法人|財団法人|学校法人|医療法人|宗教法人|協同組合|（株）|（有）|㈱|㈲|株式會社/.test(
      String(v?.vendor_name || "")
    )
  }
  // 取引先マスタからライセンサー(取引先)を直接補完(契約未紐付けでも使える)。
  //   発注書の fillVendorFrom と同等: 名称/敬称/代表者/銀行/インボイス/源泉。
  const fillLicensorFromVendor = (v: any) => {
    if (!v) return
    const isCorp = isCorporation(v)
    const rep = v.vendor_rep || v.contact_name || ""
    setFormData({
      ...formData,
      VENDOR_CODE: v.vendor_code || "",
      licensor: v.vendor_name || "",
      LICENSOR_SUFFIX: isCorp ? "御中" : "様",
      LICENSOR_IS_CORPORATION: isCorp ? "法人" : "個人",
      VENDOR_REPRESENTATIVE_SAMA: isCorp && rep ? `${rep} 様` : "",
      VENDOR_WITHHOLDING_ENABLED: !!v.withholding_enabled,
      bankName: v.bank_name || "",
      branchName: v.branch_name || "",
      accountType: v.account_type || "",
      accountNo: v.account_number || "",
      accountHolder: v.account_holder_kana || "",
      invoiceRegistrationNumber: stripLeadingT(v.invoice_registration_number),
    })
  }
  // 自社プロファイルからライセンシー(自社)名を補完。
  const fillLicenseeFromSelf = () =>
    setFormData({ ...formData, licensee: companyProfile?.name || formData.licensee || "" })

  const selectMasterContract = (id: number, fromDetail?: any) => {
    const c =
      licenseMasters.find((x: any) => Number(x.id) === id) ||
      (fromDetail ? detailToLicenseMaster(fromDetail) : undefined)
    if (!c) {
      setFormData({
        ...formData,
        selected_master_contract_id: 0,
        financial_conditions: [],
        capability_financial_condition_id: 0,
        license_financial_condition_id: 0,
      })
      return
    }
    const ledger = c.ledger_code
      ? (allLedgers || []).find((l: any) => l.ledger_code === c.ledger_code)
      : null
    const firstCond = (c.financial_conditions || [])[0]
    const vendorEntityType = String(
      (c as any).vendor_entity_type || (c as any).entity_type || ""
    ).toLowerCase()
    const isCorporate =
      vendorEntityType === "corporate" || vendorEntityType === "法人"
    const licensorSuffix = isCorporate ? "御中" : "様"

    setFormData({
      ...formData,
      selected_master_contract_id: id,
      linked_contract_number: c.document_number || formData.linked_contract_number || "",
      VENDOR_CODE: (c as any).vendor_code || formData.VENDOR_CODE || "",
      VENDOR_WITHHOLDING_ENABLED:
        (c as any).vendor_withholding_enabled === true ||
        formData.VENDOR_WITHHOLDING_ENABLED === true,
      licensor: c.vendor_name || formData.licensor || "",
      LICENSOR_SUFFIX: licensorSuffix,
      LICENSOR_IS_CORPORATION: isCorporate ? "法人" : "個人",
      licensee: companyProfile?.name || formData.licensee || "",
      bankName: (c as any).vendor_bank_name || formData.bankName || "",
      branchName: (c as any).vendor_branch_name || formData.branchName || "",
      accountType: (c as any).vendor_account_type || formData.accountType || "",
      accountNo: (c as any).vendor_account_number || formData.accountNo || "",
      accountHolder: (c as any).vendor_account_holder_kana || formData.accountHolder || "",
      invoiceRegistrationNumber:
        (c as any).vendor_invoice_registration_number ||
        formData.invoiceRegistrationNumber ||
        "",
      originalWork:
        ledger?.title || c.original_work || c.work_name || formData.originalWork || "",
      financial_conditions: (c.financial_conditions as any[]).map((fc) => ({
        ...fc,
        source: "capability" as const,
      })),
      license_contract_id: 0,
      license_financial_condition_id: 0,
      capability_financial_condition_id: 0,
      currency: firstCond?.currency || formData.currency || "JPY",
    })
  }

  // 金銭条件 (radio) 選択時: capability_financial_condition_id に id をセットし、
  // PDF テンプレ用の計算系フィールドも条件から auto-fill。
  const selectCondition = (cid: number) => {
    const fc = selectedContract?.financial_conditions?.find(
      (c: any) => Number(c.id) === cid
    )
    if (!fc) return
    const calcType =
      fc.calc_method === "SUBSCRIPTION"
        ? "sublicense"
        : fc.calc_method === "FIXED"
        ? "sales"
        : "manufacturing"
    setFormData({
      ...formData,
      capability_financial_condition_id: cid,
      license_financial_condition_id: 0,
      calcType,
      royaltyRatePct: fc.rate_pct != null ? String(fc.rate_pct) : "",
      mgAmount:
        fc.mg_amount != null && Number(fc.mg_amount) > 0 ? String(fc.mg_amount) : "",
      agAmount:
        fc.ag_amount != null && Number(fc.ag_amount) > 0 ? String(fc.ag_amount) : "",
      currency: fc.currency || formData.currency || "JPY",
      paymentConditionSummary: fc.payment_terms || formData.paymentConditionSummary || "",
      料率: fc.rate_pct != null ? String(fc.rate_pct) : formData.料率,
    })
  }

  // 製造数 / サンプル数の変更時: 課金対象数を自動計算。
  const updateQuantity = (patch: Record<string, any>) => {
    const next = { ...formData, ...patch }
    const billable = Math.max(
      0,
      (Number(next.quantity) || 0) - (Number(next.sampleQuantity) || 0)
    )
    setFormData({ ...next, billableQuantity: String(billable) })
  }

  // ---- Phase 29: 多明細 (サブライセンス受領 → イン側料率で支払) --------
  // アウト側入金額を明細ごとの base とし、イン側条件の料率で支払額を計算する。
  //   入金通貨が JPY 以外なら fxRate で外貨売上 → 円 base に換算。
  //   各行 支払 = ceil(base × 料率/100)。RevenueTerms(売上報告ベース)と同じ ceil。
  const statementMode = String(formData.statementMode || "single")
  const isMulti = statementMode === "multi"
  const intakeCurrency = String(formData.intakeCurrency || "JPY")
  const isForeignIntake = intakeCurrency !== "JPY"
  const fxRate = Number(formData.fxRate) || 0
  const fmtYen = (n: number) =>
    new Intl.NumberFormat("ja-JP").format(Math.round(Number(n) || 0))

  // 計算方式ラベル。manufacturing=製造ベース(基準価格×数量×料率)、
  //   revenue=売上/受領額ベース(実受領額×料率)。
  const methodLabelOf = (m: string) =>
    m === "manufacturing" ? "製造ベース" : "売上ベース"
  // 契約条件の calc_method から方式を推定 (QTY/製造/業績連動 → manufacturing)。
  const methodFromCalc = (cm: any): "manufacturing" | "revenue" => {
    const s = String(cm || "").toUpperCase()
    if (
      s.includes("QTY") ||
      s.includes("MANUF") ||
      s.includes("PERFORM") ||
      s.includes("製造")
    )
      return "manufacturing"
    return "revenue"
  }

  // 1 明細を計算 (render 時に live 表示するためにも使う)。方式で算式を切替える。
  //   manufacturing: 支払 = ceil(基準価格 × 課金数量 × 料率/100)  (PerformanceTerms)
  //   revenue      : 支払 = ceil(実受領額 × 料率/100)             (RevenueTerms)
  //   算定基礎額(base) は小計・帳票表示に使う。
  const computeLine = (raw: any) => {
    const method = String(raw?.calcMethod || "revenue")
    const ratePct =
      raw?.ratePct !== undefined && raw?.ratePct !== ""
        ? Number(raw.ratePct)
        : Number(formData.royaltyRatePct) || 0
    let base = 0
    let paymentJpy = 0
    let basisNote = ""
    if (method === "manufacturing") {
      const unitPrice = Number(raw?.unitPrice) || 0
      const qty = Number(raw?.qty) || 0
      const sample = Number(raw?.sample) || 0
      const billable = Math.max(0, qty - sample)
      base = Math.round(unitPrice * billable)
      paymentJpy = Math.ceil((unitPrice * billable * ratePct) / 100)
      basisNote =
        unitPrice > 0 && billable > 0
          ? `¥${fmtYen(unitPrice)} × ${fmtYen(billable)}個`
          : ""
    } else {
      const salesInput = Number(raw?.salesInput) || 0
      base = isForeignIntake
        ? Math.round(salesInput * fxRate)
        : Math.round(salesInput)
      paymentJpy = Math.ceil((base * ratePct) / 100)
    }
    return {
      calcMethod: method,
      productName: raw?.productName || "",
      salesInput: raw?.salesInput ?? "",
      unitPrice: raw?.unitPrice ?? "",
      qty: raw?.qty ?? "",
      sample: raw?.sample ?? "",
      ratePct: raw?.ratePct ?? "",
      // 親契約(イン側)。行ごとに異なる契約に紐づけられる(A案)。
      contractId: raw?.contractId ?? "",
      contractTitle: raw?.contractTitle || "",
      contractNumber: raw?.contractNumber || "",
      // 派生 (テンプレ用)
      methodLabel: methodLabelOf(method),
      basisNote,
      salesJpy: base,
      salesJpyStr: fmtYen(base),
      ratePctResolved: ratePct,
      paymentJpy,
      paymentJpyStr: fmtYen(paymentJpy),
    }
  }

  const rawLines = (): any[] =>
    Array.isArray(formData.lines) ? formData.lines : []

  // 明細配列を計算し, 合計/税/税込を formData へ確定する。
  const recalcAndSet = (
    nextRawLines: any[],
    extraPatch: Record<string, any> = {}
  ) => {
    const computed = nextRawLines.map(computeLine)
    const totalSales = computed.reduce((s, l) => s + (l.salesJpy || 0), 0)
    const totalPayment = computed.reduce((s, l) => s + (l.paymentJpy || 0), 0)
    const taxRate = Number(formData.taxRate) || 10
    const tax = Math.ceil((totalPayment * taxRate) / 100)

    // A案: 親契約(イン側)ごとにグループ化し, 契約単位の小計を持たせる。
    //   contractId 未指定の行は「契約未指定」グループにまとめる。出現順を保つ。
    const groupOrder: string[] = []
    const groupMap: Record<string, any> = {}
    for (const l of computed) {
      const key = String(l.contractId || "") || "__none__"
      if (!groupMap[key]) {
        groupMap[key] = {
          contractId: l.contractId || "",
          contractTitle: l.contractTitle || "",
          contractNumber: l.contractNumber || "",
          methodLabel: l.methodLabel || "",
          lines: [],
          subtotalSales: 0,
          subtotalPayment: 0,
        }
        groupOrder.push(key)
      }
      const g = groupMap[key]
      g.lines.push(l)
      g.subtotalSales += l.salesJpy || 0
      g.subtotalPayment += l.paymentJpy || 0
    }
    const lineGroups = groupOrder.map((k) => {
      const g = groupMap[k]
      return {
        contractId: g.contractId,
        contractTitle: g.contractTitle,
        contractNumber: g.contractNumber,
        methodLabel: g.methodLabel,
        lines: g.lines,
        subtotalSalesStr: fmtYen(g.subtotalSales),
        subtotalPaymentStr: fmtYen(g.subtotalPayment),
      }
    })

    setFormData({
      ...formData,
      ...extraPatch,
      lines: computed,
      lineGroups,
      lineGroupsCount: lineGroups.length,
      linesCount: computed.length,
      linesTotalSalesJpy: totalSales,
      linesTotalSalesStr: fmtYen(totalSales),
      linesTotalPaymentJpy: totalPayment,
      linesTotalPaymentStr: fmtYen(totalPayment),
      linesTaxStr: fmtYen(tax),
      linesTotalIncTaxStr: fmtYen(totalPayment + tax),
    })
  }

  const addLine = () =>
    recalcAndSet([
      ...rawLines(),
      { productName: "", calcMethod: "revenue", salesInput: "", ratePct: "" },
    ])
  const updateLine = (i: number, patch: Record<string, any>) =>
    recalcAndSet(
      rawLines().map((l: any, idx: number) => (idx === i ? { ...l, ...patch } : l))
    )
  const removeLine = (i: number) =>
    recalcAndSet(rawLines().filter((_: any, idx: number) => idx !== i))

  // レート/通貨/税率/既定料率が変わったら既存明細を再計算 (合計を同期)。
  React.useEffect(() => {
    if (!isMulti) return
    const raw = rawLines()
    if (raw.length === 0) return
    recalcAndSet(raw)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formData.fxRate,
    formData.intakeCurrency,
    formData.taxRate,
    formData.royaltyRatePct,
    isMulti,
  ])

  // ---- 入力状況サマリ ---------------------------------------------
  const billableQty = Math.max(
    0,
    (Number(formData.quantity) || 0) - (Number(formData.sampleQuantity) || 0)
  )
  // Phase 28: 計算方式。manufacturing … 製造/印刷契機、sales/sublicense … 売上報告ベース。
  const calcType = String(formData.calcType || "manufacturing")
  const isRevenueCalc = calcType !== "manufacturing"
  const stepStatus = {
    step1: selectedContract && selectedConditionId > 0,
    step2:
      formData.productName &&
      Number(formData.msrpStr) > 0 &&
      (isRevenueCalc || Number(formData.quantity) > 0),
    step3: !!formData.STAFF_NAME,
    step4: !!formData.currency,
  }
  const stepsDone = [
    stepStatus.step1,
    stepStatus.step2,
    stepStatus.step3,
    stepStatus.step4,
  ].filter(Boolean).length
  const totalSteps = 4

  return (
    <div className="space-y-6">
      {/* Phase 29: 計算書タイプ切替 — 単票 / 多明細(サブライセンス受領→支払) */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-sm border border-input bg-muted/20">
        <span className="text-[11px] font-mono opacity-70">計算書タイプ:</span>
        {[
          { v: "single", label: "単票 (1件計算)" },
          { v: "multi", label: "多明細 (受領→支払)" },
        ].map((opt) => {
          const active = statementMode === opt.v
          return (
            <button
              key={opt.v}
              type="button"
              onClick={() => setFormData({ ...formData, statementMode: opt.v })}
              className={cn(
                "text-[11px] font-mono px-3 py-1 rounded-sm border transition-colors",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-input hover:bg-muted"
              )}
            >
              {opt.label}
            </button>
          )
        })}
        <span className="text-[10px] font-mono opacity-60 ml-auto">
          {isMulti
            ? "サブライセンス受領額を明細ごとの base とし、イン側料率で支払を計算"
            : "従来の 1 件計算 (製造/売上/受領額ベース)"}
        </span>
      </div>

      {/* 進捗バナー (単票のみ) */}
      {!isMulti && (
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-4 py-2.5 rounded-sm border",
          stepsDone === totalSteps
            ? "bg-success/10 border-success/40 text-success"
            : "bg-warning/10 border-warning/40 text-warning"
        )}
      >
        <div className="text-[11px] font-mono">
          {stepsDone === totalSteps ? (
            <>✓ 必要な入力はすべて揃いました ({totalSteps} ステップ)</>
          ) : (
            <>
              ステップ {stepsDone} / {totalSteps} 完了 —
              {!stepStatus.step1 && " 1) 契約と条件を選択"}
              {stepStatus.step1 && !stepStatus.step2 && " 2) 製品・上代・製造数を入力"}
              {stepStatus.step1 && stepStatus.step2 && !stepStatus.step3 && " 3) 担当者 (連絡先) を選択"}
              {stepStatus.step1 && stepStatus.step2 && stepStatus.step3 && !stepStatus.step4 && " 4) 通貨を選択"}
            </>
          )}
        </div>
        <div className="text-[10px] font-mono opacity-70">
          発行日: {formData.documentDate || "未設定"}
        </div>
      </div>
      )}

      {/* ─── STEP 1 ─ 契約と条件 ──────────────────────────── */}
      <FormSection
        title="ステップ 1 — 契約と条件"
        variant="indigo"
        icon={<Briefcase className="w-4 h-4" />}
      >
        <div className="col-span-full space-y-4">
          {/* ① 契約マスタ (マスター検索) */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-mono">
              ① ライセンス／出版の契約・条件を選ぶ <span className="text-destructive">*</span>
            </Label>
            {/* Phase 23: UnifiedContractPicker に統合。license カテゴリの 個別契約 /
                単独契約 / license_condition を検収書と同じ操作感で検索・選択。
                Phase 26.10: publication の出版等利用許諾条件書も選択可能。 */}
            <UnifiedContractPicker
              acceptableRecordTypes={[
                "individual_contract",
                "standalone_contract",
                "license_condition",
                "publication_condition",
                "purchase_order",
              ]}
              categoryFilter={["license", "publication", "service"]}
              currentContractId={selectedContractId || undefined}
              hasParent={selectedContractId > 0}
              label={
                selectedContractId > 0
                  ? "契約・条件を切り替える"
                  : "ライセンス契約／出版条件／印税付き発注書を選ぶ"
              }
              onPick={(detail) => {
                setRoyaltyPickedDetail(detail)
                selectMasterContract(detail.contract.id, detail)
              }}
              onClear={() => {
                setRoyaltyPickedDetail(null)
                selectMasterContract(0)
              }}
            />
            {/* 条件一覧から直接選ぶ（発注書由来の印税も同じ土俵で選べる）。 */}
            <div className="text-[10px] text-muted-foreground">
              — または —
            </div>
            <FinancialConditionPicker
              currentConditionId={selectedConditionId || undefined}
              label="利用許諾条件（印税）を一覧から選ぶ"
              onPick={(detail, conditionId) => {
                setRoyaltyPickedDetail(detail)
                selectMasterContract(detail.contract.id, detail)
                // financial_conditions 読込後に effect で条件を確定。
                setPendingRoyaltyCondId(conditionId)
              }}
              onClear={() => {
                setPendingRoyaltyCondId(0)
                setFormData({
                  ...formData,
                  capability_financial_condition_id: 0,
                })
              }}
            />
            {licenseMasters.length === 0 && (
              <p className="text-[10px] font-mono text-warning">
                ⚠ 候補となる契約・条件がありません。
                ライセンス系の 単独契約 / 個別契約、または出版等利用許諾条件書を作成して、
                金銭条件 (印税率など) を登録してください。
              </p>
            )}
            {selectedContract && (
              <div className="text-[10px] text-muted-foreground space-y-0.5">
                <p>
                  選択中: <strong>{selectedContract.contract_title}</strong>
                  {selectedContract.document_number && (
                    <> ({selectedContract.document_number})</>
                  )}
                </p>
                {/* Phase 22.21.101: 契約番号 (PDF ヘッダ右上「契約番号:」) を表示。 */}
                {selectedContract.document_number && (
                  <p className="flex items-center gap-1">
                    <span>PDF ヘッダ「契約番号」に反映:</span>
                    <span
                      className={cn(
                        "font-bold px-1.5 py-0.5 rounded-sm",
                        formData.linked_contract_number === selectedContract.document_number
                          ? "bg-success/10 border border-success/40 text-success"
                          : "bg-warning/10 border border-warning/40 text-warning"
                      )}
                    >
                      {formData.linked_contract_number || "(未設定 — 自動同期中)"}
                    </span>
                    {formData.linked_contract_number !==
                      selectedContract.document_number && (
                      <button
                        type="button"
                        onClick={() =>
                          setFormData({
                            ...formData,
                            linked_contract_number: selectedContract.document_number,
                          })
                        }
                        className="text-[11px] font-mono px-1.5 py-0.5 border border-input rounded-sm hover:bg-muted"
                        title="contract_capability の document_number で上書き"
                      >
                        ↻ 同期
                      </button>
                    )}
                  </p>
                )}
                {/* Phase 22.21.108: 取引先コード + 源泉徴収フラグ を可視化。 */}
                <p className="flex items-center gap-2 flex-wrap">
                  <span>取引先コード:</span>
                  <span
                    className={cn(
                      "font-bold px-1.5 py-0.5 rounded-sm",
                      formData.VENDOR_CODE
                        ? "bg-primary/10 border border-primary/40 text-primary"
                        : "bg-muted border border-input text-muted-foreground"
                    )}
                  >
                    {formData.VENDOR_CODE || "(未設定)"}
                  </span>
                  <span className="opacity-50">|</span>
                  <span>源泉徴収:</span>
                  <span
                    className={cn(
                      "font-bold px-1.5 py-0.5 rounded-sm",
                      formData.VENDOR_WITHHOLDING_ENABLED
                        ? "bg-warning/10 border border-warning/40 text-warning"
                        : "bg-muted border border-input text-muted-foreground"
                    )}
                  >
                    {formData.VENDOR_WITHHOLDING_ENABLED ? "対象 (10.21%)" : "対象外"}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setFormData({
                        ...formData,
                        VENDOR_WITHHOLDING_ENABLED: !formData.VENDOR_WITHHOLDING_ENABLED,
                      })
                    }
                    className="text-[11px] font-mono px-1.5 py-0.5 border border-input rounded-sm hover:bg-muted"
                    title="源泉徴収の対象/対象外をトグル (取引先マスタ未設定時の手動上書き用)"
                  >
                    ⇄ 切替
                  </button>
                </p>
              </div>
            )}
          </div>

          {/* ② 金銭条件 (radio) */}
          {selectedContract &&
            Array.isArray(selectedContract.financial_conditions) &&
            selectedContract.financial_conditions.length > 0 && (
              <div className="space-y-1">
                <Label className="text-[11px] font-mono">
                  ② 金銭条件 <span className="text-destructive">*</span>
                </Label>
                <div className="space-y-1.5 border border-input rounded-sm p-2 bg-muted/20">
                  {selectedContract.financial_conditions.map((c: any) => {
                    const cid = Number(c.id)
                    const selected = selectedConditionId === cid
                    return (
                      <label
                        key={`cond-${cid}`}
                        className={cn(
                          "flex items-center gap-2 cursor-pointer text-[11px] font-mono p-1.5 rounded-sm",
                          selected ? "bg-foreground text-background" : "hover:bg-muted/40"
                        )}
                      >
                        <input
                          type="radio"
                          name="capability_financial_condition_id"
                          checked={selected}
                          onChange={() => selectCondition(cid)}
                          className="cursor-pointer"
                        />
                        <span className="font-bold">条件 {c.condition_no}</span>
                        <span className="opacity-70">{c.calc_method || "—"}</span>
                        <span className="opacity-70">
                          {c.rate_pct !== undefined && c.rate_pct !== null
                            ? `${c.rate_pct}%`
                            : ""}
                        </span>
                        {c.mg_amount && Number(c.mg_amount) > 0 ? (
                          <span className="opacity-70">
                            MG {Number(c.mg_amount).toLocaleString("ja-JP")}
                          </span>
                        ) : null}
                        {c.region_language_label && (
                          <span className="opacity-60 ml-auto text-[11px]">
                            {c.region_language_label}
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

          {/* ③ 当事者。契約紐付け時は自動入力、未紐付けでも取引先/自社から手動補完可。 */}
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="flex-1 space-y-1">
                <Label className="text-[10px] font-mono opacity-70">
                  取引先を検索してライセンサーを補完（契約を紐付けない場合もこちらから）
                </Label>
                <EntitySearchSelect
                  entity="vendor"
                  onSelect={(o) => o && fillLicensorFromVendor(o.raw)}
                  placeholder="取引先を検索（名称 / コード）"
                />
              </div>
              <button
                type="button"
                onClick={fillLicenseeFromSelf}
                className="text-[11px] font-mono px-3 py-1.5 border border-input rounded-sm bg-background hover:bg-accent flex-shrink-0"
                title="自社プロファイルからライセンシー(自社)名を補完"
              >
                自社を引用
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] font-mono opacity-70">
                  ライセンサー (取引先)
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={formData.licensor || ""}
                    onChange={(e) => setFormData({ ...formData, licensor: e.target.value })}
                    className="text-xs flex-1"
                    placeholder="契約マスタから自動入力"
                  />
                  {/* Phase 22.21.100: 敬称 (御中/様) を目視確認 + 手動上書き。 */}
                  <select
                    value={formData.LICENSOR_SUFFIX || "様"}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        LICENSOR_SUFFIX: e.target.value,
                        LICENSOR_IS_CORPORATION: e.target.value === "御中" ? "法人" : "個人",
                      })
                    }
                    className="text-xs font-mono px-2 py-1.5 border border-input rounded-sm bg-background focus:outline-none focus:border-foreground flex-shrink-0"
                    title="法人なら『御中』、個人なら『様』"
                  >
                    <option value="様">様 (個人)</option>
                    <option value="御中">御中 (法人)</option>
                  </select>
                </div>
                <p className="text-[10px] text-muted-foreground/70">
                  取引先マスタの 法人/個人 区分から自動判定 (上書き可)
                </p>
                <Input
                  value={formData.VENDOR_REPRESENTATIVE_SAMA || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, VENDOR_REPRESENTATIVE_SAMA: e.target.value })
                  }
                  className="text-xs"
                  placeholder="代表者名 (＋様)"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-mono opacity-70">
                  ライセンシー (自社 — 自動入力)
                </Label>
                <Input
                  value={formData.licensee || ""}
                  onChange={(e) => setFormData({ ...formData, licensee: e.target.value })}
                  className="text-xs"
                  placeholder="自社プロファイルから自動入力"
                />
              </div>
            </div>
          </div>

          {/* ④ 原著作物 (ledger 由来) */}
          {selectedContract && (
            <div className="space-y-1">
              <Label className="text-[10px] font-mono opacity-70">
                原著作物 (原作マスタから自動引用) <span className="text-destructive">*</span>
              </Label>
              {ledgerForContract ? (
                <div className="flex items-center gap-2 text-xs font-mono px-3 py-2 border border-success/40 bg-success/10 rounded-sm">
                  <span className="font-bold">{ledgerForContract.title || "(無題)"}</span>
                  <span className="opacity-60 text-[10px]">
                    [{ledgerForContract.ledger_code}]
                  </span>
                </div>
              ) : (
                <>
                  <select
                    value=""
                    onChange={(e) => {
                      const lc = e.target.value
                      const l = (allLedgers || []).find((x: any) => x.ledger_code === lc)
                      if (l) {
                        setFormData({ ...formData, originalWork: l.title || "" })
                      }
                    }}
                    className="w-full text-xs font-mono px-2 py-1.5 border border-input rounded-sm bg-background focus:outline-none focus:border-foreground"
                  >
                    <option value="">— 原作マスタから選択 —</option>
                    {(allLedgers || []).map((l: any) => (
                      <option key={`ledger-${l.id}`} value={l.ledger_code}>
                        {l.title || "(無題)"} [{l.ledger_code}]
                      </option>
                    ))}
                  </select>
                  <Input
                    value={formData.originalWork || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, originalWork: e.target.value })
                    }
                    className="text-xs"
                    placeholder="原著作物名 (手入力も可)"
                  />
                  <p className="text-[10px] font-mono text-warning">
                    ⚠ 契約マスタに ledger 未紐付。
                    上で原作を選択するか手入力してください。
                    (契約マスタ側で ledger を紐づけると次回から自動入力されます)
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </FormSection>

      {/* ─── 多明細モード ─ 受領情報 + 明細テーブル (multi のみ) ─── */}
      {isMulti && (
        <>
          <FormSection
            title="受領情報（アウト側入金）"
            variant="emerald"
            icon={<Coins className="w-4 h-4" />}
          >
            <div className="col-span-full grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] font-mono">入金企業（サブライセンシー）</Label>
                <Input
                  value={formData.payerCompany || ""}
                  onChange={(e) => setFormData({ ...formData, payerCompany: e.target.value })}
                  placeholder="例: Don't Panic"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-mono">カテゴリー</Label>
                <Input
                  value={formData.royaltyCategory || ""}
                  onChange={(e) => setFormData({ ...formData, royaltyCategory: e.target.value })}
                  placeholder="例: 2026Q1ロイヤリティ"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-mono">デザイナー / 権利者</Label>
                <Input
                  value={formData.designerName || ""}
                  onChange={(e) => setFormData({ ...formData, designerName: e.target.value })}
                  placeholder="例: 今野隼史"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-mono">希望納期</Label>
                <Input
                  type="date"
                  value={formData.desiredDeadline || ""}
                  onChange={(e) => setFormData({ ...formData, desiredDeadline: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-mono">入金通貨</Label>
                <select
                  value={intakeCurrency}
                  onChange={(e) => setFormData({ ...formData, intakeCurrency: e.target.value })}
                  className="w-full text-xs font-mono px-2 py-1.5 border border-input rounded-sm bg-background focus:outline-none focus:border-foreground"
                >
                  <option value="JPY">JPY（円で入金 — レート不要）</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="CNY">CNY</option>
                </select>
              </div>
              {isForeignIntake && (
                <div className="space-y-1">
                  <Label className="text-[11px] font-mono">
                    入金日レート（1 {intakeCurrency} = ? 円）{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={formData.fxRate || ""}
                    onChange={(e) => setFormData({ ...formData, fxRate: e.target.value })}
                    placeholder="例: 184.83"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    外貨売上 × レート = 円換算売上（base）。この base × 料率で支払額を計算します。
                  </p>
                </div>
              )}
            </div>
          </FormSection>

          <FormSection
            title="明細（製品ごと 売上 × 料率 = 支払額）"
            variant="indigo"
            icon={<Scale className="w-4 h-4" />}
          >
            <div className="col-span-full space-y-3">
              <p className="text-[10px] text-muted-foreground">
                各行で<strong>親契約（イン側）</strong>を選ぶと、その契約の料率・
                <strong>計算方式</strong>が初期セットされ、契約タイトル・番号が記録されます
                （行ごとに上書き可）。方式は<strong>売上ベース</strong>（実受領額×料率）と
                <strong>製造ベース</strong>（基準価格×課金数量×料率）から選べます。
                帳票は契約ごとにグループ化し、契約単位の小計→総合計を表示します。
                {(licenseMasters || []).length === 0 && (
                  <span className="text-warning">
                    {" "}⚠ 候補となるライセンス契約がありません。ステップ 1 で契約を選ぶか、
                    契約マスタに金銭条件を登録してください。
                  </span>
                )}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono border border-input">
                  <thead>
                    <tr className="bg-muted/40">
                      <th className="p-1.5 text-left">親契約（イン側）</th>
                      <th className="p-1.5 text-left">製品名</th>
                      <th className="p-1.5">方式</th>
                      <th className="p-1.5 text-right">売上（{intakeCurrency}）</th>
                      <th className="p-1.5 text-right">基準価格</th>
                      <th className="p-1.5 text-right">製造数</th>
                      <th className="p-1.5 text-right">サンプル</th>
                      <th className="p-1.5 text-right">料率%</th>
                      <th className="p-1.5 text-right">算定基礎額（円）</th>
                      <th className="p-1.5 text-right">支払額（円）</th>
                      <th className="p-1.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rawLines().length === 0 && (
                      <tr>
                        <td colSpan={11} className="p-3 text-center text-muted-foreground">
                          明細がありません。「＋ 明細を追加」で行を追加してください。
                        </td>
                      </tr>
                    )}
                    {rawLines().map((l: any, i: number) => {
                      const c = computeLine(l)
                      const isMfg = c.calcMethod === "manufacturing"
                      const muted = (
                        <span className="text-muted-foreground/50">—</span>
                      )
                      return (
                        <tr key={i} className="border-t border-input">
                          <td className="p-1">
                            <select
                              value={String(l.contractId || "")}
                              onChange={(e) => setLineContract(i, e.target.value)}
                              className="text-[11px] h-7 w-full min-w-[150px] border border-input rounded-sm bg-background px-1 focus:outline-none focus:border-foreground"
                            >
                              <option value="">（契約を選択）</option>
                              {(licenseMasters || []).map((mc: any) => (
                                <option key={mc.id} value={String(mc.id)}>
                                  {mc.contract_title || "(無題)"}
                                  {mc.document_number ? ` [${mc.document_number}]` : ""}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-1">
                            <Input
                              value={l.productName || ""}
                              onChange={(e) => updateLine(i, { productName: e.target.value })}
                              className="text-[11px] h-7 min-w-[120px]"
                              placeholder="製品 / 版"
                            />
                          </td>
                          <td className="p-1">
                            <select
                              value={c.calcMethod}
                              onChange={(e) => updateLine(i, { calcMethod: e.target.value })}
                              className="text-[11px] h-7 border border-input rounded-sm bg-background px-1 focus:outline-none focus:border-foreground"
                            >
                              <option value="revenue">売上ベース</option>
                              <option value="manufacturing">製造ベース</option>
                            </select>
                          </td>
                          {/* 売上（売上ベースのみ入力） */}
                          <td className="p-1 text-right">
                            {isMfg ? (
                              muted
                            ) : (
                              <Input
                                type="number"
                                min="0"
                                value={l.salesInput ?? ""}
                                onChange={(e) => updateLine(i, { salesInput: e.target.value })}
                                className="text-[11px] h-7 text-right min-w-[90px]"
                                placeholder={isForeignIntake ? "外貨売上" : "円売上"}
                              />
                            )}
                          </td>
                          {/* 基準価格 / 製造数 / サンプル（製造ベースのみ入力） */}
                          <td className="p-1 text-right">
                            {isMfg ? (
                              <Input
                                type="number"
                                min="0"
                                value={l.unitPrice ?? ""}
                                onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                                className="text-[11px] h-7 text-right min-w-[80px]"
                                placeholder="円"
                              />
                            ) : (
                              muted
                            )}
                          </td>
                          <td className="p-1 text-right">
                            {isMfg ? (
                              <Input
                                type="number"
                                min="0"
                                value={l.qty ?? ""}
                                onChange={(e) => updateLine(i, { qty: e.target.value })}
                                className="text-[11px] h-7 text-right min-w-[70px]"
                                placeholder="数量"
                              />
                            ) : (
                              muted
                            )}
                          </td>
                          <td className="p-1 text-right">
                            {isMfg ? (
                              <Input
                                type="number"
                                min="0"
                                value={l.sample ?? ""}
                                onChange={(e) => updateLine(i, { sample: e.target.value })}
                                className="text-[11px] h-7 text-right min-w-[60px]"
                                placeholder="0"
                              />
                            ) : (
                              muted
                            )}
                          </td>
                          <td className="p-1">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={l.ratePct ?? ""}
                              onChange={(e) => updateLine(i, { ratePct: e.target.value })}
                              className="text-[11px] h-7 text-right min-w-[60px]"
                              placeholder={String(formData.royaltyRatePct || "")}
                            />
                          </td>
                          <td className="p-1 text-right whitespace-nowrap">
                            ¥{c.salesJpyStr}
                            {c.basisNote && (
                              <div className="text-[9px] text-muted-foreground/70">
                                {c.basisNote}
                              </div>
                            )}
                          </td>
                          <td className="p-1 text-right font-bold whitespace-nowrap">
                            ¥{c.paymentJpyStr}
                          </td>
                          <td className="p-1 text-center">
                            <button
                              type="button"
                              onClick={() => removeLine(i)}
                              className="text-destructive px-1 hover:opacity-70"
                              title="この明細を削除"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={addLine}
                  className="text-[11px] font-mono px-3 py-1.5 border border-input rounded-sm hover:bg-muted"
                >
                  ＋ 明細を追加
                </button>
                {isForeignIntake && !fxRate && (
                  <span className="text-[10px] font-mono text-warning">
                    ⚠ 入金日レート未入力 — 円換算売上が 0 のままです。
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-4 justify-end text-[12px] font-mono px-3 py-2 bg-muted/30 rounded-sm border border-input">
                <span>
                  算定基礎額合計（円）:{" "}
                  <strong>¥{formData.linesTotalSalesStr || "0"}</strong>
                </span>
                <span>
                  支払合計（税抜）:{" "}
                  <strong>¥{formData.linesTotalPaymentStr || "0"}</strong>
                </span>
                <span>
                  消費税（{formData.taxRate || "10"}%）:{" "}
                  <strong>¥{formData.linesTaxStr || "0"}</strong>
                </span>
                <span>
                  お支払予定額（税込）:{" "}
                  <strong className="text-sm">¥{formData.linesTotalIncTaxStr || "0"}</strong>
                </span>
              </div>
            </div>
          </FormSection>
        </>
      )}

      {/* ─── STEP 2 ─ 製造内容 (単票のみ) ─────────────────── */}
      {!isMulti && (
        <>
      <FormSection
        title="ステップ 2 — 製造内容"
        variant="emerald"
        icon={<Coins className="w-4 h-4" />}
      >
        {/* Phase 28: 計算方式 (計算書ごとに切替) */}
        <div className="col-span-full space-y-1.5 mb-1">
          <Label className="text-[11px] font-mono">
            計算方式 <span className="text-destructive">*</span>
          </Label>
          <div className="flex flex-wrap gap-2">
            {[
              { v: "manufacturing", label: "製造/印刷契機", desc: "基準価格 × 数量 × 料率" },
              { v: "sales", label: "売上報告ベース", desc: "売上高 × 料率" },
              { v: "sublicense", label: "受領額ベース", desc: "被許諾者受領額 × 料率" },
            ].map((opt) => {
              const active = calcType === opt.v
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setFormData({ ...formData, calcType: opt.v })}
                  className={cn(
                    "flex-1 min-w-[150px] text-left rounded-sm border px-3 py-2 transition-colors",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-input hover:bg-muted"
                  )}
                >
                  <div className="text-[11px] font-mono font-bold">{opt.label}</div>
                  <div
                    className={cn(
                      "text-[10px] font-mono",
                      active ? "opacity-80" : "text-muted-foreground"
                    )}
                  >
                    {opt.desc}
                  </div>
                </button>
              )
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {isRevenueCalc
              ? "※ 売上報告ベースは「報告金額 × 料率」で計算します（数量・サンプル数は使いません）。"
              : "※ 製造/印刷契機は「基準価格 × 課金対象数量 × 料率」で計算します。"}
          </p>
        </div>

        <div className="col-span-full grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] font-mono">
              製品名 <span className="text-destructive">*</span>
            </Label>
            <Input
              value={formData.productName || ""}
              onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
              placeholder="例: 〇〇 通常版"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-mono">版</Label>
            <Input
              value={formData.edition || ""}
              onChange={(e) => setFormData({ ...formData, edition: e.target.value })}
              placeholder="通常版"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-mono">完成日</Label>
            <Input
              type="date"
              value={formData.completionDate || ""}
              onChange={(e) => setFormData({ ...formData, completionDate: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-mono">
              {isRevenueCalc
                ? calcType === "sublicense"
                  ? "被許諾者受領額"
                  : "報告売上高 (税抜)"
                : "上代 (MSRP)"}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={formData.msrpStr || ""}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  msrpStr: e.target.value,
                  // legacy エイリアスにも同期
                  MSRP: e.target.value,
                  基準価格: e.target.value,
                })
              }
              placeholder={isRevenueCalc ? "例: 1000000" : "例: 3000"}
            />
            {isRevenueCalc && (
              <p className="text-[10px] text-muted-foreground">
                この金額 × 料率 で計算します。
              </p>
            )}
          </div>
          {/* Phase 28: 売上報告ベースでは数量系を非表示 (計算に使わない) */}
          {!isRevenueCalc && (
            <>
              <div className="space-y-1">
                <Label className="text-[11px] font-mono">
                  製造数 <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.quantity ?? ""}
                  onChange={(e) => updateQuantity({ quantity: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-mono">サンプル数</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.sampleQuantity ?? ""}
                  onChange={(e) => updateQuantity({ sampleQuantity: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-[10px] font-mono opacity-70">
                  課金対象数 (自動: 製造数 − サンプル数)
                </Label>
                <div className="text-sm font-mono font-bold px-3 py-2 bg-muted/40 rounded-sm border border-input">
                  {billableQty.toLocaleString("ja-JP")}
                </div>
              </div>
            </>
          )}
        </div>
      </FormSection>

      {/* ─── STEP 3 ─ ライブ計算結果 ─────────────────── */}
      <FormSection
        title="ステップ 3 — 計算結果 (自動)"
        variant="indigo"
        icon={<Scale className="w-4 h-4" />}
      >
        <div className="col-span-full">
          <RoyaltyPreviewPanel
            licenseContractId={Number(formData.license_contract_id) || 0}
            licenseFinancialConditionId={
              Number(formData.license_financial_condition_id) || 0
            }
            capabilityFinancialConditionId={
              Number(formData.capability_financial_condition_id) || 0
            }
            calcType={calcType}
            unitPrice={Number(formData.msrpStr || formData.基準価格 || formData.MSRP || 0)}
            quantity={Number(formData.quantity) || 0}
            sampleQuantity={Number(formData.sampleQuantity) || 0}
            taxRate={Number(formData.taxRate) || 10}
            onPreview={(p) => {
              if (!p) return
              // Phase 22.21.95: MG が floor 化、AG が追加されたのでテンプレ用フィールドも
              //   MG / AG を分けてセット。0 のときは空文字で Handlebars の if を false に。
              const fmt = (n: number) => new Intl.NumberFormat("ja-JP").format(n || 0)
              const nonZeroStr = (n: number) => (Number(n) > 0 ? fmt(n) : "")
              setFormData({
                ...formData,
                billableQuantity: String(p.billable_quantity),
                grossRoyaltyStr: fmt(p.gross_royalty_ex_tax),
                // MG (floor) 関連 — mgTopupApplied は適用された時だけ truthy
                mgAmount: nonZeroStr(p.mg_amount),
                mgAmountStr: nonZeroStr(p.mg_amount),
                mgTopupApplied: !!(p as any).mg_floor_applied,
                mgTopupThisTime: (p as any).mg_topup_this_time || 0,
                mgTopupThisTimeStr: nonZeroStr((p as any).mg_topup_this_time || 0),
                // legacy mg_consumed_* は 0 で固定 (PDF 側は使わない)
                mgRemaining: "",
                mgConsumedBefore: "",
                mgConsumedThisTime: "",
                mgConsumedAfter: "",
                mgFullyConsumed: false,
                // AG (累積消化) — agApplied は ag_amount > 0 の時だけ truthy
                agAmount: nonZeroStr((p as any).ag_amount || 0),
                agAmountStr: nonZeroStr((p as any).ag_amount || 0),
                agApplied: Number((p as any).ag_amount || 0) > 0,
                agConsumedBefore: nonZeroStr((p as any).ag_consumed_before || 0),
                agConsumedBeforeStr: nonZeroStr((p as any).ag_consumed_before || 0),
                agConsumedThisTime: nonZeroStr((p as any).ag_consumed_this_time || 0),
                agConsumedThisTimeStr: nonZeroStr((p as any).ag_consumed_this_time || 0),
                agConsumedAfter: nonZeroStr((p as any).ag_consumed_after || 0),
                agConsumedAfterStr: nonZeroStr((p as any).ag_consumed_after || 0),
                agRemaining: nonZeroStr((p as any).ag_remaining || 0),
                agRemainingStr: nonZeroStr((p as any).ag_remaining || 0),
                agFullyConsumed: !!(p as any).ag_fully_consumed,
                agProgressPct:
                  Number((p as any).ag_amount || 0) > 0
                    ? Math.min(
                        100,
                        Math.round(
                          (Number((p as any).ag_consumed_after || 0) /
                            Number((p as any).ag_amount || 1)) *
                            100
                        )
                      )
                    : 0,
                actualRoyalty: p.actual_royalty_ex_tax,
                actualRoyaltyStr: fmt(p.actual_royalty_ex_tax),
                taxAmount: fmt(p.tax_amount),
                totalPaymentStr: fmt(p.total_payment_inc_tax),
              })
            }}
          />
        </div>
      </FormSection>
        </>
      )}

      {/* ─── STEP 4 ─ 担当者 (連絡先) ──────────────────────────
          Phase 22.21.98: PDF 右上「発行元 (ライセンシー)」と備考「※ 連絡先:」に出力。
          サイドバーで選択した担当者を Sync Staff ボタンで一括流し込み、手動編集も可能。 */}
      <FormSection
        title="ステップ 4 — 担当者 (連絡先)"
        variant="emerald"
        icon={<User className="w-4 h-4" />}
        headerActions={
          <button
            type="button"
            onClick={() => {
              if (!selectedStaff) return
              setFormData({
                ...formData,
                STAFF_NAME: selectedStaff.staff_name || "",
                STAFF_DEPARTMENT: selectedStaff.department || "",
                STAFF_PHONE: selectedStaff.phone || "",
                STAFF_EMAIL: selectedStaff.email || "",
              })
            }}
            disabled={!selectedStaff}
            className={cn(
              "text-[10px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors",
              !selectedStaff
                ? "border-input text-muted-foreground/40 cursor-not-allowed"
                : "border-foreground/30 text-foreground hover:bg-muted"
            )}
            title={
              !selectedStaff
                ? "左サイドバーの Master · Context で担当者を選択してください"
                : "サイドバーで選んだ担当者の情報をフォームに反映"
            }
          >
            Sync Staff
          </button>
        }
      >
        <p className="text-[10px] text-muted-foreground mb-3 border-l-2 border-success pl-2 leading-relaxed">
          PDF 右上のグレーボックス「発行元 (ライセンシー)」と
          備考の「※ 連絡先:」に出力されます。<br />
          左サイドバーの <strong>Master · Context → Staff</strong> で担当者を選び、
          上の <strong>Sync Staff</strong> ボタンで一括反映できます (手入力も可)。
        </p>
        <div className="mb-3 space-y-1">
          <Label className="text-[10px] font-mono opacity-70">
            担当者を検索して補完（サイドバー選択なしでも可）
          </Label>
          <EntitySearchSelect
            entity="staff"
            onSelect={(o) => {
              const s = o?.raw
              if (!s) return
              setFormData({
                ...formData,
                STAFF_NAME: s.staff_name || s.name || "",
                STAFF_DEPARTMENT: s.department || "",
                STAFF_PHONE: s.phone || "",
                STAFF_EMAIL: s.email || "",
              })
            }}
            placeholder="担当者を検索（氏名 / 部署 / メール）"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] font-mono">担当者氏名</Label>
            <Input
              value={formData.STAFF_NAME || ""}
              onChange={(e) => setFormData({ ...formData, STAFF_NAME: e.target.value })}
              placeholder="例: 倉持 達也"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-mono">部署</Label>
            <Input
              value={formData.STAFF_DEPARTMENT || ""}
              onChange={(e) => setFormData({ ...formData, STAFF_DEPARTMENT: e.target.value })}
              placeholder="例: 法務部"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-mono">電話番号</Label>
            <Input
              value={formData.STAFF_PHONE || ""}
              onChange={(e) => setFormData({ ...formData, STAFF_PHONE: e.target.value })}
              placeholder="例: 03-1234-5678"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-mono">メールアドレス</Label>
            <Input
              type="email"
              value={formData.STAFF_EMAIL || ""}
              onChange={(e) => setFormData({ ...formData, STAFF_EMAIL: e.target.value })}
              placeholder="例: legal@example.com"
            />
          </div>
        </div>
      </FormSection>

      {/* ─── STEP 5 ─ 報告・支払・備考 (折りたたみ) ──── */}
      <details className="group rounded-sm border border-input" open>
        <summary className="cursor-pointer px-4 py-2.5 text-[11px] uppercase tracking-wider hover:bg-muted/50 select-none">
          ▼ ステップ 5 — 報告・支払・備考
        </summary>
        <div className="p-4 border-t border-input grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] font-mono">
              発行日 <span className="text-destructive">*</span>
            </Label>
            <Input
              type="date"
              value={formData.documentDate || ""}
              onChange={(e) => setFormData({ ...formData, documentDate: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-mono">
              通貨 <span className="text-destructive">*</span>
            </Label>
            <select
              value={formData.currency || "JPY"}
              onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
              className="w-full text-xs font-mono px-2 py-1.5 border border-input rounded-sm bg-background focus:outline-none focus:border-foreground"
            >
              <option value="JPY">JPY</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="CNY">CNY</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-mono">税率 (%)</Label>
            <select
              value={formData.taxRate || "10"}
              onChange={(e) => setFormData({ ...formData, taxRate: e.target.value })}
              className="w-full text-xs font-mono px-2 py-1.5 border border-input rounded-sm bg-background focus:outline-none focus:border-foreground"
            >
              <option value="10">10</option>
              <option value="8">8</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-mono">報告期限</Label>
            <Input
              type="date"
              value={formData.reportingDeadline || ""}
              onChange={(e) => setFormData({ ...formData, reportingDeadline: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-mono">支払期日</Label>
            <Input
              type="date"
              value={formData.paymentDueDate || ""}
              onChange={(e) => setFormData({ ...formData, paymentDueDate: e.target.value })}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-[11px] font-mono">支払条件</Label>
            <Input
              value={formData.paymentConditionSummary || ""}
              onChange={(e) =>
                setFormData({ ...formData, paymentConditionSummary: e.target.value })
              }
              placeholder="例: 四半期報告後の翌月末日払い"
            />
            <p className="text-[10px] text-muted-foreground/70">
              契約マスタの条件側 payment_terms から自動補完 (上書き可)
            </p>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-[11px] font-mono">備考</Label>
            <textarea
              value={formData.notes || ""}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full text-xs font-mono px-2 py-1 border border-input rounded-sm bg-transparent focus:outline-none focus:border-foreground"
            />
          </div>
        </div>
      </details>
    </div>
  )
}

/**
 * royaltyStatementBuilder — 利用許諾料計算書スキーマ。
 * 独自レイアウト全体を単一の bare セクションで差し込む(FkSection chrome なし)。
 * 独自の契約ピッカー等を持つため DbFillBar は出さない(fillBar:false)。
 */
export function royaltyStatementBuilder(_metadata: any): DocFormSchema {
  return {
    fillBar: false,
    sections: [
      {
        bare: true,
        custom: (ctx) => <RoyaltyStatementForm ctx={ctx} />,
      },
    ],
  }
}
