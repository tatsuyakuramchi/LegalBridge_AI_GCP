import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  RefreshCw,
  ArrowRight,
  AlertCircle,
  FileText,
  Inbox,
  TrendingUp,
  Loader2,
  Clock,
  CheckCircle2,
} from "lucide-react"

import { useAppData, useDocumentSession } from "@/src/context/AppDataContext"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export function DashboardPage() {
  const navigate = useNavigate()
  const {
    dashboardStats,
    refreshDashboardStats,
    isRefreshingStats,
    templateList,
  } = useAppData()
  const { setSelectedIssue } = useDocumentSession()

  React.useEffect(() => {
    refreshDashboardStats()
  }, [refreshDashboardStats])

  const stats = [
    {
      label: "Active Requests",
      value: dashboardStats?.totalIssues ?? 0,
      icon: Inbox,
      tint: "text-cyan-700 dark:text-cyan-300",
      hint: `${dashboardStats?.recentActivity?.length ?? 0} active projects`,
    },
    {
      label: "Issued Documents",
      value: dashboardStats?.totalDocuments ?? 0,
      icon: FileText,
      tint: "text-emerald-700 dark:text-emerald-300",
      hint: "Across all blueprints",
    },
    {
      label: "Avg. Turnaround",
      value: "2.4d",
      icon: Clock,
      tint: "text-amber-700 dark:text-amber-300",
      hint: "Within SLA",
    },
    {
      label: "Blueprints",
      value: templateList.length,
      icon: TrendingUp,
      tint: "text-foreground",
      hint: "Templates utilized",
    },
  ]

  const openIssue = (key: string) => {
    setSelectedIssue(key)
    navigate("/documents/new")
  }

  return (
    <div className="relative">
      <div className="absolute inset-0 grid-paper opacity-50 pointer-events-none" />

      <div className="relative px-6 py-8 max-w-[1400px] mx-auto space-y-8">
        {/* Page header */}
        <header className="flex items-end justify-between gap-6 border-b border-border pb-5">
          <div>
            <p className="retro-tag mb-1.5">SYS · DASHBOARD</p>
            <h2 className="text-2xl font-mono font-bold tracking-tight">
              Operations Console
            </h2>
            <p className="text-xs font-mono text-muted-foreground mt-1.5">
              Live signals from Backlog, the document pipeline, and master systems.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshDashboardStats}
              disabled={isRefreshingStats}
            >
              <RefreshCw className={isRefreshingStats ? "animate-spin" : ""} />
              Sync
            </Button>
          </div>
        </header>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s) => {
            const Icon = s.icon
            return (
              <Card key={s.label} className="bracketed">
                <CardContent className="px-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-mono font-bold uppercase tracking-[0.22em] text-muted-foreground">
                      {s.label}
                    </p>
                    <Icon className={`h-3.5 w-3.5 ${s.tint}`} />
                  </div>
                  <p className={`mt-3 text-3xl font-mono font-bold tab-mono tracking-tight ${s.tint}`}>
                    {s.value}
                  </p>
                  <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
                    {s.hint}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Pipeline + side rail */}
        <div className="grid grid-cols-12 gap-6">
          <section className="col-span-12 lg:col-span-8 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono font-bold uppercase tracking-[0.2em]">
                ▍ Legal Request Pipeline
              </h3>
              <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                {dashboardStats?.issueDetails?.length ?? 0} issues
              </span>
            </div>

            <div className="space-y-2">
              {isRefreshingStats && !dashboardStats ? (
                <div className="p-12 flex flex-col items-center gap-3 border border-dashed border-border rounded-md">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground">
                    Synchronizing with Backlog
                  </p>
                </div>
              ) : (dashboardStats?.issueDetails?.length ?? 0) === 0 ? (
                <div className="p-12 text-center border border-dashed border-border rounded-md">
                  <p className="text-xs font-mono text-muted-foreground">
                    No active tickets right now.
                  </p>
                </div>
              ) : (
                dashboardStats?.issueDetails?.slice(0, 12).map((issue: any, idx: number) => (
                  <button
                    key={`stats-${issue.issueKey || idx}-${idx}`}
                    onClick={() => openIssue(issue.issueKey)}
                    className="group w-full text-left flex items-center justify-between gap-4 px-4 py-3 bg-card border border-border rounded-md hover:border-foreground hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <span
                        className={`h-10 w-1 rounded-full shrink-0 ${
                          issue.status?.name === "完了"
                            ? "bg-emerald-500"
                            : "bg-amber-500"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="text-[10px] font-mono font-bold tab-mono tracking-[0.16em] text-muted-foreground">
                          {issue.issueKey}
                        </p>
                        <p className="text-sm font-mono font-bold truncate group-hover:text-foreground transition-colors">
                          {issue.summary}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant="outline" className="h-4 text-[11px]">
                            {issue.status?.name ?? "—"}
                          </Badge>
                          <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                            {issue.assignee?.name || "Unassigned"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="text-[11px] font-mono font-bold tab-mono">
                          {issue.documentCount ?? 0}
                        </p>
                        <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                          docs
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </button>
                ))
              )}
            </div>

            <Button
              variant="outline"
              className="w-full border-dashed"
              onClick={() => navigate("/requests")}
            >
              View all requests
            </Button>
          </section>

          <aside className="col-span-12 lg:col-span-4 space-y-4">
            {/* Recent artifacts panel — terminal style */}
            <Card className="bg-foreground text-background border-foreground">
              <CardContent className="px-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-mono font-bold uppercase tracking-[0.22em]">
                    ▍ Recent Artifacts
                  </p>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 blink" />
                </div>
                <ul className="space-y-2.5">
                  {(dashboardStats?.recentActivity ?? []).slice(0, 8).map((doc: any, idx: number) => (
                    <li
                      key={doc.id || `recent-${idx}`}
                      className="border-l-2 border-emerald-400/40 pl-3 py-0.5"
                    >
                      <p className="text-xs font-mono font-bold truncate">
                        {doc.template_type}
                      </p>
                      <p className="text-[11px] font-mono uppercase tracking-[0.16em] opacity-60">
                        {doc.issue_key} ·{" "}
                        {doc.created_at
                          ? new Date(doc.created_at).toLocaleDateString("ja-JP")
                          : "—"}
                      </p>
                    </li>
                  ))}
                  {(dashboardStats?.recentActivity ?? []).length === 0 && (
                    <li className="text-[10px] font-mono uppercase tracking-[0.18em] opacity-50 py-3">
                      No documents generated yet.
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>

            {/* System health — printout style */}
            <Card>
              <CardContent className="px-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                  <p className="text-[10px] font-mono font-bold uppercase tracking-[0.22em]">
                    System Health
                  </p>
                </div>
                <ul className="space-y-1.5 text-[10px] font-mono uppercase tracking-[0.14em]">
                  <li className="flex justify-between">
                    <span className="text-muted-foreground">▍ Backlog Link</span>
                    <span className="text-emerald-600 font-bold flex items-center gap-1">
                      <CheckCircle2 className="h-2.5 w-2.5" /> Operational
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-muted-foreground">▍ Cloud Storage</span>
                    <span className="text-emerald-600 font-bold flex items-center gap-1">
                      <CheckCircle2 className="h-2.5 w-2.5" /> Active
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-muted-foreground">▍ Identity</span>
                    <span className="text-amber-600 font-bold">Re-syncing</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  )
}
