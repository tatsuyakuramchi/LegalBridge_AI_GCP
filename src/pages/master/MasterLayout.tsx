import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import * as React from "react"
import { Upload, RefreshCw, Building2, Users, GitBranch, FileText, FileEdit, ClipboardCheck, Boxes, BookMarked, BookOpen, GitMerge, Coins, Unlink, FileUp } from "lucide-react"

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
  // 原作＋原作マテリアル＋文書を一括で DB 化(upsert)。①既存文書から抽出 ②表(CSV/TSV)貼付。
  { to: "/master/bulk-import", label: "一括インポート", icon: FileUp },
  // UIC-11(設計 v1.4 Phase D): 作品×原作素材 紐づけは Works 詳細(/works/:id)の結線 UI へ統合したため
  //   独立ナビは撤去(作品を選んでから紐づける文脈内操作へ一本化)。
  // UIC-12: 出版利用許諾条件は Document Editor(pub_license_terms)で直接起票。旧パネルは廃止し文書フォームへ誘導。
  { to: "/documents/new?template=pub_license_terms", label: "出版条件書を作成", icon: BookOpen },
  // ID統合(マージ)カート: 重複した 原作/作品/案件 を外部キー付替えで統合(孤立防止)
  { to: "/master/merge", label: "ID統合", icon: GitMerge },
  // 統合 増分⑨: 原作台帳(Ledgers)/作品モデル(work-model) はサイドバー「作品管理」(/works)へ統合。
  //   ルートは温存(レガシー画面に移行バナー)。データ移行(§8 #4)完了後に物理廃止予定。
  // Phase 22.20-C: サブライセンシー マスター
  { to: "/master/sublicense-conditions", label: "再許諾条件登録", icon: Coins },
  // 発注書等で発生した「素材未リンクの利用許諾CL」を棚卸し→原作マテリアルへ後付けリンク(二重化なし)。
  { to: "/master/unlinked-conditions", label: "未リンクCL 棚卸し", icon: Unlink },
  // UIC-16(設計 v1.4 Phase E): 金銭系(請求・分配 / 請求ダッシュボード / 分配マップ)は
  //   Finance モジュール(/finance)へ集約。ここからは撤去。
  // Phase 22.21.116: 稟議マスタ管理 (一覧 + CRUD + CSV 一括取込)
  { to: "/master/ringi", label: "Ringi (稟議)", icon: ClipboardCheck },
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
