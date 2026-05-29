/**
 * ExcelBatchPage (Phase C) — 検収書 / 利用許諾料計算書 の Excel 一括出力。
 *
 * PDF 発行と Excel 生成を切り離した運用に対応する管理画面。
 *   1. GET /api/excel-batches/pending で「Excel 未発行」の確定文書を
 *      種別 (検収書 / 利用許諾料計算書) × 検収担当者 × 支払期日 で集計。
 *   2. 各グループに [Excel 出力] ボタン。POST /api/excel-batches/export に
 *      documentNumbers を渡すと 1 ファイル (複数行) で Drive に出力され、
 *      対象文書の excel_issued_at / excel_link が更新される。
 *   3. 出力済グループは一覧から消え、Drive リンクを表示。
 */

import * as React from "react"
import {
  RefreshCw,
  FileSpreadsheet,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  PackageOpen,
  CalendarClock,
  User,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Group = {
  key: string
  category: "inspection_certificate" | "royalty_statement"
  inspectorEmail: string
  inspectorName: string
  paymentDate: string
  count: number
  documentNumbers: string[]
}

type PendingResponse = {
  success: boolean
  groups: Group[]
  error?: string
}

const CATEGORY_LABELS: Record<string, string> = {
  inspection_certificate: "検収書",
  royalty_statement: "利用許諾料計算書",
}

export const ExcelBatchPage: React.FC = () => {
  const [groups, setGroups] = React.useState<Group[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // グループ key → busy フラグ
  const [busyKeys, setBusyKeys] = React.useState<Record<string, boolean>>({})
  // グループ key → エラー文字列
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({})
  const [lastResult, setLastResult] = React.useState<{
    key: string
    fileName: string
    excelLink: string
    count: number
  } | null>(null)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/excel-batches/pending")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: PendingResponse = await res.json()
      if (!json.success) throw new Error(json.error || "取得に失敗しました")
      setGroups(json.groups || [])
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const exportGroup = async (group: Group) => {
    setBusyKeys((b) => ({ ...b, [group.key]: true }))
    setRowErrors((e) => {
      const copy = { ...e }
      delete copy[group.key]
      return copy
    })
    try {
      const res = await fetch("/api/excel-batches/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentNumbers: group.documentNumbers }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      setLastResult({
        key: group.key,
        fileName: json.fileName,
        excelLink: json.excelLink,
        count: json.count,
      })
      // 出力済グループを一覧から除外
      setGroups((g) => (g ? g.filter((x) => x.key !== group.key) : g))
    } catch (e: any) {
      setRowErrors((prev) => ({
        ...prev,
        [group.key]: String(e?.message || e),
      }))
    } finally {
      setBusyKeys((b) => {
        const copy = { ...b }
        delete copy[group.key]
        return copy
      })
    }
  }

  const total = groups?.reduce((s, g) => s + g.count, 0) || 0

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-4">
      {/* ヘッダ */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base font-bold flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            Excel 一括出力キュー
          </h1>
          <p className="text-[10px] font-mono text-muted-foreground mt-1">
            発行済みだが Excel 未生成の 検収書 / 利用許諾料計算書 を、
            検収担当者 × 支払期日 × 種別 ごとに 1 ファイル (複数行) で出力します。
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
        <div className="border rounded-sm px-4 py-2 text-[11px] font-mono flex items-center justify-between gap-3 bg-emerald-50 border-emerald-200 text-emerald-900">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">
              ✓ Excel 出力完了: {lastResult.fileName} ({lastResult.count} 件)
            </span>
          </div>
          {lastResult.excelLink && (
            <a
              href={lastResult.excelLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 underline flex-shrink-0"
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

      {/* 一覧 */}
      {!groups || total === 0 ? (
        <div className="text-center py-12 border border-dashed border-input rounded-sm bg-muted/10">
          <PackageOpen className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-[12px] font-mono text-muted-foreground">
            Excel 未発行の 検収書 / 利用許諾料計算書 はありません。
          </p>
          <p className="text-[10px] font-mono text-muted-foreground/60 mt-1">
            文書を発行 (確定) すると、ここに出力待ちとして表示されます。
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const busy = !!busyKeys[group.key]
            const rowError = rowErrors[group.key]
            return (
              <div
                key={group.key}
                className={cn(
                  "border rounded-sm bg-card p-4",
                  rowError ? "border-red-300 bg-red-50/40" : "border-border",
                  busy && "opacity-60"
                )}
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          "text-[10px] font-mono px-1.5 py-0.5 rounded-sm uppercase tracking-wider",
                          group.category === "royalty_statement"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-muted"
                        )}
                      >
                        {CATEGORY_LABELS[group.category] || group.category}
                      </span>
                      <span className="text-[11px] font-mono font-bold">
                        {group.count} 件
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {group.inspectorName || "(担当者未設定)"}
                        {group.inspectorEmail && ` <${group.inspectorEmail}>`}
                      </span>
                      <span className="flex items-center gap-1">
                        <CalendarClock className="w-3 h-3" />
                        支払期日: {group.paymentDate || "(未設定)"}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground/60 truncate">
                      {group.documentNumbers.join(", ")}
                    </div>
                  </div>

                  {/* アクション */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => exportGroup(group)}
                      disabled={busy}
                      className="text-[10px] font-mono uppercase tracking-wider bg-foreground text-background rounded-sm px-3 py-1.5 hover:opacity-80 flex items-center gap-1.5 disabled:opacity-50"
                      title="このグループを 1 ファイル (複数行) で Excel 出力して Drive に保存"
                    >
                      {busy ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <FileSpreadsheet className="w-3 h-3" />
                      )}
                      Excel 出力
                    </button>
                  </div>
                </div>

                {rowError && (
                  <div className="mt-3 border border-red-200 bg-red-50 rounded-sm px-3 py-2 flex items-start gap-2 text-[10px] font-mono text-red-800">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="font-bold uppercase tracking-wider text-red-700">
                        Excel 出力失敗
                      </div>
                      <div className="break-all">{rowError}</div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
