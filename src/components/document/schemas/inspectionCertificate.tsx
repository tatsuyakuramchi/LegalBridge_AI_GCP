/**
 * inspectionCertificate — 検収書(inspection_certificate) の入力フォーム。
 *
 * 旧 DocumentForm の巨大な per-template 分岐を、SchemaDocumentForm 経由で
 * 描画する薄いモジュールへ移設したもの。UI/挙動は旧分岐と等価(バイト等価)で、
 * formData のキー・PDF テンプレ(Handlebars)は一切変更しない。
 *
 * このフォームは進捗バナー・4 ステップ・条件付きセレクタなど独自レイアウトを
 * 持つため、FkSection の一覧には分解せず、単一の `bare` セクションで本体を
 * まるごと差し込む(SchemaDocumentForm 側の chrome を被せない)。
 */
import * as React from "react"
import { FormSection } from "../FormSection"
import {
  InspectionExpenseSelector,
  type InspectionExpense,
} from "../InspectionExpenseSelector"
import {
  InspectionOtherFeesSelector,
  type InspectionOtherFee,
} from "../InspectionOtherFeesSelector"
import {
  DeliveryLineItemTable,
  type OrderLineForInspection,
  type DeliveryLine,
} from "../DeliveryLineItemTable"
import {
  UnifiedContractPicker,
  type ContractDetail,
} from "../UnifiedContractPicker"
import { EntitySearchSelect } from "../../search/EntitySearch"
import { FkField } from "../formkit/DocFormKit"
import type { DocFormSchema, FkCtx } from "../SchemaDocumentForm"
import { Building2, User, Scale, Link, Briefcase, Coins } from "lucide-react"
import { cn } from "@/lib/utils"

