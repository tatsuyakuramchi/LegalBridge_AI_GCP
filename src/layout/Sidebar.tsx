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
  Network,
  FolderKanban,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useSkin } from "@/src/lib/skin"

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
// メニューは日本語で統一(英日混在を解消)。
const groups: NavGroup[] = [
  {
    label: "概要",
    items: [
      { to: "/", label: "ダッシュボード", icon: LayoutDashboard, description: "全体の概況", end: true },
    ],
  },
  {
    label: "業務",
    items: [
      { to: "/requests", label: "依頼", icon: Inbox, description: "Backlog 連携の依頼" },
      { to: "/matters", label: "案件", icon: FolderKanban, description: "課題・文書・送信・条件を1案件で管理" },
      { to: "/condition-lines", label: "条件明細", icon: ListChecks, description: "消化・残高 / 検収待ち / 検索" },
      { to: "/excel-batches", label: "Excel出力", icon: FileSpreadsheet, description: "未発行 検収 / 許諾" },
      { to: "/archive", label: "アーカイブ", icon: Archive, description: "完了分" },
    ],
  },
  {
    label: "作成",
    items: [
      { to: "/documents/new", label: "文書作成", icon: FilePlus2, description: "文書・法務レビューの作成" },
      { to: "/imports", label: "過去文書取込", icon: Database, description: "過去文書 → DB" },
      { to: "/data-import", label: "CSV取込（全テーブル）", icon: Database, description: "スキーマ駆動 CSV" },
    ],
  },
  {
    label: "設定",
    items: [
      // 作品統合: 原作 / 自社作品 / 派生 を 3カードで一元管理 (work-3card-unified-editor-spec)
      { to: "/works", label: "作品管理", icon: Network, description: "原作 / 作品 / 派生" },
      { to: "/master", label: "マスタ", icon: Building2, description: "取引先 / 担当者 / 契約" },
      { to: "/templates", label: "テンプレート", icon: FileCode2, description: "ひな型スタジオ" },
      { to: "/data-linkage", label: "連結チェック", icon: Link2, description: "データ整合性 点検 / 修復" },
      { to: "/settings", label: "設定", icon: SettingsIcon, description: "システム" },
    ],
  },
]

// 統合 Phase 1: 検索・閲覧は search-api の検索ポータル(IAP 配下)に集約。
//   admin-ui からは外部リンクで導線を張る。VITE_API_READ_URL(=search-api)
//   が設定されているときだけ表示する。
const PORTAL_BASE = String((import.meta as any).env?.VITE_API_READ_URL || "").replace(/\/+$/, "")
const portalLinks = [
  { href: "/search/vendor", label: "検索ポータル", description: "取引先・契約 検索" },
  { href: "/templates/preview", label: "ひな型プレビュー", description: "テンプレート確認" },
]

export function Sidebar() {
  const location = useLocation()
  const { skin } = useSkin()
  const isEva = skin === "eva"
  return (
    <aside className="eva-panel hidden lg:flex w-60 shrink-0 flex-col border-r border-border bg-card">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 h-14 border-b border-border">
        <div className="relative flex h-8 w-8 items-center justify-center bg-foreground text-background rounded-sm">
          <Terminal className="h-4 w-4" />
          <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 blink" />
        </div>
        <div className="leading-tight">
          <p className="text-[13px] font-mono font-bold uppercase tracking-[0.18em]">
            {isEva ? "NERV" : "Arcs"}
          </p>
          <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-muted-foreground">
            {isEva ? "MAGI · SYSTEM" : "Legal · OS"}
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6 custom-scrollbar">
        {groups.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-3 pb-0.5 text-[11px] font-mono font-bold tracking-[0.04em] text-muted-foreground/90">
              {group.label}
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
                      title={item.description}
                      className={({ isActive: navActive }) =>
                        cn(
                          // ユニバーサルデザイン: 十分な文字サイズ・クリック領域・コントラスト。
                          "group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13.5px] font-mono transition-colors",
                          (navActive || isActive)
                            ? "bg-foreground text-background font-semibold"
                            : "text-foreground/85 hover:bg-muted hover:text-foreground"
                        )
                      }
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="flex-1 font-semibold">{item.label}</span>
                      {isActive && <ChevronRight className="h-3.5 w-3.5 opacity-70" />}
                    </NavLink>
                    {/* 情報整理: 説明は現在地のみ表示(他はホバーの title で補助)。 */}
                    {isActive && item.description && (
                      <p className="ml-[42px] mt-0.5 text-[11px] font-mono leading-snug text-muted-foreground">
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
          <div className="space-y-1">
            <p className="px-3 pb-0.5 text-[11px] font-mono font-bold tracking-[0.04em] text-muted-foreground/90">
              検索ポータル
            </p>
            <ul className="space-y-0.5">
              {portalLinks.map((item) => (
                <li key={item.href}>
                  <a
                    href={PORTAL_BASE + item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={item.description}
                    className="group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13.5px] font-mono text-foreground/85 transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Search className="h-[18px] w-[18px] shrink-0" />
                    <span className="flex-1 font-semibold">{item.label}</span>
                    <ExternalLink className="h-3.5 w-3.5 opacity-60" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      {/* Footer status */}
      <div className="border-t border-border p-3 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-mono tracking-[0.04em]">
          <span className="text-muted-foreground">▍ Backlog</span>
          <span className="text-emerald-600 font-bold">稼働中</span>
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono tracking-[0.04em]">
          <span className="text-muted-foreground">▍ Drive</span>
          <span className="text-emerald-600 font-bold">有効</span>
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono tracking-[0.04em]">
          <span className="text-muted-foreground">▍ Identity</span>
          <span className="text-amber-600 font-bold">同期中</span>
        </div>
      </div>
    </aside>
  )
}
