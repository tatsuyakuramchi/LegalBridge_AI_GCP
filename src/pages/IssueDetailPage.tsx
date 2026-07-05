import * as React from "react"
import { useParams, useNavigate, useSearchParams } from "react-router-dom"
import {
  ArrowLeft,
  Check,
  ExternalLink,
  FileText,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  Send,
  User,
  Calendar,
  ListChecks,
  GitMerge,
  ShoppingCart,
} from "lucide-react"

import { cn } from "@/lib/utils"

import { useAppData, useDocumentSession } from "@/src/context/AppDataContext"
import {
  extractRequesterSlackId,
  findStaffBySlackId,
  formatStaffLabel,
  resolveSlackMentions,
} from "@/src/lib/slackRequester"
import { useMergeCart } from "@/src/context/MergeCartContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { StaffPicker } from "@/src/components/cloudsign/StaffPicker"
import { VendorSearchSelect } from "@/src/components/document/VendorSearchSelect"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"
import { WorkflowPanel } from "@/src/components/workflow/WorkflowPanel"

// データ構造刷新 Phase A: 課題詳細ページ。
//   課題 1 件に紐づく「文書一覧」のみを扱う (進捗・消化状況は条件明細単位の
//   別 UI = Phase F に委ねる)。URL ルート化することで Backlog コメントに貼れる。

// A-1 の API が返す 1 行の形。
type IssueDocument = {
  id: number
  document_number: string | null
  template_type: string
  created_at: string
  created_by: string | null
  drive_link: string | null
  lifecycle_status?: string
  is_primary?: boolean
  base_document_number?: string | null
  revision?: number
  line_code?: string | null // Phase F: 対応する条件明細
}

type IssueConditionLine = {
  id: number
  line_code: string | null
  subject: string | null
  payment_scheme: string | null
  amount_ex_tax: number | string | null
  currency: string | null
  delivery_date: string | null
  term_start: string | null
  term_end: string | null
  status: string | null
  consumed_amount: number | string | null
  remaining_amount: number | string | null
  event_count: number | null
  total_event_count: number | null
  issue_event_count: number | null
  contract_number: string | null
  contracting_issue_key: string | null
  relations: string[] | null
  issue_phase: "contracting" | "payment" | "mixed" | "unknown" | null
  related_issue_keys: string[] | null
  next_template_type: string | null
  recent_events?: any[]
}

type IssueConditionLineSummary = {
  ok: boolean
  summary: {
    total: number
    open: number
    completed: number
    next_actions?: number
  }
  lines: IssueConditionLine[]
}

// lifecycle_status → バッジ表示。final=緑 / reissued=グレー / archived_draft=打ち消し。
function LifecycleBadge({ status }: { status?: string }) {
  const s = status || "final"
  if (s === "final") {
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
        final
      </Badge>
    )
  }
  if (s === "archived_draft" || s === "voided") {
    return (
      <Badge variant="outline" className="text-muted-foreground line-through">
        {s}
      </Badge>
    )
  }
  // reissued / superseded / その他
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {s}
    </Badge>
  )
}

// VendorsPanel の SectionHead を踏襲 (Dialog ではなくページ用)。
function SectionHead({ label }: { label: string }) {
  return (
    <div className="mt-1 pt-2 border-t border-border">
      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-foreground/70">
        {label}
      </span>
    </div>
  )
}

