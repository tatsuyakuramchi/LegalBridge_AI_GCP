import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { ListChecks, ClipboardCheck, Search, Network } from "lucide-react"

import { cn } from "@/lib/utils"
import { ConditionLinesPage } from "./ConditionLinesPage"
import { PendingInspectionsPage } from "./PendingInspectionsPage"
import { ConditionsPanel } from "./master/ConditionsPanel"
import { ConditionTreePage } from "./ConditionTreePage"

// データ構造刷新: 条件明細の統合ハブ。
//   旧「条件明細(コックピット)」「検収待ち」「マスター > 条件明細(横断検索/編集)」を
//   1 メニューのタブに集約する。各タブは既存ページを子として埋め込むだけで、
//   個々の挙動・データ経路は不変(低リスク)。タブ状態は ?tab= で保持し、
//   旧ルート(/pending-inspections, /master/conditions)からのリダイレクト先に使う。

const TABS = [
  { key: "cockpit", label: "コックピット", sub: "消化・残高", icon: ListChecks },
  { key: "inspections", label: "検収待ち", sub: "発注書→検収書 一括", icon: ClipboardCheck },
  { key: "search", label: "横断検索・編集", sub: "検索 / CSV / 紐付け", icon: Search },
  { key: "tree", label: "ツリー", sub: "作品/原作/取引先/部署 で分類", icon: Network },
] as const

type TabKey = (typeof TABS)[number]["key"]

export function ConditionsHubPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get("tab") || "cockpit"
  const active: TabKey = (TABS.some((t) => t.key === raw) ? raw : "cockpit") as TabKey

  const select = (key: TabKey) => {
    const next = new URLSearchParams(params)
    next.set("tab", key)
    setParams(next, { replace: true })
  }

  return (
    <div>
      <div className="max-w-[1500px] mx-auto px-6 pt-6">
        <nav className="flex items-center gap-1 border-b border-border overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon
            const isActive = active === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => select(t.key)}
                aria-selected={isActive}
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-3 text-[13px] font-mono font-bold border-b-2 -mb-px transition-colors whitespace-nowrap",
                  isActive
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
                <span className="hidden md:inline text-[11px] font-normal text-muted-foreground">
                  {t.sub}
                </span>
              </button>
            )
          })}
        </nav>
      </div>

      {active === "cockpit" && <ConditionLinesPage />}
      {active === "inspections" && <PendingInspectionsPage />}
      {active === "search" && <ConditionsPanel />}
      {active === "tree" && <ConditionTreePage />}
    </div>
  )
}
