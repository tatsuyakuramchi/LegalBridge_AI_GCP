/**
 * FinanceLayout — Finance モジュール(設計 v1.4 UIC-16 / Phase E マスター再編)。
 *
 * 旧 MasterLayout に散っていた金銭系(請求・分配 / 請求ダッシュボード / 分配マップ)を
 * `/finance` 配下へ集約する。旧 `/master/billing*`・`/master/receivable-map` は
 * 計測付き互換リダイレクト(DeprecatedRedirect)で温存。
 */
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import * as React from "react"
import { Receipt, Network, Coins } from "lucide-react"

import { cn } from "@/lib/utils"
import { ModuleHeader } from "@/src/components/form"

const tabs = [
  { to: "/finance/billing", label: "請求・分配", icon: Receipt },
  { to: "/finance/billing-dashboard", label: "請求ダッシュボード", icon: Network },
  { to: "/finance/receivable-map", label: "分配マップ", icon: Coins },
]

export function FinanceLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (location.pathname === "/finance") navigate("/finance/billing", { replace: true })
  }, [location.pathname, navigate])

  return (
    <div className="px-6 py-6 max-w-[1500px] mx-auto space-y-6">
      <ModuleHeader
        eyebrow="Finance"
        title="Finance"
        description="再許諾の受領・分配、請求ダッシュボード、分配構造マップ。"
      />

      <nav className="flex items-center gap-1 border-b border-border -mb-px overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon
          return (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors",
                  isActive
                    ? "border-primary text-primary"
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
