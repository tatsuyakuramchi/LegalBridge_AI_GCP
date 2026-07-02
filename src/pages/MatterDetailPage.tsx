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
  Send,
  Layers,
  ListChecks,
  ExternalLink,
  GitMerge,
  Mail,
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
import { ChevronDown, ChevronRight as ChevronRightIcon } from "lucide-react"

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

function SectionHead({ icon: Icon, label, count }: { icon: any; label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-[12px] font-semibold uppercase tracking-wide">{label}</span>
      {count != null && <span className="text-[11px] text-muted-foreground">({count})</span>}
    </div>
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

  // sub-forms
  const [newIssue, setNewIssue] = React.useState({ backlog_issue_key: "", relation: "related" })
  const [attachDoc, setAttachDoc] = React.useState("")
  const [absorbId, setAbsorbId] = React.useState("")
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  // Backlog統合: 束ねた課題(重複/誤起票)を Request 側でも実際に統合する。
  const [mergeSel, setMergeSel] = React.useState<string[]>([])
  const [mergeOpen, setMergeOpen] = React.useState(false)
  const [mergeTarget, setMergeTarget] = React.useState("")
  const [mergeMode, setMergeMode] = React.useState<"child" | "delete">("child")
  const [mergeMoveData, setMergeMoveData] = React.useState(true)
  const [mergeReason, setMergeReason] = React.useState("")
  const [merging, setMerging] = React.useState(false)
  // 文書のメール送信(案件ページから直接送る)
  const [emailDoc, setEmailDoc] = React.useState<any>(null)
  const [emailTo, setEmailTo] = React.useState("")
  const [emailCc, setEmailCc] = React.useState("")
  const [emailSending, setEmailSending] = React.useState(false)

  // issueKey → Backlog課題(件名/本文) 参照（Request 一覧から）
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
      await load()
    } catch (e: any) {
      push(String(e?.message || e), "error")
    } finally {
      setSaving(false)
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

  // Backlog統合: 選択した課題を統合先(既定=代表課題)へ実統合する。
  //   worker 側で matters/matter_issues も同期されるため、完了後に再読込するだけでよい。
  function openMerge() {
    const primary =
      data?.matter?.primary_issue_key ||
      data?.issues?.find((i: any) => i.relation === "primary")?.backlog_issue_key ||
      ""
    setMergeTarget(primary)
    setMergeMode("child")
    setMergeMoveData(true)
    setMergeReason("")
    setMergeOpen(true)
  }

  async function doMerge() {
    const target = mergeTarget.trim().toUpperCase()
    if (!target) return push("統合先の課題を選択してください", "error")
    const sources = mergeSel.filter((k) => k.toUpperCase() !== target)
    if (sources.length === 0) return push("統合元がありません(統合先と同じものは除外されます)", "error")
    if (
      mergeMode === "delete" &&
      !window.confirm(`選択した ${sources.length} 件を Backlog から削除して ${target} に統合します。\nこの操作は元に戻せません。よろしいですか？`)
    )
      return
    setMerging(true)
    try {
      const json = await call(`/api/backlog/issues/merge-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_key: target,
          source_keys: sources,
          mode: mergeMode,
          move_data: mergeMoveData,
          reason: mergeReason.trim() || undefined,
        }),
      })
      push(
        `${json.merged}/${json.total} 件を ${target} へ統合しました${json.failed ? `（失敗 ${json.failed} 件）` : ""}`,
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

  if (loading || !data) {
    return (
      <div className="px-3 py-10 text-center text-[12px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />読み込み中…
      </div>
    )
  }

  const m = data.matter

  return (
    <div className="space-y-4 max-w-4xl">
      <Button variant="ghost" size="sm" onClick={() => navigate("/matters")}>
        <ArrowLeft className="h-3.5 w-3.5 mr-1" /> 案件一覧
      </Button>

      {/* Header / edit */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">{m.matter_code || `#${m.id}`}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[12px]">案件名</Label>
              <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className="h-8 text-[12px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">ステータス</Label>
              <NativeSelect value={edit.status} onChange={(e: any) => setEdit({ ...edit, status: e.target.value })} className="h-8 text-[12px]">
                {STATUS_OPTS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </NativeSelect>
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
          <div className="flex items-center justify-between">
            <Button variant="destructive" size="sm" onClick={deleteMatter}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> 案件削除
            </Button>
            <Button size="sm" onClick={saveHeader} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}保存
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 課題（束ね） */}
      <Card>
        <CardContent className="p-4">
          <SectionHead icon={Layers} label="束ねた Backlog 課題" count={data.issues.length} />
          <div className="space-y-1.5 mb-3">
            {data.issues.length === 0 && <p className="text-[12px] text-muted-foreground">課題が紐付いていません。</p>}
            {data.issues.map((iss: any) => {
              const bl = issueByKey[iss.backlog_issue_key]
              const body = bl?.description
              const isOpen = !!expanded[iss.backlog_issue_key]
              return (
                <div key={iss.id} className="border border-border/60 rounded-sm">
                  <div className="flex items-center gap-2 text-[12px] px-2.5 py-1.5">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-foreground cursor-pointer"
                      checked={mergeSel.includes(iss.backlog_issue_key)}
                      onChange={() =>
                        setMergeSel((prev) =>
                          prev.includes(iss.backlog_issue_key)
                            ? prev.filter((k) => k !== iss.backlog_issue_key)
                            : [...prev, iss.backlog_issue_key]
                        )
                      }
                      title="Backlog統合の対象に選択"
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
                    <span className="text-muted-foreground truncate">{iss.summary_snapshot || bl?.summary || ""}</span>
                    {bl?.status?.name && <Badge variant="outline" className="text-[10px]">{bl.status.name}</Badge>}
                    <button className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => removeIssue(iss.backlog_issue_key)}>
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
            {mergeSel.length > 0 && (
              <Button size="sm" variant="outline" onClick={openMerge} className="gap-1.5" title="選択した課題を Backlog 上でも1つに統合する">
                <GitMerge className="h-3.5 w-3.5" />
                Backlog統合（{mergeSel.length}件）
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Backlog統合ダイアログ: 選択課題を統合先へ実統合(案件側も自動同期) */}
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
              紐づく文書・明細も統合先へ付け替える（中身がある場合）
            </label>
            <div className="space-y-1">
              <Label className="text-[11px]">理由（任意）</Label>
              <Input value={mergeReason} onChange={(e) => setMergeReason(e.target.value)} placeholder="重複起票のため 等" className="h-8 text-[12px]" />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMergeOpen(false)} disabled={merging}>キャンセル</Button>
            <Button size="sm" onClick={doMerge} disabled={merging} className="gap-1.5">
              <GitMerge className="h-3.5 w-3.5" />
              {merging ? "統合中…" : "統合を実行"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 文書 */}
      <Card>
        <CardContent className="p-4">
          <SectionHead icon={FileText} label="文書" count={data.documents.length} />
          <div className="space-y-1.5 mb-3">
            {data.documents.length === 0 && <p className="text-[12px] text-muted-foreground">紐付く文書がありません。</p>}
            {data.documents.map((d: any) => (
              <div key={d.id} className="flex items-center gap-2 text-[12px] border border-border/60 rounded-sm px-2.5 py-1.5">
                <span className="font-mono">{d.document_number || `#${d.id}`}</span>
                <Badge variant="outline" className="text-[10px]">{d.template_type}</Badge>
                {d.contract_status && <span className="text-muted-foreground">{d.contract_status}</span>}
                {d.drive_link && (
                  <a href={d.drive_link} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline inline-flex items-center gap-0.5">
                    <ExternalLink className="h-3 w-3" />Drive
                  </a>
                )}
                {d.issue_key && (
                  <button className="text-sky-700 hover:underline" onClick={() => navigate(`/issues/${encodeURIComponent(d.issue_key)}`)}>
                    編集
                  </button>
                )}
                {d.document_number && (
                  <button
                    className="text-sky-700 hover:underline inline-flex items-center gap-0.5"
                    onClick={() => openEmail(d)}
                    title="取引先へメール送信（送信履歴に自動記録）"
                  >
                    <Mail className="h-3 w-3" />
                    メール送信
                  </button>
                )}
                <button className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => detachDocument(d.id)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input value={attachDoc} onChange={(e) => setAttachDoc(e.target.value)} placeholder="文書番号で紐付け (例: PO-2026-00001)" className="h-8 text-[12px] max-w-[280px]" />
            <Button size="sm" variant="outline" onClick={attachDocument}>
              <Plus className="h-3.5 w-3.5 mr-1" /> 紐付け
            </Button>
          </div>
        </CardContent>
      </Card>

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

      {/* 条件明細 */}
      <Card>
        <CardContent className="p-4">
          <SectionHead icon={ListChecks} label="条件明細（文書経由）" count={data.conditions.length} />
          {data.conditions.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">条件明細がありません。</p>
          ) : (
            <div className="space-y-1">
              {data.conditions.map((cl: any) => (
                <div key={cl.id} className="flex items-center gap-2 text-[12px] border-b border-border/40 py-1.5">
                  <button className="font-mono text-sky-700 hover:underline" onClick={() => cl.line_code && navigate(`/condition-lines/${encodeURIComponent(cl.line_code)}`)}>
                    {cl.line_code || `#${cl.id}`}
                  </button>
                  <Badge variant="secondary" className="text-[10px]">{cl.payment_scheme}</Badge>
                  <Badge variant="outline" className="text-[10px]">{cl.direction === "receivable" ? "受取" : "支払"}</Badge>
                  {cl.condition_name && <span className="text-muted-foreground truncate">{cl.condition_name}</span>}
                  <span className="ml-auto tabular-nums">
                    {cl.rate_pct != null ? `${cl.rate_pct}%` : cl.amount_ex_tax != null ? `¥${Number(cl.amount_ex_tax).toLocaleString()}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 送信履歴 */}
      <Card>
        <CardContent className="p-4">
          <SectionHead icon={Send} label="送信履歴" count={data.sends.length} />
          {data.sends.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">送信履歴がありません。</p>
          ) : (
            <div className="space-y-1">
              {data.sends.map((s: any) => (
                <div key={s.id} className="flex items-center gap-2 text-[12px] border-b border-border/40 py-1.5">
                  <Badge variant="outline" className="text-[10px]">{s.channel}</Badge>
                  <Badge variant={s.status === "sent" ? "success" : "destructive"} className="text-[10px]">{s.status}</Badge>
                  <span className="text-muted-foreground">{s.recipient || "—"}</span>
                  {s.subject && <span className="truncate">{s.subject}</span>}
                  <span className="ml-auto text-muted-foreground tabular-nums">
                    {s.sent_at ? new Date(s.sent_at).toLocaleString("ja-JP") : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 統合 */}
      <Card>
        <CardContent className="p-4">
          <SectionHead icon={GitMerge} label="重複案件の統合" />
          <p className="text-[11px] text-muted-foreground mb-2">
            別案件の課題・文書・送信履歴をこの案件へ取り込み、取り込み元を削除します。
          </p>
          <div className="flex items-center gap-2">
            <Input value={absorbId} onChange={(e) => setAbsorbId(e.target.value)} placeholder="取り込む案件ID (例: 12)" className="h-8 text-[12px] max-w-[180px]" />
            <Button size="sm" variant="outline" onClick={absorb}>
              <GitMerge className="h-3.5 w-3.5 mr-1" /> 取り込む
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
