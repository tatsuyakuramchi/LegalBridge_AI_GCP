/**
 * OtherFeesTable — 業務報酬とは別の「その他手数料」を行単位で持つ (Phase 22.21.56)
 *
 * 経費 (ExpenseTable / 税込・実費精算) とは別物:
 *   - その他手数料は 業務に紐づく追加報酬 (コーディネート費・振込手数料・通訳手配料 等)
 *   - 税抜表示 で grandTotalExTax に合算される
 *   - 経費は領収書ベースの実費精算 (税込)、合計には入らず別表で精算
 *
 * Data shape (form_data.other_fees):
 *   { line_no, fee_name, amount, remarks }[]
 *
 * Pure controlled component。親が `fees` を持ち、`onChange` で配列まるごと差し替え。
 */

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type OtherFee = {
  line_no?: number;
  fee_name: string;
  /** 税抜金額 (grandTotalExTax に加算される) */
  amount: number;
  remarks?: string;
};

interface Props {
  fees: OtherFee[];
  onChange: (fees: OtherFee[]) => void;
  readOnly?: boolean;
}

export const OtherFeesTable: React.FC<Props> = ({
  fees,
  onChange,
  readOnly = false,
}) => {
  const update = (idx: number, patch: Partial<OtherFee>) => {
    const next = fees.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const addRow = () => {
    onChange([
      ...fees,
      {
        line_no: fees.length + 1,
        fee_name: "",
        amount: 0,
        remarks: "",
      },
    ]);
  };

  const removeRow = (idx: number) => {
    const next = fees
      .filter((_, i) => i !== idx)
      .map((e, i) => ({ ...e, line_no: i + 1 }));
    onChange(next);
  };

  const grandTotal = fees.reduce(
    (sum, f) => sum + (Number(f.amount) || 0),
    0
  );

  const cellInput = (
    value: string | number | undefined,
    onChange: (v: string) => void,
    type: "text" | "number" = "text",
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
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          その他手数料（税抜・合計に加算）
        </div>
        <div className="text-[10px] text-muted-foreground italic">
          ※ コーディネート費・振込手数料 等。経費 (税込・別精算) とは区別します
        </div>
      </div>
      <div className="overflow-x-auto border border-border/60 rounded-sm">
        <table className="w-full text-[11px] font-mono border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider">
              <th className="w-8 text-left p-2">#</th>
              <th className="text-left p-2 min-w-[180px]">項目名</th>
              <th className="text-right p-2 w-32">金額（税抜）</th>
              <th className="text-left p-2 min-w-[160px]">摘要</th>
              {!readOnly && <th className="w-8 p-2"></th>}
            </tr>
          </thead>
          <tbody>
            {fees.length === 0 ? (
              <tr>
                <td
                  colSpan={4 + (readOnly ? 0 : 1)}
                  className="p-3 text-center text-muted-foreground italic"
                >
                  その他手数料はまだ追加されていません。下の「行追加」から開始してください。
                </td>
              </tr>
            ) : (
              fees.map((f, idx) => (
                <tr
                  key={idx}
                  className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                >
                  <td className="p-2 text-muted-foreground">{idx + 1}</td>
                  <td className="p-2">
                    {cellInput(
                      f.fee_name,
                      (v) => update(idx, { fee_name: v }),
                      "text",
                      "例: コーディネート費 / 振込手数料"
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {cellInput(
                      f.amount,
                      (v) => update(idx, { amount: Number(v) || 0 }),
                      "number",
                      "0"
                    )}
                  </td>
                  <td className="p-2">
                    {cellInput(
                      f.remarks,
                      (v) => update(idx, { remarks: v }),
                      "text",
                      "(任意)"
                    )}
                  </td>
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
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/20 bg-muted/30 font-bold">
              <td colSpan={2} className="p-2 text-right text-[10px] uppercase tracking-wider">
                手数料 小計 (税抜)
              </td>
              <td className="p-2 text-right text-[13px]">
                ¥ {grandTotal.toLocaleString("ja-JP")}
              </td>
              <td></td>
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
            className="text-[10px] uppercase tracking-wider border border-foreground/30 hover:bg-muted px-3 py-1.5 rounded-sm flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3 h-3" />
            行追加
          </button>
          <div className="text-[10px] text-muted-foreground italic">
            業務委託報酬とは別の追加報酬。発注合計 (税抜) に加算されます。
          </div>
        </div>
      )}
    </div>
  );
};
