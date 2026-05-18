
import React, { useMemo, useEffect } from 'react';
import { FormSection } from './FormSection';
import { FormField } from './FormField';
import { PartySection, SubLicenseeTable } from './SpecializedParts';
import { LineItemTable, type LineItem } from './LineItemTable';
import { ExpenseTable, type ExpenseItem } from './ExpenseTable';
import {
  InspectionExpenseSelector,
  type InspectionExpense,
} from './InspectionExpenseSelector';
import {
  DeliveryLineItemTable,
  type OrderLineForInspection,
  type DeliveryLine,
} from './DeliveryLineItemTable';
import {
  FinancialConditionTable,
  type FinancialCondition,
} from './FinancialConditionTable';
import { RoyaltyPreviewPanel } from './RoyaltyPreviewPanel';
import { ParentPoPicker, type PoLoaded } from './ParentPoPicker';
import { TemplateMetadata } from './types';
import { Database, Building2, User, ShieldCheck, Scale, AlertCircle, Link, GitBranch, Briefcase, List, Coins } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DocumentFormProps {
  templateId: string;
  metadata: TemplateMetadata;
  formData: any;
  setFormData: (data: any) => void;
  onSync: () => void;
  onLinkAsset?: (callback: (asset: any) => void) => void;
  companyProfile?: any;
  activeVendor?: any;
  selectedStaff?: any;
}

