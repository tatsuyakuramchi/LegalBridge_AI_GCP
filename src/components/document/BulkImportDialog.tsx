/**
 * BulkImportDialog — CSV 一括インポート用の共通モーダル (Phase 10)。
 *
 * 流れ:
 *   1. CSV を選択 / ドロップ
 *   2. クライアント側で papaparse → JSON 化
 *   3. import_key でグループ化してプレビュー
 *   4. ユーザーが確認して「インポート実行」
 *   5. /api/imports/bulk/:kind を叩く
 *   6. 成功/失敗を行単位で表示。失敗行は CSV ダウンロード可能
 *
 * テンプレ DL ボタン: /api/imports/bulk/templates/:kind を新タブで取得
 */

import * as React from "react"
import Papa from "papaparse"
import {
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  FileSpreadsheet,
  PartyPopper,
} from "lucide-react"
import { cn } from "@/lib/utils"

type BulkKind =
  | "order"
  | "license-contract"
  | "license-master"
  | "service-master"
  | "nda"
  | "sales-master"
  | "ringi"

interface Props {
  kind: BulkKind
  label: string
  open: boolean
  onClose: () => void
  /**
   * インポート完了時に呼ばれる。ImportPage が一覧を refresh 等するための hook。
   */
  onCompleted?: (summary: BulkResult) => void
}

export type BulkResult = {
  ok: boolean
  total_rows: number
  groups: number
  succeeded: any[]
  failed: { import_key: string; error: string }[]
}

/**
 * CSV 行を解析後の preview row 型。客先用に最小列だけ持つ。
 */
type PreviewGroup = {
  import_key: string
  row_count: number
  first_row: Record<string, any>
}

const GROUP_BY_KEY = "import_key"

