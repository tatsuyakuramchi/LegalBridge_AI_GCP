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
  inspected_quantity: number;
  acceptance_ratio: number; // 0.0-1.0
  rejection_reason?: string;
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

  return (
    <div className="col-span-full">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider">
              <th className="w-8 text-left p-2">#</th>
              <th className="text-left p-2 min-w-[140px]">品目名</th>
              <th className="text-right p-2 w-32">
                発注 / 既検収 / 残
                <div className="text-[8px] font-normal opacity-60 normal-case tracking-normal">
                  (税抜)
                </div>
              </th>
              <th className="text-right p-2 w-20">今回数量</th>
              <th className="text-right p-2 w-16">歩留率</th>
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
                      <div className="text-[9px] text-muted-foreground">
                        {line.spec}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-right text-[10px]">
                    <div>{yen(insp.ordered_amount)}</div>
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
                  <td className="p-2 text-right font-bold">
                    {yen(inspectedThisTime)}
                  </td>
                  <td className="p-2">
                    {isOverflow ? (
                      <span
                        className="inline-flex items-center gap-1 text-[9px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded-sm"
                        title={`発注額/数量を超過しています (overflow: ${
                          willOverflowAmount ? "amount" : ""
                        }${willOverflowAmount && willOverflowQty ? " & " : ""}${
                          willOverflowQty ? "qty" : ""
                        })`}
                      >
                        <AlertTriangle className="w-2.5 h-2.5" /> 超過
                      </span>
                    ) : isExact ? (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-sm">
                        <CheckCircle2 className="w-2.5 h-2.5" /> 完了
                      </span>
                    ) : inspectedThisTime > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[9px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-sm">
                        分割中
                      </span>
                    ) : (
                      <span className="text-[9px] text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/20 bg-muted/30 font-bold">
              <td colSpan={5} className="p-2 text-right text-[10px] uppercase tracking-wider">
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
