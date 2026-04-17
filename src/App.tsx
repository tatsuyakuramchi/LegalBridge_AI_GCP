import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Shield, Slack, Database, AlertTriangle, CheckCircle2, RefreshCw, FileText, 
  X, Clock, BarChart3, ListChecks, Settings, Activity, Archive, Building2, 
  Users, ExternalLink, Lock, Search 
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface StatusData {
  status: "active" | "degraded";
  slackReady: boolean;
  backlogReady: boolean;
  backlogHost: string | null;
  backlogProjectKey: string | null;
  updatedAt: string;
  warnings: string[];
}

const DOCUMENT_TEMPLATES = [
  { id: "nda", name: "NDA (秘密保持契約書)" },
  { id: "purchase_order", name: "発注書 (Purchase Order)" },
  { id: "contract", name: "契約書 (Contract)" },
  { id: "sales_master_buyer", name: "売買基本契約書 (Buyer)" },
  { id: "service_master", name: "業務委託基本契約書" },
  { id: "planning_purchase_order", name: "企画発注書 (Planning PO)" },
  { id: "payment_notice", name: "支払通知書 (Payment Notice)" },
  { id: "fee_statement", name: "報酬明細書 (Fee Statement)" },
  { id: "license_report", name: "ライセンス報告書 (License Report)" },
  { id: "service_terms", name: "業務委託基本契約約款 (Terms)" },
  { id: "inspection_certificate", name: "検収書 (Inspection)" },
  { id: "inspection_certificate_detailed", name: "検収書 (Detailed)" },
  { id: "royalty_statement", name: "利用許諾料計算書 (Royalty)" },
  { id: "license_master", name: "ライセンス基本契約書" },
  { id: "individual_license_terms", name: "個別ライセンス条件書" },
  { id: "intl_amendment", name: "Amendment (Intl)" },
  { id: "intl_master", name: "License (Intl Master)" },
];

const WORKFLOW_TEMPLATES: Record<string, string[]> = {
  nda: ["nda"],
  legal_consultation: ["nda", "contract"],
  outsourcing: ["service_master", "service_terms", "contract"],
  license: ["license_master", "individual_license_terms", "intl_master", "intl_amendment", "royalty_statement"],
  purchase_order: ["purchase_order", "planning_purchase_order"],
  delivery_request: ["inspection_certificate", "inspection_certificate_detailed"],
  royalty_calculation_sales_report: ["royalty_statement", "payment_notice", "fee_statement"],
};

