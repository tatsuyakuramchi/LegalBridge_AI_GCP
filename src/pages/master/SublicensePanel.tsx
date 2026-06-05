import * as React from "react"
import { Search, Download, Plus, RefreshCw, Upload, Trash2 } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect } from "@/components/ui/native-select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"

// 統合 P3-3: 請求権台帳(受領予定) — search-api 専用だった /master/sublicense を移植。
//   上段: 受領条件(deals) CRUD / 下段: 受領予定(receipts) + 利用報告 + CSV取込。

const KIND_LABEL: Record<string, string> = {
  sublicense: "サブライセンス",
  publication: "出版印税",
  license_out: "ライセンスアウト",
  service: "役務・その他",
  other: "その他",
}
const STATUS_LABEL: Record<string, string> = {
  unbilled: "未請求",
  billed: "請求済",
  received: "入金済",
}
const cycleLabel = (c: string) =>
  ({ MONTHLY: "月次", QUARTERLY: "四半期", SEMIANNUAL: "半年", ANNUAL: "年次", CUSTOM: "カスタム" } as Record<string, string>)[c] || c || ""

const kindLabel = (k: string) => KIND_LABEL[k] || k || ""
const yen = (n: any) => {
  const v = Number(n)
  return isFinite(v) && n != null && n !== "" ? v.toLocaleString("ja-JP") : ""
}

type Row = Record<string, any>

const emptyDeal = {
  receivable_kind: "sublicense",
  work_id: "",
  sublicensee_id: "",
  counterparty_name: "",
  source_contract_number: "",
  basis: "sales",
  rate_pct: "",
  unit_price: "",
  forecast_amount: "",
  mg_amount: "",
  advance_amount: "",
  currency: "JPY",
  cycle: "QUARTERLY",
  interval_count: "",
  interval_unit: "MONTH",
  billing_day: "",
  term_start: "",
  term_end: "",
  remarks: "",
}

const emptyReceiptFilters = { from: "", to: "", kind: "", status: "", sublicensee: "", work: "", q: "" }

const jget = async (u: string) => {
  const r = await fetch(u)
  if (!r.ok) throw new Error("HTTP " + r.status)
  return r.json()
}

