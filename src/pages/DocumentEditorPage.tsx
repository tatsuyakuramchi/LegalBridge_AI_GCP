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
import {
  DocumentNumberLookup,
  type LookedUpDocument,
} from "@/src/components/document/DocumentNumberLookup"

export function DocumentEditorPage() {
  const {
    issues,
    vendors,
    staffList,
    assets,
    contracts: allContracts,
    ledgers: allLedgers,
    templateList,
    templateMetadata,
    companyProfile,
    showNotification,
    refreshIssues,
    refreshAssets, // Phase 22.21.32: 文書生成後に Archive リストを最新化
    refreshContracts, // Phase 22.21.123: Sheet 開く度にマスタ最新化
  } = useAppData()

  // Phase 22.21.92: royalty_statement 向け — license カテゴリかつ
  // financial_conditions を持つ契約マスタ一覧。
  // DocumentNumberLookup の onApply で master 行を選んだとき auto-fill に使う。
  const royaltyLicenseMasters = (allContracts || []).filter(
    (c: any) =>
      String(c.contract_category || '').toLowerCase() === 'license' &&
      (c.record_type === 'standalone_contract' ||
        c.record_type === 'individual_contract' ||
        c.record_type === 'license_condition') &&
      Array.isArray(c.financial_conditions) &&
      c.financial_conditions.length > 0
  )

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
  // Phase 23.1: 再編集モード時の保存方針。
  //   - 'internal': 内部修正 (同 row 上書き、Drive PDF も同 URL に差し替え) ← default
  //   - 'reissue':  再発行 (revision +1、過去 row は lifecycle='reissued' に)
  //   新規発行 (reopen 経由でない) の場合は UI 非表示で常に 'internal' 扱い相当。
  const [saveMode, setSaveMode] = React.useState<"internal" | "reissue">(
    "internal"
  )
  // Phase 23.0.4: 未入力フィールド ring ハイライト解除の setTimeout id。
  //   連続 generate で前回の timer が新規 wrap の ring を消さないようにする。
  const scrollRingTimerRef = React.useRef<number | null>(null)
  const scrollRingWrapRef = React.useRef<HTMLElement | null>(null)
  React.useEffect(() => {
    return () => {
      if (scrollRingTimerRef.current != null) {
        window.clearTimeout(scrollRingTimerRef.current)
      }
      scrollRingWrapRef.current?.classList.remove(
        "ring-2",
        "ring-destructive",
        "rounded-md"
      )
    }
  }, [])
  // Phase 22.21.29: 課題選択時の閲覧モード。
  //   旧挙動: REQUESTS から課題をクリック → form-context をマージ → 直前の
  //           作業データが残り、新しい課題のデータと混在する事故が発生。
  //   新挙動:
  //     1. 課題選択時 → formData を一旦リセット → form-context だけで再構築
  //     2. isReadOnly=true で「閲覧モード」表示 (pointer-events:none + opacity)
  //     3. ユーザーが [編集] ボタンを押したら isReadOnly=false → 通常編集
  //   フォーム初期状態 (課題未選択) では isReadOnly=false (新規作成扱い)。
  const [isReadOnly, setIsReadOnly] = React.useState(false)
  const [previewHtml, setPreviewHtml] = React.useState<string | null>(null)
  // Phase 22.21.16: プレビュー API のエラーを UI 上で可視化。
  //   旧実装は console.error しかしておらず、500 や空 html を返した場合に
  //   「Awaiting field input…」のまま無言で止まっていた。
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = React.useState(false)
  const [isGenerating, setIsGenerating] = React.useState(false)
  // Phase 9g: 文書生成完了後の達成感のあるサクセス画面用
  // Phase 22.21.104: 検収書 / 利用許諾料計算書では excelLink も返るので保持
  const [completionResult, setCompletionResult] = React.useState<{
    driveLink: string;
    excelLink?: string | null;
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

  /**
   * Phase 22.21.79: form_data を DB に一時保存する (document_drafts テーブル)。
   *
   * 呼び出しタイミング:
   *   1. 「🔒 閲覧モードに戻す」/ 「✎ 編集を開始」 ボタン押下時 (両方向)
   *   2. 必要なら手動「一時保存」ボタンからも (未実装、将来拡張)
   *
   * 失敗しても UX は止めない (notification 出して継続)。localStorage の
   * draft とは独立 (両方走らせて二重に保護)。
   */
  const saveDraftToServer = React.useCallback(
    async (silent = false): Promise<boolean> => {
      if (!selectedIssue || !selectedTemplate) return false
      // 中身が空 (or 制御フラグのみ) なら保存しない
      const hasContent = Object.keys(formData || {}).some(
        (k) => !k.startsWith("__") && (formData as any)[k] != null && (formData as any)[k] !== ""
      )
      if (!hasContent) return false
      try {
        const res = await fetch("/api/document-drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issue_key: selectedIssue,
            template_type: selectedTemplate,
            form_data: formData,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || `HTTP ${res.status}`)
        }
        if (!silent) {
          showNotification(`📄 Draft saved (${selectedIssue})`, "success")
        }
        return true
      } catch (e: any) {
        // localStorage には別 effect で書かれ続けるので致命的ではない
        console.warn("[saveDraftToServer] failed:", e)
        if (!silent) {
          showNotification(
            `Draft 保存失敗 (localStorage には保存済): ${e?.message || e}`,
            "error"
          )
        }
        return false
      }
    },
    [selectedIssue, selectedTemplate, formData, showNotification]
  )

  /**
   * Phase 22.21.79: 閲覧 ⇄ 編集モード切替時に draft 保存をはさむ。
   * setIsReadOnly を直接呼ばずにこちらを使う。
   */
  const toggleReadOnly = React.useCallback(
    async (nextReadOnly: boolean) => {
      // 編集モードから抜けるとき (= 閲覧モードへ) は確実に保存
      // 編集モードに入るとき (= 閲覧モードから抜ける) も念のため保存
      //   (DBSYNC で過去 draft を上書き読み込みする前に現在の状態を残しておく)
      await saveDraftToServer(/* silent */ false)
      setIsReadOnly(nextReadOnly)
    },
    [saveDraftToServer]
  )

  const syncFromDatabase = React.useCallback(
    async (issueKeyToUse?: string) => {
      const key = issueKeyToUse || selectedIssue
      if (!key) {
        showNotification("Please select a Backlog ticket first.", "error")
        return
      }
      const issue = issues.find((i) => i.issueKey === key)

      // Phase 22.21.79: まず document_drafts (一時保存) を確認。
      //   draft があれば form-context より優先して読み込む (= 直近の編集状態を復元)。
      //   無ければ従来通り backlog form-context へフォールバック。
      let draft: any = null
      if (selectedTemplate) {
        try {
          const dRes = await fetch(
            `/api/document-drafts/${encodeURIComponent(key)}?template_type=${encodeURIComponent(
              selectedTemplate
            )}`
          )
          if (dRes.ok) {
            const d = await dRes.json().catch(() => ({}))
            if (d?.ok && d?.draft) draft = d.draft
          }
          // 404 は draft 無し = 正常系。それ以外のエラーも警告のみで継続。
        } catch (e) {
          console.warn("[syncFromDatabase] draft lookup failed:", e)
        }
      }

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
        // Phase 22.21.29: prev をマージせず、フォームを 完全に置換 する。
        //   そうしないと直前の課題で入力したフィールドがリーク。
        //   __local_* / __pdf_pending 等の制御フラグは ここでは入れない
        //   (リセットが目的なので)。
        // Phase 22.21.79: draft があれば context をベースに draft で上書きする。
        //   draft は最新の編集状態 (= ユーザーが最後に入力した内容) なので、
        //   context の自動補完値で塗りつぶされないよう draft を後にスプレッドする。
        const base: Record<string, any> = {
          基本契約名: issue?.summary || "",
          remarks: issue?.description || "",
          ...context,
        }
        if (draft?.form_data && typeof draft.form_data === "object") {
          Object.assign(base, draft.form_data)
          const when = draft.updated_at
            ? new Date(draft.updated_at).toLocaleString("ja-JP")
            : ""
          showNotification(
            `📄 Draft restored from server (${when})`,
            "success"
          )
        }
        setFormData(base)
      } catch (e) {
        setPreviousDocument(null)
        if (draft?.form_data && typeof draft.form_data === "object") {
          // form-context 取得失敗時も draft があれば最低限復元する
          setFormData(draft.form_data)
          showNotification(`📄 Draft restored (form-context 取得失敗)`, "success")
        } else if (issue) {
          setFormData({
            基本契約名: issue.summary || "",
            remarks: issue.description || "",
          })
        } else {
          setFormData({})
        }
      }
    },
    [issues, selectedTemplate, selectedIssue, setFormData, showNotification]
  )

  const handleIssueSelect = async (issueKey: string) => {
    setSelectedIssue(issueKey)
    // Phase 22.21.29: 課題切替時に「閲覧モード」をオン。編集はユーザーが
    //   [編集] ボタンを押した時のみ可能になる (誤編集防止)。
    setIsReadOnly(true)
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
      // Phase 22.21.29: 「前回内容を引き継ぐ」= 編集意図あり → 編集モードに
      setIsReadOnly(false)
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
      // Phase 22.21.29: 「再編集モードで開く」= 編集意図あり → 編集モードに
      setIsReadOnly(false)
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
      const missing: { id: string; label: string }[] = []
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
          missing.push({ id, label: m.label || id })
        }
      })
      if (missing.length > 0) {
        const preview = missing.slice(0, 5).map((m) => m.label).join("、")
        const tail =
          missing.length > 5 ? ` 他 ${missing.length - 5} 件` : ""
        showNotification(
          `必須項目が未入力です: ${preview}${tail}。最初の項目までスクロールします。`,
          "error"
        )
        // Phase 23 UX-J: 最初の未入力必須フィールドへ自動スクロール + フォーカス
        // Phase 23.0.4:
        //   - 祖先の <details> が閉じていると要素が display:none で到達不可なので
        //     先に全部 open に。
        //   - prefers-reduced-motion を尊重して smooth/auto を切替。
        //   - フォーカス対象から [readonly] / [disabled] を除外
        //     (Wave1 で readonly select が増えたため)。
        //   - 前回 setTimeout の ring 解除が新規 wrap を巻き込まないよう
        //     ref で id を保持し、新規スクロール時にクリア。
        const firstId = missing[0].id
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => {
            const wrap = document.querySelector(
              `[data-field-id="${firstId}"]`
            ) as HTMLElement | null
            if (!wrap) return

            // 祖先の details を遡って全部 open に
            let detailsAncestor: HTMLElement | null =
              wrap.closest("details:not([open])")
            while (detailsAncestor) {
              detailsAncestor.setAttribute("open", "")
              detailsAncestor =
                detailsAncestor.parentElement?.closest(
                  "details:not([open])"
                ) || null
            }

            const prefersReducedMotion =
              window.matchMedia &&
              window.matchMedia("(prefers-reduced-motion: reduce)").matches
            wrap.scrollIntoView({
              behavior: prefersReducedMotion ? "auto" : "smooth",
              block: "center",
            })

            // 前回のタイマー / wrap の ring を解除してから新しい ring を付ける
            if (scrollRingTimerRef.current != null) {
              window.clearTimeout(scrollRingTimerRef.current)
            }
            scrollRingWrapRef.current?.classList.remove(
              "ring-2",
              "ring-destructive",
              "rounded-md"
            )

            wrap.classList.add("ring-2", "ring-destructive", "rounded-md")
            scrollRingWrapRef.current = wrap
            scrollRingTimerRef.current = window.setTimeout(() => {
              wrap.classList.remove(
                "ring-2",
                "ring-destructive",
                "rounded-md"
              )
              if (scrollRingWrapRef.current === wrap) {
                scrollRingWrapRef.current = null
              }
              scrollRingTimerRef.current = null
            }, 3000)

            const focusable = wrap.querySelector(
              "input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), select:not([disabled]), button:not([disabled])"
            ) as HTMLElement | null
            focusable?.focus()
          })
        }
        return
      }
    }

    setIsGenerating(true)
    try {
      // Phase 23.1: 再編集 (reopen) かつ saveMode='reissue' のときだけ reissue=true。
      //   その他 (新規発行 / 内部修正 / PDF 未作成キュー再生成) は reissue=false。
      const isReopen = !!formData?.__reopen_doc_number
      const reissueFlag = isReopen && saveMode === "reissue"
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
          reissue: reissueFlag,
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
          // Phase 22.21.104: 検収書 / 利用許諾料計算書のみ excelLink あり
          excelLink: data.excelLink || null,
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
      // Phase 22.21.32: 生成成功直後に Archive のキャッシュを更新。
      //   これが無いと Archive ページに移動してもリロードしないと新文書が
      //   見えない (= "アーカイブに作成文章が反映されない" バグの修正)。
      //   PDF 未作成キューからの再生成 / リビジョン再発行も同じ /api/documents/generate
      //   経由なので、このパスで一律カバーされる。
      try {
        await refreshAssets?.()
      } catch (refErr) {
        console.warn("[generate] refreshAssets failed:", refErr)
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
                    className="text-[11px] font-mono uppercase tracking-wider text-background/60 hover:text-background flex items-center gap-1 disabled:opacity-50"
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
                onClick={() => {
                  // Phase 22.21.93: サイドバーから開くときは callback を
                  // 必ずクリアして、template-aware モード (Mode 1/2 = Master+Archive
                  // 横断検索) に確実に入るようにする。callback が残っていると
                  // 検収書/発注書フォームの「PO紐付」用 Archive 専用 UI に
                  // 落ちてしまっていた。
                  // Phase 22.21.123: 別タブで契約を登録した後でも反映されるよう
                  // 開く度に refreshContracts() で master データを最新化。
                  setAssetPickerCallback(null)
                  setIsAssetPickerOpen(true)
                  refreshContracts?.()
                }}
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
                    <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
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
                {/* Phase 23 UX-A: 採番ステータスバッジ
                    formData.documentNumber が存在 → 採番済 (緑)
                    formData.__reopen_id がある → 既存編集 (青)
                    それ以外 → 未採番 Draft (アンバー)
                */}
                {(() => {
                  const docNum = formData.documentNumber as string | undefined;
                  const reopenId = formData.__reopen_id as number | undefined;
                  if (docNum) {
                    return (
                      <span
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-mono font-bold text-emerald-800"
                        title={`採番済: ${docNum}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        採番済 · {docNum}
                      </span>
                    );
                  }
                  if (reopenId) {
                    return (
                      <span
                        className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-[10px] font-mono font-bold text-sky-800"
                        title="既存文書の再編集 (生成時にリビジョン採番)"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                        再編集 · Rev予定
                      </span>
                    );
                  }
                  return (
                    <span
                      className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-mono font-bold text-amber-800"
                      title="未採番 Draft — 生成ボタン押下時に自動採番されます"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                      未採番 Draft
                    </span>
                  );
                })()}
                {lastAutoSave && (
                  <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncFromDatabase()}
                  title="Backlog 課題 / 過去の draft から件名・取引先・明細などを取得して入力欄に反映します"
                >
                  <Database />
                  Backlog Sync
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

                    {/* Phase 22.21.29: 閲覧モードバナー
                        REQUESTS から課題を選択した直後は閲覧モードに入る。
                        ユーザーが [編集を開始] を押すまでフォームは pointer-events
                        無効化で読み取り専用になる。誤入力/直前データ混在を防ぐ。 */}
                    {isReadOnly && selectedIssue && (
                      <div className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2.5 flex items-center justify-between gap-3">
                        <div className="text-[11px] font-mono text-amber-900 leading-relaxed">
                          <div className="font-bold mb-0.5">
                            🔒 閲覧モード - {selectedIssue}
                          </div>
                          <div className="text-amber-800/80">
                            読み取り専用です。編集するには右の「編集を開始」をクリックしてください。
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleReadOnly(false)}
                          className="flex-shrink-0 text-[10px] font-mono font-bold uppercase tracking-wider bg-foreground text-background hover:opacity-90 px-3 py-1.5 rounded-sm"
                          title="フォームを編集可能にする (現在の内容を一時保存してから切り替え)"
                        >
                          ✎ 編集を開始
                        </button>
                      </div>
                    )}
                    {!isReadOnly && selectedIssue && (
                      <div className="rounded-sm border border-emerald-300 bg-emerald-50 px-3 py-1.5 flex items-center justify-between gap-3">
                        <div className="text-[11px] font-mono text-emerald-900">
                          <span className="font-bold">✎ 編集モード</span>
                          <span className="ml-2 text-emerald-800/70">
                            変更は draft として localStorage + DB
                            (モード切替時) に保存
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleReadOnly(true)}
                          className="flex-shrink-0 text-[10px] font-mono uppercase tracking-wider border border-emerald-700/40 bg-white hover:bg-emerald-100 text-emerald-800 px-2 py-1 rounded-sm"
                          title="閲覧モードに戻す (現在の内容を DB に一時保存)"
                        >
                          🔒 閲覧モードに戻す
                        </button>
                      </div>
                    )}

                    {/* Phase 17: 稟議番号セレクタ — 全テンプレ共通の header field。
                        formData.ringi_numbers[] に保存し、Finalize & Sync で
                        worker が ringi_documents (N:N) に upsert する。 */}
                    {/* Phase 22.21.29: 閲覧モードでは pointer-events 無効化で
                        すべての入力を不可にする。CSS だけなので keyboard で
                        focus は出来ない (tabindex は html input が持つ) が、
                        テキスト選択 (user-select:text) は許可してコピー可能に。 */}
                    <div
                      className={
                        isReadOnly
                          ? "pointer-events-none opacity-75 select-text"
                          : ""
                      }
                      aria-readonly={isReadOnly ? "true" : "false"}
                    >
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
                        // Phase 22.21.122: callback なしの Sheet 起動。
                        //   inspection_certificate / royalty_statement の
                        //   フォーム内インラインボタンからマスタ検索を直接開く。
                        // Phase 22.21.123: 開く度に refreshContracts() で
                        //   master データを最新化 (別タブで登録した直後でも反映)。
                        onOpenLegalAssetSearch={() => {
                          setAssetPickerCallback(null)
                          setIsAssetPickerOpen(true)
                          refreshContracts?.()
                        }}
                        companyProfile={companyProfile}
                        activeVendor={activeVendor}
                        selectedStaff={selectedStaff}
                      />
                    </div>
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
                    <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
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
                    <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
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
                {/* Phase 23.1: 再編集モード (= reopen 経由) のときだけ
                    「内部修正 / 再発行」の保存方針を選ばせる。
                    - 内部修正: 既存 row 上書き、Drive PDF も同 URL のまま差し替え
                    - 再発行:   revision +1 で新 row、過去版は履歴に。PDF に「修正版 Rev. N」 */}
                {formData?.__reopen_doc_number && (
                  <div
                    role="radiogroup"
                    aria-label="保存方針"
                    className="flex items-center gap-2 text-[11px] font-mono border border-input rounded-sm px-2 py-1 bg-muted/30"
                  >
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="saveMode"
                        value="internal"
                        checked={saveMode === "internal"}
                        onChange={() => setSaveMode("internal")}
                        className="cursor-pointer"
                      />
                      <span>内部修正</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="saveMode"
                        value="reissue"
                        checked={saveMode === "reissue"}
                        onChange={() => setSaveMode("reissue")}
                        className="cursor-pointer"
                      />
                      <span>
                        再発行
                        <span className="text-muted-foreground/70 ml-1">
                          (外部要請)
                        </span>
                      </span>
                    </label>
                  </div>
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

      {/* Asset picker — Phase 22.21.92 改修
          ・royalty_statement    → 個別利用許諾条件書 (archive) + ライセンスマスタ (master) 横断検索
          ・inspection_certificate → 発注書 (archive) + 業務委託マスタ (master) 横断検索
          ・その他 / assetPickerCallback あり → 従来の ExternalAsset (Archive) リスト */}
      <Sheet
        open={isAssetPickerOpen}
        onOpenChange={(v) => {
          // Phase 22.21.93: 閉じるとき (X クリック / 外側クリック) は
          // callback も同時にクリア。閉じ忘れ callback が次回起動時に
          // Mode 3 (Archive 専用) を強制してしまう不具合を防ぐ。
          if (!v) setAssetPickerCallback(null)
          setIsAssetPickerOpen(v)
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              {selectedTemplate === "royalty_statement" && !assetPickerCallback
                ? "▍ 文書検索 — 利用許諾料計算書"
                : selectedTemplate?.startsWith("inspection_certificate") && !assetPickerCallback
                ? "▍ 文書検索 — 検収書"
                : "▍ Legal asset search"}
            </SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-3 pt-2">

            {/* ── royalty_statement: 個別利用許諾条件書 + ライセンスマスタを横断検索 ── */}
            {selectedTemplate === "royalty_statement" && !assetPickerCallback ? (
              <>
                <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                  個別利用許諾条件書（Archive）またはライセンス単独契約（Master）を選択すると、
                  当事者・原著作物・金銭条件が自動補完されます。
                </p>
                <DocumentNumberLookup
                  label="個別利用許諾条件書 / ライセンスマスタを検索"
                  placeholder="取引先名 / 原著作物名 / 文書番号…"
                  filterTemplateTypes={["individual_license_terms", "license_master"]}
                  includeMaster={true}
                  onApply={(doc: LookedUpDocument) => {
                    if (doc.source === "master") {
                      // contract_capabilities から選択 → full auto-fill
                      const c = royaltyLicenseMasters.find(
                        (x: any) => Number(x.id) === doc.id
                      )
                      if (c) {
                        const ledger = c.ledger_code
                          ? (allLedgers || []).find(
                              (l: any) => l.ledger_code === c.ledger_code
                            )
                          : null
                        const firstCond = (c.financial_conditions || [])[0]
                        // Phase 22.21.97: 取引先の entity_type から 御中/様 を判定
                        const vt = String(
                          (c as any).vendor_entity_type ||
                            (c as any).entity_type ||
                            ""
                        ).toLowerCase()
                        const isCorp = vt === "corporate" || vt === "法人"
                        setFormData((prev: any) => ({
                          ...prev,
                          selected_master_contract_id: Number(c.id),
                          // Phase 22.21.94: PDF ヘッダ右上の「契約番号」欄に出力
                          linked_contract_number:
                            c.document_number || prev.linked_contract_number || "",
                          // Phase 22.21.108: 取引先コード + 源泉徴収フラグ
                          VENDOR_CODE:
                            (c as any).vendor_code || prev.VENDOR_CODE || "",
                          VENDOR_WITHHOLDING_ENABLED:
                            (c as any).vendor_withholding_enabled === true ||
                            prev.VENDOR_WITHHOLDING_ENABLED === true,
                          licensor: c.vendor_name || prev.licensor || "",
                          // Phase 22.21.97: 御中/様 サフィックス
                          LICENSOR_SUFFIX: isCorp ? "御中" : "様",
                          LICENSOR_IS_CORPORATION: isCorp ? "法人" : "個人",
                          licensee: companyProfile?.name || prev.licensee || "",
                          // Phase 22.21.103: 振込先口座を取引先マスタから自動補完
                          bankName:
                            (c as any).vendor_bank_name || prev.bankName || "",
                          branchName:
                            (c as any).vendor_branch_name ||
                            prev.branchName ||
                            "",
                          accountType:
                            (c as any).vendor_account_type ||
                            prev.accountType ||
                            "",
                          accountNo:
                            (c as any).vendor_account_number ||
                            prev.accountNo ||
                            "",
                          accountHolder:
                            (c as any).vendor_account_holder_kana ||
                            prev.accountHolder ||
                            "",
                          invoiceRegistrationNumber:
                            (c as any).vendor_invoice_registration_number ||
                            prev.invoiceRegistrationNumber ||
                            "",
                          originalWork:
                            ledger?.title ||
                            c.original_work ||
                            c.work_name ||
                            prev.originalWork ||
                            "",
                          financial_conditions: (
                            c.financial_conditions as any[]
                          ).map((fc: any) => ({ ...fc, source: "capability" })),
                          license_contract_id: 0,
                          license_financial_condition_id: 0,
                          capability_financial_condition_id: 0,
                          currency: firstCond?.currency || prev.currency || "JPY",
                        }))
                      }
                    } else {
                      // archive: individual_license_terms から選択 → 部分 auto-fill
                      const fd = doc.form_data || {}
                      const conditions = Array.isArray(fd.financial_conditions)
                        ? fd.financial_conditions.map((fc: any) => ({
                            ...fc,
                            source: "license",
                          }))
                        : []
                      setFormData((prev: any) => ({
                        ...prev,
                        // Phase 22.21.94: PDF ヘッダ右上の「契約番号」に出力 —
                        // archive ILT の document_number を流し込む
                        linked_contract_number:
                          doc.document_number || prev.linked_contract_number || "",
                        licensor:
                          fd["Licensor_名称"] ||
                          fd["Licensor_氏名会社名"] ||
                          prev.licensor ||
                          "",
                        licensee:
                          fd["Licensee_名称"] ||
                          fd["Licensee_氏名会社名"] ||
                          prev.licensee ||
                          "",
                        originalWork: fd["原著作物名"] || prev.originalWork || "",
                        financial_conditions:
                          conditions.length > 0
                            ? conditions
                            : prev.financial_conditions,
                        // archive ILT の場合、条件の DB ID は確定しないため
                        // Step 1 の radio で改めて選択してください
                        capability_financial_condition_id: 0,
                        license_financial_condition_id: 0,
                      }))
                    }
                    setIsAssetPickerOpen(false)
                  }}
                />
              </>
            ) : selectedTemplate?.startsWith("inspection_certificate") &&
              !assetPickerCallback ? (
              /* ── inspection_certificate: 発注書 + 業務委託マスタを横断検索 ── */
              <>
                <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                  対象の発注書（Archive）または業務委託マスタ（Master）を選択すると、
                  受託者・契約番号・業務明細・振込先・取引先コードが自動補完されます。
                </p>
                <DocumentNumberLookup
                  label="発注書 / 業務委託マスタを検索"
                  placeholder="取引先名 / 文書番号 / プロジェクト名…"
                  filterTemplateTypes={["purchase_order", "service_master"]}
                  includeMaster={true}
                  onApply={(doc: LookedUpDocument) => {
                    const fd = doc.form_data || {}
                    if (doc.source === "master") {
                      // Phase 22.21.112: 業務委託マスタ選択 → 業務明細を
                      //   検収書フォームの order_lines_for_inspection に流し込み。
                      //   master 行の line_items は capability_line_items から
                      //   API SELECT で json_agg されている (allContracts に含まれる)。
                      const c = (allContracts as any[] || []).find(
                        (x: any) => Number(x.id) === doc.id
                      )
                      if (c) {
                        const linesRaw = Array.isArray(c.line_items)
                          ? c.line_items
                          : []
                        const orderLines = linesRaw.map((l: any, idx: number) => ({
                          line_no: Number(l.line_no) || idx + 1,
                          item_name: l.item_name || "",
                          spec: l.spec || "",
                          category: l.category || "",
                          calc_method: l.calc_method || "FIXED",
                          quantity: Number(l.quantity) || 0,
                          unit_price: Number(l.unit_price) || 0,
                          amount_ex_tax: Number(l.amount_ex_tax) || 0,
                          delivery_date: l.delivery_date || "",
                          payment_date: l.payment_date || "",
                          payment_terms: l.payment_terms || "",
                          payment_method: l.payment_method || "",
                          cycle: l.cycle || "",
                          billing_day: l.billing_day || "",
                          term_start: l.term_start || "",
                          term_end: l.term_end || "",
                        }))
                        const isCorp =
                          String(c.vendor_entity_type || "").toLowerCase() ===
                            "corporate" || c.vendor_entity_type === "法人"
                        setFormData((prev: any) => ({
                          ...prev,
                          // 取引先 (受託者)
                          counterparty:
                            c.vendor_name || prev.counterparty || "",
                          counterpartyRep: prev.counterpartyRep || "",
                          COUNTERPARTY_IS_CORPORATION: isCorp ? "法人" : "個人",
                          // Master 紐付け (検収書では parent_po_* は使わない)
                          selected_master_contract_id: Number(c.id),
                          linked_contract_number:
                            c.document_number || prev.linked_contract_number || "",
                          // 取引先コード + 源泉徴収 (Excel 用)
                          VENDOR_CODE:
                            c.vendor_code || prev.VENDOR_CODE || "",
                          VENDOR_WITHHOLDING_ENABLED:
                            c.vendor_withholding_enabled === true ||
                            prev.VENDOR_WITHHOLDING_ENABLED === true,
                          // 振込先 (取引先マスタから)
                          bankName: c.vendor_bank_name || prev.bankName || "",
                          branchName: c.vendor_branch_name || prev.branchName || "",
                          accountType: c.vendor_account_type || prev.accountType || "",
                          accountNo: c.vendor_account_number || prev.accountNo || "",
                          accountHolder:
                            c.vendor_account_holder_kana ||
                            prev.accountHolder ||
                            "",
                          counterpartyTni:
                            c.vendor_invoice_registration_number ||
                            prev.counterpartyTni ||
                            "",
                          // 業務明細 → order_lines_for_inspection
                          //   親 PO 紐付けは無し (master 起点なので)
                          parent_po_id: undefined,
                          parent_po_issue_key: undefined,
                          parent_po_number: c.document_number || "",
                          order_lines_for_inspection: orderLines,
                          // 検収側の入力は空でスタート
                          delivery_line_items: [],
                          po_expenses: [],
                          po_other_fees: [],
                        }))
                      }
                    } else {
                      // archive: 発注書 (purchase_order)
                      setFormData((prev: any) => ({
                        ...prev,
                        counterparty:
                          fd.VENDOR_NAME ||
                          doc.master_meta?.vendor_name ||
                          prev.counterparty ||
                          "",
                        ...(doc.template_type === "purchase_order"
                          ? { parent_po_number: doc.document_number }
                          : {}),
                      }))
                    }
                    setIsAssetPickerOpen(false)
                  }}
                />
              </>
            ) : (
              /* ── 通常モード / assetPickerCallback あり: ExternalAsset (Archive) ── */
              <>
                <Input
                  type="text"
                  autoFocus
                  placeholder="Contract no. / ledger ID / partner name…"
                  value={assetSearch}
                  onChange={(e) => setAssetSearch(e.target.value)}
                />
                <div className="border border-border rounded-md overflow-hidden">
                  <div className="grid grid-cols-[120px_1fr_auto] gap-3 px-3 py-2 bg-muted/40 border-b border-border text-[11px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    <span>Identity</span>
                    <span>Reference</span>
                    <span>Action</span>
                  </div>
                  <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
                    {assets
                      .filter(
                        (a) =>
                          a.asset_number.includes(assetSearch) ||
                          a.asset_name
                            .toLowerCase()
                            .includes(assetSearch.toLowerCase()) ||
                          a.counterparty
                            .toLowerCase()
                            .includes(assetSearch.toLowerCase())
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
                            <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground italic">
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
              </>
            )}
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
                <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                  テンプレ
                </div>
                <div className="text-sm font-mono">
                  {completionResult.templateLabel}
                </div>
              </div>
              {completionResult.documentNumber && (
                <div className="space-y-1">
                  <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                    文書番号
                  </div>
                  <div className="text-sm font-mono font-bold">
                    {completionResult.documentNumber}
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                  Drive リンク (PDF)
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
              {/* Phase 22.21.104: 検収書 / 利用許諾料計算書のみ Excel リンク表示 */}
              {completionResult.excelLink && (
                <div className="space-y-1">
                  <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-emerald-700">
                    会計用 Excel (自動生成)
                  </div>
                  <a
                    href={completionResult.excelLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-emerald-700 hover:text-emerald-900 underline break-all flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                    {completionResult.excelLink}
                  </a>
                  <p className="text-[10px] font-mono text-muted-foreground">
                    会計チームの支払処理フォーマット (件名/支払日/明細5行/源泉徴収/振込額) で出力
                  </p>
                </div>
              )}
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
