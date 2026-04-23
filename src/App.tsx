import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Search, 
  Plus, 
  Trash2, 
  Building2, 
  User, 
  Users, 
  Scale, 
  Download, 
  Eye, 
  Loader2,
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Archive,
  RefreshCw,
  SearchCode,
  LayoutDashboard,
  Database,
  ChevronRight,
  ShieldCheck,
  Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { saveAs } from 'file-saver';

// --- Types ---
interface Vendor {
  vendor_code: string;
  vendor_name: string;
  trade_name?: string;
  address?: string;
  contact_name?: string;
  vendor_rep?: string;
}

interface Staff {
  slack_user_id: string;
  staff_name: string;
  department?: string;
  email?: string;
}

interface Issue {
  issueKey: string;
  summary: string;
  description: string;
}

interface ExternalAsset {
  id: string;
  asset_number: string;
  asset_name: string;
  asset_type: string;
  counterparty: string;
}

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<'create' | 'list'>('create');
  
  // Template & Fields
  const [selectedTemplate, setSelectedTemplate] = useState<string>('individual_license_terms');
  const [templateFields, setTemplateFields] = useState<string[]>([]);
  const [isRefreshingFields, setIsRefreshingFields] = useState(false);
  
  // Form State
  const [formData, setFormData] = useState<any>({
    サブライセンシー一覧: []
  });
  
  // External Data
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<string>('');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [companyProfile, setCompanyProfile] = useState<any>(null);
  
  // Selections
  const [activeVendor, setActiveVendor] = useState<Vendor | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  
  // UI State
  const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');
  const [assets, setAssets] = useState<ExternalAsset[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  // --- Fetch Initial Data ---
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [issuesRes, vendorsRes, staffRes, profileRes, assetsRes] = await Promise.all([
          fetch('/api/backlog/issues').then(r => r.json()),
          fetch('/api/master/vendors').then(r => r.json()),
          fetch('/api/master/staff').then(r => r.json()),
          fetch('/api/master/company-profile').then(r => r.json()),
          fetch('/api/management/assets').then(r => r.json())
        ]);
        
        setIssues(Array.isArray(issuesRes) ? issuesRes : []);
        setVendors(Array.isArray(vendorsRes) ? vendorsRes : []);
        setStaffList(Array.isArray(staffRes) ? staffRes : []);
        setCompanyProfile(profileRes);
        setAssets(Array.isArray(assetsRes) ? assetsRes : []);
      } catch (e) {
        console.error("Failed to fetch startup data", e);
      }
    };
    fetchData();
  }, []);

  // --- Fetch Template Fields ---
  useEffect(() => {
    const loadFields = async () => {
      if (!selectedTemplate) return;
      setIsRefreshingFields(true);
      try {
        const res = await fetch(`/api/templates/${selectedTemplate}/schema`);
        const data = await res.json();
        setTemplateFields(data.variables || []);
      } catch (e) {
        console.error("Failed to fetch template schema", e);
      } finally {
        setIsRefreshingFields(false);
      }
    };
    loadFields();
  }, [selectedTemplate]);

  // --- Helpers ---
  const handleIssueSelect = async (issueKey: string) => {
    setSelectedIssue(issueKey);
    const issue = issues.find(i => i.issueKey === issueKey);
    if (!issue) return;

    try {
      // Fetch context mapping if the server provides it
      const res = await fetch(`/api/backlog/issues/${issueKey}/form-context?template=${selectedTemplate}`);
      const context = await res.json();
      
      setFormData((prev: any) => ({
        ...prev,
        '基本契約名': issue.summary,
        'remarks': issue.description,
        ...context
      }));
    } catch (e) {
      console.warn("Failed to fetch context mapping", e);
      setFormData((prev: any) => ({
        ...prev,
        '基本契約名': issue.summary,
        'remarks': issue.description
      }));
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/documents/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueKey: selectedIssue || "MANUAL-" + Date.now(),
          templateType: selectedTemplate,
          formData,
          requesterEmail: selectedStaff?.email || "web-user"
        })
      });
      const data = await res.json();
      if (data.driveLink) {
        window.open(data.driveLink, '_blank');
      } else {
        alert("Generation completed, but no drive link was returned.");
      }
    } catch (e) {
      console.error("Generation failed", e);
      alert("Document generation failed. Please check the logs.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePreview = async () => {
    setIsPreviewing(true);
    setPreviewHtml(null);
    try {
      const res = await fetch('/api/documents/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateType: selectedTemplate,
          formData,
          issueKey: selectedIssue
        })
      });
      const data = await res.json();
      if (data.html) {
        setPreviewHtml(data.html);
      }
    } catch (e) {
      console.error("Preview failed", e);
    } finally {
      setIsPreviewing(false);
    }
  };

  const renderDynamicField = (field: string) => {
    const val = formData[field] || '';
    const label = field.replace(/^individual_license_terms_/, '').replace(/_/g, ' ');
    
    // Custom logic for specific fields
    const selectOptions: Record<string, string[]> = {
      '金銭条件1_計算方式': ['FIXED', 'SUBSCRIPTION', 'ROYALTY'],
      '金銭条件2_計算方式': ['FIXED', 'SUBSCRIPTION', 'ROYALTY'],
      '金銭条件3_計算方式': ['FIXED', 'SUBSCRIPTION', 'ROYALTY'],
      '金銭条件1_計算期間': ['製造時', '月次', '四半期', '半年', '年次'],
      '金銭条件2_計算期間': ['製造時', '月次', '四半期', '半年', '年次'],
      '金銭条件3_計算期間': ['製造時', '月次', '四半期', '半年', '年次'],
      '金銭条件1_通貨': ['JPY', 'USD', 'EUR', 'CNY'],
      '金銭条件2_通貨': ['JPY', 'USD', 'EUR', 'CNY'],
      '金銭条件3_通貨': ['JPY', 'USD', 'EUR', 'CNY'],
      '独占性': ['独占', '非独占'],
      '対象地域': ['日本国内', '全世界', '北米', '欧州'],
      '許諾言語': ['日本語', '英語', '各国語'],
      '販売地域': ['日本国内', '全世界', '北米', '欧州'],
      '販売言語': ['日本語', '英語', '各国語']
    };

    const isDate = field.includes('日') || field.includes('DATE') || field.includes('期限');
    const isTextarea = field.includes('本文') || field.includes('備考') || field.includes('REMARKS') || field.includes('特記');

    return (
      <div key={field} className="space-y-1 group">
        <label className="flex items-center gap-1.5 text-[9px] font-mono font-bold uppercase tracking-wider text-[#141414]/50 group-hover:text-blue-600 transition-colors">
          {label}
        </label>
        {selectOptions[field] ? (
          <select 
            value={val}
            onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
            className="w-full text-xs font-mono border-b border-[#141414]/20 bg-transparent py-1.5 focus:border-blue-600 focus:outline-none appearance-none"
          >
            <option value="">-- SELECT --</option>
            {selectOptions[field].map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        ) : isTextarea ? (
          <textarea 
            value={val}
            onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
            rows={2}
            className="w-full text-xs font-mono border border-[#141414]/10 bg-white/50 p-2 focus:border-blue-600 focus:outline-none resize-none"
            placeholder={`Enter ${label}...`}
          />
        ) : (
          <input 
            type={isDate ? 'date' : 'text'}
            value={val}
            onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
            className="w-full text-xs font-mono border-b border-[#141414]/20 bg-transparent py-1.5 focus:border-blue-600 focus:outline-none placeholder:text-gray-300"
            placeholder={isDate ? '' : `Input ${label}...`}
          />
        )}
      </div>
    );
  };

  // --- Render Sections ---
  return (
    <div className="min-h-screen bg-[#FDFDFD] text-[#141414] selection:bg-[#141414] selection:text-white pb-20">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-[#141414]/10 px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-[#141414] flex items-center justify-center">
            <FileText className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-sm font-mono font-bold tracking-tighter uppercase leading-none">Arcs - Legal OS</h1>
            <p className="text-[10px] text-[#141414]/50 font-mono tracking-widest uppercase mt-1">Contract Lifecycle Management</p>
          </div>
        </div>
        <div className="flex items-center gap-8">
          <nav className="flex gap-6">
            <button 
              onClick={() => setActiveTab('create')}
              className={`text-[10px] font-mono font-bold uppercase tracking-wider transition-all border-b-2 py-1 ${activeTab === 'create' ? 'border-[#141414] text-[#141414]' : 'border-transparent text-[#141414]/40 hover:text-[#141414]'}`}
            >
              Creation
            </button>
            <button 
              onClick={() => setActiveTab('list')}
              className={`text-[10px] font-mono font-bold uppercase tracking-wider transition-all border-b-2 py-1 ${activeTab === 'list' ? 'border-[#141414] text-[#141414]' : 'border-transparent text-[#141414]/40 hover:text-[#141414]'}`}
            >
              Archived
            </button>
          </nav>
          <div className="flex items-center gap-3 border-l border-[#141414]/10 pl-6">
             <div className="text-right">
                <p className="text-[9px] font-mono font-bold uppercase leading-none">Kuramochi Tatsuya</p>
                <p className="text-[8px] font-mono text-[#141414]/40 uppercase">System Administrator</p>
             </div>
             <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center font-mono text-xs font-bold">KT</div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 pt-8">
        <div className="grid grid-cols-12 gap-10">
          
          {/* Side Control Panel */}
          <aside className="col-span-12 lg:col-span-3 space-y-8">
            <div className="space-y-4">
               <div className="flex items-center gap-2 text-[#141414]/40">
                  <LayoutDashboard className="w-3 h-3" />
                  <h2 className="text-[10px] font-mono font-bold uppercase tracking-widest">Environment</h2>
               </div>
               <div className="bg-[#141414] text-white p-5 shadow-2xl space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-[8px] font-mono uppercase opacity-50 block">Backlog Sync Ticket</label>
                    <select 
                      value={selectedIssue}
                      onChange={(e) => handleIssueSelect(e.target.value)}
                      className="w-full bg-[#141414] border-b border-white/20 py-2 text-xs font-mono focus:outline-none focus:border-blue-400 appearance-none"
                    >
                      <option value="">-- ALL ACTIVE TICKETS --</option>
                      {issues.map(i => <option key={i.issueKey} value={i.issueKey}>[{i.issueKey}] {i.summary}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[8px] font-mono uppercase opacity-50 block">Output Blueprint</label>
                    <select 
                      value={selectedTemplate}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                      className="w-full bg-[#141414] border-b border-white/20 py-2 text-xs font-mono focus:outline-none focus:border-blue-400 appearance-none"
                    >
                      <optgroup label="Core Licenses & Terms">
                        <option value="individual_license_terms">Indiv. License Terms (個別許諾)</option>
                        <option value="license_master">License Master (ライセンス原簿)</option>
                        <option value="license_report">License Report (ライセンス報告書)</option>
                        <option value="royalty_statement">Royalty Output (利用許諾料計算)</option>
                      </optgroup>
                      <optgroup label="Contracts & Agreements">
                        <option value="contract">Standard Contract (基本契約)</option>
                        <option value="nda">NDA (秘密保持契約)</option>
                        <option value="service_master">Service Master (業務委託基本)</option>
                        <option value="service_terms">Service Terms (業務委託個別)</option>
                        <option value="intl_master">Intl. Master (海外基本契約)</option>
                        <option value="intl_amendment">Intl. Amendment (海外変更覚書)</option>
                      </optgroup>
                      <optgroup label="Sales & Purchase">
                        <option value="purchase_order">Purchase Order (発注書)</option>
                        <option value="planning_purchase_order">Planning PO (企画発注書)</option>
                        <option value="sales_master_standard">Sales Master (売買基本標準)</option>
                        <option value="sales_master_buyer">Sales Master Buyer (売買買主)</option>
                        <option value="sales_master_credit">Sales Master Credit (売買クレジット)</option>
                      </optgroup>
                      <optgroup label="Delivery & Payment">
                        <option value="inspection_certificate">Inspection Cert. (検収書)</option>
                        <option value="inspection_certificate_detailed">Inspection Detailed (検収書詳細)</option>
                        <option value="inspection_certificate_v2">Inspection v2 (検収書v2)</option>
                        <option value="fee_statement">Fee Statement (報酬明細書)</option>
                        <option value="payment_notice">Payment Notice (支払通知書)</option>
                        <option value="payment_notice_alt">Payment Notice Alt (支払通知書別案)</option>
                      </optgroup>
                      <optgroup label="Others">
                        <option value="legal_request">Legal Request (法務依頼書)</option>
                      </optgroup>
                    </select>
                  </div>
                  <button 
                    onClick={() => setIsAssetPickerOpen(true)}
                    className="w-full py-3 bg-white/10 text-[9px] font-mono font-bold uppercase tracking-widest hover:bg-white/20 transition-all flex items-center justify-center gap-2 mt-2 border border-white/5"
                  >
                    <SearchCode className="w-3 h-3" /> Search Legal Assets
                  </button>
               </div>
            </div>

            <div className="space-y-4">
               <div className="flex items-center gap-2 text-[#141414]/40">
                  <Database className="w-3 h-3" />
                  <h2 className="text-[10px] font-mono font-bold uppercase tracking-widest">Master Context</h2>
               </div>
               <div className="space-y-3">
                 <div className="bg-white border border-[#141414]/10 p-4 hover:border-[#141414]/40 transition-all group">
                    <div className="flex justify-between items-center mb-1">
                       <span className="text-[8px] font-mono font-bold uppercase text-[#141414]/40 group-hover:text-[#141414]">Internal Staff</span>
                       <Briefcase className="w-2.5 h-2.5 text-[#141414]/20" />
                    </div>
                    <select 
                      value={selectedStaff?.slack_user_id || ''}
                      onChange={(e) => setSelectedStaff(staffList.find(s => s.slack_user_id === e.target.value) || null)}
                      className="w-full text-xs font-mono border-none focus:ring-0 bg-transparent p-0"
                    >
                      <option value="">-- STAFF DB --</option>
                      {staffList.map(s => <option key={s.slack_user_id} value={s.slack_user_id}>{s.staff_name} ({s.department})</option>)}
                    </select>
                 </div>
                 <div className="bg-white border border-[#141414]/10 p-4 hover:border-[#141414]/40 transition-all group shadow-sm">
                    <div className="flex justify-between items-center mb-1">
                       <span className="text-[8px] font-mono font-bold uppercase text-[#141414]/40 group-hover:text-[#141414]">External Partner</span>
                       <Building2 className="w-2.5 h-2.5 text-[#141414]/20" />
                    </div>
                    <select 
                      value={activeVendor?.vendor_code || ''}
                      onChange={(e) => setActiveVendor(vendors.find(v => v.vendor_code === e.target.value) || null)}
                      className="w-full text-xs font-mono border-none focus:ring-0 bg-transparent p-0"
                    >
                      <option value="">-- VENDOR DB --</option>
                      {vendors.map(v => <option key={v.vendor_code} value={v.vendor_code}>{v.vendor_name}</option>)}
                    </select>
                 </div>
               </div>
            </div>
          </aside>

          {/* Core Editing Stage */}
          <section className="col-span-12 lg:col-span-9 space-y-8">
            <div className="bg-white border border-[#141414] shadow-[20px_20px_0px_0px_rgba(20,20,20,0.05)] relative">
               {/* Stage Header */}
               <div className="flex items-center justify-between p-5 border-b border-[#141414]/10 bg-[#FAFAFA]">
                 <div className="flex items-center gap-4">
                   <div className="w-8 h-8 bg-blue-600 text-white flex items-center justify-center">
                      <Archive className="w-4 h-4" />
                   </div>
                   <div>
                     <h2 className="text-xs font-mono font-bold uppercase tracking-widest">{selectedTemplate.replace(/_/g, ' ')} Editor</h2>
                     <p className="text-[9px] font-mono text-[#141414]/40 uppercase mt-0.5">Session UUID: {Math.random().toString(36).substr(2, 9)}</p>
                   </div>
                 </div>
                 <div className="flex gap-3">
                    <button 
                      onClick={() => setFormData({ サブライセンシー一覧: [] })}
                      className="px-4 py-1.5 border border-[#141414]/10 text-[9px] font-mono font-bold uppercase tracking-widest hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      Reset State
                    </button>
                 </div>
               </div>

               {/* Stage Workflow */}
               <div className="p-10">
                  {isRefreshingFields ? (
                    <div className="space-y-6">
                       {[1,2,3,4,5].map(i => (
                         <div key={i} className="h-6 bg-gray-100 animate-pulse w-full rounded" />
                       ))}
                    </div>
                  ) : (
                    <div className="space-y-12">
                      {selectedTemplate === 'individual_license_terms' ? (
                        <>
                          {/* Step 1: Legal Entities */}
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                            <div className="p-6 border border-blue-600/10 bg-blue-50/10 space-y-6 rounded-sm">
                               <div className="flex items-center justify-between border-b border-blue-600/10 pb-3">
                                  <div className="flex items-center gap-2.5">
                                     <Building2 className="w-4 h-4 text-blue-600" />
                                     <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest">I. Licensor (許諾者)</h3>
                                  </div>
                                  <div className="flex gap-2">
                                     <button 
                                       onClick={() => setFormData({
                                         ...formData,
                                         'Licensor_名称': companyProfile?.name,
                                         'Licensor_住所': companyProfile?.address,
                                         'Licensor_氏名会社名': companyProfile?.name,
                                         'Licensor_代表者名': companyProfile?.representative
                                       })}
                                       className="text-[8px] font-mono border border-blue-600/20 px-2 py-0.5 hover:bg-blue-600 hover:text-white transition-all uppercase"
                                     >Self</button>
                                     <button 
                                       onClick={() => {
                                         if (activeVendor) {
                                           setFormData({
                                             ...formData,
                                             'Licensor_名称': activeVendor.vendor_name,
                                             'Licensor_住所': activeVendor.address,
                                             'Licensor_氏名会社名': activeVendor.vendor_name,
                                             'Licensor_代表者名': activeVendor.vendor_rep || activeVendor.contact_name
                                           });
                                         }
                                       }}
                                       className="text-[8px] font-mono border border-blue-600/20 px-2 py-0.5 hover:bg-blue-600 hover:text-white transition-all uppercase"
                                     >Partner</button>
                                  </div>
                               </div>
                               <div className="grid grid-cols-1 gap-4">
                                  {['Licensor_名称', 'Licensor_住所', 'Licensor_氏名会社名', 'Licensor_代表者名'].map(renderDynamicField)}
                               </div>
                            </div>

                            <div className="p-6 border border-amber-600/10 bg-amber-50/10 space-y-6 rounded-sm">
                               <div className="flex items-center justify-between border-b border-amber-600/10 pb-3">
                                  <div className="flex items-center gap-2.5">
                                     <User className="w-4 h-4 text-amber-600" />
                                     <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest">II. Licensee (被許諾者)</h3>
                                  </div>
                                  <div className="flex gap-2">
                                     <button 
                                       onClick={() => setFormData({
                                         ...formData,
                                         'Licensee_名称': companyProfile?.name,
                                         'Licensee_住所': companyProfile?.address,
                                         'Licensee_氏名会社名': companyProfile?.name,
                                         'Licensee_代表者名': companyProfile?.representative
                                       })}
                                       className="text-[8px] font-mono border border-amber-600/20 px-2 py-0.5 hover:bg-amber-600 hover:text-white transition-all uppercase"
                                     >Self</button>
                                     <button 
                                       onClick={() => {
                                         if (activeVendor) {
                                           setFormData({
                                             ...formData,
                                             'Licensee_名称': activeVendor.vendor_name,
                                             'Licensee_住所': activeVendor.address,
                                             'Licensee_氏名会社名': activeVendor.vendor_name,
                                             'Licensee_代表者名': activeVendor.vendor_rep || activeVendor.contact_name
                                           });
                                         }
                                       }}
                                       className="text-[8px] font-mono border border-amber-600/20 px-2 py-0.5 hover:bg-amber-600 hover:text-white transition-all uppercase"
                                     >Partner</button>
                                  </div>
                               </div>
                               <div className="grid grid-cols-1 gap-4">
                                  {['Licensee_名称', 'Licensee_住所', 'Licensee_氏名会社名', 'Licensee_代表者名'].map(renderDynamicField)}
                               </div>
                            </div>
                          </div>

                          {/* Step 2: Product & Supervision */}
                          <div className="p-8 border border-emerald-600/10 bg-emerald-50/10 space-y-6">
                              <div className="flex items-center justify-between border-b border-emerald-600/10 pb-3">
                                 <div className="flex items-center gap-2.5">
                                   <ShieldCheck className="w-4 h-4 text-emerald-600" />
                                   <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest">III. Product Assets (対象素材・監修)</h3>
                                 </div>
                                 <button 
                                   onClick={() => {
                                     if (selectedStaff) {
                                       setFormData((p:any) => ({
                                         ...p,
                                         '監修者': selectedStaff.staff_name,
                                         'クレジット表示': `© Arclight / ${selectedStaff.staff_name}`
                                       }));
                                     }
                                   }}
                                   className="text-[8px] font-mono border border-emerald-600/20 px-4 py-1 hover:bg-emerald-600 hover:text-white transition-all"
                                 >Sync Selected Staff Info</button>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                {['監修者', 'クレジット表示', '素材番号', '素材名', '素材権利者'].map(renderDynamicField)}
                              </div>
                          </div>

                          {/* Step 3: Financial & Core Terms */}
                          <div className="space-y-10">
                            <div className="p-8 border border-[#141414]/10 bg-white space-y-8">
                               <div className="flex items-center gap-3 border-b pb-3 border-[#141414]/5">
                                  <Scale className="w-4 h-4 text-[#141414]/40" />
                                  <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#141414]">IV. Agreement Foundations (固有の情報)</h3>
                               </div>
                               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                 {['発行日', '契約書番号', '台帳ID', 'ライセンス種別名', '基本契約名', '許諾開始日', '許諾期間注記', '原著作物名', '原著作物補記', '対象製品予定名', '独占性', '対象地域', '許諾言語'].map(renderDynamicField)}
                               </div>
                            </div>

                            {/* Financial Modules */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                               <div className="p-6 border border-indigo-600/10 bg-indigo-50/10 space-y-6">
                                  <h4 className="text-[10px] font-mono font-bold uppercase text-indigo-900 border-b border-indigo-900/10 pb-2">3.1 Financial Condition: Domestic (自社)</h4>
                                  <div className="space-y-4">
                                     {['金銭条件1_計算方式', '金銭条件1_基準価格ラベル', '金銭条件1_計算期間', '金銭条件1_通貨', '金銭条件1_料率'].map(renderDynamicField)}
                                     <div className="pt-4 border-t border-indigo-900/10 space-y-4">
                                        {renderDynamicField('金銭条件1_計算式')}
                                        {renderDynamicField('金銭条件1_支払条件')}
                                     </div>
                                  </div>
                               </div>
                               <div className="p-6 border border-cyan-600/10 bg-cyan-50/10 space-y-6">
                                  <h4 className="text-[10px] font-mono font-bold uppercase text-cyan-900 border-b border-cyan-900/10 pb-2">3.2 Financial Condition: Sub-License (サブ)</h4>
                                  <div className="space-y-4">
                                     {['金銭条件2_計算方式', '金銭条件2_基準価格ラベル', '金銭条件2_計算期間', '金銭条件2_通貨', '金銭条件2_料率'].map(renderDynamicField)}
                                     <div className="pt-4 border-t border-cyan-900/10 space-y-4">
                                        {renderDynamicField('金銭条件2_計算式')}
                                        {renderDynamicField('金銭条件2_支払条件')}
                                     </div>
                                  </div>
                               </div>
                            </div>
                          </div>

                          {/* Step 4: Final Provisions */}
                          <div className="p-8 border border-red-600/10 bg-red-50/5">
                             <div className="flex items-center gap-3 border-b border-red-100 pb-3 mb-6">
                                <AlertCircle className="w-4 h-4 text-red-600" />
                                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#141414]">V. Special Exceptions & Remarks (特記事項)</h3>
                             </div>
                             {renderDynamicField('特記事項_本文')}
                          </div>

                          {/* Sub-licensee Multi-Item Context */}
                          <div className="p-8 border border-[#141414]/10 bg-[#FAFAFA] space-y-8">
                             <div className="flex items-center justify-between border-b border-[#141414]/10 pb-3">
                                <div className="flex items-center gap-3">
                                   <GitBranch className="w-4 h-4 text-[#141414]/60" />
                                   <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#141414]">VI. Entity Relations (サブライセンシー一覧)</h3>
                                </div>
                                <button 
                                  onClick={() => {
                                    const newList = [...(formData.サブライセンシー一覧 || [])];
                                    newList.push({ id: Date.now(), 区分: '製造販売', 名称: '', 地域: '', 言語: '', 金銭条件: '', MGAG: '', 料率: '', 備考: '' });
                                    setFormData({...formData, サブライセンシー一覧: newList });
                                  }}
                                  className="px-5 py-2 bg-[#141414] text-white text-[10px] font-mono uppercase tracking-widest hover:invert transition-all flex items-center gap-2"
                                >
                                  <Plus className="w-3.5 h-3.5" /> Append Entity
                                </button>
                             </div>
                             
                             <div className="grid grid-cols-1 gap-6">
                               {(formData.サブライセンシー一覧 || []).map((item: any, idx: number) => (
                                 <div key={item.id} className="bg-white border border-[#141414]/10 p-6 shadow-sm relative group">
                                    <button 
                                      onClick={() => {
                                        const newList = [...formData.サブライセンシー一覧];
                                        newList.splice(idx, 1);
                                        setFormData({...formData, サブライセンシー一覧: newList });
                                      }}
                                      className="absolute -right-3 -top-3 w-7 h-7 bg-red-600 text-white rounded-full flex items-center justify-center shadow-xl opacity-0 hover:scale-110 group-hover:opacity-100 transition-all z-10"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6 pb-6 border-b border-dashed border-gray-100">
                                       <div className="space-y-1.5">
                                          <label className="text-[8px] font-mono uppercase opacity-40">Classification</label>
                                          <select 
                                            value={item.区分} 
                                            onChange={(e) => {
                                              const newList = [...formData.サブライセンシー一覧];
                                              newList[idx].区分 = e.target.value;
                                              setFormData({...formData, サブライセンシー一覧: newList});
                                            }}
                                            className="w-full text-xs font-mono border-b border-[#141414]/20 py-2 bg-transparent focus:outline-none"
                                          >
                                            <option value="製造販売">製造販売</option>
                                            <option value="翻訳出版">翻訳出版</option>
                                            <option value="デジタル">デジタル</option>
                                          </select>
                                       </div>
                                       <div className="md:col-span-2 space-y-1.5">
                                          <label className="text-[8px] font-mono uppercase opacity-40">Partner 名称</label>
                                          <input 
                                            type="text"
                                            value={item.名称}
                                            onChange={(e) => {
                                              const newList = [...formData.サブライセンシー一覧];
                                              newList[idx].名称 = e.target.value;
                                              setFormData({...formData, サブライセンシー一覧: newList});
                                            }}
                                            className="w-full text-xs font-mono border-b border-[#141414]/20 py-2 bg-transparent focus:outline-none placeholder:text-gray-200"
                                            placeholder="Enter Legal Name..."
                                          />
                                       </div>
                                       <div className="space-y-1.5">
                                          <label className="text-[8px] font-mono uppercase opacity-40">Region / Lang</label>
                                          <div className="flex gap-2">
                                            <input 
                                              type="text" value={item.地域}
                                              onChange={(e) => {
                                                const newList = [...formData.サブライセンシー一覧];
                                                newList[idx].地域 = e.target.value;
                                                setFormData({...formData, サブライセンシー一覧: newList});
                                              }}
                                              className="w-1/2 text-xs font-mono border-b border-[#141414]/20 py-2 bg-transparent focus:outline-none"
                                              placeholder="Region"
                                            />
                                            <input 
                                              type="text" value={item.言語}
                                              onChange={(e) => {
                                                const newList = [...formData.サブライセンシー一覧];
                                                newList[idx].言語 = e.target.value;
                                                setFormData({...formData, サブライセンシー一覧: newList});
                                              }}
                                              className="w-1/2 text-xs font-mono border-b border-[#141414]/20 py-2 bg-transparent focus:outline-none"
                                              placeholder="Lang"
                                            />
                                          </div>
                                       </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                       {['金銭条件', 'MGAG', '料率', '備考'].map(subField => (
                                          <div key={subField} className="space-y-1.5">
                                             <label className="text-[8px] font-mono uppercase opacity-40">{subField}</label>
                                             <input 
                                               type="text"
                                               value={item[subField]}
                                               onChange={(e) => {
                                                 const newList = [...formData.サブライセンシー一覧];
                                                 newList[idx][subField] = e.target.value;
                                                 setFormData({...formData, サブライセンシー一覧: newList});
                                               }}
                                               className="w-full text-xs font-mono border-b border-[#141414]/20 py-2 bg-transparent focus:outline-none"
                                             />
                                          </div>
                                       ))}
                                    </div>
                                 </div>
                               ))}
                             </div>
                          </div>
                        </>
                      ) : (
                        /* Standard Template Grid */
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-10">
                          {templateFields.map(renderDynamicField)}
                        </div>
                      )}
                    </div>
                  )}
               </div>

               {/* Stage Actions */}
               <footer className="p-8 bg-[#F9F9F9] border-t border-[#141414]/10 flex flex-col md:flex-row justify-between items-center gap-8">
                  <div className="flex gap-10">
                     <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <div>
                           <p className="text-[9px] font-mono font-bold uppercase leading-none">Draft Valid</p>
                           <p className="text-[8px] font-mono text-[#141414]/40 uppercase">Ready for Sync</p>
                        </div>
                     </div>
                     <div className="flex items-center gap-3 opacity-50 grayscale hover:grayscale-0 transition-all cursor-help">
                        <RefreshCw className="w-4 h-4 text-blue-600" />
                        <div>
                           <p className="text-[9px] font-mono font-bold uppercase leading-none">Live Syncing</p>
                           <p className="text-[8px] font-mono text-[#141414]/40 uppercase">Backlog V2.0</p>
                        </div>
                     </div>
                  </div>
                  <div className="flex gap-4 w-full md:w-auto">
                     <button 
                       onClick={handlePreview}
                       disabled={isPreviewing}
                       className="flex-1 md:flex-none px-10 py-3.5 border border-[#141414] text-[#141414] text-[11px] font-mono font-bold uppercase tracking-widest hover:bg-[#141414] hover:text-white transition-all flex items-center justify-center gap-2 group"
                     >
                       {isPreviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4 group-hover:scale-110 transition-transform" />}
                       Preview Stage
                     </button>
                     <button 
                       onClick={handleGenerate}
                       disabled={isGenerating}
                       className="flex-1 md:flex-none px-10 py-3.5 bg-[#141414] text-white text-[11px] font-mono font-bold uppercase tracking-widest hover:invert transition-all flex items-center justify-center gap-3 disabled:opacity-50 shadow-xl"
                     >
                       {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                       Finalize & Sync
                     </button>
                  </div>
               </footer>
            </div>
          </section>
        </div>
      </main>

      {/* Repository List Tab (Placeholder) */}
      <AnimatePresence>
        {activeTab === 'list' && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed inset-0 top-[65px] bg-[#FDFDFD] z-40 p-12 overflow-y-auto"
          >
             <div className="max-w-6xl mx-auto space-y-8">
                <div className="flex justify-between items-end">
                   <div>
                      <h2 className="text-xl font-mono font-bold uppercase tracking-tighter">Archived Repository</h2>
                      <p className="text-xs font-mono text-[#141414]/50 border-l-2 border-[#141414] pl-4 mt-2 uppercase">Immutable record of all legal artifacts generated through Arcs OS.</p>
                   </div>
                   <div className="flex gap-4">
                      <div className="relative">
                         <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#141414]/30" />
                         <input className="bg-gray-100 border-none pl-10 pr-4 py-2 text-xs font-mono w-64" placeholder="FILTER ARCHIVE..." />
                      </div>
                   </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                   {assets.map(asset => (
                     <div key={asset.id} className="p-6 border border-[#141414]/10 bg-white group hover:border-[#141414] transition-all cursor-pointer">
                        <div className="flex justify-between items-start mb-6">
                           <div className="w-10 h-10 bg-gray-100 flex items-center justify-center group-hover:bg-[#141414] group-hover:text-white transition-all">
                              <Archive className="w-5 h-5" />
                           </div>
                           <span className="text-[8px] font-mono font-bold border border-[#141414]/10 px-2 py-0.5 uppercase">{asset.asset_type}</span>
                        </div>
                        <h4 className="text-sm font-mono font-bold truncate">{asset.asset_name}</h4>
                        <div className="mt-4 space-y-1.5 opacity-40">
                           <p className="text-[10px] font-mono uppercase">Ref: {asset.asset_number}</p>
                           <p className="text-[10px] font-mono uppercase">With: {asset.counterparty}</p>
                        </div>
                        <div className="mt-8 pt-4 border-t border-dashed border-gray-100 flex justify-between items-center group-hover:border-[#141414]/20">
                           <span className="text-[8px] font-mono uppercase tracking-widest text-emerald-600 font-bold">SECURED</span>
                           <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all translate-x-[-10px] group-hover:translate-x-0" />
                        </div>
                     </div>
                   ))}
                </div>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Asset Picker Overlay */}
      <AnimatePresence>
        {isAssetPickerOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#FDFDFD]/90 backdrop-blur-sm"
              onClick={() => setIsAssetPickerOpen(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              className="w-full max-w-3xl bg-white border border-[#141414] shadow-[40px_40px_0px_0px_rgba(20,20,20,0.1)] z-10 overflow-hidden"
            >
              <div className="px-6 py-4 bg-[#141414] text-white flex items-center justify-between">
                 <div className="flex items-center gap-3">
                    <SearchCode className="w-5 h-5 text-blue-400" />
                    <h3 className="text-xs font-mono font-bold uppercase tracking-widest">Legal Database Search</h3>
                 </div>
                 <button onClick={() => setIsAssetPickerOpen(false)} className="hover:rotate-90 transition-transform p-1">
                   <Plus className="w-5 h-5 rotate-45" />
                 </button>
              </div>
              <div className="p-8 space-y-8">
                 <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#141414]/20" />
                    <input 
                      type="text"
                      className="w-full bg-gray-50 p-4 pl-12 text-sm font-mono focus:outline-none border-b-2 border-transparent focus:border-blue-600 transition-all placeholder:text-gray-300"
                      placeholder="ENTER CONTRACT NO, LEDGER ID, OR PARTNER NAME..."
                      value={assetSearch}
                      onChange={(e) => setAssetSearch(e.target.value)}
                      autoFocus
                    />
                 </div>
                 
                 <div className="border border-[#141414]/10 bg-white">
                    <div className="grid grid-cols-4 bg-gray-50 p-3 text-[9px] font-mono font-bold uppercase border-b border-[#141414]/10">
                       <div className="col-span-1">Identity</div>
                       <div className="col-span-2">Reference / Context</div>
                       <div className="text-right">Operation</div>
                    </div>
                    <div className="max-h-[400px] overflow-y-auto divide-y divide-gray-50">
                       {assets
                         .filter(a => a.asset_number.includes(assetSearch) || a.asset_name.toLowerCase().includes(assetSearch.toLowerCase()) || a.counterparty.toLowerCase().includes(assetSearch.toLowerCase()))
                         .map(asset => (
                           <div key={asset.id} className="grid grid-cols-4 p-4 text-[11px] items-center hover:bg-blue-50/50 group transition-colors">
                              <div className="font-bold flex items-center gap-3">
                                 <Archive className={`w-4 h-4 ${asset.asset_type === 'ledger' ? 'text-blue-500' : 'text-indigo-500'}`} />
                                 <span className="font-mono tracking-tighter">{asset.asset_number}</span>
                              </div>
                              <div className="col-span-2">
                                 <p className="font-mono text-[#141414] leading-none mb-1">{asset.asset_name}</p>
                                 <p className="text-[9px] font-mono text-[#141414]/40 uppercase italic">{asset.counterparty}</p>
                              </div>
                              <div className="text-right">
                                 <button 
                                   onClick={() => {
                                     // Logic for multi-field autofill
                                     const update: any = {};
                                     if (asset.asset_type === 'contract' || asset.asset_number.startsWith('AL-') || asset.asset_number.startsWith('C-')) {
                                       update['契約書番号'] = asset.asset_number;
                                       update['基本契約名'] = asset.asset_name;
                                     } else {
                                       update['台帳ID'] = asset.asset_number;
                                       update['原著作物名'] = asset.asset_name;
                                     }
                                     setFormData((prev:any) => ({...prev, ...update}));
                                     setIsAssetPickerOpen(false);
                                   }}
                                   className="px-4 py-1 border border-[#141414]/10 group-hover:bg-[#141414] group-hover:text-white transition-all font-mono text-[9px] font-bold"
                                 >
                                   SELECT
                                 </button>
                              </div>
                           </div>
                         ))}
                       {assets.length === 0 && (
                         <div className="p-12 text-center opacity-30 font-mono text-xs uppercase italic tracking-widest">
                           Index retrieval failed or no assets matched
                         </div>
                       )}
                    </div>
                 </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Preview Modal */}
      <AnimatePresence>
        {previewHtml && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#FDFDFD]/95 backdrop-blur-xl"
              onClick={() => setPreviewHtml(null)}
            />
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              className="w-full max-w-5xl h-full bg-white border border-[#141414] shadow-2xl z-10 flex flex-col"
            >
              <div className="p-4 bg-[#141414] text-white flex justify-between items-center">
                 <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest">Visual Consistency Check</h3>
                 <button onClick={() => setPreviewHtml(null)} className="hover:rotate-90 transition-transform">
                    <Plus className="w-5 h-5 rotate-45" />
                 </button>
              </div>
              <div className="flex-1 overflow-auto p-12 bg-gray-100">
                 <div 
                   className="bg-white shadow-2xl mx-auto p-12 min-h-full prose max-w-none"
                   dangerouslySetInnerHTML={{ __html: previewHtml }}
                 />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
