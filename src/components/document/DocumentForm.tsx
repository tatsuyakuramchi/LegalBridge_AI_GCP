
import React, { useMemo } from 'react';
import { FormSection } from './FormSection';
import { FormField } from './FormField';
import { PartySection, SubLicenseeTable } from './SpecializedParts';
import { TemplateMetadata } from './types';
import { Database, Building2, User, ShieldCheck, Scale, AlertCircle, Link, GitBranch, Briefcase } from 'lucide-react';
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

        {/* VI. 金銭条件 1 — primary, always shown */}
        <FormSection title="VI. 金銭条件 1 (自社製造)" variant="indigo">
          {renderGroup('VI. 金銭条件 1 (自社製造)')}
        </FormSection>

        {/* VII / VIII — advanced, collapsed by default */}
        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VII. 金銭条件 2 (サブライセンス, 任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">
            {renderGroup('VII. 金銭条件 2 (サブライセンス, 任意)')}
          </div>
        </details>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VIII. 金銭条件 3 (プロダクトアウト, 任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">
            {renderGroup('VIII. 金銭条件 3 (プロダクトアウト, 任意)')}
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
      setFormData({
        ...formData,
        VENDOR_NAME: activeVendor.vendor_name || '',
        VENDOR_ADDRESS: activeVendor.address || '',
        VENDOR_REPRESENTATIVE_SAMA: activeVendor.vendor_rep
          ? `${activeVendor.vendor_rep} 様`
          : '',
        VENDOR_CONTACT_DEPARTMENT: activeVendor.contact_department || '',
        VENDOR_CONTACT_NAME: activeVendor.contact_name || '',
        VENDOR_EMAIL: activeVendor.email || '',
        VENDOR_SUFFIX: isCorporation(activeVendor) ? '御中' : '様',
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

        {/* IV. 金額・納期 */}
        <FormSection title="IV. 金額・納期" variant="indigo" icon={<Scale className="w-4 h-4" />}>
          {renderGroup('IV. 金額・納期')}
        </FormSection>

        {/* V. 振込先 */}
        <FormSection
          title="V. 振込先 (取引先口座)"
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

  // Specialized Inspection Form
  if (templateId.startsWith('inspection_certificate')) {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <FormSection 
            title="Context & Basic (基本情報)" 
            variant="blue" 
            headerActions={<button onClick={onSync} className="text-[8px] font-mono bg-blue-600 text-white px-2 py-1 uppercase flex items-center gap-1"><Database className="w-2 h-2" /> Sync</button>}
          >
            {renderField('issueKey', '発注番号 (Issue Key)')}
            {renderField('itemNo', '明細番号')}
            {renderField('itemCount', '総明細数')}
            {renderField('deliveryNo', '今回の納品回数')}
            {renderField('totalDeliveries', '総予定回数')}
            {renderField('orderDate', '発注日')}
            {renderField('documentDate', '発行日 (検収書)')}
            {renderField('isPartial', '分割納品フラグ')}
          </FormSection>

          <FormSection 
            title="Counterparty (受託者情報)" 
            variant="amber" 
            headerActions={<button onClick={() => { if(activeVendor) setFormData({...formData, counterparty: activeVendor.vendor_name, counterpartyRepresentativeSama: (activeVendor.vendor_rep || activeVendor.contact_name) + ' 様', counterpartyTni: activeVendor.invoice_registration_number}); }} className="text-[8px] font-mono border border-orange-600 text-orange-600 px-2 py-1 uppercase">Master Sync</button>}
          >
            {renderField('counterparty', '受託者名')}
            {renderField('counterpartyRepresentativeSama', '代表者名 (＋様)')}
            {renderField('counterpartyTni', 'インボイス登録番号 (T-No)')}
          </FormSection>

          <FormSection 
            title="Internal (検収者情報)" 
            variant="emerald" 
            headerActions={<button onClick={() => { if(selectedStaff) setFormData({...formData, inspectorDept: selectedStaff.department, inspectorName: selectedStaff.staff_name}); }} className="text-[8px] font-mono border border-emerald-600 text-emerald-600 px-2 py-1 uppercase">Staff Sync</button>}
          >
            {renderField('inspectorDept', '検収者部署')}
            {renderField('inspectorName', '検収者名')}
            {renderField('deliveredAt', '実納品日')}
            {renderField('inspectionCompletedAt', '検収完了日')}
            {renderField('paymentDueDate', '支払期日')}
          </FormSection>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <FormSection 
            title="Deliverable Detail (納品明細)" 
            variant="emerald" 
            headerActions={onLinkAsset && <button onClick={() => onLinkAsset((asset) => setFormData({...formData, linked_po_number: asset.asset_number, linked_po_link: asset.file_link}))} className="text-[8px] font-mono border border-emerald-600 text-emerald-600 px-2 py-0.5 uppercase flex items-center gap-1"><Link className="w-2 h-2" /> PO紐付</button>}
          >
            <div className="col-span-full space-y-4">
              {renderField('description', '成果物・業務内容')}
              {renderField('spec', '仕様・内容詳細')}
              <div className="grid grid-cols-2 gap-6 bg-white/50 p-4 rounded-sm border border-emerald-600/10">
                {['deliveredAmountStr', 'taxRate', 'taxAmountStr', 'totalAmountStr'].map(f => renderField(f))}
              </div>
            </div>
          </FormSection>

          <FormSection title="Financial & Progress (進捗・財務)" variant="indigo">
             {['inspectedPct', 'inspectedAmountStr', 'totalOrderAmountStr', 'pendingAmountStr', 'paymentConditionSummary', 'bankName', 'branchName', 'accountType', 'accountNo', 'accountHolder'].map(f => renderField(f))}
          </FormSection>
        </div>

        <FormSection title="Excel Export Data" variant="blue">
           <div className="col-span-full grid grid-cols-2 md:grid-cols-3 gap-6">
             {['件名', '支払日', '部署', '取引先コード', '氏名', '氏名（カナ）', '立替金', '小計', '源泉税', '税引後', '差引振込額'].map(f => renderField(f))}
           </div>
        </FormSection>
      </div>
    );
  }

  // Specialized Royalty Form
  if (templateId === 'royalty_statement') {
     return (
       <div className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
             <FormSection 
               title="Work & Contract (原案・契約)" 
               headerActions={
                 <>
                   {onLinkAsset && <button onClick={() => onLinkAsset((asset) => setFormData({...formData, linked_terms_number: asset.asset_number, linked_terms_link: asset.file_link}))} className="text-[8px] font-mono border border-blue-600 text-blue-600 px-2 py-1 uppercase flex items-center gap-1"><Link className="w-2 h-2" /> 個別紐付</button>}
                   <button onClick={onSync} className="text-[8px] font-mono bg-blue-600 text-white px-2 py-1 uppercase flex items-center gap-1"><Database className="w-2 h-2" /> Sync</button>
                 </>
               }
             >
                <div className="col-span-full space-y-4">
                  {['ledgerId', 'manufacturingIssueKey', 'licenseIssueKey'].map(f => renderField(f))}
                  <PartySection prefix="licensor" formData={formData} setFormData={setFormData} renderField={renderField} />
                  <PartySection prefix="licensee" formData={formData} setFormData={setFormData} renderField={renderField} />
                  {renderField('originalWork')}
                </div>
             </FormSection>
             <FormSection title="Manufacturing (製造情報)" headerActions={<button onClick={onSync} className="text-[8px] font-mono bg-blue-600 text-white px-2 py-1 uppercase">Sync</button>}>
                {['productName', 'edition', 'completionDate', 'quantity', 'sampleQuantity', 'billableQuantity', 'msrpStr'].map(f => renderField(f))}
             </FormSection>
          </div>
          <FormSection title="Royalty & MG Calculation (計算明細)" variant="indigo" headerActions={<button onClick={onSync} className="text-[8px] font-mono bg-indigo-600 text-white px-2 py-1 uppercase">Sync</button>}>
             {['calcType', 'royaltyRatePct', 'grossRoyaltyStr', 'mgAmount', 'mgRemaining', 'actualRoyaltyStr', 'taxRate', 'taxAmount', 'totalPaymentStr', 'paymentConditionSummary', 'reportingDeadline', 'paymentDueDate'].map(f => renderField(f))}
          </FormSection>
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
