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
import { MATERIAL_GENRES, normalizeGenre } from "@/lib/materialVocab"

// 取引形態(calc_type)の固定選択肢。v3 の CALC_TYPE_OPTION_MAP と同じ語彙。
const CALC_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "BASE_QTY_RATE", label: "① 自社製造・自社販売（価格×個数×料率）" },
  { value: "BASE_RATE", label: "② 権利許諾・サブライセンス（価格×料率）" },
  { value: "SUPPLY_QTY", label: "③ 自社製造・他社販売（供給価格×個数×料率）" },
  { value: "FIXED", label: "固定額" },
  { value: "SUBSCRIPTION", label: "サブスクリプション" },
]

type Row = {
  ledger_title: string
  ledger_code: string
  work_code: string // 作品(own work) W-…
  work_name: string
  material_code: string
  material_name: string
  material_type: string
  rights_holder_code: string
  territory: string
  language: string
  source_doc: string
  remarks: string
  link_condition_ids: number[]
  // CL(金銭条件): cl_id 空=新規作成(料率があれば) / cl_id あり=既存CLを更新(往復修正)。
  cl_id: string
  cl_calc_type: string
  cl_rate: string
  cl_mg: string
  cl_ag: string
  cl_currency: string
  cl_direction: string // 請求の向き: receivable(当社受領) / payable(当社支払)
  cl_ownership: string // 権利帰属(成果物帰属): 発注者 / 受注者
  // 器(文書=contract_capabilities)レベル項目。CLの器へ後付け更新する。
  cap_scope: string // 契約スコープ: service(業務委託) / license_use(利用許諾)
  cap_record_type: string // 契約種類コード(master_contract/individual_contract/standalone_contract/license_condition)
  cap_title: string
  cap_effective: string
  cap_expiration: string
  cap_auto_renewal: string // "はい" / "いいえ" / ""
  cap_doc_url: string
  cap_master_doc: string
}

// レコード区分(器 record_type)。既存 ContractsPanel の「レコード区分」に一致:
//   基本契約=親 / 個別契約=子 / 単独契約=単体。license_condition は旧「個別契約」系。
const RECORD_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "master_contract", label: "基本契約 (親)" },
  { value: "individual_contract", label: "個別契約 (子)" },
  { value: "standalone_contract", label: "単独契約 (単体)" },
]
const RT_ALIAS: Record<string, string> = {
  基本契約: "master_contract",
  親: "master_contract",
  個別契約: "individual_contract",
  子: "individual_contract",
  単独契約: "standalone_contract",
  単独: "standalone_contract",
  単体: "standalone_contract",
  // 旧値: 利用許諾条件書は個別契約(子)系。取り込み時は individual_contract に寄せる。
  利用許諾条件書: "individual_contract",
  利用許諾条件: "individual_contract",
  license_condition: "individual_contract",
}
const normRecordType = (v: string): string => {
  const k = String(v || "").trim()
  if (!k) return ""
  if (RECORD_TYPE_OPTIONS.some((o) => o.value === k) || k === "license_condition") return k
  // "基本契約 (親)" のような括弧付きラベルも受ける(括弧内を除去して照合)。
  const base = k.replace(/[（(].*?[）)]/g, "").trim()
  return RT_ALIAS[base] || RT_ALIAS[k] || ""
}
const recordTypeLabel = (v: string): string => {
  if (v === "license_condition") return "個別契約 (子/旧)"
  return RECORD_TYPE_OPTIONS.find((o) => o.value === v)?.label || v || ""
}

