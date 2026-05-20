import * as React from "react"
import { useSearchParams } from "react-router-dom"
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
  X,
  ExternalLink,
  PartyPopper,
  Plus,
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
import { RingiSelector } from "@/src/components/document/RingiSelector"
import { WorkflowPanel } from "@/src/components/workflow/WorkflowPanel"

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
    refreshIssues,
  } = useAppData()

  // Phase 17g: ページ起動時に最新の Backlog 課題を再取得。
  // ダッシュボードと違って初期ロード時に取得した stale な issues を
  // 表示し続けるバグを防ぐ。
  React.useEffect(() => {
    refreshIssues?.()
    // 初回マウント時のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [issuesRefreshing, setIssuesRefreshing] = React.useState(false)
  const handleRefreshIssues = async () => {
    if (!refreshIssues) return
    setIssuesRefreshing(true)
    try {
      await refreshIssues()
      showNotification("Backlog 課題リストを更新しました", "success")
    } catch (e: any) {
      showNotification(`更新失敗: ${e?.message || e}`, "error")
    } finally {
      setIssuesRefreshing(false)
    }
  }
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
  // Phase 22.21.16: プレビュー API のエラーを UI 上で可視化。
  //   旧実装は console.error しかしておらず、500 や空 html を返した場合に
  //   「Awaiting field input…」のまま無言で止まっていた。
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = React.useState(false)
  const [isGenerating, setIsGenerating] = React.useState(false)
  // Phase 9g: 文書生成完了後の達成感のあるサクセス画面用
  const [completionResult, setCompletionResult] = React.useState<{
    driveLink: string;
    documentNumber: string;
    templateLabel: string;
  } | null>(null)
  const [issueSummary, setIssueSummary] = React.useState<any>(null)
  // Phase 22.11.2: 課題選択時、同 (issue, template) で過去 doc があれば
  // バナーで提示して「前回内容を読み込む」or「再編集モードで開く」を選ばせる。
  // form-context endpoint の _previousDocument から得る (上書きされないよう
  // formData とは別 state に保持)。
  const [previousDocument, setPreviousDocument] = React.useState<{
    id: number
    document_number: string
    base_document_number: string
    revision: number
    drive_link: string
    created_at: string
    vendor_name_snapshot: string
  } | null>(null)
  const [loadingPrevious, setLoadingPrevious] = React.useState(false)
  const [lastAutoSave, setLastAutoSave] = React.useState<string | null>(null)
  const [isAssetPickerOpen, setIsAssetPickerOpen] = React.useState(false)
  const [assetPickerCallback, setAssetPickerCallback] =
    React.useState<((asset: any) => void) | null>(null)
  const [assetSearch, setAssetSearch] = React.useState("")

  // Phase 15/16: URL クエリパラメータで既存ドキュメントを pre-fill。
  //   ?from_pending=<id>   PDF 未作成キュー由来 (Phase 15)
  //   ?reopen=<id>         既に生成済み文書を再編集 (Phase 16)
  // どちらも /api/documents/:id で form_data を取得して setFormData する。
  const [searchParams, setSearchParams] = useSearchParams()
  const fromPendingId = searchParams.get("from_pending")
  const reopenId = searchParams.get("reopen")
  React.useEffect(() => {
    const targetId = fromPendingId || reopenId
    if (!targetId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(targetId)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!data?.ok || !data.form_data) {
          throw new Error(data?.error || "form_data not found")
        }
        if (cancelled) return
        setSelectedTemplate(data.template_type)
        setSelectedIssue(data.issue_key || "")
        setFormData({
          ...(data.form_data || {}),
          __from_pending_id: fromPendingId ? Number(fromPendingId) : undefined,
          __from_pending_doc_number: data.document_number,
          // Phase 16: reopen の場合は既存 doc を更新する識別子
          __reopen_id: reopenId ? Number(reopenId) : undefined,
          __reopen_doc_number: reopenId ? data.document_number : undefined,
        })
        const verb = fromPendingId ? "PDF 未作成キューから" : "既存文書を再編集モードで"
        showNotification(
          `「${data.document_number}」を${verb}読み込みました。`,
          "info"
        )
        // URL からクエリを消す (リロード時に二重 prefill しない)
        searchParams.delete("from_pending")
        searchParams.delete("reopen")
        setSearchParams(searchParams, { replace: true })
      } catch (e: any) {
        showNotification(`ドキュメント読み込み失敗: ${e?.message || e}`, "error")
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromPendingId, reopenId])

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
        // Phase 22.11.2: 過去 doc のメタ情報を別 state に保存 (formData は汚さない)
        if (context && context._previousDocument) {
          setPreviousDocument(context._previousDocument)
          // formData に流し込む前に削除 (context spread で残ると formData が膨らむ)
          delete context._previousDocument
        } else {
          setPreviousDocument(null)
        }
        setFormData((prev: any) => ({
          ...prev,
          基本契約名: issue?.summary || prev["基本契約名"],
          remarks: issue?.description || prev["remarks"],
          ...context,
        }))
      } catch (e) {
        setPreviousDocument(null)
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

  // Phase 22.11.2: 「前回内容を読み込む」 — 過去 doc の form_data を
  // 取得して formData に反映 (内部の __reopen_doc_number 等は付けない →
  // 新規発行扱い)。
  const handleLoadPrevious = React.useCallback(async () => {
    if (!previousDocument?.document_number) return
    setLoadingPrevious(true)
    try {
      const res = await fetch(
        `/api/documents/by-number/${encodeURIComponent(
          previousDocument.document_number
        )}`
      )
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      // form_data を formData にマージ (現在の formData が空 or 確認後上書き)
      const hasEdits = Object.keys(formData || {}).some(
        (k) => !k.startsWith("__") && (formData as any)[k]
      )
      if (hasEdits) {
        const ok = window.confirm(
          "現在のフォーム内容が前回内容で上書きされます。続行しますか?\n\n" +
            `前回: ${previousDocument.document_number}\n` +
            `作成: ${new Date(previousDocument.created_at).toLocaleString("ja-JP")}`
        )
        if (!ok) return
      }
      const prevFormData = data.form_data || {}
      // 新規発行扱いで読み込むので __reopen_doc_number は付けない
      // (新規番号で採番される。リビジョン採番は明示「再編集」時のみ。)
      setFormData(prevFormData)
      showNotification(
        `前回 ${previousDocument.document_number} の内容を読み込みました (新規番号で発行されます)`,
        "success"
      )
    } catch (e: any) {
      showNotification(
        `前回内容の読み込みに失敗しました: ${e?.message || e}`,
        "error"
      )
    } finally {
      setLoadingPrevious(false)
    }
  }, [previousDocument, formData, setFormData, showNotification])

  // Phase 22.11.2: 「前回 doc を再編集モードで開く」 — Archive の再編集と同等。
  // 既存 doc の form_data を読み込み、generate 時にリビジョン採番されるよう
  // __reopen_doc_number を付ける。
  const handleReopenPrevious = React.useCallback(async () => {
    if (!previousDocument?.document_number) return
    setLoadingPrevious(true)
    try {
      const res = await fetch(
        `/api/documents/by-number/${encodeURIComponent(
          previousDocument.document_number
        )}`
      )
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      const prevFormData = {
        ...(data.form_data || {}),
        __reopen_id: previousDocument.id,
        __reopen_doc_number: previousDocument.document_number,
      }
      setFormData(prevFormData)
      showNotification(
        `${previousDocument.document_number} を再編集モードで開きました (再発行版として採番されます)`,
        "success"
      )
    } catch (e: any) {
      showNotification(
        `再編集モード起動失敗: ${e?.message || e}`,
        "error"
      )
    } finally {
      setLoadingPrevious(false)
    }
  }, [previousDocument, setFormData, showNotification])

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
    setPreviewError(null)
    // 旧 previewHtml は残しておく (refresh 中も前回内容を表示し続ける)
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
      // Phase 22.21.16: 500 / 422 などの HTTP エラーを明示的に拾う
      if (!res.ok) {
        let errMsg = `HTTP ${res.status} ${res.statusText}`
        try {
          const errBody = await res.json()
          if (errBody?.error) errMsg += `: ${errBody.error}`
        } catch {
          // body が JSON でないケース
          try {
            const t = await res.text()
            if (t) errMsg += `: ${t.slice(0, 300)}`
          } catch {}
        }
        setPreviewError(errMsg)
        setPreviewHtml(null)
        console.error("Preview failed:", errMsg)
        return
      }
      const data = await res.json()
      if (data.html) {
        setPreviewHtml(data.html)
        setPreviewError(null)
      } else {
        // 200 OK だが html が空 — テンプレが空文字を返したケース
        setPreviewError(
          `Preview API returned no HTML${
            data?.error ? `: ${data.error}` : ""
          }`
        )
        setPreviewHtml(null)
      }
    } catch (e: any) {
      const msg = e?.message || String(e)
      console.error("Preview failed:", e)
      setPreviewError(`Network or fetch error: ${msg}`)
      setPreviewHtml(null)
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
    // Phase 16: クライアント側プレ検証 — templates_config.json で required=true
    // のフィールドが未入力なら送信を止めて明確に伝える。
    //
    // Phase 22.5: service_master で乙が個人事業主 (VENDOR_IS_CORPORATION = "個人")
    // のときは VENDOR_REP は不要 (テンプレも非表示) なので除外する。
    // 将来同種の条件付き必須が増えるなら meta.requiredIf 等の汎用化を検討。
    const meta = templateMetadata[selectedTemplate]
    if (meta?.vars) {
      const missing: string[] = []
      Object.entries(meta.vars).forEach(([id, m]: [string, any]) => {
        if (m?.required !== true) return
        if (
          selectedTemplate === "service_master" &&
          id === "VENDOR_REP" &&
          formData.VENDOR_IS_CORPORATION === "個人"
        ) {
          return
        }
        const v = formData[id]
        const isEmpty =
          v === undefined ||
          v === null ||
          (typeof v === "string" && v.trim() === "")
        if (isEmpty) {
          missing.push(m.label || id)
        }
      })
      if (missing.length > 0) {
        const preview = missing.slice(0, 5).join("、")
        const tail =
          missing.length > 5 ? ` 他 ${missing.length - 5} 件` : ""
        showNotification(
          `必須項目が未入力です: ${preview}${tail}。フォームを確認してください。`,
          "error"
        )
        return
      }
    }

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
          // Phase 15/16: 既存 doc の更新時は同じ document_number を渡す
          // (PDF 未作成キュー由来 or 再編集 reopen 由来の両方)。
          existingDocumentNumber:
            formData?.__from_pending_doc_number ||
            formData?.__reopen_doc_number,
        }),
      })

      // Phase 17o: バックエンドの実エラーをサイレントに飲み込まない。
      // 旧コードは res.ok を見ずに data.driveLink の有無だけで判定して
      // いたため、HTTP 500 でも「drive link が無いだけ」のように見える
      // 紛らわしい挙動だった。
      let data: any = null
      const rawText = await res.text()
      try {
        data = rawText ? JSON.parse(rawText) : null
      } catch {
        data = { error: rawText }
      }

      if (!res.ok) {
        const detail =
          data?.error ||
          data?.message ||
          rawText ||
          `HTTP ${res.status}`
        console.error("Generation failed (server)", res.status, data)
        showNotification(`文書作成に失敗しました: ${detail}`, "error")
        return
      }

      if (data?.driveLink) {
        // Phase 9g: 達成感サクセス画面 — toast だけだと「できたかどうか」が
        // 不明確というフィードバックを受け、明示的なモーダルで完了表示。
        setCompletionResult({
          driveLink: data.driveLink,
          documentNumber: data.documentNumber || "",
          templateLabel:
            templateMetadata[selectedTemplate]?.label || selectedTemplate,
        })
        showNotification("Document generated and uploaded.", "success")
      } else {
        showNotification(
          `生成完了 (${data?.documentNumber || "番号未取得"}) — drive link が返却されませんでした`,
          "info"
        )
      }
    } catch (e: any) {
      console.error("Generation failed", e)
      showNotification(
        `文書作成に失敗しました: ${e?.message || e}`,
        "error"
      )
    } finally {
      setIsGenerating(false)
    }
  }

  // Phase 9g: サクセスモーダル経由の「新しい文書を作成」 — フォームを
  // リセットして次の起票へ。
  const handleStartNew = () => {
    setFormData({})
    setSelectedIssue("")
    setIssueSummary(null)
    setCompletionResult(null)
    showNotification("New document started.", "info")
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
                <div className="flex items-center justify-between">
                  <Label className="text-background/60">
                    Backlog ticket ({issues.length})
                  </Label>
                  {/* Phase 17g: 手動更新ボタン — 新規追加した課題がプルダウンに
                      出ない問題への対応 (初期ロード時の stale data を再フェッチ) */}
                  <button
                    type="button"
                    onClick={handleRefreshIssues}
                    disabled={issuesRefreshing}
                    className="text-[9px] font-mono uppercase tracking-wider text-background/60 hover:text-background flex items-center gap-1 disabled:opacity-50"
                    title="Backlog 課題リストを最新化"
                  >
                    {issuesRefreshing ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-2.5 h-2.5" />
                    )}
                    更新
                  </button>
                </div>
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
                  <div className="space-y-6">
                    {/* Phase 18: 手動ワークフロー制御。選択中の Backlog 課題
                        に対するステータス進行ボタン。auto-advance を廃止した
                        ため、ユーザーが明示的にこのパネルから進める。
                        MANUAL- 仮キー (Backlog 不存在) のときは出さない。 */}
                    {selectedIssue && !selectedIssue.startsWith("MANUAL-") && (() => {
                      const currentIssueObj = issues.find(
                        (i) => i.issueKey === selectedIssue
                      ) as any
                      return (
                        <WorkflowPanel
                          issueKey={selectedIssue}
                          currentStatus={currentIssueObj?.status}
                          issueTypeName={
                            currentIssueObj?.issueType?.name ||
                            currentIssueObj?.issue_type_name
                          }
                        />
                      )
                    })()}
                    {/* Phase 22.11.2: 同 (issue, template) で過去 doc があれば
                        バナーで通知。「前回内容を読み込む」(新規発行) と
                        「再編集モードで開く」(リビジョン採番) を選べる。
                        formData は上書きされないため、現状を見失わない設計。 */}
                    {previousDocument && (
                      <div className="rounded-sm border border-blue-200 bg-blue-50 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-[11px] font-mono text-blue-900 leading-relaxed">
                            <div className="font-bold mb-0.5">
                              📄 この課題には過去文書あり: {previousDocument.document_number}
                              {previousDocument.revision > 0 && (
                                <span className="ml-1 text-blue-700/70">
                                  (Rev. {previousDocument.revision})
                                </span>
                              )}
                            </div>
                            <div className="text-blue-800/80">
                              作成日:{" "}
                              {new Date(
                                previousDocument.created_at
                              ).toLocaleString("ja-JP")}
                              {previousDocument.vendor_name_snapshot && (
                                <>
                                  {" "}/ 取引先:{" "}
                                  <span className="font-bold">
                                    {previousDocument.vendor_name_snapshot}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPreviousDocument(null)}
                            className="text-blue-600/40 hover:text-blue-900 text-[10px] flex-shrink-0"
                            title="バナーを閉じる"
                          >
                            ×
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {previousDocument.drive_link && (
                            <a
                              href={previousDocument.drive_link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] font-mono uppercase tracking-wider text-blue-700 hover:text-blue-900 underline"
                            >
                              前回 PDF を確認
                            </a>
                          )}
                          <button
                            type="button"
                            disabled={loadingPrevious}
                            onClick={handleLoadPrevious}
                            className="text-[10px] font-mono uppercase tracking-wider border border-blue-600/40 bg-white hover:bg-blue-100 text-blue-800 px-2 py-1 rounded-sm disabled:opacity-50"
                            title="前回 doc の内容をフォームに読み込み (新規番号で発行)"
                          >
                            前回内容を引き継ぐ (新規発行)
                          </button>
                          <button
                            type="button"
                            disabled={loadingPrevious}
                            onClick={handleReopenPrevious}
                            className="text-[10px] font-mono uppercase tracking-wider border border-amber-600/40 bg-white hover:bg-amber-100 text-amber-800 px-2 py-1 rounded-sm disabled:opacity-50"
                            title="前回 doc を再編集モードで開く (リビジョン採番される)"
                          >
                            再編集モードで開く (_001 採番)
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Phase 17: 稟議番号セレクタ — 全テンプレ共通の header field。
                        formData.ringi_numbers[] に保存し、Finalize & Sync で
                        worker が ringi_documents (N:N) に upsert する。 */}
                    <RingiSelector
                      value={
                        Array.isArray(formData.ringi_numbers)
                          ? formData.ringi_numbers
                          : []
                      }
                      onChange={(next) =>
                        setFormData({ ...formData, ringi_numbers: next })
                      }
                    />
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
                  </div>
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
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={handlePreview}
                        disabled={isPreviewing}
                      >
                        <RefreshCw className={isPreviewing ? "animate-spin" : ""} />
                        Refresh
                      </Button>
                      {/* Phase 9g: プレビュー画面内にも明示的な閉じるボタン */}
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => setIsPreviewVisible(false)}
                        title="編集画面に戻る"
                      >
                        <X />
                        編集に戻る
                      </Button>
                    </div>
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
                      ) : previewError ? (
                        <div className="flex flex-col items-center justify-center py-12 px-6">
                          <div className="w-full max-w-xl rounded-md border border-destructive/30 bg-destructive/5 p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-mono font-bold uppercase tracking-[0.2em] text-destructive">
                                Preview failed
                              </span>
                            </div>
                            <pre className="text-[10.5px] font-mono whitespace-pre-wrap break-words text-destructive/90 max-h-[280px] overflow-auto">
                              {previewError}
                            </pre>
                            <div className="mt-3 text-[10px] font-mono text-muted-foreground">
                              ヒント: Cloud Run worker のログで「Preview failed:」を検索すると
                              テンプレートの Handlebars エラー詳細が確認できます。
                            </div>
                            <Button
                              variant="outline"
                              size="xs"
                              className="mt-3"
                              onClick={handlePreview}
                              disabled={isPreviewing}
                            >
                              <RefreshCw className={isPreviewing ? "animate-spin" : ""} />
                              Retry
                            </Button>
                          </div>
                        </div>
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

      {/* Phase 9g: 文書生成完了サクセスモーダル
          Finalize & Sync 成功時に表示。ユーザーに「できた!」という
          達成感を返しつつ、次のアクション (Drive で開く / 新規作成 /
          ダッシュボードへ) を 1 クリックで選べる。 */}
      {completionResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setCompletionResult(null)}
        >
          <div
            className="bg-card border border-border rounded-sm shadow-2xl max-w-lg w-full mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-5 flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
                <PartyPopper className="h-6 w-6" />
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-700">
                  Generation Complete
                </div>
                <div className="text-base font-bold text-emerald-900 mt-0.5">
                  文書を作成しました
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-3">
              <div className="space-y-1">
                <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                  テンプレ
                </div>
                <div className="text-sm font-mono">
                  {completionResult.templateLabel}
                </div>
              </div>
              {completionResult.documentNumber && (
                <div className="space-y-1">
                  <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                    文書番号
                  </div>
                  <div className="text-sm font-mono font-bold">
                    {completionResult.documentNumber}
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                  Drive リンク
                </div>
                <a
                  href={completionResult.driveLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-blue-700 hover:text-blue-900 underline break-all flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                  {completionResult.driveLink}
                </a>
              </div>
            </div>

            {/* Footer actions */}
            <div className="bg-muted/30 border-t border-border px-6 py-4 flex flex-col sm:flex-row gap-2 sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCompletionResult(null)}
              >
                <X />
                閉じる
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleStartNew}
              >
                <Plus />
                新しい文書を作成
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  window.open(completionResult.driveLink, "_blank")
                }
              >
                <ExternalLink />
                Drive で開く
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
