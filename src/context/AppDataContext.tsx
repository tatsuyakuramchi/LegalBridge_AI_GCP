import * as React from "react"

import { useToast } from "@/components/ui/toast"

// --- Types ---------------------------------------------------------------

// Phase 22.13: 担当者を 1:N に変更。primary 1 件 + 補助担当者複数。
export interface VendorContact {
  id?: number
  contact_name: string
  contact_department?: string
  title?: string
  email?: string
  phone?: string
  is_primary?: boolean
  sort_order?: number
  remarks?: string
}

export interface VendorAddress {
  id?: number
  address_label?: string
  postal_code?: string
  address: string
  is_primary?: boolean
  sort_order?: number
}

export interface VendorBankAccount {
  id?: number
  bank_label?: string
  bank_name?: string
  branch_name?: string
  account_type?: string
  account_number?: string
  account_holder_kana?: string
  is_primary?: boolean
  sort_order?: number
}

export interface Vendor {
  id?: number
  vendor_code: string
  vendor_name: string
  corporate_number?: string
  trade_name?: string
  address?: string
  contact_name?: string  // legacy: primary 担当者の名前 (worker が backfill する)
  vendor_rep?: string
  bank_name?: string
  branch_name?: string
  account_type?: string
  account_number?: string
  account_holder_kana?: string
  entity_type?: string
  invoice_registration_number?: string
  email?: string
  phone?: string
  payment_terms?: string
  main_business?: string
  transaction_category?: string
  capital_yen?: number | string
  employee_count?: number | string
  subcontract_act_applicable?: boolean
  rating?: string
  antisocial_check_result?: string
  master_updated_at?: string
  pen_name?: string
  is_invoice_issuer?: boolean
  // Phase 22.13
  contacts?: VendorContact[]
  addresses?: VendorAddress[]
  bank_accounts?: VendorBankAccount[]
}

export interface Staff {
  id?: number
  slack_user_id: string
  staff_name: string
  department?: string
  email?: string
  app_role?: string
}

// Backlog 課題のカスタムフィールド 1 行。value は型により
//   string(テキスト/日付) / { id, name }(単一選択) / [{ id, name }](複数選択)。
export interface BacklogCustomField {
  id: number
  name: string
  fieldTypeId?: number
  value?: any
}

export interface Issue {
  issueKey: string
  summary: string
  description: string
  status?: { name?: string }
  assignee?: { name?: string }
  registeredUser?: string
  documentCount?: number
  lastDocDate?: string
  // Backlog 一覧 API が返す課題のカスタムフィールド
  //   (取引先名称・依頼部署・締結方法・希望納期 等)。
  customFields?: BacklogCustomField[]
}

export interface ExternalAsset {
  id: string
  asset_number: string
  asset_name: string
  asset_type: string
  counterparty: string
}

interface AppDataContextValue {
  // Master data
  issues: Issue[]
  vendors: Vendor[]
  staffList: Staff[]
  assets: ExternalAsset[]
  contracts: any[]
  ledgers: any[]  // Phase 22.18: 原作マスター (素材 embedded)
  workflowRules: any[]
  statuses: any[]
  companyProfile: any
  templateList: string[]
  templateMetadata: any
  appSettings: any
  dashboardStats: any
  isRefreshingStats: boolean

  // Setters (pass-through)
  setVendors: React.Dispatch<React.SetStateAction<Vendor[]>>
  setStaffList: React.Dispatch<React.SetStateAction<Staff[]>>
  setAssets: React.Dispatch<React.SetStateAction<ExternalAsset[]>>
  setContracts: React.Dispatch<React.SetStateAction<any[]>>
  setWorkflowRules: React.Dispatch<React.SetStateAction<any[]>>
  setAppSettings: React.Dispatch<React.SetStateAction<any>>
  setTemplateList: React.Dispatch<React.SetStateAction<string[]>>
  setTemplateMetadata: React.Dispatch<React.SetStateAction<any>>

  // Refreshers
  refreshDashboardStats: () => Promise<void>
  refreshAll: () => Promise<void>
  refreshContracts: () => Promise<void>
  refreshLedgers: () => Promise<void>  // Phase 22.18
  refreshIssues: () => Promise<void>
  refreshVendors: () => Promise<void>
  refreshStaff: () => Promise<void>
  refreshAssets: () => Promise<void>
  refreshWorkflowRules: () => Promise<void>
  refreshTemplates: () => Promise<void>

  // Notifications
  showNotification: (message: string, type?: "info" | "success" | "error") => void
}

const AppDataContext = React.createContext<AppDataContextValue | null>(null)

