import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Search, RefreshCw, ClipboardCheck, FileCheck2, Layers } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
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

export function PendingInspectionsPage() {
  const navigate = useNavigate()
  const { staffList } = useAppData()
  const [rows, setRows] = React.useState<Row[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [q, setQ] = React.useState("")
  const [onlyUninspected, setOnlyUninspected] = React.useState(false)
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

  // フラグ駆動: 「検収書未発行の明細(unissued_line_count>0)」を持つ発注書を検収待ちに。
  //   未発行明細 = inspection_issued≠true かつ 全額検収されていない明細。
  //   完全検収すると自動で発行済になり、手動でも条件明細から発行済/対象外にできる。
  const pending = React.useMemo(() => {
    const kw = q.trim().toLowerCase()
    return rows
      .filter((r) => (Number(r.unissued_line_count) || 0) > 0)
      .filter((r) => (onlyUninspected ? (Number(r.inspected_amount) || 0) === 0 : true))
      .filter((r) =>
        !kw
          ? true
          : `${r.document_number} ${r.contract_title} ${r.vendor_name} ${r.vendor_code}`
              .toLowerCase()
              .includes(kw)
      )
      .sort((a, b) => String(b.issue_date_po || "").localeCompare(String(a.issue_date_po || "")))
  }, [rows, q, onlyUninspected])

  const totalRemaining = pending.reduce((s, r) => s + (Number(r.remaining_amount) || 0), 0)

  const createInspection = (id: number) => {
    navigate(`/documents/new?template=inspection_certificate&parent_po=${id}`)
  }

  return (
    <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-sm font-mono font-bold uppercase tracking-[0.14em]">検収待ち 発注書</h1>
        <span className="text-[11px] font-mono text-muted-foreground">
          発注書はあるが検収書が未作成 / 未完了のもの
        </span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw />
          更新
        </Button>
      </div>

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
        <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground cursor-pointer">
          <input type="checkbox" className="h-4 w-4" checked={onlyUninspected} onChange={(e) => setOnlyUninspected(e.target.checked)} />
          未検収のみ（一度も検収していない）
        </label>
        <div className="flex-1" />
        <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => setBulkOpen(true)}>
          <Layers />
          選択をまとめて検収 ({selected.size})
        </Button>
        <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
          {loading ? "読み込み中…" : `${pending.length} 件 / 残額合計 ${yen(totalRemaining)}`}
        </span>
      </div>

      <div className="border border-border rounded-lg overflow-x-auto">
        {error ? (
          <div className="p-8 text-center text-sm text-destructive">読み込み失敗: {error}</div>
        ) : pending.length === 0 && !loading ? (
          <div className="p-12 text-center text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
            検収待ちの発注書はありません 🎉
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground">
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
                <th>発注日</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => {
                const ordered = Number(r.amount_ex_tax) || 0
                const inspected = Number(r.inspected_amount) || 0
                const pct = ordered > 0 ? Math.round((inspected / ordered) * 100) : 0
                const uninspected = inspected === 0
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
                      {uninspected ? (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">未検収</Badge>
                      ) : (
                        <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100">一部検収 {pct}%</Badge>
                      )}
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
                    <td className="text-right whitespace-nowrap font-mono text-muted-foreground">{yen(inspected)}</td>
                    <td className="text-right whitespace-nowrap font-mono font-bold">{yen(r.remaining_amount)}</td>
                    <td className="text-right whitespace-nowrap font-mono">
                      <span className="text-amber-700 font-bold">{r.unissued_line_count}</span>
                      <span className="text-muted-foreground">/{r.line_count}</span>
                    </td>
                    <td className="text-right whitespace-nowrap">{pct}%</td>
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
        「検収待ち」は<b>検収書未発行の業務明細（status_flags.inspection_issued≠true かつ 未完了）</b>を持つ発注書です。
        検収書を発行して<b>完全検収（残額0）</b>になると、その明細は自動で「発行済」になり一覧から外れます。
        個別に「対象外／発行済」にしたい明細は、<b>マスター &gt; 条件明細</b>の行編集で「検収書発行済」を手動ON/OFFできます。
        「検収書を作成」を押すと、検収書フォームがその発注書を親に事前選択した状態で開きます（分割検収にも対応）。
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
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2.5 leading-relaxed">
            選択した発注書の<b>「未着手（未検収）の明細」を残額全額で検収</b>します。
            一部検収済み・対象外（発行済）の明細はスキップされます（それらは個別作成で）。
            検収は受領の承諾です。内容を確認のうえ実行してください。
          </div>
          <div className="space-y-1">
            <Label className="text-xs">検収日</Label>
            <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">検収者 *</Label>
            <NativeSelect value={inspectorEmail} onChange={(e) => setInspectorEmail(e.target.value)}>
              <option value="">— 検収者を選択 —</option>
              {staffList.map((s: any) => (
                <option key={s.email || s.slack_user_id} value={s.email || ""}>
                  {s.staff_name}{s.department ? ` / ${s.department}` : ""}{s.email ? ` <${s.email}>` : ""}
                </option>
              ))}
            </NativeSelect>
            {!inspectorEmail && <p className="text-[10px] text-destructive">検収者は必須です</p>}
          </div>
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
                  <span className="text-emerald-600">作成 <b>{succeeded}</b> 件</span>
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
