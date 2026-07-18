import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import * as React from "react"
import { Upload, RefreshCw, Building2, Users, GitBranch, FileText, ClipboardCheck, Boxes, BookMarked, BookOpen, Coins } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const tabs = [
  { to: "/master/contracts", label: "Contracts", icon: FileText },
  { to: "/master/vendors", label: "Vendors", icon: Building2 },
  // UIC-10(設計 v1.4 Phase D): 作品/原作 登録は Works 統一一覧(/works)へ統合。
  { to: "/works", label: "Works (作品/原作)", icon: BookMarked },
  // 原作マテリアル登録(work_materials + 固定3種 金銭条件 + 文書欄)
  { to: "/master/materials", label: "Materials (原作素材)", icon: Boxes },
  // UIC-17(設計 v1.4 Phase E): 保守系(一括インポート / ID統合 / 未リンクCL / Drafts)は
  //   Data Maintenance(/data-maintenance)へ集約。ここからは撤去。
  // UIC-11(設計 v1.4 Phase D): 作品×原作素材 紐づけは Works 詳細(/works/:id)の結線 UI へ統合したため
  //   独立ナビは撤去(作品を選んでから紐づける文脈内操作へ一本化)。
  // UIC-12: 出版利用許諾条件は Document Editor(pub_license_terms)で直接起票。旧パネルは廃止し文書フォームへ誘導。
  { to: "/documents/new?template=pub_license_terms", label: "出版条件書を作成", icon: BookOpen },
  // Phase 22.20-C: サブライセンシー マスター
  { to: "/master/sublicense-conditions", label: "再許諾条件登録", icon: Coins },
  // Phase 22.21.116: 稟議マスタ管理 (一覧 + CRUD + CSV 一括取込)
  { to: "/master/ringi", label: "Ringi (稟議)", icon: ClipboardCheck },
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
