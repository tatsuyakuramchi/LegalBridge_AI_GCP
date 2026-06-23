/**
 * DeliveryLineItemTable — 検収書フォームで「親 PO の明細ごとに今回
 * いくら検収するか」を入力する編集テーブル。
 *
 * 1 行 = 親 PO の order_line_item 1 件.
 * ユーザーは検収数量と歩留率 (acceptance_ratio) を入力。
 * その場で:
 *   検収額 = Math.ceil(unit_price × inspected_quantity × acceptance_ratio)
 * を計算して表示し、各行が「発注額 / 既検収累計 / 残量」を超過していないか
 * を警告する。
 *
 * サーバ側ガード (/api/inspections/preview, /api/delivery-events/:id/line-items)
 * も同じ算式で再計算するので、ここで OK と出れば後段で reject されない。
 */

import React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type OrderLineForInspection = {
  id: number; // order_line_item_id
  line_no: number;
  item_name: string;
  spec?: string;
  unit_price: number;
  quantity: number; // 発注数量 (元)
  amount_ex_tax: number; // 発注額 (元)
  // 成果物帰属。受注者帰属かつ発注額0は利用許諾料に含むため、金額表示を
  //   「利用許諾料に含む」に切り替える(0円とは出さない)。
  deliverable_ownership?: string;
  // 業績連動型報酬版の判定・表示用(発注者×ROYALTY=業績連動)。
  calc_method?: string;
  royalty_calc_basis?: string;
  rate_pct?: number;
  delivery_date?: string; // 親 PO 明細の納期 (各明細ごとの既定値・プレフィル元)
  inspection?: {
    ordered_amount: number;
    ordered_quantity: number;
    inspected_amount: number; // これまでの累計
    inspected_quantity: number;
    remaining_amount: number;
    remaining_quantity: number;
    overflow_amount: boolean;
    overflow_quantity: boolean;
  };
};

export type DeliveryLine = {
  order_line_item_id: number;
  // 親 PO 明細の品目名 / 仕様。検収書テンプレが行ごとに表示するため保持する
  //   (未保持だと全行が親の description にフォールバックして同名表示になる)。
  item_name?: string;
  spec?: string;
  inspected_quantity: number;
  acceptance_ratio: number; // 0.0-1.0
  rejection_reason?: string;
  // 明細別の納品日。検収書 Excel / PDF はこの値を明細ごとに反映する。
  //   未入力なら親 PO 明細の delivery_date にフォールバック (excelService 側)。
  delivery_date?: string;
  // 検収書テンプレの業績連動/利用許諾の出し分け・IP帰属表示に使用。親明細から複写。
  deliverable_ownership?: string;
  calc_method?: string;
  royalty_calc_basis?: string;
  rate_pct?: number;
  // derived
  inspected_amount_ex_tax?: number;
};

interface Props {
  /** 親 PO の明細一覧 (各明細に inspection availability が含まれる) */
  orderLines: OrderLineForInspection[];
  /** 今回検収しようとしている入力値 (1 PO 明細につき 1 row) */
  values: DeliveryLine[];
  onChange: (values: DeliveryLine[]) => void;
  readOnly?: boolean;
}

const ceilFee = (unit: number, qty: number, ratio: number) =>
  Math.ceil((Number(unit) || 0) * (Number(qty) || 0) * (Number(ratio) || 0));

const yen = (n: number) =>
  "¥ " + (Number(n) || 0).toLocaleString("ja-JP");

// 受注者帰属かつ発注額0の明細は「利用許諾料に含む」と表示(0円とは出さない)。
//   それ以外は通常の金額表示。
const isLicenseIncluded = (line: OrderLineForInspection) =>
  line.deliverable_ownership === "受注者" && (Number(line.amount_ex_tax) || 0) === 0;

