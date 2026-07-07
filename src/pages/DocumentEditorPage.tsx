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
  ClipboardList,
  Hash,
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

  // 請求の向き(必須) — 「当社が払う(in)」/「当社が受け取る(out)」の2択。
  //   生成時に formData.FLOW_DIRECTION として送り、worker が capability / 明細の
  //   flow_direction に反映する(out=ライセンス/プロダクトアウト → 請求台帳へ自動取込)。
  //   以前は contract_purposes の多数の目的をグループ表示していたが、文書生成フローで
  //   実際に効くのは方向(in/out)だけなので、ユーザー要望により2択へ簡素化。
  const [selectedDirection, setSelectedDirection] = React.useState<"" | "in" | "out">("")
  const [isRefreshingFields, setIsRefreshingFields] = React.useState(false)
  // Phase 23.2: 旧 Split preview (画面を半分にして並べる) は狭幅で厳しいため
  //   廃止し、別タブでプレビューを開く方式に一本化。
  //   isPreviewVisible / previewHtml / live preview useEffect は撤去済。
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
  // Phase 23.2: previewHtml はメイン画面に描画しなくなったため state 不要。
  //   別タブで blob URL を開くだけ。エラーは showNotification で表示。
  // Phase 22.21.16: プレビュー API のエラーを UI 上で可視化。
  //   旧実装は console.error しかしておらず、500 や空 html を返した場合に
  //   「Awaiting field input…」のまま無言で止まっていた。
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = React.useState(false)
  const [isGenerating, setIsGenerating] = React.useState(false)
  // 実行中の保存モード。"issue"=文書発行(PDF), "dbOnly"=DB登録のみ。
  //   どちらのボタンにスピナーを出すかの判定に使う。
  const [generateMode, setGenerateMode] = React.useState<
    "issue" | "dbOnly" | null
  >(null)
  // DB登録のみ用の任意ファイルリンク (既存の締結済み PDF 等の URL)。
  //   指定すると worker が drive_link として保存し、一覧/アーカイブから開ける。
  //   空なら PDF 未作成キューに入り、後から発行できる。
  const [dbOnlyFileLink, setDbOnlyFileLink] = React.useState("")
  // DB登録のみ時に「単独契約 (親なし)」として登録するフラグ。
  //   単独契約専用テンプレは無いため、発注書 / ILT 等のフォームで代用登録する
  //   ケースで record_type をテンプレ由来 (purchase_order 等) から
  //   standalone_contract に上書きする。
  const [dbOnlyStandalone, setDbOnlyStandalone] = React.useState(false)
  // 過去文書/下書きを番号で呼び出すフォーム(Sheet)の開閉。
  const [recallOpen, setRecallOpen] = React.useState(false)
  // 明示的な「保存」(= 初回保存で採番) の進行状態。
  const [isSavingDraft, setIsSavingDraft] = React.useState(false)
  // Phase 9g: 文書生成完了後の達成感のあるサクセス画面用
  // Phase 22.21.104: 検収書 / 利用許諾料計算書では excelLink も返るので保持
  const [completionResult, setCompletionResult] = React.useState<{
    driveLink: string;
    excelLink?: string | null;
    documentNumber: string;
    templateLabel: string;
  } | null>(null)
  // 選択中 Backlog 課題のオブジェクト (件名/本文/ステータス)。
  //   旧実装は課題プルダウン操作時のみセットされる useState だったため、
  //   ページ再訪 (再マウント) や reopen 経由では null のままになり
  //   「Backlog 課題内容」パネルが消えていた。selectedIssue は共有セッションで
  //   永続するので、常に issues から導出する (ワークフローパネルと同方式)。
  const issueSummary = React.useMemo(
    () =>
      selectedIssue
        ? issues.find((i) => i.issueKey === selectedIssue) || null
        : null,
    [issues, selectedIssue]
  )
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
  // 法務アセットを「ラインID」で検索(条件明細コード/明細行ID/capability ID → 契約解決)。
  const [lineIdQuery, setLineIdQuery] = React.useState("")
  const [lineIdLoading, setLineIdLoading] = React.useState(false)
  const [lineIdHit, setLineIdHit] = React.useState<any>(null)

  // 個人情報取得同意: 個人取引先の同意状況 + 同時作成スイッチ。
  const [consentInfo, setConsentInfo] = React.useState<{
    is_individual: boolean
    pii_consent_obtained: boolean
    pii_consent_date: string | null
  } | null>(null)
  const [createConsent, setCreateConsent] = React.useState(false)
  // 文書ごとのオプション: 個人取引先の宛名に「ペンネーム/屋号 こと 正式名称」を併記する。
  //   既定 OFF=正式名称のみ。DocumentForm の取引先オートフィルが参照する。
  const [combineVendorAlias, setCombineVendorAlias] = React.useState(false)

  // activeVendor 変更時に同意状況を取得し、個人かつ未同意ならスイッチを既定ON。
  React.useEffect(() => {
    const code = activeVendor?.vendor_code
    if (!code) {
      setConsentInfo(null)
      setCreateConsent(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/master/vendors/${encodeURIComponent(code)}/pii-consent`
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const d = await res.json()
        if (cancelled || !d?.ok) return
        setConsentInfo({
          is_individual: !!d.is_individual,
          pii_consent_obtained: !!d.pii_consent_obtained,
          pii_consent_date: d.pii_consent_date || null,
        })
        setCreateConsent(!!d.is_individual && !d.pii_consent_obtained)
      } catch (e) {
        if (!cancelled) {
          setConsentInfo(null)
          setCreateConsent(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeVendor?.vendor_code])

  // Phase 15/16: URL クエリパラメータで既存ドキュメントを pre-fill。
  //   ?from_pending=<id>   PDF 未作成キュー由来 (Phase 15)
  //   ?reopen=<id>         既に生成済み文書を再編集 (Phase 16)
  // どちらも /api/documents/:id で form_data を取得して setFormData する。
  const [searchParams, setSearchParams] = useSearchParams()
  const fromPendingId = searchParams.get("from_pending")
  const reopenId = searchParams.get("reopen")
  // ハブ(課題詳細)由来のディープリンク(?template=...&prefill=1)を初回マウント時に
  //   ref へ退避する。後段のプリフィル effect が消費する前に、別の effect が
  //   searchParams から template を削除するため、初期値を保持しておく。
  const initialTemplateParamRef = React.useRef(searchParams.get("template"))
  const initialPrefillRef = React.useRef(searchParams.get("prefill") === "1")
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
        // CSV一括インポート(v2)由来の form_data はキー名がエディタと異なるため正規化する。
        //   - line_items → items (LineItemTable が読む)
        //   - CONTRACT_TITLE → description (発注書タイトル)
        //   - VENDOR_CODE/VENDOR_NAME → vendor_code/vendor_name (取引先解決用)
        //   expenses / other_fees / financial_conditions はキーが一致するためそのまま。
        const rawFd = data.form_data || {}
        const isImported = !!(rawFd.__imported || rawFd.__v2)
        const normalized: Record<string, any> = { ...rawFd }
        if (isImported) {
          if (
            !Array.isArray(normalized.items) &&
            Array.isArray(rawFd.line_items)
          ) {
            normalized.items = rawFd.line_items.map((l: any) => ({
              line_no: l.line_no,
              item_name: l.item_name || "",
              spec: l.spec || "",
              category: l.category || "",
              calc_method: l.calc_method || "FIXED",
              payment_terms: l.payment_terms || "",
              unit_price: Number(l.unit_price) || 0,
              quantity: Number(l.quantity) || 0,
              amount_ex_tax: Number(l.amount_ex_tax) || 0,
              delivery_date: l.delivery_date || "",
              payment_date: l.payment_date || "",
            }))
          }
          if (!normalized.description)
            normalized.description =
              rawFd.CONTRACT_TITLE || rawFd.contract_title || ""
          // 件名(発注書テンプレの {{PROJECT_TITLE}})は CSV の contract_title を使う
          if (!normalized.PROJECT_TITLE)
            normalized.PROJECT_TITLE =
              rawFd.CONTRACT_TITLE || rawFd.contract_title || ""
          if (!normalized.vendor_code)
            normalized.vendor_code = rawFd.VENDOR_CODE || ""
          if (!normalized.vendor_name)
            normalized.vendor_name = rawFd.VENDOR_NAME || ""
        }
        setFormData({
          ...normalized,
          __from_pending_id: fromPendingId ? Number(fromPendingId) : undefined,
          __from_pending_doc_number: data.document_number,
          // Phase 16: reopen の場合は既存 doc を更新する識別子
          __reopen_id: reopenId ? Number(reopenId) : undefined,
          __reopen_doc_number: reopenId ? data.document_number : undefined,
        })
        // 前文書のセッション状態が居座らないよう、文書固有の選択をリセットする。
        //   - activeVendor: null にして下の解決 effect が読み込んだ doc の
        //     vendor_code から再解決できるようにする (if(activeVendor)return ガード対策)。
        //   - selectedStaff: null にして、通知系テンプレの STAFF 自動補完 effect が
        //     前担当者で読み込んだ doc の STAFF_* を上書きするのを防ぐ
        //     (doc の form_data には STAFF_* が既に含まれている)。
        //   - selectedDirection: "" にして読み込んだ FLOW_DIRECTION から再解決。
        //   - previousDocument: 前文書バナーをクリア。
        //   - isReadOnly: 再編集 / キュー再生成は編集意図ありなので編集可に。
        setActiveVendor(null)
        setSelectedStaff(null)
        setSelectedDirection("")
        setPreviousDocument(null)
        setIsReadOnly(false)
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

  // 請求の向き(selectedDirection)の既定値。未選択だと Finalize & Sync が押せないため、
  //   - form_data.FLOW_DIRECTION があればそれを採用
  //   - 発注書 / 検収書 は「当社が払う(in)」を既定にする(仕入・支払のため)
  // ユーザーは必要に応じてプルダウンで変更可能。
  React.useEffect(() => {
    if (selectedDirection) return
    const fd = (formData as any)?.FLOW_DIRECTION
    if (fd === "in" || fd === "out") {
      setSelectedDirection(fd)
      return
    }
    if (
      selectedTemplate === "purchase_order" ||
      (selectedTemplate || "").startsWith("inspection_certificate")
    ) {
      setSelectedDirection("in")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate, (formData as any)?.FLOW_DIRECTION])

  // インポート由来 / 既存文書を読み込んだ際、form_data の取引先コードから
  // activeVendor を解決して取引先プルダウンを自動選択する。
  // (vendors は非同期ロードのため、揃ったタイミングで解決する。)
  React.useEffect(() => {
    if (activeVendor) return
    const code =
      (formData as any)?.vendor_code || (formData as any)?.VENDOR_CODE
    if (!code || !Array.isArray(vendors) || vendors.length === 0) return
    const v = vendors.find((x: any) => x.vendor_code === code)
    if (v) setActiveVendor(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(formData as any)?.vendor_code, (formData as any)?.VENDOR_CODE, vendors])

  // ディープリンク: 未検収発注書インボックス等から
  //   /documents/new?template=inspection_certificate&parent_po=<contract_capabilities.id>
  //   で開くと、テンプレ=検収書 + 親発注書を事前選択する。
  const templateParam = searchParams.get("template")
  const parentPoParam = searchParams.get("parent_po")
  React.useEffect(() => {
    if (!templateParam && !parentPoParam) return
    if (templateParam) setSelectedTemplate(templateParam)
    if (parentPoParam) {
      // DocumentForm の親POピッカーが autoPickContractId として拾い、自動選択する。
      setFormData((prev: any) => ({
        ...(prev || {}),
        __preselect_parent_po_id: Number(parentPoParam) || undefined,
      }))
    }
    const sp = searchParams
    sp.delete("template")
    sp.delete("parent_po")
    sp.delete("prefill")
    setSearchParams(sp, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateParam, parentPoParam])

  // マテリアル登録フォーム(/master/materials)由来の prefill。
  //   ?prefill_material=1 で来たとき、sessionStorage('lb_material_prefill') に退避された
  //   { template, formData } を読み、テンプレ選択 + formData マージする(既存文書は汚さない)。
  const prefillMaterialRef = React.useRef(searchParams.get("prefill_material") === "1")
  React.useEffect(() => {
    if (!prefillMaterialRef.current) return
    prefillMaterialRef.current = false
    try {
      const raw = sessionStorage.getItem("lb_material_prefill")
      if (raw) {
        const p = JSON.parse(raw)
        if (p?.template) setSelectedTemplate(p.template)
        if (p?.formData && typeof p.formData === "object") {
          setFormData((prev: any) => ({ ...(prev || {}), ...p.formData }))
        }
      }
    } catch {
      /* noop: prefill 失敗時は空フォームで続行 */
    }
    sessionStorage.removeItem("lb_material_prefill")
    const sp = searchParams
    sp.delete("prefill_material")
    setSearchParams(sp, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    async (silent = false, assignNumber = false): Promise<boolean> => {
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
            // 採番は明示的な「保存」操作のときだけ行う(暗黙保存では採番しない)。
            assign_number: assignNumber,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || `HTTP ${res.status}`)
        }
        // 発番タイミング: 初回保存で採番された document_number を formData に保持し、
        //   生成(Finalize)時に existingDocumentNumber として流用する。
        const assignedNo = data?.draft?.document_number
        if (assignedNo && (formData as any).__draft_doc_number !== assignedNo) {
          setFormData((prev: any) => ({
            ...(prev || {}),
            __draft_doc_number: assignedNo,
          }))
        }
        if (!silent) {
          showNotification(
            `📄 Draft saved (${selectedIssue})${assignedNo ? ` — ${assignedNo}` : ""}`,
            "success"
          )
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
    async (
      issueKeyToUse?: string,
      opts?: { skipRestore?: boolean; templateOverride?: string }
    ) => {
      const key = issueKeyToUse || selectedIssue
      const tmpl = opts?.templateOverride || selectedTemplate
      const skipRestore = !!opts?.skipRestore
      if (!key) {
        showNotification("Please select a Backlog ticket first.", "error")
        return
      }
      const issue = issues.find((i) => i.issueKey === key)

      // Phase 22.21.79: まず document_drafts (一時保存) を確認。
      //   draft があれば form-context より優先して読み込む (= 直近の編集状態を復元)。
      //   無ければ従来通り backlog form-context へフォールバック。
      //   skipRestore=true (テンプレ切替=新しい文書) のときは draft も前回文書も
      //   引き継がず、フォームコンテキスト(自動補完)だけをロードする。
      let draft: any = null
      if (!skipRestore && tmpl) {
        try {
          const dRes = await fetch(
            `/api/document-drafts/${encodeURIComponent(key)}?template_type=${encodeURIComponent(
              tmpl
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
          `/api/backlog/issues/${key}/form-context?template=${tmpl}`
        )
        const context = await res.json()
        // Phase 22.11.2: 過去 doc のメタ情報を別 state に保存 (formData は汚さない)
        const prevDoc =
          context && context._previousDocument ? context._previousDocument : null
        if (prevDoc) {
          setPreviousDocument(prevDoc)
          // formData に流し込む前に削除 (context spread で残ると formData が膨らむ)
          delete context._previousDocument
        } else {
          setPreviousDocument(null)
        }
        // Phase 22.21.29: prev をマージせず、フォームを 完全に置換 する。
        //   そうしないと直前の課題で入力したフィールドがリーク。
        // Phase 22.21.79: draft があれば context をベースに draft で上書きする。
        //   draft は最新の編集状態 (= ユーザーが最後に入力した内容) なので、
        //   context の自動補完値で塗りつぶされないよう draft を後にスプレッドする。
        const base: Record<string, any> = {
          基本契約名: issue?.summary || "",
          remarks: issue?.description || "",
          ...context,
        }
        if (draft?.form_data && typeof draft.form_data === "object") {
          // 一時保存 (DB draft = 作業中の下書き) があれば復元する。
          //   これはユーザー自身が直前に編集していた内容なので安全。
          Object.assign(base, draft.form_data)
          // 初回保存で採番済みの番号を引き継ぐ(生成時に流用する)。
          if (draft.document_number) {
            base.__draft_doc_number = draft.document_number
          }
          const when = draft.updated_at
            ? new Date(draft.updated_at).toLocaleString("ja-JP")
            : ""
          showNotification(`📄 一時保存を復元しました (${when})`, "success")
        }
        // ※ 旧挙動: 一時保存が無ければ「前回発行文書」の form_data を自動で
        //   プリフィルしていたが、新しい文書を作るつもりでも過去内容が黙って
        //   入り込み危ういため撤去。代わりに previousDocument バナーの
        //   「前回内容を引き継ぐ」/「再編集モードで開く」ボタンで明示的に選ぶ。
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

  // ハブ(課題詳細)から ?template=<type>&prefill=1 で来たとき、着地時に
  //   form-context を自動プリフィルする(取引先・件名・条件明細)。skipRestore=true で
  //   下書きは引かない = クリーンな新規作成なので識別子の持ち越し無し(上書き事故なし)。
  //   発注書・検収書のみ自動(ユーザー合意)。他種別はテンプレ事前選択のみ。
  const HUB_PREFILL_TYPES = ["purchase_order", "inspection_certificate"]
  const didHubPrefillRef = React.useRef(false)
  React.useEffect(() => {
    if (didHubPrefillRef.current) return
    if (!initialPrefillRef.current) return
    const tmpl = initialTemplateParamRef.current || ""
    if (!HUB_PREFILL_TYPES.includes(tmpl)) return
    if (!selectedIssue) return
    didHubPrefillRef.current = true
    void syncFromDatabase(selectedIssue, {
      templateOverride: tmpl,
      skipRestore: true,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIssue, syncFromDatabase])

  const handleIssueSelect = async (issueKey: string) => {
    setSelectedIssue(issueKey)
    // Phase 22.21.29: 課題切替時に「閲覧モード」をオン。編集はユーザーが
    //   [編集] ボタンを押した時のみ可能になる (誤編集防止)。
    setIsReadOnly(true)
    // issueSummary は selectedIssue から useMemo で導出されるためセット不要。
    await syncFromDatabase(issueKey)
    fetch(`/api/backlog/issues/${issueKey}/history`)
      .then((r) => r.json())
      .then((d) => setCaseHistory(d))
      .catch((e) => console.error("History fetch error:", e))
  }

  // 文書テンプレートを切り替えたとき。課題が選択済みなら、その課題 × 新テンプレの
  //   「一時保存(下書き) → 前回発行文書」を自動で復元する(= 課題選択での自動
  //   プリフィル。課題→テンプレの順でも前回内容が戻るようにする)。
  //   syncFromDatabase はフォームを完全置換するため、前テンプレの入力が残る心配はない。
  //   課題未選択なら空に。
  //   ※ 文書の再編集ロード時の setSelectedTemplate(210) はこの関数を通さないので
  //     読み込んだ内容は消えない。
  const handleTemplateChange = (next: string) => {
    setSelectedTemplate(next)
    if (next && selectedIssue) {
      void syncFromDatabase(selectedIssue, {
        templateOverride: next,
      })
    } else {
      setFormData({})
      setPreviousDocument(null)
    }
  }

  // 「条件明細を読み込む」: この課題の発注書(capability_line_items)を items[] として
  //   取り込む。Backlog Sync(全置換)と違い「明細だけ」を入れる非破壊操作なので、
  //   発注書の作り直しでも保存済み明細を一から打ち直さずに済む。
  //   取得元は form-context の items[] (= capability_line_items を整形済み)。
  const loadConditionLineItems = React.useCallback(async () => {
    if (!selectedIssue) {
      showNotification("先に Backlog 課題を選択してください。", "error")
      return
    }
    const cur = (formData as any)?.items
    const hasItems = Array.isArray(cur) && cur.length > 0
    if (
      hasItems &&
      !window.confirm("現在の明細を、この課題の保存済み条件明細で置き換えます。よろしいですか?")
    ) {
      return
    }
    try {
      const res = await fetch(
        `/api/backlog/issues/${encodeURIComponent(selectedIssue)}/form-context?template=purchase_order`
      )
      const ctx = await res.json().catch(() => ({}))
      const items = Array.isArray(ctx?.items) ? ctx.items : []
      if (items.length === 0) {
        showNotification("この課題に保存済みの条件明細が見つかりませんでした。", "error")
        return
      }
      setFormData((prev: any) => ({
        ...(prev || {}),
        items,
        ...(ctx?.taxRate != null ? { taxRate: ctx.taxRate } : {}),
        ...(ctx?.grandTotalExTax != null ? { grandTotalExTax: ctx.grandTotalExTax } : {}),
      }))
      showNotification(`📋 条件明細を ${items.length} 行読み込みました。`, "success")
    } catch (e: any) {
      showNotification(`条件明細の読み込みに失敗しました: ${e?.message || e}`, "error")
    }
  }, [selectedIssue, formData, setFormData, showNotification])

  // 「ラインIDで読み込む」: 条件明細コード(line_code)/明細行ID/capability ID のいずれかを
  //   指定して、その明細セット(capability_line_items)を items[] として取り込む。
  //   課題キー×種別で引けない場合(record_type 化け・複数PO)でもピンポイントで呼べる。
  const loadLineItemsById = React.useCallback(async () => {
    const key = window.prompt(
      "条件明細のラインID を入力してください\n(条件明細コード line_code / 明細行ID / capability ID のいずれか)"
    )
    if (!key || !key.trim()) return
    const cur = (formData as any)?.items
    const hasItems = Array.isArray(cur) && cur.length > 0
    if (
      hasItems &&
      !window.confirm("現在の明細を、指定したラインIDの明細で置き換えます。よろしいですか?")
    ) {
      return
    }
    try {
      const res = await fetch(`/api/line-items/lookup?key=${encodeURIComponent(key.trim())}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      const items = Array.isArray(data?.items) ? data.items : []
      if (items.length === 0) {
        showNotification("指定したラインIDに明細がありませんでした。", "error")
        return
      }
      setFormData((prev: any) => ({
        ...(prev || {}),
        items,
        ...(data?.taxRate != null ? { taxRate: data.taxRate } : {}),
        ...(data?.grandTotalExTax != null ? { grandTotalExTax: data.grandTotalExTax } : {}),
      }))
      showNotification(
        `📋 ラインID ${data.line_code || key.trim()} の明細を ${items.length} 行読み込みました。`,
        "success"
      )
    } catch (e: any) {
      showNotification(`ラインIDでの明細読み込みに失敗しました: ${e?.message || e}`, "error")
    }
  }, [formData, setFormData, showNotification])

  // 法務アセットを「ラインID」で検索: lineID → /api/line-items/lookup で capability を
  //   解決し、契約マスタ(allContracts)から該当契約(=法務アセット)を引き当てる。
  const searchAssetByLineId = async () => {
    const key = lineIdQuery.trim()
    if (!key) return
    setLineIdLoading(true)
    setLineIdHit(null)
    try {
      const res = await fetch(`/api/line-items/lookup?key=${encodeURIComponent(key)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        showNotification(data?.error || `HTTP ${res.status}`, "error")
        return
      }
      const capId = Number(data.capability_id)
      const contract =
        (allContracts as any[] | undefined)?.find((c: any) => Number(c.id) === capId) || null
      setLineIdHit({
        capId,
        line_code: data.line_code || key,
        count: data.count ?? (Array.isArray(data.items) ? data.items.length : 0),
        contract,
      })
    } catch (e: any) {
      showNotification(`ラインID検索に失敗しました: ${e?.message || e}`, "error")
    } finally {
      setLineIdLoading(false)
    }
  }

  // 解決した法務アセット(契約)を反映する。callback ありはそれを優先、無ければ
  //   契約番号/名称を formData に流し込む(汎用リンク)。
  const applyAssetByLineId = () => {
    const c = lineIdHit?.contract
    if (!c) {
      showNotification("ラインIDに対応する契約(法務アセット)が契約マスタに見つかりませんでした。", "error")
      return
    }
    if (assetPickerCallback) {
      assetPickerCallback({
        id: Number(c.id),
        asset_number: c.document_number || "",
        asset_name: c.contract_title || "",
        counterparty: c.vendor_name || "",
        asset_type: "contract",
      } as any)
      setAssetPickerCallback(null)
    } else {
      setFormData((prev: any) => ({
        ...prev,
        ["契約書番号"]: c.document_number || prev["契約書番号"] || "",
        ["基本契約名"]: c.contract_title || prev["基本契約名"] || "",
        linked_contract_number: c.document_number || prev.linked_contract_number || "",
      }))
    }
    showNotification(
      `法務アセット ${c.document_number || c.contract_title || lineIdHit.line_code} を反映しました。`,
      "success"
    )
    setLineIdQuery("")
    setLineIdHit(null)
    setIsAssetPickerOpen(false)
  }

  // Backlog Sync は formData を全置換するため、入力済みなら確認してから実行。
  //   (入力途中に押して打った内容が消える事故を防ぐ。)
  const handleManualSync = React.useCallback(() => {
    const hasContent = Object.keys(formData || {}).some(
      (k) =>
        !k.startsWith("__") &&
        (formData as any)[k] != null &&
        (formData as any)[k] !== ""
    )
    if (
      hasContent &&
      !window.confirm("現在の入力内容を破棄して、DB(課題/下書き)の内容で置き換えます。よろしいですか?")
    ) {
      return
    }
    void syncFromDatabase()
  }, [formData, syncFromDatabase])

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

  // ドラフト復元は syncFromDatabase() に一本化する。
  //   DB の document_drafts を (issue_key + template_type) で復元するので、
  //   テンプレ種別ごとに正しい内容が戻る。
  //   以前ここにあった localStorage 自動復元 effect は撤去した。理由:
  //     (1) handleIssueSelect → syncFromDatabase の setFormData をレースで
  //         上書きし、「編集済み文書が正しく呼び出せない」原因になっていた。
  //     (2) キーが draft_<issue> のみでテンプレ種別を含まず、別テンプレで
  //         入力したデータを誤って復元していた。
  //   localStorage は下の auto-save でバックアップ書き込みのみ行う。

  // Auto-save (localStorage バックアップ)。
  //   キーは issue + template で分離(別テンプレのデータ混入を防止)。
  //   制御フラグ (__*) のみの空フォームは保存しない (saveDraftToServer と同条件)。
  React.useEffect(() => {
    if (!selectedIssue || !selectedTemplate) return
    const hasContent = Object.keys(formData || {}).some(
      (k) => !k.startsWith("__") && (formData as any)[k] != null && (formData as any)[k] !== ""
    )
    if (!hasContent) return
    const to = setTimeout(() => {
      localStorage.setItem(
        `draft_${selectedIssue}__${selectedTemplate}`,
        JSON.stringify(formData)
      )
      setLastAutoSave(
        new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
      )
    }, 2000)
    return () => clearTimeout(to)
  }, [formData, selectedIssue, selectedTemplate])

  // Phase 23.2: プレビューを別タブで開く (Split preview は廃止)。
  //   - クリック時点の最新 formData で /api/documents/preview を呼ぶ
  //   - 取得 HTML を Blob URL にし、window.open で新規タブに表示
  //   - 古い Blob URL は 60 秒後に revoke (タブ表示中は十分残る)
  //   - ポップアップブロック対策: 失敗時は通知でユーザーに伝える
  const handlePreview = React.useCallback(async () => {
    setIsPreviewing(true)
    setPreviewError(null)
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
      if (!res.ok) {
        let errMsg = `HTTP ${res.status} ${res.statusText}`
        try {
          const errBody = await res.json()
          if (errBody?.error) errMsg += `: ${errBody.error}`
        } catch {
          try {
            const t = await res.text()
            if (t) errMsg += `: ${t.slice(0, 300)}`
          } catch {}
        }
        setPreviewError(errMsg)
        showNotification(`プレビュー生成失敗: ${errMsg}`, "error")
        console.error("Preview failed:", errMsg)
        return
      }
      const data = await res.json()
      if (!data?.html) {
        const msg = `Preview API returned no HTML${
          data?.error ? `: ${data.error}` : ""
        }`
        setPreviewError(msg)
        showNotification(msg, "error")
        return
      }
      const blob = new Blob([data.html], { type: "text/html;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const win = window.open(url, "_blank", "noopener,noreferrer")
      if (!win) {
        showNotification(
          "プレビューを別タブで開けませんでした (ポップアップブロックの可能性)。ブラウザ設定を確認してください。",
          "error"
        )
      }
      // Blob URL は数分後に revoke。新タブで開いた後の navigation でも
      // メモリリーク防止のため。
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) {
      const msg = e?.message || String(e)
      console.error("Preview failed:", e)
      setPreviewError(`Network or fetch error: ${msg}`)
      showNotification(`プレビュー失敗: ${msg}`, "error")
    } finally {
      setIsPreviewing(false)
    }
  }, [formData, selectedIssue, selectedTemplate, showNotification])

  // Phase 23.2: 旧 Live preview (formData 変更で自動再描画) は撤去。
  //   別タブで開く方式なのでクリック都度の発火だけ。

  // opts.dbOnly=true: 文書(PDF)を発行せず DB 登録のみ行う。
  //   マスター登録と同じ「登録だけ」を通常フォームから実行するモード。
  //   worker 側は skipPdf フラグで PDF 生成 / Drive アップロードをスキップし、
  //   documents / condition_lines 等への登録は通常発行と同一経路で行う。
  //   未発行分は PDF 未作成キューに載り、後から同じ番号で発行できる。
  const handleGenerate = async (opts?: { dbOnly?: boolean }) => {
    const dbOnly = opts?.dbOnly === true
    // DB登録のみ時の任意ファイルリンク。入れる場合は http(s) URL のみ許可。
    const fileLink = dbOnly ? dbOnlyFileLink.trim() : ""
    if (fileLink && !/^https?:\/\//i.test(fileLink)) {
      showNotification(
        "ファイルリンクは http(s):// で始まる URL を入力してください。",
        "error"
      )
      return
    }
    // 請求の向きは必須。未選択なら送信を止める。
    if (!selectedDirection) {
      showNotification(
        "請求の向き(当社が払う / 当社が受け取る)を選択してください。台帳の方向(in/out)確定に必須です。",
        "error"
      )
      return
    }
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
    setGenerateMode(dbOnly ? "dbOnly" : "issue")
    try {
      // Phase 23.1: 再編集 (reopen) かつ saveMode='reissue' のときだけ reissue=true。
      //   その他 (新規発行 / 内部修正 / PDF 未作成キュー再生成) は reissue=false。
      const isReopen = !!formData?.__reopen_doc_number
      const reissueFlag = isReopen && saveMode === "reissue"
      // 請求の向き(in/out)を formData に載せて送る。worker は FLOW_DIRECTION を
      //   そのまま capability / 明細の flow_direction に反映する(out=請求台帳へ)。
      const formDataWithPurpose = {
        ...formData,
        FLOW_DIRECTION: selectedDirection,
      }
      const res = await fetch("/api/documents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueKey: selectedIssue || "MANUAL-" + Date.now(),
          templateType: selectedTemplate,
          formData: formDataWithPurpose,
          requesterEmail: selectedStaff?.email || "web-user",
          // Phase 15/16: 既存 doc の更新時は同じ document_number を渡す
          // (PDF 未作成キュー由来 or 再編集 reopen 由来の両方)。
          //   さらに「初回保存で採番済みの下書き番号」(__draft_doc_number) も
          //   流用する。documents 行が未作成なら初版として採用され、以降の再生成は
          //   同番号上書き(内部修正)になる(getDocumentNumberForGenerate)。
          existingDocumentNumber:
            formData?.__from_pending_doc_number ||
            formData?.__reopen_doc_number ||
            formData?.__draft_doc_number,
          reissue: reissueFlag,
          // DB登録のみ: PDF 生成 / Drive アップロードをスキップ
          skipPdf: dbOnly,
          // DB登録のみ時の任意ファイルリンク (既存の締結済み PDF 等の URL)
          fileLink: fileLink || undefined,
          // DB登録のみ時のレコード区分上書き (単独契約として登録)
          recordType:
            dbOnly && dbOnlyStandalone ? "standalone_contract" : undefined,
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

      if (dbOnly) {
        // DB登録のみ: PDF は作っていないのでサクセスモーダル (driveLink 前提)
        //   ではなく通知で完了を伝える。未発行分は PDF 未作成キューから
        //   同じ番号のまま後日発行できる。
        showNotification(
          `DB登録が完了しました (${data?.documentNumber || "番号未取得"})${
            dbOnlyStandalone ? "・区分: 単独契約" : ""
          }。文書は発行していません${
            fileLink
              ? " — 指定されたファイルリンクを登録しました"
              : data?.driveLink
                ? ""
                : " — 後から「PDF未作成」キューで発行できます"
          }。`,
          "success"
        )
        setDbOnlyFileLink("")
        setDbOnlyStandalone(false)
      } else if (data?.driveLink) {
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

      // 個人情報取得同意書の同時作成(個人取引先・スイッチON時)。
      //   本文書の生成成功後に、同意書を 2 通目として生成し、取引先の同意フラグを ON にする。
      //   DB登録のみのときは文書を発行していないので同意書も作らない。
      if (!dbOnly && createConsent && consentInfo?.is_individual && activeVendor?.vendor_code) {
        try {
          const today = new Date().toISOString().slice(0, 10)
          const cRes = await fetch("/api/documents/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              issueKey: selectedIssue || "MANUAL-" + Date.now(),
              templateType: "notice_consent_personal_info_freelance",
              requesterEmail: selectedStaff?.email || "web-user",
              formData: {
                CONTRACT_NAME:
                  templateMetadata[selectedTemplate]?.label || selectedTemplate,
                CONTRACT_NO: data?.documentNumber || "",
                CONTRACT_DATE: today,
                CONSENT_DATE: today,
                COUNTERPARTY_NAME: activeVendor?.vendor_name || "",
                COMPANY_NAME: companyProfile?.name || "",
                COMPANY_ADDRESS: companyProfile?.address || "",
                COMPANY_REPRESENTATIVE: companyProfile?.representative || "",
              },
            }),
          })
          const cData = await cRes.json().catch(() => ({}))
          if (cRes.ok && cData?.documentNumber) {
            try {
              await fetch(
                `/api/master/vendors/${encodeURIComponent(activeVendor.vendor_code)}/pii-consent`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ obtained: true, date: today }),
                }
              )
            } catch (flagErr) {
              console.warn("[consent] flag update failed:", flagErr)
            }
            setConsentInfo((p) =>
              p ? { ...p, pii_consent_obtained: true, pii_consent_date: today } : p
            )
            setCreateConsent(false)
            showNotification(
              `個人情報取得同意書も作成しました (${cData.documentNumber})`,
              "success"
            )
          } else {
            showNotification(
              `同意書の作成に失敗しました: ${cData?.error || "HTTP " + cRes.status}`,
              "error"
            )
          }
        } catch (ce: any) {
          showNotification(`同意書の作成に失敗しました: ${ce?.message || ce}`, "error")
        }
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
      // フォーム統一: 生成/DB登録した文書は契約マスタ一覧 (contract_capabilities
      //   = documents ビュー) にも現れるため、マスタ側キャッシュも更新する。
      //   これが無いと /master/contracts に戻っても新規行が見えない。
      try {
        await refreshContracts?.()
      } catch (refErr) {
        console.warn("[generate] refreshContracts failed:", refErr)
      }
    } catch (e: any) {
      console.error("Generation failed", e)
      showNotification(
        `文書作成に失敗しました: ${e?.message || e}`,
        "error"
      )
    } finally {
      setIsGenerating(false)
      setGenerateMode(null)
    }
  }

  // Phase 9g: サクセスモーダル経由の「新しい文書を作成」 — フォームを
  // リセットして次の起票へ。
  //   セッション (useDocumentSession) はアプリ全体で永続するため、文書固有の
  //   状態を明示的に全てクリアしないと前文書の内容が次文書に引き継がれてしまう
  //   (特にテンプレ種別が残ると、課題選択時に前回文書が自動で引き込まれる)。
  //   担当者 (selectedStaff) は操作者として継続利用するため意図的に残す。
  const handleStartNew = () => {
    setFormData({})
    setDbOnlyFileLink("")
    setDbOnlyStandalone(false)
    setSelectedIssue("")
    setSelectedTemplate("")
    setSelectedDirection("")
    setActiveVendor(null)
    setPreviousDocument(null)
    // issueSummary は selectedIssue から導出されるため、上の setSelectedIssue("") で消える。
    setCompletionResult(null)
    setIsReadOnly(false)
    setSaveMode("internal")
    setCaseHistory([])
    showNotification("New document started.", "info")
  }

  // 明示的な「保存」ボタン。下書きをサーバ保存し、初回はここで採番する。
  //   暗黙保存(編集モード切替・自動保存)では採番しないため、番号は保存ボタンで確定。
  const handleExplicitSave = React.useCallback(async () => {
    if (!selectedIssue || !selectedTemplate) {
      showNotification("課題とテンプレートを選択してください。", "error")
      return
    }
    setIsSavingDraft(true)
    try {
      await saveDraftToServer(/* silent */ false, /* assignNumber */ true)
    } finally {
      setIsSavingDraft(false)
    }
  }, [selectedIssue, selectedTemplate, saveDraftToServer, showNotification])

  // 過去文書/下書きを番号で呼び出してフォームに読み込む。
  //   - draft : form_data + 採番済み番号(__draft_doc_number) を引き継いで編集を再開。
  //   - 確定文書: 再編集(reopen)として開く(生成時は同番号上書き=内部修正)。
  const handleRecallDocument = (doc: LookedUpDocument) => {
    setSelectedTemplate(doc.template_type)
    setSelectedIssue(doc.issue_key || "")
    const base: Record<string, any> = { ...(doc.form_data || {}) }
    if (doc.source === "draft") {
      if (doc.document_number) base.__draft_doc_number = doc.document_number
    } else {
      base.__reopen_id = doc.id
      base.__reopen_doc_number = doc.document_number
    }
    setFormData(base)
    // 前文書のセッション状態が居座らないようリセット(読み込んだ doc から再解決)。
    setActiveVendor(null)
    setSelectedStaff(null)
    setSelectedDirection("")
    setPreviousDocument(null)
    setIsReadOnly(false)
    setRecallOpen(false)
    showNotification(
      `${doc.document_number || doc.issue_key || "文書"} を呼び出しました`,
      "info"
    )
  }

  const handleDeleteDraft = async (doc: LookedUpDocument) => {
    if (!doc.issue_key || !doc.template_type) return
    const label = doc.document_number || doc.issue_key
    if (!window.confirm(`下書き「${label}」を削除しますか？ (元に戻せません)`)) return
    try {
      const res = await fetch(
        `/api/document-drafts/${encodeURIComponent(
          doc.issue_key
        )}?template_type=${encodeURIComponent(doc.template_type)}`,
        { method: "DELETE" }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      showNotification(`下書き「${label}」を削除しました`, "success")
      // 一覧を更新するため Sheet を一旦閉じる(再オープンで再検索される)。
      setRecallOpen(false)
    } catch (e: any) {
      showNotification(`下書き削除に失敗: ${e?.message || e}`, "error")
    }
  }

  const handleExportExcel = async () => {
    setIsGenerating(true)
    try {
      // Phase 27.x: 旧実装はフロントで空の旧フラット項目(支払内容（i）等)を読んで
      //   いたため、明細(delivery_line_items)ベースの新フォームでは値が空になっていた。
      //   バッチ出力と同じ buildFromFormData に寄せるため、生 formData をそのまま送る。
      const res = await fetch("/api/documents/export-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formData, templateType: selectedTemplate }),
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
        {/* ─── Phase 23.2: 上部 Setup Bar (4 スロット) ───────────────
            動線を「左→右上→右下」から「上→下」に直すため、入力前の
            必須選択 (課題 / テンプレ / 担当者 / 取引先) を画面上部に
            水平 4 列で配置する。lg 未満は 2 列、sm 未満は 1 列に折る。 */}
        <div className="col-span-12">
          <Card className="rounded-md">
            <CardContent className="px-4 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* ① Backlog 課題 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5 text-[11px]">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-foreground text-background text-[9px] font-bold">
                        ①
                      </span>
                      Backlog 課題 ({issues.length})
                    </Label>
                    <button
                      type="button"
                      onClick={handleRefreshIssues}
                      disabled={issuesRefreshing}
                      className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
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
                  <NativeSelect
                    value={selectedIssue}
                    onChange={(e) => handleIssueSelect(e.target.value)}
                  >
                    <option value="">— 課題を選択 —</option>
                    {issues.map((i, idx) => (
                      <option key={`issue-${i.issueKey || idx}-${idx}`} value={i.issueKey}>
                        [{i.issueKey}] {i.summary}
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                {/* ② テンプレート */}
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-[11px]">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-foreground text-background text-[9px] font-bold">
                      ②
                    </span>
                    文書テンプレート
                  </Label>
                  <Input
                    type="text"
                    placeholder="テンプレ検索…"
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    className="h-8 text-xs"
                  />
                  <NativeSelect
                    value={selectedTemplate}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                  >
                    <option value="">— テンプレを選択 —</option>
                    {templateCategories.map((cat) => (
                      <optgroup key={cat || "uncategorized"} label={cat}>
                        {filteredTemplates
                          .filter(
                            (t) => (templateMetadata[t]?.category || "General") === cat
                          )
                          .map((t) => (
                            <option key={t} value={t}>
                              {templateMetadata[t]?.label || t.replace(/_/g, " ")}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </NativeSelect>
                </div>

                {/* ②' 請求の向き (必須) — 台帳の方向(in/out)を確定する。2択 */}
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-[11px]">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-foreground text-background text-[9px] font-bold">
                      ②′
                    </span>
                    請求の向き
                    <span className="text-destructive font-bold">*</span>
                  </Label>
                  <NativeSelect
                    value={selectedDirection}
                    onChange={(e) =>
                      setSelectedDirection(e.target.value as "" | "in" | "out")
                    }
                  >
                    <option value="">— 請求の向きを選択 (必須) —</option>
                    <option value="in">当社が払う（支払・仕入・ライセンスイン）</option>
                    <option value="out">当社が受け取る（請求・販売・ライセンスアウト）</option>
                  </NativeSelect>
                  {!selectedDirection && (
                    <p className="text-[10px] font-mono text-destructive/80">
                      ※ 請求の向きは必須。「当社が受け取る」は請求台帳へ自動取込されます。
                    </p>
                  )}
                </div>

                {/* ③ 担当者 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5 text-[11px]">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-foreground text-background text-[9px] font-bold">
                        ③
                      </span>
                      <Briefcase className="h-3 w-3" />
                      担当者
                    </Label>
                    {selectedStaff && (
                      <Badge variant="outline">{selectedStaff.staff_name}</Badge>
                    )}
                  </div>
                  <Input
                    type="text"
                    placeholder="担当者検索…"
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
                    <option value="">— 担当者 DB —</option>
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
                </div>

                {/* ④ 取引先 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5 text-[11px]">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-foreground text-background text-[9px] font-bold">
                        ④
                      </span>
                      <Building2 className="h-3 w-3" />
                      取引先
                    </Label>
                    {activeVendor && (
                      <Badge variant="outline">{activeVendor.vendor_code}</Badge>
                    )}
                  </div>
                  <Input
                    type="text"
                    placeholder="取引先検索…"
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
                    <option value="">— 取引先 DB —</option>
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
                  {/* 個人取引先のみ: 宛名に筆名/屋号を併記するオプション。
                      OFF=正式名称のみ / ON=「ペンネーム/屋号 こと 正式名称」。 */}
                  {activeVendor &&
                    String(activeVendor.entity_type || "").toLowerCase() !== "corporate" &&
                    activeVendor.entity_type !== "法人" && (
                      <label className="flex items-start gap-1.5 text-[10px] text-muted-foreground cursor-pointer pt-0.5">
                        <input
                          type="checkbox"
                          className="h-3 w-3 mt-0.5"
                          checked={combineVendorAlias}
                          onChange={(e) => setCombineVendorAlias(e.target.checked)}
                        />
                        <span>筆名/屋号を併記（ペンネーム こと 正式名称）</span>
                      </label>
                    )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── Stage ─────────────────────────────────────────── */}
        <section className="col-span-12 lg:col-span-9 space-y-4">
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
              <div className="flex flex-wrap items-center justify-end gap-2">
                {/* ステータス(採番バッジ + 自動保存)は1つのまとまりとして扱う。 */}
                <div className="flex items-center gap-2">
                {/* Phase 23 UX-A: 採番ステータスバッジ
                    formData.documentNumber が存在 → 採番済 (緑)
                    formData.__reopen_id がある → 既存編集 (青)
                    それ以外 → 未採番 Draft (アンバー)
                */}
                {(() => {
                  const docNum = formData.documentNumber as string | undefined;
                  const reopenId = formData.__reopen_id as number | undefined;
                  const draftNo = formData.__draft_doc_number as string | undefined;
                  if (!docNum && !reopenId && draftNo) {
                    // 初回保存で採番済みの下書き。生成時にこの番号を流用する。
                    return (
                      <span
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-mono font-bold text-emerald-800"
                        title={`採番済(下書き): ${draftNo} — 生成時にこの番号で確定します`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        採番済 · {draftNo}
                      </span>
                    );
                  }
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
                      title="未採番 Draft — 「保存」ボタンまたは生成時に採番されます"
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
                </div>
                {/* 明示的な「保存」: 下書きをサーバ保存し、初回はここで採番する。 */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExplicitSave}
                  disabled={isSavingDraft || !selectedIssue || !selectedTemplate}
                  title="下書きを保存します。初めての保存時にこのタイミングで採番されます。"
                >
                  {isSavingDraft ? <Loader2 className="animate-spin" /> : <History />}
                  保存
                </Button>
                {/* 過去文書/下書きを番号で呼び出す。 */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRecallOpen(true)}
                  title="文書番号・タイトルで過去文書/下書きを検索して呼び出します"
                >
                  <Search />
                  番号で呼び出す
                </Button>
                {/* Phase 23.2: Split preview 廃止 → 別タブで開く方式に。 */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePreview}
                  disabled={isPreviewing}
                  title="プレビューを別タブで開きます"
                >
                  {isPreviewing ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Eye />
                  )}
                  プレビュー
                </Button>
                {selectedTemplate === "purchase_order" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadConditionLineItems}
                    title="この課題に保存済みの条件明細(品目・数量・金額)を明細欄に読み込みます。明細だけを入れるので他の入力は消えません。"
                  >
                    <ClipboardList />
                    条件明細
                  </Button>
                )}
                {selectedTemplate === "purchase_order" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadLineItemsById}
                    title="条件明細コード(line_code)や明細行ID/capability ID を指定して明細を読み込みます。課題×種別で引けないときに使えます。"
                  >
                    <Hash />
                    ラインID
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManualSync}
                  title="Backlog 課題 / 過去の draft から件名・取引先・明細などを取得して入力欄に反映します(現在の入力は置き換わります)"
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

            {/* Body — Phase 23.2: Split preview 廃止により常に縦並び */}
            <div className="flex flex-col overflow-hidden">
              <div
                className={`flex-1 overflow-y-auto custom-scrollbar p-6`}
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
                    {/* 選択中 Backlog 課題の本文 (description) を参照表示。
                        起票時に Backlog 側へ書かれた「依頼タイプ / 相手方情報 /
                        詳細」等をフォーム入力の参考として常に見られるようにする。
                        折りたたみ可 (details)。読み取り専用なので isReadOnly の
                        pointer-events 無効化ラッパーの外に置く (常に開閉できる)。 */}
                    {issueSummary?.description && (
                      <details
                        open
                        className="rounded-sm border border-border bg-muted/20"
                      >
                        <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-mono font-bold uppercase tracking-wider flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 shrink-0" />
                          Backlog 課題内容
                          <span className="text-muted-foreground font-normal normal-case truncate">
                            [{issueSummary.issueKey}] {issueSummary.summary}
                          </span>
                        </summary>
                        <div className="border-t border-border px-3 py-2.5 max-h-72 overflow-y-auto custom-scrollbar">
                          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/90">
                            {issueSummary.description}
                          </pre>
                        </div>
                      </details>
                    )}

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
                        combineVendorAlias={combineVendorAlias}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Phase 23.2: Split preview ペインは廃止 (別タブで開く方式に統一)。 */}
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
                {/* Phase 23.2: Footer のプレビューも別タブで開く */}
                <Button
                  variant="outline"
                  onClick={handlePreview}
                  disabled={isPreviewing}
                  title="プレビューを別タブで開きます"
                >
                  {isPreviewing ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Eye />
                  )}
                  プレビュー (別タブ)
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
                {consentInfo?.is_individual && (
                  <label
                    className="flex items-center gap-1.5 cursor-pointer text-[12px] mr-2"
                    title={
                      consentInfo.pii_consent_obtained
                        ? `この個人取引先は同意取得済${consentInfo.pii_consent_date ? ` (${consentInfo.pii_consent_date})` : ""}`
                        : "個人情報取得同意書を本文書と同時に作成します"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={createConsent}
                      onChange={(e) => setCreateConsent(e.target.checked)}
                      className="cursor-pointer"
                    />
                    <span>
                      個人情報取得同意書も作成
                      {consentInfo.pii_consent_obtained && (
                        <span className="text-emerald-600 ml-1">(同意取得済)</span>
                      )}
                    </span>
                  </label>
                )}
                {/* DB登録のみ: 文書(PDF)を発行せず documents/条件明細へ登録する。
                    マスター登録と同じ「登録だけ」を通常フォームから行うモード。
                    未発行分は PDF 未作成キューに載り、後から同じ番号で発行できる。
                    ファイルリンク: 既存の締結済み PDF 等の URL を任意で添付。
                    指定すると drive_link として保存され一覧から開ける。 */}
                <label
                  className="flex items-center gap-1.5 cursor-pointer text-[12px] whitespace-nowrap"
                  title="単独契約 (親の基本契約を持たない契約) 専用テンプレは無いため、発注書 / 個別利用許諾条件書などのフォームで代用登録するときに ON にすると、レコード区分が「単独契約」で保存されます (DB登録のみ時のみ有効)。"
                >
                  <input
                    type="checkbox"
                    checked={dbOnlyStandalone}
                    onChange={(e) => setDbOnlyStandalone(e.target.checked)}
                    className="cursor-pointer"
                  />
                  <span>単独契約として登録</span>
                </label>
                <Input
                  value={dbOnlyFileLink}
                  onChange={(e) => setDbOnlyFileLink(e.target.value)}
                  placeholder="ファイルリンク (DB登録のみ・任意)"
                  title="DB登録のみで保存するとき、既存の締結済みPDF等のURLを文書リンクとして登録できます (http(s)://…)。空欄ならPDF未作成キューに入ります。"
                  className="w-56 font-mono text-[11px]"
                />
                <Button
                  variant="outline"
                  onClick={() => handleGenerate({ dbOnly: true })}
                  disabled={isGenerating || !selectedDirection}
                  title={
                    !selectedDirection
                      ? "請求の向きを選択すると登録できます"
                      : "文書(PDF)を発行せずにDBへ登録のみ行います。後から「PDF未作成」キューで同じ番号のまま発行できます。"
                  }
                >
                  {isGenerating && generateMode === "dbOnly" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Database />
                  )}
                  DB登録のみ
                </Button>
                <Button
                  onClick={() => handleGenerate()}
                  disabled={isGenerating || !selectedDirection}
                  title={
                    !selectedDirection
                      ? "請求の向きを選択すると生成できます"
                      : undefined
                  }
                >
                  {isGenerating && generateMode !== "dbOnly" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  Finalize & Sync
                </Button>
              </div>
              {!selectedDirection && !isGenerating && (
                <p className="mt-2 text-[11px] font-mono text-destructive/80">
                  ※「請求の向き（②′・上部）」が未選択のため「Finalize &amp; Sync」は無効です。請求の向きを選択すると有効になります。
                </p>
              )}
            </div>
          </Card>
        </section>

        {/* ─── Phase 23.2: 右側 Side panel ─────────────────────
            Legal Assets Search ボタン + Case history (案件履歴) を
            縦並びで表示。Editor 本体とは独立した補助 panel。
            狭幅では Editor の下に回り込む (lg 未満で col-span-12)。 */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          <Card>
            <CardContent className="px-4 py-3 space-y-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground">
                ▍ 参照
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  // Phase 22.21.93: サイドバーから開くときは callback を
                  // 必ずクリアして、template-aware モード (Mode 1/2 = Master+Archive
                  // 横断検索) に確実に入るようにする。
                  // Phase 22.21.123: 別タブで契約を登録した後でも反映されるよう
                  // 開く度に refreshContracts() で master データを最新化。
                  setAssetPickerCallback(null)
                  setIsAssetPickerOpen(true)
                  refreshContracts?.()
                }}
              >
                <ScanSearch />
                法務アセットを検索
              </Button>
            </CardContent>
          </Card>

          {selectedIssue && caseHistory.length > 0 && (
            <Card>
              <CardContent className="px-4 py-3 space-y-2.5">
                <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-1.5">
                  <History className="h-3 w-3" /> 案件履歴
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
              </CardContent>
            </Card>
          )}
        </aside>
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

            {/* ── ラインIDで法務アセットを検索(全モード共通) ── */}
            <div className="space-y-2 pb-3 border-b border-border">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                ラインIDで検索
              </p>
              <div className="flex gap-2">
                <Input
                  value={lineIdQuery}
                  onChange={(e) => setLineIdQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      void searchAssetByLineId()
                    }
                  }}
                  placeholder="条件明細コード(line_code) / 明細行ID / capability ID"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void searchAssetByLineId()}
                  disabled={lineIdLoading}
                >
                  {lineIdLoading ? <Loader2 className="animate-spin" /> : <ScanSearch />}
                  検索
                </Button>
              </div>
              {lineIdHit && (
                <div className="rounded-md border border-border p-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    {lineIdHit.contract ? (
                      <>
                        <p className="text-xs font-mono font-bold truncate">
                          {lineIdHit.contract.document_number || "(番号なし)"} ·{" "}
                          {lineIdHit.contract.contract_title || "—"}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground truncate">
                          {lineIdHit.contract.vendor_name || "—"} · ラインID {lineIdHit.line_code} · 明細
                          {lineIdHit.count}行
                        </p>
                      </>
                    ) : (
                      <p className="text-[11px] font-mono text-amber-600">
                        capability #{lineIdHit.capId} は契約マスタに未登録（明細{lineIdHit.count}行）。法務アセットとして反映できません。
                      </p>
                    )}
                  </div>
                  {lineIdHit.contract && (
                    <Button size="xs" variant="outline" onClick={applyAssetByLineId}>
                      選択
                    </Button>
                  )}
                </div>
              )}
            </div>

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

      {/* 過去文書/下書きを番号で呼び出すフォーム。確定文書(Archive)と
          作成途中の下書き(Draft・初回保存で採番済)を横断検索して、選択で
          フォームに読み込む。下書きは削除も可能。 */}
      <Sheet open={recallOpen} onOpenChange={setRecallOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>過去文書・下書きを番号で呼び出す</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <p className="text-[11px] font-mono text-muted-foreground mb-3 leading-relaxed">
              文書番号・タイトル・取引先名で検索できます。選ぶとフォームに読み込みます。
              <br />
              <span className="text-amber-700">Draft</span> は作成途中の下書き（初回保存で採番済）、
              <span className="text-muted-foreground"> Archive</span> は確定済み文書です。
            </p>
            <DocumentNumberLookup
              label="番号・タイトル・取引先で検索 (空欄で最新一覧)"
              includeDrafts
              limit={30}
              onApply={handleRecallDocument}
              onDeleteDraft={handleDeleteDraft}
            />
          </SheetBody>
        </SheetContent>
      </Sheet>

      {completionResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setCompletionResult(null)}
        >
          <div
            className="lb-overlay bg-card border border-border rounded-sm shadow-2xl max-w-lg w-full mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
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
