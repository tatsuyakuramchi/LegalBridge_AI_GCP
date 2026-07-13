/**
 * BulkImportPanel — 原作(ledgers)＋原作マテリアル(work_materials)の一括インポート画面。
 *
 * 2つの入力ソースを1つのプレビュー表に集約して upsert 登録する:
 *   ① 既存文書から抽出 — 発注書/契約書/利用許諾条件書を選び、その構成要素(lc-candidates)を
 *      取り込む。素材未リンクの利用許諾CLは link_condition_ids で当該マテリアルへ後付けリンク。
 *   ② 表(CSV/TSV)貼付 — スプレッドシートの複数行を貼り付け/アップロードして取り込む。
 *
 * 既存(原作: ledger_code or title 一致 / マテリアル: 原作内 material_name 一致)は更新(upsert)、
 *   無ければ新規作成。送信先: POST /api/master/bulk-import。
 */

import * as React from "react"
import Papa from "papaparse"
import { Upload, PackageSearch, Table2, Plus, Trash2, Loader2, Check, AlertCircle, FileUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { UnifiedContractPicker, type ContractDetail } from "@/src/components/document/UnifiedContractPicker"
import { useAppData } from "@/src/context/AppDataContext"

type Row = {
  ledger_title: string
  ledger_code: string
  material_name: string
  material_type: string
  rights_holder_code: string
  territory: string
  language: string
  source_doc: string
  remarks: string
  link_condition_ids: number[]
  // CL(金銭条件): 料率があればマテリアルごとに新規ARC-ILTを発番してCLを作成する。
  cl_calc_type: string
  cl_rate: string
  cl_mg: string
  cl_ag: string
  cl_currency: string
}

type RowResult = {
  index: number
  ok: boolean
  error?: string
  warning?: string
  work_id?: number | null
  material_id?: number | null
  ledger_code?: string
  ledger_action?: string
  material_code?: string | null
  material_action?: string
  linked_conditions?: number
}

const emptyRow = (): Row => ({
  ledger_title: "",
  ledger_code: "",
  material_name: "",
  material_type: "",
  rights_holder_code: "",
  territory: "",
  language: "",
  source_doc: "",
  remarks: "",
  link_condition_ids: [],
  cl_calc_type: "",
  cl_rate: "",
  cl_mg: "",
  cl_ag: "",
  cl_currency: "",
})

// 取引形態(calc_type)の別名 → コード。CSVで日本語も受け付ける。
const CALC_ALIAS: Record<string, string> = {
  自社製造自社販売: "BASE_QTY_RATE",
  "自社製造・自社販売": "BASE_QTY_RATE",
  権利許諾: "BASE_RATE",
  サブライセンス: "BASE_RATE",
  "権利許諾（サブライセンス）": "BASE_RATE",
  自社製造他社販売: "SUPPLY_QTY",
  "自社製造・他社販売": "SUPPLY_QTY",
  固定: "FIXED",
  固定額: "FIXED",
  サブスク: "SUBSCRIPTION",
  サブスクリプション: "SUBSCRIPTION",
}
const normCalcType = (v: string): string => {
  const k = String(v || "").trim()
  if (!k) return ""
  const up = k.toUpperCase()
  if (["BASE_QTY_RATE", "BASE_RATE", "SUPPLY_QTY", "FIXED", "SUBSCRIPTION"].includes(up)) return up
  return CALC_ALIAS[k] || ""
}

// CSV/TSV のヘッダ(日本語/英語)を Row のキーへ写像。
const HEADER_MAP: Record<string, keyof Row> = {
  原作タイトル: "ledger_title",
  原作: "ledger_title",
  ledger_title: "ledger_title",
  title: "ledger_title",
  原作コード: "ledger_code",
  ledger_code: "ledger_code",
  マテリアル名: "material_name",
  素材名: "material_name",
  material_name: "material_name",
  種別: "material_type",
  ジャンル: "material_type",
  material_type: "material_type",
  取引先コード: "rights_holder_code",
  取引先: "rights_holder_code",
  権利者コード: "rights_holder_code",
  権利者: "rights_holder_code",
  権利元: "rights_holder_code",
  vendor_code: "rights_holder_code",
  rights_holder_code: "rights_holder_code",
  許諾地域: "territory",
  地域: "territory",
  territory: "territory",
  許諾言語: "language",
  言語: "language",
  language: "language",
  根拠文書番号: "source_doc",
  文書番号: "source_doc",
  source_doc: "source_doc",
  備考: "remarks",
  remarks: "remarks",
  取引形態: "cl_calc_type",
  calc_type: "cl_calc_type",
  料率: "cl_rate",
  "料率(%)": "cl_rate",
  rate_pct: "cl_rate",
  MG: "cl_mg",
  最低保証: "cl_mg",
  mg: "cl_mg",
  AG: "cl_ag",
  前払保証: "cl_ag",
  ag: "cl_ag",
  通貨: "cl_currency",
  currency: "cl_currency",
}

const CSV_TEMPLATE = [
  "原作タイトル,原作コード,マテリアル名,種別,取引先コード,許諾地域,許諾言語,根拠文書番号,備考,取引形態,料率,MG,AG,通貨",
  "サンプル作品,,ゲームデザイン,game_design,V-2026-0001,全世界,全言語,,,BASE_QTY_RATE,5,0,0,JPY",
  "サンプル作品,,イラスト一式,illustration,V-2026-0002,日本,日本語,,,権利許諾,8,,,JPY",
].join("\n")

export function BulkImportPanel() {
  const { refreshAll } = useAppData()
  const [tab, setTab] = React.useState<"doc" | "table">("doc")
  const [rows, setRows] = React.useState<Row[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [results, setResults] = React.useState<RowResult[] | null>(null)
  const [summary, setSummary] = React.useState<{ total: number; succeeded: number; failed: number } | null>(null)
  // index → CL作成結果表示("CL ARC-ILT-..." / "CL失敗: ...")
  const [clResults, setClResults] = React.useState<Record<number, string>>({})

  // ── Tab ① 既存文書から ─────────────────────────────
  const [docNumber, setDocNumber] = React.useState<string>("")
  const [loadingDoc, setLoadingDoc] = React.useState(false)
  const [docError, setDocError] = React.useState<string | null>(null)
  const [sharedLedger, setSharedLedger] = React.useState("")

  const onPickDoc = async (detail: ContractDetail) => {
    const num = detail.document_number || detail.contract?.document_number || ""
    setDocNumber(num)
    setDocError(null)
    if (!num) {
      setDocError("文書番号が取得できませんでした")
      return
    }
    // 抽出先の原作: 文書の原作名 → shared 既定へ。
    const guessed = (detail.contract as any)?.original_work || ""
    if (guessed && !sharedLedger) setSharedLedger(guessed)
    setLoadingDoc(true)
    try {
      const res = await fetch(`/api/v3/documents/${encodeURIComponent(num)}/lc-candidates`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const cands: any[] = await res.json()
      const imported: Row[] = (Array.isArray(cands) ? cands : []).map((c) => ({
        ...emptyRow(),
        ledger_title: guessed || sharedLedger || "",
        material_name: c.material_name || c.item_name || "",
        material_type: "",
        // 文書の権利元は名称のため取引先コードには入れず、備考に控える(コードは手入力/検索)。
        rights_holder_code: "",
        territory: "",
        language: "",
        source_doc: c.document_number || num,
        remarks: [c.condition_name, c.rights_holder ? `権利元: ${c.rights_holder}` : ""]
          .filter(Boolean)
          .join(" / "),
        // 素材未リンクCL(unlinked)は取込時に当該マテリアルへ後付けリンクできる。
        link_condition_ids:
          c.unlinked && c.source_condition_id != null ? [Number(c.source_condition_id)] : [],
      }))
      setRows((prev) => [...prev, ...imported])
      if (imported.length === 0) setDocError("この文書から取り込める構成要素は見つかりませんでした。")
    } catch (e: any) {
      setDocError(String(e?.message || e))
    } finally {
      setLoadingDoc(false)
    }
  }

  // ── Tab ② 表貼付/アップロード ─────────────────────
  const [pasteText, setPasteText] = React.useState("")
  const [parseError, setParseError] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const mapParsedRows = (data: any[]): Row[] =>
    data
      .map((raw) => {
        const row = emptyRow()
        for (const [k, v] of Object.entries(raw)) {
          const key = HEADER_MAP[String(k).trim()]
          if (key && key !== "link_condition_ids") {
            ;(row as any)[key] = v == null ? "" : String(v).trim()
          }
        }
        return row
      })
      .filter((r) => r.ledger_title || r.material_name)

  const parsePaste = () => {
    setParseError(null)
    if (!pasteText.trim()) {
      setParseError("貼り付ける内容がありません")
      return
    }
    const parsed = Papa.parse(pasteText.trim(), {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^﻿/, "").trim(),
    })
    const mapped = mapParsedRows(parsed.data as any[])
    if (mapped.length === 0) {
      setParseError("有効な行がありません。ヘッダ行（原作タイトル 等）を含めてください。")
      return
    }
    setRows((prev) => [...prev, ...mapped])
    setPasteText("")
  }

  const onFile = (file: File) => {
    setParseError(null)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^﻿/, "").trim(),
      complete: (r) => {
        const mapped = mapParsedRows(r.data as any[])
        if (mapped.length === 0) {
          setParseError("有効な行がありません。ヘッダ行を確認してください。")
          return
        }
        setRows((prev) => [...prev, ...mapped])
      },
      error: (e) => setParseError(`CSV パース失敗: ${e.message}`),
    })
    if (fileRef.current) fileRef.current.value = ""
  }

  // ── プレビュー編集 ───────────────────────────────
  const patch = (i: number, key: keyof Row, value: string) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)))
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i))
  const clearAll = () => {
    setRows([])
    setResults(null)
    setSummary(null)
    setClResults({})
  }

  // Tab ① の shared 原作を全空欄行へ適用。
  const applySharedLedger = () => {
    if (!sharedLedger.trim()) return
    setRows((prev) => prev.map((r) => (r.ledger_title.trim() ? r : { ...r, ledger_title: sharedLedger.trim() })))
  }

  const missingLedger = rows.filter((r) => !r.ledger_title.trim()).length

  const submit = async () => {
    if (rows.length === 0) return
    setSubmitting(true)
    setResults(null)
    setSummary(null)
    setClResults({})
    try {
      const res = await fetch("/api/master/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      })
      const j = await res.json()
      if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`)
      const rr: RowResult[] = j.results || []
      setResults(rr)
      setSummary({ total: j.total, succeeded: j.succeeded, failed: j.failed })

      // 料率が入っている行は、マテリアルごとに新規ARC-ILTを発番してCL(royalty)を作成する。
      const clOut: Record<number, string> = {}
      for (const r of rr) {
        if (!r.ok || r.material_id == null || r.work_id == null) continue
        const row = rows[r.index]
        if (!row) continue
        const rate = String(row.cl_rate || "").trim()
        if (!rate) continue // 料率が無ければCLは作らない
        const payload: any = {
          payment_scheme: "royalty",
          rate_pct: Number(rate),
          mg_amount: row.cl_mg ? Number(row.cl_mg) : null,
          ag_amount: row.cl_ag ? Number(row.cl_ag) : null,
          currency: (row.cl_currency || "JPY").trim() || "JPY",
          calc_type: normCalcType(row.cl_calc_type) || undefined,
          issue_document: true, // マテリアルごとに新規ARC-ILT器を発番
          condition_name: row.material_name || undefined,
          region_territory: row.territory || undefined,
          region_language: row.language || undefined,
        }
        try {
          const cr = await fetch(
            `/api/v3/source-ips/${r.work_id}/materials/${r.material_id}/condition-lines`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
          )
          const cj = await cr.json()
          if (!cr.ok || !cj?.ok) throw new Error(cj?.error || `HTTP ${cr.status}`)
          clOut[r.index] = `CL ${cj.document_number || "作成"}`
        } catch (e: any) {
          clOut[r.index] = `CL失敗: ${String(e?.message || e)}`
        }
      }
      setClResults(clOut)
      await refreshAll?.().catch(() => {})
    } catch (e: any) {
      setSummary({ total: rows.length, succeeded: 0, failed: rows.length })
      setResults([{ index: -1, ok: false, error: String(e?.message || e) }])
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    "w-full text-[11px] font-mono bg-transparent border-b border-input py-0.5 focus:outline-none focus:border-foreground"
  const th = "px-2 py-1.5 text-left text-[9px] font-mono font-bold uppercase tracking-[0.1em] text-muted-foreground border-b border-border whitespace-nowrap"
  const td = "px-2 py-1 border-b border-border/40 align-top"

  return (
    <div className="max-w-[1200px] space-y-6 p-1">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Upload className="w-5 h-5" /> 一括インポート（原作・原作マテリアル）
        </h1>
        <p className="text-[11px] font-mono text-muted-foreground mt-1">
          既存文書からの抽出、または表(CSV/TSV)の貼り付けで、原作とその原作マテリアルをまとめてDB登録します。
          既存(原作コード/タイトル一致・原作内の同名マテリアル)は更新(upsert)します。
        </p>
      </div>

      {/* タブ */}
      <div className="flex gap-1 border-b border-border">
        {[
          { k: "doc" as const, label: "① 既存文書から", icon: PackageSearch },
          { k: "table" as const, label: "② 表を貼り付け / CSV", icon: Table2 },
        ].map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono border-b-2 -mb-px transition-colors",
              tab === t.k
                ? "border-foreground text-foreground font-bold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "doc" ? (
        <div className="rounded-md border border-violet-200 bg-violet-50/40 p-3 space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-violet-700">
              取込先の原作（未指定の行に一括適用）
            </label>
            <div className="flex items-center gap-2">
              <input
                value={sharedLedger}
                onChange={(e) => setSharedLedger(e.target.value)}
                placeholder="原作タイトル（既存に一致すれば更新、無ければ新規作成）"
                className="flex-1 text-[11px] font-mono bg-white/70 border border-input rounded px-2 py-1 focus:outline-none focus:border-foreground"
              />
              <button
                type="button"
                onClick={applySharedLedger}
                disabled={!sharedLedger.trim() || rows.length === 0}
                className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-violet-400 text-violet-700 hover:bg-violet-100 disabled:opacity-50"
              >
                空欄に適用
              </button>
            </div>
          </div>
          <UnifiedContractPicker
            acceptableRecordTypes={["license_condition", "individual_contract", "purchase_order"]}
            hasParent={false}
            onPick={onPickDoc}
            onClear={() => {}}
            label="発注書 / 利用許諾条件書 / 契約書を検索して取り込む"
          />
          {docNumber && (
            <div className="text-[10px] font-mono text-violet-900/80">
              直近の対象文書: <span className="font-bold">{docNumber}</span>
            </div>
          )}
          {loadingDoc && (
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 構成要素を取得中…
            </div>
          )}
          {docError && <div className="text-[10px] font-mono text-red-600">{docError}</div>}
          <p className="text-[10px] font-mono text-violet-800/70">
            文書を選ぶと、その構成要素（利用許諾条件・発注書成果物・素材未リンクCL）が下のプレビューに追加されます。
            素材未リンクCLは取込時に該当マテリアルへ後付けリンクされます。
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-sky-200 bg-sky-50/40 p-3 space-y-3">
          <label className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-sky-700">
            表を貼り付け（1行目にヘッダ / タブ区切り・カンマ区切り対応）
          </label>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            placeholder={CSV_TEMPLATE}
            className="w-full text-[11px] font-mono bg-white/70 border border-input rounded px-2 py-1.5 focus:outline-none focus:border-foreground whitespace-pre"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={parsePaste}
              className="text-[11px] font-mono px-3 py-1.5 rounded border border-sky-400 text-sky-700 hover:bg-sky-100 inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> 解析してプレビューに追加
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-[11px] font-mono px-3 py-1.5 rounded border border-border text-foreground hover:bg-muted inline-flex items-center gap-1.5"
            >
              <FileUp className="w-3.5 h-3.5" /> CSVファイルを選択
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + CSV_TEMPLATE)}`}
              download="bulk_import_template.csv"
              className="text-[10px] font-mono underline text-sky-700 hover:text-sky-900"
            >
              テンプレCSVをダウンロード
            </a>
          </div>
          {parseError && <div className="text-[10px] font-mono text-red-600">{parseError}</div>}
          <p className="text-[10px] font-mono text-sky-800/70">
            列: 原作タイトル / 原作コード(任意) / マテリアル名 / 種別 / 取引先コード / 許諾地域 / 許諾言語 / 根拠文書番号(任意) / 備考
            / 取引形態 / 料率 / MG / AG / 通貨。権利者は<b>取引先コード</b>（vendors.vendor_code）で指定してください。
            <b>料率</b>を入れた行は、そのマテリアルに<b>新規ARC-ILTを発番して利用許諾CL（royalty）</b>を作成します。
            原作タイトルのみの行は原作だけを登録します。
          </p>
        </div>
      )}

      {/* プレビュー表 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-mono font-bold">
            プレビュー（{rows.length} 行）
            {missingLedger > 0 && (
              <span className="ml-2 text-amber-600">
                <AlertCircle className="inline w-3.5 h-3.5 -mt-0.5" /> 原作タイトル未入力 {missingLedger} 行
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, emptyRow()])}
              className="text-[10px] font-mono px-2 py-1 rounded border border-border hover:bg-muted inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> 行を追加
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={rows.length === 0}
              className="text-[10px] font-mono px-2 py-1 rounded border border-border text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              全消去
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground border border-dashed border-border rounded-md py-8 text-center">
            上のいずれかの方法で行を追加してください。
          </div>
        ) : (
          <div className="overflow-x-auto border border-border rounded-md">
            <table className="w-full border-collapse">
              <thead className="bg-muted/40">
                <tr>
                  <th className={th}>原作タイトル*</th>
                  <th className={th}>原作コード</th>
                  <th className={th}>マテリアル名</th>
                  <th className={th}>種別</th>
                  <th className={th}>取引先コード</th>
                  <th className={th}>許諾地域</th>
                  <th className={th}>許諾言語</th>
                  <th className={th}>根拠文書</th>
                  <th className={cn(th, "bg-indigo-50/60")}>取引形態</th>
                  <th className={cn(th, "bg-indigo-50/60")}>料率%</th>
                  <th className={cn(th, "bg-indigo-50/60")}>MG</th>
                  <th className={cn(th, "bg-indigo-50/60")}>AG</th>
                  <th className={cn(th, "bg-indigo-50/60")}>通貨</th>
                  <th className={th}>リンクCL</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const rr = results?.find((x) => x.index === i)
                  return (
                    <tr key={i} className={rr ? (rr.ok ? "bg-emerald-50/50" : "bg-red-50/50") : ""}>
                      <td className={td}>
                        <input className={inputCls} value={r.ledger_title} onChange={(e) => patch(i, "ledger_title", e.target.value)} placeholder="必須" />
                      </td>
                      <td className={td}><input className={inputCls} value={r.ledger_code} onChange={(e) => patch(i, "ledger_code", e.target.value)} placeholder="任意" /></td>
                      <td className={td}><input className={inputCls} value={r.material_name} onChange={(e) => patch(i, "material_name", e.target.value)} placeholder="任意" /></td>
                      <td className={td}><input className={inputCls} value={r.material_type} onChange={(e) => patch(i, "material_type", e.target.value)} /></td>
                      <td className={td}><input className={inputCls} value={r.rights_holder_code} onChange={(e) => patch(i, "rights_holder_code", e.target.value)} placeholder="取引先コード" /></td>
                      <td className={td}><input className={inputCls} value={r.territory} onChange={(e) => patch(i, "territory", e.target.value)} /></td>
                      <td className={td}><input className={inputCls} value={r.language} onChange={(e) => patch(i, "language", e.target.value)} /></td>
                      <td className={td}><input className={inputCls} value={r.source_doc} onChange={(e) => patch(i, "source_doc", e.target.value)} /></td>
                      <td className={cn(td, "bg-indigo-50/30")}><input className={inputCls} value={r.cl_calc_type} onChange={(e) => patch(i, "cl_calc_type", e.target.value)} placeholder="任意" /></td>
                      <td className={cn(td, "bg-indigo-50/30")}><input className={inputCls} value={r.cl_rate} onChange={(e) => patch(i, "cl_rate", e.target.value)} placeholder="料率で発番" /></td>
                      <td className={cn(td, "bg-indigo-50/30")}><input className={inputCls} value={r.cl_mg} onChange={(e) => patch(i, "cl_mg", e.target.value)} /></td>
                      <td className={cn(td, "bg-indigo-50/30")}><input className={inputCls} value={r.cl_ag} onChange={(e) => patch(i, "cl_ag", e.target.value)} /></td>
                      <td className={cn(td, "bg-indigo-50/30")}><input className={inputCls} value={r.cl_currency} onChange={(e) => patch(i, "cl_currency", e.target.value)} placeholder="JPY" /></td>
                      <td className={cn(td, "text-center text-[10px] font-mono text-muted-foreground")}>
                        {r.link_condition_ids.length > 0 ? `${r.link_condition_ids.length}件` : "—"}
                      </td>
                      <td className={cn(td, "text-center")}>
                        {rr && !rr.ok ? (
                          <span className="text-[9px] font-mono text-red-600" title={rr.error}>失敗</span>
                        ) : rr && rr.ok ? (
                          <span
                            className={cn("text-[9px] font-mono", rr.warning ? "text-amber-600" : "text-emerald-700")}
                            title={rr.warning || clResults[i] || undefined}
                          >
                            {rr.material_action === "created" ? "新規" : rr.material_action === "updated" ? "更新" : rr.ledger_action === "created" ? "原作新規" : "原作更新"}
                            {rr.linked_conditions ? ` +CL${rr.linked_conditions}` : ""}
                            {clResults[i] ? (clResults[i].startsWith("CL失敗") ? " ⚠CL" : " +CL新規") : ""}
                            {rr.warning ? " ⚠取引先未解決" : ""}
                          </span>
                        ) : (
                          <button type="button" onClick={() => removeRow(i)} className="text-muted-foreground hover:text-red-600">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 結果サマリ + 送信 */}
      {summary && (
        <div
          className={cn(
            "px-3 py-2 rounded-md border text-[11px] font-mono",
            summary.failed === 0 ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"
          )}
        >
          取込結果: 成功 {summary.succeeded} / 失敗 {summary.failed}（全 {summary.total} 行）
          {results && results.filter((r) => !r.ok).slice(0, 5).map((r) => (
            <div key={r.index} className="text-[10px] text-red-600 mt-0.5">
              #{r.index + 1}: {r.error}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || rows.length === 0 || missingLedger > 0}
          className="text-[12px] font-mono px-4 py-2 rounded border border-foreground bg-foreground text-background hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-2"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {rows.length} 行を一括登録（upsert）
        </button>
      </div>
    </div>
  )
}

export default BulkImportPanel
