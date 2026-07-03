import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  Loader2,
  Save,
  Trash2,
  Plus,
  X,
  FileText,
  FilePlus,
  Send,
  Layers,
  ListChecks,
  ExternalLink,
  GitMerge,
  Mail,
  Pencil,
  History,
  StickyNote,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
} from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect } from "@/components/ui/native-select"
import { useToast } from "@/components/ui/toast"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"
import { useAppData } from "@/src/context/AppDataContext"
import { VendorSearchSelect } from "@/src/components/document/VendorSearchSelect"
import { IssuePicker } from "@/src/components/IssuePicker"

const RELATION_LABEL: Record<string, string> = {
  primary: "代表",
  duplicate: "重複",
  partial: "部分発生",
  related: "関連",
}
const RELATION_VARIANT: Record<string, any> = {
  primary: "success",
  duplicate: "destructive",
  partial: "info",
  related: "secondary",
}
const STATUS_OPTS = [
  ["open", "未着手"],
  ["in_progress", "進行中"],
  ["closed", "完了"],
  ["archived", "アーカイブ"],
]

const fmtDate = (s: any) =>
  s ? new Date(s).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) : "—"
const fmtDateTime = (s: any) =>
  s ? new Date(s).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""
const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`

function SectionHead({ icon: Icon, label, count, right }: { icon: any; label: string; count?: number; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-[12px] font-semibold uppercase tracking-wide">{label}</span>
      {count != null && <span className="text-[11px] text-muted-foreground">({count})</span>}
      {right && <div className="ml-auto">{right}</div>}
    </div>
  )
}

// サマリーストリップの1枚。value は開いた瞬間に見たい数字、sub は注意情報(重複/未送信 等)。
function Metric({ label, value, sub, subClass }: { label: string; value: React.ReactNode; sub?: string; subClass?: string }) {
  return (
    <Card>
      <CardContent className="px-3 py-2.5">
        <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="text-lg font-mono font-bold leading-tight">
          {value}
          {sub && <span className={`ml-1.5 text-[10px] font-normal ${subClass || "text-muted-foreground"}`}>{sub}</span>}
        </p>
      </CardContent>
    </Card>
  )
}

export function MatterDetailPage() {
  const { matterId } = useParams()
  const navigate = useNavigate()
  const { push } = useToast()
  const { vendors, issues, refreshIssues } = useAppData()

  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [edit, setEdit] = React.useState<any>({})
  // 閲覧主体UI: 案件情報の編集フォームは普段は畳んでおく。
  const [editOpen, setEditOpen] = React.useState(false)

  // sub-forms
  const [newIssue, setNewIssue] = React.useState({ backlog_issue_key: "", relation: "related" })
  const [attachDoc, setAttachDoc] = React.useState("")
  const [absorbId, setAbsorbId] = React.useState("")
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [showLines, setShowLines] = React.useState(false)
  // Backlog統合: 束ねた課題(重複/誤起票)を Request 側でも実際に統合する。
  const [mergeSel, setMergeSel] = React.useState<string[]>([])
  const [mergeOpen, setMergeOpen] = React.useState(false)
  const [mergeTarget, setMergeTarget] = React.useState("")
  const [mergeMode, setMergeMode] = React.useState<"child" | "delete">("child")
  const [mergeMoveData, setMergeMoveData] = React.useState(true)
  const [mergeReason, setMergeReason] = React.useState("")
  const [merging, setMerging] = React.useState(false)
  // 文書の送信: 送信方法の選択(メール/クラウドサイン) → 各フォーム。課題詳細と同じ二択に統一。
  const [chooserDoc, setChooserDoc] = React.useState<any>(null)
  // 文書のメール送信(案件ページから直接送る)
  const [emailDoc, setEmailDoc] = React.useState<any>(null)
  const [emailTo, setEmailTo] = React.useState("")
  const [emailCc, setEmailCc] = React.useState("")
  const [emailSending, setEmailSending] = React.useState(false)
  // クラウドサインは署名者ルート等の課題コンテキストが必要なため、課題詳細の
  // 送信モーダルをディープリンク(?cloudsign=文書番号)で開く。Drive 上のPDFがある正本のみ。
  const isDrivePdf = (link?: string | null) => {
    const dl = String(link || "")
    return /\/file\/d\/[a-zA-Z0-9_-]+/.test(dl) || /(drive|docs)\.google\.com/.test(dl)
  }
  const openCloudSignFor = (d: any) => {
    if (!d?.issue_key || !d?.document_number) return
    navigate(`/issues/${encodeURIComponent(d.issue_key)}?cloudsign=${encodeURIComponent(d.document_number)}`)
  }

  // issueKey → Backlog課題(件名/本文/ステータス) 参照（Request 一覧から）
  const issueByKey = React.useMemo(() => {
    const map: Record<string, any> = {}
    for (const i of (issues as any[]) || []) map[i.issueKey] = i
    return map
  }, [issues])
  const vendorCodeById = (vid: any) =>
    (vendors as any[])?.find((v) => v.id === vid)?.vendor_code || ""

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/matters/${matterId}`)
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || "取得失敗")
      setData(json)
      setEdit({
        title: json.matter.title || "",
        status: json.matter.status || "open",
        counterparty: json.matter.counterparty || "",
        vendor_id: json.matter.vendor_id ?? null,
        primary_issue_key: json.matter.primary_issue_key || "",
        remarks: json.matter.remarks || "",
      })
    } catch (e: any) {
      push(String(e?.message || e), "error")
    } finally {
      setLoading(false)
    }
  }, [matterId, push])

  React.useEffect(() => {
    load()
  }, [load])

  async function call(path: string, opts?: RequestInit, okMsg?: string) {
    const res = await fetch(path, opts)
    const json = await res.json().catch(() => ({}))
    if (!json?.ok) throw new Error(json?.error || `${res.status}`)
    if (okMsg) push(okMsg, "success")
    return json
  }

  async function saveHeader() {
    setSaving(true)
    try {
      await call(`/api/matters/${matterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edit),
      }, "案件を更新しました")
      setEditOpen(false)
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    } finally {
      setSaving(false)
    }
  }

  // ヘッダーのステータスはその場で即保存(編集フォームを開かずに変えたいケースが大半)。
  async function changeStatus(next: string) {
    try {
      await call(`/api/matters/${matterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      }, "ステータスを更新しました")
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  async function addIssue() {
    if (!newIssue.backlog_issue_key.trim()) return push("Request を選択してください", "error")
    try {
      await call(`/api/matters/${matterId}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newIssue,
          summary_snapshot: issueByKey[newIssue.backlog_issue_key]?.summary || null,
        }),
      }, "課題を束ねました")
      setNewIssue({ backlog_issue_key: "", relation: "related" })
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  async function removeIssue(key: string) {
    try {
      await call(`/api/matters/${matterId}/issues/${encodeURIComponent(key)}`, { method: "DELETE" })
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  async function attachDocument() {
    if (!attachDoc.trim()) return push("文書番号を入力してください", "error")
    try {
      await call(`/api/matters/${matterId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_number: attachDoc.trim() }),
      }, "文書を紐付けました")
      setAttachDoc("")
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  async function detachDocument(docId: number) {
    try {
      await call(`/api/matters/${matterId}/documents/${docId}`, { method: "DELETE" })
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  async function absorb() {
    const from = Number(absorbId)
    if (!from) return push("取り込む案件IDを入力してください", "error")
    if (!window.confirm(`案件 #${from} の課題・文書・送信履歴をこの案件へ取り込み、#${from} を削除します。よろしいですか？`)) return
    try {
      await call(`/api/matters/${matterId}/absorb`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromMatterId: from }),
      }, "案件を統合しました")
      setAbsorbId("")
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  // 統合先の既定は代表課題(mockup: 1クリック統合)。
  const primaryKey =
    data?.matter?.primary_issue_key ||
    data?.issues?.find((i: any) => i.relation === "primary")?.backlog_issue_key ||
    ""

  // Backlog統合の実行本体(クイック実行/ダイアログの両方から呼ぶ)。
  //   worker 側で matters/matter_issues も同期されるため、完了後に再読込するだけでよい。
  async function runMerge(target: string, mode: "child" | "delete", moveData: boolean, reason: string) {
    const t = target.trim().toUpperCase()
    if (!t) return push("統合先の課題を選択してください", "error")
    const sources = mergeSel.filter((k) => k.toUpperCase() !== t)
    if (sources.length === 0) return push("統合元がありません(統合先と同じものは除外されます)", "error")
    setMerging(true)
    try {
      const json = await call(`/api/backlog/issues/merge-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_key: t,
          source_keys: sources,
          mode,
          move_data: moveData,
          reason: reason.trim() || undefined,
        }),
      })
      push(
        `${json.merged}/${json.total} 件を ${t} へ統合しました${json.failed ? `（失敗 ${json.failed} 件）` : ""}`,
        json.failed ? "error" : "success"
      )
      setMergeOpen(false)
      setMergeSel([])
      await Promise.all([load(), refreshIssues?.()])
    } catch (e: any) {
      push(`統合に失敗しました: ${e?.message || e}`, "error")
    } finally {
      setMerging(false)
    }
  }

  // 統合バーの1クリック統合(既定: 代表課題へ子課題化＋終結・文書引き継ぎ)。
  function quickMerge() {
    if (!primaryKey) return openMergeDialog()
    const sources = mergeSel.filter((k) => k.toUpperCase() !== primaryKey.toUpperCase())
    if (sources.length === 0) return push("統合元がありません(代表課題は統合先になります)", "error")
    if (!window.confirm(`${sources.join(", ")} を ${primaryKey} へ統合します（子課題化＋終結・文書等は引き継ぎ）。よろしいですか？`)) return
    runMerge(primaryKey, "child", true, "")
  }

  function openMergeDialog() {
    setMergeTarget(primaryKey)
    setMergeMode("child")
    setMergeMoveData(true)
    setMergeReason("")
    setMergeOpen(true)
  }

  // メール送信: 文書を取引先へ送る(宛先空欄なら取引先の主担当)。送信履歴にも自動記録される。
  function openEmail(d: any) {
    setEmailDoc(d)
    setEmailTo("")
    setEmailCc("")
  }

  async function sendEmailNow() {
    if (!emailDoc?.document_number) return
    setEmailSending(true)
    try {
      const body: any = {}
      const to = emailTo.split(",").map((s) => s.trim()).filter(Boolean)
      const cc = emailCc.split(",").map((s) => s.trim()).filter(Boolean)
      if (to.length) body.to = to
      if (cc.length) body.cc = cc
      const json = await call(
        `/api/documents/${encodeURIComponent(emailDoc.document_number)}/email/send`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      )
      push(
        `メール送信しました: ${(json.to || []).join(", ")}` +
          (json.cc?.length ? ` / CC: ${json.cc.join(", ")}` : "") +
          (json.attached ? "（PDF添付）" : "（本文リンクのみ）"),
        "success"
      )
      setEmailDoc(null)
      await load()
    } catch (e: any) {
      push(`メール送信に失敗: ${e?.message || e}`, "error")
    } finally {
      setEmailSending(false)
    }
  }

  async function deleteMatter() {
    if (!window.confirm("この案件を削除します（課題の束ねは解除、文書は案件から外れます）。よろしいですか？")) return
    try {
      await call(`/api/matters/${matterId}`, { method: "DELETE" })
      push("案件を削除しました", "success")
      navigate("/matters")
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  // 送信済み文書ID(送信バッジ/未送信メトリクス用)。
  const sentDocIds = React.useMemo(() => {
    const s = new Set<number>()
    for (const x of data?.sends || []) if (x.status === "sent" && x.document_id != null) s.add(Number(x.document_id))
    return s
  }, [data])
  const lastSendByDoc = React.useMemo(() => {
    const m: Record<number, any> = {}
    for (const x of data?.sends || []) {
      const id = Number(x.document_id)
      if (!m[id] || new Date(x.sent_at) > new Date(m[id].sent_at)) m[id] = x
    }
    return m
  }, [data])

  // 条件明細サマリ(受取/支払の金額合計と率課金の行数)。
  const condSummary = React.useMemo(() => {
    const cs = data?.conditions || []
    let recv = 0, pay = 0, recvN = 0, payN = 0, rateN = 0
    for (const c of cs) {
      const amt = c.amount_ex_tax != null ? Number(c.amount_ex_tax) : null
      if (c.rate_pct != null && amt == null) rateN++
      if (c.direction === "receivable") { recvN++; if (amt) recv += amt }
      else { payN++; if (amt) pay += amt }
    }
    return { recv, pay, recvN, payN, rateN, total: cs.length }
  }, [data])

  // アクティビティ: 送信履歴・文書作成・課題の束ね(統合)を1本の時系列に統合。
  const activity = React.useMemo(() => {
    if (!data) return []
    const docById: Record<number, any> = {}
    for (const d of data.documents || []) docById[d.id] = d
    const ev: { ts: string; icon: any; cls: string; text: string; sub?: string }[] = []
    for (const s of data.sends || [])
      ev.push({
        ts: s.sent_at,
        icon: Mail,
        cls: s.status === "sent" ? "text-sky-600" : "text-red-600",
        text: `${docById[Number(s.document_id)]?.document_number || `文書#${s.document_id}`} を${s.channel === "email" ? "メール" : s.channel}送信`,
        sub: [s.recipient, s.subject].filter(Boolean).join(" · ") || undefined,
      })
    for (const d of data.documents || [])
      if (d.created_at)
        ev.push({ ts: d.created_at, icon: FilePlus, cls: "text-emerald-600", text: `${d.document_number || `#${d.id}`} を作成` })
    for (const i of data.issues || [])
      if (i.created_at)
        ev.push({
          ts: i.created_at,
          icon: i.relation === "duplicate" ? GitMerge : Layers,
          cls: i.relation === "duplicate" ? "text-red-600" : "text-muted-foreground",
          text: `${i.backlog_issue_key} を束ね（${RELATION_LABEL[i.relation] || i.relation}）`,
          sub: i.note || undefined,
        })
    return ev
      .filter((e) => e.ts)
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, 10)
  }, [data])

  if (loading || !data) {
    return (
      <div className="px-3 py-10 text-center text-[12px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />読み込み中…
      </div>
    )
  }

  const m = data.matter
  const dupCount = (data.issues || []).filter((i: any) => i.relation === "duplicate").length
  const unsentCount = (data.documents || []).filter((d: any) => !sentDocIds.has(Number(d.id))).length
  const lastSentAt = (data.sends || []).reduce(
    (acc: string | null, s: any) => (!acc || new Date(s.sent_at) > new Date(acc) ? s.sent_at : acc),
    null
  )

  return (
    <div className="space-y-4 max-w-5xl">
      <Button variant="ghost" size="sm" onClick={() => navigate("/matters")}>
        <ArrowLeft className="h-3.5 w-3.5 mr-1" /> 案件一覧
      </Button>

      {/* ヘッダー: 閲覧主体。ステータスは即保存、その他の編集は鉛筆で編集パネルを開く。 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <span className="font-mono text-[11px] text-muted-foreground">{m.matter_code || `#${m.id}`}</span>
              <div className="flex items-center gap-2 mt-0.5">
                <h2 className="text-lg font-mono font-bold leading-snug truncate">{m.title}</h2>
                <button
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => setEditOpen((v) => !v)}
                  title="案件情報を編集"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-muted-foreground mt-1.5">
                <span>相手方: {m.counterparty || "—"}</span>
                {primaryKey && (
                  <button
                    className="font-mono text-sky-700 hover:underline"
                    onClick={() => navigate(`/issues/${encodeURIComponent(primaryKey)}`)}
                  >
                    {primaryKey}（代表）
                  </button>
                )}
                <span>更新 {fmtDate(m.updated_at)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <NativeSelect
                value={m.status}
                onChange={(e: any) => changeStatus(e.target.value)}
                className="h-8 text-[12px] w-28"
                title="案件ステータス（即保存）"
              >
                {STATUS_OPTS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </NativeSelect>
              <Button
                size="sm"
                onClick={() =>
                  primaryKey
                    ? navigate(`/issues/${encodeURIComponent(primaryKey)}`)
                    : push("代表課題が未設定です。編集から設定してください", "error")
                }
                title="代表課題の課題詳細から文書を作成"
              >
                <FilePlus className="h-3.5 w-3.5 mr-1" /> 文書作成
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 編集パネル(普段は畳む)。案件削除・案件統合などの低頻度操作もここへ。 */}
      {editOpen && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1 md:col-span-2">
                <Label className="text-[12px]">案件名</Label>
                <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className="h-8 text-[12px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-[12px]">相手方（取引先マスタから検索）</Label>
                <VendorSearchSelect
                  vendors={vendors}
                  selectedCode={vendorCodeById(edit.vendor_id)}
                  onSelect={(v: any) =>
                    setEdit({ ...edit, vendor_id: v?.id ?? null, counterparty: v?.vendor_name ?? "" })
                  }
                />
                {edit.counterparty && (
                  <p className="text-[11px] text-muted-foreground">選択中: {edit.counterparty}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-[12px]">代表 Backlog 課題（Request から検索）</Label>
                <IssuePicker
                  issues={issues as any}
                  value={edit.primary_issue_key || undefined}
                  onSelect={(i) => setEdit({ ...edit, primary_issue_key: i?.issueKey ?? "" })}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-[12px]">備考</Label>
                <Textarea value={edit.remarks} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} className="text-[12px] min-h-[60px]" />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-dashed border-border">
              <span className="text-[11px] text-muted-foreground">重複案件の統合:</span>
              <Input value={absorbId} onChange={(e) => setAbsorbId(e.target.value)} placeholder="取り込む案件ID (例: 12)" className="h-8 text-[12px] max-w-[160px]" />
              <Button size="sm" variant="outline" onClick={absorb}>
                <GitMerge className="h-3.5 w-3.5 mr-1" /> 取り込む
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <Button variant="destructive" size="sm" onClick={deleteMatter}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> 案件削除
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>閉じる</Button>
                <Button size="sm" onClick={saveHeader} disabled={saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}保存
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* サマリーストリップ: 開いた瞬間に「何が残っているか」を出す。 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric
          label="課題"
          value={data.issues.length}
          sub={dupCount ? `重複${dupCount}` : undefined}
          subClass="text-red-600"
        />
        <Metric
          label="文書"
          value={data.documents.length}
          sub={unsentCount ? `未送信${unsentCount}` : undefined}
          subClass="text-amber-600"
        />
        <Metric
          label="条件明細"
          value={condSummary.total}
          sub={condSummary.recv ? `受取 ${yen(condSummary.recv)}` : undefined}
        />
        <Metric label="最終送信" value={fmtDate(lastSentAt)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4 items-start">
        {/* 左カラム: 日常操作(課題の統合・文書の送信) */}
        <div className="space-y-4 min-w-0">
          {/* 課題（束ね + Backlog統合） */}
          <Card>
            <CardContent className="p-4">
              <SectionHead icon={Layers} label="Backlog課題" count={data.issues.length} />
              <div className="space-y-1.5 mb-2">
                {data.issues.length === 0 && <p className="text-[12px] text-muted-foreground">課題が紐付いていません。</p>}
                {data.issues.map((iss: any) => {
                  const bl = issueByKey[iss.backlog_issue_key]
                  const body = bl?.description
                  const isOpen = !!expanded[iss.backlog_issue_key]
                  const isPrimaryRow = iss.backlog_issue_key === primaryKey
                  return (
                    <div key={iss.id} className="border border-border/60 rounded-sm">
                      <div className="flex items-center gap-2 text-[12px] px-2.5 py-1.5">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-foreground cursor-pointer disabled:opacity-30"
                          disabled={isPrimaryRow}
                          checked={mergeSel.includes(iss.backlog_issue_key)}
                          onChange={() =>
                            setMergeSel((prev) =>
                              prev.includes(iss.backlog_issue_key)
                                ? prev.filter((k) => k !== iss.backlog_issue_key)
                                : [...prev, iss.backlog_issue_key]
                            )
                          }
                          title={isPrimaryRow ? "代表課題は統合先になります" : "Backlog統合の対象に選択"}
                        />
                        <button
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                          disabled={!body}
                          onClick={() => setExpanded((p) => ({ ...p, [iss.backlog_issue_key]: !isOpen }))}
                          title={body ? "Backlog 内容を表示" : "Backlog 本文なし"}
                        >
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
                        </button>
                        <Badge variant={RELATION_VARIANT[iss.relation] || "secondary"} className="text-[10px]">
                          {RELATION_LABEL[iss.relation] || iss.relation}
                        </Badge>
                        <button className="font-mono text-sky-700 hover:underline" onClick={() => navigate(`/issues/${encodeURIComponent(iss.backlog_issue_key)}`)}>
                          {iss.backlog_issue_key}
                        </button>
                        <span className="text-muted-foreground truncate flex-1">{iss.summary_snapshot || bl?.summary || ""}</span>
                        {bl?.status?.name && <Badge variant="outline" className="text-[10px] shrink-0">{bl.status.name}</Badge>}
                        <button className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeIssue(iss.backlog_issue_key)} title="束ねを解除">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {isOpen && body && (
                        <div className="border-t border-border/50 bg-muted/30 px-3 py-2">
                          <p className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
                            {body}
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* 統合バー: チェックで出現。既定は代表課題へ1クリック統合。 */}
              {mergeSel.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap mb-2 rounded-sm border border-border bg-muted/30 px-3 py-2 text-[12px]">
                  <span><span className="font-semibold">{mergeSel.length}</span>件選択中</span>
                  {primaryKey ? (
                    <span className="text-muted-foreground">
                      統合先: <span className="font-mono">{primaryKey}</span>（代表）
                    </span>
                  ) : (
                    <span className="text-muted-foreground">統合先はオプションで指定</span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setMergeSel([])}>解除</Button>
                    <Button size="sm" variant="outline" onClick={openMergeDialog}>オプション…</Button>
                    <Button size="sm" onClick={quickMerge} disabled={merging} className="gap-1.5">
                      <GitMerge className="h-3.5 w-3.5" />
                      {merging ? "統合中…" : "Backlog統合"}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <IssuePicker
                  issues={issues as any}
                  value={newIssue.backlog_issue_key || undefined}
                  onSelect={(i) => setNewIssue({ ...newIssue, backlog_issue_key: i?.issueKey ?? "" })}
                  className="flex-1 max-w-[280px]"
                />
                <NativeSelect value={newIssue.relation} onChange={(e: any) => setNewIssue({ ...newIssue, relation: e.target.value })} className="h-8 text-[12px] w-28">
                  <option value="related">関連</option>
                  <option value="primary">代表</option>
                  <option value="duplicate">重複</option>
                  <option value="partial">部分発生</option>
                </NativeSelect>
                <Button size="sm" variant="outline" onClick={addIssue}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> 束ねる
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 文書（送信ボタン直付け + 最終送信情報） */}
          <Card>
            <CardContent className="p-4">
              <SectionHead icon={FileText} label="文書" count={data.documents.length} />
              <div className="space-y-1.5 mb-3">
                {data.documents.length === 0 && <p className="text-[12px] text-muted-foreground">紐付く文書がありません。</p>}
                {data.documents.map((d: any) => {
                  const sent = sentDocIds.has(Number(d.id))
                  const last = lastSendByDoc[Number(d.id)]
                  return (
                    <div key={d.id} className="border border-border/60 rounded-sm px-2.5 py-2">
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className="font-mono font-medium">{d.document_number || `#${d.id}`}</span>
                        <Badge variant="outline" className="text-[10px]">{d.template_type}</Badge>
                        <Badge variant={sent ? "success" : "secondary"} className="text-[10px]">
                          {sent ? "送信済" : "未送信"}
                        </Badge>
                        {d.contract_status && <span className="text-muted-foreground truncate">{d.contract_status}</span>}
                        <div className="ml-auto flex items-center gap-2 shrink-0">
                          {d.document_number && (
                            <button
                              className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline"
                              onClick={() => setChooserDoc(d)}
                              title="取引先へ送信（メール / クラウドサイン。送信履歴に自動記録）"
                            >
                              <Send className="h-3 w-3" /> 送信
                            </button>
                          )}
                          {d.drive_link && (
                            <a href={d.drive_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline">
                              <ExternalLink className="h-3 w-3" /> Drive
                            </a>
                          )}
                          {d.issue_key && (
                            <button className="text-[11px] text-sky-700 hover:underline" onClick={() => navigate(`/issues/${encodeURIComponent(d.issue_key)}`)}>
                              編集
                            </button>
                          )}
                          <button className="text-muted-foreground hover:text-destructive" onClick={() => detachDocument(d.id)} title="案件から外す">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {last && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          最終送信 {fmtDateTime(last.sent_at)}{last.recipient ? ` · ${last.recipient}` : ""}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center gap-2">
                <Input value={attachDoc} onChange={(e) => setAttachDoc(e.target.value)} placeholder="文書番号で紐付け (例: PO-2026-00001)" className="h-8 text-[12px] max-w-[280px]" />
                <Button size="sm" variant="outline" onClick={attachDocument}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> 紐付け
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 右カラム: サマリー(条件明細・アクティビティ・備考) */}
        <div className="space-y-4 min-w-0">
          <Card>
            <CardContent className="p-4">
              <SectionHead
                icon={ListChecks}
                label="条件明細"
                count={condSummary.total}
                right={
                  condSummary.total > 0 ? (
                    <button className="text-[11px] text-sky-700 hover:underline" onClick={() => setShowLines((v) => !v)}>
                      {showLines ? "サマリーに戻す" : "明細を表示"}
                    </button>
                  ) : undefined
                }
              />
              {condSummary.total === 0 ? (
                <p className="text-[12px] text-muted-foreground">条件明細がありません。</p>
              ) : !showLines ? (
                <div className="text-[12px]">
                  <div className="flex items-center justify-between py-1.5 border-b border-border/40">
                    <span className="text-muted-foreground">受取（{condSummary.recvN}行）</span>
                    <span className="font-mono font-medium tabular-nums">{condSummary.recv ? yen(condSummary.recv) : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-border/40">
                    <span className="text-muted-foreground">支払（{condSummary.payN}行）</span>
                    <span className="font-mono font-medium tabular-nums">{condSummary.pay ? yen(condSummary.pay) : "—"}</span>
                  </div>
                  {condSummary.rateN > 0 && (
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-muted-foreground">率課金（金額なし）</span>
                      <span className="font-mono font-medium tabular-nums">{condSummary.rateN}行</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {data.conditions.map((cl: any) => (
                    <div key={cl.id} className="flex items-center gap-2 text-[12px] border-b border-border/40 py-1.5">
                      <button className="font-mono text-sky-700 hover:underline" onClick={() => cl.line_code && navigate(`/condition-lines/${encodeURIComponent(cl.line_code)}`)}>
                        {cl.line_code || `#${cl.id}`}
                      </button>
                      <Badge variant="outline" className="text-[10px]">{cl.direction === "receivable" ? "受取" : "支払"}</Badge>
                      {cl.condition_name && <span className="text-muted-foreground truncate">{cl.condition_name}</span>}
                      <span className="ml-auto tabular-nums">
                        {cl.rate_pct != null ? `${cl.rate_pct}%` : cl.amount_ex_tax != null ? yen(Number(cl.amount_ex_tax)) : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <SectionHead icon={History} label="アクティビティ" />
              {activity.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">まだ動きがありません。</p>
              ) : (
                <div>
                  {activity.map((e, i) => {
                    const Icon = e.icon
                    return (
                      <div key={i} className="flex items-start gap-2.5 py-1.5 border-b border-border/40 last:border-b-0">
                        <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${e.cls}`} />
                        <div className="min-w-0 text-[12px]">
                          <p className="leading-snug break-words">{e.text}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {fmtDateTime(e.ts)}{e.sub ? ` · ${e.sub}` : ""}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <SectionHead
                icon={StickyNote}
                label="備考"
                right={
                  <button className="text-muted-foreground hover:text-foreground" onClick={() => setEditOpen(true)} title="備考を編集">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                }
              />
              {m.remarks ? (
                <p className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">{m.remarks}</p>
              ) : (
                <p className="text-[12px] text-muted-foreground">備考はありません。</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Backlog統合ダイアログ(詳細オプション): 統合先変更・削除モード・引き継ぎ・理由 */}
      <Dialog open={mergeOpen} onOpenChange={(v) => !v && setMergeOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Backlog課題を統合（{mergeSel.length}件選択中）</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              重複/誤起票の課題を Backlog 上でも1つへ統合します。案件の束ね・文書・送信履歴も自動で統合先へ同期されます。
            </p>
            <div className="text-[10px] font-mono text-muted-foreground break-all">
              対象: {mergeSel.join(", ")}
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">統合先の課題（残す側）</Label>
              <NativeSelect value={mergeTarget} onChange={(e: any) => setMergeTarget(e.target.value)} className="h-8 text-[12px]">
                <option value="">選択してください</option>
                {(data?.issues || []).map((iss: any) => (
                  <option key={iss.backlog_issue_key} value={iss.backlog_issue_key}>
                    {iss.backlog_issue_key}
                    {iss.relation === "primary" ? "（代表）" : ""} {iss.summary_snapshot || ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">選択課題の処理</Label>
              <NativeSelect value={mergeMode} onChange={(e: any) => setMergeMode(e.target.value as "child" | "delete")} className="h-8 text-[12px]">
                <option value="child">子課題化＋終結（非破壊・推奨）</option>
                <option value="delete">Backlog から削除（不可逆）</option>
              </NativeSelect>
              <p className="text-[10px] text-muted-foreground">
                {mergeMode === "delete"
                  ? "選択課題は完全に削除されます。統合先にコメントのみ残ります。"
                  : "選択課題を統合先の子課題にし「終結」にします。履歴が残ります。"}
              </p>
            </div>
            <label className="flex items-center gap-2 text-[11px]">
              <input type="checkbox" checked={mergeMoveData} onChange={(e) => setMergeMoveData(e.target.checked)} />
              紐づく文書・明細を統合先へ引き継ぐ（推奨。外すと統合元に残ります）
            </label>
            <div className="space-y-1">
              <Label className="text-[11px]">理由（任意）</Label>
              <Input value={mergeReason} onChange={(e) => setMergeReason(e.target.value)} placeholder="重複起票のため 等" className="h-8 text-[12px]" />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMergeOpen(false)} disabled={merging}>キャンセル</Button>
            <Button
              size="sm"
              onClick={() => {
                if (mergeMode === "delete" && !window.confirm(`選択した課題を Backlog から削除して ${mergeTarget} に統合します。\nこの操作は元に戻せません。よろしいですか？`)) return
                runMerge(mergeTarget, mergeMode, mergeMoveData, mergeReason)
              }}
              disabled={merging}
              className="gap-1.5"
            >
              <GitMerge className="h-3.5 w-3.5" />
              {merging ? "統合中…" : "統合を実行"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 送信方法の選択(メール / クラウドサイン) — 課題詳細と同じ二択 */}
      <Dialog open={!!chooserDoc} onOpenChange={(v) => !v && setChooserDoc(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>送信方法を選択</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-2.5">
            <div className="text-xs font-mono text-muted-foreground">
              {chooserDoc?.template_type} {chooserDoc?.document_number}
            </div>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() => {
                const d = chooserDoc
                setChooserDoc(null)
                openEmail(d)
              }}
            >
              ✉ メールで送信
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              disabled={!chooserDoc?.issue_key || !isDrivePdf(chooserDoc?.drive_link)}
              onClick={() => {
                const d = chooserDoc
                setChooserDoc(null)
                openCloudSignFor(d)
              }}
            >
              ✍ クラウドサインで送信
            </Button>
            {(!chooserDoc?.issue_key || !isDrivePdf(chooserDoc?.drive_link)) && (
              <p className="text-[10px] font-mono text-muted-foreground">
                ※ クラウドサインは課題に紐付き、Drive 上に PDF がある正本のみ送信できます（課題画面の送信フォームが開きます）。
              </p>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* メール送信ダイアログ */}
      <Dialog open={!!emailDoc} onOpenChange={(v) => !v && setEmailDoc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>メール送信: {emailDoc?.document_number}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              文書を取引先へメール送信します（PDF添付・失敗時は本文リンクのみ）。送信結果はこの案件の送信履歴に記録されます。
            </p>
            <div className="space-y-1">
              <Label className="text-[11px]">宛先（空欄なら取引先の主担当。複数はカンマ区切り）</Label>
              <Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="a@example.com, b@example.com" className="h-8 text-[12px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">CC（任意。複数はカンマ区切り）</Label>
              <Input value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="cc@example.com" className="h-8 text-[12px]" />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEmailDoc(null)} disabled={emailSending}>キャンセル</Button>
            <Button size="sm" onClick={sendEmailNow} disabled={emailSending} className="gap-1.5">
              <Send className="h-3.5 w-3.5" />
              {emailSending ? "送信中…" : "送信する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
