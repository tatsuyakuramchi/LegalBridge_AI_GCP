import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import * as React from "react"
import { Upload, RefreshCw, Building2, Users, GitBranch, FileText, BookMarked, FileEdit, ClipboardCheck, Network, Boxes } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const tabs = [
  { to: "/master/contracts", label: "Contracts", icon: FileText },
  { to: "/master/vendors", label: "Vendors", icon: Building2 },
  // Phase 22.18: 原作マスター (LO-YYYY-NNNN + 配下素材 -NNN)
  { to: "/master/ledgers", label: "Ledgers (原作)", icon: BookMarked },
  // Phase 22.20-C: サブライセンシー マスター
  { to: "/master/sublicensees", label: "Sublicensees", icon: GitBranch },
  // Phase 22.21.116: 稟議マスタ管理 (一覧 + CRUD + CSV 一括取込)
  { to: "/master/ringi", label: "Ringi (稟議)", icon: ClipboardCheck },
  // データ構造刷新: 条件明細 横断検索は「条件明細」ハブの検索タブへ集約 (旧URLはリダイレクト)
  // 統合 P3-4: 分配構造マップ (作品中心の上流分配←当社←下流受領)
  { to: "/master/receivable-map", label: "分配マップ", icon: Network },
  // 統合 P3-5: 作品モデル (原作IP / 自社作品 / 契約 · v3)
  { to: "/master/work-model", label: "作品モデル", icon: Boxes },
  // Phase 22.21.81: 文書作成途中の draft (一時保存) の掃除タブ
  { to: "/master/drafts", label: "Drafts (一時保存)", icon: FileEdit },
  { to: "/master/staff", label: "Staff", icon: Users },
  { to: "/master/rules", label: "Routing", icon: GitBranch },
]

export function MasterLayout() {
  const { refreshAll } = useAppData()
  const location = useLocation()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (location.pathname === "/master") navigate("/master/contracts", { replace: true })
  }, [location.pathname, navigate])

  return (
    <div className="px-6 py-6 max-w-[1500px] mx-auto space-y-6">
      <header className="flex items-end justify-between gap-6 border-b border-border pb-5">
        <div>
          <p className="retro-tag mb-1.5">MST · INDEX</p>
          <h2 className="text-2xl font-mono font-bold tracking-tight">Master Systems</h2>
          <p className="text-xs font-mono text-muted-foreground mt-1.5">
            Reference data — vendors, staff, contracts, and workflow routing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw />
            Sync all
          </Button>
          <Button size="sm">
            <Upload />
            CSV bulk import
          </Button>
        </div>
      </header>

      <nav className="flex items-center gap-1 border-b border-border -mb-px overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon
          return (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center gap-2 px-4 py-2.5 text-[11px] font-mono font-bold uppercase tracking-[0.16em] border-b-2 -mb-px transition-colors",
                  isActive
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </NavLink>
          )
        })}
      </nav>

      <Outlet />
    </div>
  )
}
