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
  Briefcase,
  ArrowRight,
  Calendar
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
  const [activeTab, setActiveTab] = useState<'create' | 'list' | 'search' | 'master' | 'templates'>('create');
  
  // Backlog Search
  const [issueSearchTerm, setIssueSearchTerm] = useState('');

  // Template Management
  const [templateList, setTemplateList] = useState<string[]>([]);
  const [templateMetadata, setTemplateMetadata] = useState<any>({});
  
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
  const [caseHistory, setCaseHistory] = useState<any[]>([]);

  // Handle automatic calculations based on formulas
  useEffect(() => {
    if (!selectedTemplate || !templateMetadata[selectedTemplate]?.vars) return;

    const vars = templateMetadata[selectedTemplate].vars;
    let hasChanges = false;
    const newFormData = { ...formData };

    Object.entries(vars).forEach(([field, meta]: [string, any]) => {
      if (meta.formula) {
        try {
          // Replace placeholders like {field} with actual values
          let expr = meta.formula.replace(/\{([^}]+)\}/g, (_: string, key: string) => {
            const val = formData[key] || "0";
            return String(val).replace(/,/g, ""); 
          });

          // Basic evaluation using Function (safe for simple math like +, -, *, /)
          // eslint-disable-next-line no-new-func
          const result = new Function(`return ${expr}`)();
          
          if (result !== undefined && !isNaN(result) && String(result) !== String(formData[field])) {
            newFormData[field] = String(result);
            hasChanges = true;
          }
        } catch (e) {
          // Silent fail on formula error during typing
        }
      }
    });

    if (hasChanges) {
      setFormData(newFormData);
    }
  }, [formData, selectedTemplate, templateMetadata]);

  // --- Fetch Initial Data ---
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [issuesRes, vendorsRes, staffRes, profileRes, assetsRes, templatesRes, metaRes] = await Promise.all([
          fetch('/api/backlog/issues').then(r => r.json()),
          fetch('/api/master/vendors').then(r => r.json()),
          fetch('/api/master/staff').then(r => r.json()),
          fetch('/api/master/company-profile').then(r => r.json()),
          fetch('/api/management/assets').then(r => r.json()),
          fetch('/api/templates').then(r => r.json()),
          fetch('/api/templates/config/metadata').then(r => r.json())
        ]);
        
        setIssues(Array.isArray(issuesRes) ? issuesRes : []);
        setVendors(Array.isArray(vendorsRes) ? vendorsRes : []);
        setStaffList(Array.isArray(staffRes) ? staffRes : []);
        setCompanyProfile(profileRes);
        setAssets(Array.isArray(assetsRes) ? assetsRes : []);
        setTemplateList(Array.isArray(templatesRes) ? templatesRes : []);
        setTemplateMetadata(metaRes || {});
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
  const syncFromDatabase = async (issueKeyToUse?: string) => {
    const key = issueKeyToUse || selectedIssue;
    if (!key) {
      alert("Please select a Backlog ticket first.");
      return;
    }

    const issue = issues.find(i => i.issueKey === key);
    
    try {
      const res = await fetch(`/api/backlog/issues/${key}/form-context?template=${selectedTemplate}`);
      const context = await res.json();
      
      setFormData((prev: any) => ({
        ...prev,
        '基本契約名': issue?.summary || prev['基本契約名'],
        'remarks': issue?.description || prev['remarks'],
        ...context
      }));
    } catch (e) {
      console.warn("Failed to fetch context mapping", e);
      if (issue) {
        setFormData((prev: any) => ({
          ...prev,
          '基本契約名': issue.summary,
          'remarks': issue.description
        }));
      }
    }
  };

  const handleIssueSelect = async (issueKey: string) => {
    setSelectedIssue(issueKey);
    await syncFromDatabase(issueKey);
    fetch(`/api/backlog/issues/${issueKey}/history`)
      .then(r => r.json())
      .then(d => setCaseHistory(d))
      .catch(e => console.error("History fetch error:", e));
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
    const fieldMeta = (templateMetadata[selectedTemplate]?.vars || {})[field] || {};
    const label = fieldMeta.label || field.replace(/^individual_license_terms_/, '').replace(/_/g, ' ');
    const val = formData[field] || '';
    
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
      '販売言語': ['日本語', '英語', '各国語'],
      'taxRate': ['10', '8']
    };

    const isDate = fieldMeta.type === 'date' || field.includes('日') || field.includes('DATE') || field.includes('期限');
    const isTextarea = fieldMeta.type === 'textarea' || field.includes('本文') || field.includes('備考') || field.includes('REMARKS') || field.includes('特記');
    const isBoolean = fieldMeta.type === 'boolean' || field.startsWith('is') || field.includes('フラグ');
    const isNumber = fieldMeta.type === 'number';

    return (
      <div key={field} className="space-y-1 group">
        <label className="flex items-center gap-1.5 text-[9px] font-mono font-bold uppercase tracking-wider text-[#141414]/50 group-hover:text-blue-600 transition-colors">
          {label}
        </label>
        {isBoolean ? (
          <div className="flex items-center gap-4 py-1.5">
            <button 
              onClick={() => setFormData({ ...formData, [field]: true })}
              className={`text-[10px] font-mono px-3 py-1 border transition-all ${val === true ? 'bg-[#141414] text-white' : 'border-[#141414]/10 opacity-50'}`}
            >TRUE</button>
            <button 
              onClick={() => setFormData({ ...formData, [field]: false })}
              className={`text-[10px] font-mono px-3 py-1 border transition-all ${val === false ? 'bg-[#141414] text-white' : 'border-[#141414]/10 opacity-50'}`}
            >FALSE</button>
          </div>
        ) : selectOptions[field] ? (
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
            type={isDate ? 'date' : isNumber ? 'number' : 'text'}
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
              onClick={() => setActiveTab('search')}
              className={`text-[10px] font-mono font-bold uppercase tracking-wider transition-all border-b-2 py-1 ${activeTab === 'search' ? 'border-[#141414] text-[#141414]' : 'border-transparent text-[#141414]/40 hover:text-[#141414]'}`}
            >
              Backlog Search
            </button>
            <button 
              onClick={() => setActiveTab('list')}
              className={`text-[10px] font-mono font-bold uppercase tracking-wider transition-all border-b-2 py-1 ${activeTab === 'list' ? 'border-[#141414] text-[#141414]' : 'border-transparent text-[#141414]/40 hover:text-[#141414]'}`}
            >
              Archived
            </button>
            <button 
              onClick={() => setActiveTab('master')}
              className={`text-[10px] font-mono font-bold uppercase tracking-wider transition-all border-b-2 py-1 ${activeTab === 'master' ? 'border-[#141414] text-[#141414]' : 'border-transparent text-[#141414]/40 hover:text-[#141414]'}`}
            >
              Master Settings
            </button>
            <button 
              onClick={() => setActiveTab('templates')}
              className={`text-[10px] font-mono font-bold uppercase tracking-wider transition-all border-b-2 py-1 ${activeTab === 'templates' ? 'border-[#141414] text-[#141414]' : 'border-transparent text-[#141414]/40 hover:text-[#141414]'}`}
            >
              Templates
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
        {activeTab === 'create' && (
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
                      <option value="">-- SELECT BLUEPRINT --</option>
                      {(() => {
                        const categories = [...new Set(templateList.map(t => templateMetadata[t]?.category || 'General'))];
                        return categories.map(cat => (
                          <optgroup key={cat} label={cat}>
                            {templateList
                              .filter(t => (templateMetadata[t]?.category || 'General') === cat)
                              .map(t => (
                                <option key={t} value={t}>
                                  {templateMetadata[t]?.label || t.replace(/_/g, ' ')} ({t})
                                </option>
                              ))
                            }
                          </optgroup>
                        ));
                      })()}
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

            {selectedIssue && caseHistory.length > 0 && (
              <div className="space-y-4">
                 <div className="flex items-center gap-2 text-[#141414]/40">
                    <History className="w-3 h-3" />
                    <h2 className="text-[10px] font-mono font-bold uppercase tracking-widest">Case Data Stream</h2>
                 </div>
                 <div className="relative border-l-2 border-[#141414]/10 pl-4 ml-1 space-y-6">
                    {caseHistory.map((item, idx) => (
                      <div key={item.id} className="relative">
                        <div className="absolute -left-[23px] top-1.5 w-3 h-3 bg-white border-2 border-[#141414] rounded-full z-10" />
                        <div>
                           <p className="text-[8px] font-mono opacity-40 uppercase">{new Date(item.date).toLocaleDateString('ja-JP')}</p>
                           <p className="text-[10px] font-mono font-bold uppercase mt-0.5 leading-tight">{item.label}</p>
                           <p className="text-[8px] font-mono text-blue-600 uppercase mt-1 truncate max-w-xs">{item.ref}</p>
                           {item.amount && (
                             <p className="text-[9px] font-mono text-emerald-600 font-bold">¥{new Intl.NumberFormat('ja-JP').format(item.amount)}</p>
                           )}
                        </div>
                      </div>
                    ))}
                 </div>
              </div>
            )}
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
                      onClick={() => syncFromDatabase()}
                      className="px-4 py-1.5 bg-blue-600 text-white text-[9px] font-mono font-bold uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center gap-2 shadow-sm"
                    >
                      <Database className="w-3 h-3" /> DB補完 (Sync)
                    </button>
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
                                       onClick={() => syncFromDatabase()}
                                       className="text-[8px] font-mono bg-blue-600 text-white px-2 py-0.5 hover:bg-blue-700 transition-all uppercase flex items-center gap-1"
                                     ><Database className="w-2 h-2" /> DBから補完</button>
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
                                       onClick={() => syncFromDatabase()}
                                       className="text-[8px] font-mono bg-amber-600 text-white px-2 py-0.5 hover:bg-amber-700 transition-all uppercase flex items-center gap-1"
                                     ><Database className="w-2 h-2" /> DBから補完</button>
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
                      ) : selectedTemplate === 'inspection_certificate' ? (
                        <>
                          {/* Inspection Header Step */}
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                             <div className="p-6 border border-[#141414]/10 bg-white space-y-4">
                               <div className="flex justify-between items-center border-b pb-2">
                                  <h3 className="text-[10px] font-mono font-bold uppercase">Context & ID</h3>
                                  <button 
                                    onClick={() => syncFromDatabase()}
                                    className="text-[8px] font-mono bg-blue-600 text-white px-2 py-1 uppercase flex items-center gap-1"
                                  ><Database className="w-2 h-2" /> DBから補完</button>
                               </div>
                               {['issueKey', 'itemNo', 'deliveryNo', 'totalDeliveries', 'itemCount', 'orderDate', 'documentDate'].map(renderDynamicField)}
                               {renderDynamicField('isPartial')}
                             </div>
                             <div className="p-6 border border-[#141414]/10 bg-white space-y-4">
                               <h3 className="text-[10px] font-mono font-bold uppercase border-b pb-2">Counterparty (受託者)</h3>
                               <div className="flex gap-2">
                                  <button onClick={() => {
                                    if(activeVendor) setFormData({...formData, counterparty: activeVendor.vendor_name, counterpartyRepresentativeSama: activeVendor.vendor_rep + ' 様', counterpartyTni: activeVendor.trade_name});
                                  }} className="text-[8px] font-mono border px-2 py-1 uppercase opacity-50 hover:opacity-100 transition-all">From Master</button>
                               </div>
                               {['counterparty', 'counterpartyRepresentativeSama', 'counterpartyTni'].map(renderDynamicField)}
                             </div>
                             <div className="p-6 border border-[#141414]/10 bg-white space-y-4">
                               <h3 className="text-[10px] font-mono font-bold uppercase border-b pb-2">Internal (検収者)</h3>
                               <div className="flex gap-2">
                                  <button onClick={() => {
                                    if(selectedStaff) setFormData({...formData, inspectorDept: selectedStaff.department, inspectorName: selectedStaff.staff_name});
                                  }} className="text-[8px] font-mono border px-2 py-1 uppercase opacity-50 hover:opacity-100 transition-all">From Staff Master</button>
                               </div>
                               {['inspectorDept', 'inspectorName', 'deliveredAt', 'inspectionCompletedAt', 'paymentDueDate'].map(renderDynamicField)}
                             </div>
                          </div>

                          {/* Inspection Content & Financials */}
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                             <div className="p-8 border border-emerald-600/5 bg-emerald-50/5 space-y-6">
                               <div className="flex justify-between items-center border-b border-emerald-800/10 pb-2">
                                  <h3 className="text-[10px] font-mono font-bold uppercase text-emerald-800">Deliverable Detail</h3>
                                  <button 
                                    onClick={() => syncFromDatabase()}
                                    className="text-[8px] font-mono bg-emerald-600 text-white px-2 py-0.5 hover:bg-emerald-700 transition-all uppercase flex items-center gap-1"
                                  ><Database className="w-2 h-2" /> DBから補完</button>
                               </div>
                               {['description', 'spec', 'isReducedTax'].map(renderDynamicField)}
                               <div className="grid grid-cols-2 gap-4">
                                  {['deliveredAmountStr', 'taxRate', 'taxAmountStr', 'totalAmountStr'].map(renderDynamicField)}
                               </div>
                             </div>
                             <div className="p-8 border border-indigo-600/5 bg-indigo-50/5 space-y-6">
                               <h3 className="text-[10px] font-mono font-bold uppercase text-indigo-800 border-b border-indigo-800/10 pb-2">Progress & Bank (財務)</h3>
                               <div className="grid grid-cols-2 gap-4">
                                  {['inspectedPct', 'inspectedAmountStr', 'totalOrderAmountStr', 'pendingAmountStr'].map(renderDynamicField)}
                               </div>
                               {['paymentConditionSummary', 'bankName', 'branchName', 'accountType', 'accountNo', 'accountHolder'].map(renderDynamicField)}
                             </div>
                          </div>
                        </>
                      ) : selectedTemplate === 'royalty_statement' ? (
                        <>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                             <div className="p-6 border border-[#141414]/10 bg-white space-y-4">
                                <div className="flex justify-between items-center border-b pb-2">
                                   <h3 className="text-[10px] font-mono font-bold uppercase">Work & Contract (原案・契約)</h3>
                                   <button onClick={() => syncFromDatabase()} className="text-[8px] font-mono bg-blue-600 text-white px-2 py-1 uppercase flex items-center gap-1"><Database className="w-2 h-2" /> DBから補完</button>
                                </div>
                                {['ledgerId', 'manufacturingIssueKey', 'licenseIssueKey', 'licensor', 'licensee', 'originalWork'].map(renderDynamicField)}
                             </div>
                             <div className="p-6 border border-[#141414]/10 bg-white space-y-4">
                                <div className="flex justify-between items-center border-b pb-2">
                                   <h3 className="text-[10px] font-mono font-bold uppercase">Manufacturing (製造情報)</h3>
                                   <button onClick={() => syncFromDatabase()} className="text-[8px] font-mono bg-blue-600 text-white px-2 py-1 uppercase flex items-center gap-1"><Database className="w-2 h-2" /> DBから補完</button>
                                </div>
                                {['productName', 'edition', 'completionDate', 'quantity', 'sampleQuantity', 'billableQuantity', 'msrpStr'].map(renderDynamicField)}
                             </div>
                          </div>
                          <div className="p-8 border border-indigo-600/10 bg-indigo-50/5 space-y-6">
                             <div className="flex justify-between items-center border-b border-indigo-900/10 pb-2">
                                <h3 className="text-[10px] font-mono font-bold uppercase text-indigo-900">Royalty & MG Calculation (計算明細)</h3>
                                <button onClick={() => syncFromDatabase()} className="text-[8px] font-mono bg-indigo-600 text-white px-2 py-1 uppercase flex items-center gap-1"><Database className="w-2 h-2" /> DBから補完</button>
                             </div>
                             <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                <div className="space-y-4">
                                   {['calcType', 'royaltyRatePct', 'grossRoyaltyStr'].map(renderDynamicField)}
                                </div>
                                <div className="space-y-4">
                                   {['mgAmount', 'mgRemaining', 'actualRoyaltyStr'].map(renderDynamicField)}
                                </div>
                                <div className="space-y-4">
                                   {['taxRate', 'taxAmount', 'totalPaymentStr'].map(renderDynamicField)}
                                </div>
                             </div>
                             <div className="pt-6 border-t border-indigo-900/10 grid grid-cols-1 md:grid-cols-3 gap-8">
                                {['paymentConditionSummary', 'reportingDeadline', 'paymentDueDate'].map(renderDynamicField)}
                             </div>
                          </div>
                        </>
                      ) : (
                        /* Standard Template Selection: Grouped by prefix/keywords */
                        <div className="space-y-12">
                          {/* We can dynamically group fields for a better UI flow */}
                          {(() => {
                            const groups: { [key: string]: string[] } = {
                              "Basic Context (基本情報)": [],
                              "License/Grant Info (ライセンス)": [],
                              "Financial & Payment (金銭)": [],
                              "Remarks & Extras (その他)": []
                            };
                            
                            templateFields.forEach(f => {
                              const meta = (templateMetadata[selectedTemplate]?.vars || {})[f] || {};
                              const group = meta.group;
                              
                              if (group && groups[group]) {
                                groups[group].push(f);
                              } else if (f.includes('Licensor') || f.includes('Licensee') || f.includes('名称') || f.includes('住所')) {
                                groups["Basic Context (基本情報)"].push(f);
                              } else if (f.includes('日') || f.includes('期間') || f.includes('地域') || f.includes('独占')) {
                                groups["License/Grant Info (ライセンス)"].push(f);
                              } else if (f.includes('金銭') || f.includes('料率') || f.includes('価格')) {
                                groups["Financial & Payment (金銭)"].push(f);
                              } else {
                                groups["Remarks & Extras (その他)"].push(f);
                              }
                            });

                            return Object.entries(groups).map(([title, items]) => items.length > 0 && (
                              <section key={title} className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                                <div className="flex items-center justify-between border-b border-[#141414]/10 pb-2">
                                   <div className="flex items-center gap-3">
                                      <div className="w-1.5 h-1.5 bg-[#141414]" />
                                      <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider">{title}</h3>
                                   </div>
                                   <button 
                                      onClick={() => syncFromDatabase()}
                                      className="text-[8px] font-mono border border-blue-600 text-blue-600 px-2 py-0.5 hover:bg-blue-600 hover:text-white transition-all uppercase flex items-center gap-1"
                                   ><Database className="w-2 h-2" /> DBから補完</button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-6">
                                  {items.map(renderDynamicField)}
                                </div>
                              </section>
                            ));
                          })()}
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
        )}
      </main>

      {/* Backlog Search Tab */}
      <AnimatePresence>
        {activeTab === 'search' && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed inset-0 top-[65px] bg-[#FDFDFD] z-40 p-12 overflow-y-auto"
          >
             <div className="max-w-6xl mx-auto space-y-8">
                <div className="flex justify-between items-end border-b border-[#141414]/10 pb-6">
                   <div>
                      <h2 className="text-xl font-mono font-bold uppercase tracking-tighter">Backlog Exploration</h2>
                      <p className="text-xs font-mono text-[#141414]/50 border-l-2 border-[#141414] pl-4 mt-2 uppercase">Real-time synchronization with project management issues.</p>
                   </div>
                   <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#141414]/30" />
                      <input 
                        className="bg-gray-100 border-none pl-10 pr-4 py-3 text-xs font-mono w-96 focus:ring-2 ring-[#141414]/5 transition-all uppercase" 
                        placeholder="SEARCH TICKETS BY KEY OR TITLE..." 
                        value={issueSearchTerm}
                        onChange={(e) => setIssueSearchTerm(e.target.value)}
                      />
                   </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                   {issues
                     .filter(i => 
                        i.issueKey.toLowerCase().includes(issueSearchTerm.toLowerCase()) || 
                        i.summary.toLowerCase().includes(issueSearchTerm.toLowerCase())
                     )
                     .map(issue => (
                     <div 
                       key={issue.issueKey} 
                       className="p-8 border border-[#141414]/10 bg-white group hover:border-[#141414] transition-all cursor-pointer relative overflow-hidden"
                       onClick={() => {
                          handleIssueSelect(issue.issueKey);
                          setActiveTab('create');
                       }}
                     >
                        <div className="flex justify-between items-start mb-8">
                           <div className="w-12 h-12 bg-gray-100 flex items-center justify-center group-hover:bg-[#141414] group-hover:text-white transition-all">
                              <Archive className="w-6 h-6" />
                           </div>
                           <span className="text-[10px] font-mono font-bold bg-[#141414]/5 px-3 py-1 uppercase tracking-widest">{issue.issueKey}</span>
                        </div>
                        <h4 className="text-lg font-bold leading-tight line-clamp-2 uppercase group-hover:text-blue-600 transition-colors">{issue.summary}</h4>
                        <div className="mt-6 flex gap-4 opacity-40">
                           <p className="text-[9px] font-mono uppercase flex items-center gap-1.5"><User className="w-3 h-3" /> {issue.registeredUser || 'SYSTEM'}</p>
                           <p className="text-[9px] font-mono uppercase flex items-center gap-1.5"><Calendar className="w-3 h-3" /> {new Date().toLocaleDateString('ja-JP')}</p>
                        </div>
                        <div className="mt-8 pt-6 border-t border-dashed border-gray-100 flex justify-between items-center group-hover:border-[#141414]/20">
                           <span className="text-[9px] font-mono uppercase tracking-widest font-bold group-hover:text-[#141414] transition-colors">Select for Document Generation</span>
                           <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all -translate-x-4 group-hover:translate-x-0" />
                        </div>
                     </div>
                   ))}
                </div>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Master Settings Tab */}
      <AnimatePresence>
        {activeTab === 'master' && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed inset-0 top-[65px] bg-[#FDFDFD] z-40 p-12 overflow-y-auto"
          >
             <div className="max-w-7xl mx-auto space-y-12">
                <div className="border-b border-[#141414]/10 pb-8 flex justify-between items-end">
                   <div>
                      <h2 className="text-2xl font-mono font-bold uppercase tracking-tighter">Master Systems</h2>
                      <p className="text-xs font-mono text-[#141414]/50 border-l-2 border-[#141414] pl-4 mt-2 uppercase">Configuration of global entities and relationship matrices.</p>
                   </div>
                   <div className="flex gap-4">
                      <button 
                        onClick={() => {
                          const fetchData = async () => {
                            try {
                              const [vendorsRes, staffRes, assetsRes] = await Promise.all([
                                fetch('/api/master/vendors').then(r => r.json()),
                                fetch('/api/master/staff').then(r => r.json()),
                                fetch('/api/management/assets').then(r => r.json())
                              ]);
                              setVendors(vendorsRes);
                              setStaffList(staffRes);
                              setAssets(assetsRes);
                            } catch (e) {
                              console.error("Manual sync failed", e);
                            }
                          };
                          fetchData();
                        }}
                        className="px-6 py-2 bg-[#141414] text-white text-[10px] font-mono font-bold uppercase tracking-widest hover:invert transition-all"
                      >Bulk Sync All</button>
                   </div>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                   {/* Vendor Master */}
                   <div className="space-y-6">
                      <div className="flex items-center justify-between border-b border-orange-600/20 pb-3">
                         <div className="flex items-center gap-3">
                            <Building2 className="w-4 h-4 text-orange-600" />
                            <h3 className="text-[11px] font-mono font-bold uppercase tracking-widest">External Partners</h3>
                         </div>
                         <div className="flex items-center gap-4">
                            <button 
                              onClick={() => {
                                const name = prompt("Name:");
                                const code = prompt("Vendor Code:");
                                const trade = prompt("Trade Name:");
                                if (name && code) {
                                  fetch('/api/master/vendors', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ vendor_name: name, vendor_code: code, trade_name: trade })
                                  }).then(() => window.location.reload());
                                }
                              }}
                              className="p-1 hover:bg-orange-50 text-orange-600 rounded-sm"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <span className="text-[10px] font-mono opacity-40 font-bold">{vendors.length}</span>
                         </div>
                      </div>
                      <div className="space-y-3">
                         {vendors.map(v => (
                           <div key={v.vendor_code} className="p-4 border border-[#141414]/5 bg-white group hover:border-orange-600/30 transition-all hover:shadow-lg">
                              <p className="text-xs font-bold uppercase mb-1">{v.vendor_name}</p>
                              <div className="flex justify-between items-end">
                                 <p className="text-[9px] font-mono text-[#141414]/50 uppercase">{v.vendor_code} | {v.trade_name || 'N/A'}</p>
                                 <button className="text-[8px] font-mono font-bold uppercase px-2 py-0.5 border border-[#141414]/10 hover:bg-[#141414] hover:text-white transition-all">Details</button>
                              </div>
                           </div>
                         ))}
                      </div>
                   </div>

                   {/* Staff Master */}
                   <div className="space-y-6">
                      <div className="flex items-center justify-between border-b border-blue-600/20 pb-3">
                         <div className="flex items-center gap-3">
                            <User className="w-4 h-4 text-blue-600" />
                            <h3 className="text-[11px] font-mono font-bold uppercase tracking-widest">Human Resources</h3>
                         </div>
                         <div className="flex items-center gap-4">
                            <button 
                              onClick={() => {
                                const name = prompt("Name:");
                                const dept = prompt("Department:");
                                const slack = prompt("Slack ID:");
                                if (name && slack) {
                                  fetch('/api/master/staff', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ staff_name: name, department: dept, slack_user_id: slack })
                                  }).then(() => window.location.reload());
                                }
                              }}
                              className="p-1 hover:bg-blue-50 text-blue-600 rounded-sm"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <span className="text-[10px] font-mono opacity-40 font-bold">{staffList.length}</span>
                         </div>
                      </div>
                      <div className="space-y-3">
                         {staffList.map(s => (
                           <div key={s.slack_user_id} className="p-4 border border-[#141414]/5 bg-white group hover:border-blue-600/30 transition-all hover:shadow-lg flex items-center gap-4">
                              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center font-mono text-[10px] font-bold">{s.staff_name.charAt(0)}</div>
                              <div className="flex-1">
                                 <p className="text-xs font-bold uppercase">{s.staff_name}</p>
                                 <p className="text-[9px] font-mono text-[#141414]/50 uppercase leading-none mt-0.5">{s.department} | @{s.slack_user_id}</p>
                              </div>
                           </div>
                         ))}
                      </div>
                   </div>

                   {/* Assets Master */}
                   <div className="space-y-6">
                       <div className="flex items-center justify-between border-b border-purple-600/20 pb-3">
                          <div className="flex items-center gap-3">
                             <Archive className="w-4 h-4 text-purple-600" />
                             <h3 className="text-[11px] font-mono font-bold uppercase tracking-widest">Legal Assets</h3>
                          </div>
                          <span className="text-[10px] font-mono opacity-40 font-bold">{assets.length}</span>
                       </div>
                       <div className="space-y-3">
                          {assets.map(a => (
                            <div key={a.id} className="p-4 border border-[#141414]/5 bg-white group hover:border-purple-600/30 transition-all hover:shadow-lg">
                               <div className="flex justify-between items-start mb-2">
                                  <p className="text-xs font-bold uppercase truncate pr-4">{a.asset_name}</p>
                                  <span className="text-[8px] font-mono font-bold text-purple-600 uppercase italic whitespace-nowrap">{a.asset_type}</span>
                               </div>
                               <p className="text-[9px] font-mono text-[#141414]/50 uppercase mb-2">{a.asset_number} | {a.counterparty}</p>
                               <div className="w-full bg-gray-50 h-[2px] rounded-full overflow-hidden">
                                  <div className="bg-purple-600 h-full w-2/3"></div>
                               </div>
                            </div>
                          ))}
                       </div>
                    </div>
                 </div>
              </div>
           </motion.div>
        )}
      </AnimatePresence>

      {/* Template Management Tab */}
      <AnimatePresence>
        {activeTab === 'templates' && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed inset-0 top-[65px] bg-[#FDFDFD] z-40 p-12 overflow-y-auto"
          >
             <div className="max-w-7xl mx-auto space-y-12 pb-40">
                <div className="flex justify-between items-end border-b border-[#141414]/10 pb-8">
                   <div>
                      <h2 className="text-2xl font-mono font-bold uppercase tracking-tighter">Blueprint Studio</h2>
                      <p className="text-xs font-mono text-[#141414]/50 border-l-2 border-[#141414] pl-4 mt-2 uppercase">Custom template architect & variable mapping logic.</p>
                   </div>
                   <div className="flex gap-4">
                      <button 
                        onClick={() => {
                          const name = prompt("Enter new template ID (e.g., custom_nda):");
                          if (name) {
                            fetch(`/api/templates/${name}`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ content: '<h1>New Template</h1>\n<p>Variable: {{myVar}}</p>' })
                            }).then(() => window.location.reload());
                          }
                        }}
                        className="px-6 py-2 bg-[#141414] text-white text-[10px] font-mono font-bold uppercase tracking-widest hover:invert transition-all flex items-center gap-2"
                      >
                        <Plus className="w-3 h-3" /> New Blueprint
                      </button>
                   </div>
                </div>

                <div className="grid grid-cols-12 gap-12">
                   {/* Template List */}
                   <div className="col-span-4 space-y-4">
                      <h3 className="text-[10px] font-mono font-bold uppercase text-[#141414]/40 tracking-widest">Available Templates</h3>
                      <div className="space-y-1">
                        {templateList.map(t => (
                          <div 
                            key={t}
                            onClick={() => setSelectedTemplate(t)}
                            className={`p-4 border font-mono text-[11px] cursor-pointer transition-all flex justify-between items-center group ${selectedTemplate === t ? 'bg-[#141414] text-white border-[#141414]' : 'bg-white border-[#141414]/10 hover:border-[#141414]'}`}
                          >
                             <div>
                                <p className="font-bold uppercase">{templateMetadata[t]?.label || t.replace(/_/g, ' ')}</p>
                                <p className={`text-[8px] uppercase mt-1 ${selectedTemplate === t ? 'text-white/50' : 'text-[#141414]/30'}`}>{t}.html</p>
                             </div>
                             <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`Delete template ${t}?`)) {
                                      fetch(`/api/templates/${t}`, { method: 'DELETE' })
                                        .then(() => window.location.reload());
                                    }
                                  }}
                                  className="p-1.5 hover:bg-red-500 hover:text-white rounded-sm text-red-500"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                             </div>
                          </div>
                        ))}
                      </div>
                   </div>

                   {/* Template Configuration */}
                   <div className="col-span-8 space-y-10">
                      {selectedTemplate && (
                        <>
                          <div className="p-8 border border-[#141414]/10 bg-white space-y-8">
                             <div className="flex items-center justify-between border-b border-[#141414]/10 pb-4">
                                <h3 className="text-sm font-mono font-bold uppercase tracking-tighter">Properties: {selectedTemplate}</h3>
                                <button 
                                  onClick={() => {
                                    fetch('/api/templates/config/metadata', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify(templateMetadata)
                                    }).then(() => alert("Saved Configuration"));
                                  }}
                                  className="px-6 py-2 bg-blue-600 text-white text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center gap-2"
                                >
                                  <RefreshCw className="w-3 h-3" /> Save Meta Mapping
                                </button>
                             </div>

                             <div className="grid grid-cols-2 gap-8">
                                <div className="space-y-1.5">
                                   <label className="text-[9px] font-mono font-bold uppercase text-[#141414]/50 tracking-wider">Display Label</label>
                                   <input 
                                     type="text" 
                                     value={templateMetadata[selectedTemplate]?.label || ''}
                                     onChange={(e) => setTemplateMetadata({
                                       ...templateMetadata,
                                       [selectedTemplate]: { ...templateMetadata[selectedTemplate], label: e.target.value }
                                     })}
                                     className="w-full p-2 border border-[#141414]/10 font-mono text-xs focus:border-[#141414] outline-none"
                                   />
                                </div>
                                <div className="space-y-1.5">
                                   <label className="text-[9px] font-mono font-bold uppercase text-[#141414]/50 tracking-wider">Categorization</label>
                                   <select 
                                     value={templateMetadata[selectedTemplate]?.category || 'General'}
                                     onChange={(e) => setTemplateMetadata({
                                       ...templateMetadata,
                                       [selectedTemplate]: { ...templateMetadata[selectedTemplate], category: e.target.value }
                                     })}
                                     className="w-full p-2 border border-[#141414]/10 font-mono text-xs focus:border-[#141414] outline-none bg-white"
                                   >
                                      <option value="Core Licenses & Terms">Core Licenses & Terms</option>
                                      <option value="Contracts & Agreements">Contracts & Agreements</option>
                                      <option value="Sales & Purchase">Sales & Purchase</option>
                                      <option value="Delivery & Payment">Delivery & Payment</option>
                                      <option value="General">General / Others</option>
                                   </select>
                                </div>
                             </div>

                             <div className="space-y-4 pt-6">
                                <h4 className="text-[10px] font-mono font-bold uppercase text-[#141414]/40 border-b pb-2">Dynamic Variable Logic</h4>
                                <div className="space-y-2">
                                   {templateFields.map(field => {
                                      const meta = (templateMetadata[selectedTemplate]?.vars || {})[field] || {};
                                      return (
                                        <div key={field} className="grid grid-cols-12 gap-4 items-center p-3 border border-[#141414]/5 bg-white hover:bg-gray-50/50 transition-colors">
                                           <div className="col-span-2 font-mono text-[10px] font-bold text-blue-600 truncate">{field}</div>
                                           <div className="col-span-2">
                                              <input 
                                                type="text" 
                                                placeholder="Label Override"
                                                value={meta.label || ''}
                                                onChange={(e) => {
                                                  const newMeta = { ...templateMetadata };
                                                  newMeta[selectedTemplate] = newMeta[selectedTemplate] || {};
                                                  newMeta[selectedTemplate].vars = newMeta[selectedTemplate].vars || {};
                                                  newMeta[selectedTemplate].vars[field] = { ...meta, label: e.target.value };
                                                  setTemplateMetadata(newMeta);
                                                }}
                                                className="w-full p-1.5 border-b font-mono text-[9px] outline-none focus:border-blue-500"
                                              />
                                           </div>
                                           <div className="col-span-2">
                                              <select 
                                                value={meta.type || 'text'}
                                                onChange={(e) => {
                                                  const newMeta = { ...templateMetadata };
                                                  newMeta[selectedTemplate] = newMeta[selectedTemplate] || {};
                                                  newMeta[selectedTemplate].vars = newMeta[selectedTemplate].vars || {};
                                                  newMeta[selectedTemplate].vars[field] = { ...meta, type: e.target.value };
                                                  setTemplateMetadata(newMeta);
                                                }}
                                                className="w-full p-1.5 bg-gray-50 border-none font-mono text-[9px] outline-none"
                                              >
                                                 <option value="text">Text Input</option>
                                                 <option value="date">Date Picker</option>
                                                 <option value="textarea">Multi-line Text</option>
                                                 <option value="boolean">Boolean Toggle</option>
                                                 <option value="number">Numeric</option>
                                              </select>
                                           </div>
                                           <div className="col-span-2">
                                              <select 
                                                value={meta.group || 'Default'}
                                                onChange={(e) => {
                                                  const newMeta = { ...templateMetadata };
                                                  newMeta[selectedTemplate] = newMeta[selectedTemplate] || {};
                                                  newMeta[selectedTemplate].vars = newMeta[selectedTemplate].vars || {};
                                                  newMeta[selectedTemplate].vars[field] = { ...meta, group: e.target.value };
                                                  setTemplateMetadata(newMeta);
                                                }}
                                                className="w-full p-1.5 bg-gray-50 border-none font-mono text-[9px] outline-none"
                                              >
                                                 <option value="Basic Context (基本情報)">Basic Context</option>
                                                 <option value="License/Grant Info (ライセンス)">License/Grant</option>
                                                 <option value="Financial & Payment (金銭)">Financial</option>
                                                 <option value="Remarks & Extras (その他)">Remarks</option>
                                              </select>
                                           </div>
                                           <div className="col-span-4">
                                              <input 
                                                type="text" 
                                                placeholder="Formula (e.g. {A} * {B})"
                                                value={meta.formula || ''}
                                                onChange={(e) => {
                                                  const newMeta = { ...templateMetadata };
                                                  newMeta[selectedTemplate] = newMeta[selectedTemplate] || {};
                                                  newMeta[selectedTemplate].vars = newMeta[selectedTemplate].vars || {};
                                                  newMeta[selectedTemplate].vars[field] = { ...meta, formula: e.target.value };
                                                  setTemplateMetadata(newMeta);
                                                }}
                                                className="w-full p-1.5 border-b font-mono text-[9px] outline-none focus:border-amber-500 bg-amber-50/20"
                                              />
                                           </div>
                                        </div>
                                      );
                                   })}
                                </div>
                             </div>
                          </div>

                          <div className="p-8 border border-amber-600/10 bg-amber-50/5 space-y-4">
                             <div className="flex items-center gap-2 text-amber-900 border-b border-amber-900/10 pb-2 mb-4">
                                <FileText className="w-4 h-4" />
                                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest">Handlebars HTML Layer</h3>
                             </div>
                             <p className="text-[8px] font-mono text-amber-900/40 uppercase">Warning: Structural changes will refresh the variable mapping automatically.</p>
                             <textarea 
                               className="w-full h-[300px] p-6 bg-[#141414] text-white font-mono text-xs border-none focus:ring-0 leading-relaxed"
                               spellCheck={false}
                               placeholder="Loading template content..."
                               onBlur={(e) => {
                                  if (confirm("Save HTML content changes?")) {
                                    fetch(`/api/templates/${selectedTemplate}`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ content: (e.target as any).value })
                                    }).then(() => {
                                      // Trigger field refresh
                                      fetch(`/api/templates/${selectedTemplate}/schema`)
                                       .then(r => r.json())
                                       .then(d => setTemplateFields(d.variables || []));
                                    });
                                  }
                               }}
                               defaultValue={'Loading...'}
                               key={selectedTemplate}
                               ref={(el) => {
                                 if (el && selectedTemplate) {
                                   fetch(`/api/templates/${selectedTemplate}/preview`)
                                    .then(r => r.text())
                                    .then(text => el.value = text);
                                 }
                               }}
                             />
                          </div>
                        </>
                      )}
                   </div>
                </div>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Repository List Tab */}
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
