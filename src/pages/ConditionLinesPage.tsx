import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Search, Inbox, Loader2, ArrowRight, Trash2, RefreshCw, Bell } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { promptAndSendDocumentEmail } from "@/src/lib/emailSend"

// データ構造刷新 Phase F: 条件明細管理 UI(一覧)。
//   消化・残高・当期発行状況のコックピット。アラート cron が見ているのと同じ
//   導出ビューを人間も見る。明細番号(line_code)単位で詳細へ遷移。

type ConditionLine = {
  id: number
  line_code: string | null
  subject: string | null
  payment_scheme: string
  // 取引種別(統合Phase3): license=利用許諾 / product=物販 / service=委託
  transaction_kind: string | null
  direction: string
  status: string | null
  consumed_amount: number | null
  remaining_amount: number | null
  amount_ex_tax: number | null
  mg_remaining: number | null
  ag_remaining: number | null
  contract_title: string | null
  contract_number: string | null
  vendor_name: string | null
  has_overdue: boolean | null
  fulfilling_doc_number: string | null
  fulfilling_doc_count: number | null
  // 実績(検収/計算/支払)件数。0 のときだけ手動削除を許可する。
  event_count: number | null
  // 送信履歴(メール / CloudSign)。worker が付与。
  sent_at: string | null
  sent_channel: string | null
  email_to: string | null
  // 締結完了日時(締結済 → 「✅ 締結済」表示用)。
  cloudsign_completed_at: string | null
  // 未送信の CloudSign 下書き作成日時(下書保存運用の「送信準備中」表示用)。
  cloudsign_draft_at: string | null
  // メール送信対象の代表 検収書/計算書 文書番号(無ければ送信不可)。
  send_doc_number: string | null
  // A+C: 検収待ち / 期限超過(検収書未発行の支払明細)。worker が付与。
  inspection_pending: boolean | null
  inspection_overdue: boolean | null
}

// 一括/従量/分割 は 成就/一部成就/未成就、契約期間型(利用許諾) は 履行中/成就（満了）。
const STATUS_LABEL: Record<string, string> = {
  open: "未成就",
  partially_fulfilled: "一部成就",
  fulfilled: "成就",
  closed_short: "中途終了",
  cancelled: "取消",
  pending: "開始前",
  active: "履行中",
  expired: "成就（満了）",
}

function StatusBadge({ status }: { status: string | null }) {
  const s = status || "—"
  const cls =
    s === "fulfilled" || s === "expired" // 成就 / 成就（満了）= 完了
      ? "bg-emerald-600 text-white"
      : s === "partially_fulfilled" || s === "active"
        ? "bg-amber-500 text-white"
        : s === "cancelled" || s === "closed_short"
          ? "bg-muted text-muted-foreground line-through"
          : ""
  return (
    <Badge variant={cls ? "default" : "outline"} className={cls}>
      {STATUS_LABEL[s] || s}
    </Badge>
  )
}

// 取引種別バッジ(統合Phase3): license=利用許諾 / product=物販 / service=委託
const KIND_META: Record<string, { label: string; cls: string }> = {
  license: { label: "利用許諾", cls: "border-sky-300 text-sky-700" },
  product: { label: "物販", cls: "border-violet-300 text-violet-700" },
  service: { label: "委託", cls: "border-amber-300 text-amber-700" },
}
function KindBadge({ kind }: { kind: string }) {
  const m = KIND_META[kind]
  if (!m) return <span className="text-[10px] text-muted-foreground">{kind}</span>
  return (
    <Badge variant="outline" className={m.cls}>
      {m.label}
    </Badge>
  )
}

const yen = (v: any) =>
  v == null ? "—" : `¥${Number(v).toLocaleString("ja-JP")}`

// 並び替え対象列のアクセサと型。
const SORT_ACCESSORS: Record<
  string,
  { get: (r: ConditionLine) => any; type: "str" | "num" | "date" }
> = {
  line_code: { get: (r) => r.line_code, type: "str" },
  subject: { get: (r) => r.subject, type: "str" },
  contract: { get: (r) => `${r.contract_title || ""} ${r.vendor_name || ""}`.trim(), type: "str" },
  payment_scheme: { get: (r) => r.payment_scheme, type: "str" },
  direction: { get: (r) => r.direction, type: "str" },
  status: { get: (r) => r.status, type: "str" },
  fulfilling: { get: (r) => r.fulfilling_doc_number, type: "str" },
  sent_at: { get: (r) => r.sent_at, type: "date" },
  remaining: {
    get: (r) => (r.payment_scheme === "royalty" ? r.mg_remaining : r.remaining_amount),
    type: "num",
  },
  has_overdue: { get: (r) => (r.has_overdue ? 1 : 0), type: "num" },
}

