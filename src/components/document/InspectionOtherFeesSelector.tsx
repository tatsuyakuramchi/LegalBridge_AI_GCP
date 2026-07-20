/**
 * InspectionOtherFeesSelector — 検収書でその他手数料を精算するための
 * チェックボックス UI (Phase 22.21.57)
 *
 * 親 PO に order_other_fees (税抜・コーディネート費・振込手数料 等) が
 * 登録されているとき、検収書フォーム上でどの手数料を今回の検収・支払に
 * 含めるかを行単位で選択できる。
 *
 * 経費版 (InspectionExpenseSelector) と全く同じ流儀:
 *   - 親 PO の全手数料を一覧表示
 *   - 各行にチェックボックス
 *   - 「最終検収（全て含める）」トグル ON で一括選択
 *   - 選択行の合計（税抜）を即時表示
 */

import * as React from "react";
import { Coins, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type InspectionOtherFee = {
  line_no: number;
  fee_name: string;
  amount: number;
  remarks?: string;
};

interface Props {
  poOtherFees: InspectionOtherFee[];
  selectedLineNos: number[];
  onChange: (selectedLineNos: number[]) => void;
  /** 最終検収トグル ON → 全行自動チェック */
  isFinalInspection: boolean;
  onToggleFinal: (v: boolean) => void;
}

export const InspectionOtherFeesSelector: React.FC<Props> = ({
  poOtherFees,
  selectedLineNos,
  onChange,
  isFinalInspection,
  onToggleFinal,
}) => {
  if (!Array.isArray(poOtherFees) || poOtherFees.length === 0) {
    return (
      <div className="text-[10px] italic text-muted-foreground p-3 border border-dashed border-input rounded-sm">
        親 PO にその他手数料の登録はありません。
      </div>
    );
  }

  const toggleRow = (lineNo: number) => {
    if (isFinalInspection) return;
    const next = new Set(selectedLineNos);
    if (next.has(lineNo)) next.delete(lineNo);
    else next.add(lineNo);
    onChange(Array.from(next).sort((a, b) => Number(a) - Number(b)));
  };

  const toggleAll = (on: boolean) => {
    if (on) onChange(poOtherFees.map((f) => f.line_no));
    else onChange([]);
  };

  const onFinalToggle = () => {
    const newVal = !isFinalInspection;
    onToggleFinal(newVal);
    if (newVal) {
      onChange(poOtherFees.map((f) => f.line_no));
    }
  };

  const selectedSet = new Set(selectedLineNos);
  const selectedTotal = poOtherFees
    .filter((f) => selectedSet.has(f.line_no))
    .reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const grandTotal = poOtherFees.reduce(
    (s, f) => s + (Number(f.amount) || 0),
    0
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
          <Coins className="w-3 h-3" />
          親 PO のその他手数料 {poOtherFees.length} 件 / 合計 ¥
          {grandTotal.toLocaleString("ja-JP")} (税抜)
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
          title="ON にすると全手数料を自動で「今回含める」になります"
        >
          <Sparkles className="w-3 h-3" />
          {isFinalInspection ? "✓ 最終検収（全手数料を含む）" : "最終検収にする"}
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
                    poOtherFees.length > 0 &&
                    selectedLineNos.length === poOtherFees.length
                  }
                  onChange={(e) => toggleAll(e.target.checked)}
                  disabled={isFinalInspection}
                  title="全行を一括選択"
                />
              </th>
              <th className="text-left p-2 w-8">#</th>
              <th className="text-left p-2 min-w-[180px]">項目名</th>
              <th className="text-right p-2 w-32">金額（税抜）</th>
              <th className="text-left p-2 min-w-[140px]">摘要</th>
            </tr>
          </thead>
          <tbody>
            {poOtherFees.map((f) => {
              const checked = selectedSet.has(f.line_no);
              return (
                <tr
                  key={f.line_no}
                  className={cn(
                    "border-b border-border/50 transition-colors cursor-pointer",
                    checked
                      ? "bg-success/10 hover:bg-success/10"
                      : "hover:bg-muted/20"
                  )}
                  onClick={() => toggleRow(f.line_no)}
                >
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRow(f.line_no)}
                      onClick={(ev) => ev.stopPropagation()}
                      disabled={isFinalInspection}
                    />
                  </td>
                  <td className="p-2 text-muted-foreground">{f.line_no}</td>
                  <td className="p-2 font-bold">{f.fee_name}</td>
                  <td className="p-2 text-right font-bold">
                    ¥ {Number(f.amount).toLocaleString("ja-JP")}
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {f.remarks || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/20 bg-muted/30 font-bold">
              <td colSpan={3} className="p-2 text-right text-[10px] uppercase tracking-wider">
                今回精算する手数料合計 ({selectedLineNos.length} / {poOtherFees.length} 件)
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
        ※ その他手数料は税抜表示。チェックを入れた手数料の合計が本検収書の
        税抜支払額に加算されます (消費税は税抜額に対して再計算)。
      </div>
    </div>
  );
};
