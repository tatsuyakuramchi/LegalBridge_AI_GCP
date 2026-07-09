/**
 * purchaseOrder — 発注書(purchase_order) の入力フォーム。
 *
 * 旧 DocumentForm の per-template 分岐(約770行)をこのモジュールへ移設し、
 * SchemaDocumentForm 経由で描画する。UI/挙動・formData キー・PDF テンプレは
 * 不変(バイト等価の移設)。原作マスタ(ledgers)/refreshLedgers は
 * AppDataContext から直接取得。作品候補(workOptions)・別名併記フラグ
 * (combineVendorAlias)は DocumentForm 側から ctx で受け取る(worksList の
 * fetch effect と明細サマリ集計 effect は intl 発注書と共有のため親に残す)。
 *
 * 独自レイアウト全体を単一の bare セクションで差し込む(chrome を被せない)。
 */
import * as React from "react"
import { useAppData } from "@/src/context/AppDataContext"
import { FormSection } from "../FormSection"
import { type LineItem } from "../LineItemTable"
import { DeliverableCards } from "../DeliverableCards"
import { ExpenseTable, type ExpenseItem } from "../ExpenseTable"
import { OtherFeesTable, type OtherFee } from "../OtherFeesTable"
import { FinancialConditionTable, type FinancialCondition } from "../FinancialConditionTable"
import { MaterialSearchSelect } from "../MaterialSearchSelect"
import { UnifiedContractPicker } from "../UnifiedContractPicker"
import { EntitySearchSelect } from "../../search/EntitySearch"
import { FkField } from "../formkit/DocFormKit"
import type { DocFormSchema, FkCtx } from "../SchemaDocumentForm"
import { Briefcase, Database, Building2, User, List, Coins, Scale } from "lucide-react"
import { cn } from "@/lib/utils"

const stripLeadingT = (s?: string | null): string =>
  String(s || "").replace(/^[TtＴｔ]\s*/, "").trim()

// 個人取引先の宛名表記。既定は正式名称(vendor_name)優先。
//   combine=true かつ 別名(ペンネーム→屋号)があれば「別名 こと 正式名称」を併記。
const individualVendorName = (v: any, combine: boolean): string => {
  const formal = String(v?.vendor_name || "").trim()
  const alias = String(v?.pen_name || v?.trade_name || "").trim()
  if (combine && alias && formal && alias !== formal) return `${alias} こと ${formal}`
  return formal || alias
}