export function IssueDetailPage() {
  const { issueKey = "" } = useParams()
  const navigate = useNavigate()
  const { issues, templateMetadata, templateList, staffList, vendors, showNotification } = useAppData()
  const { setSelectedIssue, setFormData } = useDocumentSession()

  const issue = React.useMemo(
    () => issues.find((i) => i.issueKey === issueKey),
    [issues, issueKey]
  )

  // 課題統合(重複/誤起票の整理)。籠に集めて統合先を選ぶ方式(MergeCartPanel)。
  const mergeCart = useMergeCart()

  // この課題が属する新課題(統一課題=契約)。U3: 個別課題から統一課題への導線。
  const [unifiedLinks, setUnifiedLinks] = React.useState<
    Array<{ capability_id: number; document_number: string | null; contract_title: string | null; vendor_name: string | null; record_type: string | null }>
  >([])

  const [docs, setDocs] = React.useState<IssueDocument[]>([])
  const [lineSummary, setLineSummary] = React.useState<IssueConditionLineSummary | null>(null)
  const [lineSummaryError, setLineSummaryError] = React.useState<string | null>(null)
  // 個別送信: 送信方法の選択(クラウドサイン/メール) → 各フォーム。
  const [chooserDoc, setChooserDoc] = React.useState<IssueDocument | null>(null)
  // メール送信ダイアログ
  const [emailDoc, setEmailDoc] = React.useState<IssueDocument | null>(null)
  const [emailTo, setEmailTo] = React.useState("")
  const [emailCc, setEmailCc] = React.useState("")
  const [emailVendorCode, setEmailVendorCode] = React.useState("")
  const [emailContactIdx, setEmailContactIdx] = React.useState(0)
  const [emailContacts, setEmailContacts] = React.useState<any[]>([])
  const [emailSending, setEmailSending] = React.useState(false)
  const openEmail = (d: IssueDocument) => {
    setEmailDoc(d)
    setEmailTo("")
    setEmailCc("")
    setEmailVendorCode("")
    setEmailContactIdx(0)
    setEmailContacts([])
  }
  // 取引先の連絡先配列(主担当を先頭にしたい場合の補助)。
  const primaryContactIdx = (contacts: any[]) => {
    const i = (contacts || []).findIndex((c) => c && c.is_primary)
    return i >= 0 ? i : 0
  }
  // 一覧の取引先に連絡先メールが無いことがあるため、詳細を取得して連絡先を補う。
  const loadVendorContacts = async (v: any): Promise<any[]> => {
    let contacts = Array.isArray(v?.contacts) ? v.contacts : []
    if (!contacts.length || !contacts.some((c: any) => c && c.email)) {
      try {
        const res = await fetch(`/api/master/vendors/${encodeURIComponent(v.vendor_code)}`)
        if (res.ok) {
          const d = await res.json()
          const detail = d?.data ?? d
          if (Array.isArray(detail?.contacts)) contacts = detail.contacts
          if (!v.email && detail?.email) v.email = detail.email
        }
      } catch {
        /* 詳細取得失敗は無視(一覧の値で続行) */
      }
    }
    return contacts
  }
  const sendEmailNow = async () => {
    if (!emailDoc?.document_number) return
    setEmailSending(true)
    try {
      const body: any = {}
      const to = emailTo.split(",").map((s) => s.trim()).filter(Boolean)
      const cc = emailCc.split(",").map((s) => s.trim()).filter(Boolean)
      if (to.length) body.to = to
      if (cc.length) body.cc = cc
      const res = await fetch(
        `/api/documents/${encodeURIComponent(emailDoc.document_number)}/email/send`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      showNotification(
        `メール送信しました: ${(data.to || []).join(", ")}` +
          (data.cc && data.cc.length ? ` / CC: ${data.cc.join(", ")}` : "") +
          (data.attached ? "（PDF添付）" : "（本文リンクのみ）"),
        "success"
      )
      setEmailDoc(null)
    } catch (e: any) {
      showNotification(`メール送信に失敗: ${e?.message || e}`, "error")
    } finally {
      setEmailSending(false)
    }
  }
  // クラウドサイン: 単一文書を選択状態にして既存のまとめ送信モーダルを開く。
  const openCloudSignFor = (d: IssueDocument) => {
    if (!d.document_number) return
    setSelDocs(new Set([d.document_number]))
    openBundle()
  }
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // 案件詳細などからのディープリンク(?cloudsign=文書番号): 文書一覧の読込後に
  // 対象文書を選択してクラウドサイン送信フォームを自動で開く(初回のみ)。
  const [searchParams, setSearchParams] = useSearchParams()
  const csDeepLinkDone = React.useRef(false)
  React.useEffect(() => {
    if (csDeepLinkDone.current || loading) return
    const dn = searchParams.get("cloudsign")
    if (!dn) return
    csDeepLinkDone.current = true
    setSearchParams((prev) => {
      prev.delete("cloudsign")
      return prev
    }, { replace: true })
    const d = docs.find((x) => x.document_number === dn)
    if (d && isDrivePdf(d.drive_link)) {
      openCloudSignFor(d)
    } else {
      showNotification?.(
        `クラウドサイン送信を開けません: ${dn}（Drive 上のPDFがある正本のみ送信できます）`,
        "error"
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, docs, searchParams])

  React.useEffect(() => {
    if (!issueKey) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setLineSummaryError(null)
    setLineSummary(null)
    ;(async () => {
      try {
        const [docsResult, summaryResult, unifiedResult] = await Promise.allSettled([
          fetch(`/api/issues/${encodeURIComponent(issueKey)}/documents`),
          fetch(`/api/issues/${encodeURIComponent(issueKey)}/condition-line-summary`),
          fetch(`/api/issues/${encodeURIComponent(issueKey)}/unified`),
        ])
        if (unifiedResult.status === "fulfilled" && unifiedResult.value.ok) {
          const ud = await unifiedResult.value.json().catch(() => null)
          if (!cancelled && ud?.ok) setUnifiedLinks(Array.isArray(ud.unified_issues) ? ud.unified_issues : [])
        }
        if (docsResult.status === "rejected") {
          throw docsResult.reason
        }
        if (!docsResult.value.ok) throw new Error(`HTTP ${docsResult.value.status}`)
        const data = await docsResult.value.json()
        if (!cancelled) setDocs(Array.isArray(data) ? data : [])

        if (summaryResult.status === "fulfilled" && summaryResult.value.ok) {
          const summaryData = await summaryResult.value.json()
          if (!cancelled) setLineSummary(summaryData)
        } else if (summaryResult.status === "fulfilled") {
          if (!cancelled) setLineSummaryError(`HTTP ${summaryResult.value.status}`)
        } else if (!cancelled) {
          setLineSummaryError(summaryResult.reason?.message || String(summaryResult.reason))
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [issueKey])

  // 「文書を作成」: 現在の課題をセッションにセットして作成フローへ。
  //   新規作成は必ずクリーンな状態で開始する。直前に作った文書の識別子
  //   (__draft_doc_number / __reopen_doc_number 等)が formData に残っていると、
  //   別種別の文書を上書きしてしまう(発注書→検収書の上書き事故)。ここで formData を
  //   初期化して持ち越しを断つ。
  //   種別を指定すると ?template=<type> でエディタが事前選択。発注書は
  //   &prefill=1 でエディタ着地時に条件明細・取引先を自動ロードする。
  const createDocument = (template?: string) => {
    setSelectedIssue(issueKey)
    setFormData({ サブライセンシー一覧: [] })
    const qs = template
      ? `?template=${encodeURIComponent(template)}&prefill=1`
      : ""
    navigate(`/documents/new${qs}`)
  }

  // 「再編集」: 既存の reopen ディープリンクを再利用 (DocumentEditorPage が
  //   ?reopen=<id> を解釈して form_data を読み込む)。
  const reopen = (docId: number) => {
    navigate(`/documents/new?reopen=${encodeURIComponent(String(docId))}`)
  }

  const templateLabel = (t: string) => templateMetadata?.[t]?.label || t

  // ── Backlog カスタムフィールドの表示用整形 ─────────────────────
  //   一覧 API (`/api/backlog/issues`) が返す issue.customFields から、
  //   起票時の主要属性 (取引先名称・依頼部署・締結方法・希望納期) を
  //   名称マッチで取り出す。フィールド名は環境により別名運用もあり得るため
  //   候補名を複数渡せるようにしておく。
  const formatCfValue = (v: any): string => {
    if (v == null || v === "") return ""
    if (Array.isArray(v)) return v.map(formatCfValue).filter(Boolean).join(", ")
    if (typeof v === "object") return String(v.name ?? v.value ?? "")
    return String(v)
  }
  const getCustomField = (...names: string[]): string => {
    const cfs = issue?.customFields
    if (!Array.isArray(cfs)) return ""
    const hit = cfs.find((cf) => names.includes(cf?.name))
    return hit ? formatCfValue(hit.value) : ""
  }
  // Slack 起案の課題本文に埋まる「依頼者: <@U…>」をスタッフマスタで
  // 名前・メールアドレスに解決する (未登録 ID はそのまま表示)。
  const requesterSlackId = extractRequesterSlackId(issue?.description)
  const requesterLabel = requesterSlackId
    ? formatStaffLabel(findStaffBySlackId(staffList, requesterSlackId), requesterSlackId)
    : ""
  const resolvedDescription = React.useMemo(
    () => resolveSlackMentions(issue?.description, staffList),
    [issue?.description, staffList]
  )

  // ラベルと Backlog 上のフィールド名候補の対応。
  const overviewFields = [
    { label: "依頼者", value: requesterLabel },
    { label: "取引先名称", value: getCustomField("取引先名称", "取引先") },
    { label: "依頼部署", value: getCustomField("依頼部署", "部署") },
    { label: "締結方法", value: getCustomField("締結方法") },
    { label: "希望納期", value: getCustomField("希望納期", "納期") },
  ].filter((f) => f.value)

  // ハブの「文書を作成」: 主要種別はボタン、残りは「その他」プルダウンで。
  //   存在するテンプレだけ出す(templateList で実在チェック)。
  const PRIMARY_TYPES = [
    "purchase_order",
    "inspection_certificate",
    "service_master",
    "individual_license_terms",
  ]
  const primaryTypes = PRIMARY_TYPES.filter((t) => templateList?.includes(t))
  const otherTypes = (templateList || [])
    .filter((t) => !primaryTypes.includes(t))
    .sort((a, b) => templateLabel(a).localeCompare(templateLabel(b), "ja"))

  // 作成状況バッジ用: この課題で既に作成済み(final)の種別集合。
  const createdTypes = React.useMemo(() => {
    const s = new Set<string>()
    for (const d of docs) {
      if ((d.lifecycle_status || "final") === "final" && d.is_primary !== false) {
        s.add(d.template_type)
      }
    }
    return s
  }, [docs])

  // ── まとめてクラウドサイン送信(課題ベース) ──────────────────
  //   Drive 上にPDFがある文書だけ選択可能。1書類に全PDFを添付して送る。
  const isDrivePdf = (link?: string | null) => {
    const dl = String(link || "")
    return /\/file\/d\/[a-zA-Z0-9_-]+/.test(dl) || /(drive|docs)\.google\.com/.test(dl)
  }
  const [selDocs, setSelDocs] = React.useState<Set<string>>(new Set())
  const [bundleOpen, setBundleOpen] = React.useState(false)
  const [csName, setCsName] = React.useState("")
  const [csEmail, setCsEmail] = React.useState("")
  const [csVendorCode, setCsVendorCode] = React.useState("")
  const [csContactIdx, setCsContactIdx] = React.useState(0)
  const [csContacts, setCsContacts] = React.useState<any[]>([])
  const [csInternal, setCsInternal] = React.useState<
    { name: string; email: string; role?: string }[]
  >([])
  const [csRelay, setCsRelay] = React.useState<"internal_first" | "vendor_first">("internal_first")
  const [csLang, setCsLang] = React.useState<"ja" | "en">("ja")
  const [csCc, setCsCc] = React.useState("")
  const [csDraft, setCsDraft] = React.useState(false)
  const [csRouteLoading, setCsRouteLoading] = React.useState(false)
  const [csSending, setCsSending] = React.useState(false)

  const toggleSel = (dn: string) =>
    setSelDocs((prev) => {
      const n = new Set(prev)
      n.has(dn) ? n.delete(dn) : n.add(dn)
      return n
    })

  const openBundle = async () => {
    setBundleOpen(true)
    setCsName("")
    setCsEmail("")
    setCsVendorCode("")
    setCsContactIdx(0)
    setCsContacts([])
    setCsInternal([])
    setCsRelay("internal_first")
    setCsLang("ja")
    setCsCc("")
    setCsDraft(false)
    setCsRouteLoading(true)
    try {
      const res = await fetch(`/api/issues/${encodeURIComponent(issueKey)}/cloudsign/route`)
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.ok) {
        if (Array.isArray(data.signers))
          setCsInternal(data.signers.map((s: any) => ({ name: s.name, email: s.email, role: s.role })))
        if (data.vendor?.email) setCsEmail(data.vendor.email)
        if (data.vendor?.name) setCsName(data.vendor.name)
      }
    } catch {
      /* ルート未設定は無視 */
    } finally {
      setCsRouteLoading(false)
    }
  }

  const sendBundle = async () => {
    setCsSending(true)
    try {
      const internalPs = csInternal
        .filter((s) => s.email)
        .map((s) => ({ name: s.name || "社内署名者", email: s.email }))
      const vendorP = csEmail.trim()
        ? { name: csName.trim() || "署名者", email: csEmail.trim() }
        : null
      let ordered: any[] = []
      if (internalPs.length && vendorP)
        ordered = csRelay === "vendor_first" ? [vendorP, ...internalPs] : [...internalPs, vendorP]
      else if (internalPs.length) ordered = [...internalPs]
      else if (vendorP) ordered = [vendorP]
      const participants = ordered.map((p, i) => ({ ...p, order: i + 1 }))
      const res = await fetch(`/api/issues/${encodeURIComponent(issueKey)}/cloudsign/send-bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_numbers: Array.from(selDocs),
          participants,
          language: csLang,
          draft: csDraft,
          cc: csCc
            .split(/[,\s]+/)
            .map((e) => e.trim())
            .filter((e) => e.includes("@"))
            .map((email) => ({ email })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      if (data.draft && data.cloudsign_url) {
        showNotification?.(
          "下書きを作成しました。CloudSign で署名欄/印影を配置して送信してください。",
          "success"
        )
        window.open(data.cloudsign_url, "_blank", "noopener,noreferrer")
      } else {
        showNotification?.(
          `クラウドサインへ送信しました（${data.count ?? selDocs.size}件まとめ）${data.is_test ? "（テスト許可宛先）" : ""}`,
          "success"
        )
      }
      setBundleOpen(false)
      setSelDocs(new Set())
    } catch (e: any) {
      showNotification?.(`送信に失敗しました: ${e?.message || e}`, "error")
    } finally {
      setCsSending(false)
    }
  }

  const fmtDate = (v?: string | null) =>
    v ? new Date(v).toLocaleDateString("ja-JP") : "—"
  const fmtAmount = (v: any, currency = "JPY") => {
    const n = Number(v)
    if (!Number.isFinite(n)) return "—"
    return `${currency || "JPY"} ${Math.round(n).toLocaleString("ja-JP")}`
  }
  const progressPct = (line: IssueConditionLine) => {
    const total = Number(line.amount_ex_tax || 0)
    const consumed = Number(line.consumed_amount || 0)
    if (!Number.isFinite(total) || total <= 0) return null
    return Math.max(0, Math.min(100, Math.round((consumed / total) * 100)))
  }
  const statusText = (status?: string | null) => {
    switch (status) {
      case "fulfilled":
        return "完了"
      case "expired":
        return "期間満了"
      case "partially_fulfilled":
        return "一部消化"
      case "active":
        return "有効"
      case "open":
        return "未消化"
      default:
        return status || "未判定"
    }
  }
  const relationText = (relations?: string[] | null) => {
    const r = new Set(relations || [])
    if (r.has("contracting") && r.has("payment")) return "締結 + 支払準備"
    if (r.has("contracting")) return "締結フェイズ"
    if (r.has("payment")) return "支払準備フェイズ"
    return "関連フェイズ"
  }
  const allLineEvents = (lineSummary?.lines || []).flatMap((line) =>
    Array.isArray(line.recent_events) ? line.recent_events : []
  )
  const hasEventLike = (...needles: string[]) =>
    allLineEvents.some((ev) => {
      const t = String(ev?.event_type || "").toLowerCase()
      return needles.some((needle) => t.includes(needle))
    })
  const hasLineRelation = (relation: string) =>
    (lineSummary?.lines || []).some((line) => (line.relations || []).includes(relation))
  const stageItems = [
    {
      key: "contract",
      label: "締結",
      done:
        hasLineRelation("contracting") ||
        createdTypes.has("purchase_order") ||
        createdTypes.has("intl_purchase_order") ||
        createdTypes.has("individual_license_terms") ||
        createdTypes.has("pub_license_terms"),
    },
    { key: "delivery", label: "納品", done: hasEventLike("delivery") },
    {
      key: "usage",
      label: "利用",
      done:
        hasEventLike("usage", "royalty", "report") ||
        (lineSummary?.lines || []).some((line) =>
          ["subscription", "royalty"].includes(String(line.payment_scheme || ""))
        ),
    },
    {
      key: "inspection",
      label: "検収",
      done: createdTypes.has("inspection_certificate") || hasEventLike("inspection"),
    },
    {
      key: "calculation",
      label: "計算",
      done:
        createdTypes.has("royalty_statement") ||
        createdTypes.has("license_calculation_sheet") ||
        hasEventLike("calculation", "royalty"),
    },
  ]
  const issuePhaseLabel = React.useMemo(() => {
    const phases = new Set((lineSummary?.lines || []).map((line) => line.issue_phase))
    if (phases.has("mixed")) return "締結 + 支払準備"
    if (phases.has("contracting") && phases.has("payment")) return "締結 + 支払準備"
    if (phases.has("contracting")) return "締結フェイズ"
    if (phases.has("payment")) return "支払準備フェイズ"
    return "フェイズ未判定"
  }, [lineSummary])

  return (
    <div className="px-6 py-6 max-w-[1100px] mx-auto space-y-6">
      <button
        type="button"
        onClick={() => navigate("/requests")}
        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Requests に戻る
      </button>

      {/* ── 統一課題(契約)への導線。この課題が属する新課題へジャンプ ───── */}
      {unifiedLinks.length > 0 && (
        <div className="rounded-sm border border-indigo-200 bg-indigo-50/60 px-3 py-2 flex items-center gap-2 flex-wrap">
          <GitMerge className="h-4 w-4 text-indigo-700 shrink-0" />
          <span className="text-[11px] font-mono text-indigo-900">この課題が属する統一課題(契約):</span>
          {unifiedLinks.map((u) => (
            <button
              key={u.capability_id}
              type="button"
              onClick={() => navigate(`/unified/${u.capability_id}`)}
              className="text-[11px] font-mono font-bold underline text-indigo-800 hover:text-indigo-950"
              title={`${u.vendor_name || ""} ${u.contract_title || ""}`.trim()}
            >
              {u.document_number || `cap${u.capability_id}`}
            </button>
          ))}
          <span className="text-[10px] font-mono text-indigo-700/70">締結+支払を1画面で</span>
        </div>
      )}

      {/* ── ヘッダ: 課題キー / 件名 / ステータス / 担当・期日 ───────── */}
      <header className="border-b border-border pb-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline" className="font-mono">
              {issueKey}
            </Badge>
            <h2 className="text-2xl font-mono font-bold tracking-tight leading-snug">
              {issue?.summary || "(件名未取得)"}
            </h2>
            <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {issue?.assignee?.name || issue?.registeredUser || "system"}
              </span>
              {issue?.status?.name && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {issue.status.name}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {primaryTypes.length === 0 ? (
              <Button size="sm" onClick={() => createDocument()} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                文書を作成
              </Button>
            ) : (
              <>
                {primaryTypes.map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    onClick={() => createDocument(t)}
                    className="gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {templateLabel(t)}
                  </Button>
                ))}
                {otherTypes.length > 0 && (
                  <NativeSelect
                    aria-label="その他の種別で作成"
                    value=""
                    onChange={(e) => {
                      const v = e.target.value
                      if (v) createDocument(v)
                    }}
                    className="h-9 w-[150px]"
                  >
                    <option value="">その他で作成…</option>
                    {otherTypes.map((t) => (
                      <option key={t} value={t}>
                        {templateLabel(t)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </>
            )}
          </div>
        </div>

        {/* 作成状況: 主要種別の作成済み(緑) / 未作成(グレー) を一目で。 */}
        {primaryTypes.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            {primaryTypes.map((t) => {
              const done = createdTypes.has(t)
              return (
                <span
                  key={`cov-${t}`}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-mono border",
                    done
                      ? "border-emerald-600/40 text-emerald-700 bg-emerald-500/10"
                      : "border-border text-muted-foreground"
                  )}
                  title={done ? "作成済み" : "未作成"}
                >
                  {done ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <span className="inline-block w-3 text-center leading-none">—</span>
                  )}
                  {templateLabel(t)}
                </span>
              )
            })}
          </div>
        )}

        {/* Backlog ステータス操作 (compact)。 */}
        <div className="pt-1 flex items-center gap-2 flex-wrap">
          <WorkflowPanel
            issueKey={issueKey}
            currentStatus={(issue as any)?.status}
            issueTypeName={
              (issue as any)?.issueType?.name ||
              (issue as any)?.issue_type_name
            }
            compact
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              mergeCart.has(issueKey)
                ? mergeCart.setOpen(true)
                : mergeCart.add(
                    { issueKey, summary: issue?.summary, statusName: issue?.status?.name },
                    { openPanel: true }
                  )
            }
            className={cn("gap-1.5", mergeCart.has(issueKey) && "border-emerald-600 text-emerald-700")}
            title="この課題を統合カートに入れる。籠に集めた課題から統合先を選んで統合する"
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            {mergeCart.has(issueKey) ? "統合カート済" : "統合カートへ"}
          </Button>
        </div>
      </header>

      {/* ── 課題概要 (Backlog) ────────────────────────────────────
          legalrequest からこの画面を開いたとき、Backlog に格納された
          概要情報を表示する。
            - 主要属性 (取引先名称・依頼部署・締結方法・希望納期) は
              customFields からラベル付きで並べて表示。
            - 課題本文 (description) はその下に全文表示。 */}
      {overviewFields.length > 0 || issue?.description?.trim() ? (
        <section className="space-y-3">
          <SectionHead label="SEC · 00 / 課題概要（Backlog）" />
          <Card>
            <CardContent className="px-4 py-3 space-y-3">
              {overviewFields.length > 0 && (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  {overviewFields.map((f) => (
                    <div key={f.label} className="flex items-baseline gap-2">
                      <dt className="shrink-0 w-20 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                        {f.label}
                      </dt>
                      <dd className="min-w-0 flex-1 text-xs font-mono break-words text-foreground">
                        {f.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {issue?.description?.trim() ? (
                <p
                  className={cn(
                    "text-xs font-mono leading-relaxed whitespace-pre-wrap break-words text-foreground/90",
                    overviewFields.length > 0 && "pt-3 border-t border-border"
                  )}
                >
                  {resolvedDescription}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {/* ── 取引循環進捗 ─────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHead label="SEC · 01 / 取引循環進捗" />
        {lineSummaryError ? (
          <Card>
            <CardContent className="px-4 py-3 text-xs font-mono text-destructive">
              条件明細サマリの取得に失敗しました: {lineSummaryError}
            </CardContent>
          </Card>
        ) : !lineSummary || lineSummary.lines.length === 0 ? (
          <Card>
            <CardContent className="px-4 py-6 text-center text-xs font-mono text-muted-foreground">
              この課題に紐づく条件明細はまだありません。
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ["明細", lineSummary.summary.total],
                ["進行中", lineSummary.summary.open],
                ["完了", lineSummary.summary.completed],
                ["次アクション", lineSummary.summary.next_actions || 0],
              ].map(([label, value]) => (
                <div key={String(label)} className="border border-border rounded-sm px-3 py-2">
                  <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    {label}
                  </div>
                  <div className="text-lg font-mono font-bold">{value}</div>
                </div>
              ))}
            </div>
            <div className="border border-border rounded-sm px-3 py-2 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                  現在フェイズ
                </span>
                <Badge variant="outline" className="font-mono">
                  {issuePhaseLabel}
                </Badge>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {stageItems.map((stage) => (
                  <div
                    key={stage.key}
                    className={cn(
                      "h-8 border rounded-sm flex items-center justify-center text-[10px] font-mono",
                      stage.done
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : "border-border text-muted-foreground"
                    )}
                  >
                    {stage.done && <Check className="h-3 w-3 mr-1" />}
                    {stage.label}
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {lineSummary.lines.map((line) => {
                const pct = progressPct(line)
                const isDone = ["fulfilled", "expired"].includes(String(line.status || ""))
                return (
                  <Card key={`line-${line.id}`} className="transition-colors hover:border-foreground">
                    <CardContent className="px-4 py-3 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="font-mono">
                              {line.line_code || `CL-${line.id}`}
                            </Badge>
                            <span className="text-sm font-mono font-bold break-words">
                              {line.subject || "(件名なし)"}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-muted-foreground">
                            <span>{relationText(line.relations)}</span>
                            <span>{line.payment_scheme || "scheme未設定"}</span>
                            <span>{statusText(line.status)}</span>
                            {line.contract_number && <span>契約 {line.contract_number}</span>}
                          </div>
                          {(line.related_issue_keys || []).filter((key) => key !== issueKey).length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                              <span className="text-muted-foreground">兄弟課題</span>
                              {(line.related_issue_keys || [])
                                .filter((key) => key && key !== issueKey)
                                .map((key) => (
                                  <button
                                    key={`${line.id}-${key}`}
                                    type="button"
                                    onClick={() => navigate(`/issues/${encodeURIComponent(key)}`)}
                                    className="border border-border hover:border-foreground rounded-sm px-1.5 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    {key}
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {line.line_code && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                navigate(`/condition-lines/${encodeURIComponent(line.line_code!)}`)
                              }
                              className="h-8 gap-1.5 text-[10px] font-mono"
                            >
                              <ListChecks className="h-3.5 w-3.5" />
                              明細
                            </Button>
                          )}
                          {line.next_template_type && !isDone && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => createDocument(line.next_template_type!)}
                              className="h-8 gap-1.5 text-[10px] font-mono"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              {templateLabel(line.next_template_type)}
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[10px] font-mono">
                        <div>
                          <div className="text-muted-foreground uppercase tracking-[0.14em]">
                            金額 / 消化
                          </div>
                          <div className="text-foreground">
                            {fmtAmount(line.consumed_amount, line.currency || "JPY")} /{" "}
                            {fmtAmount(line.amount_ex_tax, line.currency || "JPY")}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground uppercase tracking-[0.14em]">
                            残額 / 実績
                          </div>
                          <div className="text-foreground">
                            {fmtAmount(line.remaining_amount, line.currency || "JPY")} /{" "}
                            {line.total_event_count || 0}件
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground uppercase tracking-[0.14em]">
                            期間 / 納期
                          </div>
                          <div className="text-foreground">
                            {line.term_start || line.term_end
                              ? `${fmtDate(line.term_start)} → ${fmtDate(line.term_end)}`
                              : fmtDate(line.delivery_date)}
                          </div>
                        </div>
                      </div>

                      {pct != null && (
                        <div className="h-1.5 bg-muted rounded-sm overflow-hidden">
                          <div
                            className={cn(
                              "h-full transition-all",
                              isDone ? "bg-emerald-600" : "bg-foreground"
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                      {Array.isArray(line.recent_events) && line.recent_events.length > 0 && (
                        <div className="border-t border-border pt-2 space-y-1">
                          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                            最近の実績
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {line.recent_events.slice(0, 3).map((ev, index) => (
                              <span
                                key={`${line.id}-ev-${index}`}
                                className="text-[10px] font-mono border border-border rounded-sm px-2 py-1 text-muted-foreground"
                              >
                                {ev.event_type || "event"} · {fmtDate(ev.occurred_at)} ·{" "}
                                {ev.document_number || ev.backlog_issue_key || "文書なし"}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── 文書一覧 ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionHead label="SEC · 02 / この課題で作成した文書" />
          {selDocs.size > 0 && (
            <Button size="sm" onClick={openBundle} className="gap-1.5 shrink-0">
              <Send className="h-3.5 w-3.5" />
              まとめてクラウドサイン送信（{selDocs.size}）
            </Button>
          )}
        </div>

        {loading ? (
          <div className="p-12 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 mx-auto animate-spin" />
          </div>
        ) : error ? (
          <div className="p-8 text-center border border-dashed border-destructive/50 rounded-md">
            <p className="text-xs font-mono text-destructive">
              文書の取得に失敗しました: {error}
            </p>
          </div>
        ) : docs.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-border rounded-md">
            <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
              この課題に紐づく文書はまだありません。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map((d) => (
              <Card key={`doc-${d.id}`} className="transition-colors hover:border-foreground">
                <CardContent className="px-4 py-3 flex items-center gap-4">
                  {d.document_number && isDrivePdf(d.drive_link) ? (
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-foreground cursor-pointer"
                      checked={selDocs.has(d.document_number)}
                      onChange={() => toggleSel(d.document_number!)}
                      title="まとめ送信に含める"
                    />
                  ) : (
                    <span
                      className="h-4 w-4 shrink-0"
                      title="Drive上のPDFがある正本のみ まとめ送信できます"
                    />
                  )}
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono font-bold">
                        {templateLabel(d.template_type)}
                      </span>
                      <LifecycleBadge status={d.lifecycle_status} />
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                      <span className="font-mono">
                        {d.document_number || "(採番なし)"}
                      </span>
                      <span>
                        {new Date(d.created_at).toLocaleDateString("ja-JP")}
                      </span>
                      {d.created_by && <span>{d.created_by}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {d.line_code && (
                      <button
                        type="button"
                        onClick={() =>
                          navigate(`/condition-lines/${encodeURIComponent(d.line_code!)}`)
                        }
                        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors border border-border hover:border-foreground px-1.5 py-1 rounded-sm"
                        title="対応する条件明細を見る"
                      >
                        <ListChecks className="h-3 w-3" />
                        条件明細
                      </button>
                    )}
                    {d.drive_link && (
                      <a
                        href={d.drive_link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors border border-border hover:border-foreground px-1.5 py-1 rounded-sm"
                        title="Drive で開く"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Drive
                      </a>
                    )}
                    {d.document_number && (
                      <button
                        type="button"
                        onClick={() => setChooserDoc(d)}
                        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 transition-colors border border-emerald-300 hover:border-emerald-500 px-1.5 py-1 rounded-sm"
                        title="この文書を送信（クラウドサイン / メール）"
                      >
                        ✉ 送信
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => reopen(d.id)}
                      className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors border border-border hover:border-foreground px-1.5 py-1 rounded-sm"
                      title="この文書を再編集"
                    >
                      <Pencil className="h-3 w-3" />
                      再編集
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* まとめてクラウドサイン送信ダイアログ */}
      <Dialog open={bundleOpen} onOpenChange={(v) => !v && setBundleOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>まとめてクラウドサインで送信</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="text-xs font-mono text-muted-foreground leading-relaxed">
              対象 {selDocs.size} 件を 1 つの書類にまとめて送信します：
              <ul className="mt-1 space-y-0.5">
                {Array.from(selDocs).map((dn) => {
                  const d = docs.find((x) => x.document_number === dn)
                  return (
                    <li key={dn} className="text-foreground">
                      ・{d ? templateLabel(d.template_type) : ""} {dn}
                    </li>
                  )
                })}
              </ul>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">取引先を検索（選択で氏名・メールを自動補完）</Label>
              <VendorSearchSelect
                vendors={vendors}
                selectedCode={csVendorCode}
                onSelect={async (v) => {
                  if (!v) {
                    setCsVendorCode("")
                    setCsContacts([])
                    return
                  }
                  setCsVendorCode(v.vendor_code || "")
                  const contacts = await loadVendorContacts(v)
                  setCsContacts(contacts)
                  const idx = primaryContactIdx(contacts)
                  setCsContactIdx(idx)
                  const c = contacts[idx]
                  setCsName(c?.contact_name || v.contact_name || v.vendor_rep || v.vendor_name || "")
                  setCsEmail(c?.email || contacts.find((x: any) => x?.email)?.email || v.email || "")
                }}
                placeholder="取引先を検索 (コード / 名称 / 屋号)"
              />
            </div>
            {csContacts.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">担当者（連絡先）を選択</Label>
                <NativeSelect
                  value={String(csContactIdx)}
                  onChange={(e) => {
                    const i = Number(e.target.value)
                    setCsContactIdx(i)
                    const c = csContacts[i]
                    if (c) {
                      setCsName(c.contact_name || "")
                      setCsEmail(c.email || "")
                    }
                  }}
                >
                  {csContacts.map((c, i) => (
                    <option key={i} value={i}>
                      {(c.contact_name || "（氏名なし）") +
                        (c.title ? `（${c.title}）` : "") +
                        (c.email ? ` <${c.email}>` : "") +
                        (c.is_primary ? " ★主担当" : "")}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">取引先 署名者 氏名（任意）</Label>
              <Input value={csName} onChange={(e) => setCsName(e.target.value)} placeholder="山田 太郎" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">取引先 署名者 メール</Label>
              <Input
                type="email"
                value={csEmail}
                onChange={(e) => setCsEmail(e.target.value)}
                placeholder="signer@example.co.jp"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                社内 署名者（部署ルートで自動設定・編集可。上から署名順）
                {csRouteLoading && <span className="ml-2 text-muted-foreground">ルート取得中…</span>}
              </Label>
              {csInternal.length === 0 ? (
                <p className="text-[11px] font-mono text-muted-foreground">
                  社内署名者なし（部署ルート未設定 or 無し）。下で追加できます。
                </p>
              ) : (
                <div className="space-y-1">
                  {csInternal.map((s, idx) => (
                    <div
                      key={`${s.email}-${idx}`}
                      className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs font-mono"
                    >
                      <span className="text-muted-foreground w-4 text-center">{idx + 1}</span>
                      {s.role && <Badge variant="outline" className="shrink-0">{s.role}</Badge>}
                      <span className="min-w-0 flex-1 truncate">
                        {s.name}（{s.email}）
                      </span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        title="上へ"
                        disabled={idx === 0}
                        onClick={() =>
                          setCsInternal((prev) => {
                            const a = [...prev]
                            ;[a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]
                            return a
                          })
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        title="下へ"
                        disabled={idx === csInternal.length - 1}
                        onClick={() =>
                          setCsInternal((prev) => {
                            const a = [...prev]
                            ;[a[idx + 1], a[idx]] = [a[idx], a[idx + 1]]
                            return a
                          })
                        }
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="text-destructive hover:opacity-70"
                        title="削除"
                        onClick={() => setCsInternal((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <StaffPicker
                staff={staffList as any[]}
                exclude={csInternal.map((s) => s.email)}
                onPick={(st) =>
                  setCsInternal((prev) => [
                    ...prev,
                    { name: st.staff_name || "社内署名者", email: st.email! },
                  ])
                }
              />
            </div>
            {csInternal.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">署名順（リレー）</Label>
                <NativeSelect
                  value={csRelay}
                  onChange={(e) => setCsRelay(e.target.value as "internal_first" | "vendor_first")}
                >
                  <option value="internal_first">社内（上から）→ 取引先</option>
                  <option value="vendor_first">取引先 → 社内（上から）</option>
                </NativeSelect>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">言語（署名画面・通知メール）</Label>
              <NativeSelect value={csLang} onChange={(e) => setCsLang(e.target.value as "ja" | "en")}>
                <option value="ja">日本語</option>
                <option value="en">英語（English）</option>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CC（共有先メール・カンマ区切り・任意）</Label>
              <Input
                value={csCc}
                onChange={(e) => setCsCc(e.target.value)}
                placeholder="cc1@example.co.jp, cc2@example.co.jp"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">送信方法</Label>
              <NativeSelect
                value={csDraft ? "draft" : "send"}
                onChange={(e) => setCsDraft(e.target.value === "draft")}
              >
                <option value="send">即時送信（API でそのまま送る）</option>
                <option value="draft">CloudSign で署名欄/印影を配置してから送信（下書き作成）</option>
              </NativeSelect>
            </div>
            <p className="text-[11px] font-mono text-muted-foreground">
              ※ 各文書は Drive 上のPDFが必要。設定で「許可宛先」を設定中は、<b>全署名者・CC（社内含む）のメールが許可宛先に入っている必要</b>があります。「下書き作成」を選ぶと CloudSign の編集画面が開きます。英語は webhook 有効時に制限される場合あり。
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBundleOpen(false)} disabled={csSending}>
              キャンセル
            </Button>
            <Button onClick={sendBundle} disabled={csSending || selDocs.size === 0}>
              <Send className="h-3.5 w-3.5" />
              {csSending ? "処理中…" : csDraft ? `下書き作成（${selDocs.size}件）` : `送信（${selDocs.size}件）`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 送信方法の選択(クラウドサイン / メール) */}
      <Dialog open={!!chooserDoc} onOpenChange={(v) => !v && setChooserDoc(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>送信方法を選択</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-2.5">
            <div className="text-xs font-mono text-muted-foreground">
              {chooserDoc ? templateLabel(chooserDoc.template_type) : ""}{" "}
              {chooserDoc?.document_number}
            </div>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() => {
                const d = chooserDoc!
                setChooserDoc(null)
                openEmail(d)
              }}
            >
              ✉ メールで送信
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              disabled={!isDrivePdf(chooserDoc?.drive_link)}
              onClick={() => {
                const d = chooserDoc!
                setChooserDoc(null)
                openCloudSignFor(d)
              }}
            >
              ✍ クラウドサインで送信
            </Button>
            {!isDrivePdf(chooserDoc?.drive_link) && (
              <p className="text-[10px] font-mono text-muted-foreground">
                ※ クラウドサインは Drive 上に PDF がある正本のみ送信できます。
              </p>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* メール送信(宛先・CC 入力 + 確認) */}
      <Dialog open={!!emailDoc} onOpenChange={(v) => !v && setEmailDoc(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>メールで送信</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="text-xs font-mono text-muted-foreground">
              {emailDoc ? templateLabel(emailDoc.template_type) : ""}{" "}
              {emailDoc?.document_number}
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">取引先を検索（選択で送信先メールを自動補完）</Label>
              <VendorSearchSelect
                vendors={vendors}
                selectedCode={emailVendorCode}
                onSelect={async (v) => {
                  if (!v) {
                    setEmailVendorCode("")
                    setEmailContacts([])
                    return
                  }
                  setEmailVendorCode(v.vendor_code || "")
                  const contacts = await loadVendorContacts(v)
                  setEmailContacts(contacts)
                  const idx = primaryContactIdx(contacts)
                  setEmailContactIdx(idx)
                  setEmailTo(
                    contacts[idx]?.email || contacts.find((x: any) => x?.email)?.email || v.email || ""
                  )
                }}
                placeholder="取引先を検索 (コード / 名称 / 屋号)"
              />
            </div>
            {emailContacts.length > 0 && (
              <div className="space-y-1">
                <Label className="text-[11px]">担当者（連絡先）を選択</Label>
                <NativeSelect
                  value={String(emailContactIdx)}
                  onChange={(e) => {
                    const i = Number(e.target.value)
                    setEmailContactIdx(i)
                    if (emailContacts[i]?.email) setEmailTo(emailContacts[i].email)
                  }}
                >
                  {emailContacts.map((c, i) => (
                    <option key={i} value={i}>
                      {(c.contact_name || "（氏名なし）") +
                        (c.title ? `（${c.title}）` : "") +
                        (c.email ? ` <${c.email}>` : "") +
                        (c.is_primary ? " ★主担当" : "")}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-[11px]">送信先（空欄なら取引先の主担当・複数可カンマ区切り）</Label>
              <Input
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="vendor@example.co.jp"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">CC（複数可・カンマ区切り。設定の既定CCにも追加されます）</Label>
              <StaffPicker
                staff={staffList as any}
                placeholder="スタッフを検索して CC に追加（氏名 / メール / 部署）"
                onPick={(s) => {
                  if (!s.email) return
                  const cur = emailCc.split(",").map((x) => x.trim()).filter(Boolean)
                  if (!cur.includes(s.email)) setEmailCc([...cur, s.email].join(", "))
                }}
              />
              <Input
                value={emailCc}
                onChange={(e) => setEmailCc(e.target.value)}
                placeholder="cc@example.co.jp"
              />
            </div>
            <p className="text-[10px] font-mono text-muted-foreground">
              内容を確認のうえ「送信」を押してください。PDF を添付して送信します。
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDoc(null)}>
              キャンセル
            </Button>
            <Button onClick={sendEmailNow} disabled={emailSending}>
              <Send className="h-3.5 w-3.5" />
              {emailSending ? "送信中…" : "送信"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
