import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import * as React from "react"
import { RefreshCw, Building2, Users, GitBranch, ClipboardCheck } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// UIC-19(設計 v1.4 §5.3 / Phase E): /master は「参照マスターのランディング」。4 項目に限定。
//   契約=/contracts(UIC-15) / 金銭=/finance(UIC-16) / 保守=/data-maintenance(UIC-17) /
//   作品=/works(UIC-10) はそれぞれ独立モジュールへ移設済み。
const tabs = [
  { to: "/master/vendors", label: "取引先 (Vendors)", icon: Building2 },
  { to: "/master/staff", label: "担当者 (Staff)", icon: Users },
  { to: "/master/ringi", label: "稟議 (Ringi)", icon: ClipboardCheck },
  { to: "/master/rules", label: "ルーティング (Routing)", icon: GitBranch },
]

// UIC-19: 参照マスターではないが /master 配下に残す管理面は「その他」として控えめに導線を残す。
//   将来 素材は作品管理へ、再許諾条件登録は独立データ入力(/data-entry)へ移設予定。
const secondary = [
  { to: "/master/materials", label: "原作素材" },
  { to: "/master/sublicense-conditions", label: "再許諾条件登録" },
]

export function MasterLayout() {
  const { refreshAll } = useAppData()
  const location = useLocation()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (location.pathname === "/master") navigate("/master/vendors", { replace: true })
  }, [location.pathname, navigate])

  return (
    <div className="px-6 py-6 max-w-[1500px] mx-auto space-y-6">
      <header className="flex items-end justify-between gap-6 border-b border-border pb-5">
        <div>
          <p className="retro-tag mb-1.5">MST · 参照マスター</p>
          <h2 className="text-2xl font-mono font-bold tracking-tight">参照マスター</h2>
          <p className="text-xs font-mono text-muted-foreground mt-1.5">
            取引先・担当者・稟議・ルーティングの参照データ。契約は /contracts、金銭は /finance、保守は /data-maintenance へ移設済み。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw />
            Sync all
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

      {/* UIC-19: 参照マスター外の管理面への控えめな導線。 */}
      <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
        <span className="uppercase tracking-wider">その他</span>
        {secondary.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            className={({ isActive }) =>
              cn(
                "underline-offset-2 hover:text-foreground hover:underline",
                isActive && "text-foreground font-bold"
              )
            }
          >
            {s.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  )
}
