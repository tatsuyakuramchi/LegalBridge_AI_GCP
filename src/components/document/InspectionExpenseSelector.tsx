/**
 * InspectionExpenseSelector — 検収書で経費（交通費等）を精算するための
 * チェックボックス UI (Phase 17m)。
 *
 * 親 PO に order_expenses が登録されているとき、検収書フォーム上で
 * どの経費を今回の検収・支払に含めるかを行単位で選択できる。
 *
 * 動作:
 *   - 親契約の全経費を一覧表示 (ContractDetail.expenses)
 *   - 各行にチェックボックス
 *   - 「最終検収（全経費を含める）」トグル ON で全行を一括選択
 *   - 選択行の合計（税込）を即時表示
 *
 * 親 (DocumentForm) は selectedLineNos の配列を保持し、その配列に
 * 対応する行だけを formData.expenses として PDF テンプレに渡す。
 */

import * as React from "react";
import { Receipt, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type InspectionExpense = {
  line_no: number;
  expense_name: string;
  spec?: string;
  spent_date?: string;
  amount_inc_tax: number;
  remarks?: string;
};

interface Props {
  /** 親 PO の経費全件。order_expenses から取得済み。 */
  poExpenses: InspectionExpense[];
  /** 「今回含める」とユーザーがチェックした line_no の配列。 */
  selectedLineNos: number[];
  onChange: (selectedLineNos: number[]) => void;
  /** 最終検収トグル ON → 全行自動チェック / OFF → 個別選択 */
  isFinalInspection: boolean;
  onToggleFinal: (v: boolean) => void;
}

const formatDate = (s?: string) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("ja-JP");
};

export const InspectionExpenseSelector: React.FC<Props> = ({
  poExpenses,
  selectedLineNos,
  onChange,
  isFinalInspection,
  onToggleFinal,
}) => {
  if (!Array.isArray(poExpenses) || poExpenses.length === 0) {
    return (
      <div className="text-[10px] italic text-muted-foreground p-3 border border-dashed border-input rounded-sm">
        親 PO に経費の登録はありません。
      </div>
    );
  }

  const toggleRow = (lineNo: number) => {
    if (isFinalInspection) return; // 最終検収中は個別チェック不可
    const next = new Set(selectedLineNos);
    if (next.has(lineNo)) next.delete(lineNo);
    else next.add(lineNo);
    onChange(Array.from(next).sort((a, b) => Number(a) - Number(b)));
  };

  const toggleAll = (on: boolean) => {
    if (on) onChange(poExpenses.map((e) => e.line_no));
    else onChange([]);
  };

  const onFinalToggle = () => {
    const newVal = !isFinalInspection;
    onToggleFinal(newVal);
    // 最終検収 ON → 全選択、OFF にしても選択は維持 (ユーザーが個別に外せる)
    if (newVal) {
      onChange(poExpenses.map((e) => e.line_no));
    }
  };

  const selectedSet = new Set(selectedLineNos);
  const selectedTotal = poExpenses
    .filter((e) => selectedSet.has(e.line_no))
    .reduce((s, e) => s + (Number(e.amount_inc_tax) || 0), 0);
  const grandTotal = poExpenses.reduce(
    (s, e) => s + (Number(e.amount_inc_tax) || 0),
    0
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
          <Receipt className="w-3 h-3" />
          親 PO の経費 {poExpenses.length} 件 / 合計 ¥
          {grandTotal.toLocaleString("ja-JP")} (税込)
        </div>
        <button
          type="button"
          onClick={onFinalToggle}
          className={cn(
            "text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-sm border flex items-center gap-1.5 transition-colors",
            isFinalInspection
              ? "bg-success text-white border-success shadow ring-1 ring-success"
              : "border-foreground/30 hover:bg-muted"
          )}
          title="ON にすると全経費を自動で「今回含める」になります"
        >
          <Sparkles className="w-3 h-3" />
          {isFinalInspection ? "✓ 最終検収（全経費を含む）" : "最終検収にする"}
        </button>
      </div>

      <div className="overflow-x-auto border border-border/60 rounded-sm">
        <table className="w-full text-[11px] font-mono border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider">
              <th className="p-2 w-12 text-center">
                <input
                  type="checkbox"
                  checked={
                    poExpenses.length > 0 &&
                    selectedLineNos.length === poExpenses.length
                  }
                  onChange={(e) => toggleAll(e.target.checked)}
                  disabled={isFinalInspection}
                  title="全行を一括選択"
                />
              </th>
              <th className="text-left p-2 w-8">#</th>
              <th className="text-left p-2 min-w-[140px]">費目</th>
              <th className="text-left p-2 min-w-[140px]">仕様 / 区間</th>
              <th className="text-left p-2 w-28">発生日</th>
              <th className="text-right p-2 w-28">金額（税込）</th>
              <th className="text-left p-2 min-w-[120px]">摘要</th>
            </tr>
          </thead>
          <tbody>
            {poExpenses.map((e) => {
              const checked = selectedSet.has(e.line_no);
              return (
                <tr
                  key={e.line_no}
                  className={cn(
                    "border-b border-border/50 transition-colors cursor-pointer",
                    checked
                      ? "bg-success/10 hover:bg-success/10"
                      : "hover:bg-muted/20"
                  )}
                  onClick={() => toggleRow(e.line_no)}
                >
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRow(e.line_no)}
                      onClick={(ev) => ev.stopPropagation()}
                      disabled={isFinalInspection}
                    />
                  </td>
                  <td className="p-2 text-muted-foreground">{e.line_no}</td>
                  <td className="p-2 font-bold">{e.expense_name}</td>
                  <td className="p-2 text-muted-foreground whitespace-pre-wrap">
                    {e.spec || "—"}
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {formatDate(e.spent_date)}
                  </td>
                  <td className="p-2 text-right font-bold">
                    ¥ {Number(e.amount_inc_tax).toLocaleString("ja-JP")}
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {e.remarks || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/20 bg-muted/30 font-bold">
              <td colSpan={5} className="p-2 text-right text-[10px] uppercase tracking-wider">
                今回精算する経費合計 ({selectedLineNos.length} / {poExpenses.length} 件)
              </td>
              <td className="p-2 text-right text-[13px] text-success">
                ¥ {selectedTotal.toLocaleString("ja-JP")}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="text-[10px] text-muted-foreground italic">
        ※ 経費は税込み額にて精算します。今回チェックを入れた経費だけが
        本検収書の支払額に加算され、PDF にも記載されます。
      </div>
    </div>
  );
};
