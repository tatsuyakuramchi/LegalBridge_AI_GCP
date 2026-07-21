/**
 * ⑥ 製品 — 製品(SKU)一覧・追加 ＋ 受取（派生物 / 卸）downstream。8タブ移行 Phase 6。
 *   旧 WorkGraphPanel 中カードの製品ブロック＋右カード（受取エッジ）を移設。
 *   product_code 採番・結線ロジックは context 経由で不変（§20）。
 */
import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/EmptyState"
import { useWorkDetail } from "@/src/pages/works/WorkDetailContext"
import { EdgeRow, yen, inlineInputCls } from "./shared"

export const WorkProductsSection: React.FC = () => {
  const {
    work, isSource, products, materials, sourceWorks, downstream, linkEdge,
    prodName, setProdName, prodFormat, setProdFormat, prodMsrp, setProdMsrp, addingProduct, addProduct,
  } = useWorkDetail()

  if (!work) return <EmptyState title="作品を選択してください" />

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
      {/* 製品(SKU) 一覧・追加 */}
      <Card>
        <CardContent className="px-3.5 py-3 space-y-2">
          <h3 className="text-sm font-mono font-bold">製品（SKU）</h3>
          {products.length > 0 && (
            <div className="space-y-1">
              {products.map((p) => (
                <div key={p.id} className="text-[11px] font-mono border border-border/60 rounded px-2 py-1">
                  <span className="font-semibold">{p.product_code || "—"}</span> {p.product_name}
                  {p.format && <span className="text-muted-foreground"> · {p.format}</span>}
                  {p.msrp != null && <span className="text-muted-foreground"> · {yen(p.msrp)}</span>}
                </div>
              ))}
            </div>
          )}
          {/* 製品(SKU)を追加(own のみ)。product_code は API で {work_code}-P-NNN 採番。 */}
          {!isSource && (
            <div className="border-t border-border/60 pt-2 space-y-1.5">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">製品を追加</div>
              <input
                value={prodName}
                onChange={(e) => setProdName(e.target.value)}
                placeholder="製品名 (例: 通常版)"
                className={inlineInputCls}
              />
              <div className="flex items-center gap-1.5">
                <select
                  value={prodFormat}
                  onChange={(e) => setProdFormat(e.target.value)}
                  className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1"
                >
                  <option value="">形態 —</option>
                  <option value="physical">physical</option>
                  <option value="ebook">ebook</option>
                  <option value="print_on_demand">print_on_demand</option>
                </select>
                <input
                  value={prodMsrp}
                  onChange={(e) => setProdMsrp(e.target.value)}
                  inputMode="numeric"
                  placeholder="希望小売価格"
                  className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
                />
                <button
                  type="button"
                  onClick={addProduct}
                  disabled={addingProduct || !prodName.trim()}
                  className="text-[11px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-50"
                >
                  {addingProduct ? "追加中…" : "追加"}
                </button>
              </div>
            </div>
          )}
          {products.length === 0 && isSource && (
            <p className="text-[11px] text-muted-foreground py-1">製品はありません。</p>
          )}
        </CardContent>
      </Card>

      {/* 受取（派生物 / 卸）*/}
      <Card>
        <CardContent className="px-3.5 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-mono font-bold">◀ 受取（派生物 / 卸）</h3>
            <Badge variant="outline" className="border-success/40 text-success">受取 {downstream.length}</Badge>
          </div>
          {downstream.length === 0 ? (
            <p className="text-[11px] text-muted-foreground py-1">受取エッジはありません。</p>
          ) : (
            downstream.map((e) => (
              <React.Fragment key={e.id}>
                <EdgeRow e={e} side="down" materials={materials} products={products} sourceWorks={sourceWorks} onLink={linkEdge} />
              </React.Fragment>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default WorkProductsSection
