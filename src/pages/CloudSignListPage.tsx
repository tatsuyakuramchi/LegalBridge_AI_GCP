import * as React from "react"
import { RefreshCw, Loader2, Inbox, ExternalLink, FlaskConical, PenLine } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"
import { useAppData } from "@/src/context/AppDataContext"

// クラウドサイン: 送信一覧(履歴) + 未送信(CS対象なのに未送信の文書)タブ。
type CsRequest = {
  id: number
  document_number: string | null
  capability_id: number | null
  template_type: string | null
  cloudsign_document_id: string | null
  status: string
  title: string | null
  participants: any
  is_test: boolean
  signed_drive_link: string | null
  error: string | null
  created_by: string | null
  sent_at: string | null
  completed_at: string | null
  created_at: string | null
}

type Unsent = {
  document_number: string | null
  template_type: string | null
  issue_key: string | null
  drive_link: string | null
  created_at: string | null
  contract_title: string | null
  vendor_name: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "下書き", cls: "bg-muted text-muted-foreground" },
  sending: { label: "送信中", cls: "bg-amber-500/15 text-amber-600" },
  sent: { label: "締結待ち", cls: "bg-indigo-500/15 text-indigo-600" },
  completed: { label: "締結済み", cls: "bg-emerald-600 text-white" },
  declined: { label: "却下", cls: "bg-red-500/15 text-red-600" },
  canceled: { label: "取消", cls: "bg-muted text-muted-foreground line-through" },
  error: { label: "エラー", cls: "bg-red-600 text-white" },
}

const fmt = (v: string | null) =>
  v ? new Date(v).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "—"

function emails(participants: any): string {
  try {
    const arr = typeof participants === "string" ? JSON.parse(participants) : participants
    if (!Array.isArray(arr)) return "—"
    return arr.map((p: any) => p?.email).filter(Boolean).join(", ") || "—"
  } catch {
    return "—"
  }
}

