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

// 構造化した計算式タイプ。条件明細 DB の calc_type に対応。
//   BASE_QTY_RATE : 基準価格 × 個数 × 料率
//   BASE_RATE     : 基準価格 × 料率
//   FIXED         : 固定値 (一括/分割)
//   SUBSCRIPTION  : サブスクリプション (月払い/年払い)
//   SUPPLY_QTY    : 供給価格 × 個数 (プロダクトイン: 海外等から作品を仕入れる際の計算。料率なし)
export type CalcType = "BASE_QTY_RATE" | "BASE_RATE" | "FIXED" | "SUBSCRIPTION" | "SUPPLY_QTY";

// 取引区分。ライセンスイン(原作の利用許諾を受ける)/ プロダクトイン(完成品=作品を
//   海外等から仕入れる)。プロダクトインは目的=当社が他社に販売、計算は供給価格×個数(新)＋従来型。
export type TransactionKind = "license" | "product";

export type FinancialCondition = {
  id?: number; // DB の license_financial_conditions.id (新規は未設定)
  condition_no: number; // 1=自社製造, 2=サブライセンス, 3=プロダクトアウト, ...
  // 取引区分。'license'(=ライセンスイン, 省略時) / 'product'(=プロダクトイン)。
  //   condition_lines.transaction_kind に反映。
  transaction_kind?: TransactionKind;
  // 任意の条件名称 (PDF 見出しに反映)。空なら condition_no ベースの既定文。
  condition_name?: string;
  // テリトリー(地域)と言語を別項目で保持。
  region_territory?: string; // 例: 国内 / 北米 / 全世界
  region_language?: string; // 例: 日本語 / 英語 / 全言語
  // 後方互換・表示用の合成ラベル。region_territory・region_language から自動生成。
  //   旧データ(2項目が無い行)はこのラベルを '・' で分割してフォールバックする。
  region_language_label?: string; // 例: 国内・日本語
  // 構造化した計算式タイプ。calc_method は互換のため calc_type から自動導出。
  calc_type?: CalcType;
  calc_method?: string; // ROYALTY / FIXED / SUBSCRIPTION (calc_type から自動設定)
  // FIXED 用: LUMP(一括) / INSTALLMENT(分割)
  fixed_kind?: "LUMP" | "INSTALLMENT";
  // SUBSCRIPTION 用: MONTHLY(月払い) / ANNUAL(年払い)
  subscription_cycle?: "MONTHLY" | "ANNUAL";
  // 固定額 / サブスク単価
  unit_amount?: number;
  // 保証種別 (BASE_QTY_RATE / BASE_RATE に適用・排他): NONE / MG / AG
  guarantee_type?: "NONE" | "MG" | "AG";
  rate_pct?: number; // 例: 5.0 (%)
  base_price_label?: string; // 例: 上代 (MSRP)
  calc_period?: string; // 表示用 free-text label (自動生成 / 手動上書き可)
  // Phase 22.20-B: 計算期間を構造化
  calc_period_kind?: "MANUFACTURING" | "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL";
  calc_period_close_month?: number; // 1-12 (MANUFACTURING / MONTHLY は未設定)
  currency?: string; // JPY / USD ...
  formula_text?: string; // 例: 上代 × 5.0% × 製造数
  // 適用範囲(対象成果物)。この条件がどの成果物・明細を対象に許諾するかを明示。
  //   発注書の共通利用許諾条件では、受注者帰属の明細名から自動補完される。
  applies_scope?: string;
  payment_terms?: string;
  mg_amount?: number; // MG 総額 (最低保証 floor)
  ag_amount?: number; // AG 総額 (前払い保証 = 累積消化)
  // Phase 22.21.11: 概要 (フリーテキスト)。空のときは
  //   condition_no ベースのデフォルト文が PDF 側で表示される。
  summary?: string;
  // Phase 22.21.91: 由来マーカー。
  //   - 'license' (省略時)   : license_financial_conditions.id を id に保持
  //   - 'capability'         : capability_financial_conditions.id を id に保持
  //   royalty_statement form の radio handler はこれを見て
  //   license_financial_condition_id か capability_financial_condition_id か
  //   どちらに id をセットするか分岐する。
  source?: "license" | "capability";
  // WMC O4(コピー痕跡): この条件を「原作素材の既存条件からコピー」して作った場合、
  //   コピー元 capability_financial_conditions.id を保持する。保存時 cfc の
  //   copied_from_condition_id に永続化される。NULL/未設定 = 通常入力。
  copied_from_condition_id?: number;
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

// 計算式タイプの選択肢。ライセンスインは従来の4種、プロダクトインは供給価格×個数(新)＋従来型。
const CALC_TYPE_OPTION_MAP: Record<CalcType, string> = {
  BASE_QTY_RATE: "① 基準価格 × 個数 × 料率",
  BASE_RATE: "② 基準価格 × 料率",
  FIXED: "③ 固定値 (一括/分割)",
  SUBSCRIPTION: "④ サブスクリプション (月/年)",
  SUPPLY_QTY: "⑤ 供給価格 × 個数 (プロダクトイン)",
};
export const CALC_TYPE_OPTIONS: Array<{ value: CalcType; label: string }> = [
  { value: "BASE_QTY_RATE", label: CALC_TYPE_OPTION_MAP.BASE_QTY_RATE },
  { value: "BASE_RATE", label: CALC_TYPE_OPTION_MAP.BASE_RATE },
  { value: "FIXED", label: CALC_TYPE_OPTION_MAP.FIXED },
  { value: "SUBSCRIPTION", label: CALC_TYPE_OPTION_MAP.SUBSCRIPTION },
];
// 取引区分に応じた calc_type 選択肢。プロダクトインは SUPPLY_QTY を先頭に + 従来型も可。
export function calcTypeOptionsFor(kind?: TransactionKind): Array<{ value: CalcType; label: string }> {
  if (kind === "product") {
    return [
      { value: "SUPPLY_QTY", label: CALC_TYPE_OPTION_MAP.SUPPLY_QTY },
      { value: "BASE_QTY_RATE", label: CALC_TYPE_OPTION_MAP.BASE_QTY_RATE },
      { value: "BASE_RATE", label: CALC_TYPE_OPTION_MAP.BASE_RATE },
      { value: "FIXED", label: CALC_TYPE_OPTION_MAP.FIXED },
      { value: "SUBSCRIPTION", label: CALC_TYPE_OPTION_MAP.SUBSCRIPTION },
    ];
  }
  return CALC_TYPE_OPTIONS;
}

// calc_type → calc_method (後方互換: ROYALTY / FIXED / SUBSCRIPTION)。
//   SUPPLY_QTY(供給価格×個数)は数量駆動・供給時計算なので ROYALTY 扱い(payment_scheme=royalty)。
export function calcMethodFromType(t?: CalcType): string {
  if (t === "FIXED") return "FIXED";
  if (t === "SUBSCRIPTION") return "SUBSCRIPTION";
  if (t === "BASE_QTY_RATE" || t === "BASE_RATE" || t === "SUPPLY_QTY") return "ROYALTY";
  return "";
}

// 構造化フィールドから計算式テキストを自動生成 (ユーザーが手動編集していなければ上書き)。
export function buildFormulaText(c: Partial<FinancialCondition>): string {
  const base = c.base_price_label || "基準価格";
  const rate =
    c.rate_pct != null && !Number.isNaN(Number(c.rate_pct))
      ? `${c.rate_pct}%`
      : "料率";
  const amt =
    c.unit_amount != null && !Number.isNaN(Number(c.unit_amount))
      ? `¥${(Number(c.unit_amount) || 0).toLocaleString("ja-JP")}`
      : "固定額";
  switch (c.calc_type) {
    case "SUPPLY_QTY":
      // プロダクトイン: 供給価格 × 個数 (料率なし)。
      return `${c.base_price_label || "供給価格"} × 個数`;
    case "BASE_QTY_RATE":
      return `${base} × 個数 × ${rate}`;
    case "BASE_RATE":
      return `${base} × ${rate}`;
    case "FIXED":
      return `${amt}（${c.fixed_kind === "INSTALLMENT" ? "分割" : "一括"}）`;
    case "SUBSCRIPTION":
      return `${amt} / ${c.subscription_cycle === "ANNUAL" ? "年" : "月"}`;
    default:
      return c.formula_text || "";
  }
}

// テリトリー + 言語 → 合成ラベル ("国内・日本語")。空項目は除外。
export function composeRegionLabel(territory?: string, language?: string): string {
  return [territory, language]
    .map((s) => (s == null ? "" : String(s).trim()))
    .filter(Boolean)
    .join("・");
}

// 合成ラベル "国内・日本語" を テリトリー / 言語 に分割するフォールバック。
//   最初の '・' で分割し、前半=テリトリー、後半=言語とする。
//   '・' が無い場合は全体をテリトリー扱い。
export function splitRegionLabel(label?: string): {
  territory: string;
  language: string;
} {
  const s = (label || "").trim();
  if (!s) return { territory: "", language: "" };
  const idx = s.indexOf("・");
  if (idx < 0) return { territory: s, language: "" };
  return {
    territory: s.slice(0, idx).trim(),
    language: s.slice(idx + 1).trim(),
  };
}

// 構造化2項目が無い行は合成ラベルから補完して読み出す。
export function readRegionParts(c: {
  region_territory?: string;
  region_language?: string;
  region_language_label?: string;
}): { territory: string; language: string } {
  const t = (c.region_territory || "").trim();
  const l = (c.region_language || "").trim();
  if (t || l) return { territory: t, language: l };
  return splitRegionLabel(c.region_language_label);
}

const isBaseRate = (t?: CalcType) =>
  t === "BASE_QTY_RATE" || t === "BASE_RATE";

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
  /**
   * Part1(共通化): 出版(PUB)/ボードゲーム(BDG) で「保管は同じ汎用列のまま、
   * ラベル・既定値・条件プリセットだけ」切替える。未指定は BDG 相当(従来挙動)。
   */
  division?: "PUB" | "BDG";
}

