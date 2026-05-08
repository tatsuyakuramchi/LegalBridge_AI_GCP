import * as React from "react"
import { saveAs } from "file-saver"
import {
  Database,
  Eye,
  Loader2,
  Download,
  RefreshCw,
  FileText,
  Search,
  CheckCircle2,
  ScanSearch,
  Briefcase,
  Building2,
  History,
  RotateCcw,
} from "lucide-react"

import { useAppData, useDocumentSession } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from "@/components/ui/sheet"
import { DocumentForm } from "@/src/components/document/DocumentForm"

export function DocumentEditorPage() {
  const {
    issues,
    vendors,
    staffList,
    assets,
    templateList,
    templateMetadata,
    companyProfile,
    showNotification,
  } = useAppData()
  const {
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
  } = useDocumentSession()

  const [vendorSearch, setVendorSearch] = React.useState("")
  const [staffSearch, setStaffSearch] = React.useState("")
  const [templateSearch, setTemplateSearch] = React.useState("")
  const [isRefreshingFields, setIsRefreshingFields] = React.useState(false)
  const [isPreviewVisible, setIsPreviewVisible] = React.useState(false)
  const [previewHtml, setPreviewHtml] = React.useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = React.useState(false)
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [issueSummary, setIssueSummary] = React.useState<any>(null)
  const [lastAutoSave, setLastAutoSave] = React.useState<string | null>(null)
  const [isAssetPickerOpen, setIsAssetPickerOpen] = React.useState(false)
  const [assetPickerCallback, setAssetPickerCallback] =
    React.useState<((asset: any) => void) | null>(null)
  const [assetSearch, setAssetSearch] = React.useState("")

  // ---- Helpers --------------------------------------------------------
  const syncFromDatabase = React.useCallback(
    async (issueKeyToUse?: string) => {
      const key = issueKeyToUse || selectedIssue
      if (!key) {
        showNotification("Please select a Backlog ticket first.", "error")
        return
      }
      const issue = issues.find((i) => i.issueKey === key)
      try {
        const res = await fetch(
          `/api/backlog/issues/${key}/form-context?template=${selectedTemplate}`
        )
        const context = await res.json()
        setFormData((prev: any) => ({
          ...prev,
          基本契約名: issue?.summary || prev["基本契約名"],
          remarks: issue?.description || prev["remarks"],
          ...context,
        }))
      } catch (e) {
        if (issue) {
          setFormData((prev: any) => ({
            ...prev,
            基本契約名: issue.summary,
            remarks: issue.description,
          }))
        }
      }
    },
    [issues, selectedTemplate, selectedIssue, setFormData, showNotification]
  )

  const handleIssueSelect = async (issueKey: string) => {
    setSelectedIssue(issueKey)
    const issue = issues.find((i) => i.issueKey === issueKey)
    if (issue) setIssueSummary(issue)
    await syncFromDatabase(issueKey)
    fetch(`/api/backlog/issues/${issueKey}/history`)
      .then((r) => r.json())
      .then((d) => setCaseHistory(d))
      .catch((e) => console.error("History fetch error:", e))
  }

  // Re-fetch fields when template changes (server-driven schema)
  React.useEffect(() => {
    const loadFields = async () => {
      if (!selectedTemplate) return
      setIsRefreshingFields(true)
      try {
        await fetch(`/api/templates/${selectedTemplate}/schema`).then((r) => r.json())
      } catch (e) {
        console.error("Failed to fetch template schema", e)
      } finally {
        setIsRefreshingFields(false)
      }
    }
    loadFields()
  }, [selectedTemplate])

  // Restore draft on issue change
  React.useEffect(() => {
    if (!selectedIssue) return
    const saved = localStorage.getItem(`draft_${selectedIssue}`)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Object.keys(formData).length <= 1) {
          setFormData(parsed)
          showNotification(`Draft restored for ${selectedIssue}`, "success")
        }
      } catch (e) {
        console.error("Draft restore fail", e)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIssue])

  // Auto-save
  React.useEffect(() => {
    if (!selectedIssue || Object.keys(formData).length <= 1) return
    const to = setTimeout(() => {
      localStorage.setItem(`draft_${selectedIssue}`, JSON.stringify(formData))
      setLastAutoSave(
        new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
      )
    }, 2000)
    return () => clearTimeout(to)
  }, [formData, selectedIssue])

  const handlePreview = React.useCallback(async () => {
    setIsPreviewing(true)
    setPreviewHtml(null)
    try {
      const res = await fetch("/api/documents/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateType: selectedTemplate,
          formData,
          issueKey: selectedIssue,
        }),
      })
      const data = await res.json()
      if (data.html) setPreviewHtml(data.html)
    } catch (e) {
      console.error("Preview failed", e)
    } finally {
      setIsPreviewing(false)
    }
  }, [formData, selectedIssue, selectedTemplate])

  // Live preview
  React.useEffect(() => {
    if (!isPreviewVisible) return
    const to = setTimeout(() => {
      handlePreview()
    }, 1000)
    return () => clearTimeout(to)
  }, [formData, isPreviewVisible, selectedTemplate, handlePreview])

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      const res = await fetch("/api/documents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueKey: selectedIssue || "MANUAL-" + Date.now(),
          templateType: selectedTemplate,
          formData,
          requesterEmail: selectedStaff?.email || "web-user",
        }),
      })
      const data = await res.json()
      if (data.driveLink) {
        window.open(data.driveLink, "_blank")
        showNotification("Document generated and uploaded.", "success")
      } else {
        showNotification("Generation completed, but no drive link was returned.", "info")
      }
    } catch (e) {
      console.error("Generation failed", e)
      showNotification("Document generation failed.", "error")
    } finally {
      setIsGenerating(false)
    }
  }

  const handleExportExcel = async () => {
    setIsGenerating(true)
    try {
      const excelItems: any[] = []
      for (let i = 1; i <= 5; i++) {
        excelItems.push({
          content: formData[`支払内容（${i}）`] || "",
          unit_price: Number(formData[`単価（${i}）`] || 0),
          quantity: Number(formData[`数量（${i}）`] || 0),
          amount: Number(formData[`金額（${i}）`] || 0),
          delivery_date: formData[`納品日（${i}）`] || "",
        })
      }
      const excelData = {
        summary: formData.件名 || issueSummary?.summary || "",
        payment_date: formData.支払日 || "",
        department: formData.部署 || formData.inspectorDept || "",
        vendor_code: formData.取引先コード || activeVendor?.vendor_code || "",
        name: formData.氏名 || formData.counterparty || "",
        name_kana: formData["氏名（カナ）"] || "",
        items: excelItems,
        reimbursement: Number(formData.立替金 || 0),
        subtotal: Number(formData.小計 || 0),
        withholding_tax: Number(formData.源泉税 || 0),
        after_tax: Number(formData.税引後 || 0),
        net_transfer_amount: Number(formData.差引振込額 || 0),
      }
      const res = await fetch("/api/documents/export-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(excelData),
      })
      if (res.ok) {
        const blob = await res.blob()
        saveAs(blob, `inspection_${selectedIssue || "export"}.xlsx`)
        showNotification("Excel export successful", "success")
      } else {
        showNotification("Excel export failed", "error")
      }
    } catch (e) {
      console.error("Excel export error:", e)
      showNotification("Excel export failed", "error")
    } finally {
      setIsGenerating(false)
    }
  }

  // ---- Filters --------------------------------------------------------
  const filteredTemplates = templateList.filter((t) => {
    const label = templateMetadata[t]?.label || t
    return (
      label.toLowerCase().includes(templateSearch.toLowerCase()) ||
      t.toLowerCase().includes(templateSearch.toLowerCase())
    )
  })
  const templateCategories = Array.from(
    new Set(filteredTemplates.map((t) => templateMetadata[t]?.category || "General"))
  )

  return (
    <div className="px-6 py-6 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-12 gap-5">
        {/* ─── Side panel ─────────────────────────────────────── */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          {/* Environment / Selection */}
          <Card className="bg-foreground text-background border-foreground rounded-md">
            <CardContent className="px-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-mono font-bold uppercase tracking-[0.22em]">
                  ▍ Session
                </p>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 blink" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-background/60">Backlog ticket</Label>
                <select
                  value={selectedIssue}
                  onChange={(e) => handleIssueSelect(e.target.value)}
                  className="w-full bg-transparent border-b border-background/20 py-1.5 text-xs font-mono focus:outline-none focus:border-emerald-400"
                >
                  <option value="" className="text-foreground">— Select ticket —</option>
                  {issues.map((i, idx) => (
                    <option
                      key={`issue-${i.issueKey || idx}-${idx}`}
                      value={i.issueKey}
                      className="text-foreground"
                    >
                      [{i.issueKey}] {i.summary}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-background/60">Blueprint</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-0 top-1.5 h-3 w-3 text-background/40" />
                  <input
                    type="text"
                    placeholder="Filter…"
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    className="w-full bg-transparent border-b border-background/10 pl-4 py-1 text-[11px] font-mono focus:outline-none focus:border-emerald-400 placeholder:text-background/30"
                  />
                </div>
                <select
                  value={selectedTemplate}
                  onChange={(e) => setSelectedTemplate(e.target.value)}
                  className="w-full bg-transparent border-b border-background/20 py-1.5 text-xs font-mono focus:outline-none focus:border-emerald-400"
                >
                  <option value="" className="text-foreground">— Select blueprint —</option>
                  {templateCategories.map((cat) => (
                    <optgroup key={cat || "uncategorized"} label={cat} className="text-foreground">
                      {filteredTemplates
                        .filter(
                          (t) => (templateMetadata[t]?.category || "General") === cat
                        )
                        .map((t) => (
                          <option key={t} value={t} className="text-foreground">
                            {templateMetadata[t]?.label || t.replace(/_/g, " ")}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <Button
                variant="secondary"
                className="w-full"
                onClick={() => setIsAssetPickerOpen(true)}
              >
                <ScanSearch />
                Search Legal Assets
              </Button>
            </CardContent>
          </Card>

          {/* Master context */}
          <div className="space-y-2.5">
            <p className="retro-tag">Master · Context</p>

            <Card>
              <CardContent className="px-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5">
                    <Briefcase className="h-3 w-3" /> Internal Staff
                  </Label>
                  {selectedStaff && (
                    <Badge variant="outline">
                      {selectedStaff.staff_name}
                    </Badge>
                  )}
                </div>
                <Input
                  type="text"
                  placeholder="Search staff…"
                  value={staffSearch}
                  onChange={(e) => setStaffSearch(e.target.value)}
                  className="h-8 text-xs"
                />
                <NativeSelect
                  value={selectedStaff?.slack_user_id || ""}
                  onChange={(e) =>
                    setSelectedStaff(
                      staffList.find((s) => s.slack_user_id === e.target.value) || null
                    )
                  }
                >
                  <option value="">— Staff DB —</option>
                  {staffList
                    .filter(
                      (s) =>
                        s.staff_name.toLowerCase().includes(staffSearch.toLowerCase()) ||
                        (s.department &&
                          s.department.toLowerCase().includes(staffSearch.toLowerCase()))
                    )
                    .map((s, idx) => (
                      <option key={`staff-${s.slack_user_id || idx}`} value={s.slack_user_id}>
                        {s.staff_name} · {s.department}
                      </option>
                    ))}
                </NativeSelect>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="px-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5">
                    <Building2 className="h-3 w-3" /> External Partner
                  </Label>
                  {activeVendor && (
                    <Badge variant="outline">{activeVendor.vendor_code}</Badge>
                  )}
                </div>
                <Input
                  type="text"
                  placeholder="Search vendor…"
                  value={vendorSearch}
                  onChange={(e) => setVendorSearch(e.target.value)}
                  className="h-8 text-xs"
                />
                <NativeSelect
                  value={activeVendor?.vendor_code || ""}
                  onChange={(e) =>
                    setActiveVendor(
                      vendors.find((v) => v.vendor_code === e.target.value) || null
                    )
                  }
                >
                  <option value="">— Vendor DB —</option>
                  {vendors
                    .filter(
                      (v) =>
                        v.vendor_name.toLowerCase().includes(vendorSearch.toLowerCase()) ||
                        v.vendor_code.toLowerCase().includes(vendorSearch.toLowerCase())
                    )
                    .map((v) => (
                      <option key={`vendor-${v.vendor_code}`} value={v.vendor_code}>
                        {v.vendor_name}
                      </option>
                    ))}
                </NativeSelect>
              </CardContent>
            </Card>
          </div>

          {/* Case history */}
          {selectedIssue && caseHistory.length > 0 && (
            <div className="space-y-2.5">
              <p className="retro-tag">
                <History className="h-3 w-3" /> Case data stream
              </p>
              <div className="relative pl-4 border-l border-dashed border-border space-y-3">
                {caseHistory.map((item, idx) => (
                  <div key={`${item.id}-${idx}`} className="relative">
                    <span className="absolute -left-[19px] top-1 h-2 w-2 rounded-full bg-card border-2 border-foreground" />
                    <p className="text-[9px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                      {new Date(item.date).toLocaleDateString("ja-JP")}
                    </p>
                    <p className="text-xs font-mono font-bold leading-tight">
                      {item.label}
                    </p>
                    <p className="text-[10px] font-mono text-cyan-700 dark:text-cyan-300 truncate">
                      {item.ref}
                    </p>
                    {item.amount && (
                      <p className="text-[10px] font-mono font-bold text-emerald-600">
                        ¥{new Intl.NumberFormat("ja-JP").format(item.amount)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ─── Stage ─────────────────────────────────────────── */}
        <section
          className={`col-span-12 ${
            isPreviewVisible ? "lg:col-span-9" : "lg:col-span-9"
          } space-y-4`}
        >
          <Card className="rounded-md">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-muted/40">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-7 w-7 items-center justify-center bg-foreground text-background rounded-sm shrink-0">
                  <FileText className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground">
                    Editor
                  </p>
                  <p className="text-sm font-mono font-bold truncate">
                    {templateMetadata[selectedTemplate]?.label ||
                      selectedTemplate.replace(/_/g, " ")}
                  </p>
                </div>
                {issueSummary && (
                  <Badge variant="info">
                    {issueSummary.issueKey} · {issueSummary.status?.name || "synced"}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {lastAutoSave && (
                  <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    Saved {lastAutoSave}
                  </span>
                )}
                <Button
                  variant={isPreviewVisible ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsPreviewVisible((v) => !v)}
                >
                  <Eye />
                  {isPreviewVisible ? "Close preview" : "Split preview"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => syncFromDatabase()}>
                  <Database />
                  DB Sync
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setFormData({ サブライセンシー一覧: [] })}
                  aria-label="Reset form"
                >
                  <RotateCcw />
                </Button>
              </div>
            </div>

            {/* Body */}
            <div
              className={`flex ${
                isPreviewVisible ? "flex-row" : "flex-col"
              } overflow-hidden`}
            >
              <div
                className={`flex-1 overflow-y-auto custom-scrollbar p-6 ${
                  isPreviewVisible ? "max-w-[50%]" : ""
                }`}
              >
                {isRefreshingFields ? (
                  <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className="h-6 bg-muted animate-pulse rounded-sm"
                      />
                    ))}
                  </div>
                ) : (
                  <DocumentForm
                    templateId={selectedTemplate}
                    metadata={templateMetadata[selectedTemplate] || { vars: {} }}
                    formData={formData}
                    setFormData={setFormData}
                    onSync={() => syncFromDatabase()}
                    onLinkAsset={(cb) => {
                      setAssetPickerCallback(() => cb)
                      setIsAssetPickerOpen(true)
                    }}
                    companyProfile={companyProfile}
                    activeVendor={activeVendor}
                    selectedStaff={selectedStaff}
                  />
                )}
              </div>

              {isPreviewVisible && (
                <div className="w-1/2 border-l border-border bg-muted/40 flex flex-col overflow-hidden">
                  <div className="px-4 py-2.5 bg-card border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 blink" />
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.22em] text-muted-foreground">
                        Live preview
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={handlePreview}
                      disabled={isPreviewing}
                    >
                      <RefreshCw className={isPreviewing ? "animate-spin" : ""} />
                      Refresh
                    </Button>
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar p-6 grid-paper">
                    <div className="bg-card border border-border shadow-xl mx-auto p-10 prose prose-sm max-w-none relative scale-[0.85] origin-top">
                      {isPreviewing && (
                        <div className="absolute inset-0 bg-card/60 backdrop-blur-[2px] flex items-center justify-center z-10">
                          <Loader2 className="h-6 w-6 animate-spin text-foreground" />
                        </div>
                      )}
                      {previewHtml ? (
                        <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                      ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                          <FileText className="h-12 w-12 mb-3 opacity-30" />
                          <p className="font-mono text-xs uppercase tracking-[0.2em] text-center">
                            Awaiting field input…
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-border bg-muted/40">
              <div className="flex items-center gap-5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  <div className="leading-none">
                    <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em]">
                      Draft valid
                    </p>
                    <p className="text-[9px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                      Ready for sync
                    </p>
                  </div>
                </div>
                <Separator orientation="vertical" className="h-6" />
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                  <div className="leading-none">
                    <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em]">
                      Live syncing
                    </p>
                    <p className="text-[9px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                      Backlog API
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handlePreview} disabled={isPreviewing}>
                  {isPreviewing ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Eye />
                  )}
                  Preview
                </Button>
                {selectedTemplate.startsWith("inspection_certificate") && (
                  <Button
                    variant="outline"
                    onClick={handleExportExcel}
                    disabled={isGenerating}
                  >
                    <Download />
                    Export Excel
                  </Button>
                )}
                <Button onClick={handleGenerate} disabled={isGenerating}>
                  {isGenerating ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  Finalize & Sync
                </Button>
              </div>
            </div>
          </Card>
        </section>
      </div>

      {/* Asset picker */}
      <Sheet open={isAssetPickerOpen} onOpenChange={setIsAssetPickerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>▍ Legal asset search</SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <Input
              type="text"
              autoFocus
              placeholder="Contract no. / ledger ID / partner name…"
              value={assetSearch}
              onChange={(e) => setAssetSearch(e.target.value)}
            />
            <div className="border border-border rounded-md overflow-hidden">
              <div className="grid grid-cols-[120px_1fr_auto] gap-3 px-3 py-2 bg-muted/40 border-b border-border text-[9px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground">
                <span>Identity</span>
                <span>Reference</span>
                <span>Action</span>
              </div>
              <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
                {assets
                  .filter(
                    (a) =>
                      a.asset_number.includes(assetSearch) ||
                      a.asset_name.toLowerCase().includes(assetSearch.toLowerCase()) ||
                      a.counterparty.toLowerCase().includes(assetSearch.toLowerCase())
                  )
                  .map((asset, idx) => (
                    <div
                      key={`asset-${asset.id || idx}`}
                      className="grid grid-cols-[120px_1fr_auto] gap-3 items-center px-3 py-2.5 hover:bg-muted/40 transition-colors"
                    >
                      <span className="text-[11px] font-mono font-bold tracking-tight">
                        {asset.asset_number}
                      </span>
                      <div>
                        <p className="text-xs font-mono leading-tight">
                          {asset.asset_name}
                        </p>
                        <p className="text-[9px] font-mono uppercase tracking-[0.16em] text-muted-foreground italic">
                          {asset.counterparty}
                        </p>
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          if (assetPickerCallback) {
                            assetPickerCallback(asset)
                            setAssetPickerCallback(null)
                            setIsAssetPickerOpen(false)
                            return
                          }
                          const update: any = {}
                          if (
                            asset.asset_type === "contract" ||
                            asset.asset_number.startsWith("AL-") ||
                            asset.asset_number.startsWith("C-")
                          ) {
                            update["契約書番号"] = asset.asset_number
                            update["基本契約名"] = asset.asset_name
                          } else {
                            update["台帳ID"] = asset.asset_number
                            update["原著作物名"] = asset.asset_name
                          }
                          setFormData((prev: any) => ({ ...prev, ...update }))
                          setIsAssetPickerOpen(false)
                        }}
                      >
                        Select
                      </Button>
                    </div>
                  ))}
                {assets.length === 0 && (
                  <div className="p-12 text-center text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground italic">
                    Index retrieval failed or no assets
                  </div>
                )}
              </div>
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  )
}
