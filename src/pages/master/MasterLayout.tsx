import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import * as React from "react"
import { Upload, RefreshCw, Building2, Users, GitBranch, FileText, FileEdit, ClipboardCheck, Network, Boxes, BookMarked, BookOpen, GitMerge, Link2, Coins, Unlink, Receipt, FileUp } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const tabs = [
  { to: "/master/contracts", label: "Contracts", icon: FileText },
  { to: "/master/vendors", label: "Vendors", icon: Building2 },
  // 作品/原作 登録(works own / source_ips licensed_in)
  { to: "/master/work-entry", label: "Works (作品/原作)", icon: BookMarked },
  // 原作マテリアル登録(work_materials + 固定3種 金銭条件 + 文書欄)
  { to: "/master/materials", label: "Materials (原作素材)", icon: Boxes },
  // 原作＋原作マテリアル＋文書を一括で DB 化(upsert)。①既存文書から抽出 ②表(CSV/TSV)貼付。
  { to: "/master/bulk-import", label: "一括インポート", icon: FileUp },
  { to: "/master/work-material-link", label: "作品×原作素材 紐づけ", icon: Link2 },
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
  // 再許諾の受領記録＋ライセンサーへの分配(基準額×個数×親ライセンスイン料率)を台帳同期。
  { to: "/master/billing", label: "請求・分配", icon: Receipt },
  // 全作品の再許諾受領×分配を1画面で俯瞰(期間/未受領/未分配で絞込)。
  { to: "/master/billing-dashboard", label: "請求ダッシュボード", icon: Network },
  // Phase 22.21.116: 稟議マスタ管理 (一覧 + CRUD + CSV 一括取込)
  { to: "/master/ringi", label: "Ringi (稟議)", icon: ClipboardCheck },
  // データ構造刷新: 条件明細 横断検索は「条件明細」ハブの検索タブへ集約 (旧URLはリダイレクト)
  // 統合 P3-4: 分配構造マップ (作品中心の上流分配←当社←下流受領)
  { to: "/master/receivable-map", label: "分配マップ", icon: Network },
  // 統合: 3カード統合エディタ(旧「権利フロー」)はサイドバー「作品管理」(/works)へ移設。
  //   (work-3card-unified-editor-spec 増分④)
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
