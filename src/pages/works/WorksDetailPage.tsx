import { Link, useParams } from "react-router-dom"
import {
  ArrowLeft,
  BookOpen,
  FilePlus2,
  FileText,
  GitBranch,
  Layers3,
  ReceiptText,
  Search,
  ShieldCheck,
} from "lucide-react"

import { AppFormShell } from "@/src/components/form"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { WorkGraphPanel } from "../master/WorkGraphPanel"

import "./works-detail-page.css"

const RELATED_LINKS = [
  {
    to: "/works",
    label: "作品一覧",
    description: "作品・外部原版を横断して選択",
    icon: BookOpen,
  },
  {
    to: "/condition-lines",
    label: "条件明細",
    description: "支払・受取・利用許諾条件を検索",
    icon: ReceiptText,
  },
  {
    to: "/contracts",
    label: "契約台帳",
    description: "根拠契約と関連文書を確認",
    icon: FileText,
  },
  {
    to: "/data-quality",
    label: "データ品質",
    description: "権利・条件の不足を是正",
    icon: ShieldCheck,
  },
] as const

export function WorksDetailPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className="works-detail-page">
      <AppFormShell
        mode="edit"
        maxWidthClassName="max-w-[1680px]"
        className="pt-6 pb-12"
        header={
          <header className="works-detail-header" aria-labelledby="works-detail-title">
            <div className="works-detail-header__topline">
              <Link to="/works" className="works-detail-backlink">
                <ArrowLeft aria-hidden="true" />
                作品一覧へ戻る
              </Link>
              <div className="works-detail-breadcrumb" aria-label="現在位置">
                <span>WORKS</span>
                <span aria-hidden="true">/</span>
                <span>{id ? `WORK ID ${id}` : "DETAIL"}</span>
              </div>
            </div>

            <div className="works-detail-header__main">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
                    作品・権利管理
                  </Badge>
                  {id ? (
                    <Badge variant="outline" className="font-mono text-muted-foreground">
                      ID {id}
                    </Badge>
                  ) : null}
                </div>
                <h1 id="works-detail-title" className="works-detail-title">
                  作品管理
                </h1>
                <p className="works-detail-lead">
                  作品系譜、マテリアル、権利根源、条件明細および関連文書を一つの画面で確認・更新します。
                </p>
              </div>

              <div className="works-detail-header__actions" aria-label="作品管理の主操作">
                <Link
                  to="/condition-lines"
                  className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-w-32")}
                >
                  <Search aria-hidden="true" />
                  条件を検索
                </Link>
                <Link
                  to="/documents/new"
                  className={cn(buttonVariants({ variant: "default", size: "lg" }), "min-w-36")}
                >
                  <FilePlus2 aria-hidden="true" />
                  文書を作成
                </Link>
              </div>
            </div>
          </header>
        }
        aside={
          <div className="works-context-rail">
            <section className="works-context-card" aria-labelledby="works-context-navigation">
              <div className="works-context-card__heading">
                <Layers3 aria-hidden="true" />
                <div>
                  <h2 id="works-context-navigation">関連メニュー</h2>
                  <p>現在の作品を起点に関連機能へ移動</p>
                </div>
              </div>
              <nav className="works-context-links" aria-label="作品管理の関連メニュー">
                {RELATED_LINKS.map(({ to, label, description, icon: Icon }) => (
                  <Link key={to} to={to} className="works-context-link">
                    <span className="works-context-link__icon">
                      <Icon aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                  </Link>
                ))}
              </nav>
            </section>

            <section className="works-context-card" aria-labelledby="works-flow-guide">
              <div className="works-context-card__heading">
                <GitBranch aria-hidden="true" />
                <div>
                  <h2 id="works-flow-guide">権利フローの見方</h2>
                  <p>3カードの情報方向を整理</p>
                </div>
              </div>
              <ol className="works-flow-list">
                <li>
                  <span>1</span>
                  <div>
                    <strong>権利・素材の取得</strong>
                    <small>外部原版や委託素材への当社支払</small>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>作品・製品の構成</strong>
                    <small>使用マテリアル、派生関係、製品SKU</small>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>許諾・販売による受取</strong>
                    <small>利用許諾料、製品売上、分配条件</small>
                  </div>
                </li>
              </ol>
            </section>
          </div>
        }
      >
        <section className="works-detail-canvas" aria-label="作品・権利構造の編集領域">
          <WorkGraphPanel />
        </section>
      </AppFormShell>
    </div>
  )
}
