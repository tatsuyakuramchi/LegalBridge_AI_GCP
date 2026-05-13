/**
 * LineItemTable — reusable editable line items table for 発注書 etc.
 *
 * Maps 1:1 to the order_line_items DB shape:
 *   line_no / item_name / spec / unit_price / quantity / amount_ex_tax /
 *   payment_method / payment_date
 *
 * Pure controlled component: caller owns `items` state and the
 * setter via `onChange`. Subtotals are recomputed in render (no
 * client-side state for derived values).
 *
 * Subtotal rule matches services/worker/src/lib/billing.ts:
 *   amount_ex_tax = Math.ceil(unit_price × quantity)
 * which is the same formula the server re-applies on save, so the
 * preview the user sees here is byte-equivalent to the persisted value.
 */

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type LineItem = {
  line_no?: number;
  item_name: string;
  spec?: string;
  unit_price: number;
  quantity: number;
  // amount_ex_tax is derived in render — kept in state for round-trips
  amount_ex_tax?: number;
  /**
   * Phase 13: 計算方式 (FIXED / SUBSCRIPTION / ROYALTY)。
   * license_financial_conditions と同じ語彙。default は 'FIXED'。
   */
  calc_method?: "FIXED" | "SUBSCRIPTION" | "ROYALTY" | string;
  /**
   * Phase 13: 支払条件 (自由テキスト)。例: '翌月末', '検収後即時', '月額更新'。
   */
  payment_terms?: string;
  payment_date?: string;
  /**
   * Phase 17h: 業務明細ごとの納期。分納時は明細ごとに異なる日付を持てる。
   */
  delivery_date?: string;
  /**
   * @deprecated Phase 13 で payment_terms に分離。後方互換のため残置。
   * UI には表示しないが、CSV 入力 / 既存 DB 行とは互換性維持。
   */
  payment_method?: string;
};

const CALC_METHOD_OPTIONS: Array<{
  value: "FIXED" | "SUBSCRIPTION" | "ROYALTY";
  label: string;
}> = [
  { value: "FIXED", label: "FIXED (固定額)" },
  { value: "SUBSCRIPTION", label: "SUBSCRIPTION (サブスク)" },
  { value: "ROYALTY", label: "ROYALTY (業績連動)" },
];

interface Props {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  /** When true, hide the [+ 行追加] / [削除] controls. */
  readOnly?: boolean;
  /** Override the column set if the document doesn't have payment columns. */
  showPaymentColumns?: boolean;
}

const ceilProduct = (a: number, b: number) =>
  Math.ceil((Number(a) || 0) * (Number(b) || 0));