export const BulkImportDialog: React.FC<Props> = ({
  kind,
  label,
  open,
  onClose,
  onCompleted,
}) => {
  const [csvRows, setCsvRows] = React.useState<Record<string, any>[] | null>(
    null
  )
  const [parseError, setParseError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [result, setResult] = React.useState<BulkResult | null>(null)
  const [fileName, setFileName] = React.useState<string>("")
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // ダイアログを閉じるときに状態リセット
  const closeAll = () => {
    setCsvRows(null)
    setParseError(null)
    setResult(null)
    setFileName("")
    if (fileInputRef.current) fileInputRef.current.value = ""
    onClose()
  }

  const handleFile = (file: File) => {
    setFileName(file.name)
    setParseError(null)
    setCsvRows(null)
    setResult(null)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      // BOM + CRLF を吸収。boolean っぽい文字列は string のまま (サーバが解釈)
      transformHeader: (h) => h.replace(/^﻿/, "").trim(),
      complete: (results) => {
        if (results.errors && results.errors.length > 0) {
          // 警告だけのケースもあるので、致命的だけ
          const fatal = results.errors.find(
            (e) => e.type === "FieldMismatch" || e.type === "Delimiter"
          )
          if (fatal) {
            setParseError(`CSV パース失敗: ${fatal.message}`)
            return
          }
        }
        const rows = (results.data as any[]).filter((r) =>
          // 全列空の行を除去
          Object.values(r).some((v) => v != null && String(v).trim() !== "")
        )
        if (rows.length === 0) {
          setParseError("CSV にデータ行がありません")
          return
        }
        setCsvRows(rows)
      },
      error: (err) => {
        setParseError(String(err?.message || err))
      },
    })
  }

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  // import_key でグループ化したプレビュー用配列
  const groups: PreviewGroup[] = React.useMemo(() => {
    if (!csvRows) return []
    const m = new Map<string, PreviewGroup>()
    csvRows.forEach((r, idx) => {
      const k =
        r[GROUP_BY_KEY] != null &&
        String(r[GROUP_BY_KEY]).trim().length > 0
          ? String(r[GROUP_BY_KEY]).trim()
          : `__ROW_${idx}__`
      const existing = m.get(k)
      if (existing) {
        existing.row_count++
      } else {
        m.set(k, { import_key: k, row_count: 1, first_row: r })
      }
    })
    return Array.from(m.values())
  }, [csvRows])

  const submit = async () => {
    if (!csvRows || csvRows.length === 0) return
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch(`/api/imports/bulk/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: csvRows }),
      })
      const data: BulkResult = await res.json()
      setResult(data)
      onCompleted?.(data)
    } catch (e: any) {
      setResult({
        ok: false,
        total_rows: csvRows.length,
        groups: groups.length,
        succeeded: [],
        failed: [
          {
            import_key: "(connection)",
            error: String(e?.message || e),
          },
        ],
      })
    } finally {
      setSubmitting(false)
    }
  }

  // テンプレ CSV ダウンロード — anchor だと apiRouter (fetch 監視のみ) を
  // 通らないので、fetch でバイナリ取得して blob 経由でダウンロード。
  const downloadTemplate = async () => {
    try {
      const res = await fetch(`/api/imports/bulk/templates/${kind}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `import_template_${kind}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setParseError(`テンプレ DL 失敗: ${e?.message || e}`)
    }
  }

  const downloadFailedRows = () => {
    if (!result || result.failed.length === 0 || !csvRows) return
    const failedKeys = new Set(result.failed.map((f) => f.import_key))
    const failedRows = csvRows.filter((r) =>
      failedKeys.has(
        String(r[GROUP_BY_KEY] || "").trim() || `__ROW_${csvRows.indexOf(r)}__`
      )
    )
    // 1 行目に「__import_error」 列を足してエラー理由を含める
    const errorByKey = new Map(result.failed.map((f) => [f.import_key, f.error]))
    const enriched = failedRows.map((r) => ({
      ...r,
      __import_error:
        errorByKey.get(String(r[GROUP_BY_KEY] || "").trim()) || "",
    }))
    const csv = Papa.unparse(enriched)
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `import_failed_${kind}_${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={closeAll}
    >
      <div
        className="bg-card border border-border rounded-sm shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-muted/30 border-b border-border px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            <span className="text-[11px] font-mono uppercase tracking-wider font-bold">
              CSV 一括インポート
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              · {label}
            </span>
          </div>
          <button
            type="button"
            onClick={closeAll}
            className="text-muted-foreground hover:text-foreground p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Step 1: Template DL */}
          <div className="border border-input rounded-sm bg-muted/20 p-3 flex items-center justify-between gap-3">
            <div className="text-[10px] font-mono">
              <div className="font-bold uppercase tracking-wider text-muted-foreground">
                Step 1. テンプレ DL
              </div>
              <div className="text-muted-foreground mt-1">
                空の CSV テンプレを Excel で開いて編集してください。1 行 = 1 明細
                (or 1 金銭条件)、<code className="bg-card px-1">import_key</code>{" "}
                列で同じ文書をグループ化します。
              </div>
              {kind === "order" && (
                <div className="text-muted-foreground mt-1 leading-relaxed">
                  Phase 17i: <code className="bg-card px-1">row_type</code> 列で
                  「item」（業務明細）と「expense」（経費・税込み）を判別します。
                  経費行は <code className="bg-card px-1">expense_name</code> /
                  <code className="bg-card px-1">spent_date</code> /
                  <code className="bg-card px-1">amount_inc_tax</code> /
                  <code className="bg-card px-1">remarks</code> を使用してください。
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={downloadTemplate}
              className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-3 py-1.5 hover:bg-muted flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3 h-3" />
              テンプレ.csv
            </button>
          </div>

          {/* Step 2: File pick / drop */}
          {!result && (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onDrop={onDrop}
              className="border-2 border-dashed border-input rounded-sm p-5 text-center bg-muted/10"
            >
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-bold mb-1">
                Step 2. CSV を選択
              </div>
              <Upload className="w-8 h-8 mx-auto text-muted-foreground/40 my-2" />
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onPickFile}
                className="hidden"
                id={`bulk-import-file-${kind}`}
              />
              <label
                htmlFor={`bulk-import-file-${kind}`}
                className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-3 py-1.5 hover:bg-muted cursor-pointer inline-flex items-center gap-1.5"
              >
                <Upload className="w-3 h-3" />
                ファイル選択 or ドロップ
              </label>
              {fileName && (
                <div className="text-[10px] font-mono text-muted-foreground mt-2">
                  選択中: <span className="font-bold">{fileName}</span>
                </div>
              )}
              {parseError && (
                <div className="text-[10px] font-mono text-red-700 bg-red-50 border border-red-200 rounded-sm p-2 mt-3 flex items-start gap-1.5 text-left">
                  <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  {parseError}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Preview */}
          {csvRows && !result && (
            <div className="space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-muted-foreground">
                Step 3. プレビュー — {csvRows.length} 行 / {groups.length} 件の文書
              </div>
              <div className="border border-input rounded-sm max-h-[280px] overflow-y-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead className="bg-muted/40 text-[9px] uppercase tracking-wider sticky top-0">
                    <tr>
                      <th className="text-left p-1.5 w-8">#</th>
                      <th className="text-left p-1.5">import_key</th>
                      <th className="text-right p-1.5">明細数</th>
                      <th className="text-left p-1.5">主要フィールド</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g, idx) => (
                      <tr key={g.import_key} className="border-t border-border/50">
                        <td className="p-1.5 text-muted-foreground">{idx + 1}</td>
                        <td className="p-1.5 font-bold">{g.import_key}</td>
                        <td className="p-1.5 text-right">{g.row_count}</td>
                        <td className="p-1.5 text-muted-foreground truncate max-w-[280px]">
                          {kind === "order"
                            ? `${g.first_row.issue_key || "(auto)"} · ${g.first_row.vendor_name || g.first_row.vendor_code || ""} · ${g.first_row.description || ""}`
                            : kind === "license-contract"
                              ? `${g.first_row.licensor_name || ""} → ${g.first_row.licensee_name || ""} · ${g.first_row.original_work || ""}`
                              : kind === "license-master"
                                ? `${g.first_row.basic_contract_name || g.first_row.original_work || ""}`
                                : kind === "nda"
                                  ? `${g.first_row.party_a_name || ""} × ${g.first_row.party_b_name || ""} · ${g.first_row.contract_title || ""}`
                                  : kind === "sales-master"
                                    ? `[${g.first_row.variant || "standard"}] ${g.first_row.contract_title || g.first_row.party_b_name || ""}`
                                    : kind === "ringi"
                                      ? `稟議 ${g.first_row.ringi_number || "-"} · ${g.first_row.title || ""}`
                                      : `${g.first_row.contract_title || g.first_row.vendor_name || ""}`}
                          {g.first_row.generate_pdf === "未作成" && (
                            <span className="ml-2 text-[9px] px-1 py-0.5 bg-amber-100 text-amber-800 rounded-sm">
                              📄 PDF 生成
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 4: Result */}
          {result && (
            <div className="space-y-3">
              <div
                className={cn(
                  "rounded-sm p-3 flex items-center gap-3 border",
                  result.failed.length === 0
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : "bg-amber-50 border-amber-200 text-amber-900"
                )}
              >
                {result.failed.length === 0 ? (
                  <PartyPopper className="w-5 h-5" />
                ) : (
                  <AlertTriangle className="w-5 h-5" />
                )}
                <div className="text-[11px] font-mono">
                  <div className="font-bold">
                    {result.failed.length === 0
                      ? "すべて成功"
                      : `${result.succeeded.length} 成功 / ${result.failed.length} 失敗`}
                  </div>
                  <div className="text-[10px] mt-0.5 opacity-75">
                    {result.total_rows} 行 / {result.groups} 件の文書
                  </div>
                </div>
              </div>

              {result.succeeded.length > 0 && (
                <div className="border border-input rounded-sm max-h-[200px] overflow-y-auto">
                  <div className="bg-emerald-50 px-2 py-1 text-[9px] font-mono uppercase tracking-wider text-emerald-700 sticky top-0 flex items-center gap-1">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    成功 ({result.succeeded.length})
                  </div>
                  <table className="w-full text-[10px] font-mono">
                    <tbody>
                      {result.succeeded.map((s, idx) => (
                        <tr key={idx} className="border-t border-border/50">
                          <td className="p-1.5 text-muted-foreground w-8">
                            {idx + 1}
                          </td>
                          <td className="p-1.5 font-bold">{s.import_key}</td>
                          <td className="p-1.5">
                            {s.document_number || s.contract_number}
                          </td>
                          <td className="p-1.5 text-muted-foreground">
                            {s.issue_key}
                            {/* Phase 22.21.27/28: bulk import の Backlog 自動化結果 */}
                            {(s as any).issue_key_created && (
                              <span
                                className="ml-1 px-1 py-0.5 text-[8px] font-mono uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 rounded-sm"
                                title={`Backlog 課題を新規作成しました (種別: ${(s as any).backlog_issue_type || "—"})`}
                              >
                                NEW · {(s as any).backlog_issue_type || "?"}
                              </span>
                            )}
                            {(s as any).pdf_pending && (
                              <span
                                className="ml-1 px-1 py-0.5 text-[8px] font-mono uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 rounded-sm"
                                title="PDF 未作成。Document Editor で PDF を生成してから完了に進めると 納品・検収 子課題が自動作成されます"
                              >
                                PDF 未作成
                              </span>
                            )}
                            {(s as any).auto_completed && (
                              <span
                                className="ml-1 px-1 py-0.5 text-[8px] font-mono uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-sm"
                                title="完了に自動進行 + 納品・検収 子課題自動作成"
                              >
                                ✓完了
                              </span>
                            )}
                            {(s as any).delivery_child_issue_key && (
                              <span
                                className="ml-1 text-[9px] text-emerald-700"
                                title="納品・検収 子課題"
                              >
                                → {(s as any).delivery_child_issue_key}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.failed.length > 0 && (
                <div className="border border-input rounded-sm max-h-[200px] overflow-y-auto">
                  <div className="bg-red-50 px-2 py-1 text-[9px] font-mono uppercase tracking-wider text-red-700 sticky top-0 flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      失敗 ({result.failed.length})
                    </span>
                    <button
                      type="button"
                      onClick={downloadFailedRows}
                      className="text-[9px] font-mono uppercase tracking-wider border border-red-700/30 rounded-sm px-1.5 py-0.5 hover:bg-red-100 flex items-center gap-1"
                    >
                      <Download className="w-2.5 h-2.5" />
                      失敗行 .csv
                    </button>
                  </div>
                  <table className="w-full text-[10px] font-mono">
                    <tbody>
                      {result.failed.map((f, idx) => (
                        <tr key={idx} className="border-t border-border/50">
                          <td className="p-1.5 text-muted-foreground w-8">
                            {idx + 1}
                          </td>
                          <td className="p-1.5 font-bold">{f.import_key}</td>
                          <td className="p-1.5 text-red-700 break-all">
                            {f.error}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-muted/30 border-t border-border px-5 py-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={closeAll}
            className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-3 py-1.5 hover:bg-muted"
          >
            閉じる
          </button>
          {csvRows && !result && (
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className={cn(
                "text-[10px] font-mono uppercase tracking-wider rounded-sm px-4 py-1.5 flex items-center gap-1.5",
                submitting
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-foreground text-background hover:opacity-80"
              )}
            >
              {submitting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Upload className="w-3 h-3" />
              )}
              {submitting ? "送信中..." : `${groups.length} 件をインポート`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
