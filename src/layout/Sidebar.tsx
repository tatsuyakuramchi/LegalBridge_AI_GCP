import * as React from "react"
import { NavLink, useLocation } from "react-router-dom"
import {
  LayoutDashboard,
  FilePlus2,
  Inbox,
  Archive,
  Building2,
  FileCode2,
  Settings as SettingsIcon,
  Terminal,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Search,
  ExternalLink,
  Link2,
  ListChecks,
} from "lucide-react"

import { cn } from "@/lib/utils"

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  description?: string
  end?: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

// データ構造刷新: タスク指向に再編。日次フロー(Operate)を業務順に並べ、
//   検収待ちは「条件明細」ハブの検収待ちタブへ集約したのでトップから除去。
const groups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, description: "Overview", end: true },
    ],
  },
  {
    label: "Operate",
    items: [
      { to: "/requests", label: "Requests", icon: Inbox, description: "Backlog" },
      { to: "/condition-lines", label: "条件明細", icon: ListChecks, description: "消化・残高 / 検収待ち / 検索" },
      { to: "/excel-batches", label: "Excel Export", icon: FileSpreadsheet, description: "未発行 検収/許諾" },
      { to: "/archive", label: "Archive", icon: Archive, description: "Concluded" },
    ],
  },
  {
    label: "Create",
    items: [
      { to: "/documents/new", label: "New Document", icon: FilePlus2, description: "Generate" },
      { to: "/imports", label: "Imports", icon: Database, description: "Past docs → DB" },
    ],
  },
  {
    label: "Configuration",
    items: [
      { to: "/master", label: "Masters", icon: Building2, description: "Vendors / Staff / Contracts" },
      { to: "/templates", label: "Templates", icon: FileCode2, description: "Blueprint studio" },
      { to: "/data-linkage", label: "連結チェック", icon: Link2, description: "データ整合性 点検/修復" },
      { to: "/settings", label: "Settings", icon: SettingsIcon, description: "System" },
    ],
  },
]

// 統合 Phase 1: 検索・閲覧は search-api の検索ポータル(IAP 配下)に集約。
//   admin-ui からは外部リンクで導線を張る。VITE_API_READ_URL(=search-api)
//   が設定されているときだけ表示する。
const PORTAL_BASE = String((import.meta as any).env?.VITE_API_READ_URL || "").replace(/\/+$/, "")
const portalLinks = [
  { href: "/search/vendor", label: "Search Portal", description: "取引先・契約 検索" },
  { href: "/templates/preview", label: "Template Preview", description: "ひな型プレビュー" },
]

export function Sidebar() {
  const location = useLocation()
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-border bg-card">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 h-14 border-b border-border">
        <div className="relative flex h-8 w-8 items-center justify-center bg-foreground text-background rounded-sm">
          <Terminal className="h-4 w-4" />
          <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 blink" />
        </div>
        <div className="leading-tight">
          <p className="text-[11px] font-mono font-bold uppercase tracking-[0.18em]">Arcs</p>
          <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-muted-foreground">
            Legal · OS
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6 custom-scrollbar">
        {groups.map((group) => (
          <div key={group.label} className="space-y-1.5">
            <p className="px-2 text-[11px] font-mono font-bold uppercase tracking-[0.22em] text-muted-foreground/70">
              ░ {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive = item.end
                  ? location.pathname === item.to
                  : location.pathname.startsWith(item.to)
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive: navActive }) =>
                        cn(
                          "group relative flex items-center gap-3 rounded-sm px-2.5 py-1.5 text-xs font-mono transition-colors",
                          (navActive || isActive)
                            ? "bg-foreground text-background"
                            : "text-foreground/80 hover:bg-muted hover:text-foreground"
                        )
                      }
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1 font-bold uppercase tracking-[0.1em]">
                        {item.label}
                      </span>
                      {(isActive) && (
                        <ChevronRight className="h-3 w-3 opacity-70" />
                      )}
                    </NavLink>
                    {item.description && (
                      <p className="ml-9 text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground/60">
                        {item.description}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}

        {/* 統合 Phase 1: search-api 検索ポータルへの外部リンク */}
        {PORTAL_BASE && (
          <div className="space-y-1.5">
            <p className="px-2 text-[11px] font-mono font-bold uppercase tracking-[0.22em] text-muted-foreground/70">
              ░ Search Portal
            </p>
            <ul className="space-y-0.5">
              {portalLinks.map((item) => (
                <li key={item.href}>
                  <a
                    href={PORTAL_BASE + item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative flex items-center gap-3 rounded-sm px-2.5 py-1.5 text-xs font-mono text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Search className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 font-bold uppercase tracking-[0.1em]">
                      {item.label}
                    </span>
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </a>
                  <p className="ml-9 text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground/60">
                    {item.description}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      {/* Footer status */}
      <div className="border-t border-border p-3 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.16em]">
          <span className="text-muted-foreground">▍ Backlog</span>
          <span className="text-emerald-600 font-bold">Online</span>
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.16em]">
          <span className="text-muted-foreground">▍ Drive</span>
          <span className="text-emerald-600 font-bold">Active</span>
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.16em]">
          <span className="text-muted-foreground">▍ Identity</span>
          <span className="text-amber-600 font-bold">Sync</span>
        </div>
      </div>
    </aside>
  )
}
