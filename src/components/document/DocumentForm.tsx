
import React, { useMemo } from 'react';
import { FormSection } from './FormSection';
import { FormField } from './FormField';
import { PartySection, SubLicenseeTable } from './SpecializedParts';
import { TemplateMetadata } from './types';
import { Database, Building2, User, ShieldCheck, Scale, AlertCircle, Link, GitBranch } from 'lucide-react';

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

  // Logic for individual license terms specialized UI
  if (templateId === 'individual_license_terms') {
    return (
      <div className="space-y-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection 
            title="I. Licensor (許諾者)" 
            variant="blue" 
            icon={<Building2 className="w-4 h-4" />}
            headerActions={
              <>
                <button onClick={onSync} className="text-[8px] font-mono bg-blue-600 text-white px-2 py-0.5 uppercase flex items-center gap-1"><Database className="w-2 h-2" /> Sync</button>
                <button onClick={() => setFormData({ ...formData, Licensor_名称: companyProfile?.name, Licensor_住所: companyProfile?.address, Licensor_代表者名: companyProfile?.representative })} className="text-[8px] font-mono border border-blue-600/20 px-2 py-0.5 uppercase">Self</button>
              </>
            }
          >
            <div className="col-span-full">
              <PartySection prefix="Licensor" formData={formData} setFormData={setFormData} renderField={renderField} />
            </div>
          </FormSection>

          <FormSection 
            title="II. Licensee (被許諾者)" 
            variant="amber" 
            icon={<User className="w-4 h-4" />}
            headerActions={
              <>
                <button onClick={onSync} className="text-[8px] font-mono bg-amber-600 text-white px-2 py-0.5 uppercase flex items-center gap-1"><Database className="w-2 h-2" /> Sync</button>
                <button 
                  onClick={() => {
                    if (activeVendor) {
                      setFormData({ ...formData, Licensee_名称: activeVendor.vendor_name, Licensee_住所: activeVendor.address, Licensee_代表者名: activeVendor.vendor_rep || activeVendor.contact_name });
                    }
                  }} 
                  className="text-[8px] font-mono border border-amber-600/20 px-2 py-0.5 uppercase"
                >Partner</button>
              </>
            }
          >
            <div className="col-span-full">
              <PartySection prefix="Licensee" formData={formData} setFormData={setFormData} renderField={renderField} />
            </div>
          </FormSection>
        </div>

        <FormSection 
          title="III. Product Assets (対象素材・監修)" 
          variant="emerald" 
          icon={<ShieldCheck className="w-4 h-4" />}
          headerActions={
            <button onClick={() => {
              if (selectedStaff) {
                setFormData({ ...formData, '監修者': selectedStaff.staff_name, 'クレジット表示': `© Arclight / ${selectedStaff.staff_name}` });
              }
            }} className="text-[8px] font-mono border border-emerald-600/20 px-4 py-1 uppercase">Sync Staff</button>
          }
        >
          {['監修者', 'クレジット表示', '素材番号', '素材名', '素材権利者'].map(fid => renderField(fid))}
        </FormSection>

        <FormSection 
          title="IV. Agreement Foundations (固有の情報)" 
          variant="default" 
          icon={<Scale className="w-4 h-4" />}
        >
          {['発行日', '契約書番号', '台帳ID', 'ライセンス種別名', '基本契約名', '許諾開始日', '許諾期間注記', '原著作物名', '原著作物補記', '対象製品予定名', '独占性', '対象地域', '許諾言語'].map(fid => renderField(fid))}
        </FormSection>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <FormSection title="3.1 Financial Condition: Domestic (自社)" variant="indigo">
            {['金銭条件1_計算方式', '金銭条件1_基準価格ラベル', '金銭条件1_計算期間', '金銭条件1_通貨', '金銭条件1_料率', '金銭条件1_計算式', '金銭条件1_支払条件'].map(fid => renderField(fid))}
          </FormSection>
          <FormSection title="3.2 Financial Condition: Sub-License (サブ)" variant="cyan">
            {['金銭条件2_計算方式', '金銭条件2_基準価格ラベル', '金銭条件2_計算期間', '金銭条件2_通貨', '金銭条件2_料率', '金銭条件2_計算式', '金銭条件2_支払条件'].map(fid => renderField(fid))}
          </FormSection>
        </div>

        <FormSection title="V. Special Exceptions & Remarks (特記事項)" variant="red" icon={<AlertCircle className="w-4 h-4" />}>
          <div className="col-span-full">
            {renderField('特記事項_本文')}
          </div>
        </FormSection>

        <SubLicenseeTable formData={formData} setFormData={setFormData} />
      </div>
    );
  }

  // Specialized Purchase Order Form
  if (templateId === 'purchase_order') {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <FormSection 
            title="Overview & Vendor (発注概要と宛先)" 
            variant="blue" 
            icon={<Building2 className="w-4 h-4" />}
            headerActions={<button onClick={onSync} className="text-[8px] font-mono bg-blue-600 text-white px-2 py-1 uppercase flex items-center gap-1"><Database className="w-2 h-2" /> Sync</button>}
          >
            <div className="col-span-full space-y-4">
              {renderField('ORDER_NO', '発注番号')}
              <div className="grid grid-cols-3 gap-2">
                {renderField('ORDER_DATE_YEAR', '年')}
                {renderField('ORDER_DATE_MONTH', '月')}
                {renderField('ORDER_DATE_DAY', '日')}
              </div>
              {renderField('PROJECT_TITLE', '件名')}
              <div className="border-t border-blue-600/10 pt-4">
                <PartySection prefix="VENDOR" formData={formData} setFormData={setFormData} renderField={renderField} />
                {renderField('VENDOR_SUFFIX', '敬称 (御中など)')}
                {renderField('VENDOR_EMAIL', 'E-mail')}
              </div>
            </div>
          </FormSection>

          <FormSection 
            title="Issuer & Summary (発注元と条件要約)" 
            variant="emerald" 
            icon={<User className="w-4 h-4" />}
            headerActions={<button onClick={() => { if(selectedStaff) setFormData({...formData, STAFF_NAME: selectedStaff.staff_name, STAFF_DEPARTMENT: selectedStaff.department, STAFF_EMAIL: selectedStaff.email}); }} className="text-[8px] font-mono border border-emerald-600 text-emerald-600 px-2 py-1 uppercase">Staff Sync</button>}
          >
            <div className="col-span-full space-y-4">
               {['PARTY_A_NAME', 'PARTY_A_ADDRESS', 'PARTY_A_REP'].map(f => renderField(f))}
               <div className="border-t border-emerald-600/10 pt-4 grid grid-cols-2 gap-4">
                  {['STAFF_NAME', 'STAFF_DEPARTMENT', 'STAFF_PHONE', 'STAFF_EMAIL'].map(f => renderField(f))}
               </div>
               <div className="border-t border-emerald-600/10 pt-4 bg-gray-50 p-3 rounded">
                  {renderField('grandTotalExTax', '合計金額 (税抜)')}
                  {renderField('summaryDeliveryDate', '納期')}
                  {renderField('summaryPaymentTerms', '支払条件')}
               </div>
            </div>
          </FormSection>
        </div>

        <FormSection title="Terms & Bank (特約・備考・支払先)" variant="indigo">
          <div className="col-span-full space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {renderField('SPECIAL_TERMS', '特約事項')}
              {renderField('REMARKS_FREE', '備考')}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-indigo-50 p-4 rounded border border-indigo-100">
              {['BANK_NAME', 'BRANCH_NAME', 'ACCOUNT_TYPE', 'ACCOUNT_NUMBER', 'ACCOUNT_HOLDER_KANA', 'INVOICE_REGISTRATION_NUMBER', 'TRANSFER_FEE_PAYER'].map(f => renderField(f))}
            </div>
          </div>
        </FormSection>

        <FormSection title="Agreement & Sign Options (契約・署名設定)" variant="default">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2">
                {renderField('HAS_BASE_CONTRACT', '基本契約あり')}
                {formData.HAS_BASE_CONTRACT && renderField('MASTER_CONTRACT_REF', '基本契約名/番号')}
              </div>
              <div className="space-y-2">
                {renderField('SHOW_ORDER_SIGN_SECTION', '発注署名欄を表示')}
                {renderField('ACCEPT_METHOD', '承認/受領方法')}
              </div>
           </div>
        </FormSection>
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
