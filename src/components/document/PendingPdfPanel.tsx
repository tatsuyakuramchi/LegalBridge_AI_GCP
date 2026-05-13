/**
 * PendingPdfPanel — Phase 15: 一括インポートで「未作成」マーク付きの
 * ドキュメントを 1 件ずつ確認 / 生成 / スキップする UI。
 *
 * 動作:
 *   1. GET /api/documents/pending-pdf で一覧取得
 *   2. テンプレタイプ別タブ切替
 *   3. 各行に [📄 PDF 生成] / [✏️ 編集して生成] / [🚫 スキップ] ボタン
 *   4. 📄 → POST /api/documents/:id/regenerate-pdf → drive_link を返す → 行を一覧から消す
 *   5. ✏️ → /documents/new?from_pending=:id に遷移 (DocumentEditorPage 側で受領)
 *   6. 🚫 → POST /api/documents/:id/mark-as-imported → 行を消す
 */

import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  RefreshCw,
  FileText,
  ExternalLink,
  CheckCircle2,
  Edit3,
  X,
  AlertTriangle,
  Loader2,
  PackageOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Row = {
  id: number
  document_number: string
  issue_key: string
  template_type: string
  document_category: string
  created_at: string
  summary: {
    counterparty: string
    title: string
    staff_email: string
    line_count: number | null
    condition_count: number | null
    variant: string | null
    amount: number | null
  }
}

type ApiResponse = {
  ok: boolean
  total: number
  rows: Row[]
  counts_by_template: Record<string, number>
}

const TEMPLATE_LABELS: Record<string, string> = {
  purchase_order: "発注書",
  individual_license_terms: "個別利用許諾条件書",
  license_master: "ライセンス基本契約書",
  service_master: "業務委託基本契約書",
  nda: "NDA",
  sales_master_buyer: "売買基本(買主)",
  sales_master_standard: "売買基本(標準)",
  sales_master_credit: "売買基本(掛売)",
}