function sortRows(
  list: ConditionLine[],
  sort: { key: string; dir: 1 | -1 } | null
): ConditionLine[] {
  if (!sort) return list
  const acc = SORT_ACCESSORS[sort.key]
  if (!acc) return list
  const d = sort.dir
  return [...list].sort((a, b) => {
    const av = acc.get(a)
    const bv = acc.get(b)
    const ae = av == null || av === ""
    const be = bv == null || bv === ""
    if (ae && be) return 0
    if (ae) return 1 // 空は末尾
    if (be) return -1
    if (acc.type === "num") return ((Number(av) || 0) - (Number(bv) || 0)) * d
    if (acc.type === "date") return (new Date(av).getTime() - new Date(bv).getTime()) * d
    return String(av).localeCompare(String(bv), "ja") * d
  })
}

// 送信時刻を JST の短い表記に。
const fmtSent = (iso: string | null): string => {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      timeZone: "Asia/Tokyo",
    })
  } catch {
    return iso
  }
}

export function ConditionLinesPage() {
  const navigate = useNavigate()
  const [rows, setRows] = React.useState<ConditionLine[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<string | null>(null)
  const [dirFilter, setDirFilter] = React.useState<string | null>(null)
  const [inspectionFilter, setInspectionFilter] = React.useState<"all" | "pending" | "overdue">("all")
  // 列の並び替え(クリックで昇順/降順トグル)。
  const [sort, setSort] = React.useState<{ key: string; dir: 1 | -1 } | null>(null)
  const toggleSort = (key: string) =>
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))

  const [syncing, setSyncing] = React.useState(false)
  const [digesting, setDigesting] = React.useState(false)

  // 検収待ち/期限超過を Slack に通知(日次ダイジェスト)。
  const sendInspectionDigest = async () => {
    if (digesting) return
    setDigesting(true)
    try {
      const res = await fetch("/api/management/inspection-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`)
      window.alert(`Slack 通知しました: 検収待ち ${d.total} 件 / 期限超過 ${d.overdue} 件`)
    } catch (e: any) {
      window.alert(`Slack 通知に失敗しました: ${e?.message || e}`)
    } finally {
      setDigesting(false)
    }
  }

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/condition-lines")
      const d = await r.json()
      setRows(Array.isArray(d) ? d : [])
    } catch {
      /* noop */
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  // CloudSign の送信/締結状態を一括取込(既存の送信済データに履歴を後付け)。
  const syncCloudSign = async () => {
    if (syncing) return
    if (!window.confirm("CloudSign の送信・締結状態を一括取込します。\n(本システム経由で送った書類の送信日時・締結日時を反映します)")) return
    setSyncing(true)
    try {
      const res = await fetch("/api/cloudsign/sync-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`)
      window.alert(`同期完了: 確認 ${d.checked} 件 / 更新 ${d.updated} 件${d.failed ? ` / 失敗 ${d.failed} 件` : ""}`)
      await load()
    } catch (e: any) {
      window.alert(`同期に失敗しました: ${e?.message || e}`)
    } finally {
      setSyncing(false)
    }
  }

  const statusBuckets = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const s = r.status || "—"
      m.set(s, (m.get(s) || 0) + 1)
    }
    return Array.from(m.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [rows])

  // A+C: 検収待ち / 期限超過の件数。
  const inspectionCounts = React.useMemo(() => {
    let pending = 0, overdue = 0
    for (const r of rows) {
      if (r.inspection_pending) pending++
      if (r.inspection_overdue) overdue++
    }
    return { pending, overdue }
  }, [rows])

  const filtered = rows.filter((r) => {
    if (statusFilter && (r.status || "—") !== statusFilter) return false
    if (dirFilter && r.direction !== dirFilter) return false
    if (inspectionFilter === "pending" && !r.inspection_pending) return false
    if (inspectionFilter === "overdue" && !r.inspection_overdue) return false
    const q = search.trim().toLowerCase()
    if (q) {
      const hay = `${r.line_code || ""} ${r.subject || ""} ${r.vendor_name || ""} ${r.contract_title || ""}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  const sorted = sortRows(filtered, sort)

  // 並び替え可能な見出しセル。
  const Th = ({
    sk,
    label,
    align = "left",
  }: {
    sk?: string
    label: string
    align?: "left" | "right" | "center"
  }) => {
    const alignCls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
    const ind = sk && sort?.key === sk ? (sort.dir === 1 ? " ▲" : " ▼") : ""
    return (
      <th
        className={`px-3 py-2 ${alignCls} ${sk ? "cursor-pointer select-none hover:text-foreground" : ""}`}
        onClick={sk ? () => toggleSort(sk) : undefined}
      >
        {label}
        {ind}
      </th>
    )
  }

  const open = (lineCode: string | null) => {
    if (lineCode) navigate(`/condition-lines/${encodeURIComponent(lineCode)}`)
  }

  // メール送信(検収書/計算書)。送信対象文書番号を持つ明細のみ。
  const [sendingDoc, setSendingDoc] = React.useState<string | null>(null)
  const sendRow = async (r: ConditionLine) => {
    if (!r.send_doc_number) return
    setSendingDoc(r.send_doc_number)
    const ok = await promptAndSendDocumentEmail(r.send_doc_number)
    setSendingDoc(null)
    if (ok) {
      setRows((rs) =>
        rs.map((x) =>
          x.id === r.id ? { ...x, sent_at: new Date().toISOString(), sent_channel: "メール" } : x,
        ),
      )
    }
  }

  // 重複・誤作成の整理: 実績(condition_events)が無い明細のみ物理削除できる。
  const [deletingId, setDeletingId] = React.useState<number | null>(null)
  const deleteLine = async (r: ConditionLine) => {
    if ((r.event_count || 0) > 0) return
    if (!window.confirm(`条件明細 ${r.line_code || r.id} を削除します。よろしいですか？\n(検収/計算実績が無い明細のみ削除できます)`)) return
    setDeletingId(r.id)
    try {
      const res = await fetch(`/api/condition-lines/${r.id}/delete`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        window.alert(data?.error || `削除に失敗しました (HTTP ${res.status})`)
        return
      }
      setRows((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e: any) {
      window.alert(`削除に失敗しました: ${e?.message || e}`)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="px-6 py-6 max-w-[1500px] mx-auto space-y-5">
      <header className="flex items-end justify-between gap-6 border-b border-border pb-5">
        <div>
          <p className="retro-tag mb-1.5">COND · LINES</p>
          <h2 className="text-2xl font-mono font-bold tracking-tight">条件明細</h2>
          <p className="text-xs font-mono text-muted-foreground mt-1.5">
            消化・残高・当期発行状況の運用コックピット（導出ビュー駆動）。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={syncCloudSign}
            disabled={syncing}
            title="CloudSign の送信・締結状態を一括取込して送信履歴に反映"
            className="flex items-center gap-1.5 px-3 py-2 rounded-sm border border-border text-[11px] font-mono text-muted-foreground hover:border-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "同期中…" : "送信履歴を同期"}
          </button>
          <button
            type="button"
            onClick={sendInspectionDigest}
            disabled={digesting}
            title="検収待ち/期限超過の件数を Slack に通知(日次ダイジェスト)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-sm border border-border text-[11px] font-mono text-muted-foreground hover:border-foreground disabled:opacity-50"
          >
            <Bell className={`h-3.5 w-3.5 ${digesting ? "animate-pulse" : ""}`} />
            {digesting ? "送信中…" : "検収待ちをSlack通知"}
          </button>
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="line_code / 件名 / 取引先…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
      </header>

      {/* フィルタチップ */}
      <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono uppercase tracking-[0.16em]">
        <span className="text-muted-foreground">Status:</span>
        <button
          type="button"
          onClick={() => setStatusFilter(null)}
          className={`px-2 py-1 rounded-sm border ${statusFilter === null ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground"}`}
        >
          ALL ({rows.length})
        </button>
        {statusBuckets.map((b) => (
          <button
            key={b.name}
            type="button"
            onClick={() => setStatusFilter(statusFilter === b.name ? null : b.name)}
            className={`px-2 py-1 rounded-sm border ${statusFilter === b.name ? "bg-emerald-600 text-white border-emerald-700" : "border-border text-muted-foreground hover:border-foreground"}`}
          >
            {STATUS_LABEL[b.name] || b.name} ({b.count})
          </button>
        ))}
        <span className="text-muted-foreground ml-3">Dir:</span>
        {["payable", "receivable"].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirFilter(dirFilter === d ? null : d)}
            className={`px-2 py-1 rounded-sm border ${dirFilter === d ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground"}`}
          >
            {d === "payable" ? "支払" : "受取"}
          </button>
        ))}
        <span className="text-muted-foreground ml-3">検収:</span>
        <button
          type="button"
          onClick={() => setInspectionFilter(inspectionFilter === "pending" ? "all" : "pending")}
          className={`px-2 py-1 rounded-sm border ${inspectionFilter === "pending" ? "bg-amber-500 text-white border-amber-600" : "border-border text-muted-foreground hover:border-foreground"}`}
        >
          検収待ち ({inspectionCounts.pending})
        </button>
        <button
          type="button"
          onClick={() => setInspectionFilter(inspectionFilter === "overdue" ? "all" : "overdue")}
          className={`px-2 py-1 rounded-sm border ${inspectionFilter === "overdue" ? "bg-red-600 text-white border-red-700" : inspectionCounts.overdue > 0 ? "border-red-400 text-red-600 hover:border-red-600" : "border-border text-muted-foreground hover:border-foreground"}`}
        >
          期限超過 ({inspectionCounts.overdue})
        </button>
      </div>

      {loading ? (
        <div className="p-16 text-center">
          <Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-16 text-center border border-dashed border-border rounded-md">
          <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
            条件明細がありません（新スキーマ未適用の可能性）。
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <Th sk="line_code" label="line_code" />
                <Th sk="subject" label="件名" />
                <Th sk="contract" label="契約 / 取引先" />
                <Th sk="payment_scheme" label="方式" />
                <Th sk="direction" label="向き" />
                <Th sk="status" label="状態" />
                <Th sk="fulfilling" label="成就文書" />
                <Th sk="sent_at" label="送信" />
                <Th sk="remaining" label="残額 / MG残" align="right" />
                <Th sk="has_overdue" label="当期" align="center" />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => open(r.line_code)}
                  className="border-t border-border hover:bg-muted/40 cursor-pointer"
                >
                  <td className="px-3 py-2 font-bold">{r.line_code || "—"}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate">{r.subject || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[220px]">
                    <div className="truncate">
                      {r.contract_title || "—"}
                      {r.vendor_name ? ` / ${r.vendor_name}` : ""}
                    </div>
                    {r.contract_number ? (
                      <div className="text-[10px] truncate">{r.contract_number}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {r.transaction_kind ? <KindBadge kind={r.transaction_kind} /> : null}
                    <div className="text-[10px] text-muted-foreground mt-0.5">{r.payment_scheme}</div>
                  </td>
                  <td className="px-3 py-2">{r.direction === "receivable" ? "受取" : "支払"}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[160px]">
                    {r.fulfilling_doc_number ? (
                      <span className="truncate inline-block max-w-full align-bottom">
                        {r.fulfilling_doc_number}
                        {r.fulfilling_doc_count && r.fulfilling_doc_count > 1 ? (
                          <span className="text-[10px] ml-1">ほか{r.fulfilling_doc_count - 1}件</span>
                        ) : null}
                      </span>
                    ) : r.inspection_overdue ? (
                      <Badge variant="outline" className="border-red-400 text-red-600">
                        検収待ち·超過
                      </Badge>
                    ) : r.inspection_pending ? (
                      <Badge variant="outline" className="border-amber-400 text-amber-700">
                        検収待ち
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td
                    className="px-3 py-2 max-w-[160px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.sent_at ? (
                      r.sent_channel === "メール" ? (
                        <div>
                          <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                            ✉ メール
                          </Badge>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{fmtSent(r.sent_at)}</div>
                          {r.email_to ? (
                            <div className="text-[10px] text-muted-foreground break-all">{r.email_to}</div>
                          ) : null}
                        </div>
                      ) : r.cloudsign_completed_at ? (
                        <div>
                          <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                            ✅ 締結済
                          </Badge>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{fmtSent(r.cloudsign_completed_at)}</div>
                        </div>
                      ) : (
                        <div>
                          <Badge variant="outline" className="border-sky-300 text-sky-700">
                            ✍ クラウドサイン
                          </Badge>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{fmtSent(r.sent_at)}</div>
                        </div>
                      )
                    ) : r.cloudsign_draft_at ? (
                      <div>
                        <Badge variant="outline" className="border-slate-300 text-slate-500">
                          ✍ 下書き
                        </Badge>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{fmtSent(r.cloudsign_draft_at)}</div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">未送信</span>
                    )}
                    {r.send_doc_number ? (
                      <button
                        type="button"
                        onClick={() => sendRow(r)}
                        disabled={sendingDoc === r.send_doc_number}
                        title={`${r.send_doc_number} を取引先へメール送信`}
                        className="block mt-1 text-[10px] underline text-emerald-700 dark:text-emerald-300 disabled:opacity-50"
                      >
                        {sendingDoc === r.send_doc_number
                          ? "送信中…"
                          : r.sent_at
                            ? "✉ 再送信"
                            : "✉ 送信"}
                      </button>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.payment_scheme === "royalty"
                      ? `MG ${yen(r.mg_remaining)}`
                      : yen(r.remaining_amount)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.has_overdue ? (
                      <Badge variant="default" className="bg-red-600 text-white">未発行</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {(r.event_count || 0) === 0 ? (
                      <button
                        type="button"
                        title="この明細を削除(実績が無い明細のみ)"
                        onClick={() => deleteLine(r)}
                        disabled={deletingId === r.id}
                        className="text-muted-foreground hover:text-red-600 disabled:opacity-40 mr-2 align-middle"
                      >
                        {deletingId === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 inline animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5 inline" />
                        )}
                      </button>
                    ) : null}
                    <ArrowRight
                      className="h-3.5 w-3.5 text-muted-foreground inline cursor-pointer align-middle"
                      onClick={() => open(r.line_code)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