const PurchaseOrderForm: React.FC<{ ctx: FkCtx }> = ({ ctx }) => {
  const {
    metadata,
    formData,
    setFormData,
    activeVendor,
    companyProfile,
    selectedStaff,
    onSync,
    combineVendorAlias,
    workOptions = [],
  } = ctx
  const { ledgers: allLedgers, refreshLedgers } = useAppData()

  const [poMaterialBusy, setPoMaterialBusy] = React.useState<string | null>(null)
  const [poNewSourceTitle, setPoNewSourceTitle] = React.useState("")
  const [poCreatingSource, setPoCreatingSource] = React.useState(false)

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
  const renderGroup = (groupName: string) =>
    (groupedVars[groupName] || []).map((fid) => renderField(fid))

  // 法人/個人 判定を堅牢化: entity_type の表記揺れ吸収、法人番号/社名の法人格でも判定。
  const isCorporation = (vendor: any) => {
    const et = String(vendor?.entity_type || vendor?.vendor_entity_type || "")
      .trim()
      .toLowerCase()
    if (et === "individual" || et === "個人") return false
    if (et.includes("corp") || et.includes("法人")) return true
    if (String(vendor?.corporate_number || "").trim()) return true
    const name = String(vendor?.vendor_name || "")
    return /株式会社|有限会社|合同会社|合名会社|合資会社|相互会社|社団法人|財団法人|学校法人|医療法人|宗教法人|協同組合|（株）|（有）|㈱|㈲|株式會社/.test(
      name
    )
  }

  // 任意の取引先 v から発注先を充填([取引先]ボタンと EntitySearch の双方から使う)。
  const fillVendorFrom = (v: any) => {
    if (!v) return
    const isCorp = isCorporation(v)
    const repName = v.vendor_rep || v.contact_name || ""
    setFormData({
      ...formData,
      // Phase 17o: VENDOR_CODE を必ず同期(worker 側 vendor_id 解決に必要)。
      VENDOR_CODE: v.vendor_code || "",
      // 法人=正式名称、個人=ペンネーム/屋号優先。代表者「様」は法人のみ。
      VENDOR_NAME: isCorp ? v.vendor_name || "" : individualVendorName(v, !!combineVendorAlias),
      VENDOR_ADDRESS: v.address || "",
      VENDOR_REPRESENTATIVE_SAMA: isCorp && repName ? `${repName} 様` : "",
      // 担当者・部署は法人の概念。個人取引先では空にする(代表者様と同方針)。
      VENDOR_CONTACT_DEPARTMENT: isCorp ? v.contact_department || "" : "",
      VENDOR_CONTACT_NAME: isCorp ? v.contact_name || "" : "",
      VENDOR_EMAIL: v.email || "",
      VENDOR_IS_CORPORATION: isCorp ? "法人" : "個人",
      VENDOR_SUFFIX: isCorp ? "御中" : "様",
      // Bank info — common ask, pulled at the same time
      BANK_NAME: v.bank_name || "",
      BRANCH_NAME: v.branch_name || "",
      ACCOUNT_TYPE: v.account_type || "",
      ACCOUNT_NUMBER: v.account_number || "",
      ACCOUNT_HOLDER_KANA: v.account_holder_kana || "",
      INVOICE_REGISTRATION_NUMBER: stripLeadingT(v.invoice_registration_number),
    })
  }
  const fillVendorFromPartner = () => fillVendorFrom(activeVendor)

  const fillVendorFromSelf = () =>
    setFormData({
      ...formData,
      VENDOR_NAME: companyProfile?.name || "",
      VENDOR_ADDRESS: companyProfile?.address || "",
      VENDOR_REPRESENTATIVE_SAMA: companyProfile?.representative
        ? `${companyProfile.representative} 様`
        : "",
      VENDOR_IS_CORPORATION: "法人", // 自社は常に法人想定
      VENDOR_SUFFIX: "御中",
    })

  const fillIssuerFromSelf = () =>
    setFormData({
      ...formData,
      PARTY_A_NAME: companyProfile?.name || "",
      PARTY_A_ADDRESS: companyProfile?.address || "",
      PARTY_A_REP: companyProfile?.representative || "",
    })

  const fillIssuerFromPartner = () => {
    if (!activeVendor) return
    setFormData({
      ...formData,
      PARTY_A_NAME: activeVendor.vendor_name || "",
      PARTY_A_ADDRESS: activeVendor.address || "",
      PARTY_A_REP: activeVendor.vendor_rep || activeVendor.contact_name || "",
    })
  }

  const fillStaff = () => {
    if (!selectedStaff) return
    setFormData({
      ...formData,
      STAFF_NAME: selectedStaff.staff_name || "",
      STAFF_DEPARTMENT: selectedStaff.department || "",
      STAFF_PHONE: selectedStaff.phone || "",
      STAFF_EMAIL: selectedStaff.email || "",
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

  // Required-completion summary
  const requiredIds = Object.entries(metadata.vars || {})
    .filter(([, m]: [string, any]) => m?.required === true)
    .map(([id]) => id)
  const missingRequired = requiredIds.filter((id) => {
    const v = formData[id]
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "")
  })

  return (
    <div className="space-y-10">
      {/* Required-progress banner */}
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-4 py-2 rounded-sm border",
          missingRequired.length === 0
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-amber-50 border-amber-200 text-amber-800"
        )}
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

      {/* 1. 前提条件 (発注概要) */}
      <FormSection
        title="1. 前提条件 (発注概要)"
        variant="default"
        icon={<Briefcase className="w-4 h-4" />}
        headerActions={
          <button
            type="button"
            onClick={onSync}
            className="text-[10px] font-mono border border-foreground/30 px-2 py-0.5 uppercase rounded-sm hover:bg-muted"
            title="Backlog 課題から自動補完"
          >
            <Database className="w-2 h-2 inline mr-1" />
            Backlog Sync
          </button>
        }
      >
        {renderGroup("I. 発注概要")}
      </FormSection>

      {/* 2. 取引先・基本契約設定 — 発注先 + 基本契約ピッカー(唯一の入力点) */}
      <FormSection
        title="2. 取引先・基本契約設定"
        variant="amber"
        icon={<Building2 className="w-4 h-4" />}
        headerActions={
          <>
            {sideButton("自社", fillVendorFromSelf, !companyProfile)}
            {sideButton("取引先", fillVendorFromPartner, !activeVendor)}
          </>
        }
      >
        {/* 統一検索モジュール: 取引先を検索して発注先を一括充填([取引先]ボタンと同一)。 */}
        <div className="col-span-full space-y-1">
          <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
            取引先を検索して発注先を充填（DB検索補完）
          </label>
          <EntitySearchSelect
            entity="vendor"
            onSelect={(o) => o && fillVendorFrom(o.raw)}
            placeholder="取引先を検索（名称 / コード）"
          />
        </div>
        {renderGroup("II. 発注先 (取引先)")}
        <div className="col-span-full mt-4 pt-3 border-t border-dashed border-input">
          <p className="text-[10px] font-mono text-muted-foreground leading-relaxed mb-2 border-l-2 border-emerald-500 pl-2">
            基本契約の紐づけ — この発注書を紐づけたい基本契約があれば選択してください。
            選択すると PDF テンプレに「基本契約: …」として反映されます。
            通常は取引先を選ぶと自動補完されます。
          </p>
          {/* 業務委託(service)に加えライセンス(license)基本契約も選べるようにする。 */}
          <UnifiedContractPicker
            acceptableRecordTypes={["master_contract"]}
            categoryFilter={["service", "license"]}
            currentContractId={Number(formData.MASTER_CONTRACT_CAPABILITY_ID) || undefined}
            hasParent={!!formData.MASTER_CONTRACT_NUMBER}
            label="基本契約を選ぶ（業務委託・ライセンス）"
            onPick={(detail) => {
              const c = detail.contract
              setFormData({
                ...formData,
                HAS_BASE_CONTRACT: true,
                MASTER_CONTRACT_CAPABILITY_ID: c.id,
                MASTER_CONTRACT_REF: `${c.contract_title} (${c.document_number})`,
                MASTER_CONTRACT_NUMBER: c.document_number,
                MASTER_CONTRACT_LINK: detail.drive_link || formData.MASTER_CONTRACT_LINK,
              })
            }}
            onClear={() => {
              setFormData({
                ...formData,
                HAS_BASE_CONTRACT: false,
                MASTER_CONTRACT_CAPABILITY_ID: undefined,
                MASTER_CONTRACT_REF: "",
                MASTER_CONTRACT_NUMBER: "",
                MASTER_CONTRACT_LINK: "",
              })
            }}
          />
        </div>
      </FormSection>

      {/* 3. 発注元（当社）・担当スタッフ — 旧「3.発注元」+「4.スタッフ」を1セクションに統合。 */}
      <FormSection
        title="3. 発注元（当社）・担当スタッフ"
        variant="blue"
        icon={<User className="w-4 h-4" />}
        headerActions={
          <>
            {sideButton("自社", fillIssuerFromSelf, !companyProfile)}
            {sideButton("取引先", fillIssuerFromPartner, !activeVendor)}
            {sideButton("Sync Staff", fillStaff, !selectedStaff)}
          </>
        }
      >
        <div className="col-span-full text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">
          発注元（当社）
        </div>
        {renderField("PARTY_A_NAME")}
        {renderField("PARTY_A_ADDRESS")}
        {renderField("PARTY_A_REP")}
        <div className="col-span-full mt-3 pt-3 border-t border-dashed border-input text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">
          担当スタッフ
        </div>
        {renderField("STAFF_NAME")}
        {renderField("STAFF_DEPARTMENT")}
        {renderField("STAFF_PHONE")}
        {renderField("STAFF_EMAIL")}
      </FormSection>

      {/* IV. 明細 — grandTotalExTax は自動集計(items 合計 + other_fees 合計)。
          成果物カード(帰属駆動)で編集。帰属→報酬の型が自動で決まり、テンプレの分岐へ
          正しい値だけが渡る(納期必須 / 発注者=金額 or 計算方法 / 受注者=利用許諾料に含む)。 */}
      <FormSection
        title="4. 成果物（明細）— 帰属で報酬・表示が決まります"
        variant="indigo"
        icon={<List className="w-4 h-4" />}
      >
        <DeliverableCards
          works={workOptions}
          items={Array.isArray(formData.items) ? formData.items : []}
          onChange={(items: LineItem[]) => {
            const itemsTotal = items.reduce(
              (sum, it) => sum + (Number(it.amount_ex_tax) || 0),
              0
            )
            const feesTotal = (Array.isArray(formData.other_fees) ? formData.other_fees : []).reduce(
              (s: number, f: any) => s + (Number(f?.amount) || 0),
              0
            )
            setFormData({
              ...formData,
              items,
              itemsSubtotalExTax: itemsTotal,
              otherFeesTotal: feesTotal,
              // 受注者帰属(利用許諾料)は確定額外なので合計には不算入(amount_ex_tax=0)。
              grandTotalExTax: itemsTotal + feesTotal,
              // 利用許諾条件セクションの表示要否。支払方法(ROYALTY)で駆動(発注者×ROYALTYも含む)。
              has_license_conditions: items.some((it) => it.calc_method === "ROYALTY"),
              // 概要「利用許諾料」行の表示判定。受注者帰属(利用許諾型)が1つでもあれば表示。
              has_seller_owned_license: items.some(
                (it) => it.deliverable_ownership === "受注者"
              ),
            })
          }}
        />
      </FormSection>

      {/* 5-L. 利用許諾条件（共通）— 利用許諾料(ROYALTY)明細に適用する共通条件を定義。 */}
      {Array.isArray(formData.items) &&
        formData.items.some((it: any) => it?.calc_method === "ROYALTY") && (
          <FormSection
            title="4-L. 利用許諾条件（共通）— 利用許諾料（ROYALTY）明細に適用"
            variant="amber"
            icon={<Coins className="w-4 h-4" />}
          >
            <div className="mb-2 text-[11px] font-mono text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2 leading-relaxed">
              利用許諾料（ROYALTY）にした成果物:{" "}
              <strong>
                {formData.items
                  .filter((it: any) => it?.calc_method === "ROYALTY")
                  .map((it: any) => it.condition_name || it.item_name)
                  .filter(Boolean)
                  .join("、") || "（品目名未入力）"}
              </strong>
              <br />
              これらに適用する利用許諾条件を以下で定義します（1本にまとめて全体許諾も可）。
            </div>
            <FinancialConditionTable
              conditions={
                Array.isArray(formData.financial_conditions)
                  ? (formData.financial_conditions as FinancialCondition[])
                  : []
              }
              onChange={(conditions: FinancialCondition[]) =>
                setFormData({ ...formData, financial_conditions: conditions })
              }
              works={workOptions}
            />

            {/* 原作マテリアル登録 — 発注した成果物を原作素材として登録し、利用許諾条件を紐付ける。 */}
            {(() => {
              const ledgerList: any[] = Array.isArray(allLedgers) ? allLedgers : []
              // 全原作の素材をプール化(クロス原作割当可)。
              const allMats: any[] = ledgerList.flatMap((l: any) =>
                (Array.isArray(l.materials) ? l.materials : []).map((m: any) => ({
                  ...m,
                  _ledger_title: l.title,
                  _ledger_code: l.ledger_code,
                }))
              )
              const conds: any[] = Array.isArray(formData.financial_conditions)
                ? formData.financial_conditions
                : []
              const cmCodes = (formData.condition_material_codes || {}) as Record<string, string>
              const setCmCode = (key: string, code: string | undefined) => {
                const next = { ...cmCodes }
                if (code) next[key] = code
                else delete next[key]
                setFormData({ ...formData, condition_material_codes: next })
              }
              const onLedger = (id: string) => {
                const lid = Number(id)
                const lg = ledgerList.find((l: any) => Number(l.id) === lid)
                setFormData({
                  ...formData,
                  ledger_ref_id: lid || undefined,
                  ledger_code: lg?.ledger_code || undefined,
                })
              }
              // 完全に新しいIP用に原作(Ledger)を新規作成(works+ledgers+素材-001 を原子生成)。
              const createSourceIp = async () => {
                const title = poNewSourceTitle.trim()
                if (!title) return
                setPoCreatingSource(true)
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
                  // 新原作の ledger id を取得(素材新規登録APIが台帳idを要求するため)。
                  let lid: number | undefined
                  try {
                    const lr = await fetch("/api/master/ledgers")
                    const ls = await lr.json()
                    lid = (Array.isArray(ls) ? ls : []).find(
                      (l: any) => l.ledger_code === code
                    )?.id
                  } catch {
                    /* 取得失敗時は ledger_code だけで保存経路は通る */
                  }
                  setPoNewSourceTitle("")
                  setFormData({
                    ...formData,
                    ledger_ref_id: lid ?? formData.ledger_ref_id,
                    ledger_code: code || formData.ledger_code,
                  })
                } catch (e) {
                  console.error("createSourceIp failed", e)
                } finally {
                  setPoCreatingSource(false)
                }
              }
              const createMat = async (key: string, name: string) => {
                if (!formData.ledger_ref_id) return
                setPoMaterialBusy(key)
                try {
                  const r = await fetch(
                    `/api/master/ledgers/${formData.ledger_ref_id}/materials`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        material_name: name,
                        remarks: `発注書: ${formData.契約書番号 || ""}`,
                      }),
                    }
                  )
                  if (!r.ok) throw new Error(`HTTP ${r.status}`)
                  const j = await r.json()
                  await refreshLedgers().catch(() => {})
                  if (j?.material_code) {
                    setFormData({
                      ...formData,
                      condition_material_codes: {
                        ...cmCodes,
                        [key]: j.material_code,
                      },
                    })
                  }
                } catch (e) {
                  console.error("createMat failed", e)
                } finally {
                  setPoMaterialBusy(null)
                }
              }
              const royaltyNames = (Array.isArray(formData.items) ? formData.items : [])
                .filter((it: any) => it?.calc_method === "ROYALTY")
                .map((it: any) => it.condition_name || it.item_name)
                .filter(Boolean)
              return (
                <div className="col-span-full mt-4 pt-3 border-t border-amber-200/60 space-y-3">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-amber-800">
                    原作マテリアル登録 — 成果物を原作素材として登録し、条件を紐付け（後で利用許諾条件書のコピー候補に出ます）
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      登録先の原作（台帳）— 既存を選択 or 新規作成
                    </label>
                    <select
                      value={formData.ledger_ref_id || ""}
                      onChange={(e) => onLedger(e.target.value)}
                      className="w-full text-xs font-mono bg-transparent border-b border-input py-1.5 focus:outline-none focus:border-foreground"
                    >
                      <option value="">— 既存の原作を選択（成果物の登録先）—</option>
                      {ledgerList
                        .filter((l: any) => l.is_active !== false)
                        .map((l: any) => (
                          <option key={l.id} value={l.id}>
                            [{l.ledger_code}] {l.title}
                          </option>
                        ))}
                    </select>
                    {/* 完全に新しいIP(イラスト等)は原作ごと新規作成。 */}
                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        または新規:
                      </span>
                      <input
                        value={poNewSourceTitle}
                        onChange={(e) => setPoNewSourceTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            void createSourceIp()
                          }
                        }}
                        placeholder="新しい原作のタイトル（例: 〇〇用イラスト）"
                        className="flex-1 text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground"
                      />
                      <button
                        type="button"
                        onClick={() => void createSourceIp()}
                        disabled={poCreatingSource || !poNewSourceTitle.trim()}
                        className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-amber-400 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                      >
                        {poCreatingSource ? "作成中…" : "＋原作を新規作成"}
                      </button>
                    </div>
                    <p className="text-[10px] font-mono text-muted-foreground/70">
                      この原作は<strong>新規素材を作成するときの登録先</strong>です（完全に新しいIPは「＋原作を新規作成」、原作本体素材 -001 も同時生成）。<strong>既存素材は下の検索で全原作から選べる</strong>ため、1発注書で複数の別原作にまたがる成果物も割り当てられます。
                    </p>
                  </div>
                  {/* ③ 未リンクCL 予防: 素材未割当の利用許諾条件を作成前に警告。
                      割当を捕捉させ、素材未リンクのCLが発生するのを防ぐ(発生しても②の棚卸しで回収可)。 */}
                  {conds.length > 0 && (() => {
                    const unassigned = conds.filter(
                      (c: any, idx: number) => !cmCodes[String(c.condition_no ?? idx + 1)]
                    )
                    if (unassigned.length === 0) {
                      return (
                        <p className="text-[10px] font-mono px-2.5 py-1.5 rounded-sm bg-emerald-50 border border-emerald-200 text-emerald-800">
                          ✓ すべての利用許諾条件に原作素材が割当済み（作成時に素材リンクされます）。
                        </p>
                      )
                    }
                    return (
                      <div className="text-[10px] font-mono px-2.5 py-1.5 rounded-sm bg-red-50 border border-red-300 text-red-800 leading-relaxed">
                        ⚠ <strong>{unassigned.length} 件</strong>の利用許諾条件に原作素材が未割当です
                        （{unassigned
                          .map((c: any, i: number) => c.condition_name || `条件${c.condition_no ?? i + 1}`)
                          .join("、")}）。
                        <br />
                        このまま作成すると<strong>素材未リンクのCL</strong>になります（後で「未リンクCL 棚卸し」画面で紐づけ可能ですが、
                        ここで素材を割り当てるのが確実です）。下の各条件に原作マテリアルを割り当ててください。
                      </div>
                    )
                  })()}
                  {conds.length === 0 ? (
                    <p className="text-[10px] font-mono text-muted-foreground">
                      上の表に利用許諾条件を追加すると、各条件に原作マテリアルを割り当てられます（成果物ごとに条件を1本ずつ作ると 成果物:素材=1:1 になります）。
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {conds.map((c: any, idx: number) => {
                        const key = String(c.condition_no ?? idx + 1)
                        const cur = cmCodes[key] || ""
                        const curMat = cur
                          ? allMats.find((m: any) => m.material_code === cur)
                          : null
                        const defName =
                          c.condition_name ||
                          royaltyNames[idx] ||
                          royaltyNames[0] ||
                          `成果物${idx + 1}`
                        return (
                          <div key={key} className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-mono min-w-[8rem] truncate">
                              <span className="font-bold">条件{c.condition_no ?? idx + 1}</span>{" "}
                              {c.condition_name || ""}
                            </span>
                            {cur ? (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm bg-emerald-50 border border-emerald-200 text-emerald-800">
                                [{cur}] {curMat?.material_name || ""}
                                <button
                                  type="button"
                                  onClick={() => setCmCode(key, undefined)}
                                  className="ml-1.5 text-[9px] underline text-muted-foreground hover:text-red-600"
                                >
                                  解除
                                </button>
                              </span>
                            ) : (
                              <>
                                <MaterialSearchSelect
                                  materials={allMats}
                                  value={cur}
                                  onPick={(code) => setCmCode(key, code)}
                                  placeholder="既存の原作マテリアルを検索（全原作）"
                                />
                                <button
                                  type="button"
                                  disabled={poMaterialBusy === key || !formData.ledger_ref_id}
                                  onClick={() => void createMat(key, defName)}
                                  title={
                                    !formData.ledger_ref_id
                                      ? "新規素材の登録には上で「登録先の原作」を選択/作成してください"
                                      : undefined
                                  }
                                  className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-amber-400 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                                >
                                  {poMaterialBusy === key ? "登録中…" : "＋登録先原作に新規素材"}
                                </button>
                              </>
                            )}
                          </div>
                        )
                      })}
                      <p className="text-[10px] font-mono text-muted-foreground/70">
                        「＋新規登録」で成果物を選択中の原作に新しいマテリアルとして登録し、この条件を紐付けます。既存素材は検索で選択。保存時に condition_lines へ反映されます。
                      </p>
                    </div>
                  )}
                </div>
              )
            })()}
          </FormSection>
        )}

      {/* 5-a. その他手数料 — 業務委託報酬以外の手数料。税抜表示で grandTotalExTax に加算。 */}
      <FormSection
        title="5. その他手数料（税抜・合計に加算）"
        variant="indigo"
        icon={<Coins className="w-4 h-4" />}
      >
        <OtherFeesTable
          fees={Array.isArray(formData.other_fees) ? formData.other_fees : []}
          onChange={(other_fees: OtherFee[]) => {
            const feesTotal = other_fees.reduce((sum, f) => sum + (Number(f.amount) || 0), 0)
            const itemsTotal = (Array.isArray(formData.items) ? formData.items : []).reduce(
              (s: number, it: any) => s + (Number(it?.amount_ex_tax) || 0),
              0
            )
            setFormData({
              ...formData,
              other_fees,
              itemsSubtotalExTax: itemsTotal,
              otherFeesTotal: feesTotal,
              grandTotalExTax: itemsTotal + feesTotal,
            })
          }}
        />
      </FormSection>

      {/* 5-b. 経費 — 交通費等・税込み額表示。order_expenses テーブルに保存。 */}
      <FormSection
        title="6. 経費（交通費等・税込み）"
        variant="indigo"
        icon={<List className="w-4 h-4" />}
      >
        <ExpenseTable
          expenses={Array.isArray(formData.expenses) ? formData.expenses : []}
          onChange={(expenses: ExpenseItem[]) => {
            const expensesTotal = expenses.reduce(
              (sum, e) => sum + (Number(e.amount_inc_tax) || 0),
              0
            )
            setFormData({
              ...formData,
              expenses,
              expensesTotalIncTax: expensesTotal,
            })
          }}
        />
      </FormSection>

      {/* 5-c. 金額サマリ・納期 — 納期/支払日は明細から自動集計(read-only 表示)。 */}
      <FormSection title="7. 金額サマリ・納期 (明細から自動集計)" variant="indigo" icon={<Scale className="w-4 h-4" />}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[11px] font-mono">
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              合計金額 (税抜)
            </div>
            <div className="text-base font-bold">
              ¥ {Number(formData.grandTotalExTax || 0).toLocaleString("ja-JP")}
            </div>
            <div className="text-[11px] text-muted-foreground/70 italic">
              明細の小計を合算 (税は別途)
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              納期 (自動集計)
            </div>
            <div className="text-sm font-bold">
              {formData.summaryDeliveryDate || (
                <span className="text-muted-foreground/60 font-normal italic">
                  明細の納期が未入力
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground/70 italic">
              明細の納期から集約 (全同日ならその日付、複数日付なら範囲表示)
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              支払日 (自動集計)
            </div>
            <div className="text-sm font-bold">
              {formData.summaryPaymentDate || (
                <span className="text-muted-foreground/60 font-normal italic">
                  明細の支払日が未入力
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground/70 italic">
              明細の支払日から集約
            </div>
          </div>
        </div>
      </FormSection>

      {/* 9. 振込先 — コア情報のため、上級者向けフォールバックより前に配置。 */}
      <FormSection
        title="8. 振込先 (取引先口座)"
        variant="emerald"
        headerActions={sideButton("取引先", fillVendorFromPartner, !activeVendor)}
      >
        {renderGroup("V. 振込先 (取引先口座)")}
      </FormSection>

      {/* 10. その他の設定 — 特約・備考／契約・署名 を1つに統合(旧「7」重複を解消)。 */}
      <details className="group rounded-sm border border-input">
        <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
          ▶ 9. その他の設定 — 特約・備考／契約・署名 (任意)
        </summary>
        <div className="p-4 border-t border-input space-y-4">
          {renderGroup("VI. 特約・備考 (任意)")}
          {/* Phase 26: 基本契約の紐づけは「2. 取引先・基本契約設定」の
              UnifiedContractPicker に一本化。ここでの重複検索・手入力欄は撤去/hidden 化。 */}
          {renderGroup("VII. 契約・署名 (任意)")}
        </div>
      </details>

      {/* 11. 単一明細フォールバック (上級者向け・レガシー) — 末尾の折り畳みへ移動。
          通常は成果物(明細)を使うため、明細表が空のときだけ PDF に反映される。 */}
      <details className="group rounded-sm border border-input">
        <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
          ▶ 10. 単一明細フォールバック (上級者向け・明細が空のときだけ参照)
        </summary>
        <div className="p-4 border-t border-input space-y-3">
          <p className="text-[10px] font-mono text-muted-foreground italic">
            通常は <strong>5. 成果物（明細）</strong> を使ってください。以下は
            旧テンプレートとの後方互換のための入力で、成果物が空の場合のみ PDF に反映されます。
            成果物を使う場合は <code>合計金額</code> は自動集計されるのでここを触る必要はありません。
          </p>
          {renderField("grandTotalExTax", "合計金額 (税抜) — 手入力 (成果物を使わない場合のみ)")}
          {renderGroup("IV-z. 単一明細用 (任意・上級者向け)")}
        </div>
      </details>
    </div>
  )
}

/**
 * purchaseOrderBuilder — 発注書スキーマ。独自レイアウト全体を bare セクションで差し込む。
 * 独自の取引先/基本契約ピッカー等を持つため DbFillBar は出さない(fillBar:false)。
 */
export function purchaseOrderBuilder(_metadata: any): DocFormSchema {
  return {
    fillBar: false,
    sections: [
      {
        bare: true,
        custom: (ctx) => <PurchaseOrderForm ctx={ctx} />,
      },
    ],
  }
}