export function SublicensePanel() {
  const { showNotification } = useAppData()
  const [opt, setOpt] = React.useState<{ works: Row[]; sublicensees: Row[] }>({ works: [], sublicensees: [] })
  const [deals, setDeals] = React.useState<Row[]>([])
  const [receipts, setReceipts] = React.useState<Row[]>([])
  const [filters, setFilters] = React.useState(emptyReceiptFilters)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [loadingReceipts, setLoadingReceipts] = React.useState(false)

  const setF = (patch: Partial<typeof emptyReceiptFilters>) => setFilters((f) => ({ ...f, ...patch }))

  const loadOptions = React.useCallback(async () => {
    try {
      const d = await jget("/api/sublicense/options")
      setOpt({ works: d.works || [], sublicensees: d.sublicensees || [] })
    } catch {
      /* noop */
    }
  }, [])

  const loadDeals = React.useCallback(async () => {
    try {
      const d = await jget("/api/sublicense/deals")
      setDeals(d.rows || [])
    } catch {
      setDeals([])
    }
  }, [])

  const loadReceipts = React.useCallback(async (f = filters) => {
    setLoadingReceipts(true)
    try {
      const p = new URLSearchParams()
      ;(["from", "to", "kind", "status", "sublicensee", "work", "q"] as const).forEach((k) => {
        const v = (f[k] || "").trim()
        if (v) p.set(k, v)
      })
      const d = await jget("/api/sublicense/receipts?" + p.toString())
      setReceipts(d.rows || [])
      setSelected(new Set())
    } catch (e: any) {
      setReceipts([])
      showNotification(`受領予定の読み込みに失敗: ${e?.message || e}`, "error")
    } finally {
      setLoadingReceipts(false)
    }
  }, [filters, showNotification])

  // 条件明細(inbound)→請求権 取込。
  const importInbound = React.useCallback(async (silent: boolean) => {
    try {
      const res = await fetch("/api/sublicense/receipts/import", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || "HTTP " + res.status)
      if (!silent) showNotification(`取込完了: 新規 ${data.imported || 0} 件 / 更新 ${data.updated || 0} 件`, "success")
      await loadDeals()
      await loadReceipts()
    } catch (e: any) {
      if (!silent) showNotification(`取込に失敗: ${e?.message || e}`, "error")
    }
  }, [loadDeals, loadReceipts, showNotification])

  React.useEffect(() => {
    ;(async () => {
      await loadOptions()
      await loadDeals()
      await loadReceipts(emptyReceiptFilters)
      importInbound(true) // 起動時にサイレント取込(冪等)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── deal 編集モーダル ───────────────────────────────────────
  const [dealOpen, setDealOpen] = React.useState(false)
  const [editId, setEditId] = React.useState<number | null>(null)
  const [dealForm, setDealForm] = React.useState<any>(emptyDeal)
  const [savingDeal, setSavingDeal] = React.useState(false)
  const dset = (patch: any) => setDealForm((d: any) => ({ ...d, ...patch }))

  const openDeal = (deal: Row | null) => {
    setEditId(deal?.id ?? null)
    setDealForm(
      deal
        ? {
            receivable_kind: deal.receivable_kind || "sublicense",
            work_id: deal.work_id ?? "",
            sublicensee_id: deal.sublicensee_id ?? "",
            counterparty_name: deal.counterparty_name || deal.inline_sublicensee_name || "",
            source_contract_number: deal.source_contract_number || "",
            basis: deal.basis || "sales",
            rate_pct: deal.rate_pct ?? "",
            unit_price: deal.unit_price ?? "",
            forecast_amount: deal.forecast_amount ?? "",
            mg_amount: deal.mg_amount ?? "",
            advance_amount: deal.advance_amount ?? "",
            currency: deal.currency || "JPY",
            cycle: deal.cycle || "QUARTERLY",
            interval_count: deal.interval_count ?? "",
            interval_unit: deal.interval_unit || "MONTH",
            billing_day: deal.billing_day ?? "",
            term_start: deal.term_start || "",
            term_end: deal.term_end || "",
            remarks: deal.remarks || "",
          }
        : { ...emptyDeal }
    )
    setDealOpen(true)
  }

  const calc = React.useMemo(() => {
    const rate = Number(dealForm.rate_pct) / 100 || 0
    const royalty =
      dealForm.basis === "manufacturing"
        ? rate * (Number(dealForm.unit_price) || 0) * (Number(dealForm.forecast_amount) || 0)
        : rate * (Number(dealForm.forecast_amount) || 0)
    const gross = Math.max(royalty, Number(dealForm.mg_amount) || 0)
    const net = Math.max(gross - (Number(dealForm.advance_amount) || 0), 0)
    return { royalty: Math.round(royalty), gross: Math.round(gross), net: Math.round(net) }
  }, [dealForm])

  const saveDeal = async () => {
    setSavingDeal(true)
    try {
      const body: any = { ...dealForm, id: editId || undefined, inline_sublicensee_name: null }
      ;["work_id", "sublicensee_id", "counterparty_name", "source_contract_number", "rate_pct", "unit_price", "forecast_amount", "mg_amount", "advance_amount", "interval_count", "billing_day", "term_start", "term_end", "remarks"].forEach((k) => {
        if (body[k] === "") body[k] = null
      })
      const res = await fetch("/api/sublicense/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || "HTTP " + res.status)
      showNotification("受領条件を保存しました", "success")
      setDealOpen(false)
      await loadDeals()
      await loadReceipts()
    } catch (e: any) {
      showNotification(`保存に失敗: ${e?.message || e}`, "error")
    } finally {
      setSavingDeal(false)
    }
  }

  const deleteDeal = async () => {
    if (!editId) return
    if (!confirm("この受領条件を削除しますか?")) return
    try {
      const res = await fetch("/api/sublicense/deals/" + editId, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || "HTTP " + res.status)
      showNotification("削除しました", "success")
      setDealOpen(false)
      await loadDeals()
      await loadReceipts()
    } catch (e: any) {
      showNotification(`削除に失敗: ${e?.message || e}`, "error")
    }
  }

  // ── 受領予定 状態更新 / 選択 / CSV ──────────────────────────
  const setStatus = async (dealId: number, date: string, status: string) => {
    try {
      const res = await fetch("/api/sublicense/receipts/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId, period_date: date, status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || "HTTP " + res.status)
      setReceipts((rs) => rs.map((r) => (r.deal_id === dealId && r.receipt_date === date ? { ...r, status } : r)))
    } catch (e: any) {
      showNotification(`状態更新に失敗: ${e?.message || e}`, "error")
      loadReceipts()
    }
  }

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const toggleSelAll = () =>
    setSelected((s) => (s.size === receipts.length ? new Set() : new Set(receipts.map((r) => String(r.row_id)))))

  const downloadBlob = async (url: string, filename: string) => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error("HTTP " + res.status)
      const blob = await res.blob()
      const u = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = u
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(u)
    } catch (e: any) {
      showNotification(`ダウンロードに失敗: ${e?.message || e}`, "error")
    }
  }
  const csvExport = (ids?: string[]) => {
    const p = new URLSearchParams()
    ;(["from", "to", "kind", "status", "sublicensee", "work", "q"] as const).forEach((k) => {
      const v = (filters[k] || "").trim()
      if (v) p.set(k, v)
    })
    if (ids?.length) p.set("ids", ids.join(","))
    downloadBlob(
      "/api/sublicense/receipts/export?" + p.toString(),
      `sublicense_receipts_${new Date().toISOString().slice(0, 10)}.csv`
    )
  }

  // ── 利用報告モーダル ────────────────────────────────────────
  const [reportOpen, setReportOpen] = React.useState(false)
  const [rCtx, setRCtx] = React.useState<{ deal_id: number } | null>(null)
  const [reportList, setReportList] = React.useState<Row[]>([])
  const [reportForm, setReportForm] = React.useState<any>({})
  const [savingReport, setSavingReport] = React.useState(false)
  const rset = (patch: any) => setReportForm((d: any) => ({ ...d, ...patch }))

  const reloadReportList = async (dealId: number) => {
    try {
      const d = await jget("/api/sublicense/deals/" + dealId + "/reports")
      setReportList(d.rows || [])
    } catch {
      setReportList([])
    }
  }
  const openReport = async (dealId: number, date: string) => {
    setRCtx({ deal_id: dealId })
    setReportForm({ period_label: "", report_basis: "", period_start: "", period_end: date || "", reported_sales: "", reported_quantity: "", unit_price: "", reported_amount: "", note: "" })
    setReportList([])
    setReportOpen(true)
    await reloadReportList(dealId)
  }
  const saveReport = async () => {
    if (!rCtx) return
    if (!reportForm.period_end) {
      showNotification("利用期間の終了(代表日)は必須です", "error")
      return
    }
    setSavingReport(true)
    try {
      const body: any = {
        deal_id: rCtx.deal_id,
        period_date: reportForm.period_end,
        period_end: reportForm.period_end,
        period_label: reportForm.period_label || null,
        period_start: reportForm.period_start || null,
        report_basis: reportForm.report_basis || null,
        reported_sales: reportForm.reported_sales || null,
        reported_quantity: reportForm.reported_quantity || null,
        unit_price: reportForm.unit_price || null,
        reported_amount: reportForm.reported_amount || null,
        note: reportForm.note || null,
      }
      const res = await fetch("/api/sublicense/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || "HTTP " + res.status)
      setReportForm({ ...reportForm, period_label: "", period_start: "", reported_sales: "", reported_quantity: "", unit_price: "", reported_amount: "", note: "" })
      await reloadReportList(rCtx.deal_id)
      await loadReceipts()
      showNotification("利用報告を保存しました", "success")
    } catch (e: any) {
      showNotification(`保存に失敗: ${e?.message || e}`, "error")
    } finally {
      setSavingReport(false)
    }
  }
  const deleteReport = async (periodDate: string) => {
    if (!rCtx) return
    if (!confirm("この利用報告を削除しますか?")) return
    try {
      const res = await fetch(`/api/sublicense/reports?deal_id=${rCtx.deal_id}&period_date=${encodeURIComponent(periodDate)}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || "HTTP " + res.status)
      await reloadReportList(rCtx.deal_id)
      await loadReceipts()
    } catch (e: any) {
      showNotification(`削除に失敗: ${e?.message || e}`, "error")
    }
  }

  // ── CSV 取込モーダル ────────────────────────────────────────
  const [csvOpen, setCsvOpen] = React.useState(false)
  const [csvText, setCsvText] = React.useState("")
  const [dryRun, setDryRun] = React.useState(true)
  const [csvResult, setCsvResult] = React.useState<any>(null)
  const [runningCsv, setRunningCsv] = React.useState(false)

  const onCsvFile = (file?: File) => {
    if (!file) return
    const rd = new FileReader()
    rd.onload = () => setCsvText(String(rd.result || ""))
    rd.readAsText(file, "UTF-8")
  }
  const runCsv = async () => {
    if (!csvText.trim()) {
      showNotification("CSVファイルを選択するか貼り付けてください", "error")
      return
    }
    setRunningCsv(true)
    setCsvResult(null)
    try {
      const res = await fetch("/api/sublicense/reports/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText.trim(), dry_run: dryRun }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error(d.error || "HTTP " + res.status)
      setCsvResult(d)
      if (!dryRun) await loadReceipts()
    } catch (e: any) {
      setCsvResult({ error: e?.message || String(e) })
    } finally {
      setRunningCsv(false)
    }
  }

  const works = opt.works
  const subs = opt.sublicensees

  return (
    <div className="space-y-6">
      {/* ── 上段: 受領条件(deals) ── */}
      <section className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-mono font-bold uppercase tracking-[0.12em]">
            請求権の条件 (種別 × 相手方 × 受領条件)
          </h2>
          <span className="text-[11px] font-mono text-muted-foreground">{deals.length} 件</span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => importInbound(false)} title="条件明細で受領(inbound)ONの明細を請求権に取り込みます">
            <RefreshCw />
            条件明細から取り込む
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCsvOpen(true)}>
            <Upload />
            利用報告CSV取込
          </Button>
          <Button size="sm" onClick={() => openDeal(null)}>
            <Plus />
            条件を追加
          </Button>
        </div>
        <div className="border border-border rounded-lg overflow-x-auto max-h-[46vh] overflow-y-auto">
          {deals.length === 0 ? (
            <div className="p-10 text-center text-xs font-mono uppercase tracking-[0.16em] text-muted-foreground">
              受領条件がありません。「条件を追加」から登録してください。
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground sticky top-0">
                <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:whitespace-nowrap">
                  <th>種別</th><th>作品</th><th>相手方</th><th>基準</th>
                  <th className="text-right">料率%</th><th className="text-right">MG</th><th className="text-right">前払</th>
                  <th className="text-right">受領予定(net)</th><th>周期/期間</th><th>参照契約</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/30 cursor-pointer [&>td]:px-2 [&>td]:py-2" onClick={() => openDeal(r)}>
                    <td><Badge variant="outline">{kindLabel(r.receivable_kind)}</Badge></td>
                    <td className="min-w-[140px] whitespace-normal">{(r.work_code ? r.work_code + " : " : "") + (r.work_title || "—")}</td>
                    <td className="min-w-[120px] whitespace-normal">{r.sublicensee_name || "—"}</td>
                    <td>{r.basis === "manufacturing" ? <Badge variant="secondary">製造数</Badge> : <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">売上</Badge>}</td>
                    <td className="text-right">{r.rate_pct ?? ""}</td>
                    <td className="text-right">{yen(r.mg_amount)}</td>
                    <td className="text-right">{yen(r.advance_amount)}</td>
                    <td className="text-right font-mono font-bold">{yen(r.net)}</td>
                    <td className="whitespace-nowrap">{cycleLabel(r.cycle)}<div className="text-[10px] text-muted-foreground">{(r.term_start || "—") + " 〜 " + (r.term_end || "継続")}</div></td>
                    <td className="whitespace-nowrap">{r.source_contract_number || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── 下段: 受領予定一覧 ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-mono font-bold uppercase tracking-[0.12em]">受領予定一覧</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 border border-border rounded-lg bg-card/50">
          <Field label="受領予定日">
            <div className="flex items-center gap-1">
              <Input type="date" value={filters.from} onChange={(e) => setF({ from: e.target.value })} />
              <span className="text-muted-foreground text-xs">〜</span>
              <Input type="date" value={filters.to} onChange={(e) => setF({ to: e.target.value })} />
            </div>
          </Field>
          <Field label="種別">
            <NativeSelect value={filters.kind} onChange={(e) => setF({ kind: e.target.value })}>
              <option value="">全種別</option>
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </Field>
          <Field label="請求状態">
            <NativeSelect value={filters.status} onChange={(e) => setF({ status: e.target.value })}>
              <option value="">全状態</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </Field>
          <Field label="相手方"><Input value={filters.sublicensee} placeholder="名称" onChange={(e) => setF({ sublicensee: e.target.value })} onKeyDown={(e) => e.key === "Enter" && loadReceipts()} /></Field>
          <Field label="作品"><Input value={filters.work} placeholder="作品名 / コード" onChange={(e) => setF({ work: e.target.value })} onKeyDown={(e) => e.key === "Enter" && loadReceipts()} /></Field>
          <Field label="キーワード"><Input value={filters.q} placeholder="作品/相手/契約番号" onChange={(e) => setF({ q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && loadReceipts()} /></Field>
          <div className="flex items-end gap-2">
            <Button onClick={() => loadReceipts()} disabled={loadingReceipts}><Search />検索</Button>
            <Button variant="outline" onClick={() => { setFilters(emptyReceiptFilters); loadReceipts(emptyReceiptFilters) }}>クリア</Button>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
            {loadingReceipts ? "検索中…" : `${receipts.length} 件`}
          </span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => csvExport(Array.from(selected))} disabled={selected.size === 0}><Download />選択をCSV ({selected.size})</Button>
          <Button variant="outline" size="sm" onClick={() => csvExport()}><Download />全件CSV</Button>
        </div>
        <div className="border border-border rounded-lg overflow-x-auto max-h-[46vh] overflow-y-auto">
          {receipts.length === 0 && !loadingReceipts ? (
            <div className="p-10 text-center text-xs font-mono uppercase tracking-[0.16em] text-muted-foreground">
              受領予定がありません(条件の開始日・周期・金額を設定してください)。
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground sticky top-0">
                <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:whitespace-nowrap">
                  <th className="w-8"><input type="checkbox" checked={receipts.length > 0 && selected.size === receipts.length} onChange={toggleSelAll} /></th>
                  <th>請求状態</th><th>種別</th><th>受領予定日</th><th>相手方</th><th>作品</th>
                  <th>参照契約</th><th>区分</th><th className="text-right">実売上/数量</th><th>回</th><th className="text-right">金額</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => {
                  const st = r.status || "unbilled"
                  const reported = r.basis === "manufacturing" ? yen(r.reported_quantity) : yen(r.reported_sales)
                  return (
                    <tr key={r.row_id} className={`border-t border-border hover:bg-muted/30 cursor-pointer [&>td]:px-2 [&>td]:py-2 ${st === "received" ? "bg-emerald-50/60" : ""}`} onClick={() => openReport(Number(r.deal_id), r.receipt_date)}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(String(r.row_id))} onChange={() => toggleSel(String(r.row_id))} /></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <NativeSelect className="h-7 text-[11px] py-0" value={st} onChange={(e) => setStatus(Number(r.deal_id), r.receipt_date, e.target.value)}>
                          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </NativeSelect>
                      </td>
                      <td><Badge variant="outline">{kindLabel(r.receivable_kind)}</Badge></td>
                      <td className="whitespace-nowrap">{r.receipt_date}</td>
                      <td className="min-w-[120px] whitespace-normal">{r.sublicensee_name || "—"}</td>
                      <td className="min-w-[140px] whitespace-normal">{(r.work_code ? r.work_code + " : " : "") + (r.work_title || "—")}</td>
                      <td className="whitespace-nowrap">{r.source_contract_number || "—"}</td>
                      <td className="whitespace-nowrap">
                        {r.estimated ? <Badge variant="outline">見込</Badge> : <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">実績</Badge>}
                        {r.report_count ? <span className="text-[10px] text-muted-foreground ml-1">報告{r.report_count}件</span> : null}
                      </td>
                      <td className="text-right">{reported}</td>
                      <td className="whitespace-nowrap">{r.seq}/{r.of}</td>
                      <td className="text-right whitespace-nowrap font-mono">
                        {r.currency} {yen(r.amount)}
                        {r.mg_topup ? <Badge className="ml-1 bg-amber-100 text-amber-700 hover:bg-amber-100">MG+{yen(r.mg_topup)}</Badge> : null}
                        {r.advance_applied ? <Badge className="ml-1 bg-pink-100 text-pink-700 hover:bg-pink-100">前払-{yen(r.advance_applied)}</Badge> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── deal モーダル ── */}
      <Dialog open={dealOpen} onOpenChange={setDealOpen}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader><DialogTitle>{editId ? "受領条件を編集" : "受領条件を追加"}</DialogTitle></DialogHeader>
          <DialogBody>
            <div className="grid grid-cols-2 gap-3">
              <Field className="col-span-2" label="種別 (請求権の種類)">
                <NativeSelect value={dealForm.receivable_kind} onChange={(e) => dset({ receivable_kind: e.target.value })}>
                  {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </Field>
              <Field label="作品">
                <NativeSelect value={dealForm.work_id} onChange={(e) => dset({ work_id: e.target.value })}>
                  <option value="">—</option>
                  {works.map((o) => <option key={o.id} value={o.id}>{(o.work_code ? o.work_code + " : " : "") + (o.title || "#" + o.id)}</option>)}
                </NativeSelect>
              </Field>
              <Field label="サブライセンシー (マスタ)">
                <NativeSelect value={dealForm.sublicensee_id} onChange={(e) => dset({ sublicensee_id: e.target.value })}>
                  <option value="">— 手入力 —</option>
                  {subs.map((o) => <option key={o.id} value={o.id}>{o.name || "#" + o.id}</option>)}
                </NativeSelect>
              </Field>
              <Field className="col-span-2" label="相手方名 (手入力 / マスタ未登録)"><Input value={dealForm.counterparty_name} placeholder="例: ○○出版 / 海外ライセンシー名" onChange={(e) => dset({ counterparty_name: e.target.value })} /></Field>
              <Field label="参照: 契約番号"><Input value={dealForm.source_contract_number} placeholder="ARC-LIC-2026-0001" onChange={(e) => dset({ source_contract_number: e.target.value })} /></Field>
              <Field label="算定基準">
                <NativeSelect value={dealForm.basis} onChange={(e) => dset({ basis: e.target.value })}>
                  <option value="sales">売上ベース(料率×売上)</option>
                  <option value="manufacturing">製造数ベース(料率×単価×数量)</option>
                </NativeSelect>
              </Field>
              <Field label="料率 (%)"><Input type="number" step="0.0001" value={dealForm.rate_pct} placeholder="10" onChange={(e) => dset({ rate_pct: e.target.value })} /></Field>
              <Field label="基準価格 (製造数ベース時)"><Input type="number" value={dealForm.unit_price} placeholder="単価" onChange={(e) => dset({ unit_price: e.target.value })} /></Field>
              <Field label="見込売上 / 見込数量"><Input type="number" value={dealForm.forecast_amount} placeholder="試算用" onChange={(e) => dset({ forecast_amount: e.target.value })} /></Field>
              <Field label="MG (最低保証) 総額"><Input type="number" value={dealForm.mg_amount} placeholder="0" onChange={(e) => dset({ mg_amount: e.target.value })} /></Field>
              <Field label="前払 / AG (相殺)"><Input type="number" value={dealForm.advance_amount} placeholder="0" onChange={(e) => dset({ advance_amount: e.target.value })} /></Field>
              <Field label="通貨"><Input value={dealForm.currency} onChange={(e) => dset({ currency: e.target.value })} /></Field>
              <Field label="周期">
                <NativeSelect value={dealForm.cycle} onChange={(e) => dset({ cycle: e.target.value })}>
                  <option value="MONTHLY">月次</option><option value="QUARTERLY">四半期</option><option value="SEMIANNUAL">半年</option><option value="ANNUAL">年次</option><option value="CUSTOM">カスタム</option>
                </NativeSelect>
              </Field>
              {dealForm.cycle === "CUSTOM" && (
                <Field label="カスタム間隔">
                  <div className="flex items-center gap-1 text-xs">
                    毎<Input className="w-16" type="number" value={dealForm.interval_count} placeholder="2" onChange={(e) => dset({ interval_count: e.target.value })} />
                    <NativeSelect value={dealForm.interval_unit} onChange={(e) => dset({ interval_unit: e.target.value })}>
                      <option value="MONTH">ヶ月</option><option value="DAY">日</option>
                    </NativeSelect>ごと
                  </div>
                </Field>
              )}
              <Field label="受領日 (毎期X日 / 0で末日)"><Input type="number" value={dealForm.billing_day} placeholder="末日=0" onChange={(e) => dset({ billing_day: e.target.value })} /></Field>
              <Field label="開始日"><Input type="date" value={dealForm.term_start} onChange={(e) => dset({ term_start: e.target.value })} /></Field>
              <Field label="終了日"><Input type="date" value={dealForm.term_end} onChange={(e) => dset({ term_end: e.target.value })} /></Field>
              <Field className="col-span-2" label="備考"><Input value={dealForm.remarks} onChange={(e) => dset({ remarks: e.target.value })} /></Field>
              <div className="col-span-2 text-[11px] text-muted-foreground bg-muted/40 rounded-md p-2.5 leading-relaxed">
                試算: 料率×見込 = {yen(calc.royalty)} / max(料率,MG) = {yen(calc.gross)} / 前払相殺後 <b>net = {yen(calc.net)}</b> ({dealForm.currency})。期間内で均等割りして各回に展開します。
              </div>
            </div>
          </DialogBody>
          <DialogFooter className="justify-between">
            {editId ? (
              <Button variant="outline" className="text-destructive border-destructive" onClick={deleteDeal}><Trash2 />削除</Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDealOpen(false)} disabled={savingDeal}>キャンセル</Button>
              <Button onClick={saveDeal} disabled={savingDeal}>{savingDeal ? "保存中…" : "保存"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 利用報告モーダル ── */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader><DialogTitle>利用報告 (期間別)</DialogTitle></DialogHeader>
          <DialogBody className="space-y-3">
            <div className="text-[11px] text-muted-foreground bg-muted/40 rounded-md p-2.5 leading-relaxed">
              利用報告を期間別(例: 2026年4月分・5月分…)に登録すると、受領回の対象期間に入る報告を<b>合算</b>して金額が算定されます。
            </div>
            <div>
              {reportList.length === 0 ? (
                <p className="text-xs text-muted-foreground">利用報告は未登録です。下のフォームから期間別に追加してください。</p>
              ) : (
                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">登録済みの利用報告 ({reportList.length}件):</p>
                  {reportList.map((rep, i) => {
                    const period = rep.period_label || ((rep.period_start || "") + (rep.period_start || rep.period_end ? "〜" : "") + (rep.period_end || rep.period_date || ""))
                    const basis = rep.report_basis ? ({ manufacturing: "製造時", usage: "利用期間", sales: "売上" } as Record<string, string>)[rep.report_basis] || "" : ""
                    const val = rep.reported_amount != null ? `金額 ¥${yen(rep.reported_amount)}` : rep.reported_quantity != null ? `数量 ${yen(rep.reported_quantity)}` : rep.reported_sales != null ? `売上 ¥${yen(rep.reported_sales)}` : ""
                    return (
                      <div key={i} className="flex items-center gap-2 py-1.5 border-b border-border text-xs flex-wrap">
                        <b>{period || "(期間未設定)"}</b>
                        {basis && <Badge variant="outline">{basis}</Badge>}
                        <span className="text-muted-foreground">{val}</span>
                        {rep.note && <span className="text-muted-foreground">{rep.note}</span>}
                        <span className="flex-1" />
                        <button className="text-destructive font-bold" onClick={() => deleteReport(rep.period_date)}>削除</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="border-t border-border pt-3">
              <p className="text-xs font-bold mb-2">＋ 報告を追加</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="期間ラベル"><Input value={reportForm.period_label || ""} placeholder="例: 2026年4月分" onChange={(e) => rset({ period_label: e.target.value })} /></Field>
                <Field label="基準">
                  <NativeSelect value={reportForm.report_basis || ""} onChange={(e) => rset({ report_basis: e.target.value })}>
                    <option value="">条件に従う</option><option value="sales">売上</option><option value="manufacturing">製造時</option><option value="usage">利用期間</option>
                  </NativeSelect>
                </Field>
                <Field label="利用期間 開始"><Input type="date" value={reportForm.period_start || ""} onChange={(e) => rset({ period_start: e.target.value })} /></Field>
                <Field label="利用期間 終了 (代表日・必須)"><Input type="date" value={reportForm.period_end || ""} onChange={(e) => rset({ period_end: e.target.value })} /></Field>
                <Field label="実売上"><Input type="number" value={reportForm.reported_sales || ""} placeholder="売上基準" onChange={(e) => rset({ reported_sales: e.target.value })} /></Field>
                <Field label="実数量 (製造時)"><Input type="number" value={reportForm.reported_quantity || ""} placeholder="製造/販売数" onChange={(e) => rset({ reported_quantity: e.target.value })} /></Field>
                <Field label="単価 (製造時・任意)"><Input type="number" value={reportForm.unit_price || ""} onChange={(e) => rset({ unit_price: e.target.value })} /></Field>
                <Field label="金額直接 (任意・最優先)"><Input type="number" value={reportForm.reported_amount || ""} placeholder="相手方提示額" onChange={(e) => rset({ reported_amount: e.target.value })} /></Field>
                <Field className="col-span-2" label="メモ"><Input value={reportForm.note || ""} onChange={(e) => rset({ note: e.target.value })} /></Field>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportOpen(false)}>閉じる</Button>
            <Button onClick={saveReport} disabled={savingReport}>{savingReport ? "保存中…" : "報告を保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── CSV取込モーダル ── */}
      <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader><DialogTitle>利用報告 CSV 一括取込</DialogTitle></DialogHeader>
          <DialogBody className="space-y-3">
            <div className="text-[11px] text-muted-foreground bg-muted/40 rounded-md p-2.5 leading-relaxed">
              CSV(UTF-8)の各行を <b>タイトル→作品→請求権(deal)</b> に自動解決して利用報告を登録します。作品に複数の請求権がある場合は「相手方」または「契約番号」列で特定してください。
            </div>
            <Button variant="outline" size="sm" onClick={() => downloadBlob("/api/sublicense/reports/template.csv", "usage_report_sample.csv")}>
              <Download />サンプルCSVをダウンロード
            </Button>
            <Field label="CSVファイル">
              <Input type="file" accept=".csv,text/csv" onChange={(e) => onCsvFile(e.target.files?.[0])} />
            </Field>
            <Field label="または CSV を貼り付け">
              <Textarea className="min-h-[120px] font-mono text-xs" value={csvText} onChange={(e) => setCsvText(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
              ドライラン(検証のみ・DB書込なし)
            </label>
            {csvResult && <CsvResultView d={csvResult} />}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCsvOpen(false)}>閉じる</Button>
            <Button onClick={runCsv} disabled={runningCsv}>{runningCsv ? "処理中…" : "取込実行"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className || ""}`}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function CsvResultView({ d }: { d: any }) {
  if (d.error) return <div className="text-sm text-destructive">失敗: {d.error}</div>
  return (
    <div>
      <div className="flex gap-4 flex-wrap text-xs my-2">
        <span>{d.dry_run ? <b className="text-amber-600">ドライラン</b> : <b className="text-emerald-600">本番取込</b>}</span>
        <span>総 {d.total}</span>
        <span className="text-emerald-600">取込 {d.imported}</span>
        <span className="text-amber-600">スキップ {d.skipped}</span>
        <span className="text-destructive">エラー {d.failed}</span>
      </div>
      <div className="max-h-[260px] overflow-auto">
        {(d.rows || []).map((r: any, i: number) => {
          const color = r.status === "ok" ? "text-emerald-600" : r.status === "skip" ? "text-amber-600" : "text-destructive"
          const ic = r.status === "ok" ? "✓" : r.status === "skip" ? "−" : "✗"
          return (
            <div key={i} className="border-b border-border py-0.5 text-xs">
              <span className={`font-bold ${color}`}>{ic}</span> 行{r.row} {r.title}
              {r.period ? ` / ${r.period}` : ""}
              {r.deal ? ` → ${r.deal}` : ""}
              {r.message ? <span className="text-muted-foreground"> {r.message}</span> : ""}
            </div>
          )
        })}
      </div>
      {d.dry_run && d.imported > 0 && (
        <div className="text-[11px] text-muted-foreground bg-muted/40 rounded-md p-2.5 mt-2">
          ドライランで {d.imported} 件が取込可能です。チェックを外して「取込実行」で確定してください。
        </div>
      )}
    </div>
  )
}
