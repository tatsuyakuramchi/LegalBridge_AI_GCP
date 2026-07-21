/**
 * ⑥ 製品 — 製品(SKU)一覧・追加 ＋ 受取（派生物 / 卸）downstream。8タブ移行 Phase 6。
 *   旧 WorkGraphPanel 中カードの製品ブロック＋右カード（受取エッジ）を移設。
 *   一覧は共通 DataTableShell へ寄せた（列 render でインライン編集を吸収）。
 *   product_code 採番・編集/削除ロジックは context 経由で不変（§20）。
 */
import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/EmptyState"
import { DataTableShell, type DataTableColumn } from "@/src/components/form"
import { useWorkDetail } from "@/src/pages/works/WorkDetailContext"
import { EdgeRow, yen, inlineInputCls } from "./shared"

const FORMATS = ["", "physical", "ebook", "print_on_demand"]
const ecls =
  "w-full text-[11px] font-mono bg-transparent border-b border-input py-0.5 focus:outline-none focus:border-foreground"

export const WorkProductsSection: React.FC = () => {
  const {
    work, isSource, products, materials, sourceWorks, downstream, linkEdge,
    prodName, setProdName, prodFormat, setProdFormat, prodMsrp, setProdMsrp, addingProduct, addProduct,
    editingProductId, productForm, setProductForm, productSaving, productErr, startEditProduct, cancelEditProduct, saveProduct, deleteProduct,
  } = useWorkDetail()

  if (!work) return <EmptyState title="作品を選択してください" />

  // ⑥製品一覧の列定義（DataTableShell）。編集中の行はセル内で input/select を描画する。
  const productColumns: DataTableColumn<any>[] = [
    {
      key: "code",
      header: "コード",
      className: "font-mono text-[10px] text-muted-foreground whitespace-nowrap",
      render: (p) => p.product_code || "—",
    },
    {
      key: "name",
      header: "製品名",
      render: (p) =>
        editingProductId === p.id ? (
          <div className="space-y-0.5">
            <input
              className={ecls}
              value={productForm.product_name || ""}
              onChange={(e) => setProductForm((f) => ({ ...f, product_name: e.target.value }))}
              placeholder="製品名 *"
            />
            {productErr && <p className="text-[9px] text-destructive">{productErr}</p>}
          </div>
        ) : (
          <span className="font-semibold">{p.product_name}</span>
        ),
    },
    {
      key: "format",
      header: "形態",
      className: "whitespace-nowrap",
      render: (p) =>
        editingProductId === p.id ? (
          <select
            className={ecls}
            value={productForm.format || ""}
            onChange={(e) => setProductForm((f) => ({ ...f, format: e.target.value }))}
          >
            {FORMATS.map((fm) => (
              <option key={fm} value={fm}>{fm || "—"}</option>
            ))}
          </select>
        ) : (
          <span className="text-muted-foreground">{p.format || "—"}</span>
        ),
    },
    {
      key: "msrp",
      header: "希望小売価格",
      align: "right",
      className: "whitespace-nowrap tabular-nums",
      render: (p) =>
        editingProductId === p.id ? (
          <input
            className={`${ecls} text-right`}
            value={productForm.msrp || ""}
            onChange={(e) => setProductForm((f) => ({ ...f, msrp: e.target.value }))}
            inputMode="numeric"
            placeholder="0"
          />
        ) : (
          <span className="text-muted-foreground">{p.msrp != null ? yen(p.msrp) : "—"}</span>
        ),
    },
    // 操作列は own のみ。原作ビューは製品編集不可のため列自体を出さない。
    ...(!isSource
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            className: "whitespace-nowrap",
            render: (p: any) =>
              editingProductId === p.id ? (
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={cancelEditProduct}
                    disabled={productSaving}
                    className="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted-foreground disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveProduct()}
                    disabled={productSaving || !productForm.product_name?.trim()}
                    className="text-[9px] px-1.5 py-0.5 rounded border border-success bg-success/10 text-success font-bold disabled:opacity-50"
                  >
                    {productSaving ? "保存中…" : "保存"}
                  </button>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEditProduct(p)}
                    className="text-[9px] font-mono px-1 py-0.5 rounded border border-border hover:border-foreground/40"
                    title="編集"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteProduct(p)}
                    className="text-[9px] font-mono px-1 py-0.5 rounded border border-destructive/40 text-destructive hover:bg-destructive/10"
                    title="削除"
                  >
                    削除
                  </button>
                </span>
              ),
          },
        ]
      : []),
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
      {/* 製品(SKU) 一覧・追加 */}
      <Card>
        <CardContent className="px-3.5 py-3 space-y-2">
          <h3 className="text-sm font-mono font-bold">製品（SKU）</h3>
          <DataTableShell
            columns={productColumns}
            rows={products}
            rowKey={(p) => p.id}
            emptyTitle="製品はありません"
            dense
          />
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
