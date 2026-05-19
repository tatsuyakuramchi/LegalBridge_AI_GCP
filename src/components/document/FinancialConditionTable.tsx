/**
 * FinancialConditionTable — 個別利用許諾条件書の「金銭条件 1〜3」を
 * 編集する表 UI。
 *
 * 1 行 = license_financial_conditions 1 件 (condition_no = 1, 2, 3, ...)。
 * 典型的には 1 (自社製造) / 2 (サブライセンス) / 3 (プロダクトアウト) の
 * 3 行で運用されるが任意数追加可能。
 *
 * DB の license_financial_conditions と同じ shape を維持しているので、
 * フロント → /api/license-contracts/:id/financial-conditions に
 * そのまま PUT できる。利用許諾料計算書 (royalty_statement) は
 * 後段で「どの condition で計算するか」をここから選ぶ前提。
 */

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type FinancialCondition = {
  id?: number; // DB の license_financial_conditions.id (新規は未設定)
  condition_no: number; // 1=自社製造, 2=サブライセンス, 3=プロダクトアウト, ...
  region_language_label?: string; // 例: 国内・日本語
  calc_method?: string; // ROYALTY / FIXED / SUBSCRIPTION
  rate_pct?: number; // 例: 5.0 (%)
  base_price_label?: string; // 例: 上代 (MSRP)
  calc_period?: string; // 表示用 free-text label (自動生成 / 手動上書き可)
  // Phase 22.20-B: 計算期間を構造化
  calc_period_kind?: "MANUFACTURING" | "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL";
  calc_period_close_month?: number; // 1-12 (MANUFACTURING / MONTHLY は未設定)
  currency?: string; // JPY / USD ...
  formula_text?: string; // 例: 上代 × 5.0% × 製造数
  payment_terms?: string;
  mg_amount?: number; // MG 総額 (この条件単位)
};

// Phase 22.20-B: kind + close_month から表示ラベルを組み立てる。
//   MANUFACTURING       → "製造時"
//   MONTHLY (月毎)       → "月次"
//   QUARTERLY + 3       → "四半期 (3月締)"
//   SEMIANNUAL + 6      → "半期 (6月締)"
//   ANNUAL + 12         → "年次 (12月締)"
export function buildCalcPeriodLabel(
  kind?: FinancialCondition["calc_period_kind"],
  closeMonth?: number
): string {
  if (!kind) return "";
  if (kind === "MANUFACTURING") return "製造時";
  if (kind === "MONTHLY") return "月次";
  const monthLabel =
    closeMonth && closeMonth >= 1 && closeMonth <= 12
      ? ` (${closeMonth}月締)`
      : "";
  if (kind === "QUARTERLY") return `四半期${monthLabel}`;
  if (kind === "SEMIANNUAL") return `半期${monthLabel}`;
  if (kind === "ANNUAL") return `年次${monthLabel}`;
  return "";
}

const CALC_PERIOD_KIND_OPTIONS: Array<{
  value: NonNullable<FinancialCondition["calc_period_kind"]>;
  label: string;
}> = [
  { value: "MANUFACTURING", label: "製造時" },
  { value: "MONTHLY", label: "月毎 (月次)" },
  { value: "QUARTERLY", label: "四半期毎" },
  { value: "SEMIANNUAL", label: "半期毎" },
  { value: "ANNUAL", label: "年毎" },
];

interface Props {
  conditions: FinancialCondition[];
  onChange: (conditions: FinancialCondition[]) => void;
  readOnly?: boolean;
}

const CONDITION_PRESETS = [
  { no: 1, label: "自社製造" },
  { no: 2, label: "サブライセンス" },
  { no: 3, label: "プロダクトアウト" },
];

const yen = (n: number) =>
  "¥ " + (Number(n) || 0).toLocaleString("ja-JP");

