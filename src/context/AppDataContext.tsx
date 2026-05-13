import * as React from "react"

import { useToast } from "@/components/ui/toast"

// --- Types ---------------------------------------------------------------

export interface Vendor {
  id?: number
  vendor_code: string
  vendor_name: string
  trade_name?: string
  address?: string
  contact_name?: string
  vendor_rep?: string
  bank_name?: string
  branch_name?: string
  account_type?: string
  account_number?: string
  account_holder_kana?: string
  entity_type?: string
  invoice_registration_number?: string
  email?: string
  pen_name?: string
  is_invoice_issuer?: boolean
}

export interface Staff {
  slack_user_id: string
  staff_name: string
  department?: string
  email?: string
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

  const refreshVendors = React.useCallback(async () => {
    try {
      const res = await fetch("/api/master/vendors")
      const data = await res.json()
      setVendors(dedupe(data as Vendor[], (v) => v.vendor_code))
    } catch (e) {
      console.error(e)
    }
  }, [])

  const refreshStaff = React.useCallback(async () => {
    try {
      const res = await fetch("/api/master/staff")
      const data = await res.json()
      setStaffList(dedupe(data as Staff[], (s) => s.slack_user_id))
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
    ] = results

    setIssues(dedupe(issuesRes as Issue[], (i) => i.issueKey))
    setVendors(dedupe(vendorsRes as Vendor[], (v) => v.vendor_code))
    setStaffList(dedupe(staffRes as Staff[], (s) => s.slack_user_id))
    setCompanyProfile(profileRes)
    setAssets(dedupe(assetsRes as ExternalAsset[], (a) => a.id))
    setTemplateList(
      Array.isArray(templatesRes) ? Array.from(new Set(templatesRes as string[])) : []
    )
    setTemplateMetadata(metaRes || {})
    setStatuses(Array.isArray(statusesRes) ? statusesRes : [])
    setWorkflowRules(Array.isArray(rulesRes) ? rulesRes : [])
    setContracts(Array.isArray(contractsRes) ? contractsRes : [])
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