// 契約スコープ(器 scope)。ContractsPanel と同じ 業務委託 / 利用許諾。
const SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: "service", label: "業務委託" },
  { value: "license_use", label: "利用許諾" },
]
const SCOPE_ALIAS: Record<string, string> = {
  業務委託: "service",
  サービス: "service",
  利用許諾: "license_use",
  ライセンス: "license_use",
  license: "license_use",
}
const normScope = (v: string): string => {
  const k = String(v || "").trim()
  if (!k) return ""
  if (SCOPE_OPTIONS.some((o) => o.value === k)) return k
  return SCOPE_ALIAS[k] || ""
}
// 請求の向き(CL direction)。receivable=当社受領 / payable=当社支払。
const DIRECTION_OPTIONS: { value: string; label: string }[] = [
  { value: "receivable", label: "当社受領" },
  { value: "payable", label: "当社支払" },
]
const DIR_ALIAS: Record<string, string> = {
  当社受領: "receivable",
  受領: "receivable",
  receivable: "receivable",
  out: "receivable",
  当社支払: "payable",
  支払: "payable",
  payable: "payable",
  in: "payable",
}
const normDirection = (v: string): string => {
  const k = String(v || "").trim()
  if (!k) return ""
  return DIR_ALIAS[k] || (["receivable", "payable"].includes(k) ? k : "")
}
// 権利帰属(deliverable_ownership)。値は 発注者 / 受注者(DBそのまま)。
const OWNERSHIP_OPTIONS: { value: string; label: string }[] = [
  { value: "発注者", label: "発注者帰属" },
  { value: "受注者", label: "受注者帰属" },
]
const normOwnership = (v: string): string => {
  const k = String(v || "").trim()
  if (k.includes("受注")) return "受注者"
  if (k.includes("発注")) return "発注者"
  return ""
}

type RowResult = {
  index: number
  ok: boolean
  error?: string
  warning?: string
  work_id?: number | null
  own_work_id?: number | null
  own_work_code?: string | null
  material_id?: number | null
  ledger_code?: string
  ledger_action?: string
  material_code?: string | null
  material_action?: string
  linked_conditions?: number
  cl_updated?: number
}

