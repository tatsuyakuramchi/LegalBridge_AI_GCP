/**
 * ExcelBatchPage (Phase C) — 検収書 / 利用許諾料計算書 の Excel 一括出力。
 *
 * 担当者(検収担当者)を親にした表示:
 *   担当者Y  ●件  [Excel作成]   ← 展開で詳細(各検収+検収日)
 *   担当者Z  ●件  [Excel作成]
 *
 * ファイルは「担当者 × 支払期日 × 種別」ごとに 1 ファイル(複数行)で出力するため、
 * 1 担当者に複数(支払期日/種別)があるときは「作成」で複数ファイルを順次出力する。
 *   1. GET /api/excel-batches/pending で未発行確定文書を上記キーで集計(items に検収日同梱)。
 *   2. POST /api/excel-batches/export に documentNumbers を渡すと 1 ファイル出力 + Drive 保存。
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
  ChevronRight,
  ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Item = {
  document_number: string
  inspection_date: string
  title: string
  counterparty: string
}

type Group = {
  key: string
  category: "inspection_certificate" | "royalty_statement"
  inspectorEmail: string
  inspectorName: string
  paymentDate: string
  count: number
  documentNumbers: string[]
  items: Item[]
}

type PendingResponse = {
  success: boolean
  groups: Group[]
  error?: string
}

type Inspector = {
  email: string
  name: string
  count: number
  groups: Group[]
}

const CATEGORY_LABELS: Record<string, string> = {
  inspection_certificate: "検収書",
  royalty_statement: "利用許諾料計算書",
}

export const ExcelBatchPage: React.FC = () => {
  const [groups, setGroups] = React.useState<Group[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // 担当者 email → busy
  const [busyInspectors, setBusyInspectors] = React.useState<Record<string, boolean>>({})
  // 担当者 email → 展開
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [lastResult, setLastResult] = React.useState<{
    label: string
    files: number
    failed: number
    links: Array<{ fileName: string; excelLink: string }>
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

  // 担当者(検収担当者)で集約
  const inspectors: Inspector[] = React.useMemo(() => {
    if (!groups) return []
    const m = new Map<string, Inspector>()
    for (const g of groups) {
      const email = g.inspectorEmail || ""
      const k = email || g.inspectorName || "(担当者未設定)"
      let insp = m.get(k)
      if (!insp) {
        insp = {
          email: k,
          name: g.inspectorName || "(担当者未設定)",
          count: 0,
          groups: [],
        }
        m.set(k, insp)
      }
      insp.count += g.count
      insp.groups.push(g)
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, "ja"))
  }, [groups])

  // 1 グループ(担当者×支払期日×種別)を 1 ファイル出力。成功で state から除外。
  //   出力ファイル名と Drive リンクを返す。
  const exportOneGroup = async (
    group: Group
  ): Promise<{ fileName: string; excelLink: string }> => {
    const res = await fetch("/api/excel-batches/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentNumbers: group.documentNumbers }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) {
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    setGroups((g) => (g ? g.filter((x) => x.key !== group.key) : g))
    return {
      fileName: json.fileName || group.key,
      excelLink: json.excelLink || "",
    }
  }

  // 担当者単位で作成(サブグループを順次出力 = 支払期日/種別ごとに別ファイル)
  const exportInspector = async (insp: Inspector) => {
    const fileCount = insp.groups.length
    if (
      fileCount > 1 &&
      !window.confirm(
        `${insp.name} の Excel を作成します。\n支払期日・種別が異なるため ${fileCount} 個のファイルに分かれて出力されます。よろしいですか?`
      )
    )
      return
    setBusyInspectors((b) => ({ ...b, [insp.email]: true }))
    setError(null)
    let ok = 0
    let fail = 0
    const links: Array<{ fileName: string; excelLink: string }> = []
    for (const g of [...insp.groups]) {
      try {
        const r = await exportOneGroup(g)
        ok++
        links.push(r)
      } catch (e: any) {
        fail++
        setError(`${insp.name} の出力で失敗: ${e?.message || e}`)
      }
    }
    setBusyInspectors((b) => {
      const copy = { ...b }
      delete copy[insp.email]
      return copy
    })
    setLastResult({ label: insp.name, files: ok, failed: fail, links })
  }

  const total = groups?.reduce((s, g) => s + g.count, 0) || 0

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-4">
      {/* ヘッダ */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base font-bold flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            Excel 一括出力キュー（担当者区切り）
          </h1>
          <p className="text-[10px] text-muted-foreground mt-1">
            発行済みだが Excel 未生成の 検収書 / 利用許諾料計算書 を
            <b>検収担当者ごと</b>にまとめて表示。出力は 担当者 × 支払期日 × 種別 ごとに
            1 ファイル (複数行) です。
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

      {/* 直近結果 + 保管先リンク */}
      {lastResult && (
        <div
          className={cn(
            "border rounded-sm px-4 py-2 text-[11px] font-mono flex flex-col gap-1.5",
            lastResult.failed > 0
              ? "bg-warning/10 border-warning/40 text-warning"
              : "bg-success/10 border-success/40 text-success"
          )}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            {lastResult.label}: Excel {lastResult.files} ファイル出力
            {lastResult.failed > 0 && ` / 失敗 ${lastResult.failed}`}
          </div>
          {lastResult.links.length > 0 && (
            <div className="flex flex-col gap-0.5 pl-6">
              {lastResult.links.map((l, i) =>
                l.excelLink ? (
                  <a
                    key={i}
                    href={l.excelLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 underline w-fit"
                  >
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    {l.fileName} を Drive で開く
                  </a>
                ) : (
                  <span key={i} className="text-muted-foreground">
                    {l.fileName}（リンク取得不可）
                  </span>
                )
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="border border-destructive/40 bg-destructive/10 text-destructive rounded-sm px-4 py-2 text-[11px] font-mono flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* 一覧(担当者区切り) */}
      {!groups || total === 0 ? (
        <div className="text-center py-12 border border-dashed border-input rounded-sm bg-muted/10">
          <PackageOpen className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-[12px] text-muted-foreground">
            Excel 未発行の 検収書 / 利用許諾料計算書 はありません。
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            文書を発行 (確定) すると、ここに出力待ちとして表示されます。
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {inspectors.map((insp) => {
            const busy = !!busyInspectors[insp.email]
            const isOpen = !!expanded[insp.email]
            const fileCount = insp.groups.length
            return (
              <div
                key={insp.email}
                className={cn(
                  "border border-border rounded-sm bg-card",
                  busy && "opacity-60"
                )}
              >
                {/* 担当者ヘッダ */}
                <div className="flex items-center justify-between gap-3 p-4 flex-wrap">
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((e) => ({ ...e, [insp.email]: !e[insp.email] }))
                    }
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                  >
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 flex-shrink-0" />
                    )}
                    <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-[12px] font-mono font-bold truncate">
                      {insp.name}
                    </span>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 bg-muted rounded-sm">
                      {insp.count} 件
                    </span>
                    {fileCount > 1 && (
                      <span className="text-[10px] text-muted-foreground">
                        ({fileCount} ファイル)
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => exportInspector(insp)}
                    disabled={busy}
                    className="text-[10px] uppercase tracking-wider bg-foreground text-background rounded-sm px-3 py-1.5 hover:opacity-80 flex items-center gap-1.5 disabled:opacity-50 flex-shrink-0"
                    title="この担当者の Excel を作成 (支払期日/種別ごとに別ファイル)"
                  >
                    {busy ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-3 h-3" />
                    )}
                    Excel 作成
                  </button>
                </div>

                {/* 詳細(展開) */}
                {isOpen && (
                  <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/10">
                    {insp.groups.map((g) => (
                      <div key={g.key} className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
                          <span
                            className={cn(
                              "px-1.5 py-0.5 rounded-sm uppercase tracking-wider",
                              g.category === "royalty_statement"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted"
                            )}
                          >
                            {CATEGORY_LABELS[g.category] || g.category}
                          </span>
                          <span className="flex items-center gap-1">
                            <CalendarClock className="w-3 h-3" />
                            支払期日: {g.paymentDate || "(未設定)"}
                          </span>
                          <span>· {g.count} 件 (1ファイル)</span>
                        </div>
                        <table className="w-full text-[10px] font-mono">
                          <thead>
                            <tr className="text-muted-foreground/70 text-left">
                              <th className="py-0.5 pr-3 font-normal">検収書番号</th>
                              <th className="py-0.5 pr-3 font-normal">検収日</th>
                              <th className="py-0.5 font-normal">件名 / 取引先</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.items.map((it) => (
                              <tr key={it.document_number} className="border-t border-border/40">
                                <td className="py-0.5 pr-3 whitespace-nowrap font-bold">
                                  {it.document_number}
                                </td>
                                <td className="py-0.5 pr-3 whitespace-nowrap">
                                  {it.inspection_date || "—"}
                                </td>
                                <td className="py-0.5 text-muted-foreground truncate max-w-[280px]">
                                  {it.title || it.counterparty || "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
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