// division 駆動プリセット。保存先カラムは共通(rate_pct / base_price_label /
//   calc_period_kind / formula_text …)。ここは表示ラベルと既定値だけを切替える。
type DivPreset = {
  conditions: { no: number; label: string }[];
  rateLabel: string;
  basePricePlaceholder: string;
  basePriceDefault: string;
  formulaPlaceholder: string;
  formulaDefault: string;
  periodKindDefault: NonNullable<FinancialCondition["calc_period_kind"]>;
};
const DIVISION_PRESETS: Record<"PUB" | "BDG", DivPreset> = {
  BDG: {
    conditions: [
      { no: 1, label: "自社製造" },
      { no: 2, label: "サブライセンス" },
      { no: 3, label: "プロダクトアウト" },
    ],
    rateLabel: "料率 (%)",
    basePricePlaceholder: "上代 (MSRP)",
    basePriceDefault: "上代 (MSRP)",
    formulaPlaceholder: "例: 上代 × 5.0% × 製造数",
    formulaDefault: "上代 × 料率 × 製造数",
    periodKindDefault: "MANUFACTURING",
  },
  PUB: {
    conditions: [
      { no: 1, label: "紙書籍" },
      { no: 2, label: "電子書籍" },
      { no: 3, label: "翻訳・海外版" },
    ],
    rateLabel: "印税率 (%)",
    basePricePlaceholder: "税抜定価",
    basePriceDefault: "税抜定価",
    formulaPlaceholder: "例: 税抜定価 × 印税対象部数(実売/刷) × 印税率",
    formulaDefault: "税抜定価 × 印税対象部数 × 印税率",
    periodKindDefault: "QUARTERLY",
  },
};