export const DocumentForm: React.FC<DocumentFormProps> = ({
  templateId,
  metadata,
  formData,
  setFormData,
  onSync,
  onLinkAsset,
  companyProfile,
  activeVendor,
  selectedStaff
}) => {
  // Group variables by their group property
  const groupedVars = useMemo(() => {
    const groups: Record<string, string[]> = {};
    Object.entries(metadata.vars || {}).forEach(([id, meta]: [string, any]) => {
      const groupName = meta.group || 'General (基本共通)';
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(id);
    });
    return groups;
  }, [metadata]);

  // Phase 9c: 検収書テンプレで selectedStaff が既にあり、かつ
  // 検収者フィールドが空のときは自動で埋める (みなし同意の連絡先が
  // 空欄のまま PDF が出るのを防ぐ)。
  // また documentDate が未入力なら今日の日付で初期化。
  useEffect(() => {
    if (!templateId.startsWith('inspection_certificate')) return;
    const patch: Record<string, any> = {};
    if (
      selectedStaff &&
      !formData.inspectorName &&
      !formData.inspectorDept &&
      !formData.inspectorEmail
    ) {
      patch.inspectorDept = selectedStaff.department || '';
      patch.inspectorName = selectedStaff.staff_name || '';
      patch.inspectorEmail = selectedStaff.email || '';
    }
    if (!formData.documentDate) {
      patch.documentDate = new Date().toISOString().slice(0, 10);
    }
    if (!formData.inspectionCompletedAt) {
      patch.inspectionCompletedAt = new Date().toISOString().slice(0, 10);
    }
    if (!formData.taxRate) {
      patch.taxRate = '10';
    }
    if (Object.keys(patch).length > 0) {
      setFormData({ ...formData, ...patch });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, selectedStaff?.staff_name]);

  // Phase 9h: 検収書 — delivery_line_items / taxRate / isReducedTax の
  // どれかが変わったら 税抜合計 / 消費税 / 税込合計 を再計算して
  // テンプレ用フィールド (deliveredAmountStr / taxAmountStr / totalAmountStr)
  // に同期。equality チェックで無限ループ防止。
  useEffect(() => {
    if (!templateId.startsWith('inspection_certificate')) return;
    const lines = Array.isArray(formData.delivery_line_items)
      ? formData.delivery_line_items
      : [];
    if (lines.length === 0) return;

    const total = lines.reduce(
      (sum: number, v: any) => sum + (Number(v.inspected_amount_ex_tax) || 0),
      0
    );
    const taxRate =
      Number(formData.taxRate) || (formData.isReducedTax ? 8 : 10);
    const taxAmount = Math.ceil((total * taxRate) / 100);
    const totalInc = total + taxAmount;

    const newDeliveredStr = total.toLocaleString('ja-JP');
    const newTaxStr = taxAmount.toLocaleString('ja-JP');
    const newTotalStr = totalInc.toLocaleString('ja-JP');

    // Phase 17m: 経費（税込）も加算して総支払額を計算
    const expensesTotalIncTax = Number(formData.expensesTotalIncTax) || 0;
    const grandTotalPayable = totalInc + expensesTotalIncTax;
    const newGrandStr = grandTotalPayable.toLocaleString('ja-JP');

    // 既に同じ値なら setFormData をスキップして無限ループ防止
    if (
      formData.deliveredAmountStr === newDeliveredStr &&
      formData.taxAmountStr === newTaxStr &&
      formData.totalAmountStr === newTotalStr &&
      formData.grandTotalPayableStr === newGrandStr &&
      String(formData.taxRate) === String(taxRate)
    ) {
      return;
    }

    setFormData({
      ...formData,
      deliveredAmountStr: newDeliveredStr,
      taxRate: String(taxRate),
      taxAmountStr: newTaxStr,
      totalAmountStr: newTotalStr,
      grandTotalPayable,
      grandTotalPayableStr: newGrandStr,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    templateId,
    formData.delivery_line_items,
    formData.taxRate,
    formData.isReducedTax,
    formData.expensesTotalIncTax,
  ]);

  const renderField = (id: string, customLabel?: string) => {
    const meta = (metadata.vars || {})[id] || { label: id, group: 'General' };
    const label = customLabel || meta.label || id.replace(/_/g, ' ');
    
    return (
      <FormField 
        key={id} 
        id={id} 
        meta={{ ...meta, label }} 
        value={formData[id]} 
        onChange={(v) => setFormData({ ...formData, [id]: v })} 
      />
    );
  };

  // Logic for individual license terms specialized UI.
  //
  // Driven by templates_config.json's group metadata so the form layout
  // stays in sync with the variable definitions. Both Licensor and
  // Licensee sections expose [自社] and [取引先] buttons because
  // either party can be Arclight depending on whether the deal is
  // inbound or outbound licensing.
  if (templateId === 'individual_license_terms') {
    const isCorporation = (vendor: any) =>
      (vendor?.entity_type || '').toLowerCase() === 'corporate' ||
      (vendor?.entity_type || '') === '法人';

    const fillLicensorFromSelf = () =>
      setFormData({
        ...formData,
        Licensor_名称: companyProfile?.name || '',
        Licensor_住所: companyProfile?.address || '',
        Licensor_氏名会社名: companyProfile?.name || '',
        Licensor_代表者名: companyProfile?.representative || '',
        LICENSOR_IS_CORPORATION: true,
      });

    const fillLicensorFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        Licensor_名称: activeVendor.vendor_name || '',
        Licensor_住所: activeVendor.address || '',
        Licensor_氏名会社名: activeVendor.trade_name || activeVendor.vendor_name || '',
        Licensor_代表者名: activeVendor.vendor_rep || activeVendor.contact_name || '',
        LICENSOR_IS_CORPORATION: isCorporation(activeVendor),
      });
    };

    const fillLicenseeFromSelf = () =>
      setFormData({
        ...formData,
        Licensee_名称: companyProfile?.name || '',
        Licensee_住所: companyProfile?.address || '',
        Licensee_氏名会社名: companyProfile?.name || '',
        Licensee_代表者名: companyProfile?.representative || '',
        LICENSEE_IS_CORPORATION: true,
      });

    const fillLicenseeFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        Licensee_名称: activeVendor.vendor_name || '',
        Licensee_住所: activeVendor.address || '',
        Licensee_氏名会社名: activeVendor.trade_name || activeVendor.vendor_name || '',
        Licensee_代表者名: activeVendor.vendor_rep || activeVendor.contact_name || '',
        LICENSEE_IS_CORPORATION: isCorporation(activeVendor),
      });
    };

    const fillStaffAsSupervisor = () => {
      if (!selectedStaff) return;
      setFormData({
        ...formData,
        監修者: selectedStaff.staff_name || '',
        クレジット表示: `© Arclight / ${selectedStaff.staff_name || ''}`,
      });
    };

    const sideButton = (
      label: string,
      onClick: () => void,
      disabled: boolean
    ) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    // Required-completion summary (counts unfilled required fields).
    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });

    // Render a group of fields by group name (from templates_config.json).
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    return (
      <div className="space-y-10">
        {/* Required-progress banner */}
        <div
          className={`flex items-center justify-between gap-3 px-4 py-2 rounded-sm border ${
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        {/* I. ヘッダ */}
        <FormSection title="I. ヘッダ" variant="default" icon={<Briefcase className="w-4 h-4" />}>
          {renderGroup('I. ヘッダ')}
        </FormSection>

        {/* II/III. Licensor / Licensee — side-swappable parties */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. Licensor (許諾者)"
            variant="blue"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillLicensorFromSelf, !companyProfile)}
                {sideButton('取引先', fillLicensorFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('II. Licensor (許諾者)')}
          </FormSection>

          <FormSection
            title="III. Licensee (被許諾者)"
            variant="amber"
            icon={<User className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillLicenseeFromSelf, !companyProfile)}
                {sideButton('取引先', fillLicenseeFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('III. Licensee (被許諾者)')}
          </FormSection>
        </div>

        {/* IV. 対象作品・期間 */}
        <FormSection title="IV. 対象作品・期間" variant="emerald" icon={<Scale className="w-4 h-4" />}>
          {renderGroup('IV. 対象作品・期間')}
        </FormSection>

        {/* V. 素材・監修 */}
        <FormSection
          title="V. 素材・監修"
          variant="default"
          icon={<ShieldCheck className="w-4 h-4" />}
          headerActions={sideButton(
            'Sync Staff',
            fillStaffAsSupervisor,
            !selectedStaff
          )}
        >
          {renderGroup('V. 素材・監修')}
        </FormSection>

        {/* VI. 金銭条件 — Phase 7d: 統合された FinancialConditionTable。
            DB の license_financial_conditions と同じ shape の rows を
            formData.financial_conditions[] に持つ。worker 側は document
            生成時にこれを (a) HTML テンプレ用 flat field
            {{金銭条件1_料率}} 等に展開, (b) license_financial_conditions
            に upsert する。 */}
        <FormSection
          title="VI. 金銭条件 (条件 1〜3)"
          variant="indigo"
          icon={<Coins className="w-4 h-4" />}
          headerActions={
            <span className="text-[9px] font-mono text-muted-foreground italic">
              条件 1=自社製造 / 2=サブライセンス / 3=プロダクトアウト (任意で追加可)
            </span>
          }
        >
          <FinancialConditionTable
            conditions={
              Array.isArray(formData.financial_conditions)
                ? (formData.financial_conditions as FinancialCondition[])
                : []
            }
            onChange={(conditions: FinancialCondition[]) =>
              setFormData({ ...formData, financial_conditions: conditions })
            }
          />
        </FormSection>

        {/* 旧 VI/VII/VIII の自由入力グループは下位互換のため
            details で温存。新しい FinancialConditionTable が優先され、
            こちらは個別微調整 (例: 計算式テキストだけ書きたい等) 用。 */}
        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ 金銭条件 — レガシー自由入力 (任意, 上の表で書ききれない場合のみ) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input space-y-6">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                条件 1 (自社製造)
              </div>
              {renderGroup('VI. 金銭条件 1 (自社製造)')}
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                条件 2 (サブライセンス)
              </div>
              {renderGroup('VII. 金銭条件 2 (サブライセンス, 任意)')}
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                条件 3 (プロダクトアウト)
              </div>
              {renderGroup('VIII. 金銭条件 3 (プロダクトアウト, 任意)')}
            </div>
          </div>
        </details>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ サブライセンシー一覧 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">
            <SubLicenseeTable formData={formData} setFormData={setFormData} />
          </div>
        </details>

        {/* IX. 特記事項 */}
        <FormSection title="IX. 特記事項" variant="red" icon={<AlertCircle className="w-4 h-4" />}>
          <div className="col-span-full">{renderGroup('IX. 特記事項')}</div>
        </FormSection>
      </div>
    );
  }

  // Specialized Purchase Order Form (Phase 3b-2)
  //
  // Driven by templates_config.json metadata for purchase_order. Same
  // shape as the individual_license_terms redesign:
  //   - Required-progress banner at top
  //   - Side-swappable Vendor / Issuer sections ([自社]/[取引先] buttons)
  //   - Bank info auto-fills from active vendor
  //   - Advanced sections (特約・備考, 契約・署名) collapsed by default
  if (templateId === 'purchase_order') {
    const isCorporation = (vendor: any) =>
      (vendor?.entity_type || '').toLowerCase() === 'corporate' ||
      (vendor?.entity_type || '') === '法人';

    const fillVendorFromPartner = () => {
      if (!activeVendor) return;
      // Phase 17h: 法人/個人 を判定して VENDOR_IS_CORPORATION も同期
      const isCorp = isCorporation(activeVendor);
      setFormData({
        ...formData,
        // Phase 17o: VENDOR_CODE を必ず同期する。
        //   これが無いと worker 側の contract_capabilities ミラー時に
        //   vendor_id が解決できず、法務検索（個別契約）に PO が
        //   表示されない原因になっていた。
        VENDOR_CODE: activeVendor.vendor_code || '',
        VENDOR_NAME: activeVendor.vendor_name || '',
        VENDOR_ADDRESS: activeVendor.address || '',
        VENDOR_REPRESENTATIVE_SAMA: activeVendor.vendor_rep
          ? `${activeVendor.vendor_rep} 様`
          : '',
        VENDOR_CONTACT_DEPARTMENT: activeVendor.contact_department || '',
        VENDOR_CONTACT_NAME: activeVendor.contact_name || '',
        VENDOR_EMAIL: activeVendor.email || '',
        VENDOR_IS_CORPORATION: isCorp ? '法人' : '個人',
        VENDOR_SUFFIX: isCorp ? '御中' : '様',
        // Bank info — common ask, pulled at the same time
        BANK_NAME: activeVendor.bank_name || '',
        BRANCH_NAME: activeVendor.branch_name || '',
        ACCOUNT_TYPE: activeVendor.account_type || '',
        ACCOUNT_NUMBER: activeVendor.account_number || '',
        ACCOUNT_HOLDER_KANA: activeVendor.account_holder_kana || '',
        INVOICE_REGISTRATION_NUMBER: activeVendor.invoice_registration_number || '',
      });
    };

    const fillVendorFromSelf = () =>
      setFormData({
        ...formData,
        VENDOR_NAME: companyProfile?.name || '',
        VENDOR_ADDRESS: companyProfile?.address || '',
        VENDOR_REPRESENTATIVE_SAMA: companyProfile?.representative
          ? `${companyProfile.representative} 様`
          : '',
        VENDOR_IS_CORPORATION: '法人', // 自社は常に法人想定
        VENDOR_SUFFIX: '御中',
      });

    const fillIssuerFromSelf = () =>
      setFormData({
        ...formData,
        PARTY_A_NAME: companyProfile?.name || '',
        PARTY_A_ADDRESS: companyProfile?.address || '',
        PARTY_A_REP: companyProfile?.representative || '',
      });

    const fillIssuerFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        PARTY_A_NAME: activeVendor.vendor_name || '',
        PARTY_A_ADDRESS: activeVendor.address || '',
        PARTY_A_REP: activeVendor.vendor_rep || activeVendor.contact_name || '',
      });
    };

    const fillStaff = () => {
      if (!selectedStaff) return;
      setFormData({
        ...formData,
        STAFF_NAME: selectedStaff.staff_name || '',
        STAFF_DEPARTMENT: selectedStaff.department || '',
        STAFF_PHONE: selectedStaff.phone || '',
        STAFF_EMAIL: selectedStaff.email || '',
      });
    };

    const sideButton = (
      label: string,
      onClick: () => void,
      disabled: boolean
    ) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    // Required-completion summary
    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });

    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    return (
      <div className="space-y-10">
        {/* Required-progress banner */}
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        {/* I. 発注概要 */}
        <FormSection
          title="I. 発注概要"
          variant="default"
          icon={<Briefcase className="w-4 h-4" />}
          headerActions={
            <button
              type="button"
              onClick={onSync}
              className="text-[8px] font-mono border border-foreground/30 px-2 py-0.5 uppercase rounded-sm hover:bg-muted"
              title="Backlog 課題から自動補完"
            >
              <Database className="w-2 h-2 inline mr-1" />
              Backlog Sync
            </button>
          }
        >
          {renderGroup('I. 発注概要')}
        </FormSection>

        {/* II/III. Vendor / Issuer — side-swappable parties */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. 発注先 (取引先)"
            variant="amber"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillVendorFromSelf, !companyProfile)}
                {sideButton('取引先', fillVendorFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('II. 発注先 (取引先)')}
          </FormSection>

          <FormSection
            title="III. 発注元 (自社)"
            variant="blue"
            icon={<User className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillIssuerFromSelf, !companyProfile)}
                {sideButton('取引先', fillIssuerFromPartner, !activeVendor)}
                {sideButton('Sync Staff', fillStaff, !selectedStaff)}
              </>
            }
          >
            {renderGroup('III. 発注元 (自社)')}
          </FormSection>
        </div>

        {/* IV. 明細 (Phase 7a/7b) — primary path; grandTotalExTax は自動集計 */}
        <FormSection
          title="IV. 明細"
          variant="indigo"
          icon={<List className="w-4 h-4" />}
        >
          <LineItemTable
            items={Array.isArray(formData.items) ? formData.items : []}
            onChange={(items: LineItem[]) => {
              const grandTotal = items.reduce(
                (sum, it) => sum + (Number(it.amount_ex_tax) || 0),
                0
              );
              setFormData({
                ...formData,
                items,
                grandTotalExTax: grandTotal,
              });
            }}
            showPaymentColumns={true}
          />
        </FormSection>

        {/* IV-b. 経費 (Phase 17i) — 交通費等・税込み額表示。
            本体報酬とは別に行単位で経費を保持し、PDF にも経費表として
            出力される。データは order_expenses テーブルに保存。 */}
        <FormSection
          title="IV-b. 経費（交通費等・税込み）"
          variant="indigo"
          icon={<List className="w-4 h-4" />}
        >
          <ExpenseTable
            expenses={Array.isArray(formData.expenses) ? formData.expenses : []}
            onChange={(expenses: ExpenseItem[]) => {
              const expensesTotal = expenses.reduce(
                (sum, e) => sum + (Number(e.amount_inc_tax) || 0),
                0
              );
              setFormData({
                ...formData,
                expenses,
                expensesTotalIncTax: expensesTotal,
              });
            }}
          />
        </FormSection>

        {/* V. 金額サマリ・納期 */}
        <FormSection title="V. 金額サマリ・納期" variant="indigo" icon={<Scale className="w-4 h-4" />}>
          {renderGroup('IV. 金額・納期')}
        </FormSection>

        {/* VI. 振込先 */}
        <FormSection
          title="VI. 振込先 (取引先口座)"
          variant="emerald"
          headerActions={sideButton('取引先', fillVendorFromPartner, !activeVendor)}
        >
          {renderGroup('V. 振込先 (取引先口座)')}
        </FormSection>

        {/* VI. 特約・備考 — collapsed */}
        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VI. 特約・備考 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">
            {renderGroup('VI. 特約・備考 (任意)')}
          </div>
        </details>

        {/* VII. 契約・署名 — collapsed */}
        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VII. 契約・署名 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">
            {renderGroup('VII. 契約・署名 (任意)')}
          </div>
        </details>
      </div>
    );
  }

  // Specialized License Master (Phase 3b-4)
  //
  // VENDOR_* in the template == ライセンサー / PARTY_A_* == ライセンシー.
  // The default mapping (Vendor=取引先, PARTY_A=自社) covers inbound
  // licensing; the swap buttons cover the inverted case. Bank info on
  // a license master is the licensor's royalty receive account, so it
  // auto-fills from the active vendor's bank columns when [取引先] is
  // clicked on that section.
  if (templateId === 'license_master') {
    const fillVendorFromSelf = () =>
      setFormData({
        ...formData,
        VENDOR_NAME: companyProfile?.name || '',
        VENDOR_ADDRESS: companyProfile?.address || '',
        VENDOR_REP: companyProfile?.representative || '',
      });

    const fillVendorFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        // Phase 17o: VENDOR_CODE を必ず同期 (法務検索の vendor_id 解決用)
        VENDOR_CODE: activeVendor.vendor_code || '',
        VENDOR_NAME: activeVendor.vendor_name || '',
        VENDOR_ADDRESS: activeVendor.address || '',
        VENDOR_REP: activeVendor.vendor_rep || activeVendor.contact_name || '',
        VENDOR_PHONE: activeVendor.phone || '',
        VENDOR_EMAIL: activeVendor.email || '',
        // Bank info commonly follows the licensor on a license master
        BANK_NAME: activeVendor.bank_name || '',
        BRANCH_NAME: activeVendor.branch_name || '',
        ACCOUNT_TYPE: activeVendor.account_type || '',
        ACCOUNT_NUMBER: activeVendor.account_number || '',
        ACCOUNT_HOLDER_KANA: activeVendor.account_holder_kana || '',
        IS_INVOICE_ISSUER: !!activeVendor.is_invoice_issuer,
        invoiceRegistrationDisplay: activeVendor.invoice_registration_number
          ? `T${activeVendor.invoice_registration_number}`
          : '',
      });
    };

    const fillPartyAFromSelf = () =>
      setFormData({
        ...formData,
        PARTY_A_NAME: companyProfile?.name || '',
        PARTY_A_ADDRESS: companyProfile?.address || '',
        PARTY_A_REP: companyProfile?.representative || '',
      });

    const fillPartyAFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        PARTY_A_NAME: activeVendor.vendor_name || '',
        PARTY_A_ADDRESS: activeVendor.address || '',
        PARTY_A_REP: activeVendor.vendor_rep || activeVendor.contact_name || '',
      });
    };

    const sideButton = (label: string, onClick: () => void, disabled: boolean) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    return (
      <div className="space-y-10">
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        <FormSection title="I. ヘッダ" variant="default" icon={<Briefcase className="w-4 h-4" />}>
          {renderGroup('I. ヘッダ')}
        </FormSection>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. ライセンサー (許諾者)"
            variant="blue"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillVendorFromSelf, !companyProfile)}
                {sideButton('取引先', fillVendorFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('II. ライセンサー (許諾者)')}
          </FormSection>

          <FormSection
            title="III. ライセンシー (被許諾者)"
            variant="amber"
            icon={<User className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillPartyAFromSelf, !companyProfile)}
                {sideButton('取引先', fillPartyAFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('III. ライセンシー (被許諾者)')}
          </FormSection>
        </div>

        <FormSection
          title="IV. 振込先口座 (ロイヤリティ送金先)"
          variant="emerald"
          headerActions={sideButton('取引先', fillVendorFromPartner, !activeVendor)}
        >
          {renderGroup('IV. 振込先口座 (ロイヤリティ送金先)')}
        </FormSection>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ V. 備考 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">{renderGroup('V. 備考 (任意)')}</div>
        </details>
      </div>
    );
  }

  // Specialized Service Master (業務委託基本契約書, Phase 3b-4 v2)
  //
  // The template now ships with explicit 甲 (PARTY_A_*) and 乙 (VENDOR_*)
  // form variables, banking info, and an invoice block — mirroring the
  // shape of license_master. Both party sections expose [自社]/[取引先]
  // buttons because the inbound/outbound case applies here too
  // (Arclight is normally the 委託者 = 甲 but the swap supports
  // edge scenarios where roles are inverted).
  if (templateId === 'service_master') {
    // Phase 22.5: 乙 (受託者) の 法人/個人 判定。
    //   未設定 (新規 / 既存 doc に値なし) は "法人" デフォルト。
    //   個人選択時は VENDOR_REP フィールドを非表示 + 必須から除外し、
    //   VENDOR_NAME のラベルを「商号」→「氏名」に切り替える。
    //   テンプレ HTML 側も {{#if (eq VENDOR_IS_CORPORATION "個人")}} で
    //   同じ分岐を行うので、PDF も自動で個人形式 (氏名のみ) に切り替わる。
    const isVendorCorp =
      (formData.VENDOR_IS_CORPORATION || '法人') === '法人';

    // vendor.entity_type → "法人" / "個人" への正規化。
    // worker / api 両方 "corporate" / "individual" (英) で持つが、
    // 旧データには日本語値も混在しうるので両方カバーする。
    const entityTypeToJa = (et?: string | null): '法人' | '個人' => {
      const v = String(et || '').toLowerCase();
      if (v === 'individual' || et === '個人') return '個人';
      return '法人';
    };

    const fillPartyAFromSelf = () =>
      setFormData({
        ...formData,
        PARTY_A_NAME: companyProfile?.name || '',
        PARTY_A_ADDRESS: companyProfile?.address || '',
        PARTY_A_REP: companyProfile?.representative || '',
      });

    const fillPartyAFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        PARTY_A_NAME: activeVendor.vendor_name || '',
        PARTY_A_ADDRESS: activeVendor.address || '',
        PARTY_A_REP: activeVendor.vendor_rep || activeVendor.contact_name || '',
      });
    };

    const fillVendorFromSelf = () =>
      setFormData({
        ...formData,
        VENDOR_NAME: companyProfile?.name || '',
        VENDOR_ADDRESS: companyProfile?.address || '',
        VENDOR_REP: companyProfile?.representative || '',
        VENDOR_IS_CORPORATION: '法人', // 自社は常に法人想定
      });

    const fillVendorFromPartner = () => {
      if (!activeVendor) return;
      const isCorp = entityTypeToJa(activeVendor.entity_type) === '法人';
      setFormData({
        ...formData,
        // Phase 17o: VENDOR_CODE を必ず同期 (法務検索の vendor_id 解決用)
        VENDOR_CODE: activeVendor.vendor_code || '',
        // Phase 22.5: 法人=正式名 (vendor_name) / 個人=屋号 or 氏名 (pen_name → trade_name → vendor_name)
        VENDOR_NAME: isCorp
          ? activeVendor.vendor_name || ''
          : activeVendor.pen_name ||
            activeVendor.trade_name ||
            activeVendor.vendor_name ||
            '',
        VENDOR_ADDRESS: activeVendor.address || '',
        // 個人の場合、代表者欄は非表示なので空文字で OK
        VENDOR_REP: isCorp
          ? activeVendor.vendor_rep || activeVendor.contact_name || ''
          : '',
        VENDOR_PHONE: activeVendor.phone || '',
        VENDOR_EMAIL: activeVendor.email || '',
        VENDOR_IS_CORPORATION: isCorp ? '法人' : '個人',
        // Banking commonly belongs to 乙 on a service master
        BANK_NAME: activeVendor.bank_name || '',
        BRANCH_NAME: activeVendor.branch_name || '',
        ACCOUNT_TYPE: activeVendor.account_type || '',
        ACCOUNT_NUMBER: activeVendor.account_number || '',
        ACCOUNT_HOLDER_KANA: activeVendor.account_holder_kana || '',
        IS_INVOICE_ISSUER: activeVendor.is_invoice_issuer ? '該当' : '非該当',
        invoiceRegistrationDisplay: activeVendor.invoice_registration_number
          ? `T${activeVendor.invoice_registration_number}`
          : '',
      });
    };

    const sideButton = (label: string, onClick: () => void, disabled: boolean) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    // Phase 22.5: 個人事業主の場合は VENDOR_REP を必須から除外
    // (テンプレ側でも非表示なので、入力する場所がなくなるため)
    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([id, m]: [string, any]) => {
        if (m?.required !== true) return false;
        if (id === 'VENDOR_REP' && !isVendorCorp) return false;
        return true;
      })
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    // 乙セクション専用の renderGroup。
    //   - 個人選択時は VENDOR_REP フィールドを非表示
    //   - VENDOR_NAME のラベルを 法人/個人 で切替 (商号 / 氏名)
    const renderVendorGroup = () =>
      (groupedVars['III. 乙 (受託者)'] || [])
        .filter((fid) => !(fid === 'VENDOR_REP' && !isVendorCorp))
        .map((fid) => {
          if (fid === 'VENDOR_NAME') {
            return renderField(
              fid,
              isVendorCorp ? '乙 (受託者) 商号' : '乙 (受託者) 氏名'
            );
          }
          return renderField(fid);
        });

    return (
      <div className="space-y-10">
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        <FormSection
          title="I. 契約締結日"
          variant="default"
          icon={<Briefcase className="w-4 h-4" />}
        >
          <div className="grid grid-cols-3 gap-3">{renderGroup('I. 契約締結日')}</div>
        </FormSection>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. 甲 (委託者)"
            variant="blue"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillPartyAFromSelf, !companyProfile)}
                {sideButton('取引先', fillPartyAFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('II. 甲 (委託者)')}
          </FormSection>

          <FormSection
            title={isVendorCorp ? 'III. 乙 (受託者・法人)' : 'III. 乙 (受託者・個人)'}
            variant="amber"
            icon={<User className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillVendorFromSelf, !companyProfile)}
                {sideButton('取引先', fillVendorFromPartner, !activeVendor)}
              </>
            }
          >
            {renderVendorGroup()}
          </FormSection>
        </div>

        <FormSection
          title="IV. 振込先銀行口座 (乙)"
          variant="emerald"
          headerActions={sideButton('取引先', fillVendorFromPartner, !activeVendor)}
        >
          {renderGroup('IV. 振込先銀行口座 (乙)')}
        </FormSection>

        <FormSection title="V. インボイス制度関連" variant="indigo">
          {renderGroup('V. インボイス制度関連')}
        </FormSection>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VI. 特約 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">{renderGroup('VI. 特約 (任意)')}</div>
        </details>
      </div>
    );
  }

  // Specialized Inspection Form (Phase 3b-5)
  //
  // 受託者 = vendor side, 検収者 = staff/self side. We keep the existing
  // 3-column layout for the top row (basic / vendor / staff) but
  // replace the legacy Master-Sync / Staff-Sync buttons with the
  // standard sideButton helper and add the required-progress banner.
  //
  // NOTE: applies to all inspection_certificate variants
  // (inspection_certificate, _v2, _detailed) via startsWith. Metadata
  // is keyed to the main inspection_certificate template; _v2 / _detailed
  // share the same field IDs where they overlap.
  if (templateId.startsWith('inspection_certificate')) {
    const fillCounterpartyFromPartner = () => {
      if (!activeVendor) return;
      // Phase 9d: 法人/個人を select 「法人」/「個人」 文字列で保存。
      //   - 法人: 会社名「御中」 + 棒線 + 代表者「様」
      //   - 個人: 名前「様」のみ
      const isCorporation =
        (activeVendor.entity_type || '').toLowerCase() === 'corporate' ||
        activeVendor.entity_type === '法人';
      const repName =
        activeVendor.vendor_rep || activeVendor.contact_name || '';
      setFormData({
        ...formData,
        counterparty: activeVendor.vendor_name || '',
        COUNTERPARTY_IS_CORPORATION: isCorporation ? '法人' : '個人',
        counterpartyRep: repName,
        // Legacy フィールドも残しておく (旧テンプレ・既存生成済み doc の form_data 互換)
        counterpartyRepresentativeSama: repName ? `${repName} 様` : '',
        counterpartyTni: activeVendor.invoice_registration_number || '',
        // Bank info commonly populated at the same time
        bankName: activeVendor.bank_name || '',
        branchName: activeVendor.branch_name || '',
        accountType: activeVendor.account_type || '',
        accountNo: activeVendor.account_number || '',
        accountHolder: activeVendor.account_holder_kana || '',
      });
    };

    const fillInspectorFromStaff = () => {
      if (!selectedStaff) return;
      setFormData({
        ...formData,
        inspectorDept: selectedStaff.department || '',
        inspectorName: selectedStaff.staff_name || '',
        // Phase 9b: みなし同意ブロックの連絡先用
        inspectorEmail: selectedStaff.email || '',
      });
    };

    const sideButton = (label: string, onClick: () => void, disabled: boolean) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    return (
      <div className="space-y-10">
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        <FormSection
          title="I. 基本情報"
          variant="default"
          icon={<Briefcase className="w-4 h-4" />}
          headerActions={
            <button
              type="button"
              onClick={onSync}
              className="text-[8px] font-mono border border-foreground/30 px-2 py-0.5 uppercase rounded-sm hover:bg-muted"
              title="Backlog 課題から自動補完"
            >
              <Database className="w-2 h-2 inline mr-1" />
              Backlog Sync
            </button>
          }
        >
          {renderGroup('I. 基本情報')}
        </FormSection>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. 受託者 (取引先)"
            variant="amber"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={sideButton('取引先', fillCounterpartyFromPartner, !activeVendor)}
          >
            {renderGroup('II. 受託者 (取引先)')}
          </FormSection>

          <FormSection
            title="III. 検収者 (自社)"
            variant="emerald"
            icon={<User className="w-4 h-4" />}
            headerActions={sideButton('Sync Staff', fillInspectorFromStaff, !selectedStaff)}
          >
            {renderGroup('III. 検収者 (自社)')}
          </FormSection>
        </div>

        {/* Phase 8c: 親 PO ピッカー — Backlog 親子経由で自動発見できない
            ケース (IMPORT-* PO / 親子未設定) のためのフォールバック手段。
            form-context が既に親 PO を載せていても、ここで上書き可能。 */}
        <ParentPoPicker
          currentKey={formData.parent_po_issue_key}
          hasParent={
            Array.isArray(formData.order_lines_for_inspection) &&
            formData.order_lines_for_inspection.length > 0
          }
          onPick={(loaded: PoLoaded) => {
            // Phase 9c/f: 親 PO 選択時に PDF が必要とする全フィールドを一括流し込み
            const firstLine = loaded.line_items?.[0];
            const v = loaded.vendor || {};
            const isCorp =
              (v.entity_type || '').toLowerCase() === 'corporate' ||
              v.entity_type === '法人';
            const repName = v.vendor_rep || v.contact_name || '';
            const todayIso = new Date().toISOString().slice(0, 10);
            const poHeader = loaded.raw?.order_item || {};
            const prog = loaded.delivery_progress;

            setFormData({
              ...formData,
              parent_po_id: loaded.order_item_id,
              parent_po_issue_key: loaded.backlog_issue_key,
              parent_po_number: loaded.document_number || '',
              order_lines_for_inspection: loaded.line_items,
              // 発注情報セクション
              orderDate: poHeader.due_date || poHeader.created_at || '',
              itemCount: String((loaded.line_items || []).length || 1),
              itemNo: formData.itemNo || '1',
              // Phase 9h: 親 PO の tax_rate を優先採用
              taxRate: String(poHeader.tax_rate || formData.taxRate || 10),
              // 検収書発行日 (未入力なら今日で初期化)
              documentDate: formData.documentDate || todayIso,
              // Phase 9f: 分割検収サポート — 既存検収件数 +1 を採番、
              // 進捗バー用の値もまとめてセット
              ...(prog && {
                deliveryNo: String(prog.next_delivery_no),
                isPartial:
                  prog.is_partial || prog.next_delivery_no > 1
                    ? '分割'
                    : '完了',
                inspectedAmountStr: prog.done_amount_ex_tax.toLocaleString('ja-JP'),
                pendingAmountStr: prog.remaining_amount_ex_tax.toLocaleString('ja-JP'),
                totalOrderAmountStr: (
                  prog.done_amount_ex_tax + prog.remaining_amount_ex_tax
                ).toLocaleString('ja-JP'),
                inspectedPct: String(prog.inspected_pct),
              }),
              // 今回納品内容: 第 1 行を default 補完 (multi-line PO は適宜手動編集)
              description:
                formData.description || (firstLine?.item_name || ''),
              spec: formData.spec || (firstLine?.spec || ''),
              // 取引先情報 (PO の vendor_code から JOIN)
              ...(v.vendor_name && {
                counterparty: formData.counterparty || v.vendor_name,
                COUNTERPARTY_IS_CORPORATION: isCorp ? '法人' : '個人',
                counterpartyRep: formData.counterpartyRep || repName,
                counterpartyRepresentativeSama:
                  formData.counterpartyRepresentativeSama ||
                  (repName ? `${repName} 様` : ''),
                counterpartyTni:
                  formData.counterpartyTni ||
                  v.invoice_registration_number ||
                  '',
                bankName: formData.bankName || v.bank_name || '',
                branchName: formData.branchName || v.branch_name || '',
                accountType: formData.accountType || v.account_type || '',
                accountNo: formData.accountNo || v.account_number || '',
                accountHolder:
                  formData.accountHolder || v.account_holder_kana || '',
              }),
              // 親を切り替えたら検収入力は一旦リセット (overflow 整合のため)
              delivery_line_items: [],
              deliveredAmountStr: '',
              // Phase 17m: 親 PO の経費（精算候補）も流し込む
              po_expenses: Array.isArray(loaded.expenses) ? loaded.expenses : [],
              selectedExpenseLineNos: [],
              isFinalInspection: false,
              expenses: [],
              expensesTotalIncTax: 0,
            });
          }}
          onClear={() => {
            setFormData({
              ...formData,
              parent_po_id: undefined,
              parent_po_issue_key: undefined,
              order_lines_for_inspection: [],
              delivery_line_items: [],
              // Phase 17m: 経費精算もクリア
              po_expenses: [],
              selectedExpenseLineNos: [],
              isFinalInspection: false,
              expenses: [],
              expensesTotalIncTax: 0,
            });
          }}
        />

        {/* Phase 7c: 親 PO の明細別検収テーブル。
            form-context が parent_po_id + order_lines_for_inspection[] を
            返したときだけ表示する。それ以外 (親なし) のときは従来の
            自由入力フォームにフォールバック。 */}
        {Array.isArray(formData.order_lines_for_inspection) &&
        formData.order_lines_for_inspection.length > 0 ? (
          <FormSection
            title="IV. 明細別検収 (親 PO 連動)"
            variant="indigo"
            icon={<Scale className="w-4 h-4" />}
            headerActions={
              <span className="text-[9px] font-mono text-muted-foreground italic">
                親 PO: {formData.parent_po_issue_key || "—"}
              </span>
            }
          >
            <DeliveryLineItemTable
              orderLines={formData.order_lines_for_inspection as OrderLineForInspection[]}
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
                );
                const taxRate = Number(formData.taxRate)
                  || (formData.isReducedTax ? 8 : 10);
                const taxAmount = Math.ceil((total * taxRate) / 100);
                const totalInc = total + taxAmount;
                setFormData({
                  ...formData,
                  delivery_line_items: values,
                  deliveredAmountStr: total.toLocaleString("ja-JP"),
                  taxRate: String(taxRate),
                  taxAmountStr: taxAmount.toLocaleString("ja-JP"),
                  totalAmountStr: totalInc.toLocaleString("ja-JP"),
                });
              }}
            />
          </FormSection>
        ) : (
          <FormSection
            title="IV. 納品明細 (自由入力)"
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
                  className="text-[8px] font-mono border border-foreground/30 px-2 py-0.5 uppercase rounded-sm hover:bg-muted flex items-center gap-1"
                >
                  <Link className="w-2 h-2" /> PO紐付
                </button>
              )
            }
          >
            {renderGroup('IV. 納品明細')}
          </FormSection>
        )}

        {/* IV-b. 経費精算 (Phase 17m) — 親 PO に経費がある時だけ表示。
            チェックを入れた経費だけが今回検収の支払額に加算され、PDF に
            「経費（税込）」セクションが描画される。 */}
        {Array.isArray(formData.po_expenses) && formData.po_expenses.length > 0 && (
          <FormSection
            title="IV-b. 経費精算（親 PO 連動）"
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
                setFormData({ ...formData, isFinalInspection: v });
              }}
              onChange={(selected: number[]) => {
                const selectedSet = new Set(selected);
                const expenses = (formData.po_expenses as InspectionExpense[])
                  .filter((e) => selectedSet.has(e.line_no));
                const expensesTotalIncTax = expenses.reduce(
                  (s, e) => s + (Number(e.amount_inc_tax) || 0),
                  0
                );
                // 検収金額（税込）+ 経費（税込）= 総支払額
                const totalIncTax = Number(
                  String(formData.totalAmountStr || "0").replace(/[^0-9.-]+/g, "")
                ) || 0;
                const grandTotalPayable = totalIncTax + expensesTotalIncTax;
                setFormData({
                  ...formData,
                  selectedExpenseLineNos: selected,
                  expenses,
                  expensesTotalIncTax,
                  expensesTotalIncTaxStr:
                    expensesTotalIncTax.toLocaleString("ja-JP"),
                  grandTotalPayable,
                  grandTotalPayableStr: grandTotalPayable.toLocaleString("ja-JP"),
                });
              }}
            />
          </FormSection>
        )}

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ V. 進捗・財務 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">{renderGroup('V. 進捗・財務 (任意)')}</div>
        </details>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VI. 振込先 (受託者口座, 任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">
            {renderGroup('VI. 振込先 (受託者口座, 任意)')}
          </div>
        </details>
      </div>
    );
  }

  // Specialized Royalty Form (利用許諾料計算書, Phase 3b-5)
  //
  // licensor = vendor side (IP owner), licensee = self side (Arclight).
  // Both sections have side buttons in case the deal is inverted.
  if (templateId === 'royalty_statement') {
    const fillLicensorFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        licensor: activeVendor.vendor_name || '',
        VENDOR_REPRESENTATIVE_SAMA: activeVendor.vendor_rep
          ? `${activeVendor.vendor_rep} 様`
          : '',
      });
    };

    const fillLicensorFromSelf = () =>
      setFormData({
        ...formData,
        licensor: companyProfile?.name || '',
      });

    const fillLicenseeFromSelf = () =>
      setFormData({
        ...formData,
        licensee: companyProfile?.name || '',
      });

    const fillLicenseeFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        licensee: activeVendor.vendor_name || '',
      });
    };

    const sideButton = (label: string, onClick: () => void, disabled: boolean) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    return (
      <div className="space-y-10">
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        <FormSection
          title="I. ヘッダ"
          variant="default"
          icon={<Briefcase className="w-4 h-4" />}
          headerActions={
            onLinkAsset && (
              <button
                type="button"
                onClick={() =>
                  onLinkAsset((asset) =>
                    setFormData({
                      ...formData,
                      linked_terms_number: asset.asset_number,
                      linked_terms_link: asset.file_link,
                    })
                  )
                }
                className="text-[8px] font-mono border border-foreground/30 px-2 py-0.5 uppercase rounded-sm hover:bg-muted flex items-center gap-1"
              >
                <Link className="w-2 h-2" /> 個別紐付
              </button>
            )
          }
        >
          {renderGroup('I. ヘッダ')}
        </FormSection>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. ライセンサー (取引先)"
            variant="blue"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillLicensorFromSelf, !companyProfile)}
                {sideButton('取引先', fillLicensorFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('II. ライセンサー (取引先)')}
          </FormSection>

          <FormSection
            title="III. ライセンシー (自社)"
            variant="amber"
            icon={<User className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillLicenseeFromSelf, !companyProfile)}
                {sideButton('取引先', fillLicenseeFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('III. ライセンシー (自社)')}
          </FormSection>
        </div>

        <FormSection
          title="IV. 対象作品・製造"
          variant="emerald"
          icon={<ShieldCheck className="w-4 h-4" />}
        >
          {renderGroup('IV. 対象作品・製造')}
        </FormSection>

        {/* V. ロイヤリティ計算 — Phase 7e: 右ペインにライブ計算プレビュー。
            form-context が license_contract_id + financial_conditions[] を
            プリセットしているとき、ユーザーは
              ・条件 1〜N の選択 (calc target)
              ・基準価格 / 数量 / サンプル数量 / 税率
            の 4 つを動かすだけで、サーバ側 billing.calculateFee の結果が
            300ms デバウンスで右側に出る。Math.ceil の挙動も含めて UI 上で
            確定保存前に検証できる。 */}
        <FormSection
          title="V. ロイヤリティ計算"
          variant="indigo"
          icon={<Scale className="w-4 h-4" />}
        >
          <div className="col-span-full grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* 左 3/5: 既存フィールド + condition ピッカー */}
            <div className="lg:col-span-3 space-y-3">
              {/* 金銭条件ピッカー — form-context から拾った行を radio で選ぶ */}
              {Array.isArray(formData.financial_conditions) &&
              formData.financial_conditions.length > 0 ? (
                <div className="border border-input rounded-sm p-3 bg-muted/20">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                    計算対象の金銭条件
                  </div>
                  <div className="space-y-1.5">
                    {(
                      formData.financial_conditions as FinancialCondition[]
                    ).map((c) => {
                      const cid = Number(c.id);
                      const selected =
                        Number(formData.license_financial_condition_id) === cid;
                      return (
                        <label
                          key={cid || c.condition_no}
                          className={cn(
                            'flex items-center gap-2 cursor-pointer text-[11px] font-mono p-1.5 rounded-sm',
                            selected
                              ? 'bg-foreground text-background'
                              : 'hover:bg-muted/40'
                          )}
                        >
                          <input
                            type="radio"
                            name="license_financial_condition_id"
                            checked={selected}
                            onChange={() =>
                              setFormData({
                                ...formData,
                                license_financial_condition_id: cid,
                                // 料率もこの条件で上書き (HTML テンプレ用 legacy)
                                料率:
                                  c.rate_pct !== undefined
                                    ? String(c.rate_pct)
                                    : formData.料率,
                              })
                            }
                            className="cursor-pointer"
                          />
                          <span className="font-bold">条件 {c.condition_no}</span>
                          <span className="opacity-70">
                            {c.calc_method || '—'}
                          </span>
                          <span className="opacity-70">
                            {c.rate_pct !== undefined ? `${c.rate_pct}%` : ''}
                          </span>
                          {c.mg_amount && c.mg_amount > 0 ? (
                            <span className="opacity-70">
                              MG {Number(c.mg_amount).toLocaleString('ja-JP')}
                            </span>
                          ) : null}
                          {c.region_language_label && (
                            <span className="opacity-60 ml-auto text-[9px]">
                              {c.region_language_label}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : formData.license_contract_id ? (
                <div className="text-[10px] font-mono text-muted-foreground italic">
                  ライセンス契約 ID は紐付き済ですが、金銭条件が未登録です。
                  先に「個別利用許諾条件書」を作成してください。
                </div>
              ) : null}

              {renderGroup('V. ロイヤリティ計算')}
            </div>

            {/* 右 2/5: ライブ計算プレビュー */}
            <div className="lg:col-span-2">
              <RoyaltyPreviewPanel
                licenseContractId={Number(formData.license_contract_id)}
                licenseFinancialConditionId={Number(
                  formData.license_financial_condition_id
                )}
                unitPrice={Number(formData.基準価格 || formData.MSRP || 0)}
                quantity={Number(formData.quantity || 0)}
                sampleQuantity={Number(formData.sampleQuantity || 0)}
                taxRate={Number(formData.taxRate || 10)}
                onPreview={(p) => {
                  if (!p) return;
                  // Preview 結果をフォームの「合計」系フィールドに同期。
                  // 確定保存前にユーザーが目視する数字がサーバと一致するように。
                  // 注: setFormData は functional updater 非対応のため
                  // closure の formData を読む。fetch 中に別フィールドが
                  // 編集された場合は最新の合計値が上書きされるが、ユーザーは
                  // 入力継続で再計算が走るので実害は小さい。
                  setFormData({
                    ...formData,
                    billableQuantity: String(p.billable_quantity),
                    grossRoyaltyStr: new Intl.NumberFormat('ja-JP').format(
                      p.gross_royalty_ex_tax
                    ),
                    mgAmount: String(p.mg_amount),
                    mgRemaining: String(p.mg_remaining),
                    actualRoyalty: p.actual_royalty_ex_tax,
                    actualRoyaltyStr: new Intl.NumberFormat('ja-JP').format(
                      p.actual_royalty_ex_tax
                    ),
                    taxAmount: new Intl.NumberFormat('ja-JP').format(
                      p.tax_amount
                    ),
                    totalPaymentStr: new Intl.NumberFormat('ja-JP').format(
                      p.total_payment_inc_tax
                    ),
                  });
                }}
              />
            </div>
          </div>
        </FormSection>

        <FormSection title="VI. 金銭・支払" variant="cyan">
          {renderGroup('VI. 金銭・支払')}
        </FormSection>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VII. 備考 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">{renderGroup('VII. 備考 (任意)')}</div>
        </details>
       </div>
     );
  }

  // Specialized NDA Form (秘密保持契約書, Phase 3b-7)
  //
  // 11 variables, all required. Both 甲 (PARTY_A_*) and 乙 (PARTY_B_*)
  // are form-editable so the swap pattern applies — either side can
  // be Arclight depending on who initiated the NDA.
  if (templateId === 'nda') {
    const fillPartyAFromSelf = () =>
      setFormData({
        ...formData,
        PARTY_A_NAME: companyProfile?.name || '',
        PARTY_A_ADDRESS: companyProfile?.address || '',
        PARTY_A_REP: companyProfile?.representative || '',
      });

    const fillPartyAFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        PARTY_A_NAME: activeVendor.vendor_name || '',
        PARTY_A_ADDRESS: activeVendor.address || '',
        PARTY_A_REP: activeVendor.vendor_rep || activeVendor.contact_name || '',
      });
    };

    const fillPartyBFromSelf = () =>
      setFormData({
        ...formData,
        PARTY_B_NAME: companyProfile?.name || '',
        PARTY_B_ADDRESS: companyProfile?.address || '',
        PARTY_B_REP: companyProfile?.representative || '',
      });

    const fillPartyBFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        PARTY_B_NAME: activeVendor.vendor_name || '',
        PARTY_B_ADDRESS: activeVendor.address || '',
        PARTY_B_REP: activeVendor.vendor_rep || activeVendor.contact_name || '',
      });
    };

    const sideButton = (label: string, onClick: () => void, disabled: boolean) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    return (
      <div className="space-y-10">
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        <FormSection
          title="I. ヘッダ"
          variant="default"
          icon={<Briefcase className="w-4 h-4" />}
        >
          {renderGroup('I. ヘッダ')}
        </FormSection>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. 甲"
            variant="blue"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillPartyAFromSelf, !companyProfile)}
                {sideButton('取引先', fillPartyAFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('II. 甲')}
          </FormSection>

          <FormSection
            title="III. 乙"
            variant="amber"
            icon={<User className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillPartyBFromSelf, !companyProfile)}
                {sideButton('取引先', fillPartyBFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('III. 乙')}
          </FormSection>
        </div>

        <FormSection
          title="IV. 契約内容"
          variant="emerald"
          icon={<Scale className="w-4 h-4" />}
        >
          {renderGroup('IV. 契約内容')}
        </FormSection>

        <FormSection title="V. 一般条項" variant="indigo">
          {renderGroup('V. 一般条項')}
        </FormSection>
      </div>
    );
  }

  // Specialized Sales Master Form (売買基本契約書, Phase 3b-6)
  //
  // All three variants share the same shape: 甲 (アークライト) is
  // hard-coded inside the HTML, only PARTY_B (乙=取引先) has form
  // variables. Variant-specific terms live in their own group (III.):
  //   - sales_master_buyer:    III. 取引条件        (買手側条件)
  //   - sales_master_standard: III. 支払・納品条件   (売手側・前払/代引)
  //   - sales_master_credit:   III. 保証金・掛け売り条件
  //
  // The form dispatches by matching the templateId prefix and lets the
  // metadata's group ordering drive the layout.
  if (templateId.startsWith('sales_master_')) {
    const fillPartyBFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        PARTY_B_NAME: activeVendor.vendor_name || '',
        PARTY_B_ADDRESS: activeVendor.address || '',
        PARTY_B_REPRESENTATIVE: activeVendor.vendor_rep || activeVendor.contact_name || '',
      });
    };

    const sideButton = (label: string, onClick: () => void, disabled: boolean) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で取引先を選択してください' : undefined}
      >
        {label}
      </button>
    );

    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    // Variant-specific section III. label/icon resolution.
    const variantSection = templateId === 'sales_master_buyer'
      ? { title: 'III. 取引条件', variant: 'indigo' as const }
      : templateId === 'sales_master_standard'
        ? { title: 'III. 支払・納品条件', variant: 'indigo' as const }
        : { title: 'III. 保証金・掛け売り条件', variant: 'indigo' as const };

    // Sub-role label inside the partner section depends on the variant.
    const partnerRoleLabel = templateId === 'sales_master_buyer'
      ? '乙 (売主・取引先)'
      : '乙 (買主・取引先)';

    return (
      <div className="space-y-10">
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="px-4 py-2 rounded-sm bg-muted/50 text-[10px] font-mono text-muted-foreground">
          甲 は「株式会社アークライト」がテンプレート内に固定されています。
          以下は 乙 ({partnerRoleLabel.replace('乙 (', '').replace(')', '')}) の情報のみ入力してください。
        </div>

        <FormSection
          title="I. ヘッダ"
          variant="default"
          icon={<Briefcase className="w-4 h-4" />}
        >
          {renderGroup('I. ヘッダ')}
        </FormSection>

        <FormSection
          title={`II. ${partnerRoleLabel}`}
          variant="amber"
          icon={<Building2 className="w-4 h-4" />}
          headerActions={sideButton('取引先', fillPartyBFromPartner, !activeVendor)}
        >
          {renderGroup(`II. ${partnerRoleLabel}`)}
        </FormSection>

        <FormSection
          title={variantSection.title}
          variant={variantSection.variant}
          icon={<Scale className="w-4 h-4" />}
        >
          {renderGroup(variantSection.title)}
        </FormSection>

        <FormSection title="IV. 一般条項" variant="blue">
          {renderGroup('IV. 一般条項')}
        </FormSection>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ V. 特約 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">{renderGroup('V. 特約 (任意)')}</div>
        </details>
      </div>
    );
  }

  // Default Meta-driven dynamic form
  return (
    <div className="space-y-10">
      {(Object.entries(groupedVars) as [string, string[]][]).map(([groupName, varIds]) => (
        <FormSection key={groupName} title={groupName} variant="default" headerActions={<button onClick={onSync} className="text-[8px] font-mono bg-blue-600 text-white px-2 py-0.5 uppercase flex items-center gap-1"><Database className="w-2 h-2" /> Sync</button>}>
          {varIds.map(fid => renderField(fid))}
        </FormSection>
      ))}
    </div>
  );
};