export const LineItemTable: React.FC<Props> = ({
  items,
  onChange,
  readOnly = false,
  showPaymentColumns = true,
}) => {
  const update = (idx: number, patch: Partial<LineItem>) => {
    const next = items.slice();
    next[idx] = { ...next[idx], ...patch };
    // Auto-recompute subtotal if either unit_price or quantity changed
    if (patch.unit_price !== undefined || patch.quantity !== undefined) {
      next[idx].amount_ex_tax = ceilProduct(
        next[idx].unit_price ?? 0,
        next[idx].quantity ?? 0
      );
    }
    onChange(next);
  };

  const addRow = () => {
    onChange([
      ...items,
      {
        line_no: items.length + 1,
        item_name: "",
        spec: "",
        unit_price: 0,
        quantity: 1,
        amount_ex_tax: 0,
        // Phase 13: 新規行は FIXED で初期化 (PO は通常固定額)
        calc_method: "FIXED",
        payment_terms: "",
        payment_date: "",
        delivery_date: "",
      },
    ]);
  };

  const removeRow = (idx: number) => {
    const next = items
      .filter((_, i) => i !== idx)
      .map((it, i) => ({ ...it, line_no: i + 1 }));
    onChange(next);
  };

  const grandTotal = items.reduce((sum, it) => {
    const amt = it.amount_ex_tax ?? ceilProduct(it.unit_price ?? 0, it.quantity ?? 0);
    return sum + amt;
  }, 0);

  const cellInput = (
    value: string | number | undefined,
    onChange: (v: string) => void,
    type: "text" | "number" | "date" = "text",
    placeholder?: string
  ) => (
    <input
      type={type}
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

  return (
    <div className="col-span-full">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider">
              <th className="w-8 text-left p-2">#</th>
              <th className="text-left p-2 min-w-[140px]">品目名</th>
              <th className="text-left p-2 min-w-[140px]">仕様</th>
              <th className="text-right p-2 w-24">単価</th>
              <th className="text-right p-2 w-20">数量</th>
              <th className="text-right p-2 w-28">小計 (税抜)</th>
              {showPaymentColumns && (
                <>
                  <th className="text-left p-2 w-32">計算方式</th>
                  <th className="text-left p-2 w-28">支払条件</th>
                  <th className="text-left p-2 w-28">納期</th>
                  <th className="text-left p-2 w-28">支払日</th>
                </>
              )}
              {!readOnly && <th className="w-8 p-2"></th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                {/* Phase 17h: 列数が変わったので colspan を再計算
                    基本 6 列 (#/品目/仕様/単価/数量/小計)
                    + showPayment なら 4 列 (計算方式/支払条件/納期/支払日)
                    + !readOnly なら 1 列 (削除ボタン) */}
                <td
                  colSpan={
                    6 +
                    (showPaymentColumns ? 4 : 0) +
                    (readOnly ? 0 : 1)
                  }
                  className="p-3 text-center text-muted-foreground italic"
                >
                  明細はまだ追加されていません。下の「行追加」から開始してください。
                </td>
              </tr>
            ) : (
              items.map((it, idx) => {
                const amount =
                  it.amount_ex_tax ?? ceilProduct(it.unit_price ?? 0, it.quantity ?? 0);
                return (
                  <tr
                    key={idx}
                    className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                  >
                    <td className="p-2 text-muted-foreground">{idx + 1}</td>
                    <td className="p-2">
                      {cellInput(it.item_name, (v) => update(idx, { item_name: v }), "text", "例: ノートPC")}
                    </td>
                    <td className="p-2">
                      {cellInput(it.spec, (v) => update(idx, { spec: v }), "text", "規格・モデル")}
                    </td>
                    <td className="p-2 text-right">
                      {cellInput(
                        it.unit_price,
                        (v) => update(idx, { unit_price: Number(v) || 0 }),
                        "number",
                        "0"
                      )}
                    </td>
                    <td className="p-2 text-right">
                      {cellInput(
                        it.quantity,
                        (v) => update(idx, { quantity: Number(v) || 0 }),
                        "number",
                        "1"
                      )}
                    </td>
                    <td className="p-2 text-right font-bold">
                      ¥ {Number(amount).toLocaleString("ja-JP")}
                    </td>
                    {showPaymentColumns && (
                      <>
                        {/* Phase 13: 計算方式 (ライセンス側と同じ語彙の FIXED / SUBSCRIPTION / ROYALTY) */}
                        <td className="p-2">
                          <select
                            value={it.calc_method || "FIXED"}
                            onChange={(e) =>
                              update(idx, {
                                calc_method: e.target
                                  .value as LineItem["calc_method"],
                              })
                            }
                            disabled={readOnly}
                            className={cn(
                              "w-full text-[11px] font-mono bg-transparent",
                              "border-b border-input py-1 px-1 focus:outline-none focus:border-foreground",
                              "disabled:opacity-60 disabled:cursor-not-allowed"
                            )}
                          >
                            {CALC_METHOD_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        {/* Phase 13: 支払条件 (旧 payment_method の自由テキスト部分を継承) */}
                        <td className="p-2">
                          {cellInput(
                            it.payment_terms ?? it.payment_method,
                            (v) =>
                              update(idx, {
                                payment_terms: v,
                                // 旧フィールドも同期 (テンプレ後方互換)
                                payment_method: v,
                              }),
                            "text",
                            "翌月末"
                          )}
                        </td>
                        {/* Phase 17h: 納期 (delivery_date) */}
                        <td className="p-2">
                          {cellInput(
                            it.delivery_date,
                            (v) => update(idx, { delivery_date: v }),
                            "date"
                          )}
                        </td>
                        <td className="p-2">
                          {cellInput(
                            it.payment_date,
                            (v) => update(idx, { payment_date: v }),
                            "date"
                          )}
                        </td>
                      </>
                    )}
                    {!readOnly && (
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1"
                          title="この行を削除"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/20 bg-muted/30 font-bold">
              <td colSpan={5} className="p-2 text-right text-[10px] uppercase tracking-wider">
                合計 (税抜)
              </td>
              <td className="p-2 text-right text-[13px]">
                ¥ {grandTotal.toLocaleString("ja-JP")}
              </td>
              {/* Phase 17h: 計算方式 / 支払条件 / 納期 / 支払日 の 4 列 */}
              {showPaymentColumns && <td colSpan={4}></td>}
              {!readOnly && <td></td>}
            </tr>
          </tfoot>
        </table>
      </div>

      {!readOnly && (
        <div className="mt-3 flex justify-between items-center">
          <button
            type="button"
            onClick={addRow}
            className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 hover:bg-muted px-3 py-1.5 rounded-sm flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3 h-3" />
            行追加
          </button>
          <div className="text-[10px] font-mono text-muted-foreground italic">
            小計は単価 × 数量を切り上げで自動計算されます (税は別途)。
          </div>
        </div>
      )}
    </div>
  );
};