const yen = (n: number) =>
  "¥ " + (Number(n) || 0).toLocaleString("ja-JP");

export const FinancialConditionTable: React.FC<Props> = ({
  conditions,
  onChange,
  readOnly = false,
  division,
}) => {
  const preset = DIVISION_PRESETS[division || "BDG"];
  const update = (idx: number, patch: Partial<FinancialCondition>) => {
    const next = conditions.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  // テリトリー / 言語 のいずれかを更新し、合成ラベル(region_language_label)も
  //   自動再計算する。古い行で構造化2項目が未設定なら label から補完して合成。
  const updateRegion = (idx: number, patch: { region_territory?: string; region_language?: string }) => {
    const cur = readRegionParts(conditions[idx]);
    const territory = patch.region_territory ?? cur.territory;
    const language = patch.region_language ?? cur.language;
    update(idx, {
      region_territory: territory,
      region_language: language,
      region_language_label: composeRegionLabel(territory, language),
    });
  };

  // 構造化フィールド変更時: calc_method(互換) と計算式テキストを自動再計算して反映。
  const recalc = (idx: number, patch: Partial<FinancialCondition>) => {
    const merged = { ...conditions[idx], ...patch };
    update(idx, {
      ...patch,
      calc_method: calcMethodFromType(merged.calc_type),
      formula_text: buildFormulaText(merged),
    });
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
        calc_type: "BASE_QTY_RATE",
        calc_method: "ROYALTY",
        guarantee_type: "NONE",
        rate_pct: 0,
        mg_amount: 0,
        ag_amount: 0,
        // 出力ニュートラル維持のため、基準価格/計算式/計算期間は事前入力しない。
        //   (division プリセットは下のプレースホルダで案内のみ。保存値は空のまま=従来どおり)
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
    preset.conditions.find((p) => p.no === no)?.label || `条件 ${no}`;

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
                  {/* 取引区分: ライセンスイン / プロダクトイン。プロダクトインは供給価格×個数を既定に。 */}
                  <select
                    value={c.transaction_kind || "license"}
                    onChange={(e) => {
                      const tk = e.target.value as TransactionKind;
                      if (tk === "product") {
                        recalc(idx, {
                          transaction_kind: tk,
                          calc_type: "SUPPLY_QTY",
                          base_price_label: c.base_price_label || "供給価格",
                        });
                      } else {
                        // ライセンスインに戻す: SUPPLY_QTY はライセンスインの選択肢に
                        //   無いため、残っていれば従来既定(BASE_QTY_RATE)へ戻す。
                        recalc(idx, {
                          transaction_kind: tk,
                          ...(c.calc_type === "SUPPLY_QTY"
                            ? { calc_type: "BASE_QTY_RATE" as CalcType }
                            : {}),
                        });
                      }
                    }}
                    disabled={readOnly}
                    title="取引区分。プロダクトイン=完成品(作品)を仕入れる(供給価格×個数)。"
                    className={cn(
                      "text-[10px] font-mono rounded-sm border px-1.5 py-0.5 bg-transparent focus:outline-none",
                      c.transaction_kind === "product"
                        ? "border-amber-300 text-amber-800"
                        : "border-indigo-300 text-indigo-800"
                    )}
                  >
                    <option value="license">ライセンスイン</option>
                    <option value="product">プロダクトイン</option>
                  </select>
                  {/* O4: 原作素材の既存条件からコピーした行であることの痕跡バッジ。 */}
                  {c.copied_from_condition_id != null && (
                    <span
                      className="text-[8px] font-mono font-bold px-1 py-0.5 rounded-sm bg-sky-100 text-sky-700 border border-sky-300 whitespace-nowrap"
                      title={`原作素材の既存条件(#${c.copied_from_condition_id})から引用コピー`}
                    >
                      引用
                    </span>
                  )}
                  <input
                    type="text"
                    value={c.condition_name || ""}
                    onChange={(e) =>
                      update(idx, { condition_name: e.target.value })
                    }
                    placeholder={`条件名称 (任意・例: ${presetLabel(condNo)})`}
                    disabled={readOnly}
                    title="任意の条件名称。空欄なら標準の見出しを表示。"
                    className="flex-1 min-w-[140px] text-[11px] font-mono font-semibold bg-transparent border-b border-input py-0.5 px-1 focus:outline-none focus:border-foreground placeholder:text-muted-foreground/40 placeholder:text-[10px]"
                  />
                  <input
                    type="text"
                    value={readRegionParts(c).territory}
                    onChange={(e) =>
                      updateRegion(idx, { region_territory: e.target.value })
                    }
                    placeholder="テリトリー (例: 国内)"
                    title="許諾テリトリー(地域)。例: 国内 / 北米 / 全世界"
                    disabled={readOnly}
                    className="flex-1 min-w-[90px] text-[11px] font-mono bg-transparent border-b border-input py-0.5 px-1 focus:outline-none focus:border-foreground placeholder:text-muted-foreground/40 placeholder:text-[10px]"
                  />
                  <input
                    type="text"
                    value={readRegionParts(c).language}
                    onChange={(e) =>
                      updateRegion(idx, { region_language: e.target.value })
                    }
                    placeholder="言語 (例: 日本語)"
                    title="許諾言語。例: 日本語 / 英語 / 全言語"
                    disabled={readOnly}
                    className="flex-1 min-w-[90px] text-[11px] font-mono bg-transparent border-b border-input py-0.5 px-1 focus:outline-none focus:border-foreground placeholder:text-muted-foreground/40 placeholder:text-[10px]"
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
                <div className="col-span-2">
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                    計算式タイプ
                  </div>
                  <select
                    value={c.calc_type || ""}
                    onChange={(e) =>
                      recalc(idx, {
                        calc_type: (e.target.value || undefined) as
                          | CalcType
                          | undefined,
                      })
                    }
                    disabled={readOnly}
                    className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 px-1 focus:outline-none focus:border-foreground"
                  >
                    <option value="">— 選択 —</option>
                    {calcTypeOptionsFor(c.transaction_kind).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* ⑤ プロダクトイン: 供給価格 × 個数 (料率なし)。供給価格ラベルのみ */}
                {c.calc_type === "SUPPLY_QTY" && (
                  <div>
                    <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                      供給価格
                    </div>
                    {cellInput(
                      c.base_price_label,
                      (v) => recalc(idx, { base_price_label: v }),
                      "text",
                      "供給価格 (仕入単価)"
                    )}
                  </div>
                )}

                {/* ① ② 基準価格×(個数×)料率 系: 料率 + 基準価格 */}
                {isBaseRate(c.calc_type) && (
                  <>
                    <div>
                      <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                        {preset.rateLabel}
                      </div>
                      {cellInput(
                        c.rate_pct,
                        (v) => recalc(idx, { rate_pct: Number(v) || 0 }),
                        "number",
                        "5.0",
                        "0.0001"
                      )}
                    </div>
                    <div>
                      <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                        基準価格
                      </div>
                      {cellInput(
                        c.base_price_label,
                        (v) => recalc(idx, { base_price_label: v }),
                        "text",
                        preset.basePricePlaceholder
                      )}
                    </div>
                  </>
                )}

                {/* ③ 固定値: 一括/分割 + 固定額 */}
                {c.calc_type === "FIXED" && (
                  <>
                    <div>
                      <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                        支払区分
                      </div>
                      <select
                        value={c.fixed_kind || "LUMP"}
                        onChange={(e) =>
                          recalc(idx, {
                            fixed_kind: e.target.value as "LUMP" | "INSTALLMENT",
                          })
                        }
                        disabled={readOnly}
                        className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 px-1 focus:outline-none focus:border-foreground"
                      >
                        <option value="LUMP">一括</option>
                        <option value="INSTALLMENT">分割</option>
                      </select>
                    </div>
                    <div>
                      <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                        固定額
                      </div>
                      {cellInput(
                        c.unit_amount,
                        (v) => recalc(idx, { unit_amount: Number(v) || 0 }),
                        "number",
                        "0",
                        "1"
                      )}
                    </div>
                  </>
                )}

                {/* ④ サブスク: 月払い/年払い + 単価 */}
                {c.calc_type === "SUBSCRIPTION" && (
                  <>
                    <div>
                      <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                        課金サイクル
                      </div>
                      <select
                        value={c.subscription_cycle || "MONTHLY"}
                        onChange={(e) =>
                          recalc(idx, {
                            subscription_cycle: e.target.value as
                              | "MONTHLY"
                              | "ANNUAL",
                          })
                        }
                        disabled={readOnly}
                        className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 px-1 focus:outline-none focus:border-foreground"
                      >
                        <option value="MONTHLY">月払い</option>
                        <option value="ANNUAL">年払い</option>
                      </select>
                    </div>
                    <div>
                      <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                        単価 ({c.subscription_cycle === "ANNUAL" ? "年額" : "月額"})
                      </div>
                      {cellInput(
                        c.unit_amount,
                        (v) => recalc(idx, { unit_amount: Number(v) || 0 }),
                        "number",
                        "0",
                        "1"
                      )}
                    </div>
                  </>
                )}
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
                    <div className="text-[11px] font-mono text-muted-foreground/70 mt-0.5">
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
                    placeholder={preset.formulaPlaceholder}
                    disabled={readOnly}
                    rows={1}
                    className={cn(
                      "w-full text-[11px] font-mono bg-card border border-input rounded-sm px-2 py-1 resize-y",
                      "focus:outline-none focus:border-foreground",
                      "placeholder:text-muted-foreground/40 placeholder:text-[10px]"
                    )}
                  />
                </div>
                <div className="col-span-2 md:col-span-4">
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                    適用範囲（対象成果物）
                  </div>
                  <textarea
                    value={c.applies_scope || ""}
                    onChange={(e) => update(idx, { applies_scope: e.target.value })}
                    placeholder="例: 本発注の受注者帰属成果物（翻訳執筆 等）／本制作物一式の出版・販売"
                    disabled={readOnly}
                    rows={1}
                    className={cn(
                      "w-full text-[11px] font-mono bg-card border border-input rounded-sm px-2 py-1 resize-y",
                      "focus:outline-none focus:border-foreground",
                      "placeholder:text-muted-foreground/40 placeholder:text-[10px]"
                    )}
                  />
                </div>
                {/* MG/AG 保証 (①②型のみ・排他)。
                    MG=最低保証 floor(mg_amount), AG=前払い保証 累積消化(ag_amount)。 */}
                {isBaseRate(c.calc_type) ? (
                  <>
                    <div>
                      <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                        保証 (MG/AG)
                      </div>
                      <select
                        value={c.guarantee_type || "NONE"}
                        onChange={(e) => {
                          const g = e.target.value as "NONE" | "MG" | "AG";
                          if (g === "NONE")
                            update(idx, {
                              guarantee_type: "NONE",
                              mg_amount: 0,
                              ag_amount: 0,
                            });
                          else if (g === "MG")
                            update(idx, { guarantee_type: "MG", ag_amount: 0 });
                          else
                            update(idx, { guarantee_type: "AG", mg_amount: 0 });
                        }}
                        disabled={readOnly}
                        className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 px-1 focus:outline-none focus:border-foreground"
                      >
                        <option value="NONE">なし</option>
                        <option value="MG">MG (最低保証)</option>
                        <option value="AG">AG (前払い保証)</option>
                      </select>
                    </div>
                    <div>
                      <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                        {c.guarantee_type === "AG" ? "AG 額" : "MG 額"}
                      </div>
                      {c.guarantee_type === "MG" || c.guarantee_type === "AG" ? (
                        <>
                          {cellInput(
                            c.guarantee_type === "AG" ? c.ag_amount : c.mg_amount,
                            (v) =>
                              update(
                                idx,
                                c.guarantee_type === "AG"
                                  ? { ag_amount: Number(v) || 0 }
                                  : { mg_amount: Number(v) || 0 }
                              ),
                            "number",
                            "0",
                            "1"
                          )}
                          {(() => {
                            const amt =
                              c.guarantee_type === "AG" ? c.ag_amount : c.mg_amount;
                            return amt && amt > 0 ? (
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                {yen(amt)}
                              </div>
                            ) : null;
                          })()}
                        </>
                      ) : (
                        <div className="text-[10px] font-mono text-muted-foreground/60 py-1 px-1 border-b border-dashed border-input/50">
                          (保証なし)
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
                {/* Phase 22.21.11: 概要 (フリーテキスト)。
                    空のときは PDF テンプレ側で condition_no ベースの
                    デフォルト文が自動表示される。 */}
                <div className="col-span-2 md:col-span-4">
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">
                    概要 (任意 — 空欄なら標準文を自動表示)
                  </div>
                  <textarea
                    value={c.summary || ""}
                    onChange={(e) => update(idx, { summary: e.target.value })}
                    placeholder={
                      division === "PUB"
                        ? `この金銭条件(${presetLabel(condNo)})の概要を入力 (PDF Section 3 に表示)`
                        : condNo === 1
                        ? "標準文: Licensee 自らが販売する国内販売において、基準価格に料率と販売数を乗じた金額をロイヤリティとして支払います。"
                        : condNo === 2
                        ? "標準文: 国内・海外パートナーにサブライセンスし、Licensee が受領したサブライセンス料を料率に応じて分配します。"
                        : condNo === 3
                        ? "標準文: 海外パートナーからの委託により Licensee がローカライズ版を製造・出荷し、海外パートナーが現地で販売元となる形式。海外パートナーから Licensee が受領する製造代金および利用許諾料を含む取引額に対して料率を乗じた金額を、Licensor へロイヤリティとして支払います。"
                        : "この金銭条件の概要を入力 (PDF Section 3 に表示)"
                    }
                    disabled={readOnly}
                    rows={2}
                    className={cn(
                      "w-full text-[11px] font-mono bg-card border border-input rounded-sm px-2 py-1 resize-y",
                      "focus:outline-none focus:border-foreground",
                      "placeholder:text-muted-foreground/40 placeholder:text-[10px] placeholder:italic"
                    )}
                  />
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
          <div className="text-[10px] font-mono text-muted-foreground italic flex items-center gap-2">
            <span className="not-italic px-1.5 py-0.5 rounded-sm bg-muted text-foreground/70">
              {division === "PUB" ? "出版(PUB)プリセット" : "ボードゲーム(BDG)プリセット"}
            </span>
            利用許諾料計算書はこのテーブルの条件 1 行を指して計算します。
          </div>
        </div>
      )}
    </div>
  );
};
