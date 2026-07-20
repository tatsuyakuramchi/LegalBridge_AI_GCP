import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Search, RefreshCw, ClipboardCheck, FileCheck2, Layers } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AppFormField } from "@/src/components/form"
import { NativeSelect } from "@/components/ui/native-select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"

// 検収待ち: 発注書(purchase_order)があるのに検収書が未作成/未完了のものを一覧し、
//   そこから検収書を作成(個別)する。検収進捗は /api/contracts/search が返す
//   inspected_amount / remaining_amount を使う。

type Row = Record<string, any>

const yen = (n: any) => {
  const v = Number(n)
  return isFinite(v) ? "¥" + v.toLocaleString("ja-JP") : "—"
}

const fmtDate = (v: any): string | null => {
  if (!v) return null
  const d = new Date(v)
  return isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null
}

// 法務の検収タスク状態。優先度順に判定(納品報告 delivered_at / 納期 inspection_deadline
//   は delivery_events 由来、capability_id 結線のベストエフォート)。
type TaskKey = "overdue" | "inspect" | "partial" | "waiting"
const BUCKETS: { key: TaskKey; label: string; short: string; chip: string; badge: string }[] = [
  { key: "overdue", label: "納期超過・未報告", short: "納期超過", chip: "border-destructive/40 text-destructive data-[on=true]:bg-destructive data-[on=true]:text-white data-[on=true]:border-destructive", badge: "bg-destructive/10 text-destructive hover:bg-destructive/10" },
  { key: "inspect", label: "検収書作成（報告あり）", short: "要検収", chip: "border-warning/40 text-warning data-[on=true]:bg-warning data-[on=true]:text-white data-[on=true]:border-warning", badge: "bg-warning/10 text-warning hover:bg-warning/10" },
  { key: "partial", label: "一部検収", short: "一部検収", chip: "border-primary/40 text-primary data-[on=true]:bg-primary data-[on=true]:text-white data-[on=true]:border-primary", badge: "bg-primary/10 text-primary hover:bg-primary/10" },
  { key: "waiting", label: "報告待ち", short: "報告待ち", chip: "border-slate-300 text-slate-600 data-[on=true]:bg-slate-600 data-[on=true]:text-white data-[on=true]:border-slate-600", badge: "bg-slate-100 text-slate-700 hover:bg-slate-100" },
]
const bucketOf = (k: TaskKey) => BUCKETS.find((b) => b.key === k)!
function taskStateOf(r: Row): TaskKey {
  const ordered = Number(r.amount_ex_tax) || 0
  const inspected = Number(r.inspected_amount) || 0
  if (r.overdue_no_report) return "overdue"
  if (r.has_delivery_report) return "inspect"
  if (inspected > 0.5 && inspected < ordered - 0.5) return "partial"
  return "waiting"
}

