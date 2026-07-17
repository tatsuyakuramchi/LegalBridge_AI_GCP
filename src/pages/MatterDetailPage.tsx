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
  AlertTriangle,
  CheckCircle2,
  Circle,
  Star,
  Flag,
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
import { matterClient } from "@/src/lib/api/matterClient"
import { apiRequest } from "@/src/lib/api/httpClient"
import { useMatterMergeCart } from "@/src/context/MatterMergeCartContext"
import { VendorSearchSelect } from "@/src/components/document/VendorSearchSelect"
import { StaffPicker } from "@/src/components/cloudsign/StaffPicker"
import { IssuePicker } from "@/src/components/IssuePicker"
import {
  MATTER_STAGES,
  STAGE_LABEL,
  stageLabel,
} from "@/src/components/matter/matterStages"

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
// 格納した契約書ファイル(添付)の種別ラベル。documents.template_type に格納した値の表示名。
const ATTACH_KIND_LABEL: Record<string, string> = {
  counterparty_draft: "相手方ドラフト",
  own_draft: "自社ドラフト",
  reference: "参考資料",
}

const fmtDate = (s: any) =>
  s ? new Date(s).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) : "—"
const fmtDateTime = (s: any) =>
  s ? new Date(s).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""
const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`

function SectionHead({ icon: Icon, label, count, right }: { icon: any; label: string; count?: number; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <Icon className="h-[18px] w-[18px] text-muted-foreground" />
      <span className="text-[13.5px] font-mono font-bold">{label}</span>
      {count != null && <span className="text-[12px] text-muted-foreground">({count})</span>}
      {right && <div className="ml-auto">{right}</div>}
    </div>
  )
}

// サマリーストリップの1枚。value は開いた瞬間に見たい数字、sub は注意情報(重複/未送信 等)。
function Metric({ label, value, sub, subClass }: { label: string; value: React.ReactNode; sub?: string; subClass?: string }) {
  return (
    <Card>
      <CardContent className="px-3 py-2.5">
        <p className="text-[11px] font-mono text-muted-foreground">{label}</p>
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
  const mergeCart = useMatterMergeCart()
  const { vendors, issues, refreshIssues, staffList } = useAppData()

  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [edit, setEdit] = React.useState<any>({})
  // 閲覧主体UI: 案件情報の編集フォームは普段は畳んでおく。
  const [editOpen, setEditOpen] = React.useState(false)

  // sub-forms
  const [newIssue, setNewIssue] = React.useState({ backlog_issue_key: "", relation: "related" })
  const [attachDoc, setAttachDoc] = React.useState("")
  // 契約書ファイルの格納(アップロード): 相手方原案/自社案/参考資料を Drive へ保管し案件に紐付け。
  const [attachFile, setAttachFile] = React.useState<File | null>(null)
  const [attachKind, setAttachKind] = React.useState("counterparty_draft")
  const [attachTitle, setAttachTitle] = React.useState("")
  const [uploading, setUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [absorbId, setAbsorbId] = React.useState("")
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  // LB-05: タスク追加フォーム(次アクションパネル内)。
  const [taskFormOpen, setTaskFormOpen] = React.useState(false)
  const [taskSaving, setTaskSaving] = React.useState(false)
  const [newTask, setNewTask] = React.useState<{
    title: string
    assignee_staff_id: number | null
    due_at: string
    is_primary: boolean
  }>({ title: "", assignee_staff_id: null, due_at: "", is_primary: false })
  // タスク一覧の展開(既定は未完了のみ表示し、完了分は畳む)。
  const [showDoneTasks, setShowDoneTasks] = React.useState(false)
  // LB-08: Drive 案件フォルダの後付け作成(既存案件・作成失敗時の修復)。
  const [creatingFolder, setCreatingFolder] = React.useState(false)
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
  // メール送信: 取引先引用(検索→連絡先メール自動補完)。
  const [emailVendorCode, setEmailVendorCode] = React.useState("")
  const [emailContactIdx, setEmailContactIdx] = React.useState(0)
  const [emailContacts, setEmailContacts] = React.useState<any[]>([])
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
      const json: any = await matterClient.get(matterId)
      setData(json)
      setEdit({
        title: json.matter.title || "",
        status: json.matter.status || "open",
        counterparty: json.matter.counterparty || "",
        vendor_id: json.matter.vendor_id ?? null,
        primary_issue_key: json.matter.primary_issue_key || "",
        remarks: json.matter.remarks || "",
        // LB-04: 工程 / 担当 / 期限 / ブロッカー(migration 0126)
        lifecycle_stage: json.matter.lifecycle_stage || "",
        owner_staff_id: json.matter.owner_staff_id ?? null,
        target_due_date: json.matter.target_due_date
          ? String(json.matter.target_due_date).slice(0, 10)
          : "",
        blocked_reason: json.matter.blocked_reason || "",
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

  // matterClient を呼び、成功時に okMsg をトーストする薄いラッパ。
  //   (旧 call(path, opts, okMsg) の okMsg 表示挙動を踏襲する。)
  async function run<T>(p: Promise<T>, okMsg?: string): Promise<T> {
    const json = await p
    if (okMsg) push(okMsg, "success")
    return json
  }

  async function saveHeader() {
    setSaving(true)
    try {
      await run(matterClient.update(matterId, edit), "案件を更新しました")
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
      await run(matterClient.update(matterId, { status: next }), "ステータスを更新しました")
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  // LB-04: 工程(lifecycle_stage)もヘッダーから即保存で切り替える。空 = 未設定。
  async function changeStage(next: string) {
    try {
      await run(matterClient.update(matterId, { lifecycle_stage: next || null }), "工程を更新しました")
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  // LB-08 (§7): Drive 案件フォルダ(YYYY/MTR-…_相手方_案件名 + 標準サブフォルダ)を
  //   後付けで作成する。新規案件は作成時に自動生成されるため、これは既存案件・
  //   生成失敗時の修復用。
  async function createDriveFolder() {
    setCreatingFolder(true)
    try {
      await run(matterClient.createDriveFolder(matterId), "Drive 案件フォルダを作成しました")
      await load()
    } catch (e: any) {
      push(`フォルダ作成に失敗: ${e?.message || e}`, "error")
    } finally {
      setCreatingFolder(false)
    }
  }

  // ── LB-05: タスク(次アクション) CRUD ────────────────────────────────────────
  async function addTask() {
    if (!newTask.title.trim()) return push("タスク名を入力してください", "error")
    setTaskSaving(true)
    try {
      await run(matterClient.addTask(matterId, {
        title: newTask.title.trim(),
        assignee_staff_id: newTask.assignee_staff_id,
        due_at: newTask.due_at || null,
        is_primary: newTask.is_primary,
      }), "タスクを追加しました")
      setNewTask({ title: "", assignee_staff_id: null, due_at: "", is_primary: false })
      setTaskFormOpen(false)
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    } finally {
      setTaskSaving(false)
    }
  }

  async function updateTask(taskId: number, patch: Record<string, any>, okMsg?: string) {
    try {
      await run(matterClient.updateTask(matterId, taskId, patch), okMsg)
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  async function deleteTask(taskId: number) {
    if (!window.confirm("このタスクを削除します。よろしいですか？")) return
    try {
      await matterClient.deleteTask(matterId, taskId)
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  async function addIssue() {
    if (!newIssue.backlog_issue_key.trim()) return push("Request を選択してください", "error")
    try {
      await run(matterClient.addIssue(matterId, {
        ...newIssue,
        summary_snapshot: issueByKey[newIssue.backlog_issue_key]?.summary || null,
      }), "課題を束ねました")
      setNewIssue({ backlog_issue_key: "", relation: "related" })
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  async function removeIssue(key: string) {
    try {
      await matterClient.removeIssue(matterId, key)
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  async function attachDocument() {
    if (!attachDoc.trim()) return push("文書番号を入力してください", "error")
    try {
      await run(matterClient.attachDocument(matterId, { document_number: attachDoc.trim() }), "文書を紐付けました")
      setAttachDoc("")
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  async function uploadAttachment() {
    if (!attachFile) return push("ファイルを選択してください", "error")
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", attachFile)
      fd.append("docKind", attachKind)
      if (attachTitle.trim()) fd.append("title", attachTitle.trim())
      // FormData を渡すと httpClient は Content-Type を付けない
      // (ブラウザが multipart boundary を設定する)。
      await run(matterClient.uploadAttachment(matterId, fd), "契約書を格納しました")
      setAttachFile(null)
      setAttachTitle("")
      if (fileInputRef.current) fileInputRef.current.value = ""
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    } finally {
      setUploading(false)
    }
  }

  async function detachDocument(docId: number) {
    try {
      await matterClient.detachDocument(matterId, docId)
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    }
  }

  async function absorb() {
    const from = Number(absorbId)
    if (!from) return push("取り込む案件IDを入力してください", "error")
    if (!window.confirm(`案件 #${from} の課題・タスク・文書・ファイル・送信履歴・Driveフォルダをこの案件へ取り込み、#${from} を削除します。よろしいですか？`)) return
    try {
      const json: any = await matterClient.absorb(matterId, { fromMatterId: from })
      const mv = json?.moved || {}
      const parts = [
        mv.issues ? `課題${mv.issues}` : "",
        mv.tasks ? `タスク${mv.tasks}` : "",
        mv.documents ? `文書${mv.documents}` : "",
        mv.files ? `ファイル${mv.files}` : "",
      ].filter(Boolean)
      const folderMsg =
        json?.folder?.action === "adopted"
          ? " / Driveフォルダを引き継ぎ"
          : json?.folder?.action === "moved"
          ? " / Driveフォルダを統合先へ移動"
          : json?.folder?.action === "failed"
          ? " / Driveフォルダ移動は失敗(手動で確認してください)"
          : ""
      push(
        `案件を統合しました${parts.length ? `（${parts.join("・")}）` : ""}${folderMsg}`,
        json?.folder?.action === "failed" ? "error" : "success"
      )
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
      const json: any = await apiRequest(`/api/backlog/issues/merge-bulk`, {
        method: "POST",
        body: {
          target_key: t,
          source_keys: sources,
          mode,
          move_data: moveData,
          reason: reason.trim() || undefined,
        },
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

  // 取引先の連絡先配列から主担当の index を返す(無ければ先頭)。
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
  // 取引先を選択したら連絡先を読み込み、主担当メールを宛先に自動補完する。
  const applyEmailVendor = async (v: any) => {
    if (!v) {
      setEmailVendorCode("")
      setEmailContacts([])
      setEmailContactIdx(0)
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
  }

  // メール送信: 文書を取引先へ送る(宛先空欄なら取引先の主担当)。送信履歴にも自動記録される。
  //   開いた時点で案件の取引先(vendor_id)を自動選択し、主担当メールを宛先に補完する。
  function openEmail(d: any) {
    setEmailDoc(d)
    setEmailTo("")
    setEmailCc("")
    setEmailVendorCode("")
    setEmailContactIdx(0)
    setEmailContacts([])
    // 文書自身の vendor_id を優先し、無ければ案件の vendor_id を使う。
    const vid = d?.vendor_id ?? data?.matter?.vendor_id ?? edit.vendor_id
    const v = vid != null ? (vendors as any[])?.find((x) => x.id === vid) : null
    if (v) void applyEmailVendor(v)
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
      const json: any = await apiRequest(
        `/api/documents/${encodeURIComponent(emailDoc.document_number)}/email/send`,
        { method: "POST", body }
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
      await matterClient.remove(matterId)
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
  // LB-05: タスク(次アクション)。API は primary優先 → 未完了 → 期限昇順で返す。
  const tasks: any[] = data.tasks || []
  const primaryTask =
    tasks.find(
      (t) => t.is_primary && (t.status === "open" || t.status === "in_progress")
    ) || null
  const openTasks = tasks.filter((t) => t.status === "open" || t.status === "in_progress")
  const doneTasks = tasks.filter((t) => t.status === "done" || t.status === "cancelled")
  const isPastDue = (v: any) =>
    !!v && !["closed", "archived"].includes(m.status) && new Date(v).getTime() < Date.now()
  const dupCount = (data.issues || []).filter((i: any) => i.relation === "duplicate").length
  const unsentCount = (data.documents || []).filter((d: any) => !sentDocIds.has(Number(d.id))).length
  const lastSentAt = (data.sends || []).reduce(
    (acc: string | null, s: any) => (!acc || new Date(s.sent_at) > new Date(acc) ? s.sent_at : acc),
    null
  )

  return (
    <div className="px-6 py-6 max-w-[1100px] mx-auto space-y-5">
      <Button variant="ghost" size="sm" onClick={() => navigate("/matters")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> 案件一覧に戻る
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
                {/* LB-08 (§7): 案件フォルダ。あればリンク、なければその場で作成。 */}
                {m.drive_folder_url ? (
                  <a
                    href={m.drive_folder_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-700 hover:underline inline-flex items-center gap-1"
                    title="Drive の案件フォルダを開く"
                  >
                    <ExternalLink className="h-3 w-3" /> Driveフォルダ
                  </a>
                ) : (
                  <button
                    className="text-sky-700 hover:underline disabled:opacity-50"
                    disabled={creatingFolder}
                    onClick={createDriveFolder}
                    title="Drive に案件フォルダ(YYYY/MTR-…_相手方_案件名 + 標準サブフォルダ)を作成して紐づけます"
                  >
                    {creatingFolder ? "フォルダ作成中…" : "＋Driveフォルダ作成"}
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* LB-04: 現在工程(詳細ステージ)。status とは別軸で即保存。 */}
              <NativeSelect
                value={m.lifecycle_stage || ""}
                onChange={(e: any) => changeStage(e.target.value)}
                className="h-8 text-[12px] w-36"
                title="現在工程（即保存）"
              >
                <option value="">工程: 未設定</option>
                {MATTER_STAGES.map((st) => (
                  <option key={st} value={st}>
                    {STAGE_LABEL[st]}
                  </option>
                ))}
              </NativeSelect>
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
                onClick={() => {
                  // LB-F01 (§5.5.1): 課題詳細を経由せず Document Editor へ直接遷移する。
                  //   matter_id + 代表課題をクエリで渡し、エディタ側が案件コンテキスト
                  //   (案件・依頼原票・取引先)を自動設定する(LB-F02)。
                  //   代表課題が未設定でも案件コンテキストだけで作成を開始できる。
                  const params = new URLSearchParams({ matter_id: String(m.id) })
                  if (primaryKey) params.set("issue_key", primaryKey)
                  navigate(`/documents/new?${params.toString()}`)
                }}
                title="この案件のコンテキストで文書を作成"
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
              {/* LB-04: 案件の担当 / 期限 / ブロッカー(工程はヘッダーの即保存セレクトで変更) */}
              <div className="space-y-1">
                <Label className="text-[12px]">案件担当者</Label>
                <NativeSelect
                  value={edit.owner_staff_id ?? ""}
                  onChange={(e: any) =>
                    setEdit({ ...edit, owner_staff_id: e.target.value ? Number(e.target.value) : null })
                  }
                  className="h-8 text-[12px]"
                >
                  <option value="">— 未設定 —</option>
                  {(staffList as any[])
                    .filter((s) => s.id != null)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.staff_name}
                        {s.department ? ` · ${s.department}` : ""}
                      </option>
                    ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label className="text-[12px]">目標期限</Label>
                <Input
                  type="date"
                  value={edit.target_due_date || ""}
                  onChange={(e) => setEdit({ ...edit, target_due_date: e.target.value })}
                  className="h-8 text-[12px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[12px]">ブロッカー（空欄 = ブロックなし）</Label>
                <Input
                  value={edit.blocked_reason || ""}
                  onChange={(e) => setEdit({ ...edit, blocked_reason: e.target.value })}
                  placeholder="例: 相手方の押印待ち"
                  className="h-8 text-[12px]"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-[12px]">備考</Label>
                <Textarea value={edit.remarks} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} className="text-[12px] min-h-[60px]" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-dashed border-border">
              <span className="text-[11px] text-muted-foreground">重複案件の統合:</span>
              {/* カート方式: この案件をカートへ入れ、他の重複案件も集めてから統合先を選ぶ */}
              <Button
                size="sm"
                variant={mergeCart.has(Number(matterId)) ? "default" : "outline"}
                onClick={() => {
                  const idNum = Number(matterId)
                  if (mergeCart.has(idNum)) {
                    mergeCart.remove(idNum)
                  } else {
                    mergeCart.add(
                      { id: idNum, matter_code: m.matter_code, title: m.title, counterparty: m.counterparty },
                      { openPanel: true }
                    )
                  }
                }}
              >
                <GitMerge className="h-3.5 w-3.5 mr-1" />
                {mergeCart.has(Number(matterId)) ? "統合カートに追加済み" : "統合カートに追加"}
              </Button>
              <span className="text-[11px] text-muted-foreground">または ID 指定:</span>
              <Input value={absorbId} onChange={(e) => setAbsorbId(e.target.value)} placeholder="取り込む案件ID (例: 12)" className="h-8 text-[12px] max-w-[140px]" />
              <Button size="sm" variant="outline" onClick={absorb}>
                取り込む
              </Button>
              <span className="text-[10px] text-muted-foreground w-full">
                カートに重複案件を集め、統合先(残す案件)を選んで一括統合できます。課題・タスク・文書・ファイル・送信履歴を引き継ぎ、統合元のDriveフォルダはこの案件のフォルダ配下へ移動（統合先にフォルダが無ければ引き継ぎ）します。
              </span>
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

      {/* 常設「次アクション」パネル (§5.4, LB-05):
          現在工程 / 次に行う操作 / 担当 / 期限 / ブロッカー を1か所に集約し、
          タスクの追加・完了・次アクション選定(is_primary)をここで行う。 */}
      <Card className={m.blocked_reason ? "border-destructive/50" : undefined}>
        <CardContent className="p-4 space-y-3">
          <SectionHead
            icon={ListChecks}
            label="次アクション"
            count={openTasks.length}
            right={
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTaskFormOpen((v) => !v)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> タスク追加
              </Button>
            }
          />

          {/* サマリー行: 工程 / 次アクション / 担当 / 期限 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <p className="text-[11px] font-mono text-muted-foreground">現在工程</p>
              <p className="text-[13px] font-mono font-bold flex items-center gap-1.5 mt-0.5">
                <Flag className="h-3.5 w-3.5 text-muted-foreground" />
                {stageLabel(m.lifecycle_stage)}
              </p>
            </div>
            <div className="md:col-span-2 min-w-0">
              <p className="text-[11px] font-mono text-muted-foreground">次に行う操作</p>
              {primaryTask ? (
                <p className="text-[13px] font-bold truncate mt-0.5" title={primaryTask.title}>
                  {primaryTask.title}
                </p>
              ) : (
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {openTasks.length > 0
                    ? "未選定（下のタスクの ☆ で次アクションに指定）"
                    : "未登録（「タスク追加」から登録）"}
                </p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-mono text-muted-foreground">担当</p>
              <p className="text-[12px] font-mono mt-0.5 truncate">
                {primaryTask?.assignee_name || m.owner_name || "—"}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-mono text-muted-foreground">期限</p>
              <p
                className={`text-[12px] font-mono mt-0.5 tabular-nums ${
                  isPastDue(primaryTask?.due_at || m.target_due_date)
                    ? "text-destructive font-bold"
                    : ""
                }`}
              >
                {fmtDate(primaryTask?.due_at || m.target_due_date)}
                {isPastDue(primaryTask?.due_at || m.target_due_date) && "（超過）"}
              </p>
            </div>
          </div>

          {/* ブロッカー(案件レベル)。解除は編集パネルから。 */}
          {m.blocked_reason && (
            <div className="flex items-start gap-2 rounded-sm border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-[12px]">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
              <span>
                <span className="font-bold text-destructive">ブロッカー: </span>
                {m.blocked_reason}
              </span>
            </div>
          )}

          {/* タスク追加フォーム */}
          {taskFormOpen && (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_130px_auto_auto] gap-2 items-end rounded-sm border border-border/60 bg-muted/30 p-2.5">
              <div className="space-y-1">
                <Label className="text-[11px]">タスク名 *</Label>
                <Input
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  placeholder="例: 発注書を受注者へ送付"
                  className="h-8 text-[12px]"
                  onKeyDown={(e) => e.key === "Enter" && addTask()}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">担当</Label>
                <NativeSelect
                  value={newTask.assignee_staff_id ?? ""}
                  onChange={(e: any) =>
                    setNewTask({
                      ...newTask,
                      assignee_staff_id: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="h-8 text-[12px]"
                >
                  <option value="">— 未設定 —</option>
                  {(staffList as any[])
                    .filter((s) => s.id != null)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.staff_name}
                      </option>
                    ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">期限</Label>
                <Input
                  type="date"
                  value={newTask.due_at}
                  onChange={(e) => setNewTask({ ...newTask, due_at: e.target.value })}
                  className="h-8 text-[12px]"
                />
              </div>
              <label className="flex items-center gap-1.5 text-[11px] font-mono pb-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-foreground"
                  checked={newTask.is_primary}
                  onChange={(e) => setNewTask({ ...newTask, is_primary: e.target.checked })}
                />
                次アクションに設定
              </label>
              <Button size="sm" onClick={addTask} disabled={taskSaving}>
                {taskSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}追加
              </Button>
            </div>
          )}

          {/* タスク一覧(未完了)。☆=次アクション指定、○→✓=完了。 */}
          {openTasks.length > 0 && (
            <div className="space-y-1">
              {openTasks.map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-sm border ${
                    t.is_primary ? "border-amber-500/60 bg-amber-500/10" : "border-border/60"
                  }`}
                >
                  <button
                    onClick={() => updateTask(t.id, { status: "done" }, "タスクを完了しました")}
                    className="text-muted-foreground hover:text-emerald-600 shrink-0"
                    title="完了にする"
                  >
                    <Circle className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() =>
                      updateTask(
                        t.id,
                        { is_primary: !t.is_primary },
                        t.is_primary ? "次アクション指定を解除しました" : "次アクションに設定しました"
                      )
                    }
                    className={`shrink-0 ${
                      t.is_primary ? "text-amber-500" : "text-muted-foreground hover:text-amber-500"
                    }`}
                    title={t.is_primary ? "次アクション指定を解除" : "次アクションに設定"}
                  >
                    <Star className="h-3.5 w-3.5" fill={t.is_primary ? "currentColor" : "none"} />
                  </button>
                  <span className="flex-1 min-w-0 truncate" title={t.title}>
                    {t.title}
                  </span>
                  {t.blocked_reason && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-destructive shrink-0" title={t.blocked_reason}>
                      <AlertTriangle className="h-3 w-3" /> ブロック
                    </span>
                  )}
                  {t.assignee_name && (
                    <span className="text-[11px] font-mono text-muted-foreground shrink-0">{t.assignee_name}</span>
                  )}
                  {t.due_at && (
                    <span
                      className={`text-[11px] font-mono tabular-nums shrink-0 ${
                        isPastDue(t.due_at) ? "text-destructive font-bold" : "text-muted-foreground"
                      }`}
                    >
                      〜{fmtDate(t.due_at)}
                    </span>
                  )}
                  <button
                    onClick={() => deleteTask(t.id)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    title="削除"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 完了済みタスク(畳み) */}
          {doneTasks.length > 0 && (
            <div>
              <button
                className="text-[11px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
                onClick={() => setShowDoneTasks((v) => !v)}
              >
                {showDoneTasks ? <ChevronDown className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
                完了済み {doneTasks.length} 件
              </button>
              {showDoneTasks && (
                <div className="space-y-1 mt-1">
                  {doneTasks.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 text-[12px] px-2.5 py-1 rounded-sm border border-border/40 text-muted-foreground">
                      <button
                        onClick={() => updateTask(t.id, { status: "open" }, "タスクを未完了に戻しました")}
                        className="text-emerald-600 shrink-0"
                        title="未完了に戻す"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                      <span className="flex-1 min-w-0 truncate line-through">{t.title}</span>
                      {t.completed_at && (
                        <span className="text-[11px] font-mono tabular-nums shrink-0">{fmtDate(t.completed_at)}</span>
                      )}
                      <button
                        onClick={() => deleteTask(t.id)}
                        className="hover:text-destructive shrink-0"
                        title="削除"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

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
                        <Badge variant="outline" className="text-[10px]">{ATTACH_KIND_LABEL[d.template_type] || d.template_type}</Badge>
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
              {/* 契約書ファイルを格納: 生ファイル(Word/PDF)を Drive へ保管し ATT 番号で案件に紐付け。 */}
              <div className="mt-2 pt-2 border-t border-border/50">
                <p className="text-[10px] text-muted-foreground mb-1.5">
                  契約書ファイルを格納（相手方原案 / 自社案 / 参考資料を Drive に保管し案件へ紐付け）
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={(e) => setAttachFile(e.target.files?.[0] || null)}
                    className="text-[11px] max-w-[220px] file:mr-2 file:rounded-sm file:border file:border-border file:bg-muted file:px-2 file:py-1 file:text-[11px]"
                  />
                  <NativeSelect value={attachKind} onChange={(e) => setAttachKind(e.target.value)} className="h-8 text-[12px] w-[132px]">
                    <option value="counterparty_draft">相手方ドラフト</option>
                    <option value="own_draft">自社ドラフト</option>
                    <option value="reference">参考資料</option>
                  </NativeSelect>
                  <Input value={attachTitle} onChange={(e) => setAttachTitle(e.target.value)} placeholder="表示名(任意)" className="h-8 text-[12px] max-w-[160px]" />
                  <Button size="sm" variant="outline" onClick={uploadAttachment} disabled={uploading || !attachFile}>
                    {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FilePlus className="h-3.5 w-3.5 mr-1" />}
                    格納
                  </Button>
                </div>
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
              <Label className="text-[11px]">取引先を検索（選択で送信先メールを自動補完）</Label>
              <VendorSearchSelect
                vendors={vendors}
                selectedCode={emailVendorCode}
                onSelect={(v) => void applyEmailVendor(v)}
                placeholder="取引先を検索（コード / 名称 / 屋号）"
                size="compact"
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
                  className="h-8 text-[12px]"
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
              <Label className="text-[11px]">宛先（空欄なら取引先の主担当。複数はカンマ区切り）</Label>
              <Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="a@example.com, b@example.com" className="h-8 text-[12px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">CC（任意。複数はカンマ区切り。設定の既定CCにも追加されます）</Label>
              <StaffPicker
                staff={staffList as any}
                placeholder="スタッフを検索して CC に追加（氏名 / メール / 部署）"
                onPick={(s) => {
                  if (!s.email) return
                  const cur = emailCc.split(",").map((x) => x.trim()).filter(Boolean)
                  if (!cur.includes(s.email)) setEmailCc([...cur, s.email].join(", "))
                }}
              />
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