export function CloudSignListPage() {
  const { showNotification } = useAppData()
  const [tab, setTab] = React.useState<"sent" | "unsent">("sent")
  const [q, setQ] = React.useState("")

  // 送信一覧(履歴)
  const [rows, setRows] = React.useState<CsRequest[]>([])
  const [loading, setLoading] = React.useState(true)
  const [statusFilter, setStatusFilter] = React.useState<string | null>(null)

  // 未送信
  const [unsent, setUnsent] = React.useState<Unsent[]>([])
  const [unsentLoading, setUnsentLoading] = React.useState(true)

  // 送信ダイアログ
  const [csDoc, setCsDoc] = React.useState<Unsent | null>(null)
  const [csName, setCsName] = React.useState("")
  const [csEmail, setCsEmail] = React.useState("")
  const [csSending, setCsSending] = React.useState(false)

  const loadSent = React.useCallback(() => {
    setLoading(true)
    fetch("/api/cloudsign/requests", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])
  const loadUnsent = React.useCallback(() => {
    setUnsentLoading(true)
    fetch("/api/cloudsign/unsent", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setUnsent(Array.isArray(d) ? d : []))
      .catch(() => setUnsent([]))
      .finally(() => setUnsentLoading(false))
  }, [])
  const reload = React.useCallback(() => {
    loadSent()
    loadUnsent()
  }, [loadSent, loadUnsent])
  React.useEffect(() => {
    reload()
  }, [reload])

  const sendCloudSign = async () => {
    if (!csDoc?.document_number) return
    setCsSending(true)
    try {
      const participants = csEmail.trim()
        ? [{ name: csName.trim() || csDoc.vendor_name || "署名者", email: csEmail.trim(), order: 1 }]
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
      reload()
    } catch (e: any) {
      showNotification(`送信に失敗しました: ${e?.message || e}`, "error")
    } finally {
      setCsSending(false)
    }
  }

  const buckets = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.status, (m.get(r.status) || 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [rows])

  const filtered = rows.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false
    const s = q.trim().toLowerCase()
    if (s) {
      const hay = `${r.title || ""} ${r.document_number || ""} ${emails(r.participants)}`.toLowerCase()
      if (!hay.includes(s)) return false
    }
    return true
  })
  const unsentFiltered = unsent.filter((u) => {
    const s = q.trim().toLowerCase()
    if (!s) return true
    return `${u.contract_title || ""} ${u.document_number || ""} ${u.vendor_name || ""}`
      .toLowerCase()
      .includes(s)
  })

  const TABS: [typeof tab, string][] = [
    ["sent", `送信一覧 (${rows.length})`],
    ["unsent", `未送信 (${unsent.length})`],
  ]

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto space-y-5">
      <header className="flex items-end justify-between gap-6 border-b border-border pb-5">
        <div>
          <p className="retro-tag mb-1.5">CLOUDSIGN · SEND</p>
          <h2 className="text-2xl font-mono font-bold tracking-tight">クラウドサイン送信</h2>
          <p className="text-xs font-mono text-muted-foreground mt-1.5">
            送信・締結状況（一覧）と、CS対象なのに未送信の文書（未送信）。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-60">
            <Input
              type="search"
              placeholder="件名 / 文書番号 / 取引先…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9"
            />
          </div>
          <button
            type="button"
            onClick={reload}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-[11px] font-mono font-bold uppercase tracking-[0.14em] hover:bg-muted"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading || unsentLoading ? "animate-spin" : ""}`} /> 更新
          </button>
        </div>
      </header>

      {/* タブ */}
      <nav className="flex items-center gap-1 border-b border-border">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "px-4 py-2.5 text-[11px] font-mono font-bold uppercase tracking-[0.16em] border-b-2 -mb-px transition-colors",
              tab === key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ── 送信一覧 ── */}
      {tab === "sent" && (
        <>
          <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono uppercase tracking-[0.14em]">
            <button
              type="button"
              onClick={() => setStatusFilter(null)}
              className={`px-2 py-1 rounded-sm border ${statusFilter === null ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground"}`}
            >
              ALL ({rows.length})
            </button>
            {buckets.map(([name, n]) => (
              <button
                key={name}
                type="button"
                onClick={() => setStatusFilter(statusFilter === name ? null : name)}
                className={`px-2 py-1 rounded-sm border ${statusFilter === name ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground"}`}
              >
                {STATUS[name]?.label || name} ({n})
              </button>
            ))}
          </div>

          {loading ? (
            <div className="p-16 text-center">
              <Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center border border-dashed border-border rounded-md">
              <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
              <p className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
                送信履歴がありません
              </p>
            </div>
          ) : (
            <div className="border border-border rounded-md overflow-hidden">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">件名 / 文書番号</th>
                    <th className="text-left px-3 py-2">宛先</th>
                    <th className="text-left px-3 py-2">状態</th>
                    <th className="text-left px-3 py-2">送信</th>
                    <th className="text-left px-3 py-2">締結</th>
                    <th className="text-left px-3 py-2">担当</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const st = STATUS[r.status] || { label: r.status, cls: "bg-muted text-muted-foreground" }
                    return (
                      <tr key={r.id} className="border-t border-border hover:bg-muted/40">
                        <td className="px-3 py-2 max-w-[280px]">
                          <div className="font-bold truncate">{r.title || "—"}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {r.document_number || "—"}
                            {r.is_test && (
                              <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-600">
                                <FlaskConical className="h-2.5 w-2.5" /> TEST
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 max-w-[220px] truncate text-muted-foreground">
                          {emails(r.participants)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="default" className={st.cls}>
                            {st.label}
                          </Badge>
                          {r.status === "error" && r.error && (
                            <div className="text-[10px] text-red-600 truncate max-w-[180px]" title={r.error}>
                              {r.error}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tab-mono">{fmt(r.sent_at)}</td>
                        <td className="px-3 py-2 text-muted-foreground tab-mono">{fmt(r.completed_at)}</td>
                        <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px]">{r.created_by || "—"}</td>
                        <td className="px-3 py-2 text-right">
                          {r.signed_drive_link && (
                            <a
                              href={r.signed_drive_link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-6 w-6 items-center justify-center border border-border rounded-sm hover:bg-muted text-muted-foreground"
                              title="締結済みPDF"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── 未送信(CS対象・PDFあり・未送信) ── */}
      {tab === "unsent" && (
        <>
          {unsentLoading ? (
            <div className="p-16 text-center">
              <Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" />
            </div>
          ) : unsentFiltered.length === 0 ? (
            <div className="p-16 text-center border border-dashed border-border rounded-md">
              <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
              <p className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
                未送信の対象文書はありません
              </p>
            </div>
          ) : (
            <div className="border border-border rounded-md overflow-hidden">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">件名 / 文書番号</th>
                    <th className="text-left px-3 py-2">取引先</th>
                    <th className="text-left px-3 py-2">種類</th>
                    <th className="text-left px-3 py-2">作成日</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {unsentFiltered.map((u) => (
                    <tr key={u.document_number} className="border-t border-border hover:bg-muted/40">
                      <td className="px-3 py-2 max-w-[300px]">
                        <div className="font-bold truncate">{u.contract_title || u.document_number || "—"}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {u.document_number || "—"}
                          {u.issue_key ? ` · ${u.issue_key}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[180px]">{u.vendor_name || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{u.template_type || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground tab-mono">{fmt(u.created_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setCsDoc(u)
                            setCsName("")
                            setCsEmail("")
                          }}
                          className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors border border-border hover:border-foreground px-2 py-1 rounded-sm"
                          title="クラウドサインで送信"
                        >
                          <PenLine className="h-3 w-3" />
                          送信
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* 送信ダイアログ */}
      <Dialog open={!!csDoc} onOpenChange={(v) => !v && setCsDoc(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>クラウドサインで送信</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="text-xs font-mono text-muted-foreground leading-relaxed">
              文書:{" "}
              <span className="font-bold text-foreground">
                {csDoc?.contract_title || csDoc?.document_number || "—"}
              </span>
              <br />
              取引先: {csDoc?.vendor_name || "—"}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">署名者 氏名（任意）</Label>
              <Input value={csName} onChange={(e) => setCsName(e.target.value)} placeholder={csDoc?.vendor_name || "山田 太郎"} />
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
              ※ 設定で「許可宛先」を設定中は、その宛先（社内テスト用）のみ送信できます。
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
