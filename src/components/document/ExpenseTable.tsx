/**
 * ExpenseTable — reusable editable expense rows for 発注書 etc. (Phase 17i)
 *
 * 交通費・宿泊費等の経費を、業務報酬とは独立して行単位で持つ。
 * 領収書の額面（税込み額）をそのまま入力する想定。
 *
 * Maps 1:1 to the order_expenses DB shape:
 *   line_no / expense_name / spec / spent_date / amount_inc_tax / remarks
 *
 * Pure controlled component (LineItemTable と同じ流儀): 親が `expenses`
 * を state として保持し、`onChange` 経由で更新する。
 */

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ExpenseItem = {
  line_no?: number;
  expense_name: string;
  spec?: string;
  spent_date?: string;
  /** 税込み金額（領収書額面そのまま） */
  amount_inc_tax: number;
  remarks?: string;
};

interface Props {
  expenses: ExpenseItem[];
  onChange: (expenses: ExpenseItem[]) => void;
  readOnly?: boolean;
}

export const ExpenseTable: React.FC<Props> = ({
  expenses,
  onChange,
  readOnly = false,
}) => {
  const update = (idx: number, patch: Partial<ExpenseItem>) => {
    const next = expenses.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const addRow = () => {
    onChange([
      ...expenses,
      {
        line_no: expenses.length + 1,
        expense_name: "",
        spec: "",
        spent_date: "",
        amount_inc_tax: 0,
        remarks: "",
      },
    ]);
  };

  const removeRow = (idx: number) => {
    const next = expenses
      .filter((_, i) => i !== idx)
      .map((e, i) => ({ ...e, line_no: i + 1 }));
    onChange(next);
  };

  const grandTotal = expenses.reduce(
    (sum, e) => sum + (Number(e.amount_inc_tax) || 0),
    0
  );

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

  /**
   * Phase 17j: 複数行 (改行) 入力対応のセル。仕様欄 etc に使う。
   */
  const cellTextarea = (
    value: string | undefined,
    onChange: (v: string) => void,
    placeholder?: string
  ) => (
    <textarea
      value={value === undefined || value === null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={readOnly}
      rows={1}
      onInput={(e) => {
        const ta = e.currentTarget;
        ta.style.height = "auto";
        ta.style.height = ta.scrollHeight + "px";
      }}
      className={cn(
        "w-full text-[11px] font-mono bg-transparent resize-none overflow-hidden",
        "border-b border-input py-1 px-1 focus:outline-none focus:border-foreground",
        "placeholder:text-muted-foreground/40 placeholder:text-[10px]",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        "whitespace-pre-wrap break-words leading-relaxed"
      )}
    />
  );

  return (
    <div className="col-span-full">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          経費（交通費等・税込み額）
        </div>
        <div className="text-[10px] font-mono text-muted-foreground italic">
          ※ 領収書額面（税込み）をそのまま入力します
        </div>
      </div>
      <div className="overflow-x-auto border border-border/60 rounded-sm">
        <table className="w-full text-[11px] font-mono border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider">
              <th className="w-8 text-left p-2">#</th>
              <th className="text-left p-2 min-w-[140px]">費目</th>
              <th className="text-left p-2 min-w-[140px]">仕様 / 区間 等</th>
              <th className="text-left p-2 w-28">発生日</th>
              <th className="text-right p-2 w-28">金額（税込）</th>
              <th className="text-left p-2 min-w-[120px]">摘要</th>
              {!readOnly && <th className="w-8 p-2"></th>}
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 ? (
              <tr>
                <td
                  colSpan={6 + (readOnly ? 0 : 1)}
                  className="p-3 text-center text-muted-foreground italic"
                >
                  経費はまだ追加されていません。下の「行追加」から開始してください。
                </td>
              </tr>
            ) : (
              expenses.map((e, idx) => (
                <tr
                  key={idx}
                  className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                >
                  <td className="p-2 text-muted-foreground">{idx + 1}</td>
                  <td className="p-2">
                    {cellInput(
                      e.expense_name,
                      (v) => update(idx, { expense_name: v }),
                      "text",
                      "例: 交通費 / 宿泊費"
                    )}
                  </td>
                  <td className="p-2 align-top">
                    {/* Phase 17j: 仕様は複数行 (改行可) */}
                    {cellTextarea(
                      e.spec,
                      (v) => update(idx, { spec: v }),
                      "例: 東京〜大阪 新幹線 (複数行可)"
                    )}
                  </td>
                  <td className="p-2">
                    {cellInput(
                      e.spent_date,
                      (v) => update(idx, { spent_date: v }),
                      "date"
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {cellInput(
                      e.amount_inc_tax,
                      (v) =>
                        update(idx, {
                          amount_inc_tax: Number(v) || 0,
                        }),
                      "number",
                      "0"
                    )}
                  </td>
                  <td className="p-2">
                    {cellInput(
                      e.remarks,
                      (v) => update(idx, { remarks: v }),
                      "text",
                      "領収書 No 等"
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
              <td colSpan={4} className="p-2 text-right text-[10px] uppercase tracking-wider">
                経費合計 (税込)
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
            className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 hover:bg-muted px-3 py-1.5 rounded-sm flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3 h-3" />
            行追加
          </button>
          <div className="text-[10px] font-mono text-muted-foreground italic">
            経費は税込み額表示です。本体の業務報酬とは別に精算されます。
          </div>
        </div>
      )}
    </div>
  );
};
