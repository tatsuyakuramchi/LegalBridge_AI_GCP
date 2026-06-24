/**
 * DataLinkagePanel — データモデル整理: 連結チェック＆修復。
 *
 * ばらばらのテーブルに散在/孤児化した「同じ発注条件」レコードを検出し、
 * 安全な範囲で修復する。将来テーブル統合を進める際の点検入口。
 *
 *   GET  /api/admin/data-linkage/check
 *   POST /api/admin/data-linkage/repair { action }
 */

import * as React from "react"
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Wrench,
  Link2,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Check = {
  key: string
  label: string
  description: string
  count: number
  severity: "ok" | "warn" | "error"
  repair_action: string | null
  sample: any[]
  error?: string
}

type CheckResponse = {
  ok: boolean
  generated_at: string
  total_issue_categories: number
  checks: Check[]
}

const REPAIR_LABELS: Record<string, string> = {
  normalize_documents: "form_dataを正規化",
  normalize_drafts: "下書きを正規化",
  prune_orphan_contracts: "孤児ミラーを削除",
  prune_stale_drafts: "古い下書きを削除",
  fix_orphan_refs: "孤児参照をNULL化",
}

export const DataLinkagePanel: React.FC = () => {
  const [data, setData] = React.useState<CheckResponse | null>(null)
  const [issueAudit, setIssueAudit] = React.useState<CheckResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [issueAuditError, setIssueAuditError] = React.useState<string | null>(null)
  const [busyAction, setBusyAction] = React.useState<string | null>(null)
  const [lastRepair, setLastRepair] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    setIssueAuditError(null)
    try {
      const res = await fetch("/api/admin/data-linkage/check")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: CheckResponse = await res.json()
      setData(json)
    } catch (e: any) {
      setError(String(e?.message || e))
    }
    try {
      const res = await fetch("/api/audit/issue-consistency")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: CheckResponse = await res.json()
      setIssueAudit(json)
    } catch (e: any) {
      setIssueAuditError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const runRepair = async (action: string, label: string) => {
    if (
      !window.confirm(
        `修復「${REPAIR_LABELS[action] || action}」を実行します。\n対象: ${label}\nよろしいですか?`
      )
    )
      return
    setBusyAction(action)
    setError(null)
    setLastRepair(null)
    try {
      const res = await fetch("/api/admin/data-linkage/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setLastRepair(
        `「${REPAIR_LABELS[action] || action}」完了: ${json.affected} 件を処理しました。`
      )
      await refresh()
    } catch (e: any) {
      setError(`修復失敗 (${action}): ${e?.message || e}`)
    } finally {
      setBusyAction(null)
    }
  }

  const linkageIssues = data?.checks.filter((c) => c.count > 0) || []
  const cleans = data?.checks.filter((c) => c.count === 0) || []
  const errs = data?.checks.filter((c) => c.count < 0) || []
  const issueAuditIssues = issueAudit?.checks.filter((c) => c.count > 0) || []
  const issueAuditCleans = issueAudit?.checks.filter((c) => c.count === 0) || []
  const issueAuditErrs = issueAudit?.checks.filter((c) => c.count < 0) || []

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center gap-3 flex-wrap">
        <Link2 className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-sm font-mono font-bold uppercase tracking-[0.14em]">
          連結チェック（データ整合性）
        </h1>
        <span className="text-[11px] font-mono text-muted-foreground">
          散在・孤児レコードの検出と安全な修復
        </span>
        <div className="flex-1" />
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
          再点検
        </button>
      </div>

      <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
        `documents.form_data` ⇄ `contract_capabilities` ⇄ v3ミラー ⇄ 下書き 等、
        同じ発注条件が複数テーブルに分散している箇所の不整合を点検します。
        修復は安全側（正規化・孤児削除・孤児参照のNULL化）のみで、発行済の正本は変更しません。
      </p>

      <div className="border border-border rounded-sm p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          <span className="text-[12px] font-mono font-bold">
            課題コントロール整合性監査
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            A1〜A7 / 読み取り専用
          </span>
          {issueAudit && (
            <span
              className={cn(
                "text-[10px] font-mono px-1.5 py-0.5 rounded-sm",
                issueAudit.total_issue_categories > 0
                  ? "bg-amber-100 text-amber-900"
                  : "bg-emerald-50 text-emerald-800"
              )}
            >
              要確認 {issueAudit.total_issue_categories} / {issueAudit.checks.length}
            </span>
          )}
        </div>
        <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
          課題 → 文書 → 条件明細 → 実績の紐づきを、文書取り残し・明細未生成・実績未結合・旧版finalの観点で点検します。
        </p>
        {issueAuditError && (
          <div className="border border-red-200 bg-red-50 text-red-900 rounded-sm px-3 py-2 text-[10px] font-mono">
            監査取得失敗: {issueAuditError}
          </div>
        )}
        {issueAudit && (
          <>
            <div className="text-[10px] font-mono text-muted-foreground">
              点検時刻: {new Date(issueAudit.generated_at).toLocaleString("ja-JP")}
            </div>
            {issueAuditIssues.length > 0 ? (
              <div className="space-y-2">
                {issueAuditIssues.map((c) => (
                  <div key={c.key} className="border border-amber-300 bg-amber-50/40 rounded-sm p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <span className="text-[12px] font-mono font-bold">{c.label}</span>
                      <span className="text-[11px] font-mono px-1.5 py-0.5 bg-amber-200 text-amber-900 rounded-sm">
                        {c.count} 件
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground italic">
                        手動確認
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-muted-foreground mt-1">
                      {c.description}
                    </p>
                    {c.sample.length > 0 && (
                      <div className="mt-2 text-[10px] font-mono text-muted-foreground/80 bg-card border border-border rounded-sm p-2 overflow-x-auto">
                        {c.sample.map((s, i) => (
                          <div key={i} className="whitespace-nowrap">
                            {Object.entries(s)
                              .map(([k, v]) => `${k}=${v}`)
                              .join("  ·  ")}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] font-mono text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                課題コントロール監査の要確認カテゴリはありません。
              </div>
            )}
            {issueAuditCleans.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {issueAuditCleans.map((c) => (
                  <span
                    key={c.key}
                    className="text-[10px] font-mono px-2 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-sm flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    {c.label}
                  </span>
                ))}
              </div>
            )}
            {issueAuditErrs.length > 0 && (
              <div className="border border-border rounded-sm p-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  点検スキップ ({issueAuditErrs.length})
                </div>
                {issueAuditErrs.map((c) => (
                  <div key={c.key} className="text-[10px] font-mono text-muted-foreground">
                    {c.label}: {c.error}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-900 rounded-sm px-4 py-2 text-[11px] font-mono flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}
      {lastRepair && (
        <div className="border border-emerald-200 bg-emerald-50 text-emerald-900 rounded-sm px-4 py-2 text-[11px] font-mono flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          {lastRepair}
        </div>
      )}

      {data && (
        <div className="text-[11px] font-mono text-muted-foreground">
          点検時刻: {new Date(data.generated_at).toLocaleString("ja-JP")} ／ 要対応カテゴリ:{" "}
          <span className={data.total_issue_categories > 0 ? "text-amber-700 font-bold" : "text-emerald-700 font-bold"}>
            {data.total_issue_categories}
          </span>{" "}
          / {data.checks.length}
        </div>
      )}

      {/* 要対応 */}
      {linkageIssues.length > 0 && (
        <div className="space-y-2">
          {linkageIssues.map((c) => (
            <div
              key={c.key}
              className="border border-amber-300 bg-amber-50/40 rounded-sm p-3"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <span className="text-[12px] font-mono font-bold">{c.label}</span>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 bg-amber-200 text-amber-900 rounded-sm">
                      {c.count} 件
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground mt-1">
                    {c.description}
                  </p>
                  {c.sample.length > 0 && (
                    <div className="mt-2 text-[10px] font-mono text-muted-foreground/80 bg-card border border-border rounded-sm p-2 overflow-x-auto">
                      {c.sample.map((s, i) => (
                        <div key={i} className="whitespace-nowrap">
                          {Object.entries(s)
                            .map(([k, v]) => `${k}=${v}`)
                            .join("  ·  ")}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {c.repair_action ? (
                  <button
                    type="button"
                    onClick={() => runRepair(c.repair_action!, c.label)}
                    disabled={!!busyAction}
                    className="text-[10px] font-mono uppercase tracking-wider bg-foreground text-background rounded-sm px-3 py-1.5 hover:opacity-80 flex items-center gap-1.5 disabled:opacity-50 flex-shrink-0"
                  >
                    {busyAction === c.repair_action ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Wrench className="w-3 h-3" />
                    )}
                    {REPAIR_LABELS[c.repair_action] || "修復"}
                  </button>
                ) : (
                  <span className="text-[10px] font-mono text-muted-foreground italic flex-shrink-0">
                    手動対応
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 正常 */}
      {cleans.length > 0 && (
        <div className="border border-border rounded-sm p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
            問題なし ({cleans.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {cleans.map((c) => (
              <span
                key={c.key}
                className="text-[10px] font-mono px-2 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-sm flex items-center gap-1"
              >
                <CheckCircle2 className="w-3 h-3" />
                {c.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 点検失敗(テーブル/列なし等) */}
      {errs.length > 0 && (
        <div className="border border-border rounded-sm p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
            点検スキップ ({errs.length}) — テーブル/列が無い環境など
          </div>
          {errs.map((c) => (
            <div key={c.key} className="text-[10px] font-mono text-muted-foreground">
              {c.label}: {c.error}
            </div>
          ))}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="text-center py-12 text-[12px] font-mono text-muted-foreground">
          点検結果がありません。「再点検」を押してください。
        </div>
      )}
    </div>
  )
}