export default function App() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  
  const [issues, setIssues] = useState<any[]>([]);
  const [issueSearch, setIssueSearch] = useState("");
  const [selectedIssue, setSelectedIssue] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("nda");
  const [formData, setFormData] = useState<Record<string, string>>({});
  
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [royalties, setRoyalties] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"portal" | "deliveries" | "royalties" | "bulk" | "master" | "workflow" | "archive" | "assets">("portal");
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [docArchive, setDocArchive] = useState<any[]>([]);
  const [externalAssets, setExternalAssets] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [companyProfile, setCompanyProfile] = useState<any>(null);
  const [staffSearch, setStaffSearch] = useState("");
  const [showStaffPicker, setShowStaffPicker] = useState(false);
  const [csvContent, setCsvContent] = useState<string>("");
  const [importMode, setImportMode] = useState<"generic" | "publishing">("generic");
  const [isImporting, setIsImporting] = useState(false);
  
  // Dynamic Document Form
  const [templateFields, setTemplateFields] = useState<string[]>([]);
  const [isRefreshingFields, setIsRefreshingFields] = useState(false);
  const [isFetchingContext, setIsFetchingContext] = useState(false);
  const [alerts, setAlerts] = useState<any[]>([]);
  
  // Master Registration Modals
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  
  const [newVendor, setNewVendor] = useState({ vendor_code: "", vendor_name: "", email: "", address: "", bank_name: "", invoice_registration_number: "" });
  const [newStaff, setNewStaff] = useState({ slack_user_id: "", staff_name: "", department: "", department_code: "" });
  const [newRule, setNewRule] = useState({ department: "", approver_slack_id: "", stamp_operator_slack_id: "", manager_slack_id: "", slack_channel_id: "", is_active: true });
  const [newAsset, setNewAsset] = useState({ asset_name: "", asset_type: "contract", counterparty: "", status: "active", file_link: "", start_date: "", end_date: "", backlog_issue_key: "" });

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error("Failed to fetch status");
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError("Backend server not responding. Please check if the server is running.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchIssues = async () => {
    try {
      const res = await fetch("/api/backlog/issues");
      const data = await res.json();
      setIssues(data);
    } catch (err) {
      console.error("Failed to fetch issues", err);
    }
  };

  const fetchTemplateSchema = async (type: string) => {
    try {
      setIsRefreshingFields(true);
      const res = await fetch(`/api/templates/${type}/schema`);
      const data = await res.json();
      setTemplateFields(data.variables || []);
    } catch (err) {
      console.error("Failed to fetch template schema", err);
    } finally {
      setIsRefreshingFields(false);
    }
  };

  const autoFillForm = (issue: any, fields: string[]) => {
    const newFormData: Record<string, string> = { ...formData };
    
    // Look for matching Vendor in our master DB
    const matchedVendor = vendors.find(v => 
      issue.summary.includes(v.vendor_name) || 
      issue.description?.includes(v.vendor_name) ||
      (v.vendor_code && issue.summary.includes(v.vendor_code))
    );

    // Look for matching Staff in our master DB
    const matchedStaff = staff.find(s => 
      issue.summary.includes(s.staff_name) || 
      issue.description?.includes(s.staff_name) ||
      (issue.description?.includes(s.slack_user_id))
    );

    fields.forEach(field => {
      // 1. Direct match with Backlog summary or key
      if (field === "SUMMARY") newFormData[field] = issue.summary;
      if (field === "ISSUE_KEY") newFormData[field] = issue.issueKey;
      
      // 2. Vendor Data Auto-fill
      if (matchedVendor) {
        if (field === "PARTY_B_NAME" || field === "VENDOR_NAME" || field === "COMPANY") newFormData[field] = matchedVendor.vendor_name;
        if (field === "PARTY_B_ADDRESS" || field === "VENDOR_ADDRESS" || field === "ADDRESS") newFormData[field] = matchedVendor.address;
        if (field === "BANK_NAME" || field === "BANK_INFO") newFormData[field] = matchedVendor.bank_name;
        if (field === "VENDOR_CODE") newFormData[field] = matchedVendor.vendor_code;
        if (field === "INVOICE_NO" || field === "REGISTRATION_NUMBER") newFormData[field] = matchedVendor.invoice_registration_number;
      }

      // 3. Staff Data Auto-fill
      if (matchedStaff) {
        if (field === "STAFF_NAME" || field === "REQUESTER_NAME" || field === "PERSON_IN_CHARGE") newFormData[field] = matchedStaff.staff_name;
        if (field === "DEPARTMENT" || field === "DEPT_NAME") newFormData[field] = matchedStaff.department;
        if (field === "DEPT_CODE") newFormData[field] = matchedStaff.department_code;
      }

      // 4. Date mapping
      if (field.includes("DATE") && !newFormData[field]) {
        newFormData[field] = new Date().toLocaleDateString("ja-JP", { year: 'numeric', month: 'long', day: 'numeric' });
      }

      // 5. Try to find bracketed info in description [PARTY_B_NAME: Sample Corp] (Overlay match)
      const regex = new RegExp(`\\[${field}:\\s*(.*?)\\]`, "i");
      const match = issue.description?.match(regex);
      if (match) {
        newFormData[field] = match[1];
      }
    });

    setFormData(newFormData);
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch("/api/management/alerts");
      const data = await res.json();
      setAlerts(data.overdue || []);
    } catch (err) {
      console.error("Failed to fetch alerts", err);
    }
  };

  const fetchManagementData = async () => {
    try {
      const [delRes, royRes, venRes, staRes, rulRes, worRes, arcRes, astRes, comRes] = await Promise.all([
        fetch("/api/management/deliveries"),
        fetch("/api/management/royalties"),
        fetch("/api/master/vendors"),
        fetch("/api/master/staff"),
        fetch("/api/master/rules"),
        fetch("/api/management/workflows"),
        fetch("/api/management/documents"),
        fetch("/api/management/assets"),
        fetch("/api/master/company-profile")
      ]);
      const [delData, royData, venData, staData, rulData, worData, arcData, astData, comData] = await Promise.all([
        delRes.json(), 
        royRes.json(),
        venRes.json(),
        staRes.json(),
        rulRes.json(),
        worRes.json(),
        arcRes.json(),
        astRes.json(),
        comRes.json()
      ]);
      setDeliveries(delData);
      setRoyalties(royData);
      setVendors(venData || []);
      setStaff(staData || []);
      setRules(rulData || []);
      setWorkflows(worData || []);
      setDocArchive(arcData || []);
      setExternalAssets(astData || []);
      setCompanyProfile(comData);
    } catch (err) {
      console.error("Failed to fetch management data", err);
    }
  };

  const handleAutofillSelf = () => {
    if (!companyProfile) return;
    const newFormData = { ...formData };
    
    // Common keys for self/company
    const selfKeys = ["PARTY_A_NAME", "MY_COMPANY", "ISSUER_NAME", "COMPANY_NAME"];
    const selfAddrKeys = ["PARTY_A_ADDRESS", "MY_ADDRESS", "ISSUER_ADDRESS", "COMPANY_ADDRESS"];
    const selfRepKeys = ["PARTY_A_REPRESENTATIVE", "REPRESENTATIVE", "SIGNATORY"];
    const selfInvoKeys = ["PARTY_A_INVOICE_NO", "MY_INVOICE_NO", "REGISTRATION_NUMBER"];

    templateFields.forEach(field => {
      if (selfKeys.includes(field)) newFormData[field] = companyProfile.name;
      if (selfAddrKeys.includes(field)) newFormData[field] = companyProfile.address;
      if (selfRepKeys.includes(field)) newFormData[field] = companyProfile.representative;
      if (selfInvoKeys.includes(field)) newFormData[field] = companyProfile.invoice_no;
    });
    setFormData(newFormData);
  };

  const handleSelectStaffMember = (s: any) => {
    const newFormData = { ...formData };
    templateFields.forEach(field => {
      if (field === "STAFF_NAME" || field === "REQUESTER_NAME" || field === "PERSON_IN_CHARGE") newFormData[field] = s.staff_name;
      if (field === "DEPARTMENT" || field === "DEPT_NAME") newFormData[field] = s.department;
      if (field === "DEPT_CODE") newFormData[field] = s.department_code;
    });
    setFormData(newFormData);
    setShowStaffPicker(false);
    setStaffSearch("");
  };

  const handleFetchContext = async () => {
    if (!selectedIssue || !selectedTemplate) return;
    try {
      setIsFetchingContext(true);
      const res = await fetch(`/api/backlog/issues/${selectedIssue}/form-context?template=${selectedTemplate}`);
      const context = await res.json();
      
      const newFormData = { ...formData };
      Object.keys(context).forEach(key => {
        newFormData[key] = context[key];
      });
      setFormData(newFormData);
    } catch (err) {
      console.error("Failed to fetch context", err);
    } finally {
      setIsFetchingContext(false);
    }
  };

  const getVisibleTemplates = () => {
    if (!selectedIssue) return [];
    const issue = issues.find(i => i.issueKey === selectedIssue);
    if (!issue) return DOCUMENT_TEMPLATES;

    const match = issue.summary.match(/【(.*?)】/);
    const workflowKey = match ? match[1] : null;
    
    if (workflowKey && WORKFLOW_TEMPLATES[workflowKey]) {
      const allowedIds = WORKFLOW_TEMPLATES[workflowKey];
      return DOCUMENT_TEMPLATES.filter(t => allowedIds.includes(t.id));
    }

    return DOCUMENT_TEMPLATES;
  };

  const handleTestGenerate = async (type: string = "legal_request") => {
    try {
      setGenerating(true);
      const res = await fetch(`/api/test-generate?type=${type}`, { method: "POST" });
      const data = await res.json();
      setPreviewHtml(data.html);
    } catch (err) {
      console.error("Generation failed", err);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateDocument = async () => {
    if (!selectedIssue) {
      alert("課題を選択してください");
      return;
    }
    try {
      setGenerating(true);
      const res = await fetch("/api/documents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueKey: selectedIssue,
          templateType: selectedTemplate,
          formData,
          requesterEmail: "legal@example.com" // Mock
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(`ドキュメントを作成しました: ${data.driveLink}`);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      console.error("Generation failed", err);
      alert("作成に失敗しました");
    } finally {
      setGenerating(false);
    }
  };

  const renderDynamicField = (field: string, values: Record<string, string>, onChange: (v: Record<string, string>) => void) => {
    // Dynamic visibility logic
    const isBankInfo = field.includes("BANK_") || field.includes("ACCOUNT_");
    const paymentMethod = values["PAYMENT_METHOD"] || "";
    
    if (isBankInfo && paymentMethod !== "BANK_TRANSFER") {
      return null;
    }

    // Fee Structure dependent logic
    const feeStructure = values["FEE_STRUCTURE"] || "";
    const subscriptionFields = ["MONTHLY_FEE", "ANNUAL_FEE", "BILLING_CYCLE", "RENEWAL_TERMS"];
    const performanceFields = ["ROYALTY_RATE", "BASE_SALES", "CALCULATION_FORMULA", "MG_AMOUNT"];

    if (subscriptionFields.includes(field) && feeStructure !== "SUBSCRIPTION") return null;
    if (performanceFields.includes(field) && feeStructure !== "PERFORMANCE") return null;

    return (
      <div key={field} className="space-y-1 mb-4 p-2 border-l-2 border-[#141414]/10 hover:border-[#141414] transition-colors">
        <label className="tech-label">
          {field.replace(/_/g, " ")}
        </label>
        {field === "PAYMENT_METHOD" ? (
          <select
            value={values[field] || ""}
            onChange={(e) => onChange({...values, [field]: e.target.value})}
            className="tech-input bg-gray-50 font-bold"
          >
            <option value="">-- SELECT METHOD --</option>
            <option value="BANK_TRANSFER">BANK TRANSFER (銀行振込)</option>
            <option value="CASH">CASH (現金)</option>
            <option value="CREDIT_CARD">CREDIT CARD (カード)</option>
          </select>
        ) : field === "FEE_STRUCTURE" ? (
          <select
            value={values[field] || ""}
            onChange={(e) => onChange({...values, [field]: e.target.value})}
            className="tech-input bg-gray-50 font-bold"
          >
            <option value="">-- SELECT STRUCTURE --</option>
            <option value="FIXED">FIXED (固定金額)</option>
            <option value="SUBSCRIPTION">SUBSCRIPTION (定額サブスク)</option>
            <option value="PERFORMANCE">PERFORMANCE (業績連動/ロイヤリティ)</option>
          </select>
        ) : field === "CALCULATION_FORMULA" || field.includes("REMARKS") || field.includes("DESCRIPTION") || field.includes("TERMS") ? (
          <textarea 
            value={values[field] || ""}
            onChange={(e) => onChange({...values, [field]: e.target.value})}
            className="tech-input min-h-[100px]"
            placeholder={field === "CALCULATION_FORMULA" ? "例: (売上高 - 返品額) × 5%" : `ENTER ${field}...`}
          />
        ) : (
          <input 
            type={field.includes("DATE") ? "text" : "text"}
            value={values[field] || ""}
            onChange={(e) => onChange({...values, [field]: e.target.value})}
            className="tech-input"
            placeholder={`${field}...`}
          />
        )}
      </div>
    );
  };

  const handleImportCsv = async () => {
    if (!csvContent) return;
    try {
      setIsImporting(true);
      const res = await fetch(`/api/management/import-csv?mode=${importMode}`, {
        method: "POST",
        body: csvContent,
      });
      const data = await res.json();
      if (data.success) {
        alert(`${data.processedCount}件のインポートに成功しました。`);
        setCsvContent("");
        fetchManagementData();
      } else {
        alert(`インポート中にエラーが発生しました:\n${data.errors.join("\n")}`);
      }
    } catch (err) {
      console.error(err);
      alert("インポート失敗");
    } finally {
      setIsImporting(false);
    }
  };

  const handleAddVendor = async () => {
    try {
      const res = await fetch("/api/master/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newVendor)
      });
      if (res.ok) {
        setShowVendorModal(false);
        fetchManagementData();
        setNewVendor({ vendor_code: "", vendor_name: "", email: "", address: "", bank_name: "", invoice_registration_number: "" });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddStaff = async () => {
    try {
      const res = await fetch("/api/master/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newStaff)
      });
      if (res.ok) {
        setShowStaffModal(false);
        fetchManagementData();
        setNewStaff({ slack_user_id: "", staff_name: "", department: "", department_code: "" });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddRule = async () => {
    try {
      const res = await fetch("/api/master/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRule)
      });
      if (res.ok) {
        setShowRuleModal(false);
        fetchManagementData();
        setNewRule({ department: "", approver_slack_id: "", stamp_operator_slack_id: "", manager_slack_id: "", slack_channel_id: "", is_active: true });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddAsset = async () => {
    try {
      const res = await fetch("/api/management/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAsset)
      });
      if (res.ok) {
        setShowAssetModal(false);
        fetchManagementData();
        setNewAsset({ asset_name: "", asset_type: "contract", counterparty: "", status: "active", file_link: "", start_date: "", end_date: "", backlog_issue_key: "" });
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (selectedIssue) {
      const visible = getVisibleTemplates();
      if (visible.length > 0 && !visible.some(t => t.id === selectedTemplate)) {
        setSelectedTemplate(visible[0].id);
      }
    }
  }, [selectedIssue]);

  useEffect(() => {
    if (selectedTemplate) {
      fetchTemplateSchema(selectedTemplate);
    }
  }, [selectedTemplate]);

  useEffect(() => {
    if (selectedIssue && templateFields.length > 0) {
      const issue = issues.find(i => i.issueKey === selectedIssue);
      if (issue) {
        autoFillForm(issue, templateFields);
      }
    }
  }, [selectedIssue, templateFields, vendors, staff]);

  useEffect(() => {
    fetchStatus();
    fetchIssues();
    fetchManagementData();
    fetchAlerts();
    const interval = setInterval(() => {
      fetchStatus();
      fetchManagementData();
      fetchAlerts();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans p-6 md:p-12">
      <header className="max-w-6xl mx-auto mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-[#141414] pb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-8 h-8" />
            <h1 className="text-4xl font-bold tracking-tighter uppercase">LegalBridge</h1>
          </div>
          <p className="font-serif italic text-lg opacity-70">
            Slack × Backlog × GWS × Firebase 法務連携システム
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 border border-[#141414] p-1 bg-white">
            <select 
              onChange={(e) => handleTestGenerate(e.target.value)}
              disabled={generating}
              className="px-3 py-1 bg-transparent font-mono text-[10px] uppercase tracking-widest focus:outline-none cursor-pointer disabled:opacity-50"
              defaultValue="legal_request"
            >
              <option value="legal_request">依頼書 (Legal Request)</option>
              <option value="purchase_order">発注書 (Purchase Order)</option>
              <option value="contract">契約書 (Contract)</option>
              <option value="nda">NDA (秘密保持契約書)</option>
              <option value="planning_purchase_order">企画発注書 (Planning PO)</option>
              <option value="payment_notice">支払通知書 (Payment Notice)</option>
              <option value="fee_statement">報酬明細書 (Fee Statement)</option>
              <option value="license_report">ライセンス報告書 (License Report)</option>
              <option value="sales_master_buyer">売買基本契約書 (Buyer)</option>
              <option value="sales_master_credit">売買基本契約書 (Credit)</option>
              <option value="sales_master_standard">売買基本契約書 (Standard)</option>
              <option value="service_master">業務委託基本契約書 (Master)</option>
              <option value="service_terms">業務委託基本契約約款 (Terms)</option>
              <option value="inspection_certificate">検収書 (Inspection)</option>
              <option value="inspection_certificate_detailed">検収書 (Detailed)</option>
              <option value="payment_notice_alt">支払通知書 (Alt)</option>
              <option value="royalty_statement">利用許諾料計算書 (Royalty)</option>
              <option value="inspection_certificate_v2">検収書 (v2)</option>
              <option value="intl_amendment">Amendment (Intl)</option>
              <option value="intl_master">License (Intl Master)</option>
              <option value="individual_license_terms">個別ライセンス条件書</option>
              <option value="license_master">ライセンス基本契約書</option>
            </select>
            <button 
              onClick={() => {
                const select = document.querySelector('select');
                if (select) handleTestGenerate(select.value);
              }}
              disabled={generating}
              className="px-3 py-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors font-mono text-[10px] uppercase tracking-widest disabled:opacity-50 border-l border-[#141414]"
            >
              Preview
            </button>
          </div>
          <button 
            onClick={fetchStatus}
            className="flex items-center gap-2 px-4 py-2 border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors font-mono text-xs uppercase tracking-widest"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh Status
          </button>
          {status && (
            <Badge variant={status.status === "active" ? "default" : "destructive"} className="rounded-none px-3 py-1 font-mono uppercase">
              {status.status}
            </Badge>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto space-y-12">
        {/* Navigation Tabs */}
        <div className="flex border-b border-[#141414]/20 mb-8 overflow-x-auto whitespace-nowrap scrollbar-hide">
          <button 
            onClick={() => setActiveTab("portal")}
            className={`px-8 py-3 font-mono text-xs uppercase tracking-[0.2em] transition-all relative ${activeTab === "portal" ? "font-bold" : "opacity-40 hover:opacity-100"}`}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" /> Portal
            </div>
            {activeTab === "portal" && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#141414]" />}
          </button>
          <button 
            onClick={() => setActiveTab("deliveries")}
            className={`px-8 py-3 font-mono text-xs uppercase tracking-[0.2em] transition-all relative ${activeTab === "deliveries" ? "font-bold" : "opacity-40 hover:opacity-100"}`}
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" /> Deliveries
            </div>
            {activeTab === "deliveries" && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#141414]" />}
          </button>
          <button 
            onClick={() => setActiveTab("royalties")}
            className={`px-8 py-3 font-mono text-xs uppercase tracking-[0.2em] transition-all relative ${activeTab === "royalties" ? "font-bold" : "opacity-40 hover:opacity-100"}`}
          >
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> Royalties
            </div>
            {activeTab === "royalties" && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#141414]" />}
          </button>
          <button 
            onClick={() => setActiveTab("bulk")}
            className={`px-8 py-3 font-mono text-xs uppercase tracking-[0.2em] transition-all relative ${activeTab === "bulk" ? "font-bold" : "opacity-40 hover:opacity-100"}`}
          >
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Bulk
            </div>
            {activeTab === "bulk" && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#141414]" />}
          </button>
          <button 
            onClick={() => setActiveTab("master")}
            className={`px-8 py-3 font-mono text-xs uppercase tracking-[0.2em] transition-all relative ${activeTab === "master" ? "font-bold" : "opacity-40 hover:opacity-100"}`}
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4" /> Master
            </div>
            {activeTab === "master" && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#141414]" />}
          </button>
          <button 
            onClick={() => setActiveTab("workflow")}
            className={`px-8 py-3 font-mono text-xs uppercase tracking-[0.2em] transition-all relative ${activeTab === "workflow" ? "font-bold" : "opacity-40 hover:opacity-100"}`}
          >
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4" /> Workflow
            </div>
            {activeTab === "workflow" && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#141414]" />}
          </button>
          <button 
            onClick={() => setActiveTab("archive")}
            className={`px-8 py-3 font-mono text-xs uppercase tracking-[0.2em] transition-all relative ${activeTab === "archive" ? "font-bold" : "opacity-40 hover:opacity-100"}`}
          >
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4" /> Archive
            </div>
            {activeTab === "archive" && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#141414]" />}
          </button>

          <button 
            onClick={() => setActiveTab("assets")}
            className={`px-8 py-3 font-mono text-xs uppercase tracking-[0.2em] transition-all relative ${activeTab === "assets" ? "font-bold" : "opacity-40 hover:opacity-100"}`}
          >
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4" /> Asset Ledger
            </div>
            {activeTab === "assets" && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#141414]" />}
          </button>
        </div>

        {activeTab === "portal" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            {/* Legal Portal Section */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <FileText className="w-5 h-5" />
            <h2 className="text-xl font-bold uppercase tracking-tight">Legal Document Portal</h2>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <Card className="rounded-none border-[#141414] bg-white shadow-none lg:col-span-1">
              <CardHeader className="border-b border-[#141414]">
                <CardTitle className="font-mono text-sm uppercase tracking-widest">1. Select Backlog Issue</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-30" />
                    <input 
                      type="text" 
                      placeholder="課題番号で検索..." 
                      value={issueSearch}
                      onChange={(e) => setIssueSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-[#141414]/10 font-mono text-[10px] uppercase tracking-wider focus:outline-none focus:border-[#141414] transition-colors"
                    />
                  </div>
                  {issues.length === 0 ? (
                    <p className="text-xs opacity-50 italic">No open issues found.</p>
                  ) : (
                    <div className="max-h-[400px] overflow-auto space-y-2">
                      {issues
                        .filter(i => 
                          i.issueKey.toLowerCase().includes(issueSearch.toLowerCase())
                        )
                        .map((issue) => (
                        <button
                          key={issue.id}
                          onClick={() => setSelectedIssue(issue.issueKey)}
                          className={`w-full text-left p-3 border ${selectedIssue === issue.issueKey ? 'bg-[#141414] text-white border-[#141414]' : 'border-[#141414]/10 hover:border-[#141414]/40'} transition-colors`}
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-mono text-[10px] font-bold">{issue.issueKey}</span>
                            <Badge className="text-[8px] rounded-none h-4">{issue.status.name}</Badge>
                          </div>
                          <p className="text-xs font-medium line-clamp-2">{issue.summary}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  <button 
                    onClick={fetchIssues}
                    className="w-full py-2 border border-[#141414] text-[10px] font-mono uppercase tracking-widest hover:bg-gray-50"
                  >
                    Refresh Issues
                  </button>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-none border-[#141414] bg-white shadow-none lg:col-span-2">
              <CardHeader className="border-b border-[#141414]">
                <CardTitle className="font-mono text-sm uppercase tracking-widest">2. Document Details</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                {!selectedIssue ? (
                  <div className="h-[300px] flex flex-col items-center justify-center text-center opacity-30">
                    <FileText className="w-12 h-12 mb-4" />
                    <p className="text-sm font-serif italic">左側のリストから課題を選択してください</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-mono uppercase opacity-60">Template Type</label>
                        <select 
                          value={selectedTemplate}
                          onChange={(e) => setSelectedTemplate(e.target.value)}
                          className="w-full p-2 border border-[#141414] rounded-none text-sm focus:outline-none"
                        >
                          {getVisibleTemplates().map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-mono uppercase opacity-60">Selected Issue</label>
                        <div className="p-2 bg-gray-50 border border-[#141414]/10 text-sm font-bold">
                          {selectedIssue}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button 
                        onClick={handleAutofillSelf}
                        className="flex items-center gap-1 px-3 py-1 border border-[#141414] text-[9px] font-mono uppercase tracking-tighter hover:bg-[#141414] hover:text-white transition-colors"
                      >
                        <Building2 className="w-3 h-3" /> Autofill My Company
                      </button>
                      <button 
                        onClick={handleFetchContext}
                        disabled={isFetchingContext}
                        className="flex items-center gap-1 px-3 py-1 border border-blue-600 text-blue-600 text-[9px] font-mono uppercase tracking-tighter hover:bg-blue-600 hover:text-white transition-colors disabled:opacity-50"
                      >
                        <Database className="w-3 h-3" /> {isFetchingContext ? "Fetching..." : "Fetch Latest Data"}
                      </button>
                      <div className="relative">
                        <button 
                          onClick={() => setShowStaffPicker(!showStaffPicker)}
                          className="flex items-center gap-1 px-3 py-1 border border-[#141414] text-[9px] font-mono uppercase tracking-tighter hover:bg-[#141414] hover:text-white transition-colors"
                        >
                          <Users className="w-3 h-3" /> Select Staff
                        </button>
                        <AnimatePresence>
                          {showStaffPicker && (
                            <motion.div 
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 5 }}
                              className="absolute left-0 top-full mt-1 z-10 w-64 bg-white border border-[#141414] shadow-xl p-2"
                            >
                              <div className="relative mb-2">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 opacity-30" />
                                <input 
                                  type="text" 
                                  placeholder="名前で検索..."
                                  value={staffSearch}
                                  onChange={(e) => setStaffSearch(e.target.value)}
                                  className="w-full pl-7 pr-2 py-1 border border-[#141414]/10 text-[10px] focus:outline-none"
                                />
                              </div>
                              <div className="max-h-48 overflow-y-auto space-y-1">
                                {staff
                                  .filter(s => s.staff_name.includes(staffSearch) || s.department.includes(staffSearch))
                                  .map(s => (
                                  <button 
                                    key={s.id}
                                    onClick={() => handleSelectStaffMember(s)}
                                    className="w-full text-left p-2 hover:bg-gray-100 text-[10px] border-b border-gray-50 last:border-0"
                                  >
                                    <p className="font-bold">{s.staff_name}</p>
                                    <p className="opacity-50 text-[8px]">{s.department}</p>
                                  </button>
                                ))}
                                {staff.length === 0 && <p className="text-[9px] p-2 opacity-50 italic">No staff records.</p>}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {isRefreshingFields ? (
                        <div className="md:col-span-2 space-y-4">
                          <Skeleton className="h-10 w-full" />
                          <Skeleton className="h-10 w-full" />
                          <Skeleton className="h-10 w-full" />
                        </div>
                      ) : (
                        <>
                          {templateFields.map(field => renderDynamicField(field, formData, setFormData))}
                          
                          {/* Management Specific Fields - Keep these as they involve logic outside the template itself */}
                          {selectedTemplate.includes("inspection") && (
                            <div className="space-y-2 md:col-span-2 p-4 bg-amber-50 border border-amber-200">
                              <label className="text-[10px] font-mono font-bold uppercase text-amber-900">Delivery Management Info</label>
                              <div className="grid grid-cols-2 gap-4 mt-2">
                                <div className="space-y-1">
                                  <label className="text-[9px] font-mono opacity-60">検収期限 (inspectionDeadline)</label>
                                  <input 
                                    type="date"
                                    onChange={(e) => setFormData({...formData, inspectionDeadline: e.target.value})}
                                    className="w-full p-2 border border-[#141414]/20 rounded-none text-sm"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-mono opacity-60">発注番号 (ORDER_NO)</label>
                                  <input 
                                    type="text"
                                    onChange={(e) => setFormData({...formData, ORDER_NO: e.target.value})}
                                    className="w-full p-2 border border-[#141414]/20 rounded-none text-sm"
                                  />
                                </div>
                              </div>
                            </div>
                          )}

                          {selectedTemplate === "royalty_statement" && (
                            <div className="space-y-2 md:col-span-2 p-4 bg-blue-50 border border-blue-200">
                              <label className="text-[10px] font-mono font-bold uppercase text-blue-900">Royalty Tracking Info</label>
                              <div className="grid grid-cols-2 gap-4 mt-2">
                                <div className="space-y-1">
                                  <label className="text-[9px] font-mono opacity-60">対象期間 (period: YYYY-MM)</label>
                                  <input 
                                    type="month"
                                    onChange={(e) => setFormData({...formData, period: e.target.value})}
                                    className="w-full p-2 border border-[#141414]/20 rounded-none text-sm"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-mono opacity-60">ロイヤリティ合計 (royaltyTotal)</label>
                                  <input 
                                    type="text"
                                    onChange={(e) => setFormData({...formData, royaltyTotal: e.target.value})}
                                    className="w-full p-2 border border-[#141414]/20 rounded-none text-sm"
                                    placeholder="例: 1,500,000"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div className="pt-4 border-t border-[#141414]/10 flex justify-end gap-4">
                      <button 
                        onClick={() => handleTestGenerate(selectedTemplate)}
                        className="px-6 py-2 border border-[#141414] text-xs font-mono uppercase tracking-widest hover:bg-gray-50"
                      >
                        Preview HTML
                      </button>
                      <button 
                        onClick={handleGenerateDocument}
                        disabled={generating}
                        className="px-8 py-2 bg-[#141414] text-white text-xs font-mono uppercase tracking-widest hover:bg-[#333] disabled:opacity-50 flex items-center gap-2"
                      >
                        {generating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                        Generate & Notify
                      </button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        {/* Slack Status */}
        <Card className="rounded-none border-[#141414] bg-transparent shadow-none">
          <CardHeader className="border-b border-[#141414]">
            <div className="flex items-center justify-between">
              <CardTitle className="font-mono text-sm uppercase tracking-widest flex items-center gap-2">
                <Slack className="w-4 h-4" /> Slack Gateway
              </CardTitle>
              {loading ? <Skeleton className="w-4 h-4 rounded-full" /> : (
                status?.slackReady ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <p className="text-xs font-mono opacity-60 mb-4 uppercase">Endpoints</p>
            <ul className="space-y-2 font-mono text-xs">
              <li className="flex justify-between border-b border-[#141414]/10 pb-1">
                <span>Commands</span>
                <span className="opacity-50">/slack/commands</span>
              </li>
              <li className="flex justify-between border-b border-[#141414]/10 pb-1">
                <span>Interactions</span>
                <span className="opacity-50">/slack/interactions</span>
              </li>
              <li className="flex justify-between">
                <span>Events</span>
                <span className="opacity-50">/slack/events</span>
              </li>
            </ul>
            <div className="mt-6 p-3 bg-[#141414] text-[#E4E3E0] font-mono text-[10px] uppercase leading-relaxed">
              Slack Appの「Slash Commands」に上記URLを登録してください。
            </div>
          </CardContent>
        </Card>

        {/* Backlog Status */}
        <Card className="rounded-none border-[#141414] bg-transparent shadow-none">
          <CardHeader className="border-b border-[#141414]">
            <div className="flex items-center justify-between">
              <CardTitle className="font-mono text-sm uppercase tracking-widest flex items-center gap-2">
                <Database className="w-4 h-4" /> Backlog Integration
              </CardTitle>
              {loading ? <Skeleton className="w-4 h-4 rounded-full" /> : (
                status?.backlogReady ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <p className="text-xs font-mono opacity-60 mb-4 uppercase">Configuration</p>
            <ul className="space-y-2 font-mono text-xs">
              <li className="flex justify-between border-b border-[#141414]/10 pb-1">
                <span>Host</span>
                <span className="opacity-50">{status?.backlogHost || "Not Set"}</span>
              </li>
              <li className="flex justify-between border-b border-[#141414]/10 pb-1">
                <span>Project</span>
                <span className="opacity-50">{status?.backlogProjectKey || "Not Set"}</span>
              </li>
              <li className="flex justify-between">
                <span>API Key</span>
                <span className="opacity-50">{status?.backlogReady ? "********" : "Missing"}</span>
              </li>
            </ul>
            <div className="mt-6 p-3 bg-amber-100 text-amber-900 border border-amber-200 font-mono text-[10px] uppercase leading-relaxed">
              BacklogのAPIキーとプロジェクトキーを環境変数に設定してください。
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-none border-[#141414] bg-white shadow-none">
          <CardHeader className="border-b border-[#141414] bg-amber-50">
            <div className="flex items-center justify-between">
              <CardTitle className="font-mono text-sm uppercase tracking-widest flex items-center gap-2">
                <Activity className="w-4 h-4 text-amber-600" /> Lifecycle Alerts
              </CardTitle>
              <Badge variant="outline" className="rounded-none border-amber-600 text-amber-600 font-mono text-[10px]">
                {alerts.length} ISSUES
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {alerts.length === 0 ? (
                <div className="text-center py-8 opacity-30">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-[10px] font-mono uppercase">All targets on track</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
                  {alerts.map((alert, idx) => (
                    <div key={idx} className="p-2 border border-amber-200 bg-amber-50/50 flex flex-col gap-1">
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] font-bold font-mono text-amber-900">{alert.backlog_issue_key}</span>
                        <span className="text-[9px] font-mono text-amber-600">{new Date(alert.inspection_deadline).toLocaleDateString()}</span>
                      </div>
                      <p className="text-[11px] font-serif leading-tight line-clamp-2">{alert.issue_summary}</p>
                      <div className="text-[9px] font-mono opacity-60 uppercase mt-1">
                        CP: {alert.counterparty}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button 
                onClick={async () => {
                  try {
                    await fetch("/api/management/check-status-trigger", { method: "POST" });
                    fetchAlerts();
                  } catch (e) {
                    console.error("Monitor sync failed", e);
                  }
                }}
                className="w-full py-2 border border-[#141414] text-[10px] font-mono uppercase tracking-widest hover:bg-gray-50 flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-3 h-3" /> Force Monitor Sync
              </button>
            </div>
          </CardContent>
        </Card>

        {/* System Logs / Warnings */}
        <Card className="rounded-none border-[#141414] bg-transparent shadow-none md:col-span-1">
          <CardHeader className="border-b border-[#141414]">
            <CardTitle className="font-mono text-sm uppercase tracking-widest">System Health</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : error ? (
              <div className="flex items-start gap-2 text-destructive font-mono text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <p>{error}</p>
              </div>
            ) : status?.warnings.length ? (
              <ul className="space-y-2">
                {status.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-amber-700 font-mono text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-2 text-green-700 font-mono text-xs">
                <CheckCircle2 className="w-4 h-4" />
                <span>All systems operational</span>
              </div>
            )}
            
            <div className="mt-8 pt-4 border-t border-[#141414]/20">
              <p className="text-[10px] font-mono opacity-60 uppercase mb-2">Usage Flow:</p>
              <ol className="space-y-2 font-mono text-[10px] opacity-80">
                <li>1. Slackで `/legal` を入力</li>
                <li>2. 「納品」「利用料計算」等の種別を選択</li>
                <li>3. 各管理タブ（Deliveries/Royalties）で状況確認</li>
                <li>4. 「Create Cert/Statement」で検収書・計算書を自動生成</li>
                <li>5. 最後に「Payment Notice」で支払通知書を発行</li>
              </ol>
            </div>

            <div className="mt-8 pt-4 border-t border-[#141414]/20">
              <p className="text-[10px] font-mono opacity-40 uppercase tracking-tighter">
                Last Updated: {status?.updatedAt || "Never"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
          </motion.div>
        )}

        {activeTab === "deliveries" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <Card className="rounded-none border-[#141414] bg-white shadow-none">
              <CardHeader className="border-b border-[#141414] bg-gray-50">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-mono text-sm uppercase tracking-widest flex items-center gap-2">
                    <Clock className="w-5 h-5" /> Upcoming Delivery Deadlines
                  </CardTitle>
                  <button onClick={fetchManagementData} className="p-2 hover:bg-gray-200 transition-colors">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#141414] bg-gray-100 font-mono text-[10px] uppercase tracking-wider">
                      <th className="p-4 border-r border-[#141414]">Issue Key</th>
                      <th className="p-4 border-r border-[#141414]">Delivery #</th>
                      <th className="p-4 border-r border-[#141414]">Summary (案件名)</th>
                      <th className="p-4 border-r border-[#141414]">Counterparty (相手方)</th>
                      <th className="p-4 border-r border-[#141414]">Ins. Deadline (検収期限)</th>
                      <th className="p-4 border-r border-[#141414]">Status</th>
                      <th className="p-4">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {Array.isArray(deliveries) && deliveries.length === 0 ? (
                      <tr><td colSpan={7} className="p-12 text-center text-sm italic opacity-50">No delivery data found.</td></tr>
                    ) : (
                      Array.isArray(deliveries) && deliveries.map((d) => (
                        <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                          <td className="p-4 border-r border-gray-100 font-mono text-xs font-bold">{d.backlog_issue_key}</td>
                          <td className="p-4 border-r border-gray-100 font-mono text-xs">{d.delivery_no ? `#${d.delivery_no}` : "-"}</td>
                          <td className="p-4 border-r border-gray-100 text-sm">{d.summary}</td>
                          <td className="p-4 border-r border-gray-100 text-sm">{d.counterparty || "-"}</td>
                          <td className="p-4 border-r border-gray-100 text-sm font-mono">{d.inspection_deadline ? new Date(d.inspection_deadline).toLocaleDateString('ja-JP') : "Not Set"}</td>
                          <td className="p-4 border-r border-gray-100">
                            <Badge className={`rounded-none text-[8px] uppercase ${d.status === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                              {d.status}
                            </Badge>
                          </td>
                          <td className="p-4">
                            <button 
                              onClick={() => {
                                setSelectedIssue(d.backlog_issue_key);
                                setSelectedTemplate("inspection_certificate");
                                // Set specific installment data in form if available
                                if (d.delivery_no) {
                                  setFormData(prev => ({
                                    ...prev,
                                    "DELIVERY_NUMBER": String(d.delivery_no),
                                    "INSPECTION_TITLE": `${d.summary} (第${d.delivery_no}回納品分)`
                                  }));
                                }
                                setActiveTab("portal");
                                window.scrollTo(0, 0);
                              }}
                              className="px-3 py-1 bg-[#141414] text-white text-[9px] font-mono uppercase tracking-tighter hover:bg-[#333]"
                            >
                              Create Inspection Cert
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {activeTab === "royalties" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <Card className="rounded-none border-[#141414] bg-[#141414] text-white shadow-none">
              <CardHeader className="border-b border-white/20">
                <CardTitle className="font-mono text-sm uppercase tracking-widest">Royalty Summary</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                  <div>
                    <label className="text-[10px] font-mono uppercase opacity-50">Total calculated revenue</label>
                    <p className="text-4xl font-bold tracking-tighter">
                      ¥{(Array.isArray(royalties) ? royalties : []).reduce((sum, r) => sum + Number(r.total_amount), 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-12">
                    <div>
                      <label className="text-[10px] font-mono uppercase opacity-50">Active Projects</label>
                      <p className="text-2xl font-bold">{new Set((Array.isArray(royalties) ? royalties : []).map(r => r.project_name)).size}</p>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase opacity-50">Latest Period</label>
                      <p className="text-2xl font-bold">{(Array.isArray(royalties) ? royalties : [])[0]?.period || "-"}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-none border-[#141414] bg-white shadow-none">
              <CardHeader className="border-b border-[#141414]">
                <CardTitle className="font-mono text-sm uppercase tracking-widest">Royalty Ledger</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#141414] bg-gray-50 font-mono text-[10px] uppercase tracking-wider">
                      <th className="p-4">Period</th>
                      <th className="p-4">Project</th>
                      <th className="p-4 text-right">Amount</th>
                      <th className="p-4 text-center">Status</th>
                      <th className="p-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Array.isArray(royalties) && royalties.length === 0 ? (
                      <tr><td colSpan={5} className="p-12 text-center text-sm italic opacity-50">No royalty data recorded.</td></tr>
                    ) : (
                      Array.isArray(royalties) && royalties.map((r) => (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="p-4 font-mono text-xs">{r.period}</td>
                          <td className="p-4 text-sm font-medium">{r.project_name}</td>
                          <td className="p-4 text-right text-sm font-bold">¥{Number(r.total_amount).toLocaleString()}</td>
                          <td className="p-4 text-center">
                            <Badge variant="outline" className="rounded-none text-[8px] uppercase border-[#141414]">
                              {r.status}
                            </Badge>
                          </td>
                          <td className="p-4 text-right">
                            <button 
                              onClick={() => {
                                setSelectedIssue(r.backlog_issue_key || "");
                                setSelectedTemplate("royalty_statement");
                                setActiveTab("portal");
                                window.scrollTo(0, 0);
                              }}
                              className="px-3 py-1 border border-[#141414] text-[9px] font-mono uppercase tracking-tighter hover:bg-[#141414] hover:text-white"
                            >
                              Create Statement
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </motion.div>
        )}
        {activeTab === "bulk" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <Card className="rounded-none border-[#141414] bg-white shadow-none">
              <CardHeader className="border-b border-[#141414]">
                <CardTitle className="font-mono text-sm uppercase tracking-widest">CSV Bulk Import (Section 7 Implementation)</CardTitle>
                <CardDescription className="text-xs font-serif italic">
                  CSVデータを読み込み、Backlog起票と書類生成の一括処理に必要な下地を作成します。
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <input type="radio" id="gen" checked={importMode === "generic"} onChange={() => setImportMode("generic")} />
                    <label htmlFor="gen" className="text-xs font-mono uppercase">Generic Mode</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="radio" id="pub" checked={importMode === "publishing"} onChange={() => setImportMode("publishing")} />
                    <label htmlFor="pub" className="text-xs font-mono uppercase">Publishing Mode (Fixed Headers)</label>
                  </div>
                </div>
                
                <textarea 
                  value={csvContent}
                  onChange={(e) => setCsvContent(e.target.value)}
                  placeholder="CSVデータをここに貼り付けてください..."
                  className="w-full h-64 p-4 border border-[#141414] font-mono text-xs focus:ring-0 focus:outline-none bg-gray-50"
                />

                <div className="flex justify-between items-center">
                  <p className="text-[10px] font-mono opacity-50 uppercase">
                    Supported: papaparse / manual paste / drag-and-drop coming soon
                  </p>
                  <button 
                    onClick={handleImportCsv}
                    disabled={isImporting || !csvContent}
                    className="px-10 py-3 bg-[#141414] text-[#E4E3E0] font-mono text-xs uppercase tracking-widest hover:bg-[#333] transition-colors disabled:opacity-30 flex items-center gap-2"
                  >
                    {isImporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
                    Execute Batch Process
                  </button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
        {activeTab === "master" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-12 pb-24">
            <div className="grid grid-cols-1 gap-12">
              {/* Vendors List */}
              <Card className="rounded-none border-[#141414] bg-white shadow-none">
                <CardHeader className="border-b border-[#141414] bg-gray-50 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="font-mono text-sm uppercase tracking-widest flex items-center gap-2">
                      <Building2 className="w-4 h-4" /> Vendor Master
                    </CardTitle>
                    <CardDescription className="text-[10px] font-mono opacity-50 uppercase mt-1">External entities and billing info</CardDescription>
                  </div>
                  <button 
                    onClick={() => setShowVendorModal(true)}
                    className="px-4 py-1 border border-[#141414] text-[10px] uppercase font-mono hover:bg-[#141414] hover:text-white transition-colors"
                  >
                    Add Vendor
                  </button>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#141414] bg-gray-100 font-mono text-[9px] uppercase tracking-wider">
                        <th className="p-3 border-r border-[#141414]">Code</th>
                        <th className="p-3 border-r border-[#141414]">Vendor Name</th>
                        <th className="p-3 border-r border-[#141414]">Email</th>
                        <th className="p-3 border-r border-[#141414]">Invoice No</th>
                        <th className="p-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {Array.isArray(vendors) && vendors.length === 0 ? (
                        <tr><td colSpan={5} className="p-8 text-center text-xs opacity-40">No vendors registered.</td></tr>
                      ) : (
                        Array.isArray(vendors) && vendors.map(v => (
                          <tr key={v.id} className="hover:bg-gray-50 transition-colors group">
                            <td className="p-3 border-r border-gray-100 font-mono text-xs">{v.vendor_code}</td>
                            <td className="p-3 border-r border-gray-100 text-xs font-bold">{v.vendor_name}</td>
                            <td className="p-3 border-r border-gray-100 text-xs opacity-60">{v.email || "-"}</td>
                            <td className="p-3 border-r border-gray-100 text-xs font-mono">{v.invoice_registration_number || "-"}</td>
                            <td className="p-3 text-right">
                              <button className="p-1 opacity-0 group-hover:opacity-100 hover:bg-gray-200 transition-all"><Settings className="w-3 h-3" /></button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {/* Staff List */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card className="rounded-none border-[#141414] bg-white shadow-none">
                  <CardHeader className="border-b border-[#141414] bg-gray-50 flex flex-row items-center justify-between">
                    <CardTitle className="font-mono text-sm uppercase tracking-widest flex items-center gap-2">
                      <Users className="w-4 h-4" /> Internal Staff
                    </CardTitle>
                    <button 
                      onClick={() => setShowStaffModal(true)}
                      className="px-4 py-1 border border-[#141414] text-[10px] uppercase font-mono hover:bg-[#141414] hover:text-white transition-colors"
                    >
                      Register Staff
                    </button>
                  </CardHeader>
                  <CardContent className="p-0">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#141414] bg-gray-100 font-mono text-[9px] uppercase tracking-wider">
                          <th className="p-3 border-r border-[#141414]">Slack ID</th>
                          <th className="p-3 border-r border-[#141414]">Name</th>
                          <th className="p-3">Department</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {Array.isArray(staff) && staff.length === 0 ? (
                          <tr><td colSpan={3} className="p-8 text-center text-xs opacity-40">No staff registered.</td></tr>
                        ) : (
                          Array.isArray(staff) && staff.map(s => (
                            <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                              <td className="p-3 border-r border-gray-100 font-mono text-[10px]">{s.slack_user_id}</td>
                              <td className="p-3 border-r border-gray-100 text-xs font-bold">{s.staff_name}</td>
                              <td className="p-3 text-xs opacity-60">{s.department || "-"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>

                <Card className="rounded-none border-[#141414] bg-white shadow-none">
                  <CardHeader className="border-b border-[#141414] bg-gray-50 flex flex-row items-center justify-between">
                    <CardTitle className="font-mono text-sm uppercase tracking-widest flex items-center gap-2">
                      <Lock className="w-4 h-4" /> Workflow Rules
                    </CardTitle>
                    <button 
                      onClick={() => setShowRuleModal(true)}
                      className="px-4 py-1 border border-[#141414] text-[10px] uppercase font-mono hover:bg-[#141414] hover:text-white transition-colors"
                    >
                      Configure New
                    </button>
                  </CardHeader>
                  <CardContent className="p-0">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#141414] bg-gray-100 font-mono text-[9px] uppercase tracking-wider">
                          <th className="p-3 border-r border-[#141414]">Dept</th>
                          <th className="p-3 border-r border-[#141414]">Channel</th>
                          <th className="p-3 border-r border-[#141414]">Approver</th>
                          <th className="p-3">Stamp Ops</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {Array.isArray(rules) && rules.length === 0 ? (
                          <tr><td colSpan={3} className="p-8 text-center text-xs opacity-40">No rules configured.</td></tr>
                        ) : (
                          Array.isArray(rules) && rules.map(r => (
                            <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                              <td className="p-3 border-r border-gray-100 text-xs font-bold">{r.department}</td>
                              <td className="p-3 border-r border-gray-100 font-mono text-[10px] text-blue-600">{r.slack_channel_id || "default"}</td>
                              <td className="p-3 border-r border-gray-100 font-mono text-[10px]">{r.approver_slack_id}</td>
                              <td className="p-3 font-mono text-[10px]">{r.stamp_operator_slack_id}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>
            </div>
          </motion.div>
        )}
        {activeTab === "workflow" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <Card className="rounded-none border-[#141414] bg-white shadow-none">
              <CardHeader className="border-b border-[#141414] bg-gray-50 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="font-mono text-sm uppercase tracking-widest">Global Workflow Monitor</CardTitle>
                  <CardDescription className="text-xs font-serif italic mt-1">Real-time status of all documents and legal requests.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#141414] bg-gray-100 font-mono text-[10px] uppercase tracking-wider">
                      <th className="p-4">Issue</th>
                      <th className="p-4">Task / Contract</th>
                      <th className="p-4">Progress</th>
                      <th className="p-4">Current Status</th>
                      <th className="p-4">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Array.isArray(workflows) && workflows.length === 0 ? (
                      <tr><td colSpan={5} className="p-12 text-center text-sm italic opacity-50">No active workflows tracked.</td></tr>
                    ) : (
                      Array.isArray(workflows) && workflows.map(w => {
                        // Calculate a semi-mock progress based on status name for visual effect
                        const statusWeights: Record<string, number> = {
                          "文書生成依頼": 10,
                          "草案": 30,
                          "内部審査": 50,
                          "承認済み": 80,
                          "完了": 100
                        };
                        const progress = statusWeights[w.current_status_name] || 0;
                        
                        return (
                          <tr key={w.id} className="hover:bg-gray-50 group">
                            <td className="p-4">
                              <div className="font-mono text-xs font-bold leading-tight">{w.backlog_issue_key}</div>
                              <div className="text-[10px] opacity-40 uppercase font-mono">{w.contract_type}</div>
                            </td>
                            <td className="p-4">
                              <div className="text-sm font-medium">{w.summary || "Untitled Request"}</div>
                              <div className="text-[10px] opacity-50">{w.counterparty || "Internal"}</div>
                            </td>
                            <td className="p-4 w-48">
                              <div className="w-full h-1 bg-gray-100">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${progress}%` }}
                                  className={`h-full ${progress === 100 ? 'bg-green-500' : 'bg-[#141414]'}`}
                                />
                              </div>
                              <div className="text-[9px] font-mono mt-1 opacity-50">{progress}% COMPLETE</div>
                            </td>
                            <td className="p-4">
                              <Badge className={`rounded-none text-[8px] uppercase ${progress === 100 ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                                {w.current_status_name}
                              </Badge>
                            </td>
                            <td className="p-4 text-xs font-mono opacity-50">
                              {new Date(w.updated_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </motion.div>
        )}
        {activeTab === "assets" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold font-mono uppercase tracking-[.25em]">External Assets & Drafts</h2>
              <button 
                onClick={() => setShowAssetModal(true)}
                className="bg-[#141414] text-white px-6 py-2 font-mono text-xs uppercase tracking-widest hover:bg-[#333]"
              >
                Register Existing Asset
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {externalAssets.length === 0 ? (
                <div className="col-span-full p-24 text-center text-sm italic opacity-40">No external assets registered.</div>
              ) : (
                externalAssets.map(asset => (
                  <Card key={asset.id} className="rounded-none border-[#141414] bg-white shadow-none hover:shadow-xl transition-all group overflow-hidden">
                    <CardHeader className="border-b border-[#141414] bg-gray-50 relative">
                      <div className="flex justify-between items-start">
                        <div className="flex flex-col">
                          <Archive className="w-8 h-8 opacity-20" />
                          <span className="font-mono text-[8px] mt-1 opacity-50">{asset.asset_number}</span>
                        </div>
                        <Badge variant="outline" className={`rounded-none text-[8px] uppercase border-[#141414] ${asset.status === 'expired' ? 'text-red-500 border-red-500' : ''}`}>{asset.asset_type}</Badge>
                      </div>
                      <CardTitle className="mt-4 text-sm font-bold truncate">{asset.asset_name}</CardTitle>
                      <CardDescription className="text-[10px] font-mono opacity-50 uppercase">{asset.counterparty}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-4 pb-12 flex flex-col gap-2">
                      <div className="flex justify-between text-[10px] font-mono opacity-60 uppercase">
                        <span>Period:</span>
                        <span>{asset.start_date || 'N/A'} - {asset.end_date || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between text-[10px] font-mono opacity-60 uppercase">
                        <span>Status:</span>
                        <span className="font-bold">{asset.status}</span>
                      </div>
                    </CardContent>
                    {asset.file_link && (
                      <div className="absolute bottom-0 left-0 right-0 h-10 bg-[#141414] flex items-center justify-between px-4 translate-y-full group-hover:translate-y-0 transition-transform">
                        <span className="text-white font-mono text-[9px] uppercase tracking-widest">Asset Link</span>
                        <a 
                          href={asset.file_link} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-white hover:underline font-mono text-[9px] uppercase tracking-widest flex items-center gap-1"
                        >
                          View Source <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}
                  </Card>
                ))
              )}
            </div>
          </motion.div>
        )}

        {activeTab === "archive" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {!Array.isArray(docArchive) || docArchive.length === 0 ? (
                <div className="col-span-full p-24 text-center text-sm italic opacity-40">No documents found in archive.</div>
              ) : (
                docArchive.map(doc => (
                  <Card key={doc.id} className="rounded-none border-[#141414] bg-white shadow-none hover:shadow-xl transition-all group overflow-hidden">
                    <CardHeader className="border-b border-[#141414] bg-gray-50 relative">
                      <div className="flex justify-between items-start">
                        <div className="flex flex-col">
                          <FileText className="w-8 h-8 opacity-20" />
                          <span className="font-mono text-[8px] mt-1 opacity-50">{doc.document_number}</span>
                        </div>
                        <Badge variant="outline" className="rounded-none text-[8px] uppercase border-[#141414]">{doc.template_type}</Badge>
                      </div>
                      <CardTitle className="mt-4 text-sm font-bold truncate">{doc.issue_key}</CardTitle>
                      <CardDescription className="text-[10px] font-mono opacity-50 uppercase">{new Date(doc.created_at).toLocaleDateString()}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-4 pb-12">
                      <p className="text-[10px] font-mono opacity-60 line-clamp-2 uppercase leading-relaxed">
                        Created by: {doc.created_by}
                      </p>
                    </CardContent>
                    <div className="absolute bottom-0 left-0 right-0 h-10 bg-[#141414] flex items-center justify-between px-4 translate-y-full group-hover:translate-y-0 transition-transform">
                      <span className="text-white font-mono text-[9px] uppercase tracking-widest">GWS Stored</span>
                      <a 
                        href={doc.drive_link} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-white hover:underline font-mono text-[9px] uppercase tracking-widest flex items-center gap-1"
                      >
                        Open <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </motion.div>
        )}

        {/* Master Registration Modals */}
        <AnimatePresence>
          {showAssetModal && (
            <div className="fixed inset-0 bg-[#141414]/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white max-w-lg w-full p-8 border border-[#141414]">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="font-mono text-sm uppercase tracking-widest font-bold">Register Existing Asset</h3>
                  <button onClick={() => setShowAssetModal(false)}><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase opacity-50">Asset Name (文書名)</label>
                    <input value={newAsset.asset_name} onChange={e => setNewAsset({...newAsset, asset_name: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="例: 秘密保持契約書(相手方ドラフト)" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase opacity-50">Type (種別)</label>
                      <select value={newAsset.asset_type} onChange={e => setNewAsset({...newAsset, asset_type: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono">
                        <option value="contract">契約書 (Contract)</option>
                        <option value="draft">ドラフト (Draft)</option>
                        <option value="design">設計図 (Design)</option>
                        <option value="spec">仕様書 (Spec)</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase opacity-50">Status (状態)</label>
                      <select value={newAsset.status} onChange={e => setNewAsset({...newAsset, status: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono">
                        <option value="active">有効 (Active)</option>
                        <option value="expired">失効 (Expired)</option>
                        <option value="review">審査中 (Review)</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase opacity-50">Counterparty (相手方)</label>
                    <input value={newAsset.counterparty} onChange={e => setNewAsset({...newAsset, counterparty: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="株式会社〇〇" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase opacity-50">Drive/File Link (リンク)</label>
                    <input value={newAsset.file_link} onChange={e => setNewAsset({...newAsset, file_link: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="https://drive.google.com/..." />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase opacity-50">Start Date (開始日)</label>
                      <input type="date" value={newAsset.start_date} onChange={e => setNewAsset({...newAsset, start_date: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase opacity-50">End Date (終了日)</label>
                      <input type="date" value={newAsset.end_date} onChange={e => setNewAsset({...newAsset, end_date: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" />
                    </div>
                  </div>
                </div>
                <button onClick={handleAddAsset} className="w-full mt-8 bg-[#141414] text-white py-3 font-mono text-xs uppercase tracking-widest">Register Asset</button>
              </motion.div>
            </div>
          )}
          {showVendorModal && (
            <div className="fixed inset-0 bg-[#141414]/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white max-w-lg w-full p-8 border border-[#141414]">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="font-mono text-sm uppercase tracking-widest font-bold">Register New Vendor</h3>
                  <button onClick={() => setShowVendorModal(false)}><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase opacity-50">Vendor Code</label>
                      <input value={newVendor.vendor_code} onChange={e => setNewVendor({...newVendor, vendor_code: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="V-001" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase opacity-50">Invoice Reg No</label>
                      <input value={newVendor.invoice_registration_number} onChange={e => setNewVendor({...newVendor, invoice_registration_number: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="T123..." />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase opacity-50">Vendor Name</label>
                    <input value={newVendor.vendor_name} onChange={e => setNewVendor({...newVendor, vendor_name: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="株式会社サンプル" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase opacity-50">Email Address (for Invoicing)</label>
                    <input value={newVendor.email} onChange={e => setNewVendor({...newVendor, email: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="billing@sample.com" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase opacity-50">Bank Account Info</label>
                    <textarea value={newVendor.bank_name} onChange={e => setNewVendor({...newVendor, bank_name: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" h-20 placeholder="三菱UFJ銀行 〇〇支店 普通 1234567" />
                  </div>
                </div>
                <button onClick={handleAddVendor} className="w-full mt-8 bg-[#141414] text-white py-3 font-mono text-xs uppercase tracking-widest">Add Vendor Master</button>
              </motion.div>
            </div>
          )}

          {showStaffModal && (
            <div className="fixed inset-0 bg-[#141414]/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white max-w-sm w-full p-8 border border-[#141414]">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="font-mono text-sm uppercase tracking-widest font-bold">Register Staff</h3>
                  <button onClick={() => setShowStaffModal(false)}><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase opacity-50">Slack User ID</label>
                    <input value={newStaff.slack_user_id} onChange={e => setNewStaff({...newStaff, slack_user_id: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="U12345678" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase opacity-50">Staff Name</label>
                    <input value={newStaff.staff_name} onChange={e => setNewStaff({...newStaff, staff_name: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="山田 太郎" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase opacity-50">Department</label>
                      <input value={newStaff.department} onChange={e => setNewStaff({...newStaff, department: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="第一開発部" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase opacity-50">Code</label>
                      <input value={newStaff.department_code} onChange={e => setNewStaff({...newStaff, department_code: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="DEV1" />
                    </div>
                  </div>
                </div>
                <button onClick={handleAddStaff} className="w-full mt-8 bg-[#141414] text-white py-3 font-mono text-xs uppercase tracking-widest">Confirm Registration</button>
              </motion.div>
            </div>
          )}

          {showRuleModal && (
            <div className="fixed inset-0 bg-[#141414]/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white max-w-md w-full p-8 border border-[#141414]">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="font-mono text-sm uppercase tracking-widest font-bold">Workflow Rule</h3>
                  <button onClick={() => setShowRuleModal(false)}><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase opacity-50">Target Department</label>
                    <input value={newRule.department} onChange={e => setNewRule({...newRule, department: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="例: 第一開発部" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase opacity-50">Notify Slack Channel ID</label>
                    <input value={newRule.slack_channel_id} onChange={e => setNewRule({...newRule, slack_channel_id: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="例: C012345678" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase opacity-50">Approver (Slack ID)</label>
                    <input value={newRule.approver_slack_id} onChange={e => setNewRule({...newRule, approver_slack_id: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="検印・承認者" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase opacity-50">Stamp Operator (Slack ID)</label>
                    <input value={newRule.stamp_operator_slack_id} onChange={e => setNewRule({...newRule, stamp_operator_slack_id: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="押印対応者" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase opacity-50">Manager (Slack ID)</label>
                    <input value={newRule.manager_slack_id} onChange={e => setNewRule({...newRule, manager_slack_id: e.target.value})} className="w-full p-2 border border-[#141414] text-xs font-mono" placeholder="部門責任者" />
                  </div>
                </div>
                <button onClick={handleAddRule} className="w-full mt-8 bg-[#141414] text-white py-3 font-mono text-xs uppercase tracking-widest">Apply Rule</button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      <footer className="max-w-6xl mx-auto mt-24 border-t border-[#141414] pt-8 flex justify-between items-center text-[10px] font-mono uppercase tracking-widest opacity-40">
        <p>© 2026 LegalBridge Prototype</p>
        <p>Built for tatsuyakuramchi/legalbridge</p>
      </footer>

      <AnimatePresence>
        {previewHtml && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-12 bg-[#141414]/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-4xl h-full flex flex-col shadow-2xl overflow-hidden"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <span className="font-mono text-xs uppercase tracking-widest">Document Preview: LegalRequest_DEMO-123.html</span>
                <button 
                  onClick={() => setPreviewHtml(null)}
                  className="hover:rotate-90 transition-transform"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-auto bg-gray-100 p-8">
                <div className="bg-white shadow-sm mx-auto max-w-[210mm] min-h-[297mm]">
                  <iframe 
                    srcDoc={previewHtml} 
                    className="w-full h-full border-none min-h-[297mm]"
                    title="Document Preview"
                  />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