const emptyRow = (): Row => ({
  ledger_title: "",
  ledger_code: "",
  work_code: "",
  work_name: "",
  material_code: "",
  material_name: "",
  material_type: "",
  rights_holder_code: "",
  territory: "",
  language: "",
  source_doc: "",
  remarks: "",
  link_condition_ids: [],
  cl_id: "",
  cl_calc_type: "",
  cl_rate: "",
  cl_mg: "",
  cl_ag: "",
  cl_currency: "",
  cl_direction: "",
  cl_ownership: "",
  cap_scope: "",
  cap_record_type: "",
  cap_title: "",
  cap_effective: "",
  cap_expiration: "",
  cap_auto_renewal: "",
  cap_doc_url: "",
  cap_master_doc: "",
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
  作品コード: "work_code",
  work_code: "work_code",
  作品名: "work_name",
  work_name: "work_name",
  マテリアルコード: "material_code",
  material_code: "material_code",
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
  請求の向き: "cl_direction",
  direction: "cl_direction",
  権利帰属: "cl_ownership",
  成果物帰属: "cl_ownership",
  deliverable_ownership: "cl_ownership",
  スコープ: "cap_scope",
  契約スコープ: "cap_scope",
  scope: "cap_scope",
  "CL-ID": "cl_id",
  CLID: "cl_id",
  cl_id: "cl_id",
  契約種類: "cap_record_type",
  契約種別: "cap_record_type",
  record_type: "cap_record_type",
  契約タイトル: "cap_title",
  contract_title: "cap_title",
  契約開始日: "cap_effective",
  effective_date: "cap_effective",
  契約終了日: "cap_expiration",
  expiration_date: "cap_expiration",
  自動更新: "cap_auto_renewal",
  auto_renewal: "cap_auto_renewal",
  文書リンク: "cap_doc_url",
  document_url: "cap_doc_url",
  基本契約番号: "cap_master_doc",
  master_document_number: "cap_master_doc",
}

const CSV_TEMPLATE = [
  "原作コード,原作タイトル,作品コード,作品名,マテリアルコード,マテリアル名,種別,取引先コード,許諾地域,許諾言語,根拠文書番号,備考,取引形態,料率,MG,AG,通貨,請求の向き,権利帰属,CL-ID,スコープ,契約種類,契約タイトル,契約開始日,契約終了日,自動更新,文書リンク,基本契約番号",
  "LO-2026-0001,,W-2026-0001,自社ボードゲームA,LO-2026-0001-002,ゲームデザイン,game_design,V-2026-0001,全世界,全言語,,,BASE_QTY_RATE,5,0,0,JPY,当社受領,発注者,,利用許諾,個別契約,X社 個別利用許諾,2026-04-01,2027-03-31,はい,https://drive.example/doc,ARC-LIC-2026-0001",
  ",新規サンプル作品,,新製品B,,イラスト一式,illustration,V-2026-0002,日本,日本語,,,権利許諾,8,,,JPY,当社支払,受注者,,利用許諾,単独契約,,,,いいえ,,",
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
  // 器(文書)メタを更新した件数
  const [metaCount, setMetaCount] = React.useState(0)

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
        // 種別・取引形態・契約種類は固定語彙へ正規化(貼付の表記ゆれをコードに寄せる)。
        if (row.material_type) row.material_type = normalizeGenre(row.material_type) || ""
        if (row.cl_calc_type) row.cl_calc_type = normCalcType(row.cl_calc_type)
        if (row.cap_record_type) row.cap_record_type = normRecordType(row.cap_record_type)
        if (row.cap_scope) row.cap_scope = normScope(row.cap_scope)
        if (row.cl_direction) row.cl_direction = normDirection(row.cl_direction)
        if (row.cl_ownership) row.cl_ownership = normOwnership(row.cl_ownership)
        return row
      })
      .filter((r) => r.ledger_title || r.ledger_code || r.material_name)

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
    setMetaCount(0)
  }

  // ── 現状エクスポート（原作×マテリアル×CL を取込と同じスキーマで） ──────
  const [exporting, setExporting] = React.useState(false)

  const fetchState = async (): Promise<Row[]> => {
    const res = await fetch("/api/master/bulk-export")
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return (Array.isArray(data) ? data : []).map((d: any) => ({
      ...emptyRow(),
      ledger_code: d.ledger_code || "",
      ledger_title: d.ledger_title || "",
      work_code: d.work_code || "",
      work_name: d.work_name || "",
      material_code: d.material_code || "",
      material_name: d.material_name || "",
      material_type: d.material_type || "",
      rights_holder_code: d.rights_holder_code || "",
      territory: d.territory || "",
      language: d.language || "",
      source_doc: d.source_doc || "",
      remarks: d.remarks || "",
      cl_id: d.cl_id != null ? String(d.cl_id) : "",
      cl_calc_type: d.cl_calc_type || "",
      cl_rate: d.cl_rate != null ? String(d.cl_rate) : "",
      cl_mg: d.cl_mg != null ? String(d.cl_mg) : "",
      cl_ag: d.cl_ag != null ? String(d.cl_ag) : "",
      cl_currency: d.cl_currency || "",
      cl_direction: d.cl_direction || "",
      cl_ownership: d.cl_ownership || "",
      cap_scope: d.cap_scope || "",
      cap_record_type: d.cap_record_type || "",
      cap_title: d.cap_title || "",
      cap_effective: d.cap_effective ? String(d.cap_effective).slice(0, 10) : "",
      cap_expiration: d.cap_expiration ? String(d.cap_expiration).slice(0, 10) : "",
      cap_auto_renewal: d.cap_auto_renewal === true ? "はい" : d.cap_auto_renewal === false ? "いいえ" : "",
      cap_doc_url: d.cap_doc_url || "",
      cap_master_doc: d.cap_master_doc || "",
    }))
  }

  const downloadCsv = async () => {
    setExporting(true)
    try {
      const rs = await fetchState()
      const csvRows = rs.map((r) => ({
        原作コード: r.ledger_code,
        原作タイトル: r.ledger_title,
        作品コード: r.work_code,
        作品名: r.work_name,
        マテリアルコード: r.material_code,
        マテリアル名: r.material_name,
        種別: r.material_type,
        取引先コード: r.rights_holder_code,
        許諾地域: r.territory,
        許諾言語: r.language,
        根拠文書番号: r.source_doc,
        備考: r.remarks,
        取引形態: r.cl_calc_type,
        料率: r.cl_rate,
        MG: r.cl_mg,
        AG: r.cl_ag,
        通貨: r.cl_currency,
        請求の向き: r.cl_direction,
        権利帰属: r.cl_ownership,
        "CL-ID": r.cl_id,
        スコープ: r.cap_scope,
        契約種類: r.cap_record_type,
        契約タイトル: r.cap_title,
        契約開始日: r.cap_effective,
        契約終了日: r.cap_expiration,
        自動更新: r.cap_auto_renewal,
        文書リンク: r.cap_doc_url,
        基本契約番号: r.cap_master_doc,
      }))
      const csv = "﻿" + Papa.unparse(csvRows)
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const stamp = new Date().toISOString().slice(0, 10)
      a.download = `bulk_state_${stamp}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      window.alert(`エクスポートに失敗しました: ${String(e?.message || e)}`)
    } finally {
      setExporting(false)
    }
  }

  const loadStateIntoPreview = async () => {
    setExporting(true)
    try {
      // CL-ID 付きで読み込む。CL-IDのある行は再登録で既存CLを更新(往復修正)、
      //   CL-IDが無く料率のある行は新規CL作成。原作/マテリアルは material_name 一致で upsert。
      const rs = await fetchState()
      setRows(rs)
      setResults(null)
      setSummary(null)
      setClResults({})
    } catch (e: any) {
      window.alert(`読み込みに失敗しました: ${String(e?.message || e)}`)
    } finally {
      setExporting(false)
    }
  }

  // Tab ① の shared 原作を全空欄行へ適用。
  const applySharedLedger = () => {
    if (!sharedLedger.trim()) return
    setRows((prev) => prev.map((r) => (r.ledger_title.trim() ? r : { ...r, ledger_title: sharedLedger.trim() })))
  }

  // 原作はコード優先。コードもタイトルも無い行は未指定。
  const missingLedger = rows.filter((r) => !r.ledger_code.trim() && !r.ledger_title.trim()).length

  const submit = async () => {
    if (rows.length === 0) return
    setSubmitting(true)
    setResults(null)
    setSummary(null)
    setClResults({})
    setMetaCount(0)
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

      // 料率が入っている行は、マテリアルごとにCL(royalty)を作成する。器(文書)の決定:
      //   ・根拠文書番号あり → その既存器にCLを付ける(発番しない)。
      //   ・根拠文書番号なし → 新規ARC-ILTを発番(同一マテリアルの先頭のみ発番し、
      //                        返却 capability_id を以降の空欄行で再利用=1マテリアル1器)。
      const clOut: Record<number, string> = {}
      const capByMaterial: Record<number, number> = {} // material_id → 新規発番した capability_id
      const capDocByIndex: Record<number, string> = {} // 行 index → 確定した器の文書番号
      for (const r of rr) {
        if (!r.ok || r.material_id == null || r.work_id == null) continue
        const row = rows[r.index]
        if (!row) continue
        // CL-ID のある行は backend が既存CLを更新済み → 新規作成しない(重複防止)。
        if (String(row.cl_id || "").trim()) continue
        const rate = String(row.cl_rate || "").trim()
        if (!rate) continue // 料率が無ければCLは作らない
        const srcDoc = String(row.source_doc || "").trim()
        const existingCap = capByMaterial[r.material_id]
        // 器の選択: ①根拠文書番号(明示) > ②同マテリアルで発番済み器の再利用 > ③新規発番。
        const capSel: any = srcDoc
          ? { document_number: srcDoc }
          : existingCap
            ? { capability_id: existingCap }
            : { issue_document: true }
        const payload: any = {
          payment_scheme: "royalty",
          rate_pct: Number(rate),
          mg_amount: row.cl_mg ? Number(row.cl_mg) : null,
          ag_amount: row.cl_ag ? Number(row.cl_ag) : null,
          currency: (row.cl_currency || "JPY").trim() || "JPY",
          calc_type: normCalcType(row.cl_calc_type) || undefined,
          condition_name: row.material_name || undefined,
          region_territory: row.territory || undefined,
          region_language: row.language || undefined,
          ...capSel,
        }
        try {
          const cr = await fetch(
            `/api/v3/source-ips/${r.work_id}/materials/${r.material_id}/condition-lines`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
          )
          const cj = await cr.json()
          if (!cr.ok || !cj?.ok) throw new Error(cj?.error || `HTTP ${cr.status}`)
          // 新規発番した器のみ material に紐付けて以降の空欄行で再利用(明示指定行は上書きしない)。
          if (!srcDoc && cj.capability_id != null) capByMaterial[r.material_id] = Number(cj.capability_id)
          if (cj.document_number) capDocByIndex[r.index] = String(cj.document_number)
          // 新規CLに 請求の向き / 権利帰属 / 作品(work_id) を後付け(cj.id が返る)。
          const dir = normDirection(row.cl_direction)
          const own = normOwnership(row.cl_ownership)
          const ownWork = r.own_work_id ?? undefined
          if (cj.id != null && (dir || own || ownWork != null)) {
            try {
              await fetch("/api/master/condition-line-meta", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: cj.id, direction: dir || undefined, deliverable_ownership: own || undefined, work_id: ownWork }),
              })
            } catch {
              /* CLメタ後付け失敗は致命的でない */
            }
          }
          clOut[r.index] = `CL ${cj.document_number || "作成"}`
        } catch (e: any) {
          clOut[r.index] = `CL失敗: ${String(e?.message || e)}`
        }
      }

      // 器(文書)レベル項目の後付け更新。行の器文書番号(CL作成で確定 or 根拠文書番号)ごとに
      //   契約種別/タイトル/期間/更新/文書リンク/基本契約参照を1回だけ反映する。
      const metaByDoc: Record<string, any> = {}
      for (const r of rr) {
        if (!r.ok) continue
        const row = rows[r.index]
        if (!row) continue
        const docNum = capDocByIndex[r.index] || String(row.source_doc || "").trim()
        if (!docNum) continue
        const hasMeta =
          row.cap_scope || row.cap_record_type || row.cap_title || row.cap_effective || row.cap_expiration ||
          row.cap_auto_renewal || row.cap_doc_url || row.cap_master_doc
        if (!hasMeta || metaByDoc[docNum]) continue
        metaByDoc[docNum] = {
          document_number: docNum,
          scope: normScope(row.cap_scope) || undefined,
          record_type: normRecordType(row.cap_record_type) || undefined,
          contract_title: row.cap_title || undefined,
          effective_date: row.cap_effective || undefined,
          expiration_date: row.cap_expiration || undefined,
          auto_renewal: row.cap_auto_renewal || undefined,
          document_url: row.cap_doc_url || undefined,
          master_document_number: row.cap_master_doc || undefined,
        }
      }
      let metaUpdated = 0
      for (const payload of Object.values(metaByDoc)) {
        try {
          const mr = await fetch("/api/master/capability-meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
          const mj = await mr.json()
          if (mr.ok && mj?.ok && mj.updated) metaUpdated += mj.updated
        } catch {
          /* 器メタ更新の失敗は致命的でないため握りつぶし、他を継続 */
        }
      }

      setClResults(clOut)
      setMetaCount(metaUpdated)
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Upload className="w-5 h-5" /> 一括インポート（原作・原作マテリアル）
          </h1>
          <p className="text-[11px] font-mono text-muted-foreground mt-1">
            既存文書からの抽出、または表(CSV/TSV)の貼り付けで、原作とその原作マテリアルをまとめてDB登録します。
            既存(原作コード/タイトル一致・原作内の同名マテリアル)は更新(upsert)します。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={downloadCsv}
            disabled={exporting}
            className="text-[10px] font-mono px-2.5 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1.5"
            title="現状の 原作×マテリアル×CL を取込と同じ列でCSV出力"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 rotate-180" />}
            現状をCSVダウンロード
          </button>
          <button
            type="button"
            onClick={loadStateIntoPreview}
            disabled={exporting}
            className="text-[10px] font-mono px-2.5 py-1.5 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 inline-flex items-center gap-1.5"
            title="現状(原作・マテリアル・CL)をプレビューに読み込み、その場で修正して再登録(upsert)。CL-ID付き行は既存CLを更新します。"
          >
            現状を読み込んで修正
          </button>
        </div>
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
            列: 原作コード / 原作タイトル / マテリアルコード / マテリアル名 / 種別 / 取引先コード / 許諾地域 / 許諾言語 /
            根拠文書番号(任意) / 備考 / 取引形態 / 料率 / MG / AG / 通貨 / CL-ID。原作は<b>原作コード（LO-…）で既存を指定</b>、
            作品（自社作品）は<b>作品コード（W-…）で既存を指定</b>、作品名のみなら新規作成しCLの対象作品に紐づけます、
            マテリアルは<b>マテリアルコード（LO-…-NNN）で既存を指定</b>（コード一致ならマテリアル名の変更＝リネームも反映）、
            新規作成する場合のみ原作タイトルを入れます。権利者は<b>取引先コード</b>（vendors.vendor_code）で指定してください。
            種別・取引形態は固定語彙（貼付時に自動正規化。プレビューはドロップダウン選択）。
            <b>CL-IDのある行は既存CLを更新</b>（料率/取引形態/MG/AG/通貨を上書き）、
            <b>CL-IDが空で料率のある行は新規CL（royalty）を作成</b>します。新規CLの器（文書）は
            根拠文書番号があればその既存文書、空なら新規ARC-ILTを発番（同一マテリアルの空欄行は
            先頭で発番した1つの器にまとめます）。マテリアル名が空の行は原作だけを登録します。
            「現状をCSVダウンロード」→修正→再取込で、CL値のブレも往復修正できます。
            <b>CL項目</b>：請求の向き（当社受領/当社支払）/ 権利帰属（発注者/受注者）も列で指定できます。
            <b>文書(器)項目</b>：スコープ（業務委託/利用許諾）/ 契約種類＝<b>レコード区分</b>（基本契約=親 / 個別契約=子 / 単独契約=単体）/
            契約タイトル / 契約開始日・終了日 / 自動更新 / 文書リンク / 基本契約番号 を入れると、そのCLの器（文書）へ反映します。
            基本契約番号は「個別契約(子)」が参照する親の文書番号です。
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
                <AlertCircle className="inline w-3.5 h-3.5 -mt-0.5" /> 原作(コード/タイトル)未入力 {missingLedger} 行
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
                  <th className={th}>原作コード*</th>
                  <th className={th}>原作タイトル</th>
                  <th className={cn(th, "bg-emerald-50/60")}>作品コード</th>
                  <th className={cn(th, "bg-emerald-50/60")}>作品名</th>
                  <th className={th}>マテリアルコード</th>
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
                  <th className={cn(th, "bg-indigo-50/60")}>請求の向き</th>
                  <th className={cn(th, "bg-indigo-50/60")}>権利帰属</th>
                  <th className={cn(th, "bg-slate-100/70")}>スコープ</th>
                  <th className={cn(th, "bg-slate-100/70")}>契約種類</th>
                  <th className={cn(th, "bg-slate-100/70")}>契約タイトル</th>
                  <th className={cn(th, "bg-slate-100/70")}>開始日</th>
                  <th className={cn(th, "bg-slate-100/70")}>終了日</th>
                  <th className={cn(th, "bg-slate-100/70")}>自動更新</th>
                  <th className={cn(th, "bg-slate-100/70")}>文書リンク</th>
                  <th className={cn(th, "bg-slate-100/70")}>基本契約番号</th>
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
                        <input className={inputCls} value={r.ledger_code} onChange={(e) => patch(i, "ledger_code", e.target.value)} placeholder="LO-… (既存)" />
                      </td>
                      <td className={td}><input className={inputCls} value={r.ledger_title} onChange={(e) => patch(i, "ledger_title", e.target.value)} placeholder="新規作成時に必須" /></td>
                      <td className={cn(td, "bg-emerald-50/30")}><input className={inputCls} value={r.work_code} onChange={(e) => patch(i, "work_code", e.target.value)} placeholder="W-… (既存)" /></td>
                      <td className={cn(td, "bg-emerald-50/30")}><input className={inputCls} value={r.work_name} onChange={(e) => patch(i, "work_name", e.target.value)} placeholder="作品名(新規作成)" /></td>
                      <td className={td}><input className={inputCls} value={r.material_code} onChange={(e) => patch(i, "material_code", e.target.value)} placeholder="LO-…-NNN (既存)" /></td>
                      <td className={td}><input className={inputCls} value={r.material_name} onChange={(e) => patch(i, "material_name", e.target.value)} placeholder="任意" /></td>
                      <td className={td}>
                        <select className={inputCls} value={r.material_type} onChange={(e) => patch(i, "material_type", e.target.value)}>
                          <option value="">—</option>
                          {MATERIAL_GENRES.map((g) => (
                            <option key={g.value} value={g.value}>{g.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className={td}><input className={inputCls} value={r.rights_holder_code} onChange={(e) => patch(i, "rights_holder_code", e.target.value)} placeholder="取引先コード" /></td>
                      <td className={td}><input className={inputCls} value={r.territory} onChange={(e) => patch(i, "territory", e.target.value)} /></td>
                      <td className={td}><input className={inputCls} value={r.language} onChange={(e) => patch(i, "language", e.target.value)} /></td>
                      <td className={td}><input className={inputCls} value={r.source_doc} onChange={(e) => patch(i, "source_doc", e.target.value)} /></td>
                      <td className={cn(td, "bg-indigo-50/30")}>
                        <select className={inputCls} value={r.cl_calc_type} onChange={(e) => patch(i, "cl_calc_type", e.target.value)}>
                          <option value="">—</option>
                          {CALC_TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className={cn(td, "bg-indigo-50/30")}><input className={inputCls} value={r.cl_rate} onChange={(e) => patch(i, "cl_rate", e.target.value)} placeholder="料率で発番" /></td>
                      <td className={cn(td, "bg-indigo-50/30")}><input className={inputCls} value={r.cl_mg} onChange={(e) => patch(i, "cl_mg", e.target.value)} /></td>
                      <td className={cn(td, "bg-indigo-50/30")}><input className={inputCls} value={r.cl_ag} onChange={(e) => patch(i, "cl_ag", e.target.value)} /></td>
                      <td className={cn(td, "bg-indigo-50/30")}><input className={inputCls} value={r.cl_currency} onChange={(e) => patch(i, "cl_currency", e.target.value)} placeholder="JPY" /></td>
                      <td className={cn(td, "bg-indigo-50/30")}>
                        <select className={inputCls} value={r.cl_direction} onChange={(e) => patch(i, "cl_direction", e.target.value)}>
                          <option value="">—</option>
                          {DIRECTION_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className={cn(td, "bg-indigo-50/30")}>
                        <select className={inputCls} value={r.cl_ownership} onChange={(e) => patch(i, "cl_ownership", e.target.value)}>
                          <option value="">—</option>
                          {OWNERSHIP_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className={cn(td, "bg-slate-50")}>
                        <select className={inputCls} value={r.cap_scope} onChange={(e) => patch(i, "cap_scope", e.target.value)}>
                          <option value="">—</option>
                          {SCOPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className={cn(td, "bg-slate-50")}>
                        <select className={inputCls} value={r.cap_record_type} onChange={(e) => patch(i, "cap_record_type", e.target.value)}>
                          <option value="">—</option>
                          {RECORD_TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                          {/* 旧値(利用許諾条件書等)は選択中のみ残す(上書き消去しない)。 */}
                          {r.cap_record_type && !RECORD_TYPE_OPTIONS.some((o) => o.value === r.cap_record_type) && (
                            <option value={r.cap_record_type}>{recordTypeLabel(r.cap_record_type)}</option>
                          )}
                        </select>
                      </td>
                      <td className={cn(td, "bg-slate-50")}><input className={inputCls} value={r.cap_title} onChange={(e) => patch(i, "cap_title", e.target.value)} placeholder="自動生成" /></td>
                      <td className={cn(td, "bg-slate-50")}><input type="date" className={inputCls} value={r.cap_effective} onChange={(e) => patch(i, "cap_effective", e.target.value)} /></td>
                      <td className={cn(td, "bg-slate-50")}><input type="date" className={inputCls} value={r.cap_expiration} onChange={(e) => patch(i, "cap_expiration", e.target.value)} /></td>
                      <td className={cn(td, "bg-slate-50")}>
                        <select className={inputCls} value={r.cap_auto_renewal} onChange={(e) => patch(i, "cap_auto_renewal", e.target.value)}>
                          <option value="">—</option>
                          <option value="はい">はい</option>
                          <option value="いいえ">いいえ</option>
                        </select>
                      </td>
                      <td className={cn(td, "bg-slate-50")}><input className={inputCls} value={r.cap_doc_url} onChange={(e) => patch(i, "cap_doc_url", e.target.value)} placeholder="https://…" /></td>
                      <td className={cn(td, "bg-slate-50")}><input className={inputCls} value={r.cap_master_doc} onChange={(e) => patch(i, "cap_master_doc", e.target.value)} placeholder="ARC-LIC-… (基本契約)" /></td>
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
                            {rr.cl_updated ? " CL更新" : ""}
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
          {metaCount > 0 ? ` ／ 文書メタ更新 ${metaCount} 件` : ""}
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
