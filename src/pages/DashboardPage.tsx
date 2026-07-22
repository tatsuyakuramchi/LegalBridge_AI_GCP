import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  RefreshCw,
  ArrowRight,
  AlertCircle,
  FileText,
  Inbox,
  Loader2,
  CheckCircle2,
  FolderKanban,
  FilePlus2,
  ListChecks,
  Building2,
} from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { ModuleHeader } from "@/src/components/form"
import { Badge } from "@/components/ui/badge"
import { useSkin } from "@/src/lib/skin"
import { NervDashboard } from "@/src/components/nerv/NervDashboard"

// clean/blue 基調のアクセント(設計 §6.2: 生の sky/emerald/amber ではなく状態トークン)。
const TOP: Record<string, string> = {
  sky: "border-t-primary",
  violet: "border-t-info",
  emerald: "border-t-success",
  amber: "border-t-warning",
}
const TXT: Record<string, string> = {
  sky: "text-primary",
  violet: "text-info",
  emerald: "text-success",
  amber: "text-warning",
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { skin } = useSkin()
  const {
    dashboardStats,
    refreshDashboardStats,
    isRefreshingStats,
    templateList,
  } = useAppData()

  React.useEffect(() => {
    refreshDashboardStats()
  }, [refreshDashboardStats])

  // EVA スキン時は NERV ダッシュボード(実データ配線済み)を表示。retro は新デザイン版。
  if (skin === "eva") {
    return <NervDashboard />
  }

  // データ構造刷新 Phase A: 課題行クリックは課題詳細ページへ。
  const openIssue = (key: string) => {
    navigate(`/issues/${encodeURIComponent(key)}`)
  }

  // 業務動線(依頼 → 案件 → 文書 → 終了)を4ステップのナビカードで提示。
  const flow: Array<{
    n: string; label: string; en: string; to: string
    value: number | null; unit: string; Icon: any; accent: keyof typeof TOP
  }> = [
    { n: "①", label: "依頼を確認", en: "Requests", to: "/requests", value: dashboardStats?.totalIssues ?? 0, unit: "件 アクティブ", Icon: Inbox, accent: "sky" },
    { n: "②", label: "案件へまとめる", en: "Matters", to: "/matters", value: null, unit: "作成 / 紐づけ", Icon: FolderKanban, accent: "violet" },
    { n: "③", label: "文書・レビュー作成", en: "Documents", to: "/documents/new", value: dashboardStats?.totalDocuments ?? 0, unit: "件 発行済み", Icon: FilePlus2, accent: "emerald" },
    { n: "④", label: "条件明細・終了", en: "Conditions", to: "/condition-lines", value: null, unit: "消化 / 検収", Icon: ListChecks, accent: "amber" },
  ]

  return (
    <div className="relative">
      <div className="relative px-6 py-8 max-w-[1400px] mx-auto space-y-7">
        {/* Page header */}
        <ModuleHeader
          eyebrow="オペレーション コンソール"
          title="ダッシュボード"
          description="依頼 → 案件 → 文書・法務レビュー → ステータス変更で終了。ここが業務の起点です。"
          actions={
            <>
              <Button size="sm" onClick={() => navigate("/documents/new")}>
                <FilePlus2 /> 文書を作成
              </Button>
              <Button variant="outline" size="sm" onClick={refreshDashboardStats} disabled={isRefreshingStats}>
                <RefreshCw className={isRefreshingStats ? "animate-spin" : ""} /> 更新
              </Button>
            </>
          }
        />

        {/* 業務動線レール */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-2">
            業務動線
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {flow.map((f, i) => {
              const Icon = f.Icon
              return (
                <button
                  key={f.en}
                  onClick={() => navigate(f.to)}
                  className={`group text-left rounded-xl border border-border border-t-[3px] ${TOP[f.accent]} bg-card p-4 hover:bg-muted/40 hover:border-foreground/30 transition-colors`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-[13px] font-semibold ${TXT[f.accent]}`}>{f.n} {f.label}</span>
                    <Icon className={`h-4 w-4 ${TXT[f.accent]}`} />
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      {f.value != null ? (
                        <p className={`text-3xl font-bold tab-mono leading-none ${TXT[f.accent]}`}>{f.value}</p>
                      ) : (
                        <p className="text-lg font-bold leading-none text-foreground">開く</p>
                      )}
                      <p className="mt-1.5 text-[11px] text-muted-foreground">{f.unit}</p>
                    </div>
                    <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                      {f.en} <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Pipeline + side rail */}
        <div className="grid grid-cols-12 gap-6">
          <section className="col-span-12 lg:col-span-8 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                依頼パイプライン（Requests）
              </h3>
              <span className="text-[11px] text-muted-foreground">
                {dashboardStats?.issueDetails?.length ?? 0} issues · {templateList.length} テンプレ
              </span>
            </div>

            <div className="space-y-2">
              {isRefreshingStats && !dashboardStats ? (
                <div className="p-12 flex flex-col items-center gap-3 border border-dashed border-border rounded-xl">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    Backlog と同期しています…
                  </p>
                </div>
              ) : (dashboardStats?.issueDetails?.length ?? 0) === 0 ? (
                <div className="p-12 text-center border border-dashed border-border rounded-xl">
                  <p className="text-sm text-muted-foreground">アクティブな依頼はありません。</p>
                </div>
              ) : (
                dashboardStats?.issueDetails?.slice(0, 12).map((issue: any, idx: number) => (
                  <button
                    key={`stats-${issue.issueKey || idx}-${idx}`}
                    onClick={() => openIssue(issue.issueKey)}
                    className="group w-full text-left flex items-center justify-between gap-4 px-4 py-3 bg-card border border-border rounded-xl hover:border-foreground/50 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <span
                        className={`h-10 w-1 rounded-full shrink-0 ${
                          issue.status?.name === "完了" ? "bg-success" : "bg-warning"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] font-mono font-bold tab-mono text-muted-foreground">
                          {issue.issueKey}
                        </p>
                        <p className="text-sm font-semibold truncate group-hover:text-foreground transition-colors">
                          {issue.summary}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant="outline" className="h-4 text-[11px]">
                            {issue.status?.name ?? "—"}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {issue.assignee?.name || "Unassigned"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-bold tab-mono">{issue.documentCount ?? 0}</p>
                        <p className="text-[11px] text-muted-foreground">docs</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </button>
                ))
              )}
            </div>

            <Button variant="outline" className="w-full border-dashed" onClick={() => navigate("/requests")}>
              すべての依頼を見る
            </Button>
          </section>

          <aside className="col-span-12 lg:col-span-4 space-y-4">
            {/* 最近の成果物 */}
            <div className="rounded-xl border border-border border-t-[3px] border-t-success bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] font-semibold text-success">最近作成した文書</p>
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
              </div>
              <ul className="space-y-2.5">
                {(dashboardStats?.recentActivity ?? []).slice(0, 8).map((doc: any, idx: number) => (
                  <li key={doc.id || `recent-${idx}`} className="border-l-2 border-success/40 pl-3 py-0.5">
                    <p className="text-xs font-mono font-bold truncate">{doc.template_type}</p>
                    <p className="text-[11px] font-mono text-muted-foreground">
                      {doc.issue_key} ·{" "}
                      {doc.created_at ? new Date(doc.created_at).toLocaleDateString("ja-JP") : "—"}
                    </p>
                  </li>
                ))}
                {(dashboardStats?.recentActivity ?? []).length === 0 && (
                  <li className="text-xs text-muted-foreground/70 py-3">
                    まだ文書は作成されていません。
                  </li>
                )}
              </ul>
            </div>

            {/* クイックアクセス(マスタ) */}
            <div className="rounded-xl border border-border border-t-[3px] border-t-info bg-card p-4">
              <p className="text-[13px] font-semibold text-info mb-3">マスタ / DB管理</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "取引先", to: "/master/vendors", Icon: Building2 },
                  { label: "作品/原作", to: "/works", Icon: FileText },
                  { label: "原作素材", to: "/master/materials", Icon: ListChecks },
                  { label: "出版条件", to: "/documents/new?template=pub_license_terms", Icon: FilePlus2 },
                ].map((m) => {
                  const Icon = m.Icon
                  return (
                    <button
                      key={m.to}
                      onClick={() => navigate(m.to)}
                      className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-[12px] hover:border-foreground/40 hover:bg-muted transition-colors"
                    >
                      <Icon className="h-3.5 w-3.5 text-info shrink-0" />
                      <span className="truncate">{m.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* System health */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="h-3.5 w-3.5 text-warning" />
                <p className="text-[13px] font-semibold">System Health</p>
              </div>
              <ul className="space-y-1.5 text-xs">
                <li className="flex justify-between">
                  <span className="text-muted-foreground">Backlog Link</span>
                  <span className="text-success font-medium flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Operational</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-muted-foreground">Cloud Storage</span>
                  <span className="text-success font-medium flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Active</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-muted-foreground">Identity</span>
                  <span className="text-warning font-medium">Re-syncing</span>
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