export const PendingPdfPanel: React.FC = () => {
  const navigate = useNavigate()
  const [data, setData] = React.useState<ApiResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedTpl, setSelectedTpl] = React.useState<string>("ALL")
  // 行 ID → 'generating' | 'skipping' (進捗トラッキング)
  const [busyRows, setBusyRows] = React.useState<Record<number, string>>({})
  const [lastResult, setLastResult] = React.useState<{
    id: number
    document_number: string
    drive_link?: string
    action: "generated" | "skipped"
  } | null>(null)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/documents/pending-pdf?limit=200")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: ApiResponse = await res.json()
      setData(json)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const generatePdf = async (row: Row) => {
    setBusyRows((b) => ({ ...b, [row.id]: "generating" }))
    try {
      const res = await fetch(`/api/documents/${row.id}/regenerate-pdf`, {
        method: "POST",
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      setLastResult({
        id: row.id,
        document_number: json.document_number,
        drive_link: json.drive_link,
        action: "generated",
      })
      // 一覧から除外
      setData((d) =>
        d
          ? {
              ...d,
              rows: d.rows.filter((r) => r.id !== row.id),
              total: d.total - 1,
            }
          : d
      )
    } catch (e: any) {
      setError(`PDF 生成失敗 (${row.document_number}): ${e?.message || e}`)
    } finally {
      setBusyRows((b) => {
        const copy = { ...b }
        delete copy[row.id]
        return copy
      })
    }
  }

  const skipRow = async (row: Row) => {
    if (!window.confirm(`${row.document_number} を作成済扱いにしてキューから外しますか?`)) return
    setBusyRows((b) => ({ ...b, [row.id]: "skipping" }))
    try {
      const res = await fetch(`/api/documents/${row.id}/mark-as-imported`, {
        method: "POST",
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setLastResult({
        id: row.id,
        document_number: row.document_number,
        action: "skipped",
      })
      setData((d) =>
        d
          ? {
              ...d,
              rows: d.rows.filter((r) => r.id !== row.id),
              total: d.total - 1,
            }
          : d
      )
    } catch (e: any) {
      setError(`スキップ失敗 (${row.document_number}): ${e?.message || e}`)
    } finally {
      setBusyRows((b) => {
        const copy = { ...b }
        delete copy[row.id]
        return copy
      })
    }
  }

  const editAndGenerate = (row: Row) => {
    // DocumentEditorPage に from_pending=<id> 付きで遷移。
    // 編集ページ側でこの ID を見て documents から form_data を読み込んで pre-fill する。
    navigate(`/documents/new?from_pending=${row.id}`)
  }

  const filteredRows = React.useMemo(() => {
    if (!data) return []
    if (selectedTpl === "ALL") return data.rows
    return data.rows.filter((r) => r.template_type === selectedTpl)
  }, [data, selectedTpl])

  return (
    <div className="space-y-4">
      {/* ヘッダ */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <FileText className="w-5 h-5" />
            PDF 未作成キュー
          </h2>
          <p className="text-[10px] font-mono text-muted-foreground mt-1">
            CSV 一括インポートで「未作成」マーク付きで登録された文書を、
            内容を確認しながら 1 件ずつ PDF 化します。
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className={cn(
            "text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-3 py-1.5 flex items-center gap-1.5 hover:bg-muted",
            loading && "opacity-50 cursor-not-allowed"
          )}
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          リロード
        </button>
      </div>

      {/* 直近結果 */}
      {lastResult && (
        <div
          className={cn(
            "border rounded-sm px-4 py-2 text-[11px] font-mono flex items-center justify-between gap-3",
            lastResult.action === "generated"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-amber-50 border-amber-200 text-amber-900"
          )}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {lastResult.action === "generated"
              ? `✓ PDF 生成完了: ${lastResult.document_number}`
              : `✓ スキップ済: ${lastResult.document_number}`}
          </div>
          {lastResult.drive_link && (
            <a
              href={lastResult.drive_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 underline"
            >
              <ExternalLink className="w-3 h-3" />
              Drive で開く
            </a>
          )}
        </div>
      )}

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-900 rounded-sm px-4 py-2 text-[11px] font-mono flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* テンプレ別タブ */}
      {data && Object.keys(data.counts_by_template).length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-border pb-2">
          <TabButton
            label="すべて"
            count={data.total}
            active={selectedTpl === "ALL"}
            onClick={() => setSelectedTpl("ALL")}
          />
          {Object.entries(data.counts_by_template).map(([tpl, n]) => (
            <TabButton
              key={tpl}
              label={TEMPLATE_LABELS[tpl] || tpl}
              count={n}
              active={selectedTpl === tpl}
              onClick={() => setSelectedTpl(tpl)}
            />
          ))}
        </div>
      )}

      {/* 一覧 */}
      {!data || data.total === 0 ? (
        <div className="text-center py-12 border border-dashed border-input rounded-sm bg-muted/10">
          <PackageOpen className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-[12px] font-mono text-muted-foreground">
            PDF 未作成のドキュメントはありません。
          </p>
          <p className="text-[10px] font-mono text-muted-foreground/60 mt-1">
            CSV インポートで <code>generate_pdf=未作成</code> を指定すると、
            ここに表示されます。
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRows.map((row) => {
            const busy = busyRows[row.id]
            return (
              <div
                key={row.id}
                className={cn(
                  "border border-border rounded-sm bg-card p-4",
                  busy && "opacity-60"
                )}
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 bg-muted rounded-sm uppercase tracking-wider">
                        {TEMPLATE_LABELS[row.template_type] || row.template_type}
                      </span>
                      <span className="text-[11px] font-mono font-bold">
                        {row.document_number}
                      </span>
                      {row.summary.variant && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-sm">
                          {row.summary.variant}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-foreground truncate">
                      {row.summary.title || "(タイトル未設定)"}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                      {row.summary.counterparty && (
                        <span>取引先: {row.summary.counterparty}</span>
                      )}
                      {row.summary.line_count != null && (
                        <span>明細 {row.summary.line_count} 行</span>
                      )}
                      {row.summary.condition_count != null && (
                        <span>金銭条件 {row.summary.condition_count} 件</span>
                      )}
                      {row.summary.amount && (
                        <span>
                          税抜 ¥
                          {Number(row.summary.amount).toLocaleString("ja-JP")}
                        </span>
                      )}
                      {row.summary.staff_email && (
                        <span>担当: {row.summary.staff_email}</span>
                      )}
                    </div>
                  </div>

                  {/* アクション */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => editAndGenerate(row)}
                      disabled={!!busy}
                      className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-2.5 py-1.5 hover:bg-muted flex items-center gap-1.5 disabled:opacity-50"
                      title="DocumentEditorPage を開いて編集してから PDF 生成"
                    >
                      <Edit3 className="w-3 h-3" />
                      編集して生成
                    </button>
                    <button
                      type="button"
                      onClick={() => generatePdf(row)}
                      disabled={!!busy}
                      className="text-[10px] font-mono uppercase tracking-wider bg-foreground text-background rounded-sm px-3 py-1.5 hover:opacity-80 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {busy === "generating" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <FileText className="w-3 h-3" />
                      )}
                      PDF 生成
                    </button>
                    <button
                      type="button"
                      onClick={() => skipRow(row)}
                      disabled={!!busy}
                      className="text-[10px] font-mono uppercase tracking-wider border border-muted-foreground/30 text-muted-foreground rounded-sm px-2.5 py-1.5 hover:bg-muted flex items-center gap-1.5 disabled:opacity-50"
                      title="このドキュメントを「作成済」扱いにしてキューから外す"
                    >
                      <X className="w-3 h-3" />
                      スキップ
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const TabButton: React.FC<{
  label: string
  count: number
  active: boolean
  onClick: () => void
}> = ({ label, count, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-sm border transition-colors",
      active
        ? "bg-foreground text-background border-foreground"
        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
    )}
  >
    {label}
    <span
      className={cn(
        "ml-1.5 inline-flex items-center justify-center min-w-[20px] px-1 rounded-sm text-[9px]",
        active ? "bg-background/20" : "bg-muted"
      )}
    >
      {count}
    </span>
  </button>
)
