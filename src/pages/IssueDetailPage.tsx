import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  User,
  Calendar,
  ListChecks,
  PenLine,
} from "lucide-react"

import { useAppData, useDocumentSession } from "@/src/context/AppDataContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent } from "@/components/ui/card"
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
  cloudsign_target?: boolean // クラウドサイン対象か(紙/相手方電子契約のとき false)
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
  const { issues, templateMetadata, showNotification } = useAppData()
  const { setSelectedIssue } = useDocumentSession()

  // クラウドサイン送信(文書一覧から)。空メールなら取引先の主担当を worker 側で補完。
  const [csDoc, setCsDoc] = React.useState<any>(null)
  const [csName, setCsName] = React.useState("")
  const [csEmail, setCsEmail] = React.useState("")
  const [csSending, setCsSending] = React.useState(false)
  const sendCloudSign = async () => {
    if (!csDoc?.document_number) return
    setCsSending(true)
    try {
      const participants = csEmail.trim()
        ? [{ name: csName.trim() || "署名者", email: csEmail.trim(), order: 1 }]
        : []
      const res = await fetch(
        `/api/documents/${encodeURIComponent(csDoc.document_number)}/cloudsign/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participants }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      showNotification(
        data.is_test ? "クラウドサインへ送信しました（テスト許可宛先）" : "クラウドサインへ送信しました",
        "success"
      )
      setCsDoc(null)
    } catch (e: any) {
      showNotification(`送信に失敗しました: ${e?.message || e}`, "error")
    } finally {
      setCsSending(false)
    }
  }

  // 文書の「クラウドサイン対象 / 対象外」を切替(楽観更新)。
  const toggleCsTarget = async (d: any, target: boolean) => {
    if (!d?.document_number) return
    setDocs((prev) => prev.map((x) => (x.id === d.id ? { ...x, cloudsign_target: target } : x)))
    try {
      const res = await fetch(
        `/api/documents/${encodeURIComponent(d.document_number)}/cloudsign-target`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cloudsign_target: target }),
        }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (e: any) {
      setDocs((prev) => prev.map((x) => (x.id === d.id ? { ...x, cloudsign_target: !target } : x)))
      showNotification(`対象の切替に失敗しました: ${e?.message || e}`, "error")
    }
  }

  const issue = React.useMemo(
    () => issues.find((i) => i.issueKey === issueKey),
    [issues, issueKey]
  )

  const [docs, setDocs] = React.useState<IssueDocument[]>([])
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
        const list: IssueDocument[] = Array.isArray(data) ? data : []
        // 文書制御(クラウドサイン対象フラグ)は worker から取得して合流する。
        try {
          const tRes = await fetch(
            `/api/issues/${encodeURIComponent(issueKey)}/cloudsign-targets`
          )
          if (tRes.ok) {
            const targets = await tRes.json()
            const map = new Map<string, boolean>(
              (Array.isArray(targets) ? targets : []).map((t: any) => [
                t.document_number,
                t.cloudsign_target !== false,
              ])
            )
            for (const d of list) {
              if (d.document_number && map.has(d.document_number))
                d.cloudsign_target = map.get(d.document_number)
            }
          }
        } catch {
          /* 取得失敗時は既定(対象)で表示 */
        }
        if (!cancelled) setDocs(list)
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

  // 「文書を作成」: 現在の課題をセッションにセットして従来の作成フローへ。
  const createDocument = () => {
    setSelectedIssue(issueKey)
    navigate("/documents/new")
  }

  // 「再編集」: 既存の reopen ディープリンクを再利用 (DocumentEditorPage が
  //   ?reopen=<id> を解釈して form_data を読み込む)。
  const reopen = (docId: number) => {
    navigate(`/documents/new?reopen=${encodeURIComponent(String(docId))}`)
  }

  const templateLabel = (t: string) => templateMetadata?.[t]?.label || t

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
          <Button size="sm" onClick={createDocument} className="gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" />
            文書を作成
          </Button>
        </div>

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
        <SectionHead label="SEC · 01 / この課題で作成した文書" />

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
                    {/* クラウドサイン対象スイッチ(紙/相手方電子契約のときオフ) */}
                    <label
                      className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground mr-1 cursor-pointer"
                      title="クラウドサイン対象（紙や相手方の電子契約のときはオフ）"
                    >
                      <Switch
                        checked={d.cloudsign_target !== false}
                        onCheckedChange={(v) => toggleCsTarget(d, !!v)}
                      />
                      CS対象
                    </label>
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
                    {d.drive_link && d.cloudsign_target !== false && (
                      <button
                        type="button"
                        onClick={() => {
                          setCsDoc(d)
                          setCsName("")
                          setCsEmail("")
                        }}
                        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors border border-border hover:border-foreground px-1.5 py-1 rounded-sm"
                        title="クラウドサインで送信"
                      >
                        <PenLine className="h-3 w-3" />
                        送信
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

      {/* クラウドサイン送信ダイアログ */}
      <Dialog open={!!csDoc} onOpenChange={(v) => !v && setCsDoc(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>クラウドサインで送信</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="text-xs font-mono text-muted-foreground leading-relaxed">
              文書:{" "}
              <span className="font-bold text-foreground">{csDoc?.document_number || "—"}</span>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">署名者 氏名（任意）</Label>
              <Input value={csName} onChange={(e) => setCsName(e.target.value)} placeholder="山田 太郎" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">署名者 メール（空欄なら取引先の主担当を自動使用）</Label>
              <Input
                type="email"
                value={csEmail}
                onChange={(e) => setCsEmail(e.target.value)}
                placeholder="signer@example.co.jp"
              />
            </div>
            <p className="text-[11px] font-mono text-muted-foreground">
              ※ 生成済みPDFが必要です。設定で「許可宛先」を設定中は、その宛先（社内テスト用）のみ送信できます。
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCsDoc(null)} disabled={csSending}>
              キャンセル
            </Button>
            <Button onClick={sendCloudSign} disabled={csSending}>
              <PenLine className="h-3.5 w-3.5" />
              {csSending ? "送信中…" : "送信"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