const dedupe = <T,>(arr: T[] | undefined, key: (x: T) => any): T[] => {
  if (!Array.isArray(arr)) return []
  const seen = new Map<any, T>()
  for (const item of arr) {
    const k = key(item)
    if (k != null && !seen.has(k)) seen.set(k, item)
  }
  return [...seen.values()]
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [issues, setIssues] = React.useState<Issue[]>([])
  const [vendors, setVendors] = React.useState<Vendor[]>([])
  const [staffList, setStaffList] = React.useState<Staff[]>([])
  const [assets, setAssets] = React.useState<ExternalAsset[]>([])
  const [contracts, setContracts] = React.useState<any[]>([])
  const [ledgers, setLedgers] = React.useState<any[]>([])  // Phase 22.18
  const [workflowRules, setWorkflowRules] = React.useState<any[]>([])
  const [statuses, setStatuses] = React.useState<any[]>([])
  const [companyProfile, setCompanyProfile] = React.useState<any>(null)
  const [templateList, setTemplateList] = React.useState<string[]>([])
  const [templateMetadata, setTemplateMetadata] = React.useState<any>({})
  const [appSettings, setAppSettings] = React.useState<any>({})
  const [dashboardStats, setDashboardStats] = React.useState<any>(null)
  const [isRefreshingStats, setIsRefreshingStats] = React.useState(false)

  const toast = useToast()
  const showNotification = React.useCallback(
    (message: string, type: "info" | "success" | "error" = "info") => {
      toast.push(message, type)
    },
    [toast]
  )

  const refreshContracts = React.useCallback(async () => {
    try {
      const res = await fetch("/api/master/contracts")
      const data = await res.json()
      setContracts(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error("Failed to fetch contracts", e)
    }
  }, [])

  // Phase 22.18: 原作マスター取得 (素材を embedded)
  const refreshLedgers = React.useCallback(async () => {
    try {
      const res = await fetch("/api/master/ledgers")
      const data = await res.json()
      setLedgers(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error("Failed to fetch ledgers", e)
    }
  }, [])


  // Phase 17z 以降、search-api 側の /api/master/vendors と /api/master/staff
  // は { ok: true, rows: [...], total: N } 形式で返す (旧 worker 側は plain
  // array)。両方を受け入れるための正規化ヘルパー。
  const unwrapList = <T,>(data: any): T[] => {
    if (Array.isArray(data)) return data as T[]
    if (data && Array.isArray(data.rows)) return data.rows as T[]
    return []
  }

  const refreshVendors = React.useCallback(async () => {
    try {
      const res = await fetch("/api/master/vendors")
      const data = await res.json()
      setVendors(dedupe(unwrapList<Vendor>(data), (v) => v.vendor_code))
    } catch (e) {
      console.error(e)
    }
  }, [])

  const refreshStaff = React.useCallback(async () => {
    try {
      const res = await fetch("/api/master/staff")
      const data = await res.json()
      setStaffList(dedupe(unwrapList<Staff>(data), (s) => s.slack_user_id))
    } catch (e) {
      console.error(e)
    }
  }, [])

  const refreshAssets = React.useCallback(async () => {
    try {
      const res = await fetch("/api/management/assets")
      const data = await res.json()
      setAssets(dedupe(data as ExternalAsset[], (a) => a.id))
    } catch (e) {
      console.error(e)
    }
  }, [])

  // Phase 17g: Backlog 課題一覧を再取得 (DocumentEditorPage 等の Issue
  // プルダウンを最新化する用途)。refreshAll は重いので個別 endpoint で。
  const refreshIssues = React.useCallback(async () => {
    try {
      const res = await fetch("/api/backlog/issues")
      const data = await res.json()
      setIssues(dedupe(data as Issue[], (i) => i.issueKey))
    } catch (e) {
      console.error(e)
    }
  }, [])

  const refreshWorkflowRules = React.useCallback(async () => {
    try {
      const res = await fetch("/api/master/rules")
      const data = await res.json()
      setWorkflowRules(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error(e)
    }
  }, [])

  const refreshTemplates = React.useCallback(async () => {
    try {
      const [t, m] = await Promise.all([
        fetch("/api/templates").then((r) => r.json()),
        fetch("/api/templates/config/metadata").then((r) => r.json()),
      ])
      setTemplateList(Array.isArray(t) ? Array.from(new Set(t as string[])) : [])
      setTemplateMetadata(m || {})
    } catch (e) {
      console.error(e)
    }
  }, [])

  const refreshDashboardStats = React.useCallback(async () => {
    setIsRefreshingStats(true)
    try {
      const res = await fetch("/api/dashboard/stats")
      const data = await res.json()
      if (data && Array.isArray(data.issueDetails)) {
        data.issueDetails = dedupe(data.issueDetails, (i: any) => i?.issueKey)
      }
      setDashboardStats(data)
    } catch (e) {
      console.error("Failed to fetch dashboard stats", e)
    } finally {
      setIsRefreshingStats(false)
    }
  }, [])

  const refreshAll = React.useCallback(async () => {
    const endpoints: Array<{ key: string; url: string }> = [
      { key: "issues", url: "/api/backlog/issues" },
      { key: "vendors", url: "/api/master/vendors" },
      { key: "staff", url: "/api/master/staff" },
      { key: "profile", url: "/api/master/company-profile" },
      { key: "assets", url: "/api/management/assets" },
      { key: "templates", url: "/api/templates" },
      { key: "metadata", url: "/api/templates/config/metadata" },
      { key: "statuses", url: "/api/backlog/statuses" },
      { key: "workflowRules", url: "/api/master/rules" },
      { key: "contracts", url: "/api/master/contracts" },
      { key: "ledgers", url: "/api/master/ledgers" }, // Phase 22.18
    ]

    const results = await Promise.all(
      endpoints.map(async ({ key, url }) => {
        try {
          const res = await fetch(url)
          if (!res.ok) {
            console.error(`Failed to fetch ${key}: ${res.status}`)
            return null
          }
          return await res.json()
        } catch (e) {
          console.error(`Failed to fetch ${key}`, e)
          return null
        }
      })
    )

    const [
      issuesRes,
      vendorsRes,
      staffRes,
      profileRes,
      assetsRes,
      templatesRes,
      metaRes,
      statusesRes,
      rulesRes,
      contractsRes,
      ledgersRes, // Phase 22.18
    ] = results

    setIssues(dedupe(issuesRes as Issue[], (i) => i.issueKey))
    setVendors(dedupe(unwrapList<Vendor>(vendorsRes), (v) => v.vendor_code))
    setStaffList(dedupe(unwrapList<Staff>(staffRes), (s) => s.slack_user_id))
    setCompanyProfile(profileRes)
    setAssets(dedupe(assetsRes as ExternalAsset[], (a) => a.id))
    setTemplateList(
      Array.isArray(templatesRes) ? Array.from(new Set(templatesRes as string[])) : []
    )
    setTemplateMetadata(metaRes || {})
    setStatuses(Array.isArray(statusesRes) ? statusesRes : [])
    setWorkflowRules(Array.isArray(rulesRes) ? rulesRes : [])
    setContracts(Array.isArray(contractsRes) ? contractsRes : [])
    setLedgers(Array.isArray(ledgersRes) ? ledgersRes : [])
  }, [])

  React.useEffect(() => {
    refreshAll()
    fetch("/api/master/app-settings")
      .then((r) => r.json())
      .then((d) => setAppSettings(d || {}))
      .catch((e) => console.error("Failed to load settings", e))
  }, [refreshAll])

  const value: AppDataContextValue = {
    issues,
    vendors,
    staffList,
    assets,
    contracts,
    ledgers, // Phase 22.18
    workflowRules,
    statuses,
    companyProfile,
    templateList,
    templateMetadata,
    appSettings,
    dashboardStats,
    isRefreshingStats,
    setVendors,
    setStaffList,
    setAssets,
    setContracts,
    setWorkflowRules,
    setAppSettings,
    setTemplateList,
    setTemplateMetadata,
    refreshDashboardStats,
    refreshAll,
    refreshContracts,
    refreshLedgers, // Phase 22.18
    refreshIssues,
    refreshVendors,
    refreshStaff,
    refreshAssets,
    refreshWorkflowRules,
    refreshTemplates,
    showNotification,
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData() {
  const ctx = React.useContext(AppDataContext)
  if (!ctx) throw new Error("useAppData must be used within an AppDataProvider")
  return ctx
}

// Document editor session: separate context for the create flow so that
// other pages don't trigger re-renders on every keystroke.
interface DocumentSession {
  selectedIssue: string
  setSelectedIssue: React.Dispatch<React.SetStateAction<string>>
  selectedTemplate: string
  setSelectedTemplate: React.Dispatch<React.SetStateAction<string>>
  formData: any
  setFormData: React.Dispatch<React.SetStateAction<any>>
  activeVendor: Vendor | null
  setActiveVendor: React.Dispatch<React.SetStateAction<Vendor | null>>
  selectedStaff: Staff | null
  setSelectedStaff: React.Dispatch<React.SetStateAction<Staff | null>>
  caseHistory: any[]
  setCaseHistory: React.Dispatch<React.SetStateAction<any[]>>
}

const DocumentSessionContext = React.createContext<DocumentSession | null>(null)

export function DocumentSessionProvider({ children }: { children: React.ReactNode }) {
  const [selectedIssue, setSelectedIssue] = React.useState("")
  const [selectedTemplate, setSelectedTemplate] = React.useState("individual_license_terms")
  const [formData, setFormData] = React.useState<any>({ サブライセンシー一覧: [] })
  const [activeVendor, setActiveVendor] = React.useState<Vendor | null>(null)
  const [selectedStaff, setSelectedStaff] = React.useState<Staff | null>(null)
  const [caseHistory, setCaseHistory] = React.useState<any[]>([])

  return (
    <DocumentSessionContext.Provider
      value={{
        selectedIssue,
        setSelectedIssue,
        selectedTemplate,
        setSelectedTemplate,
        formData,
        setFormData,
        activeVendor,
        setActiveVendor,
        selectedStaff,
        setSelectedStaff,
        caseHistory,
        setCaseHistory,
      }}
    >
      {children}
    </DocumentSessionContext.Provider>
  )
}

export function useDocumentSession() {
  const ctx = React.useContext(DocumentSessionContext)
  if (!ctx) throw new Error("useDocumentSession must be used within DocumentSessionProvider")
  return ctx
}
