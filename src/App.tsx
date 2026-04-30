import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  Search, 
  Plus, 
  Trash2, 
  HelpCircle,
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
  Calendar,
  Settings,
  Upload,
  Link,
  X
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
  const [activeTab, setActiveTab] = useState<'create' | 'list' | 'search' | 'master' | 'templates' | 'dashboard' | 'settings'>('dashboard');
  
  // Dashboard Stats
  const [dashboardStats, setDashboardStats] = useState<any>(null);
  const [isRefreshingStats, setIsRefreshingStats] = useState(false);
  
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
  const [statuses, setStatuses] = useState<any[]>([]);
  const [companyProfile, setCompanyProfile] = useState<any>(null);
  
  // Selections
  const [activeVendor, setActiveVendor] = useState<Vendor | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [vendorSearch, setVendorSearch] = useState('');
  const [selectedVendorDetail, setSelectedVendorDetail] = useState<any>(null);
  const [isEditingVendor, setIsEditingVendor] = useState(false);
  const [selectedStaffDetail, setSelectedStaffDetail] = useState<any>(null);
  const [isEditingStaff, setIsEditingStaff] = useState(false);
  const [isUploadingChangeRequest, setIsUploadingChangeRequest] = useState(false);
  const [appSettings, setAppSettings] = useState<any>({});
  
  // UI State
  const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
  const [assetPickerCallback, setAssetPickerCallback] = useState<((asset: ExternalAsset) => void) | null>(null);
  const [isRegisterAssetOpen, setIsRegisterAssetOpen] = useState(false);
  const [newAssetData, setNewAssetData] = useState<any>({
    asset_name: '',
    asset_type: 'contract',
    counterparty: '',
    status: 'active',
    file_link: '',
    start_date: '',
    end_date: '',
    backlog_issue_key: ''
  });
  const [assetSearch, setAssetSearch] = useState('');
  const [assets, setAssets] = useState<ExternalAsset[]>([]);
  const [workflowRules, setWorkflowRules] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [nextStatusId, setNextStatusId] = useState<number | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [caseHistory, setCaseHistory] = useState<any[]>([]);
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);
  const [newTemplateId, setNewTemplateId] = useState('');
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string, type: 'info' | 'error' | 'success' } | null>(null);
  const [batchSelection, setBatchSelection] = useState<string[]>([]);
  const templateTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const [issueSummary, setIssueSummary] = useState<any>(null);

  useEffect(() => {
    fetch('/api/master/app-settings')
      .then(r => r.json())
      .then(d => setAppSettings(d))
      .catch(e => console.error("Failed to load settings", e));
  }, []);

  const showNotification = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

   const [editingRule, setEditingRule] = useState<any>(null);

   const refreshWorkflowRules = async () => {
     try {
       const res = await fetch('/api/master/rules');
       const data = await res.json();
       setWorkflowRules(Array.isArray(data) ? data : []);
     } catch (e) {
       console.error("Failed to fetch workflow rules", e);
     }
   };

   const saveWorkflowRule = async (rule: any) => {
      try {
        const res = await fetch('/api/master/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rule)
        });
        if (res.ok) {
          showNotification("Routing rule updated successfully", "success");
          refreshWorkflowRules();
          setEditingRule(null);
        } else {
          showNotification("Failed to update rule", "error");
        }
      } catch (e) {
        showNotification("Server error while updating rule", "error");
      }
   };
   const refreshDashboardStats = async () => {
    setIsRefreshingStats(true);
    try {
      const res = await fetch('/api/dashboard/stats');
      const data = await res.json();
      setDashboardStats(data);
    } catch (e) {
      console.error("Failed to fetch dashboard stats", e);
    } finally {
      setIsRefreshingStats(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'dashboard') {
      refreshDashboardStats();
    }
  }, [activeTab]);

  const commonVariables = [
    "Licensor_名称", "Licensor_住所", "Licensor_代表者名",
    "Licensee_名称", "Licensee_住所", "Licensee_代表者名",
    "契約書番号", "台帳ID", "発行日", "有効期限",
    "基本契約名", "素材名", "素材番号", "監修者",
    "金銭条件1_料率", "金銭条件1_計算方式", "金銭条件1_支払条件",
    "特記事項_本文", "クレジット表示"
  ];

  const insertVariable = (varName: string) => {
    const textarea = templateTextAreaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const before = text.substring(0, start);
    const after = text.substring(end);
    const varTag = `{{${varName}}}`;
    
    textarea.value = before + varTag + after;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + varTag.length;
  };

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
        const endpoints = [
          { key: 'issues', url: '/api/backlog/issues' },
          { key: 'vendors', url: '/api/master/vendors' },
          { key: 'staff', url: '/api/master/staff' },
          { key: 'profile', url: '/api/master/company-profile' },
          { key: 'assets', url: '/api/management/assets' },
          { key: 'templates', url: '/api/templates' },
          { key: 'metadata', url: '/api/templates/config/metadata' },
          { key: 'statuses', url: '/api/backlog/statuses' },
          { key: 'workflowRules', url: '/api/master/rules' }
        ];

        const results = await Promise.all(
          endpoints.map(async ({ key, url }) => {
            const res = await fetch(url);
            if (!res.ok) {
              console.error(`Failed to fetch ${key} from ${url}: ${res.status} ${res.statusText}`);
              return null;
            }
            return res.json();
          })
        );

        const [issuesRes, vendorsRes, staffRes, profileRes, assetsRes, templatesRes, metaRes, statusesRes, rulesRes] = results;
        
        setIssues(Array.isArray(issuesRes) ? issuesRes : []);
        setVendors(Array.isArray(vendorsRes) ? vendorsRes : []);
        setStaffList(Array.isArray(staffRes) ? staffRes : []);
        setCompanyProfile(profileRes);
        setAssets(Array.isArray(assetsRes) ? assetsRes : []);
        setTemplateList(Array.isArray(templatesRes) ? templatesRes : []);
        setTemplateMetadata(metaRes || {});
        setStatuses(Array.isArray(statusesRes) ? statusesRes : []);
        setWorkflowRules(Array.isArray(rulesRes) ? rulesRes : []);
      } catch (e) {
        console.error("Critical error during startup fetch:", e);
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
      showNotification("Please select a Backlog ticket first.", "error");
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

  const [lastAutoSave, setLastAutoSave] = useState<string | null>(null);

  const getValidationError = (field: string, value: any) => {
    // Only check if field is likely mandatory
    if (!value || value === "") return "Empty";
    return null;
  };

  // Restore draft on load or issue change
  useEffect(() => {
    if (!selectedIssue) return;
    const saved = localStorage.getItem(`draft_${selectedIssue}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Object.keys(formData).length <= 1) {
          setFormData(parsed);
          showNotification(`Draft restored for ${selectedIssue}`, 'success');
        }
      } catch (e) {
        console.error("Draft restore fail", e);
      }
    }
  }, [selectedIssue]);

  // Auto-save on change
  useEffect(() => {
    if (!selectedIssue || Object.keys(formData).length <= 1) return;
    const to = setTimeout(() => {
      localStorage.setItem(`draft_${selectedIssue}`, JSON.stringify(formData));
      setLastAutoSave(new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }));
    }, 2000);
    return () => clearTimeout(to);
  }, [formData, selectedIssue]);

  const handleIssueSelect = async (issueKey: string) => {
    setSelectedIssue(issueKey);
    const issue = issues.find(i => i.issueKey === issueKey);
    if (issue) setIssueSummary(issue);
    
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
          requesterEmail: selectedStaff?.email || "web-user",
          nextStatusId
        })
      });
      const data = await res.json();
      if (data.driveLink) {
        window.open(data.driveLink, '_blank');
      } else {
        showNotification("Generation completed, but no drive link was returned.", "info");
      }
    } catch (e) {
      console.error("Generation failed", e);
      showNotification("Document generation failed. Please check the logs.", "error");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportExcel = async () => {
    setIsGenerating(true);
    try {
      // Prepare multi-item data for Excel
      const excelItems = [];
      for (let i = 1; i <= 5; i++) {
        excelItems.push({
          content: formData[`支払内容（${i}）`] || "",
          unit_price: Number(formData[`単価（${i}）`] || 0),
          quantity: Number(formData[`数量（${i}）`] || 0),
          amount: Number(formData[`金額（${i}）`] || 0),
          delivery_date: formData[`納品日（${i}）`] || ""
        });
      }

      const excelData = {
        summary: formData.件名 || issueSummary?.summary || "",
        payment_date: formData.支払日 || "",
        department: formData.部署 || formData.inspectorDept || "",
        vendor_code: formData.取引先コード || activeVendor?.vendor_code || "",
        name: formData.氏名 || formData.counterparty || "",
        name_kana: formData['氏名（カナ）'] || "",
        items: excelItems,
        reimbursement: Number(formData.立替金 || 0),
        subtotal: Number(formData.小計 || 0),
        withholding_tax: Number(formData.源泉税 || 0),
        after_tax: Number(formData.税引後 || 0),
        net_transfer_amount: Number(formData.差引振込額 || 0)
      };

      const res = await fetch('/api/documents/export-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(excelData)
      });
      
      if (res.ok) {
        const blob = await res.blob();
        saveAs(blob, `inspection_${selectedIssue || 'export'}.xlsx`);
        showNotification("Excel export successful", "success");
      } else {
        showNotification("Excel export failed", "error");
      }
    } catch (e) {
      console.error("Excel export error:", e);
      showNotification("Excel export failed", "error");
    } finally {
      setIsGenerating(false);
    }
  };

  // Live preview effect
  useEffect(() => {
    if (isPreviewVisible) {
      const to = setTimeout(() => {
        handlePreview();
      }, 1000);
      return () => clearTimeout(to);
    }
  }, [formData, isPreviewVisible, selectedTemplate]);

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

  const renderPartySection = (prefix: string) => {
    const isIndividual = formData[`${prefix}_is_individual`] === true;
    
    // Mapping for different templates
    const nameField = selectedTemplate === 'individual_license_terms' ? `${prefix}_名称` : prefix.toLowerCase();
    const repField = selectedTemplate === 'individual_license_terms' ? `${prefix}_代表者名` : `${prefix.toLowerCase()}_rep`;
    const addressField = `${prefix}_住所`;

    return (
      <div className="space-y-4">
        <div className="flex bg-gray-100/50 p-1 rounded-sm gap-1">
          <button 
            onClick={() => setFormData({ ...formData, [`${prefix}_is_individual`]: false })}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-[9px] font-mono font-bold transition-all ${!isIndividual ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Building2 className="w-3.5 h-3.5" /> 法人
          </button>
          <button 
            onClick={() => setFormData({ ...formData, [`${prefix}_is_individual`]: true })}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-[9px] font-mono font-bold transition-all ${isIndividual ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <User className="w-3.5 h-3.5" /> 個人
          </button>
        </div>
        
        <div className="space-y-4">
          {renderDynamicField(nameField, isIndividual ? '氏名' : '会社名')}
          {!isIndividual && renderDynamicField(repField, '代表者名')}
          {selectedTemplate === 'individual_license_terms' && renderDynamicField(addressField)}
        </div>
      </div>
    );
  };

  const renderDynamicField = (field: string, customLabel?: any) => {
    const actualLabel = typeof customLabel === 'string' ? customLabel : undefined;
    const fieldMeta = (templateMetadata[selectedTemplate]?.vars || {})[field] || {};
    const label = actualLabel || fieldMeta.label || field.replace(/^individual_license_terms_/, '').replace(/_/g, ' ');
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
      'CURRENCY': ['JPY', 'USD', 'EUR', 'CNY', 'GBP', 'AUD', 'CAD', 'CHF'],
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
    const error = getValidationError(field, val);

    return (
      <div key={field} className="space-y-1 group relative">
        <div className="flex justify-between items-center">
          <label className={`flex items-center gap-1.5 text-[9px] font-mono font-bold uppercase tracking-wider transition-colors ${error ? 'text-red-500' : 'text-[#141414]/50 group-hover:text-blue-600'}`}>
            {label} 
            {error && <span className="text-[7px] bg-red-100 px-1 rounded-full">!</span>}
          </label>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
             <HelpCircle className="w-2.5 h-2.5 text-gray-300 cursor-help" />
          </div>
        </div>
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
            className={`w-full text-xs font-mono border-b bg-transparent py-1.5 focus:outline-none appearance-none transition-colors ${error ? 'border-red-300' : 'border-[#141414]/20 focus:border-blue-600'}`}
          >
            <option value="">-- SELECT --</option>
            {selectOptions[field].map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        ) : isTextarea ? (
          <textarea 
            value={val}
            onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
            rows={2}
            className={`w-full text-xs font-mono border bg-white/50 p-2 focus:outline-none resize-none transition-colors ${error ? 'border-red-300' : 'border-[#141414]/10 focus:border-blue-600'}`}
            placeholder={`Enter ${label}...`}
          />
        ) : (
          <input 
            type={isDate ? 'date' : isNumber ? 'number' : 'text'}
            value={val}
            onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
            className={`w-full text-xs font-mono border-b bg-transparent py-1.5 focus:outline-none placeholder:text-gray-300 transition-colors ${error ? 'border-red-300 underline decoration-red-100' : 'border-[#141414]/20 focus:border-blue-600'}`}
            placeholder={isDate ? '' : `Input ${label}...`}
          />
        )}
      </div>
    );
  };

  const handleBatchGenerate = async () => {
    if (batchSelection.length === 0) return;
    setIsGenerating(true);
    let successCount = 0;
    try {
      for (const key of batchSelection) {
        setNotification({ message: `Generating for ${key}...`, type: 'info' });
        // Simulating the flow: sync -> generate
        // In real use, we'd need a specific template for batch, but here we just use the selected one
        const searchRes = await fetch(`/api/search/issues?query=${key}`).then(r => r.json());
        const issue = searchRes.find((i: any) => i.issueKey === key);
        if (issue) {
          // Send to generation endpoint using defaults or existing metadata
          await fetch('/api/documents/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              templateId: selectedTemplate,
              data: { ...formData, contextTitle: issue.summary, issueKey: key },
              issueKey: key
            })
          });
          successCount++;
        }
      }
      showNotification(`Batch completed: ${successCount} documents generated.`, 'success');
      setBatchSelection([]);
    } catch (e) {
      console.error("Batch fail", e);
      showNotification("Batch generation encountered errors.", "error");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegisterAsset = async () => {
    try {
      const res = await fetch('/api/management/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAssetData)
      });
      if (res.ok) {
        showNotification("Asset registered successfully", "success");
        setIsRegisterAssetOpen(false);
        // Refresh assets list
        const assetsRes = await fetch('/api/management/assets').then(r => r.json());
        setAssets(assetsRes);
        setNewAssetData({
          asset_name: '',
          asset_type: 'contract',
          counterparty: '',
          status: 'active',
          file_link: '',
          start_date: '',
          end_date: '',
          backlog_issue_key: ''
        });
      } else {
        showNotification("Failed to register asset", "error");
      }
    } catch (e) {
      showNotification("Error connecting to server", "error");
    }
  };

  // UI Sections
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
              onClick={() => setActiveTab('dashboard')}
              className={`text-[10px] font-mono font-bold uppercase tracking-wider transition-all border-b-2 py-1 ${activeTab === 'dashboard' ? 'border-[#141414] text-[#141414]' : 'border-transparent text-[#141414]/40 hover:text-[#141414]'}`}
            >
              Dashboard
            </button>
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
            <button 
              onClick={() => setActiveTab('settings')}
              className={`text-[10px] font-mono font-bold uppercase tracking-wider transition-all border-b-2 py-1 ${activeTab === 'settings' ? 'border-[#141414] text-[#141414]' : 'border-transparent text-[#141414]/40 hover:text-[#141414]'}`}
            >
              Settings
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
        {activeTab === 'dashboard' && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8 animate-in fade-in duration-500 pb-20"
          >
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
               <div className="bg-white border border-[#141414]/10 p-6 shadow-sm hover:border-blue-600 transition-colors group">
                  <p className="text-[9px] font-mono font-bold text-[#141414]/40 uppercase mb-2">Active Requests</p>
                  <p className="text-3xl font-mono font-bold tracking-tighter">{dashboardStats?.totalIssues || 0}</p>
                  <div className="mt-4 h-1 bg-gray-100 overflow-hidden">
                     <div className="h-full bg-blue-600 transition-all duration-1000" style={{ width: '65%' }} />
                  </div>
               </div>
               <div className="bg-white border border-[#141414]/10 p-6 shadow-sm hover:border-emerald-600 transition-colors">
                  <p className="text-[9px] font-mono font-bold text-[#141414]/40 uppercase mb-2">Issued Docs</p>
                  <p className="text-3xl font-mono font-bold tracking-tighter text-emerald-600">{dashboardStats?.totalDocuments || 0}</p>
                  <p className="text-[8px] font-mono opacity-40 mt-1 uppercase">Across {dashboardStats?.recentActivity?.length || 0} Projects</p>
               </div>
               <div className="bg-white border border-[#141414]/10 p-6 shadow-sm">
                  <p className="text-[9px] font-mono font-bold text-[#141414]/40 uppercase mb-2">Avg. Turnaround</p>
                  <p className="text-3xl font-mono font-bold tracking-tighter text-amber-600">2.4<span className="text-sm">d</span></p>
                  <p className="text-[8px] font-mono opacity-40 mt-1 uppercase">Consistent with SLA</p>
               </div>
               <div className="bg-white border border-[#141414]/10 p-6 shadow-sm">
                  <p className="text-[9px] font-mono font-bold text-[#141414]/40 uppercase mb-2">Templates Utilized</p>
                  <p className="text-3xl font-mono font-bold tracking-tighter">{templateList.length}</p>
                  <p className="text-[8px] font-mono opacity-40 mt-1 uppercase">Optimized for Blueprint</p>
               </div>
            </div>

            {/* Main Dashboard Content */}
            <div className="grid grid-cols-12 gap-10">
               {/* Left: Quick Access Funnel */}
               <div className="col-span-12 lg:col-span-8 space-y-6">
                  <div className="flex justify-between items-center border-b border-[#141414] pb-4">
                     <h2 className="text-sm font-mono font-bold uppercase tracking-widest flex items-center gap-2">
                        <LayoutDashboard className="w-4 h-4" /> Legal Request Pipeline
                     </h2>
                     <button onClick={refreshDashboardStats} className="p-1 hover:rotate-180 transition-transform duration-500">
                        <RefreshCw className="w-3 h-3 opacity-40" />
                     </button>
                  </div>
                  
                  <div className="space-y-3">
                     {dashboardStats?.issueDetails?.slice(0, 10).map((issue: any) => (
                       <div 
                         key={issue.issueKey}
                         onClick={() => {
                           handleIssueSelect(issue.issueKey);
                           setActiveTab('create');
                         }}
                         className="bg-white border border-[#141414]/5 p-5 flex justify-between items-center group hover:border-[#141414] transition-all cursor-pointer hover:shadow-lg"
                       >
                          <div className="flex items-center gap-6">
                             <div className={`w-2 h-12 ${issue.status?.name === '完了' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                             <div>
                                <p className="text-[9px] font-mono font-bold text-[#141414]/40">{issue.issueKey}</p>
                                <h3 className="text-sm font-bold uppercase group-hover:text-blue-600 transition-colors">{issue.summary}</h3>
                                <div className="flex items-center gap-3 mt-1.5">
                                   <span className="text-[8px] font-mono font-bold bg-[#141414]/5 px-2 py-0.5 rounded-full uppercase">{issue.status?.name}</span>
                                   <span className="text-[8px] font-mono opacity-30 uppercase">{issue.assignee?.name || 'Unassigned'}</span>
                                </div>
                             </div>
                          </div>
                          <div className="flex items-center gap-8">
                             <div className="text-right">
                                <p className="text-[9px] font-mono font-bold leading-none">{issue.documentCount} Artifacts</p>
                                <p className="text-[8px] font-mono opacity-30 uppercase mt-1">
                                   {issue.lastDocDate ? `Last: ${new Date(issue.lastDocDate).toLocaleDateString()}` : 'No drafts yet'}
                                </p>
                             </div>
                             <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                          </div>
                       </div>
                     ))}
                     {isRefreshingStats && (
                        <div className="p-20 text-center flex flex-col items-center gap-4">
                           <Loader2 className="w-6 h-6 animate-spin opacity-20" />
                           <p className="text-[10px] font-mono opacity-30 uppercase tracking-[0.2em]">Synchronizing with Backlog Matrix...</p>
                        </div>
                     )}
                  </div>

                  <button 
                    onClick={() => setActiveTab('search')}
                    className="w-full py-4 border border-dashed border-[#141414]/10 text-[9px] font-mono font-bold uppercase tracking-widest hover:border-[#141414] hover:bg-gray-50 transition-all"
                  >
                    View All Case Inventory
                  </button>
               </div>

               {/* Right: Recent Blueprint Activity */}
               <div className="col-span-12 lg:col-span-4 space-y-6">
                  <div className="bg-[#141414] text-white p-6">
                     <h3 className="text-xs font-mono font-bold uppercase tracking-widest flex items-center gap-2 mb-4">
                        <Database className="w-4 h-4 text-blue-400" /> Recent Artifacts
                     </h3>
                     <div className="space-y-4">
                        {dashboardStats?.recentActivity?.map((doc: any, idx: number) => (
                           <div key={idx} className="border-l border-blue-400/30 pl-4 py-1">
                              <p className="text-[10px] font-bold truncate">{doc.template_type}</p>
                              <p className="text-[8px] font-mono opacity-60 uppercase">{doc.issue_key} • {new Date(doc.created_at).toLocaleDateString()}</p>
                           </div>
                        ))}
                     </div>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 p-6">
                     <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest flex items-center gap-2 mb-3 text-amber-900">
                        <AlertCircle className="w-4 h-4" /> System Health
                     </h3>
                     <div className="space-y-2">
                        <div className="flex justify-between items-center text-[9px] font-mono">
                           <span className="text-amber-800/60 uppercase">Backlog Link</span>
                           <span className="text-emerald-600 font-bold">OPERATIONAL</span>
                        </div>
                        <div className="flex justify-between items-center text-[9px] font-mono">
                           <span className="text-amber-800/60 uppercase">Cloud Storage</span>
                           <span className="text-emerald-600 font-bold">ACTIVE</span>
                        </div>
                        <div className="flex justify-between items-center text-[9px] font-mono">
                           <span className="text-amber-800/60 uppercase">Identity Matrix</span>
                           <span className="text-amber-600 font-bold">RE-SYNCING</span>
                        </div>
                     </div>
                  </div>
               </div>
            </div>
          </motion.div>
        )}

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
          <section className={`${isPreviewVisible ? 'col-span-12' : 'col-span-12 lg:col-span-9'} space-y-8`}>
            <div className={`bg-white border border-[#141414] shadow-[20px_20px_0px_0px_rgba(20,20,20,0.05)] relative flex flex-col ${isPreviewVisible ? 'h-[800px]' : ''}`}>
               {/* Stage Header */}
               <div className="flex items-center justify-between p-5 border-b border-[#141414]/10 bg-[#FAFAFA]">
                 <div className="flex items-center gap-4">
                   <div className="w-8 h-8 bg-blue-600 text-white flex items-center justify-center">
                      <Archive className="w-4 h-4" />
                   </div>
                   <div>
                     <h2 className="text-xs font-mono font-bold uppercase tracking-widest">{selectedTemplate.replace(/_/g, ' ')} Editor</h2>
                     <div className="flex items-center gap-2 mt-0.5">
                       <p className="text-[9px] font-mono text-[#141414]/40 uppercase">Session UUID: {Math.random().toString(36).substr(2, 9)}</p>
                       {issueSummary && (
                          <span className="text-[8px] font-mono bg-blue-100 text-blue-700 px-2 py-0.5 font-bold uppercase tracking-tighter">
                             {issueSummary.issueKey} : {issueSummary.status?.name || 'SYNCED'}
                          </span>
                       )}
                     </div>
                   </div>
                 </div>
                 <div className="flex gap-3">
                    <button 
                      onClick={() => setIsPreviewVisible(!isPreviewVisible)}
                      className={`px-4 py-1.5 text-[9px] font-mono font-bold uppercase tracking-widest transition-all flex items-center gap-2 shadow-sm ${isPreviewVisible ? 'bg-amber-600 text-white' : 'bg-white border border-[#141414] text-[#141414]'}`}
                    >
                      <Eye className="w-3 h-3" /> {isPreviewVisible ? 'CLOSE SIDE PREVIEW' : 'SPLIT PREVIEW'}
                    </button>
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
               <div className={`flex flex-1 overflow-hidden ${isPreviewVisible ? 'flex-row' : 'flex-col'}`}>
                  <div className={`p-10 overflow-y-auto custom-scrollbar flex-1 ${isPreviewVisible ? 'max-w-[50%]' : ''}`}>
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
                                  {renderPartySection('Licensor')}
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
                                  {renderPartySection('Licensee')}
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
                                  <div className="flex items-center gap-2">
                                     <h3 className="text-[10px] font-mono font-bold uppercase text-emerald-800">Deliverable Detail</h3>
                                     {formData.linked_po_number && (
                                        <span className="text-[8px] font-mono bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                                           <Link className="w-2 h-2" /> {formData.linked_po_number}
                                        </span>
                                     )}
                                  </div>
                                  <div className="flex gap-2">
                                     <button 
                                       onClick={() => {
                                          setAssetPickerCallback((asset) => {
                                             fetch('/api/management/link-asset', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ type: 'delivery', issueKey: formData.issueKey, assetId: asset.id })
                                             }).then(() => {
                                                showNotification("Associated with PO: " + asset.asset_number, "success");
                                                setFormData({...formData, linked_po_number: asset.asset_number, linked_po_link: asset.file_link});
                                             });
                                          });
                                          setIsAssetPickerOpen(true);
                                       }}
                                       className="text-[8px] font-mono border border-emerald-600 text-emerald-600 px-2 py-0.5 hover:bg-emerald-600 hover:text-white transition-all uppercase flex items-center gap-1"
                                     ><Link className="w-2 h-2" /> PO紐付</button>
                                     <button 
                                       onClick={() => syncFromDatabase()}
                                       className="text-[8px] font-mono bg-emerald-600 text-white px-2 py-0.5 hover:bg-emerald-700 transition-all uppercase flex items-center gap-1"
                                     ><Database className="w-2 h-2" /> DBから補完</button>
                                  </div>
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
                           {/* Excel Export Multi-Item Data */}
                           <div className="mt-8 p-8 border border-blue-600/10 bg-blue-50/5 space-y-6">
                              <div className="flex justify-between items-center border-b border-blue-800/10 pb-2">
                                <h3 className="text-[10px] font-mono font-bold uppercase text-blue-800">Excel Export Data (多項目検収用)</h3>
                                <div className="text-[8px] font-mono opacity-50 uppercase">Only used for Excel Export</div>
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6">
                                {['件名', '支払日', '部署', '取引先コード', '氏名', '氏名（カナ）'].map(f => renderDynamicField(f))}
                                {['立替金', '小計', '源泉税', '税引後', '差引振込額'].map(f => renderDynamicField(f))}
                              </div>

                              <div className="space-y-2 mt-6">
                                {[1, 2, 3, 4, 5].map(i => (
                                  <div key={i} className="p-4 bg-white border border-[#141414]/5 rounded-sm">
                                    <div className="flex items-center gap-2 mb-3">
                                      <span className="text-[9px] font-mono font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">ITEM {i}</span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                                      {renderDynamicField(`支払内容（${i}）`, `内容 ${i}`)}
                                      {renderDynamicField(`単価（${i}）`, `単価 ${i}`)}
                                      {renderDynamicField(`数量（${i}）`, `数量 ${i}`)}
                                      {renderDynamicField(`金額（${i}）`, `金額 ${i}`)}
                                      {renderDynamicField(`納品日（${i}）`, `納品日 ${i}`)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                           </div>
                        </>
                      ) : selectedTemplate === 'royalty_statement' ? (
                        <>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                             <div className="p-6 border border-[#141414]/10 bg-white space-y-4">
                                <div className="flex justify-between items-center border-b pb-2">
                                   <div className="flex items-center gap-2">
                                      <h3 className="text-[10px] font-mono font-bold uppercase">Work & Contract (原案・契約)</h3>
                                      {formData.linked_terms_number && (
                                         <span className="text-[8px] font-mono bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full border border-blue-100 flex items-center gap-1">
                                            <Link className="w-2 h-2" /> {formData.linked_terms_number}
                                         </span>
                                      )}
                                   </div>
                                   <div className="flex gap-2">
                                      <button 
                                         onClick={() => {
                                            setAssetPickerCallback((asset) => {
                                               fetch('/api/management/link-asset', {
                                                  method: 'POST',
                                                  headers: { 'Content-Type': 'application/json' },
                                                  body: JSON.stringify({ type: 'contract', issueKey: formData.manufacturingIssueKey || formData.licenseIssueKey || formData.issueKey, assetId: asset.id })
                                               }).then(() => {
                                                  showNotification("Associated with Terms: " + asset.asset_number, "success");
                                                  setFormData({...formData, linked_terms_number: asset.asset_number, linked_terms_link: asset.file_link});
                                               });
                                            });
                                            setIsAssetPickerOpen(true);
                                         }}
                                         className="text-[8px] font-mono border border-blue-600 text-blue-600 px-2 py-1 uppercase flex items-center gap-1"
                                      ><Link className="w-2 h-2" /> 個別紐付</button>
                                      <button onClick={() => syncFromDatabase()} className="text-[8px] font-mono bg-blue-600 text-white px-2 py-1 uppercase flex items-center gap-1"><Database className="w-2 h-2" /> DBから補完</button>
                                   </div>
                                </div>
                                <div className="space-y-4">
                                   {['ledgerId', 'manufacturingIssueKey', 'licenseIssueKey'].map(renderDynamicField)}
                                   {renderPartySection('licensor')}
                                   {renderPartySection('licensee')}
                                   {renderDynamicField('originalWork')}
                                </div>
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

                {isPreviewVisible && (
                  <div className="w-1/2 border-l border-[#141414]/10 bg-gray-50 flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
                     <div className="p-4 bg-white border-b border-[#141414]/10 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                           <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                           <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#141414]/60">Live Logic Preview</span>
                        </div>
                        {lastAutoSave && (
                          <span className="text-[8px] font-mono opacity-40 uppercase">Saved: {lastAutoSave}</span>
                        )}
                     </div>
                     <div className="flex-1 overflow-auto p-10 bg-[#f0f0f0]">
                        <div className="bg-white shadow-xl mx-auto p-12 min-h-full prose prose-sm max-w-none relative scale-[0.85] origin-top border border-[#141414]/5">
                           {isPreviewing ? (
                              <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] flex items-center justify-center z-10">
                                 <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                              </div>
                           ) : null}
                           {previewHtml ? (
                             <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                           ) : (
                             <div className="flex flex-col items-center justify-center p-20 opacity-20">
                                <FileText className="w-20 h-20 mb-4" />
                                <p className="font-mono text-xs uppercase text-center">Syncing logic with blueprint schema...</p>
                             </div>
                           )}
                        </div>
                     </div>
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
                     {selectedTemplate === 'inspection_certificate' && (
                        <button 
                          onClick={handleExportExcel}
                          disabled={isGenerating}
                          className="flex-1 md:flex-none px-10 py-3.5 border border-blue-600 text-blue-600 text-[11px] font-mono font-bold uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center gap-2 group"
                        >
                          <Download className="w-4 h-4 group-hover:bounce transition-transform" />
                          Export Excel
                        </button>
                     )}
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
                      {batchSelection.length > 0 && (
                        <div className="mt-4 flex items-center gap-4 animate-in fade-in slide-in-from-left-4">
                           <span className="text-[10px] font-mono font-bold bg-[#141414] text-white px-3 py-1 uppercase">{batchSelection.length} Selected</span>
                           <button 
                             onClick={handleBatchGenerate}
                             disabled={isGenerating}
                             className="text-[10px] font-mono font-bold text-blue-600 border border-blue-600 px-4 py-1 hover:bg-blue-600 hover:text-white transition-all uppercase"
                           >
                             Batch Generate for {selectedTemplate}
                           </button>
                        </div>
                      )}
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
                              const [vendorsRes, staffRes, assetsRes, rulesRes] = await Promise.all([
                                fetch('/api/master/vendors').then(r => r.json()),
                                fetch('/api/master/staff').then(r => r.json()),
                                fetch('/api/management/assets').then(r => r.json()),
                                fetch('/api/master/rules').then(r => r.json())
                              ]);
                              setVendors(vendorsRes);
                              setStaffList(staffRes);
                              setAssets(assetsRes);
                              setWorkflowRules(rulesRes);
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
                
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
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

                      <div className="relative">
                         <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                         <input 
                           type="text" 
                           placeholder="SEARCH PARTNERS..."
                           value={vendorSearch}
                           onChange={(e) => setVendorSearch(e.target.value)}
                           className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-transparent focus:bg-white focus:border-orange-600/30 text-[10px] font-mono outline-none transition-all"
                         />
                      </div>

                      <div className="space-y-3">
                         {vendors
                           .filter(v => 
                             v.vendor_name.toLowerCase().includes(vendorSearch.toLowerCase()) || 
                             v.vendor_code.toLowerCase().includes(vendorSearch.toLowerCase()) ||
                             (v.trade_name && v.trade_name.toLowerCase().includes(vendorSearch.toLowerCase()))
                           )
                           .map(v => (
                           <div key={v.vendor_code} className="p-4 border border-[#141414]/5 bg-white group hover:border-orange-600/30 transition-all hover:shadow-lg">
                              <p className="text-xs font-bold uppercase mb-1">{v.vendor_name}</p>
                              <div className="flex justify-between items-end">
                                 <p className="text-[9px] font-mono text-[#141414]/50 uppercase">{v.vendor_code} | {v.trade_name || 'N/A'}</p>
                                 <button 
                                   onClick={() => {
                                     fetch(`/api/master/vendors/${v.vendor_code}`)
                                       .then(r => r.json())
                                       .then(d => {
                                         setSelectedVendorDetail(d);
                                         setIsEditingVendor(false);
                                       });
                                   }}
                                   className="text-[8px] font-mono font-bold uppercase px-2 py-0.5 border border-[#141414]/10 hover:bg-[#141414] hover:text-white transition-all"
                                 >Details</button>
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
                           <div 
                             key={s.slack_user_id} 
                             onClick={() => setSelectedStaffDetail(s)}
                             className="p-4 border border-[#141414]/5 bg-white group hover:border-blue-600/30 transition-all hover:shadow-lg flex items-center gap-4 cursor-pointer"
                           >
                              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center font-mono text-[10px] font-bold">{s.staff_name.charAt(0)}</div>
                              <div className="flex-1">
                                 <p className="text-xs font-bold uppercase">{s.staff_name}</p>
                                 <p className="text-[9px] font-mono text-[#141414]/50 uppercase leading-none mt-0.5">{s.department} {s.department_code && `(${s.department_code})`} | @{s.slack_user_id}</p>
                              </div>
                           </div>
                         ))}
                      </div>
                   </div>

                   {/* Routing Master */}
                   <div className="space-y-6">
                      <div className="flex items-center justify-between border-b border-emerald-600/20 pb-3">
                         <div className="flex items-center gap-3">
                            <GitBranch className="w-4 h-4 text-emerald-600" />
                            <h3 className="text-[11px] font-mono font-bold uppercase tracking-widest">ルーティング設定</h3>
                         </div>
                         <div className="flex items-center gap-4">
                            <button 
                              onClick={() => {
                                setEditingRule({ department: "", approver_slack_id: "", stamp_operator_slack_id: "", manager_slack_id: "", slack_channel_id: "", is_active: true });
                              }}
                              className="p-1 hover:bg-emerald-50 text-emerald-600 rounded-sm"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <span className="text-[10px] font-mono opacity-40 font-bold">{workflowRules.length}</span>
                         </div>
                      </div>
                      <div className="space-y-3">
                         {workflowRules.map(rule => (
                           <div key={rule.department} className="p-4 border border-[#141414]/5 bg-white group hover:border-emerald-600/30 transition-all hover:shadow-lg">
                              {editingRule?.department === rule.department ? (
                                <div className="space-y-3">
                                   <div>
                                      <label className="text-[8px] font-mono opacity-40 uppercase">部署名</label>
                                      <input 
                                        disabled
                                        value={rule.department}
                                        className="w-full text-xs font-mono border-b p-1 bg-gray-50"
                                      />
                                   </div>
                                   <div>
                                      <label className="text-[8px] font-mono opacity-40 uppercase">不備承認者 (Slack ID)</label>
                                      <input 
                                        value={editingRule.approver_slack_id}
                                        onChange={e => setEditingRule({...editingRule, approver_slack_id: e.target.value})}
                                        className="w-full text-xs font-mono border-b p-1 focus:border-emerald-600 outline-none"
                                        placeholder="U12345678"
                                      />
                                   </div>
                                   <div>
                                      <label className="text-[8px] font-mono opacity-40 uppercase">押印・送付担当 (Slack ID)</label>
                                      <input 
                                        value={editingRule.stamp_operator_slack_id}
                                        onChange={e => setEditingRule({...editingRule, stamp_operator_slack_id: e.target.value})}
                                        className="w-full text-xs font-mono border-b p-1 focus:border-emerald-600 outline-none"
                                        placeholder="U12345678"
                                      />
                                   </div>
                                   <div>
                                      <label className="text-[8px] font-mono opacity-40 uppercase">管理者 (Slack ID)</label>
                                      <input 
                                        value={editingRule.manager_slack_id}
                                        onChange={e => setEditingRule({...editingRule, manager_slack_id: e.target.value})}
                                        className="w-full text-xs font-mono border-b p-1 focus:border-emerald-600 outline-none"
                                        placeholder="U12345678"
                                      />
                                   </div>
                                   <div>
                                      <label className="text-[8px] font-mono opacity-40 uppercase">返信先チャンネル ID</label>
                                      <input 
                                        value={editingRule.slack_channel_id}
                                        onChange={e => setEditingRule({...editingRule, slack_channel_id: e.target.value})}
                                        className="w-full text-xs font-mono border-b p-1 focus:border-emerald-600 outline-none"
                                        placeholder="C012345678"
                                      />
                                   </div>
                                   <div className="flex gap-2 pt-2">
                                      <button 
                                        onClick={() => saveWorkflowRule(editingRule)}
                                        className="flex-1 py-1 bg-emerald-600 text-white text-[9px] font-mono font-bold uppercase"
                                      >保存</button>
                                      <button 
                                        onClick={() => setEditingRule(null)}
                                        className="flex-1 py-1 bg-gray-100 text-gray-600 text-[9px] font-mono font-bold uppercase"
                                      >取消</button>
                                   </div>
                                </div>
                              ) : (
                                <>
                                  <div className="flex justify-between items-start mb-2">
                                     <p className="text-xs font-bold uppercase">{rule.department}</p>
                                     <div className={`w-1.5 h-1.5 rounded-full ${rule.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                                  </div>
                                  <div className="space-y-1">
                                     <div className="flex justify-between text-[9px] font-mono">
                                        <span className="opacity-40 uppercase">承認者</span>
                                        <span className="font-bold">@{rule.approver_slack_id || '未設定'}</span>
                                     </div>
                                     <div className="flex justify-between text-[9px] font-mono">
                                        <span className="opacity-40 uppercase">押印担当</span>
                                        <span className="font-bold">@{rule.stamp_operator_slack_id || '未設定'}</span>
                                     </div>
                                     <div className="flex flex-col gap-0.5 mt-2 pt-2 border-t border-dashed border-gray-100">
                                        <span className="text-[8px] font-mono opacity-40 uppercase">返信先 (チャンネル ID)</span>
                                        <span className="text-[10px] font-mono font-bold text-blue-600">{rule.slack_channel_id || 'デフォルト'}</span>
                                     </div>
                                  </div>
                                  <div className="mt-4 flex justify-end">
                                     <button 
                                       onClick={() => setEditingRule(rule)}
                                       className="text-[8px] font-mono font-bold uppercase px-2 py-1 border border-[#141414]/10 hover:bg-[#141414] hover:text-white transition-all shadow-sm"
                                     >設定編集</button>
                                  </div>
                                </>
                              )}
                           </div>
                         ))}
                         {editingRule && !workflowRules.find(r => r.department === editingRule.department) && (
                            <div className="p-4 border border-emerald-600 bg-white shadow-xl">
                               <div className="space-y-3">
                                  <div>
                                     <label className="text-[8px] font-mono opacity-40 uppercase">新規部署名</label>
                                     <input 
                                       value={editingRule.department}
                                       onChange={e => setEditingRule({...editingRule, department: e.target.value})}
                                       className="w-full text-xs font-mono border-b p-1 focus:border-emerald-600 outline-none"
                                       placeholder="部署名を入力..."
                                       autoFocus
                                     />
                                  </div>
                                  <div>
                                      <label className="text-[8px] font-mono opacity-40 uppercase">承認者 (Slack ID)</label>
                                      <input 
                                        value={editingRule.approver_slack_id}
                                        onChange={e => setEditingRule({...editingRule, approver_slack_id: e.target.value})}
                                        className="w-full text-xs font-mono border-b p-1 focus:border-emerald-600 outline-none"
                                        placeholder="U12345678"
                                      />
                                  </div>
                                  <div className="flex gap-2 pt-2">
                                     <button 
                                       onClick={() => saveWorkflowRule(editingRule)}
                                       className="flex-1 py-1 bg-emerald-600 text-white text-[9px] font-mono font-bold uppercase"
                                     >作成</button>
                                     <button 
                                       onClick={() => setEditingRule(null)}
                                       className="flex-1 py-1 bg-gray-100 text-gray-600 text-[9px] font-mono font-bold uppercase"
                                     >取消</button>
                                  </div>
                               </div>
                            </div>
                         )}
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
                   <div className="flex gap-4 items-center">
                      <input 
                        type="text"
                        placeholder="New Template ID (e.g., nda_standard)..."
                        value={newTemplateId}
                        onChange={(e) => setNewTemplateId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                        className="bg-gray-100 border border-[#141414]/10 px-3 py-2 text-[10px] font-mono w-60 focus:outline-none focus:border-[#141414] placeholder:italic"
                      />
                      <button 
                        disabled={!newTemplateId}
                        onClick={() => {
                          const name = newTemplateId;
                          fetch(`/api/templates/${name}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ content: '<h1>New Template</h1>\n<p>Variable: {{myVar}}</p>' })
                          }).then(() => {
                            setNewTemplateId('');
                            window.location.reload();
                          });
                        }}
                        className="px-6 py-2 bg-[#141414] text-white text-[10px] font-mono font-bold uppercase tracking-widest hover:invert transition-all flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-3 h-3" /> Create Blueprint
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
                                {isDeleting === t ? (
                                  <div className="flex items-center gap-1">
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        fetch(`/api/templates/${t}`, { method: 'DELETE' })
                                          .then(() => window.location.reload());
                                      }}
                                       className="p-1 px-2 bg-red-600 text-white text-[8px] font-mono uppercase"
                                    >
                                      CONFIRM
                                    </button>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setIsDeleting(null);
                                      }}
                                       className="p-1 px-2 bg-gray-200 text-gray-600 text-[8px] font-mono uppercase"
                                    >
                                      CANCEL
                                    </button>
                                  </div>
                                ) : (
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setIsDeleting(t);
                                    }}
                                    className="p-1.5 hover:bg-red-500 hover:text-white rounded-sm text-red-500"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
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
                                    }).then(() => showNotification("Template Configuration Saved", "success"));
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
                             
                             <div className="flex gap-6">
                                <div className="flex-1 space-y-4">
                                   <p className="text-[8px] font-mono text-amber-900/40 uppercase">Warning: Structural changes will refresh the variable mapping automatically.</p>
                                   <textarea 
                                     ref={templateTextAreaRef}
                                     className="w-full h-[450px] p-6 bg-[#141414] text-white font-mono text-xs border-none focus:ring-0 leading-relaxed rounded-sm"
                                     spellCheck={false}
                                     placeholder="Loading template content..."
                                     onBlur={(e) => {
                                        const content = (e.target as any).value;
                                        setTemplateStatus("Saving...");
                                        fetch(`/api/templates/${selectedTemplate}`, {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ content })
                                        }).then(() => {
                                          setTemplateStatus("Saved successfully.");
                                          setTimeout(() => setTemplateStatus(null), 3000);
                                          // Trigger field refresh
                                          fetch(`/api/templates/${selectedTemplate}/schema`)
                                           .then(r => r.json())
                                           .then(d => setTemplateFields(d.variables || []));
                                        });
                                     }}
                                     defaultValue={'Loading...'}
                                     key={selectedTemplate}
                                     onFocus={(e) => {
                                       if (e.target.value === 'Loading...') {
                                         fetch(`/api/templates/${selectedTemplate}`)
                                          .then(r => r.text())
                                          .then(text => e.target.value = text);
                                       }
                                     }}
                                   />
                                   {templateStatus && (
                                     <div className="absolute bottom-4 right-4 bg-amber-600 text-white px-4 py-2 font-mono text-[9px] uppercase tracking-widest animate-pulse">
                                        {templateStatus}
                                     </div>
                                   )}
                                </div>

                                <div className="w-64 space-y-4">
                                   <div className="p-4 bg-white border border-amber-600/20 rounded-sm space-y-3 shadow-sm">
                                      <h4 className="text-[10px] font-mono font-bold uppercase text-amber-900 flex items-center gap-2">
                                         <Plus className="w-3 h-3" /> Insert Variable
                                      </h4>
                                      <p className="text-[8px] font-mono text-gray-400 uppercase leading-tight">Click to inject placeholder into HTML at cursor pos.</p>
                                      
                                      <div className="space-y-1 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                                         {commonVariables.map(v => (
                                            <button 
                                               key={v}
                                               onClick={() => insertVariable(v)}
                                               className="w-full text-left px-2 py-1.5 text-[9px] font-mono bg-gray-50 border border-transparent hover:border-amber-600/30 hover:bg-amber-50 transition-all truncate group flex justify-between items-center"
                                            >
                                               <span>{v}</span>
                                               <Plus className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </button>
                                         ))}
                                         <div className="pt-2 border-t border-gray-100 mt-2">
                                            <div className="flex gap-1">
                                               <input 
                                                  id="custom-var-input"
                                                  type="text"
                                                  placeholder="Custom Name..."
                                                  className="flex-1 p-1.5 text-[9px] font-mono border border-gray-200 focus:outline-none focus:border-amber-600"
                                                  onKeyDown={(e) => {
                                                     if (e.key === 'Enter') {
                                                        const val = (e.target as any).value;
                                                        if (val) {
                                                           insertVariable(val);
                                                           (e.target as any).value = '';
                                                        }
                                                     }
                                                  }}
                                               />
                                               <button 
                                                  onClick={() => {
                                                     const input = document.getElementById('custom-var-input') as HTMLInputElement;
                                                     if (input && input.value) {
                                                        insertVariable(input.value);
                                                        input.value = '';
                                                     }
                                                  }}
                                                  className="px-2 bg-emerald-600 text-white text-[10px] font-mono"
                                               >
                                                  +
                                               </button>
                                            </div>
                                         </div>
                                      </div>
                                   </div>

                                   <div className="p-4 border border-blue-600/10 bg-blue-50/20 rounded-sm">
                                      <p className="text-[8px] font-mono text-blue-800 leading-relaxed uppercase">
                                         Detected variables will appear in the "Dynamic Variable Logic" section above after saving.
                                      </p>
                                   </div>
                                </div>
                             </div>
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
                      <button 
                        onClick={() => setIsRegisterAssetOpen(true)}
                        className="px-6 py-2 bg-[#141414] text-white text-[10px] font-mono font-bold uppercase tracking-widest hover:invert transition-all flex items-center gap-2"
                      >
                        <Plus className="w-3 h-3" /> Register Concluded Doc
                      </button>
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

      {/* Settings Tab */}
      <AnimatePresence>
        {activeTab === 'settings' && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed inset-0 top-[65px] bg-[#FDFDFD] z-40 p-12 overflow-y-auto"
          >
             <div className="max-w-4xl mx-auto space-y-12">
                <div className="border-b border-[#141414]/10 pb-8 text-center">
                   <h2 className="text-3xl font-mono font-bold uppercase tracking-tighter">System Configuration</h2>
                   <p className="text-xs font-mono text-[#141414]/40 mt-2">ENVIRONMENT VARIABLES & APP-WIDE LOGIC OVERRIDES</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                   <div className="space-y-8">
                      <section className="p-6 border border-[#141414]/10 bg-white space-y-6">
                        <div className="flex items-center gap-2 border-b border-[#141414]/10 pb-3">
                           <ShieldCheck className="w-4 h-4 text-emerald-600" />
                           <h3 className="text-xs font-mono font-bold uppercase">Company Identity</h3>
                        </div>
                        <div className="space-y-4">
                           <div className="space-y-1">
                              <label className="text-[9px] font-mono font-bold text-[#141414]/50 uppercase">Legal Name</label>
                              <input 
                                value={appSettings.COMPANY_NAME || companyProfile?.name || ""} 
                                onChange={e => setAppSettings({...appSettings, COMPANY_NAME: e.target.value})}
                                className="w-full text-xs font-mono p-2 bg-gray-50 border-none focus:ring-1 focus:ring-[#141414]"
                              />
                           </div>
                           <div className="space-y-1">
                              <label className="text-[9px] font-mono font-bold text-[#141414]/50 uppercase">Primary Address</label>
                              <textarea 
                                value={appSettings.COMPANY_ADDRESS || companyProfile?.address || ""} 
                                rows={2}
                                onChange={e => setAppSettings({...appSettings, COMPANY_ADDRESS: e.target.value})}
                                className="w-full text-xs font-mono p-2 bg-gray-50 border-none focus:ring-1 focus:ring-[#141414] resize-none"
                              />
                           </div>
                           <div className="space-y-1">
                              <label className="text-[9px] font-mono font-bold text-[#141414]/50 uppercase">Representative</label>
                              <input 
                                value={appSettings.COMPANY_REPRESENTATIVE || companyProfile?.representative || ""} 
                                onChange={e => setAppSettings({...appSettings, COMPANY_REPRESENTATIVE: e.target.value})}
                                className="w-full text-xs font-mono p-2 bg-gray-50 border-none focus:ring-1 focus:ring-[#141414]"
                              />
                           </div>
                        </div>
                        <button 
                          onClick={() => {
                            fetch('/api/master/app-settings', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ settings: appSettings })
                            }).then(() => {
                              showNotification("Company Identity Synchronized", "success");
                              // Refresh profile
                              fetch('/api/master/company-profile').then(r => r.json()).then(p => setCompanyProfile(p));
                            });
                          }}
                          className="w-full py-2 bg-[#141414] text-white font-mono text-[10px] font-bold uppercase tracking-widest hover:invert transition-all"
                        >Update Identity</button>
                      </section>

                      <section className="p-6 border border-[#141414]/10 bg-white space-y-6">
                        <div className="flex items-center gap-2 border-b border-[#141414]/10 pb-3">
                           <GitBranch className="w-4 h-4 text-blue-600" />
                           <h3 className="text-xs font-mono font-bold uppercase">Backlog Integration</h3>
                        </div>
                        <div className="space-y-4">
                           <div className="p-3 bg-blue-50 border border-blue-100 rounded-sm">
                              <p className="text-[9px] font-mono text-blue-800 uppercase flex items-center gap-2">
                                <CheckCircle2 className="w-3 h-3" /> Status: {appSettings.BACKLOG_API_KEY ? "Configured" : "Env Only"}
                              </p>
                           </div>
                           <div className="space-y-3">
                              <div className="space-y-1">
                                 <label className="text-[9px] font-mono font-bold text-[#141414]/50 uppercase">API Key</label>
                                 <input 
                                   type="password" 
                                   value={appSettings.BACKLOG_API_KEY || ""} 
                                   onChange={e => setAppSettings({...appSettings, BACKLOG_API_KEY: e.target.value})}
                                   placeholder="Your Backlog API Key"
                                   className="w-full text-xs font-mono p-2 bg-gray-50 border-none focus:ring-1 focus:ring-blue-500"
                                 />
                              </div>
                              <div className="space-y-1">
                                 <label className="text-[9px] font-mono font-bold text-[#141414]/50 uppercase">Space Host</label>
                                 <input 
                                   value={appSettings.BACKLOG_HOST || ""} 
                                   onChange={e => setAppSettings({...appSettings, BACKLOG_HOST: e.target.value})}
                                   placeholder="example.backlog.com"
                                   className="w-full text-xs font-mono p-2 bg-gray-50 border-none focus:ring-1 focus:ring-blue-500"
                                 />
                              </div>
                              <div className="space-y-1">
                                 <label className="text-[9px] font-mono font-bold text-[#141414]/50 uppercase">Project Key</label>
                                 <input 
                                   value={appSettings.BACKLOG_PROJECT_KEY || ""} 
                                   onChange={e => setAppSettings({...appSettings, BACKLOG_PROJECT_KEY: e.target.value})}
                                   placeholder="LEGAL"
                                   className="w-full text-xs font-mono p-2 bg-gray-50 border-none focus:ring-1 focus:ring-blue-500"
                                 />
                              </div>
                              <button 
                                onClick={() => {
                                  fetch('/api/master/app-settings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ settings: appSettings })
                                  }).then(() => showNotification("Backlog Settings Saved", "success"));
                                }}
                                className="w-full py-2 bg-blue-600 text-white font-mono text-[9px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all mt-2"
                              >Apply Settings</button>
                           </div>
                        </div>
                      </section>
                   </div>

                   <div className="space-y-8">
                      <section className="p-6 border border-[#141414]/10 bg-white space-y-6">
                        <div className="flex items-center gap-2 border-b border-[#141414]/10 pb-3">
                           <Users className="w-4 h-4 text-blue-400" />
                           <h3 className="text-xs font-mono font-bold uppercase">Slack Bot Workspace</h3>
                        </div>
                        <div className="space-y-4">
                           <div className="p-3 bg-blue-50 border border-blue-100 rounded-sm">
                              <p className="text-[9px] font-mono text-blue-800 uppercase flex items-center gap-2">
                                <CheckCircle2 className="w-3 h-3" /> Status: {appSettings.SLACK_BOT_TOKEN ? "Configured" : "Env Only"}
                              </p>
                           </div>
                           <div className="space-y-3">
                              <div className="space-y-1">
                                 <label className="text-[9px] font-mono font-bold text-[#141414]/50 uppercase">Bot Token</label>
                                 <input 
                                   type="password" 
                                   value={appSettings.SLACK_BOT_TOKEN || ""} 
                                   onChange={e => setAppSettings({...appSettings, SLACK_BOT_TOKEN: e.target.value})}
                                   placeholder="xoxb-..."
                                   className="w-full text-xs font-mono p-2 bg-gray-50 border-none focus:ring-1 focus:ring-blue-500"
                                 />
                              </div>
                              <div className="space-y-1">
                                 <label className="text-[9px] font-mono font-bold text-[#141414]/50 uppercase">Signing Secret</label>
                                 <input 
                                   type="password" 
                                   value={appSettings.SLACK_SIGNING_SECRET || ""} 
                                   onChange={e => setAppSettings({...appSettings, SLACK_SIGNING_SECRET: e.target.value})}
                                   className="w-full text-xs font-mono p-2 bg-gray-50 border-none focus:ring-1 focus:ring-blue-500"
                                 />
                              </div>
                           </div>
                           <div className="space-y-2 pt-4 border-t border-dashed">
                              <p className="text-[9px] font-mono font-bold uppercase">Reply Templates</p>
                              <div className="space-y-4">
                                 <div className="space-y-1">
                                    <label className="text-[8px] font-mono text-gray-400">User Reception (DM)</label>
                                    <textarea 
                                      value={appSettings['slack_answer_back_user']?.template || ''}
                                      onChange={(e) => setAppSettings({
                                        ...appSettings,
                                        slack_answer_back_user: { ...appSettings['slack_answer_back_user'], template: e.target.value }
                                      })}
                                      className="w-full text-[10px] font-mono p-2 bg-gray-50 border-none focus:ring-1 focus:ring-blue-500 h-20 resize-none"
                                    />
                                 </div>
                                 <div className="space-y-1">
                                    <label className="text-[8px] font-mono text-gray-400">Overdue Alert Alarm</label>
                                    <textarea 
                                      value={appSettings['slack_overdue_alert']?.template || ''}
                                      onChange={(e) => setAppSettings({
                                        ...appSettings,
                                        slack_overdue_alert: { ...appSettings['slack_overdue_alert'] || {}, template: e.target.value }
                                      })}
                                      className="w-full text-[10px] font-mono p-2 bg-gray-50 border-none focus:ring-1 focus:ring-blue-500 h-20 resize-none"
                                    />
                                    <p className="text-[8px] font-mono text-gray-400 italic">Available: {"{{mention}}, {{issueKey}}, {{summary}}, {{counterparty}}, {{deadline}}"}</p>
                                 </div>
                                 <div className="space-y-1">
                                    <label className="text-[8px] font-mono text-gray-400">Document Generated Notification</label>
                                    <textarea 
                                      value={appSettings['slack_document_generated']?.template || ''}
                                      onChange={(e) => setAppSettings({
                                        ...appSettings,
                                        slack_document_generated: { ...appSettings['slack_document_generated'] || {}, template: e.target.value }
                                      })}
                                      className="w-full text-[10px] font-mono p-2 bg-gray-50 border-none focus:ring-1 focus:ring-blue-500 h-20 resize-none"
                                    />
                                    <p className="text-[8px] font-mono text-gray-400 italic">Available: {"{{issueKey}}, {{summary}}, {{type}}, {{link}}"}</p>
                                 </div>
                                 <div className="space-y-1">
                                    <label className="text-[8px] font-mono text-gray-400">Bulk Import Done Notification</label>
                                    <textarea 
                                      value={appSettings['slack_bulk_import_done']?.template || ''}
                                      onChange={(e) => setAppSettings({
                                        ...appSettings,
                                        slack_bulk_import_done: { ...appSettings['slack_bulk_import_done'] || {}, template: e.target.value }
                                      })}
                                      className="w-full text-[10px] font-mono p-2 bg-gray-50 border-none focus:ring-1 focus:ring-blue-500 h-20 resize-none"
                                    />
                                    <p className="text-[8px] font-mono text-gray-400 italic">Available: {"{{processedCount}}"}</p>
                                 </div>
                                 <div className="space-y-1">
                                    <label className="text-[8px] font-mono text-gray-400">Channel Notification</label>
                                    <textarea 
                                      value={appSettings['slack_answer_back_channel']?.template || ''}
                                      onChange={(e) => setAppSettings({
                                        ...appSettings,
                                        slack_answer_back_channel: { ...appSettings['slack_answer_back_channel'], template: e.target.value }
                                      })}
                                      className="w-full text-[10px] font-mono p-2 bg-gray-50 border-none focus:ring-1 focus:ring-blue-500 h-20 resize-none"
                                    />
                                 </div>
                              </div>
                              <button 
                                onClick={() => {
                                  fetch('/api/master/app-settings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ settings: appSettings })
                                  }).then(() => showNotification("Slack Templates Persisted", "success"));
                                }}
                                className="w-full py-2 border border-blue-600 text-blue-600 font-mono text-[9px] font-bold uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all"
                              >Save Templates</button>
                           </div>
                        </div>
                      </section>

                      <section className="p-6 border border-[#141414]/10 bg-white space-y-4">
                         <div className="flex items-center gap-2 border-b border-[#141414]/10 pb-3">
                            <Database className="w-4 h-4 text-purple-600" />
                            <h3 className="text-xs font-mono font-bold uppercase">Database Hygiene</h3>
                         </div>
                         <p className="text-[10px] font-mono text-gray-400 uppercase italic leading-relaxed">
                            WARNING: Data reconciliation is automatic, but manual overrides can lead to relational inconsistencies.
                         </p>
                         <div className="grid grid-cols-2 gap-4">
                            <button className="py-2 border border-[#141414]/20 text-[9px] font-mono font-bold uppercase hover:bg-red-500 hover:text-white hover:border-red-500 transition-all">Clear Session</button>
                            <button className="py-2 border border-[#141414]/20 text-[9px] font-mono font-bold uppercase hover:bg-orange-500 hover:text-white hover:border-orange-500 transition-all">Sync Assets</button>
                         </div>
                      </section>
                   </div>
                </div>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Asset Picker Overlay */}
      <AnimatePresence>
        {isRegisterAssetOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center px-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#FDFDFD]/90 backdrop-blur-md"
              onClick={() => setIsRegisterAssetOpen(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              className="w-full max-w-xl bg-white border-2 border-[#141414] shadow-[20px_20px_0px_0px_rgba(20,20,20,0.05)] z-10 overflow-hidden"
            >
              <div className="px-6 py-4 bg-[#141414] text-white flex items-center justify-between">
                 <div className="flex items-center gap-3">
                    <Archive className="w-5 h-5 text-purple-400" />
                    <h3 className="text-xs font-mono font-bold uppercase tracking-widest">Register Concluded Document</h3>
                 </div>
                 <button onClick={() => setIsRegisterAssetOpen(false)} className="hover:rotate-90 transition-transform">
                   <X className="w-5 h-5" />
                 </button>
              </div>
              <div className="p-8 space-y-6">
                 <div className="space-y-4">
                    <div className="space-y-1">
                       <label className="text-[9px] font-mono font-bold uppercase text-[#141414]/40">Document Name / Title</label>
                       <input 
                         type="text"
                         className="w-full bg-gray-50 p-2 text-xs font-mono border-b border-transparent focus:border-purple-600 outline-none"
                         placeholder="e.g. Master Service Agreement - Acme Corp"
                         value={newAssetData.asset_name}
                         onChange={(e) => setNewAssetData({...newAssetData, asset_name: e.target.value})}
                       />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                       <div className="space-y-1">
                          <label className="text-[9px] font-mono font-bold uppercase text-[#141414]/40">Document Type</label>
                          <select 
                            className="w-full bg-gray-50 p-2 text-xs font-mono border-b border-transparent focus:border-purple-600 outline-none"
                            value={newAssetData.asset_type}
                            onChange={(e) => setNewAssetData({...newAssetData, asset_type: e.target.value})}
                          >
                             <option value="contract">Basic Contract (基本契約書)</option>
                             <option value="individual">Individual Terms (個別契約/発注)</option>
                             <option value="nda">NDA (秘密保持契約書)</option>
                             <option value="memorandum">Memorandum (覚書)</option>
                             <option value="other">Other (その他)</option>
                          </select>
                       </div>
                       <div className="space-y-1">
                          <label className="text-[9px] font-mono font-bold uppercase text-[#141414]/40">Counterparty</label>
                          <input 
                            type="text"
                            className="w-full bg-gray-50 p-2 text-xs font-mono border-b border-transparent focus:border-purple-600 outline-none"
                            placeholder="Counterparty name"
                            value={newAssetData.counterparty}
                            onChange={(e) => setNewAssetData({...newAssetData, counterparty: e.target.value})}
                          />
                       </div>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[9px] font-mono font-bold uppercase text-[#141414]/40">Cloud Drive Link (URL)</label>
                       <div className="flex gap-2">
                          <Link className="w-4 h-4 mt-2 text-[#141414]/20" />
                          <input 
                            type="text"
                            className="flex-1 bg-gray-50 p-2 text-xs font-mono border-b border-transparent focus:border-purple-600 outline-none"
                            placeholder="https://drive.google.com/..."
                            value={newAssetData.file_link}
                            onChange={(e) => setNewAssetData({...newAssetData, file_link: e.target.value})}
                          />
                       </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                       <div className="space-y-1">
                          <label className="text-[9px] font-mono font-bold uppercase text-[#141414]/40">Execution Date (開始日)</label>
                          <input 
                            type="date"
                            className="w-full bg-gray-50 p-2 text-xs font-mono border-b border-transparent focus:border-purple-600 outline-none"
                            value={newAssetData.start_date}
                            onChange={(e) => setNewAssetData({...newAssetData, start_date: e.target.value})}
                          />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[9px] font-mono font-bold uppercase text-[#141414]/40">Expiry Date (終了日)</label>
                          <input 
                            type="date"
                            className="w-full bg-gray-50 p-2 text-xs font-mono border-b border-transparent focus:border-purple-600 outline-none"
                            value={newAssetData.end_date}
                            onChange={(e) => setNewAssetData({...newAssetData, end_date: e.target.value})}
                          />
                       </div>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[9px] font-mono font-bold uppercase text-[#141414]/40">Linked Backlog Key (Optional)</label>
                       <input 
                         type="text"
                         className="w-full bg-gray-50 p-2 text-xs font-mono border-b border-transparent focus:border-purple-600 outline-none"
                         placeholder="PROJ-123"
                         value={newAssetData.backlog_issue_key}
                         onChange={(e) => setNewAssetData({...newAssetData, backlog_issue_key: e.target.value})}
                       />
                    </div>
                 </div>
                 
                 <div className="pt-4 flex gap-4">
                    <button 
                      onClick={handleRegisterAsset}
                      disabled={!newAssetData.asset_name || !newAssetData.counterparty}
                      className="flex-1 py-3 bg-[#141414] text-white text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-purple-700 transition-all disabled:opacity-30"
                    >
                      Confirm Registration
                    </button>
                    <button 
                      onClick={() => setIsRegisterAssetOpen(false)}
                      className="px-6 py-3 border border-[#141414]/10 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-gray-50 transition-all"
                    >
                      Cancel
                    </button>
                 </div>
              </div>
            </motion.div>
          </div>
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
                                     if (assetPickerCallback) {
                                       assetPickerCallback(asset);
                                       setAssetPickerCallback(null);
                                       setIsAssetPickerOpen(false);
                                       return;
                                     }
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

      {/* Staff Detail Modal */}
      <AnimatePresence>
        {selectedStaffDetail && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setSelectedStaffDetail(null);
                setIsEditingStaff(false);
              }}
              className="absolute inset-0 bg-[#FDFDFD]/95 backdrop-blur-xl"
            />
            <motion.div 
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              className="relative w-full max-w-4xl max-h-[90vh] bg-white border border-[#141414] shadow-2xl z-10 flex flex-col overflow-hidden"
            >
              <div className="p-4 bg-[#141414] text-white flex justify-between items-center">
                 <div className="flex items-center gap-3">
                    <User className="w-5 h-5 text-blue-400" />
                    <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest">Internal Staff Identity</h3>
                 </div>
                 <button onClick={() => {
                    setSelectedStaffDetail(null);
                    setIsEditingStaff(false);
                 }} className="hover:rotate-90 transition-transform">
                    <Plus className="w-5 h-5 rotate-45" />
                 </button>
              </div>
              
              <div className="flex-1 overflow-auto p-12 bg-gray-50/50">
                 <div className="grid grid-cols-12 gap-12">
                    <div className="col-span-4 space-y-8">
                       <div className="text-center p-8 bg-white border border-[#141414]/10 rounded-sm">
                          <div className="w-20 h-20 bg-blue-600 text-white text-3xl font-mono flex items-center justify-center mx-auto mb-6">
                             {selectedStaffDetail.staff_name.charAt(0)}
                          </div>
                          <h4 className="text-lg font-mono font-bold uppercase truncate">{selectedStaffDetail.staff_name}</h4>
                          <p className="text-[10px] font-mono text-blue-600 font-bold mt-1">@{selectedStaffDetail.slack_user_id}</p>
                       </div>
                    </div>

                    <div className="col-span-8 space-y-10 bg-white p-8 border border-[#141414]/10">
                       <div className="flex justify-between items-center border-b border-[#141414]/10 pb-4">
                          <h5 className="text-[11px] font-mono font-bold uppercase tracking-widest text-[#141414]/60">Member Profile</h5>
                          <button 
                            onClick={() => setIsEditingStaff(!isEditingStaff)}
                            className="text-[10px] font-mono font-bold uppercase px-4 py-1 border border-[#141414]/20 hover:bg-[#141414] hover:text-white transition-all"
                          >
                             {isEditingStaff ? "CANCEL EDIT" : "EDIT PROFILE"}
                          </button>
                       </div>

                       <div className="grid grid-cols-2 gap-y-8 gap-x-12">
                          <div className="space-y-1">
                            <label className="text-[9px] font-mono font-bold text-gray-400 uppercase">氏名 / Name</label>
                            {isEditingStaff ? (
                               <input value={selectedStaffDetail.staff_name} onChange={e => setSelectedStaffDetail({...selectedStaffDetail, staff_name: e.target.value})} className="w-full text-xs font-mono p-2 border border-blue-200 focus:outline-none" />
                            ) : (
                               <p className="text-xs font-mono uppercase font-bold">{selectedStaffDetail.staff_name}</p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-mono font-bold text-gray-400 uppercase">部署名 / Department</label>
                            {isEditingStaff ? (
                               <input value={selectedStaffDetail.department} onChange={e => setSelectedStaffDetail({...selectedStaffDetail, department: e.target.value})} className="w-full text-xs font-mono p-2 border border-blue-200 focus:outline-none" />
                            ) : (
                               <p className="text-xs font-mono uppercase font-bold">{selectedStaffDetail.department || 'GLOBAL'}</p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-mono font-bold text-gray-400 uppercase">部署コード / Dept Code</label>
                            {isEditingStaff ? (
                               <input value={selectedStaffDetail.department_code} maxLength={3} onChange={e => setSelectedStaffDetail({...selectedStaffDetail, department_code: e.target.value.toUpperCase()})} className="w-full text-xs font-mono p-2 border border-blue-200 focus:outline-none" placeholder="e.g. DOM" />
                            ) : (
                               <p className="text-[10px] font-mono uppercase font-bold text-blue-600">{selectedStaffDetail.department_code || '---'}</p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-mono font-bold text-gray-400 uppercase">メールアドレス / Email</label>
                            {isEditingStaff ? (
                               <input value={selectedStaffDetail.email} onChange={e => setSelectedStaffDetail({...selectedStaffDetail, email: e.target.value})} className="w-full text-xs font-mono p-2 border border-blue-200 focus:outline-none" />
                            ) : (
                               <p className="text-[10px] font-mono font-bold">{selectedStaffDetail.email || 'NO_ALIAS'}</p>
                            )}
                          </div>
                       </div>

                       {isEditingStaff && (
                          <div className="flex gap-4 pt-4 border-t border-gray-100">
                             <button 
                               onClick={() => {
                                  fetch('/api/master/staff', {
                                     method: 'POST',
                                     headers: { 'Content-Type': 'application/json' },
                                     body: JSON.stringify(selectedStaffDetail)
                                  }).then(r => {
                                     if(r.ok) {
                                        showNotification("Profile Synchronized", "success");
                                        setIsEditingStaff(false);
                                        // Refresh basic list
                                        fetch('/api/master/staff').then(res => res.json()).then(data => setStaffList(data));
                                     }
                                  });
                               }}
                               className="px-8 py-3 bg-[#141414] text-white font-mono text-[10px] font-bold uppercase tracking-widest hover:invert transition-all"
                             >
                                SYNC TO MASTER DB
                             </button>
                             <button 
                               onClick={() => setIsEditingStaff(false)}
                               className="px-8 py-3 bg-gray-100 text-gray-600 font-mono text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-all"
                             >
                                REJECT
                             </button>
                          </div>
                       )}
                    </div>
                 </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Vendor Detail Modal */}
      <AnimatePresence>
        {selectedVendorDetail && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#FDFDFD]/95 backdrop-blur-xl"
              onClick={() => setSelectedVendorDetail(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="w-full max-w-4xl max-h-[90vh] bg-white border border-[#141414] shadow-2xl z-10 flex flex-col overflow-hidden"
            >
              <div className="p-4 bg-[#141414] text-white flex justify-between items-center">
                 <div className="flex items-center gap-3">
                    <Building2 className="w-5 h-5 text-orange-400" />
                    <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest">Partner Identity Detail</h3>
                 </div>
                 <button onClick={() => setSelectedVendorDetail(null)} className="hover:rotate-90 transition-transform">
                    <Plus className="w-5 h-5 rotate-45" />
                 </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-12 bg-gray-50/50">
                 <div className="grid grid-cols-12 gap-12">
                    <div className="col-span-4 space-y-8">
                       <div className="text-center p-8 bg-white border border-[#141414]/10 rounded-sm">
                          <div className="w-20 h-20 bg-[#141414] text-white text-3xl font-mono flex items-center justify-center mx-auto mb-6">
                             {selectedVendorDetail.vendor_name.charAt(0)}
                          </div>
                          <h4 className="text-lg font-mono font-bold uppercase truncate">{selectedVendorDetail.vendor_name}</h4>
                          <p className="text-[10px] font-mono text-orange-600 font-bold mt-1">{selectedVendorDetail.vendor_code}</p>
                       </div>

                       <div className="p-6 bg-orange-50 border border-orange-100 space-y-4">
                          <h5 className="text-[9px] font-mono font-bold uppercase text-orange-900 border-b border-orange-200 pb-2 flex items-center gap-2">
                             <Upload className="w-3 h-3" /> 変更届の登録 (Upload Change Request)
                          </h5>
                          <p className="text-[8px] font-mono text-orange-800 leading-relaxed uppercase">
                             Googleドライブに保管された変更通知文書を紐付けます。
                          </p>
                          <div className="space-y-2">
                             <input 
                                type="file" 
                                id="change-request-v" 
                                className="hidden" 
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  
                                  const formDataUpload = new FormData();
                                  formDataUpload.append('file', file);
                                  formDataUpload.append('vendor_code', selectedVendorDetail.vendor_code);
                                  
                                  setIsUploadingChangeRequest(true);
                                  try {
                                    const res = await fetch('/api/master/vendors/upload-change-request', {
                                      method: 'POST',
                                      body: formDataUpload
                                    });
                                    const data = await res.json();
                                    if (data.success) {
                                      showNotification("Change request uploaded to Google Drive", "success");
                                      // Potentially update vendor record with the link
                                      setSelectedVendorDetail({ ...selectedVendorDetail, last_change_request_link: data.driveLink });
                                    }
                                  } catch (err) {
                                    showNotification("Upload failed", "error");
                                  } finally {
                                    setIsUploadingChangeRequest(false);
                                  }
                                }}
                             />
                             <button 
                                onClick={() => document.getElementById('change-request-v')?.click()}
                                disabled={isUploadingChangeRequest}
                                className="w-full py-2 bg-orange-600 text-white font-mono text-[9px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-orange-700 transition-all disabled:opacity-50"
                             >
                                {isUploadingChangeRequest ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                UPLOAD TO DRIVE
                             </button>
                             {selectedVendorDetail.last_change_request_link && (
                               <a 
                                 href={selectedVendorDetail.last_change_request_link} 
                                 target="_blank" 
                                 rel="noreferrer"
                                 className="block text-center py-1 text-[9px] font-mono text-blue-600 underline uppercase truncate"
                               >
                                 VIEW LATEST ATTACHMENT
                               </a>
                             )}
                          </div>
                       </div>
                    </div>

                    <div className="col-span-8 space-y-8 bg-white p-8 border border-[#141414]/10">
                       <div className="flex justify-between items-center border-b border-[#141414]/10 pb-4">
                          <h4 className="text-xs font-mono font-bold uppercase tracking-widest">Identity Parameters</h4>
                          <button 
                            onClick={() => setIsEditingVendor(!isEditingVendor)}
                            className="text-[10px] font-mono font-bold uppercase px-4 py-1 border border-[#141414]/20 hover:bg-[#141414] hover:text-white transition-all"
                          >
                             {isEditingVendor ? "CANCEL EDIT" : "EDIT PROFILE"}
                          </button>
                       </div>

                       <div className="grid grid-cols-2 gap-8">
                          <div className="space-y-4">
                             <div className="space-y-1">
                                <label className="text-[9px] font-mono font-bold text-gray-400 uppercase">Trade Name / Alias</label>
                                {isEditingVendor ? (
                                   <input value={selectedVendorDetail.trade_name} onChange={e => setSelectedVendorDetail({...selectedVendorDetail, trade_name: e.target.value})} className="w-full text-xs font-mono p-2 border border-gray-200" />
                                ) : (
                                   <p className="text-xs font-mono uppercase font-bold">{selectedVendorDetail.trade_name || 'NOT DEFINED'}</p>
                                )}
                             </div>
                             <div className="space-y-1">
                                <label className="text-[9px] font-mono font-bold text-gray-400 uppercase">Entity Type</label>
                                {isEditingVendor ? (
                                   <select value={selectedVendorDetail.entity_type} onChange={e => setSelectedVendorDetail({...selectedVendorDetail, entity_type: e.target.value})} className="w-full text-xs font-mono p-2 border border-gray-200">
                                      <option value="corporate">法人 (Corporate)</option>
                                      <option value="individual">個人 (Individual)</option>
                                   </select>
                                ) : (
                                   <p className="text-xs font-mono uppercase">{selectedVendorDetail.entity_type === 'corporate' ? '法人' : '個人'}</p>
                                )}
                             </div>
                             <div className="space-y-1">
                                <label className="text-[9px] font-mono font-bold text-gray-400 uppercase">Tax Registration No.</label>
                                {isEditingVendor ? (
                                   <input value={selectedVendorDetail.invoice_registration_number} onChange={e => setSelectedVendorDetail({...selectedVendorDetail, invoice_registration_number: e.target.value})} className="w-full text-xs font-mono p-2 border border-gray-200" />
                                ) : (
                                   <p className="text-[10px] font-mono uppercase font-bold">{selectedVendorDetail.invoice_registration_number || 'T--'}</p>
                                )}
                             </div>
                          </div>

                          <div className="space-y-4 border-l border-gray-50 pl-8">
                             <div className="space-y-1">
                                <label className="text-[9px] font-mono font-bold text-gray-400 uppercase">Contact Information</label>
                                <div className="space-y-2 mt-2">
                                   <div className="flex items-center gap-2 text-xs font-mono">
                                      <span className="opacity-40 uppercase">Email:</span>
                                      {isEditingVendor ? (
                                         <input value={selectedVendorDetail.email} onChange={e => setSelectedVendorDetail({...selectedVendorDetail, email: e.target.value})} className="flex-1 text-[10px] p-1 border" />
                                      ) : (
                                         <span>{selectedVendorDetail.email || 'N/A'}</span>
                                      )}
                                   </div>
                                   <div className="flex items-center gap-2 text-xs font-mono">
                                      <span className="opacity-40 uppercase">Rep:</span>
                                      {isEditingVendor ? (
                                         <input value={selectedVendorDetail.contact_name} onChange={e => setSelectedVendorDetail({...selectedVendorDetail, contact_name: e.target.value})} className="flex-1 text-[10px] p-1 border" />
                                      ) : (
                                         <span>{selectedVendorDetail.contact_name || 'N/A'}</span>
                                      )}
                                   </div>
                                </div>
                             </div>
                             <div className="space-y-1 pt-4 border-t border-gray-50 mt-4">
                                <label className="text-[9px] font-mono font-bold text-gray-400 uppercase">Financial Node</label>
                                <p className="text-[10px] font-mono uppercase mt-1">{selectedVendorDetail.bank_name} {selectedVendorDetail.branch_name}</p>
                                <p className="text-[10px] font-mono mt-0.5">{selectedVendorDetail.account_type || '普通'} {selectedVendorDetail.account_number}</p>
                             </div>
                          </div>
                       </div>
                       
                       {isEditingVendor && (
                          <div className="pt-8 border-t border-gray-100 flex gap-4">
                             <button 
                                onClick={() => {
                                   fetch('/api/master/vendors', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify(selectedVendorDetail)
                                   }).then(() => {
                                      showNotification("Identity parameters synchronized", "success");
                                      setIsEditingVendor(false);
                                      // Refresh vendors list
                                      fetch('/api/master/vendors').then(r => r.json()).then(d => setVendors(d));
                                   });
                                }}
                                className="flex-1 py-3 bg-emerald-600 text-white font-mono text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all"
                             >
                                COMMIT CHANGES
                             </button>
                             <button 
                                onClick={() => setIsEditingVendor(false)}
                                className="px-8 py-3 bg-gray-100 text-gray-600 font-mono text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-all"
                             >
                                REJECT
                             </button>
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
      {/* Notification Toast */}
      <AnimatePresence>
         {notification && (
            <motion.div 
               initial={{ opacity: 0, x: 20 }}
               animate={{ opacity: 1, x: 0 }}
               exit={{ opacity: 0, x: 20 }}
               className={`fixed top-8 right-8 z-[100] px-6 py-4 rounded-sm shadow-2xl border-l-4 font-mono text-[11px] flex items-center gap-4 ${
                  notification.type === 'success' ? 'bg-white border-emerald-500 text-emerald-900' : 
                  notification.type === 'error' ? 'bg-red-50 border-red-500 text-red-900' : 
                  'bg-white border-blue-500 text-blue-900'
               }`}
            >
               <div className="flex-1">
                  <p className="font-bold uppercase tracking-widest text-[9px] mb-1">{notification.type}</p>
                  <p>{notification.message}</p>
               </div>
               <button onClick={() => setNotification(null)} className="opacity-30 hover:opacity-100">
                  <X className="w-4 h-4" />
               </button>
            </motion.div>
         )}
      </AnimatePresence>
    </div>
  );
}