export const DeliveryLineItemTable: React.FC<Props> = ({
  orderLines,
  values,
  onChange,
  readOnly = false,
}) => {
  // values を order_line_item_id でルックアップしやすくする。
  // 親 PO 明細を起点に行を描画し、各行に対応する DeliveryLine を引く。
  const valueByLineId = new Map<number, DeliveryLine>();
  values.forEach((v) => valueByLineId.set(Number(v.order_line_item_id), v));

  const update = (orderLineItemId: number, patch: Partial<DeliveryLine>) => {
    const current = valueByLineId.get(orderLineItemId) || {
      order_line_item_id: orderLineItemId,
      inspected_quantity: 0,
      acceptance_ratio: 1.0,
    };
    const next: DeliveryLine = { ...current, ...patch };
    // recompute inspected_amount_ex_tax based on the parent's unit_price
    const parent = orderLines.find((l) => l.id === orderLineItemId);
    if (parent) {
      // 親 PO 明細から品目名/仕様/帰属/計算方式を引き継ぐ(検収書の行ごと表示・
      //   業績連動/利用許諾の出し分けのため)。
      next.item_name = parent.item_name;
      next.spec = (parent as any).spec;
      next.deliverable_ownership = parent.deliverable_ownership;
      next.calc_method = (parent as any).calc_method;
      next.royalty_calc_basis = (parent as any).royalty_calc_basis;
      next.rate_pct = (parent as any).rate_pct;
      next.inspected_amount_ex_tax = ceilFee(
        parent.unit_price,
        next.inspected_quantity,
        next.acceptance_ratio
      );
    }
    const newValues = values.some((v) => v.order_line_item_id === orderLineItemId)
      ? values.map((v) =>
          v.order_line_item_id === orderLineItemId ? next : v
        )
      : [...values, next];
    onChange(newValues);
  };

  // 全体合計
  const grandTotal = orderLines.reduce((sum, l) => {
    const v = valueByLineId.get(l.id);
    if (!v) return sum;
    return sum + (v.inspected_amount_ex_tax ?? 0);
  }, 0);

  const cellInput = (
    value: string | number | undefined,
    onChange: (v: string) => void,
    type: "text" | "number" = "text",
    placeholder?: string,
    step?: string
  ) => (
    <input
      type={type}
      step={step}
      value={value === undefined || value === null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={readOnly}
      className={cn(
        "w-full text-[11px] font-mono bg-transparent",
        "border-b border-input py-1 px-1 focus:outline-none focus:border-foreground",
        "placeholder:text-muted-foreground/40 placeholder:text-[10px]",
        "disabled:opacity-60 disabled:cursor-not-allowed"
      )}
    />
  );

  if (orderLines.length === 0) {
    return (
      <div className="col-span-full p-4 rounded-sm border border-dashed border-input bg-muted/20 text-[11px] font-mono text-muted-foreground text-center">
        親となる発注書の明細が見つかりませんでした。Backlog 上で発注書 (親 issue)
        との親子関係を設定するか、フォーム下部で手動入力してください。
      </div>
    );
  }

  // Phase 23 UX-E: 各行を 1 度だけ計算してテーブル / カード両方で使う。
  const rows = orderLines.map((line) => {
    const v = valueByLineId.get(line.id);
    const inspectedThisTime = v?.inspected_amount_ex_tax ?? 0;
    const inspectedQtyThisTime = Number(v?.inspected_quantity) || 0;
    const insp = line.inspection || {
      ordered_amount: line.amount_ex_tax || 0,
      ordered_quantity: line.quantity || 0,
      inspected_amount: 0,
      inspected_quantity: 0,
      remaining_amount: line.amount_ex_tax || 0,
      remaining_quantity: line.quantity || 0,
      overflow_amount: false,
      overflow_quantity: false,
    };
    const AMT_EPS = 0.5;
    const QTY_EPS = 0.0005;
    const totalAmt = insp.inspected_amount + inspectedThisTime;
    const totalQty = insp.inspected_quantity + inspectedQtyThisTime;
    const willOverflowAmount = totalAmt - insp.ordered_amount > AMT_EPS;
    const willOverflowQty = totalQty - insp.ordered_quantity > QTY_EPS;
    const isOverflow = willOverflowAmount || willOverflowQty;
    const isExact =
      inspectedThisTime > 0 &&
      !isOverflow &&
      Math.abs(totalAmt - insp.ordered_amount) <= AMT_EPS;
    return {
      line,
      v,
      inspectedThisTime,
      insp,
      isOverflow,
      isExact,
      willOverflowAmount,
      willOverflowQty,
    };
  });

  const statusBadge = (r: typeof rows[number]) =>
    r.isOverflow ? (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded-sm"
        title={`発注額/数量を超過 (${
          r.willOverflowAmount ? "amount" : ""
        }${r.willOverflowAmount && r.willOverflowQty ? " & " : ""}${
          r.willOverflowQty ? "qty" : ""
        })`}
      >
        <AlertTriangle className="w-2.5 h-2.5" /> 超過
      </span>
    ) : r.isExact ? (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-sm">
        <CheckCircle2 className="w-2.5 h-2.5" /> 完了
      </span>
    ) : r.inspectedThisTime > 0 ? (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-sm">
        分割中
      </span>
    ) : (
      <span className="text-[11px] text-muted-foreground">—</span>
    );

  return (
    <div className="col-span-full">
      {/* カード型 (画面幅 < lg = 1024px) ────────────────────────── */}
      <div className="space-y-3 lg:hidden">
        {rows.map((r) => (
          <div
            key={r.line.id}
            className={cn(
              "rounded-md border bg-card p-3 shadow-sm",
              r.isOverflow ? "border-red-300 bg-red-50/40" : "border-border"
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">
                    #{r.line.line_no}
                  </span>
                  {statusBadge(r)}
                </div>
                <div className="font-bold text-sm mt-1">{r.line.item_name}</div>
                {r.line.spec && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {r.line.spec}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px] font-mono py-2 border-y border-border/40 mb-2">
              <div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                  発注
                </div>
                <div className="font-medium">
                  {isLicenseIncluded(r.line) ? (
                    <span className="text-[10px] text-amber-700">利用許諾料に含む</span>
                  ) : (
                    yen(r.insp.ordered_amount)
                  )}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                  既検収
                </div>
                <div className="font-medium">
                  {yen(r.insp.inspected_amount)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                  残
                </div>
                <div
                  className={cn(
                    "font-bold",
                    r.insp.remaining_amount === 0 && "text-emerald-700"
                  )}
                >
                  {yen(r.insp.remaining_amount)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <label className="block">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  今回数量
                </div>
                {cellInput(
                  r.v?.inspected_quantity,
                  (val) =>
                    update(r.line.id, {
                      inspected_quantity: Number(val) || 0,
                    }),
                  "number",
                  "0",
                  "0.0001"
                )}
              </label>
              <label className="block">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  歩留率 (0.0 - 1.0)
                </div>
                {cellInput(
                  r.v?.acceptance_ratio ?? 1.0,
                  (val) => {
                    const n = Number(val);
                    const clamped = Number.isFinite(n)
                      ? Math.max(0, Math.min(1, n))
                      : 1.0;
                    update(r.line.id, { acceptance_ratio: clamped });
                  },
                  "number",
                  "1.0",
                  "0.01"
                )}
              </label>
            </div>
            <label className="block mb-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                納品日 (この明細)
              </div>
              <input
                type="date"
                value={r.v?.delivery_date ?? r.line.delivery_date ?? ""}
                onChange={(e) => update(r.line.id, { delivery_date: e.target.value })}
                disabled={readOnly}
                className={cn(
                  "w-full text-[11px] font-mono bg-transparent",
                  "border-b border-input py-1 px-1 focus:outline-none focus:border-foreground",
                  "disabled:opacity-60 disabled:cursor-not-allowed"
                )}
              />
            </label>
            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                今回検収額 (税抜)
              </span>
              <span className="font-mono font-bold text-base">
                {yen(r.inspectedThisTime)}
              </span>
            </div>
          </div>
        ))}
        <div className="rounded-md border-2 border-foreground/20 bg-muted/30 p-3 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider font-bold">
            今回検収合計 (税抜)
          </span>
          <span className="font-mono font-bold text-lg">{yen(grandTotal)}</span>
        </div>
      </div>

      {/* テーブル型 (画面幅 >= lg) ────────────────────────────── */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-[11px] font-mono border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider">
              <th className="w-8 text-left p-2">#</th>
              <th className="text-left p-2 min-w-[140px]">品目名</th>
              <th className="text-right p-2 w-32">
                発注 / 既検収 / 残
                <div className="text-[10px] font-normal opacity-60 normal-case tracking-normal">
                  (税抜)
                </div>
              </th>
              <th className="text-right p-2 w-20">今回数量</th>
              <th className="text-right p-2 w-16">歩留率</th>
              <th className="text-left p-2 w-32">納品日</th>
              <th className="text-right p-2 w-28">今回検収額</th>
              <th className="text-left p-2 w-20">状態</th>
            </tr>
          </thead>
          <tbody>
            {orderLines.map((line) => {
              const v = valueByLineId.get(line.id);
              const inspectedThisTime = v?.inspected_amount_ex_tax ?? 0;
              const inspectedQtyThisTime = Number(v?.inspected_quantity) || 0;

              const insp = line.inspection || {
                ordered_amount: line.amount_ex_tax || 0,
                ordered_quantity: line.quantity || 0,
                inspected_amount: 0,
                inspected_quantity: 0,
                remaining_amount: line.amount_ex_tax || 0,
                remaining_quantity: line.quantity || 0,
                overflow_amount: false,
                overflow_quantity: false,
              };

              // Phase 9g: 浮動小数点誤差で 0.0001 単位の超過誤判定を防ぐ
              //   - 金額は ¥0.5 まで許容 (Math.ceil 切り上げ後の誤差吸収)
              //   - 数量は 0.0005 まで許容 (DECIMAL(10,4) の最小単位の半分)
              // 厳密比較を避けつつ、明確な超過は確実に検知する。
              const AMT_EPS = 0.5;
              const QTY_EPS = 0.0005;
              const totalAmt = insp.inspected_amount + inspectedThisTime;
              const totalQty = insp.inspected_quantity + inspectedQtyThisTime;
              const willOverflowAmount =
                totalAmt - insp.ordered_amount > AMT_EPS;
              const willOverflowQty =
                totalQty - insp.ordered_quantity > QTY_EPS;
              const isOverflow = willOverflowAmount || willOverflowQty;
              const isExact =
                inspectedThisTime > 0 &&
                !isOverflow &&
                Math.abs(totalAmt - insp.ordered_amount) <= AMT_EPS;

              return (
                <tr
                  key={line.id}
                  className={cn(
                    "border-b border-border/50 hover:bg-muted/20 transition-colors",
                    isOverflow && "bg-red-50"
                  )}
                >
                  <td className="p-2 text-muted-foreground">{line.line_no}</td>
                  <td className="p-2">
                    <div className="font-bold">{line.item_name}</div>
                    {line.spec && (
                      <div className="text-[11px] text-muted-foreground">
                        {line.spec}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-right text-[10px]">
                    <div>
                      {isLicenseIncluded(line) ? (
                        <span className="text-amber-700">利用許諾料に含む</span>
                      ) : (
                        yen(insp.ordered_amount)
                      )}
                    </div>
                    <div className="text-muted-foreground">
                      / {yen(insp.inspected_amount)}
                    </div>
                    <div
                      className={cn(
                        "font-bold",
                        insp.remaining_amount === 0 && "text-emerald-700"
                      )}
                    >
                      残 {yen(insp.remaining_amount)}
                    </div>
                  </td>
                  <td className="p-2 text-right">
                    {cellInput(
                      v?.inspected_quantity,
                      (val) =>
                        update(line.id, {
                          inspected_quantity: Number(val) || 0,
                        }),
                      "number",
                      "0",
                      "0.0001"
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {cellInput(
                      v?.acceptance_ratio ?? 1.0,
                      (val) => {
                        const n = Number(val);
                        const clamped = Number.isFinite(n)
                          ? Math.max(0, Math.min(1, n))
                          : 1.0;
                        update(line.id, { acceptance_ratio: clamped });
                      },
                      "number",
                      "1.0",
                      "0.01"
                    )}
                  </td>
                  <td className="p-2">
                    <input
                      type="date"
                      value={v?.delivery_date ?? line.delivery_date ?? ""}
                      onChange={(e) =>
                        update(line.id, { delivery_date: e.target.value })
                      }
                      disabled={readOnly}
                      className={cn(
                        "w-full text-[11px] font-mono bg-transparent",
                        "border-b border-input py-1 px-1 focus:outline-none focus:border-foreground",
                        "disabled:opacity-60 disabled:cursor-not-allowed"
                      )}
                    />
                  </td>
                  <td className="p-2 text-right font-bold">
                    {yen(inspectedThisTime)}
                  </td>
                  <td className="p-2">
                    {isOverflow ? (
                      <span
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded-sm"
                        title={`発注額/数量を超過しています (overflow: ${
                          willOverflowAmount ? "amount" : ""
                        }${willOverflowAmount && willOverflowQty ? " & " : ""}${
                          willOverflowQty ? "qty" : ""
                        })`}
                      >
                        <AlertTriangle className="w-2.5 h-2.5" /> 超過
                      </span>
                    ) : isExact ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-sm">
                        <CheckCircle2 className="w-2.5 h-2.5" /> 完了
                      </span>
                    ) : inspectedThisTime > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-sm">
                        分割中
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/20 bg-muted/30 font-bold">
              <td colSpan={6} className="p-2 text-right text-[10px] uppercase tracking-wider">
                今回検収合計 (税抜)
              </td>
              <td className="p-2 text-right text-[13px]">{yen(grandTotal)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
