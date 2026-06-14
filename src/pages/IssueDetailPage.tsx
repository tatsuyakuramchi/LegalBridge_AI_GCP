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
} from "lucide-react"

import { useAppData, useDocumentSession } from "@/src/context/AppDataContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { NativeSelect } from "@/components/ui/native-select"
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
  const { issues, templateMetadata, templateList } = useAppData()
  const { setSelectedIssue, setFormData } = useDocumentSession()

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
    "individual_license_terms",
  ]
  const primaryTypes = PRIMARY_TYPES.filter((t) => templateList?.includes(t))
  const otherTypes = (templateList || [])
    .filter((t) => !primaryTypes.includes(t))
    .sort((a, b) => templateLabel(a).localeCompare(templateLabel(b), "ja"))

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
    </div>
  )
}
