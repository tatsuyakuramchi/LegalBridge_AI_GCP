/**
 * DataMaintenanceLayout — Data Maintenance モジュール(設計 v1.4 UIC-17 / Phase E マスター再編)。
 *
 * 旧 MasterLayout に散っていた保守系(一括インポート / ID統合 / 未リンクCL 棚卸し / Drafts)を
 * `/data-maintenance` 配下へ集約する。旧 `/master/{bulk-import,merge,unlinked-conditions,drafts}`
 * は計測付き互換リダイレクト(DeprecatedRedirect)で温存。
 */
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import * as React from "react"
import { FileUp, GitMerge, Unlink, FileEdit } from "lucide-react"

import { cn } from "@/lib/utils"
import { ModuleHeader } from "@/src/components/form"

const tabs = [
  { to: "/data-maintenance/bulk-import", label: "一括インポート", icon: FileUp },
  { to: "/data-maintenance/merge", label: "ID統合", icon: GitMerge },
  { to: "/data-maintenance/unlinked-conditions", label: "未リンクCL 棚卸し", icon: Unlink },
  { to: "/data-maintenance/drafts", label: "Drafts (一時保存)", icon: FileEdit },
]

export function DataMaintenanceLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (location.pathname === "/data-maintenance") {
      navigate("/data-maintenance/bulk-import", { replace: true })
    }
  }, [location.pathname, navigate])

  return (
    <div className="px-6 py-6 max-w-[1500px] mx-auto space-y-6">
      <ModuleHeader
        eyebrow="Data Maintenance"
        title="Data Maintenance"
        description="一括インポート、ID統合(マージ)、未リンクCL 棚卸し、下書きの掃除。"
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