export function PendingInspectionsPage() {
  const navigate = useNavigate()
  const { staffList } = useAppData()
  const [rows, setRows] = React.useState<Row[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [q, setQ] = React.useState("")
  const [onlyUninspected, setOnlyUninspected] = React.useState(false)
  const [bucket, setBucket] = React.useState<TaskKey | null>(null)
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [bulkOpen, setBulkOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/contracts/search?record_types=purchase_order&limit=500")
      if (!res.ok) throw new Error("HTTP " + res.status)
      const data = await res.json()
      setRows(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message || String(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  // 検収待ちの母集団: 検収書未発行の明細(unissued_line_count>0)を持つ発注書、または
  //   納期超過・未報告の発注書。各行に法務タスク状態(_task)を付与する。
  const withState = React.useMemo(
    () =>
      rows
        .filter((r) => (Number(r.unissued_line_count) || 0) > 0 || r.overdue_no_report)
        .map((r) => ({ ...r, _task: taskStateOf(r) as TaskKey })),
    [rows]
  )

  const counts = React.useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of withState) m[r._task] = (m[r._task] || 0) + 1
    return m
  }, [withState])

  const pending = React.useMemo(() => {
    const kw = q.trim().toLowerCase()
    return withState
      .filter((r) => (bucket ? r._task === bucket : true))
      .filter((r) => (onlyUninspected ? (Number(r.inspected_amount) || 0) === 0 : true))
      .filter((r) =>
        !kw
          ? true
          : `${r.document_number} ${r.contract_title} ${r.vendor_name} ${r.vendor_code}`
              .toLowerCase()
              .includes(kw)
      )
      .sort((a, b) => {
        // 納期超過を最優先 → 納期(昇順) → 発注日(降順)。
        //   納期は inspection_deadline 優先、無ければ発注書の予定納期で代替。
        if ((a._task === "overdue") !== (b._task === "overdue"))
          return a._task === "overdue" ? -1 : 1
        const da = a.nearest_inspection_deadline || a.nearest_line_delivery_date || ""
        const db = b.nearest_inspection_deadline || b.nearest_line_delivery_date || ""
        if (da && db && da !== db) return da < db ? -1 : 1
        if (da !== db) return da ? -1 : 1
        return String(b.issue_date_po || "").localeCompare(String(a.issue_date_po || ""))
      })
  }, [withState, q, onlyUninspected, bucket])

  const totalRemaining = pending.reduce((s, r) => s + (Number(r.remaining_amount) || 0), 0)

  const createInspection = (id: number) => {
    navigate(`/documents/new?template=inspection_certificate&parent_po=${id}`)
  }

  return (
    <div className="px-6 py-6 space-y-5 max-w-[1400px] mx-auto">
      <header className="flex items-end justify-between gap-6 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-muted-foreground" /> 検収タスク（発注書）
          </h2>
          <p className="text-[13px] text-muted-foreground mt-1.5">
            納品報告に応じた検収書作成 / 納期超過・未報告の督促を管理します。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw />
          更新
        </Button>
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="発注書番号・取引先・件名で検索…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" className="h-4 w-4" checked={onlyUninspected} onChange={(e) => setOnlyUninspected(e.target.checked)} />
          未検収のみ（一度も検収していない）
        </label>
        <div className="flex-1" />
        <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => setBulkOpen(true)}>
          <Layers />
          選択をまとめて検収 ({selected.size})
        </Button>
        <span className="text-[12px] text-muted-foreground">
          {loading ? "読み込み中…" : `${pending.length} 件 / 残額合計 ${yen(totalRemaining)}`}
        </span>
      </div>

      {/* タスクバケット(クリックで絞り込み) */}
      <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono">
        <button
          type="button"
          onClick={() => setBucket(null)}
          data-on={bucket === null}
          className="px-2.5 py-1 rounded-full border border-border text-muted-foreground data-[on=true]:bg-foreground data-[on=true]:text-background data-[on=true]:border-foreground"
        >
          すべて ({withState.length})
        </button>
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => setBucket(bucket === b.key ? null : b.key)}
            data-on={bucket === b.key}
            className={`px-2.5 py-1 rounded-full border ${b.chip}`}
          >
            {b.label} ({counts[b.key] || 0})
          </button>
        ))}
      </div>

      <div className="border border-border rounded-lg overflow-x-auto">
        {error ? (
          <div className="p-8 text-center text-sm text-destructive">読み込み失敗: {error}</div>
        ) : pending.length === 0 && !loading ? (
          <div className="p-12 text-center text-[13px] text-muted-foreground">
            検収待ちの発注書はありません 🎉
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-[11px] font-bold text-muted-foreground">
              <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:whitespace-nowrap">
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={pending.length > 0 && selected.size === pending.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(pending.map((r) => Number(r.id))) : new Set())
                    }
                  />
                </th>
                <th>状態</th>
                <th>発注書番号</th>
                <th>取引先</th>
                <th>件名</th>
                <th className="text-right">発注額(税抜)</th>
                <th className="text-right">既検収</th>
                <th className="text-right">残額</th>
                <th className="text-right">未発行明細</th>
                <th className="text-right">検収率</th>
                <th>納品報告</th>
                <th>納期</th>
                <th>発注日</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => {
                const ordered = Number(r.amount_ex_tax) || 0
                const inspected = Number(r.inspected_amount) || 0
                const pct = ordered > 0 ? Math.round((inspected / ordered) * 100) : 0
                const b = bucketOf(r._task)
                const reportDate = fmtDate(r.latest_delivered_at)
                const deadline = fmtDate(r.nearest_inspection_deadline)
                // 納品報告がまだ無く inspection_deadline が出ない行は、発注書の
                //   予定納期(明細 delivery_date)をフォールバック表示する。
                const plannedDue = fmtDate(r.nearest_line_delivery_date)
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/30 [&>td]:px-2 [&>td]:py-2 align-top">
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(Number(r.id))}
                        onChange={() =>
                          setSelected((s) => {
                            const n = new Set(s)
                            n.has(Number(r.id)) ? n.delete(Number(r.id)) : n.add(Number(r.id))
                            return n
                          })
                        }
                      />
                    </td>
                    <td className="whitespace-nowrap">
                      <Badge className={b.badge}>
                        {b.short}
                        {r._task === "partial" ? ` ${pct}%` : ""}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap font-mono">
                      {r.document_number || "—"}
                      {r.is_imported && (
                        <Badge variant="outline" className="ml-1 text-[9px]">取込</Badge>
                      )}
                    </td>
                    <td className="min-w-[120px]">{r.vendor_name || r.vendor_code || "—"}</td>
                    <td className="min-w-[160px] whitespace-normal">{r.contract_title || "—"}</td>
                    <td className="text-right whitespace-nowrap font-mono">{yen(ordered)}</td>
                    <td className="text-right whitespace-nowrap text-muted-foreground">{yen(inspected)}</td>
                    <td className="text-right whitespace-nowrap font-mono font-bold">{yen(r.remaining_amount)}</td>
                    <td className="text-right whitespace-nowrap font-mono">
                      <span className="text-warning font-bold">{r.unissued_line_count}</span>
                      <span className="text-muted-foreground">/{r.line_count}</span>
                    </td>
                    <td className="text-right whitespace-nowrap">{pct}%</td>
                    <td className="whitespace-nowrap">
                      {reportDate ? (
                        <span className="text-muted-foreground">{reportDate}</span>
                      ) : (
                        <span className="text-slate-400">未報告</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {deadline ? (
                        <span className={r._task === "overdue" ? "text-destructive font-bold" : "text-muted-foreground"}>
                          {deadline}
                        </span>
                      ) : plannedDue ? (
                        <span className="text-muted-foreground" title="発注書の予定納期(納品報告前)">
                          {plannedDue}
                          <span className="ml-1 text-[9px] text-slate-400 align-middle">予定</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-muted-foreground">{r.issue_date_po || "—"}</td>
                    <td className="whitespace-nowrap text-right">
                      <Button size="sm" onClick={() => createInspection(Number(r.id))}>
                        <FileCheck2 />
                        検収書を作成
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        タスク区分は <b className="text-destructive">納期超過・未報告</b>（納期 inspection_deadline を過ぎても納品報告 delivered_at が無い → 督促）、
        <b className="text-warning">検収書作成（報告あり）</b>（納品報告あり・未検収の明細あり → 検収書を作成）、
        <b className="text-primary">一部検収</b>、<b>報告待ち</b> です。納品報告・納期は delivery_events 由来（発注書への結線が取れているものに表示）。納品報告前で納期が無い行は、発注書の予定納期（明細の納期）を <span className="text-slate-400">予定</span> として表示します。
        検収書を発行して<b>完全検収（残額0）</b>になると、その明細は自動で「発行済」になり一覧から外れます。
        「検収書を作成」で検収書フォームがその発注書を親に事前選択した状態で開きます（分割検収にも対応）。
      </p>

      {bulkOpen && (
        <BulkInspectionDialog
          pos={pending.filter((r) => selected.has(Number(r.id)))}
          staffList={staffList}
          onClose={() => setBulkOpen(false)}
          onDone={async () => {
            setSelected(new Set())
            await load()
          }}
        />
      )}
    </div>
  )
}

// 一括検収: 共通設定(検収日・検収者)で、選択した発注書の「未着手・残額全額」明細を
//   既存の堅牢な一括取込(/api/imports/bulk/inspection)で検収書化する。PDFは既定で
//   後生成キューに入る(まとめて生成)。一部検収済/対象外(発行済)の明細はスキップ。
function BulkInspectionDialog({
  pos,
  staffList,
  onClose,
  onDone,
}: {
  pos: Row[]
  staffList: any[]
  onClose: () => void
  onDone: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [docDate, setDocDate] = React.useState(today)
  const [inspectorEmail, setInspectorEmail] = React.useState("")
  const [genPdf, setGenPdf] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<any>(null)

  const run = async () => {
    if (!inspectorEmail) return
    setRunning(true)
    setResult(null)
    const allRows: any[] = []
    const skipped: { po: Row; reason: string }[] = []
    const ts = Date.now()
    for (const po of pos) {
      try {
        const detail = await fetch(`/api/contracts/${po.id}`).then((r) => (r.ok ? r.json() : null))
        const lines = (detail?.line_items || []).filter(
          (l: any) =>
            !l.inspection_issued &&
            (Number(l.inspected_amount_so_far) || 0) <= 0.5 &&
            (Number(l.remaining_amount_ex_tax) || 0) > 0.5 &&
            (Number(l.quantity) || 0) > 0
        )
        if (lines.length === 0) {
          skipped.push({ po, reason: "未着手の明細なし（一部検収/対象外のみ）" })
          continue
        }
        const issueKey = `INS-BULK-${po.id}-${ts}`
        const importKey = `BULKINS-${po.id}-${ts}`
        for (const l of lines) {
          allRows.push({
            import_key: importKey,
            issue_key: issueKey,
            parent_po_id: po.id,
            staff_email: inspectorEmail,
            document_date: docDate,
            delivered_at: docDate,
            generate_pdf: genPdf,
            order_line_item_id: l.id,
            line_no: l.line_no,
            inspected_quantity: l.quantity,
            acceptance_ratio: 1,
          })
        }
      } catch (e: any) {
        skipped.push({ po, reason: e?.message || String(e) })
      }
    }
    if (allRows.length === 0) {
      setResult({ error: "対象となる未着手明細がありませんでした。", skipped })
      setRunning(false)
      return
    }
    try {
      const res = await fetch("/api/imports/bulk/inspection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: allRows }),
      })
      const data = await res.json().catch(() => ({}))
      setResult({ ...data, skipped })
      onDone()
    } catch (e: any) {
      setResult({ error: e?.message || String(e), skipped })
    } finally {
      setRunning(false)
    }
  }

  const succeeded = result?.succeeded?.length || 0
  const failed = result?.failed?.length || 0

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>まとめて検収書作成（{pos.length} 件）</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {/* UIC-24: status 通知を warning トークンへ。 */}
          <div className="text-[11px] text-warning bg-warning/10 border border-warning/40 rounded-md p-2.5 leading-relaxed">
            選択した発注書の<b>「未着手（未検収）の明細」を残額全額で検収</b>します。
            一部検収済み・対象外（発行済）の明細はスキップされます（それらは個別作成で）。
            検収は受領の承諾です。内容を確認のうえ実行してください。
          </div>
          {/* FRM-08: 検収フォームを共通 AppFormField へ（設計 §11.3）。 */}
          <AppFormField label="検収日" htmlFor="insp_date">
            <Input id="insp_date" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
          </AppFormField>
          <AppFormField
            label="検収者"
            htmlFor="insp_inspector"
            required
            error={!inspectorEmail ? "検収者は必須です" : undefined}
          >
            <NativeSelect id="insp_inspector" value={inspectorEmail} onChange={(e) => setInspectorEmail(e.target.value)}>
              <option value="">— 検収者を選択 —</option>
              {staffList.map((s: any) => (
                <option key={s.email || s.slack_user_id} value={s.email || ""}>
                  {s.staff_name}{s.department ? ` / ${s.department}` : ""}{s.email ? ` <${s.email}>` : ""}
                </option>
              ))}
            </NativeSelect>
          </AppFormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={genPdf} onChange={(e) => setGenPdf(e.target.checked)} />
            PDFも今すぐ生成する（オフ＝後でまとめて生成キューへ）
          </label>

          {result && (
            <div className="text-xs border-t border-border pt-2">
              {result.error ? (
                <div className="text-destructive">エラー: {result.error}</div>
              ) : (
                <div className="flex gap-4 flex-wrap">
                  <span className="text-success">作成 <b>{succeeded}</b> 件</span>
                  {failed > 0 && <span className="text-destructive">失敗 <b>{failed}</b> 件</span>}
                </div>
              )}
              {result.skipped?.length > 0 && (
                <div className="mt-1 text-muted-foreground">
                  スキップ {result.skipped.length} 件: {result.skipped.map((s: any) => s.po.document_number || s.po.id).join(", ")}
                </div>
              )}
              {failed > 0 && (
                <div className="mt-1 text-destructive">
                  失敗: {(result.failed || []).map((f: any) => `${f.import_key}(${f.error})`).join(" / ")}
                </div>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={running}>
            {result ? "閉じる" : "キャンセル"}
          </Button>
          <Button onClick={run} disabled={running || !inspectorEmail || pos.length === 0}>
            {running ? "作成中…" : `検収書を作成 (${pos.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