const InspectionCertificateForm: React.FC<{ ctx: FkCtx }> = ({ ctx }) => {
  const { metadata, formData, setFormData, activeVendor, selectedStaff, onSync, onLinkAsset } = ctx

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

  // 任意の取引先 v から受託者を充填。[取引先]ボタンとフォーム内検索補完で共用。
  const fillCounterpartyFrom = (v: any) => {
    if (!v) return
    // Phase 9d: 法人/個人を select 「法人」/「個人」 文字列で保存。
    //   - 法人: 会社名「御中」 + 棒線 + 代表者「様」
    //   - 個人: 名前「様」のみ
    const isCorporation =
      (v.entity_type || "").toLowerCase() === "corporate" || v.entity_type === "法人"
    const repName = v.vendor_rep || v.contact_name || ""
    setFormData({
      ...formData,
      counterparty: v.vendor_name || "",
      // 取引先マスタ参照を id で確定(サーバ保存の名称照合フォールバックに依存しない)。
      //   親PO非連動(自由入力)でも documents.vendor_id が NULL にならないようにする。
      counterparty_vendor_id: v.id ?? "",
      counterparty_vendor_code: v.vendor_code || "",
      COUNTERPARTY_IS_CORPORATION: isCorporation ? "法人" : "個人",
      counterpartyRep: repName,
      // Legacy フィールドも残しておく (旧テンプレ・既存生成済み doc の form_data 互換)
      counterpartyRepresentativeSama: repName ? `${repName} 様` : "",
      counterpartyTni: v.invoice_registration_number || "",
      // Bank info commonly populated at the same time
      bankName: v.bank_name || "",
      branchName: v.branch_name || "",
      accountType: v.account_type || "",
      accountNo: v.account_number || "",
      accountHolder: v.account_holder_kana || "",
    })
  }
  const fillCounterpartyFromPartner = () => fillCounterpartyFrom(activeVendor)

  const fillInspectorFromStaff = () => fillInspectorFrom(selectedStaff)
  // 任意のスタッフ s から検収者欄を充填(Sync Staff ボタンと staff 検索の双方から使う)。
  const fillInspectorFrom = (s: any) => {
    if (!s) return
    setFormData({
      ...formData,
      inspectorDept: s.department || "",
      inspectorName: s.staff_name || s.name || "",
      // Phase 9b: みなし同意ブロックの連絡先用
      inspectorEmail: s.email || "",
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

  // Phase 22.21.93: 4 ステップ動線の進捗ステータス。
  //   Step 1 — 親 PO 選択 (parent_po_id があれば完了)
  //   Step 2 — 検収内容 (明細別検収なら delivery_line_items に金額入力あり,
  //            自由入力なら deliveredAmountStr または description あり)
  //   Step 3 — 検収者 (inspectorName) 必須
  //   Step 4 — 発行日 (documentDate) 必須
  const hasParentPo = !!formData.parent_po_id
  // Phase 23: UnifiedContractPicker で 発注書 / 個別契約 / 単独契約 が
  //   parent_po_id (= contract_capabilities.id) + order_lines_for_inspection
  //   に一本化された。旧 selected_master_contract_id 分岐は廃止。
  const effectiveOrderLines = Array.isArray(formData.order_lines_for_inspection)
    ? formData.order_lines_for_inspection
    : []

  const deliveryLines = Array.isArray(formData.delivery_line_items)
    ? formData.delivery_line_items
    : []
  const step2DoneViaLines = deliveryLines.some(
    (l: any) => Number(l?.inspected_amount_ex_tax) > 0
  )
  const step2DoneViaFree = !!formData.deliveredAmountStr || !!formData.description
  const hasMasterOrPo = hasParentPo
  const stepStatus = {
    step1: hasMasterOrPo,
    step2: hasMasterOrPo ? step2DoneViaLines : step2DoneViaFree,
    step3: !!formData.inspectorName,
    step4: !!formData.documentDate,
  }
  const stepsDone = Object.values(stepStatus).filter(Boolean).length
  const totalSteps = 4

  return (
    <div className="space-y-6">
      {/* 進捗バナー (royalty_statement と同じ 4-step スタイル) */}
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
              {!stepStatus.step1 && " 1) 親 PO を選択"}
              {stepStatus.step1 && !stepStatus.step2 && " 2) 検収内容を入力"}
              {stepStatus.step1 && stepStatus.step2 && !stepStatus.step3 && " 3) 検収者を選択"}
              {stepStatus.step1 && stepStatus.step2 && stepStatus.step3 && !stepStatus.step4 && " 4) 発行日を入力"}
            </>
          )}
        </div>
        <div className="text-[10px] font-mono opacity-70">
          発行日: {formData.documentDate || "未設定"}
        </div>
      </div>

      {/* ─── STEP 1 ─ 親契約を選択 (Phase 23: 統一ピッカー) ─────────── */}
      <FormSection
        title="ステップ 1 — 親契約 (発注書 / 業務委託契約) を選択"
        variant="indigo"
        icon={<Briefcase className="w-4 h-4" />}
      >
        <p className="text-[10px] text-muted-foreground leading-relaxed mb-2 border-l-2 border-success pl-2">
          <strong>受託者・明細・経費・手数料は親契約から自動入力されます。</strong>
          <br />
          発注書 / 業務委託の個別契約・単独契約 を 1 つのピッカーから検索できます。
          インポート由来 (IMPORT-*) の契約も同じ画面で出ます。
        </p>
        <UnifiedContractPicker
          acceptableRecordTypes={[
            "purchase_order",
            "individual_contract",
            "standalone_contract",
          ]}
          categoryFilter={["service"]}
          currentContractId={Number(formData.parent_po_id) || undefined}
          hasParent={!!formData.parent_po_id}
          label="親契約 (発注書 / 業務委託) を選ぶ"
          autoPickContractId={Number(formData.__preselect_parent_po_id) || undefined}
          onPick={(detail: ContractDetail) => {
            const c = detail.contract
            const v = detail.vendor || {}
            const isCorp =
              (v.entity_type || "").toLowerCase() === "corporate" ||
              v.entity_type === "法人"
            const repName = v.vendor_rep || v.contact_name || ""
            const todayIso = new Date().toISOString().slice(0, 10)
            const firstLine = detail.line_items?.[0]
            const prog = detail.delivery_progress
            // 固定報酬0の利用許諾料/業績連動明細は、検収数量を発注数量で自動セットして
            //   検収対象に自動取り込みする(手入力不要)。金額は0のまま:
            //   ・受注者×ROYALTY/0円 → 検収書「利用許諾料に含む」(利用許諾型)
            //   ・発注者×ROYALTY/0円 → 検収書「業績連動報酬（別途算定）」(譲渡型・業績連動)
            const autoLicenseLines = ((detail.line_items as any[]) || [])
              .filter(
                (l: any) =>
                  (Number(l?.amount_ex_tax) || 0) === 0 &&
                  (l?.deliverable_ownership === "受注者" ||
                    l?.calc_method === "ROYALTY")
              )
              .map((l: any) => ({
                order_line_item_id: Number(l.id),
                item_name: l.item_name || "",
                spec: l.spec || "",
                inspected_quantity: Number(l.quantity) || 1,
                acceptance_ratio: 1.0,
                inspected_amount_ex_tax: 0,
                delivery_date: l.delivery_date || undefined,
                // 業績連動/利用許諾の出し分け・IP帰属表示に使用(検収書テンプレ)。
                deliverable_ownership: l.deliverable_ownership || "発注者",
                calc_method: l.calc_method || "FIXED",
                royalty_calc_basis: l.royalty_calc_basis || "",
                rate_pct: l.rate_pct == null ? undefined : Number(l.rate_pct),
              }))

            setFormData({
              ...formData,
              parent_po_id: c.id,
              parent_po_issue_key: c.backlog_issue_key,
              parent_po_number: c.document_number || "",
              parent_contract_record_type: c.record_type,
              // 件名: 発注書フォームで入力した件名(PROJECT_TITLE=project_title)を優先。
              //   無ければ契約タイトルにフォールバック。検収確認文の先頭に表示する。
              projectTitle:
                (c as any).project_title ||
                c.contract_title ||
                formData.projectTitle ||
                "",
              order_lines_for_inspection: detail.line_items,
              // Phase 23.5: 「発注日」は issue_date_po (PO header の発行日)
              //   を最優先。due_date は支払期限、effective_date は契約発効日
              //   なので、いずれも「発注日」とは別概念。issue_date_po が
              //   入っていない古いデータでのみ due_date / effective_date に
              //   フォールバックする。
              orderDate:
                (c as any).issue_date_po ||
                c.due_date ||
                c.effective_date ||
                formData.orderDate ||
                "",
              itemCount: String((detail.line_items || []).length || 1),
              itemNo: formData.itemNo || "1",
              taxRate: String(c.tax_rate || formData.taxRate || 10),
              documentDate: formData.documentDate || todayIso,
              ...(prog && {
                deliveryNo: String((prog as any).next_delivery_no || 1),
                isPartial:
                  (prog as any).is_partial || (prog as any).next_delivery_no > 1
                    ? "分割"
                    : "完了",
                inspectedAmountStr: (
                  (prog as any).done_amount_ex_tax || prog.inspected_amount_ex_tax || 0
                ).toLocaleString("ja-JP"),
                pendingAmountStr: (
                  prog.remaining_amount_ex_tax || 0
                ).toLocaleString("ja-JP"),
                totalOrderAmountStr: (
                  prog.ordered_amount_ex_tax || 0
                ).toLocaleString("ja-JP"),
                inspectedPct: String((prog as any).inspected_pct || 0),
              }),
              // Phase 23.0.1: 親契約選択時は line item の item_name / spec を
              // 「正」とする。Backlog Sync 由来の本文 (依頼タイプ: ... 起案者: ...)
              // が formData.description に残っていても、PDF の
              // 「成果物・業務内容」列 ({{description}}) には line item 名が
              // 入るべきなので明示的に上書きする。
              description: firstLine?.item_name || formData.description || "",
              spec: firstLine?.spec || formData.spec || "",
              ...(v.vendor_name && {
                counterparty: formData.counterparty || v.vendor_name,
                // 取引先マスタ参照を id で確定(名称照合に依存しない)。既存の手動値は尊重。
                counterparty_vendor_id: formData.counterparty_vendor_id || v.id || "",
                counterparty_vendor_code:
                  formData.counterparty_vendor_code || v.vendor_code || "",
                COUNTERPARTY_IS_CORPORATION: isCorp ? "法人" : "個人",
                counterpartyRep: formData.counterpartyRep || repName,
                counterpartyRepresentativeSama:
                  formData.counterpartyRepresentativeSama ||
                  (repName ? `${repName} 様` : ""),
                counterpartyTni:
                  formData.counterpartyTni ||
                  v.invoice_registration_number ||
                  "",
                bankName: formData.bankName || v.bank_name || "",
                branchName: formData.branchName || v.branch_name || "",
                accountType: formData.accountType || v.account_type || "",
                accountNo: formData.accountNo || v.account_number || "",
                accountHolder:
                  formData.accountHolder || v.account_holder_kana || "",
              }),
              // 利用許諾料に含む(0円)成果物は自動で検収対象に取り込む。
              delivery_line_items: autoLicenseLines,
              deliveredAmountStr: "",
              po_expenses: detail.expenses || [],
              selectedExpenseLineNos: [],
              isFinalInspection: false,
              expenses: [],
              expensesTotalIncTax: 0,
              po_other_fees: detail.other_fees || [],
              selectedOtherFeeLineNos: [],
              other_fees: [],
              otherFeesTotal: 0,
              // 旧 selected_master_contract_id ロジックは廃止 (統一化)
              selected_master_contract_id: 0,
            })
          }}
          onClear={() => {
            setFormData({
              ...formData,
              parent_po_id: undefined,
              parent_po_issue_key: undefined,
              parent_po_number: undefined,
              parent_contract_record_type: undefined,
              order_lines_for_inspection: [],
              delivery_line_items: [],
              po_expenses: [],
              selectedExpenseLineNos: [],
              isFinalInspection: false,
              expenses: [],
              expensesTotalIncTax: 0,
              po_other_fees: [],
              selectedOtherFeeLineNos: [],
              other_fees: [],
              otherFeesTotal: 0,
            })
          }}
        />
        {hasParentPo && (
          <div className="mt-3 rounded-md border border-success/40 bg-success/10 p-3 text-xs leading-relaxed text-success shadow-sm">
            <div className="flex items-start gap-2">
              <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-success text-white text-[10px] font-bold">
                ✓
              </div>
              <div className="flex-1 space-y-1">
                <div className="font-bold">
                  親契約{" "}
                  <span className="font-mono">
                    {formData.parent_po_number ||
                      formData.parent_po_issue_key ||
                      "(番号未取得)"}
                  </span>{" "}
                  を連動中
                </div>
                <div className="text-[11px]">
                  以下のフィールドは親契約から自動入力されています:
                </div>
                <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono">
                  <li>• 受託者 (取引先名・口座など)</li>
                  <li>• 業務明細 (順番に展開)</li>
                  <li>• 税率・発注日</li>
                  <li>• 経費・その他手数料 (候補)</li>
                </ul>
                <div className="mt-1 text-[10px] text-success">
                  手動で上書き編集も可能です。親契約を切り替えるには
                  上の「親契約を切り替える」を、連動を外すには「連動解除」を
                  クリック。
                </div>
              </div>
            </div>
          </div>
        )}
      </FormSection>

      {/* ─── STEP 2 ─ 検収内容 ──────────────────────────────── */}
      {/* Phase 7c: 親 PO の明細別検収テーブル。
          form-context が parent_po_id + order_lines_for_inspection[] を
          返したときだけ表示する。それ以外 (親なし) のときは従来の
          自由入力フォームにフォールバック。
          Phase 22.21.121: 業務委託マスタが選択されていれば master の
          line_items を優先表示 (= effectiveOrderLines)。 */}
      {effectiveOrderLines.length > 0 ? (
        <FormSection
          title="ステップ 2 — 検収内容 (明細別)"
          variant="indigo"
          icon={<Scale className="w-4 h-4" />}
          headerActions={
            <span className="text-[11px] italic text-muted-foreground">
              📄 親契約:{" "}
              {formData.parent_po_number ||
                formData.parent_po_issue_key ||
                "—"}
            </span>
          }
        >
          <DeliveryLineItemTable
            orderLines={effectiveOrderLines as OrderLineForInspection[]}
            values={(Array.isArray(formData.delivery_line_items)
              ? formData.delivery_line_items
              : []) as DeliveryLine[]}
            onChange={(values: DeliveryLine[]) => {
              // Phase 9h: 検収明細の変更ごとに 税抜合計 / 消費税 / 税込合計
              // を再計算してテンプレ用フィールドに同時セット。
              //   - taxRate は formData.taxRate (なければ 10)
              //   - taxAmount = Math.ceil(total × rate / 100)
              //   - 軽減税率 (8%) は isReducedTax で切り替え可能
              const total = values.reduce(
                (sum, v) => sum + (Number(v.inspected_amount_ex_tax) || 0),
                0
              )
              const taxRate = Number(formData.taxRate)
                || (formData.isReducedTax ? 8 : 10)
              const taxAmount = Math.ceil((total * taxRate) / 100)
              const totalInc = total + taxAmount
              setFormData({
                ...formData,
                delivery_line_items: values,
                deliveredAmountStr: total.toLocaleString("ja-JP"),
                taxRate: String(taxRate),
                taxAmountStr: taxAmount.toLocaleString("ja-JP"),
                totalAmountStr: totalInc.toLocaleString("ja-JP"),
              })
            }}
          />
        </FormSection>
      ) : (
        <FormSection
          title="ステップ 2 — 検収内容 (自由入力)"
          variant="indigo"
          icon={<Scale className="w-4 h-4" />}
          headerActions={
            onLinkAsset && (
              <button
                type="button"
                onClick={() =>
                  onLinkAsset((asset) =>
                    setFormData({
                      ...formData,
                      linked_po_number: asset.asset_number,
                      linked_po_link: asset.file_link,
                    })
                  )
                }
                className="text-[10px] border border-foreground/30 px-2 py-0.5 uppercase rounded-sm hover:bg-muted flex items-center gap-1"
              >
                <Link className="w-2 h-2" /> PO紐付
              </button>
            )
          }
        >
          <p className="text-[10px] font-mono text-warning mb-2 border-l-2 border-warning pl-2">
            ⚠ 親 PO 未連動です。ステップ 1 で発注書を選ぶと明細が自動入力されます。
            ここは PO 連動できない場合 (旧データ等) の手入力フォールバックです。
          </p>
          {renderGroup("IV. 納品明細")}
        </FormSection>
      )}

      {/* ステップ 2-b. 経費精算 (Phase 17m) — 親 PO に経費がある時だけ表示。
          チェックを入れた経費だけが今回検収の支払額に加算され、PDF に
          「経費（税込）」セクションが描画される。 */}
      {Array.isArray(formData.po_expenses) && formData.po_expenses.length > 0 && (
        <FormSection
          title="ステップ 2-b — 経費精算（親 PO 連動）"
          variant="indigo"
          icon={<Scale className="w-4 h-4" />}
        >
          <InspectionExpenseSelector
            poExpenses={formData.po_expenses as InspectionExpense[]}
            selectedLineNos={
              Array.isArray(formData.selectedExpenseLineNos)
                ? formData.selectedExpenseLineNos
                : []
            }
            isFinalInspection={!!formData.isFinalInspection}
            onToggleFinal={(v: boolean) => {
              setFormData({ ...formData, isFinalInspection: v })
            }}
            onChange={(selected: number[]) => {
              const selectedSet = new Set(selected)
              const expenses = (formData.po_expenses as InspectionExpense[])
                .filter((e) => selectedSet.has(e.line_no))
              const expensesTotalIncTax = expenses.reduce(
                (s, e) => s + (Number(e.amount_inc_tax) || 0),
                0
              )
              // 検収金額（税込）+ 経費（税込）= 総支払額
              const totalIncTax = Number(
                String(formData.totalAmountStr || "0").replace(/[^0-9.-]+/g, "")
              ) || 0
              const grandTotalPayable = totalIncTax + expensesTotalIncTax
              setFormData({
                ...formData,
                selectedExpenseLineNos: selected,
                expenses,
                expensesTotalIncTax,
                expensesTotalIncTaxStr:
                  expensesTotalIncTax.toLocaleString("ja-JP"),
                grandTotalPayable,
                grandTotalPayableStr: grandTotalPayable.toLocaleString("ja-JP"),
              })
            }}
          />
        </FormSection>
      )}

      {/* ステップ 2-c. その他手数料 精算 (Phase 22.21.57) — 親 PO に手数料がある時だけ表示。
          チェックを入れた手数料 (税抜) を今回検収の支払額に加算し、PDF に
          「その他手数料 (税抜)」セクションが描画される。 */}
      {Array.isArray(formData.po_other_fees) && formData.po_other_fees.length > 0 && (
        <FormSection
          title="ステップ 2-c — その他手数料 精算 (親 PO 連動)"
          variant="indigo"
          icon={<Coins className="w-4 h-4" />}
        >
          <InspectionOtherFeesSelector
            poOtherFees={formData.po_other_fees as InspectionOtherFee[]}
            selectedLineNos={
              Array.isArray(formData.selectedOtherFeeLineNos)
                ? formData.selectedOtherFeeLineNos
                : []
            }
            isFinalInspection={!!formData.isFinalInspection}
            onToggleFinal={(v: boolean) => {
              setFormData({ ...formData, isFinalInspection: v })
            }}
            onChange={(selected: number[]) => {
              const selectedSet = new Set(selected)
              const other_fees = (formData.po_other_fees as InspectionOtherFee[])
                .filter((f) => selectedSet.has(f.line_no))
              const otherFeesTotal = other_fees.reduce(
                (s, f) => s + (Number(f.amount) || 0),
                0
              )
              // 検収金額(税込) + 経費(税込) + 手数料(税抜 → 税込換算は別途) の総支払額
              // 手数料は税抜なので、税率分を加えて税込化 (経費との二重計上を避ける)
              const taxRate =
                Number(formData.taxRate) || (formData.isReducedTax ? 8 : 10)
              const otherFeesIncTax = Math.ceil(otherFeesTotal * (1 + taxRate / 100))
              const totalIncTax = Number(
                String(formData.totalAmountStr || "0").replace(/[^0-9.-]+/g, "")
              ) || 0
              const expensesTotalIncTax = Number(formData.expensesTotalIncTax) || 0
              const grandTotalPayable =
                totalIncTax + expensesTotalIncTax + otherFeesIncTax
              setFormData({
                ...formData,
                selectedOtherFeeLineNos: selected,
                other_fees,
                otherFeesTotal,
                otherFeesTotalStr: otherFeesTotal.toLocaleString("ja-JP"),
                otherFeesTotalIncTax: otherFeesIncTax,
                otherFeesTotalIncTaxStr: otherFeesIncTax.toLocaleString("ja-JP"),
                grandTotalPayable,
                grandTotalPayableStr: grandTotalPayable.toLocaleString("ja-JP"),
              })
            }}
          />
        </FormSection>
      )}

      {/* ─── STEP 3 ─ 検収者 (自社) + 受託者 (確認) ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FormSection
          title="ステップ 3a — 検収者 (自社)"
          variant="emerald"
          icon={<User className="w-4 h-4" />}
          headerActions={sideButton("Sync Staff", fillInspectorFromStaff, !selectedStaff)}
        >
          {/* 統一検索モジュール: サイドバー選択なしでも担当者を直接検索補完。 */}
          <div className="col-span-full space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              担当者を検索して検収者を充填（DB検索補完）
            </label>
            <EntitySearchSelect
              entity="staff"
              onSelect={(o) => o && fillInspectorFrom(o.raw)}
              placeholder="担当者を検索（氏名 / 部署 / メール）"
            />
          </div>
          {renderGroup("III. 検収者 (自社)")}
        </FormSection>

        <FormSection
          title="ステップ 3b — 受託者 (取引先) 確認"
          variant="amber"
          icon={<Building2 className="w-4 h-4" />}
          headerActions={sideButton("取引先", fillCounterpartyFromPartner, !activeVendor)}
        >
          {hasParentPo && (
            <p className="text-[10px] font-mono text-success mb-2 border-l-2 border-success pl-2">
              ✓ 親 PO から自動入力済み。必要なら下のフィールドで編集してください。
            </p>
          )}
          {/* 統一検索モジュール: 親PO非依存で受託者を直接検索補完(取引先ボタンと同一)。 */}
          <div className="col-span-full space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              取引先を検索して受託者を充填（DB検索補完）
            </label>
            <EntitySearchSelect
              entity="vendor"
              onSelect={(o) => o && fillCounterpartyFrom(o.raw)}
              placeholder="取引先を検索（名称 / コード）"
            />
          </div>
          {renderGroup("II. 受託者 (取引先)")}
        </FormSection>
      </div>

      {/* ─── STEP 4 ─ 検収情報 (発行日・分納フラグなど手動編集可) ────────────
          Phase 23.0.2: STEP 1 の UnifiedContractPicker で
          parent_po_number / orderDate / itemNo / itemCount / deliveryNo /
          totalDeliveries / isPartial は自動補完される。
          ここでは手動編集が必要な documentDate / isPartial のみを最前面に
          出し、残りの I. 基本情報 フィールドは折りたたみで参照可能にする。
      */}
      {/* LB-F08 (§5.5.6): セクション内の Backlog Sync 重複ボタンは撤去
          (エディタヘッダーの「依頼原票から再取得」に一本化)。 */}
      <FormSection
        title="ステップ 4 — 検収情報"
        variant="default"
        icon={<Briefcase className="w-4 h-4" />}
      >
        {/* Phase 23.5: orderDate (発注日) を主表示エリアに昇格。
            親 PO 選択で contract_capabilities.issue_date_po から自動補完
            されるが、フォーム上での視認性を確保するため折り畳みから出す。
            documentDate / orderDate / isPartial の 3 フィールドを並列表示。 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {renderField("documentDate")}
          {renderField("orderDate")}
          {renderField("isPartial")}
        </div>
        <details className="mt-4 group rounded-sm border border-input">
          <summary className="cursor-pointer px-3 py-1.5 text-[10px] uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ 自動補完項目 (ステップ 1 で親契約を選ぶと埋まる) — 必要に応じて手動修正
          </summary>
          <div className="p-3 border-t border-input space-y-3">
            {["issueKey", "parent_po_number", "itemNo", "itemCount", "deliveryNo", "totalDeliveries"]
              .map((fid) => renderField(fid))}
          </div>
        </details>
      </FormSection>

      {/* ─── 任意セクション (折りたたみ) ─────────────────────────── */}
      <details className="group rounded-sm border border-input">
        <summary className="cursor-pointer px-4 py-2 text-[11px] uppercase tracking-wider hover:bg-muted/50 select-none">
          ▶ 進捗・財務 (任意) — クリックして展開
        </summary>
        <div className="p-4 border-t border-input">{renderGroup("V. 進捗・財務 (任意)")}</div>
      </details>

      <details className="group rounded-sm border border-input">
        <summary className="cursor-pointer px-4 py-2 text-[11px] uppercase tracking-wider hover:bg-muted/50 select-none">
          ▶ 振込先 (受託者口座, 任意 — 親 PO から自動入力済み) — クリックして展開
        </summary>
        <div className="p-4 border-t border-input">
          {renderGroup("VI. 振込先 (受託者口座, 任意)")}
        </div>
      </details>
    </div>
  )
}

/**
 * inspectionCertificateBuilder — 検収書スキーマ。
 * 独自レイアウト全体を単一の bare セクションで差し込む(FkSection chrome なし)。
 * DbFillBar は本フォームが独自の親契約ピッカー等を持つため出さない(fillBar:false)。
 */
export function inspectionCertificateBuilder(_metadata: any): DocFormSchema {
  return {
    fillBar: false,
    sections: [
      {
        bare: true,
        custom: (ctx) => <InspectionCertificateForm ctx={ctx} />,
      },
    ],
  }
}