export const FinancialConditionTable: React.FC<Props> = ({
  conditions,
  onChange,
  readOnly = false,
}) => {
  const update = (idx: number, patch: Partial<FinancialCondition>) => {
    const next = conditions.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const addRow = () => {
    // Next condition_no = max + 1 (持っていない最小番号でも良いが、付番は単純化)
    const usedNos = new Set(conditions.map((c) => Number(c.condition_no)));
    let nextNo = 1;
    while (usedNos.has(nextNo)) nextNo++;
    onChange([
      ...conditions,
      {
        condition_no: nextNo,
        currency: "JPY",
        calc_method: "ROYALTY",
        rate_pct: 0,
        mg_amount: 0,
      },
    ]);
  };

  const removeRow = (idx: number) => {
    onChange(conditions.filter((_, i) => i !== idx));
  };

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

  const presetLabel = (no: number) =>
    CONDITION_PRESETS.find((p) => p.no === no)?.label || `条件 ${no}`;

  return (
    <div className="col-span-full space-y-3">
      {conditions.length === 0 ? (
        <div className="p-4 rounded-sm border border-dashed border-input bg-muted/20 text-[11px] font-mono text-muted-foreground text-center">
          金銭条件はまだ追加されていません。下の「条件追加」から開始してください。
        </div>
      ) : (
        conditions.map((c, idx) => {
          const condNo = Number(c.condition_no) || idx + 1;
          return (
            <div
              key={idx}
              className="border border-border rounded-sm bg-card/40 overflow-hidden"
            >
              <header className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-muted/30">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm bg-foreground text-background">
                    条件 {condNo}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {presetLabel(condNo)}
                  </span>
                  <input
                    type="text"
                    value={c.region_language_label || ""}
                    onChange={(e) =>
                      update(idx, { region_language_label: e.target.value })
                    }
                    placeholder="地域・言語ラベル (例: 国内・日本語)"
                    disabled={readOnly}
                    className="flex-1 text-[11px] font-mono bg-transparent border-b border-input py-0.5 px-1 focus:outline-none focus:border-foreground placeholder:text-muted-foreground/40 placeholder:text-[10px]"
                  />
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    className="text-muted-foreground hover:text-destructive transition-colors p-1"
                    title="この条件を削除"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </header>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 p-3 text-[10px] font-mono">
                <div>
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                    計算方式
                  </div>
                  <select
                    value={c.calc_method || ""}
                    onChange={(e) => update(idx, { calc_method: e.target.value })}
                    disabled={readOnly}
                    className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 px-1 focus:outline-none focus:border-foreground"
                  >
                    <option value="">— 選択 —</option>
                    <option value="ROYALTY">ROYALTY (業績連動)</option>
                    <option value="FIXED">FIXED (固定額)</option>
                    <option value="SUBSCRIPTION">SUBSCRIPTION (サブスク)</option>
                  </select>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                    料率 (%)
                  </div>
                  {cellInput(
                    c.rate_pct,
                    (v) => update(idx, { rate_pct: Number(v) || 0 }),
                    "number",
                    "5.0",
                    "0.0001"
                  )}
                </div>
                <div>
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                    基準価格ラベル
                  </div>
                  {cellInput(
                    c.base_price_label,
                    (v) => update(idx, { base_price_label: v }),
                    "text",
                    "上代 (MSRP)"
                  )}
                </div>
                <div>
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                    計算期間 種別
                  </div>
                  <select
                    value={c.calc_period_kind || ""}
                    onChange={(e) => {
                      const kind = e.target.value as FinancialCondition["calc_period_kind"];
                      // 種別変更で MANUFACTURING / MONTHLY なら close_month をリセット
                      const needsMonth =
                        kind === "QUARTERLY" ||
                        kind === "SEMIANNUAL" ||
                        kind === "ANNUAL";
                      const month = needsMonth ? c.calc_period_close_month : undefined;
                      update(idx, {
                        calc_period_kind: kind,
                        calc_period_close_month: month,
                        // 表示ラベルを自動生成 (ユーザーが calc_period に手動入力済みでも上書き)
                        calc_period: buildCalcPeriodLabel(kind, month),
                      });
                    }}
                    disabled={readOnly}
                    className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 px-1 focus:outline-none focus:border-foreground"
                  >
                    <option value="">— 選択 —</option>
                    {CALC_PERIOD_KIND_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                {/* 計算月 — QUARTERLY/SEMIANNUAL/ANNUAL のときだけ意味あり */}
                <div>
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                    計算月 (締め月)
                  </div>
                  {c.calc_period_kind === "QUARTERLY" ||
                  c.calc_period_kind === "SEMIANNUAL" ||
                  c.calc_period_kind === "ANNUAL" ? (
                    <select
                      value={c.calc_period_close_month || ""}
                      onChange={(e) => {
                        const m = Number(e.target.value) || undefined;
                        update(idx, {
                          calc_period_close_month: m,
                          calc_period: buildCalcPeriodLabel(c.calc_period_kind, m),
                        });
                      }}
                      disabled={readOnly}
                      className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 px-1 focus:outline-none focus:border-foreground"
                    >
                      <option value="">— 月選択 —</option>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>
                          {m}月
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-[10px] font-mono text-muted-foreground/60 py-1 px-1 border-b border-dashed border-input/50">
                      (種別によっては不要)
                    </div>
                  )}
                  {c.calc_period && (
                    <div className="text-[9px] font-mono text-muted-foreground/70 mt-0.5">
                      ラベル: {c.calc_period}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                    通貨
                  </div>
                  <select
                    value={c.currency || "JPY"}
                    onChange={(e) => update(idx, { currency: e.target.value })}
                    disabled={readOnly}
                    className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 px-1 focus:outline-none focus:border-foreground"
                  >
                    <option value="JPY">JPY</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="CNY">CNY</option>
                  </select>
                </div>
                <div className="md:col-span-3">
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                    支払条件
                  </div>
                  {cellInput(
                    c.payment_terms,
                    (v) => update(idx, { payment_terms: v }),
                    "text",
                    "例: 四半期報告後の翌月末日払い"
                  )}
                </div>

                <div className="col-span-2 md:col-span-3">
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                    計算式
                  </div>
                  <textarea
                    value={c.formula_text || ""}
                    onChange={(e) => update(idx, { formula_text: e.target.value })}
                    placeholder="例: 上代 × 5.0% × 製造数"
                    disabled={readOnly}
                    rows={1}
                    className={cn(
                      "w-full text-[11px] font-mono bg-card border border-input rounded-sm px-2 py-1 resize-y",
                      "focus:outline-none focus:border-foreground",
                      "placeholder:text-muted-foreground/40 placeholder:text-[10px]"
                    )}
                  />
                </div>
                <div>
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                    MG 額
                  </div>
                  {cellInput(
                    c.mg_amount,
                    (v) => update(idx, { mg_amount: Number(v) || 0 }),
                    "number",
                    "0",
                    "1"
                  )}
                  {c.mg_amount && c.mg_amount > 0 ? (
                    <div className="text-[9px] text-muted-foreground mt-0.5">
                      {yen(c.mg_amount)}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })
      )}

      {!readOnly && (
        <div className="flex justify-between items-center">
          <button
            type="button"
            onClick={addRow}
            className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 hover:bg-muted px-3 py-1.5 rounded-sm flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3 h-3" />
            条件追加
          </button>
          <div className="text-[10px] font-mono text-muted-foreground italic">
            利用許諾料計算書はこのテーブルの条件 1 行を指して計算します。
          </div>
        </div>
      )}
    </div>
  );
};
