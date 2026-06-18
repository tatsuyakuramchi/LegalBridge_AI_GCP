import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
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
} from "lucide-react"

import { cn } from "@/lib/utils"

import { useAppData, useDocumentSession } from "@/src/context/AppDataContext"
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

  const [docs, setDocs] = React.useState<IssueDocument[]>([])
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

  React.useEffect(() => {
    if (!issueKey) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/issues/${encodeURIComponent(issueKey)}/documents`
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setDocs(Array.isArray(data) ? data : [])
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
      if ((d.lifecycle_status || "final") === "final") s.add(d.template_type)
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
        <div className="pt-1">
          <WorkflowPanel
            issueKey={issueKey}
            currentStatus={(issue as any)?.status}
            issueTypeName={
              (issue as any)?.issueType?.name ||
              (issue as any)?.issue_type_name
            }
            compact
          />
        </div>
      </header>

      {/* ── 文書一覧 ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionHead label="SEC · 01 / この課題で作成した文書" />
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
