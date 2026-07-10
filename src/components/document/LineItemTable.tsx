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
import { Plus, Trash2, Maximize2, X, Repeat, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/EmptyState";
import { type CalcType } from "@/src/components/document/FinancialConditionTable";

export type LineItem = {
  line_no?: number;
  item_name: string;
  spec?: string;
  unit_price: number;
  quantity: number;
  // amount_ex_tax is derived in render — kept in state for round-trips
  amount_ex_tax?: number;
  // 明細ごとの成果物作品(作品1:文書N:明細N)。NULL/未設定は文書単位の作品にフォールバック。
  //   受注者帰属(利用許諾)の場合、対応する利用許諾条件へ work_id が自動継承される(D2)。
  work_id?: number;
  /**
   * 成果物の帰属先(当事者は発注書表現)。
   *   '発注者' = 当社がIP取得(work-for-hire/著作権譲渡) → 業務委託明細(確定額)。
   *   '受注者' = 相手がIP保有 → 利用許諾(利用許諾料) → 金銭条件構造で持ち、
   *             確定額には含めず、worker 保存時に capability_financial_conditions へ振り分け。
   *   未設定は '発注者' 扱い(従来挙動)。
   */
  deliverable_ownership?: "発注者" | "受注者";
  /**
   * Phase 13: 計算方式 (FIXED / SUBSCRIPTION / ROYALTY)。
   * license_financial_conditions と同じ語彙。default は 'FIXED'。
   */
  calc_method?: "FIXED" | "SUBSCRIPTION" | "ROYALTY" | string;
  /**
   * ROYALTY 用: 料率(%)。calc_method='ROYALTY' のとき
   *   小計 = ⌈ 単価(基準価格) × 数量 × 料率% ⌉ で計算する。
   *   FIXED/SUBSCRIPTION では未使用。
   */
  rate_pct?: number;
  /**
   * 計算式方法。利用許諾計算書(royalty_statement)の calcType と同一語彙にして、
   *   発注書PDF・条件明細・計算書で計算式表記を一致させる。
   *   manufacturing=個数×基準価格×料率 / sales=売上高×料率 /
   *   sublicense=受領額×料率 / fixed=固定額。calc_method='ROYALTY' のとき意味を持つ。
   */
  royalty_calc_basis?: "manufacturing" | "sales" | "sublicense" | "fixed" | string;
  /**
   * ROYALTY 明細に付く固定報酬(確定額)の名称。既定は「執筆料」。
   *   案件により「制作報酬」「監修報酬」等まちまちなので自由入力にする。
   *   金額>0 のとき確定額セルに「{reward_label}（利用許諾料/インセンティブ報酬は別途）」と表示。
   *   未設定/空はテンプレ・フォーム側で「執筆料」にフォールバック。
   *   ※ 表示専用ラベル。formData 経由で PDF へ渡す(rate_pct 同様、ビュー
   *     capability_line_items＝condition_lines には永続化しない)。
   */
  reward_label?: string;
  // ── 受注者帰属(利用許諾料)の行が持つ金銭条件フィールド ──────────
  //   deliverable_ownership='受注者' のときに使う。FinancialCondition と同じ語彙。
  calc_type?: CalcType;
  base_price_label?: string;
  fixed_kind?: "LUMP" | "INSTALLMENT";
  subscription_cycle?: "MONTHLY" | "ANNUAL";
  unit_amount?: number;
  guarantee_type?: "NONE" | "MG" | "AG";
  mg_amount?: number;
  ag_amount?: number;
  condition_name?: string;
  // テリトリー(地域) / 言語 を別項目で保持。region_language_label は合成表示用。
  region_territory?: string;
  region_language?: string;
  region_language_label?: string;
  formula_text?: string;
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
  // ────────────────────────────────────────────────
  // Phase 22.8: SUBSCRIPTION (サブスク継続課金) 専用フィールド。
  // calc_method = "SUBSCRIPTION" のときだけ意味を持つ。顧問契約・
  // SaaS 月額・年額ライセンス等を「単価 × 数量 (期間数) = 期間総額」
  // で表しつつ、契約スケジュールも構造化して保持できるようにする。
  // ────────────────────────────────────────────────
  /** 周期: 月次/四半期/半年/年次/カスタム。default は MONTHLY。 */
  cycle?: "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL" | "CUSTOM";
  /** カスタム周期の間隔単位 (cycle=CUSTOM のとき)。MONTH=Nヶ月ごと / DAY=N日ごと。 */
  interval_unit?: "MONTH" | "DAY";
  /** カスタム周期の間隔数 N (cycle=CUSTOM のとき。例: 2ヶ月ごと→2)。 */
  interval_count?: number;
  /** 契約開始日 (YYYY-MM-DD)。 */
  term_start?: string;
  /** 契約終了日 (YYYY-MM-DD)。空なら「継続中」扱いで PDF にもそう表記。 */
  term_end?: string;
  /** 毎周期の支払日 (例: 月次なら 1-31 の日。月末なら 31 or 0)。 */
  billing_day?: number;
  /**
   * 支払月。周期末で締めた各期の支払をどの月に行うか (当月/翌月/翌々月)。
   * 例: MONTHLY + NEXT_MONTH + billing_day=0 → 「翌月末日払い」(月末締め翌月末払い)。
   * 未設定は従来表示 (毎月末日 等) にフォールバックし、支払予定日生成は当月扱い。
   */
  billing_timing?: "SAME_MONTH" | "NEXT_MONTH" | "MONTH_AFTER_NEXT";
  /**
   * 個別の支払予定日リスト。自動生成(周期から展開)または手入力で列挙する。
   * これがあると PDF・条件明細に各回の支払予定日として展開される。
   */
  payment_schedule?: Array<{ date: string; amount?: number }>;
};

const CALC_METHOD_OPTIONS: Array<{
  value: "FIXED" | "SUBSCRIPTION" | "ROYALTY";
  label: string;
}> = [
  { value: "FIXED", label: "FIXED (固定額)" },
  { value: "SUBSCRIPTION", label: "SUBSCRIPTION (サブスク)" },
  { value: "ROYALTY", label: "ROYALTY (業績連動)" },
];

const CALC_BASIS_OPTIONS: Array<{ value: string; label: string; formula: string }> = [
  { value: "manufacturing", label: "製造", formula: "個数 × 基準価格 × 料率" },
  { value: "sales", label: "売上", formula: "売上高 × 料率" },
  { value: "sublicense", label: "サブライセンス", formula: "受領額 × 料率" },
  { value: "fixed", label: "固定額", formula: "固定額" },
];

// Phase 22.8: サブスク周期。
const CYCLE_OPTIONS: Array<{
  value: NonNullable<LineItem["cycle"]>;
  label: string;
  short: string;
}> = [
  { value: "MONTHLY", label: "月次", short: "月次" },
  { value: "QUARTERLY", label: "四半期", short: "四半期" },
  { value: "SEMIANNUAL", label: "半年", short: "半年" },
  { value: "ANNUAL", label: "年次", short: "年次" },
  { value: "CUSTOM", label: "カスタム (任意周期)", short: "カスタム" },
];

// ── サブスク支払スケジュール 自動生成ヘルパー ──────────────────
//   term_start を起点に、周期(月次/四半期/半年/年次/カスタムNヶ月・N日)ごとの
//   支払予定日を生成する。月ベースのときは billing_day(毎期X日/月末)を適用。
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isDayBasedCycle(it: Pick<LineItem, "cycle" | "interval_unit">): boolean {
  return it.cycle === "CUSTOM" && it.interval_unit === "DAY";
}
function stepDate(base: Date, it: Pick<LineItem, "cycle" | "interval_unit" | "interval_count">): Date {
  const r = new Date(base);
  if (it.cycle === "CUSTOM") {
    const n = Math.max(1, Number(it.interval_count) || 1);
    if (it.interval_unit === "DAY") r.setDate(r.getDate() + n);
    else r.setMonth(r.getMonth() + n);
  } else {
    const m =
      it.cycle === "QUARTERLY" ? 3 : it.cycle === "SEMIANNUAL" ? 6 : it.cycle === "ANNUAL" ? 12 : 1;
    r.setMonth(r.getMonth() + m);
  }
  return r;
}
function applyBillingDay(d: Date, billingDay?: number): Date {
  if (billingDay === undefined || billingDay === null) return d;
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const day = billingDay === 0 || billingDay > 30 ? lastDay : Math.min(billingDay, lastDay);
  return new Date(d.getFullYear(), d.getMonth(), day);
}
/** 周期から支払予定日を生成。term_end があればそこまで、無ければ periods 回分。 */
function generatePaymentSchedule(
  it: LineItem,
  periods: number
): Array<{ date: string; amount?: number }> {
  if (!it.term_start) return [];
  const start = new Date(`${it.term_start}T00:00:00`);
  if (isNaN(start.getTime())) return [];
  const end = it.term_end ? new Date(`${it.term_end}T00:00:00`) : null;
  const dayBased = isDayBasedCycle(it);
  const amount = Number(it.unit_price) || 0;
  const out: Array<{ date: string; amount?: number }> = [];
  let cursor = new Date(start);
  const hardCap = 600; // 暴走防止
  for (let i = 0; i < hardCap; i++) {
    // 打ち切りは役務提供期間 (cursor) ベース。支払日ベースにすると翌月払いの
    // 最終回 (支払だけが term_end より後ろに落ちる) が欠けてしまう。
    if (end && cursor.getTime() > end.getTime()) break;
    let payDate: Date;
    if (dayBased) {
      payDate = cursor;
    } else {
      // 支払月 (当月/翌月/翌々月) 分だけ月をずらしてから支払日を適用する。
      // 月初 1 日を基点にして setMonth の月跨ぎ (1/31 + 1ヶ月 → 3/3) を防ぐ。
      const offset = timingOffsetMonths(it.billing_timing);
      const base =
        offset > 0
          ? new Date(cursor.getFullYear(), cursor.getMonth() + offset, 1)
          : new Date(cursor);
      payDate = applyBillingDay(base, it.billing_day);
    }
    out.push({ date: toISODate(payDate), amount });
    if (!end && out.length >= Math.max(1, periods)) break;
    cursor = stepDate(cursor, it);
  }
  return out;
}

// Phase 22.21.44: 支払条件プルダウン候補。
//   業務委託の基本類型 (請負 / 準委任) を 2 択で選ばせる。
//   - 請負: 仕事の完成 (成果物の引渡し) が報酬支払の対価 — 民法 632条
//   - 準委任: 業務処理の遂行 (時間・労務) が報酬支払の対価 — 民法 656条
//   旧自由テキスト ("翌月末" 等) は受け入れない。空欄もしくはこの 2 値のみ。
const PAYMENT_TERMS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "— 未選択 —" },
  { value: "請負", label: "請負" },
  { value: "準委任", label: "準委任" },
];

// 周期に応じた支払日の接頭辞 ("毎月" / "毎四半期" / ...)。
function cyclePrefixLabel(cycle?: LineItem["cycle"]): string {
  return cycle === "QUARTERLY"
    ? "毎四半期"
    : cycle === "SEMIANNUAL"
      ? "毎半期"
      : cycle === "ANNUAL"
        ? "毎年"
        : cycle === "CUSTOM"
          ? "毎回"
          : "毎月";
}

// 支払月 (当月/翌月/翌々月) の表示語と、支払予定日生成用の月オフセット。
function timingWord(timing?: LineItem["billing_timing"]): string {
  return timing === "SAME_MONTH"
    ? "当月"
    : timing === "NEXT_MONTH"
      ? "翌月"
      : timing === "MONTH_AFTER_NEXT"
        ? "翌々月"
        : "";
}
function timingOffsetMonths(timing?: LineItem["billing_timing"]): number {
  return timing === "NEXT_MONTH" ? 1 : timing === "MONTH_AFTER_NEXT" ? 2 : 0;
}
const BILLING_TIMING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "— 払月 —" },
  { value: "SAME_MONTH", label: "当月" },
  { value: "NEXT_MONTH", label: "翌月" },
  { value: "MONTH_AFTER_NEXT", label: "翌々月" },
];

// サブスクの「支払日 表示」を組み立てる。
//   支払月あり — 月次: "翌月末日払い" / 他周期: "毎四半期・翌月末日払い"
//   支払月なし (従来) — 月次: "毎月25日" / 月末: "毎月末日" / "毎四半期15日"
function formatBillingDay(
  day?: number,
  cycle?: LineItem["cycle"],
  timing?: LineItem["billing_timing"]
): string {
  if (!day && day !== 0) return "";
  const dayLabel = day === 0 || day > 30 ? "末日" : `${day}日`;
  const tw = timingWord(timing);
  if (tw) {
    // 当月払い/翌月払いを明示して「月末払い」のあいまいさを解消する。
    const prefix = !cycle || cycle === "MONTHLY" ? "" : `${cyclePrefixLabel(cycle)}・`;
    return `${prefix}${tw}${dayLabel}払い`;
  }
  return `${cyclePrefixLabel(cycle)}${dayLabel}`;
}

// billing_day (undefined / 0=末日 / 1-30) ⇄ セレクト値 ("" / "EOM" / "1".."30")。
//   DB・PDF 側の既存規約 (0 または 31 以上 = 末日) はそのまま維持し、
//   入力 UI だけを「末日 / N日」の自然な選択肢に置き換える。
function billingDayToSelectValue(day?: number | null): string {
  if (day === undefined || day === null) return "";
  if (day === 0 || day > 30) return "EOM";
  return String(day);
}
function selectValueToBillingDay(v: string): number | undefined {
  if (v === "") return undefined;
  if (v === "EOM") return 0;
  return Number(v);
}
const BILLING_DAY_SELECT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "— 未設定 —" },
  { value: "EOM", label: "末日" },
  ...Array.from({ length: 30 }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1}日`,
  })),
];

// サブスクの「期間 表示」を組み立てる。
//   start のみ:           "2026/01/01 〜 継続中"
//   start + end:          "2026/01/01 〜 2026/12/31"
//   end のみ / 両方なし:  ""
function formatTermRange(start?: string, end?: string): string {
  if (!start && !end) return "";
  const startStr = start ? start : "";
  const endStr = end ? end : "継続中";
  return `${startStr || "—"} 〜 ${endStr}`;
}

// 明細ごとの作品割当(作品1:文書N:明細N)用の作品候補。
export type WorkOption = { id: number; work_code?: string; title?: string };

interface Props {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  /** When true, hide the [+ 行追加] / [削除] controls. */
  readOnly?: boolean;
  /** Override the column set if the document doesn't have payment columns. */
  showPaymentColumns?: boolean;
  /**
   * 明細ごとに割り当て可能な作品候補(既存作品のみ)。発注書が複数タイトル混在のとき、
   * 行ごとに成果物作品を選べる。未指定の行は文書単位の作品にフォールバックする。
   */
  works?: WorkOption[];
}

const ceilProduct = (a: number, b: number) =>
  Math.ceil((Number(a) || 0) * (Number(b) || 0));

// 確定額(税抜)の計算。仕様ロック(支払方法駆動):
//   - 確定額 = 単価 × 数量(=固定報酬/執筆料・固定額・サブスク額)。帰属に依らず同一。
//   - ROYALTY の料率(利用許諾料)は確定額に含めない(別途・利用許諾計算書で算定)。
//     ※ 旧: 発注者ROYALTY=単価×数量×料率 は廃止(②も「報酬は利用許諾料に含む」へ)。
const computeAmount = (
  it: Pick<LineItem, "unit_price" | "quantity">
): number => ceilProduct(Number(it.unit_price) || 0, Number(it.quantity) || 0);

// 確定額セルの表示(支払方法で分岐)。実装(フォーム/PDF)とロジックを一致させるため共通化。
//   - ROYALTY: 固定報酬>0 なら ¥金額(＋利用許諾料は別途) / 0 なら「報酬は利用許諾料に含む」
//   - FIXED:   ¥金額
//   - SUBSCRIPTION: 月額/年額(¥金額)＋固定額(>0のみ)。固定額は将来の専用フィールド前提で本数=単価×数量。
const formatAmountDisplay = (
  it: Pick<LineItem, "unit_price" | "quantity" | "calc_method" | "subscription_cycle">
): { primary: string; note?: string; muted?: boolean } => {
  const amt = computeAmount(it);
  if (it.calc_method === "ROYALTY") {
    return amt > 0
      ? { primary: yenLI(amt), note: "執筆料（利用許諾料は別途）" }
      : { primary: "報酬は利用許諾料に含む", muted: true };
  }
  if (it.calc_method === "SUBSCRIPTION") {
    const cyc = it.subscription_cycle === "ANNUAL" ? "年額" : "月額";
    return { primary: `${cyc} ${yenLI(amt)}` };
  }
  return { primary: yenLI(amt) };
};

const yenLI = (n: number) => "¥ " + (Number(n) || 0).toLocaleString("ja-JP");

export const LineItemTable: React.FC<Props> = ({
  items,
  onChange,
  readOnly = false,
  showPaymentColumns = true,
  works = [],
}) => {
  // Phase 22.7: 仕様詳細編集モーダル。長文の仕様を別ウィンドウで快適に編集するため。
  // インライン textarea は高さキャップ + 内部スクロール (= 行高は固定) に変更し、
  // フォーム全体の縦伸びを根本解決。詳しく書きたいときはこのモーダルを開く。
  const [specEditIdx, setSpecEditIdx] = React.useState<number | null>(null);
  const specEditValue =
    specEditIdx !== null ? items[specEditIdx]?.spec || "" : "";
  // Phase 22.8: サブスク詳細編集モーダル。calc_method=SUBSCRIPTION の
  // 行のみ「⚙ サブスク」ボタンで起動し、cycle / term_start / term_end /
  // billing_day をひとまとめに編集できる。
  const [subEditIdx, setSubEditIdx] = React.useState<number | null>(null);
  const subEditItem = subEditIdx !== null ? items[subEditIdx] : null;
  // 支払スケジュール自動生成の「回数」(終了日が無いときに使う)。
  const [subPeriods, setSubPeriods] = React.useState<number>(12);

  const update = (idx: number, patch: Partial<LineItem>) => {
    const next = items.slice();
    next[idx] = { ...next[idx], ...patch };
    // Auto-recompute subtotal when 単価/数量/料率/計算方式/帰属 のいずれかが変わったとき。
    if (
      patch.unit_price !== undefined ||
      patch.quantity !== undefined ||
      patch.rate_pct !== undefined ||
      patch.calc_method !== undefined ||
      patch.deliverable_ownership !== undefined
    ) {
      next[idx].amount_ex_tax = computeAmount(next[idx]);
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
        // 既定は成果物=発注者帰属(業務委託明細)。
        deliverable_ownership: "発注者",
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
    const amt = it.amount_ex_tax ?? computeAmount(it);
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
        "w-full text-xs font-mono bg-transparent",
        "border-b border-input py-1.5 px-1.5 focus:outline-none focus:border-foreground",
        "placeholder:text-muted-foreground/40 placeholder:text-[10px]",
        "disabled:opacity-60 disabled:cursor-not-allowed"
      )}
    />
  );

  /**
   * Phase 22.7: 仕様欄 (複数行) 入力セル。
   *
   * 旧 Phase 17j: 自動拡張 (rows=1 → scrollHeight に伸びる) にしていたが、
   * 長文が入ると行高が際限なく伸び、split-preview モードで他列が破綻していた。
   *
   * 新仕様:
   *   - 高さは max-h-[72px] (約 3 行) でキャップ + 内部スクロール
   *   - 詳細編集ボタン (右上 Maximize2 アイコン) で full モーダルを開く
   *   - 行高は固定なので他列 (単価/数量/日付等) と縦揃いが保たれる
   */
  const cellTextarea = (
    rowIdx: number,
    value: string | undefined,
    onChange: (v: string) => void,
    placeholder?: string
  ) => (
    <div className="relative group">
      <textarea
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={readOnly}
        rows={2}
        className={cn(
          "w-full text-[11px] font-mono bg-transparent resize-none",
          "border-b border-input py-1 pl-1 pr-6 focus:outline-none focus:border-foreground",
          "placeholder:text-muted-foreground/40 placeholder:text-[10px]",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          "whitespace-pre-wrap break-words leading-relaxed",
          // ★ 高さキャップ + 内部スクロール (行高固定)
          "max-h-[72px] overflow-y-auto"
        )}
      />
      {!readOnly && (
        <button
          type="button"
          onClick={() => setSpecEditIdx(rowIdx)}
          className={cn(
            "absolute top-0.5 right-0.5 p-0.5 rounded-sm",
            "text-muted-foreground/40 hover:text-foreground hover:bg-muted",
            "opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          )}
          title="仕様を別ウィンドウで詳細編集 (長文向け)"
        >
          <Maximize2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );

  // 受注者帰属(利用許諾料)の行の金銭条件入力。カード/テーブル両ビューで共通利用。
  const labelCls =
    "text-[10px] font-mono text-muted-foreground block mb-1";
  //   利用許諾条件そのもの (計算式・料率・テリトリー等) は明細では持たず、
  //   発注書フォームの「利用許諾条件（共通）」セクションで一括定義する。
  //   この明細は「受注者帰属＝共通利用許諾の対象」という選択を表すのみ。
  const renderLicenseFields = (it: LineItem, idx: number) => (
    <div className="rounded-sm border border-amber-300/60 bg-amber-50/30 p-2 space-y-1">
      <div className="text-[10px] font-mono font-bold text-amber-700">
        利用許諾の対象（受注者帰属）— 確定額には含めません
      </div>
      <div className="text-[10px] font-mono text-amber-700/80 leading-relaxed">
        この成果物は<strong>共通の利用許諾条件</strong>の対象です。料率・基準価格・
        テリトリー等の条件は、フォーム下部の<strong>「利用許諾条件（共通）」</strong>
        セクションで定義してください（適用範囲にこの明細が自動で列挙されます）。
      </div>
    </div>
  );

  // 受注者帰属の行の「業務報酬(執筆料等・確定額)」入力。単価×数量で確定額に計上。
  //   報酬が無く利用許諾料のみの場合は単価=0のままでよい。
  const renderServiceFeeFields = (it: LineItem, idx: number) => {
    const amount = it.amount_ex_tax ?? computeAmount(it);
    return (
      <div className="rounded-sm border border-input bg-muted/20 p-2 space-y-1">
        <div className="text-[10px] font-mono font-bold text-foreground/70">
          業務報酬（確定額・任意）
        </div>
        <div className="grid grid-cols-3 gap-3 items-end">
          <label className="block">
            <span className={labelCls}>単価</span>
            {cellInput(
              it.unit_price,
              (v) => update(idx, { unit_price: Number(v) || 0 }),
              "number",
              "0"
            )}
          </label>
          <label className="block">
            <span className={labelCls}>数量</span>
            {cellInput(
              it.quantity,
              (v) => update(idx, { quantity: Number(v) || 0 }),
              "number",
              "1"
            )}
          </label>
          <div>
            <span className={labelCls}>業務報酬 小計</span>
            <div className="text-right text-sm font-mono font-bold py-1">
              ¥ {Number(amount).toLocaleString("ja-JP")}
            </div>
          </div>
        </div>
        {/* 受注者帰属でも業務報酬(確定額)には納期・支払日が必要。
            発注者帰属の明細と同じく delivery_date / payment_date を入力できる。 */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelCls}>納期</span>
            {cellInput(
              it.delivery_date,
              (v) => update(idx, { delivery_date: v }),
              "date"
            )}
          </label>
          <label className="block">
            <span className={labelCls}>支払日</span>
            {cellInput(
              it.payment_date,
              (v) => update(idx, { payment_date: v }),
              "date"
            )}
          </label>
        </div>
        <div className="text-[9px] font-mono text-muted-foreground/70">
          報酬が無く利用許諾料のみの場合は単価=0のままにしてください。
        </div>
      </div>
    );
  };

  // ── サブスク行の 周期 / 支払日 インライン編集 (カード/テーブル共通) ──
  //   従来は ⚙ モーダルでしか編集できず、表上は read-only 表示だったため
  //   支払日が未設定のまま (= PDF に「支払日未設定」) になりやすかった。
  //   周期・支払日をその場で選べるようにして記載のあいまいさを解消する。
  const subCycleSelect = (it: LineItem, idx: number) =>
    readOnly ? (
      <span className="text-xs font-mono py-1 inline-block">
        {CYCLE_OPTIONS.find((o) => o.value === (it.cycle || "MONTHLY"))?.short ||
          "月次"}
      </span>
    ) : (
      <select
        value={it.cycle || "MONTHLY"}
        onChange={(e) =>
          update(idx, { cycle: e.target.value as LineItem["cycle"] })
        }
        title="サブスクの周期。カスタム (Nヶ月/N日ごと) の間隔は ⚙ から設定。"
        className={cn(
          "w-full text-xs font-mono bg-transparent",
          "border-b border-input py-1 px-1 focus:outline-none focus:border-foreground"
        )}
      >
        {CYCLE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );

  const subBillingDaySelect = (it: LineItem, idx: number) => {
    if (isDayBasedCycle(it)) {
      // N日ごとのカスタム周期は暦日ベースではないため支払日(毎期X日)は使わない。
      return (
        <span className="text-[10px] font-mono text-muted-foreground/70 py-1 inline-block">
          開始日からの経過日で計算
        </span>
      );
    }
    if (readOnly) {
      return (
        <span className="text-xs font-mono py-1 inline-block">
          {formatBillingDay(it.billing_day, it.cycle, it.billing_timing) || (
            <span className="text-muted-foreground/60 italic">未設定</span>
          )}
        </span>
      );
    }
    return (
      <div className="flex items-center gap-1">
        {it.cycle && it.cycle !== "MONTHLY" && (
          <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
            {cyclePrefixLabel(it.cycle)}
          </span>
        )}
        <select
          value={it.billing_timing || ""}
          onChange={(e) =>
            update(idx, {
              billing_timing: (e.target.value ||
                undefined) as LineItem["billing_timing"],
            })
          }
          title="支払月。締めた期の分を当月/翌月/翌々月のどの月に支払うか。"
          className={cn(
            "w-16 flex-shrink-0 text-xs font-mono bg-transparent",
            "border-b border-input py-1 px-0.5 focus:outline-none focus:border-foreground"
          )}
        >
          {BILLING_TIMING_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={billingDayToSelectValue(it.billing_day)}
          onChange={(e) =>
            update(idx, { billing_day: selectValueToBillingDay(e.target.value) })
          }
          title="毎周期の支払日。末日 (月末) または 1〜30日を選択。"
          className={cn(
            "flex-1 min-w-0 text-xs font-mono bg-transparent",
            "border-b border-input py-1 px-1 focus:outline-none focus:border-foreground"
          )}
        >
          {BILLING_DAY_SELECT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  };

  // 成果物帰属セレクト(発注者/受注者)。両ビュー共通。
  const ownershipSelect = (it: LineItem, idx: number) => (
    <div className="flex flex-col gap-0.5">
      <select
        value={it.deliverable_ownership || "発注者"}
        onChange={(e) =>
          update(idx, {
            deliverable_ownership: e.target.value as "発注者" | "受注者",
          })
        }
        disabled={readOnly}
        className={cn(
          "w-full text-[11px] font-mono rounded-sm border px-2 py-1.5 cursor-pointer",
          "focus:outline-none focus:ring-1 focus:ring-foreground/40 disabled:opacity-60",
          it.deliverable_ownership === "受注者"
            ? "border-amber-400 bg-amber-50 text-amber-800 font-semibold"
            : "border-input bg-muted/50 text-foreground"
        )}
        title="成果物のIP帰属を切り替えます。受注者帰属は利用許諾料(金銭条件)として扱い、確定額には含めません。"
      >
        <option value="発注者">発注者帰属（業務委託）</option>
        <option value="受注者">受注者帰属（利用許諾）</option>
      </select>
      <span className="text-[9px] font-mono text-muted-foreground/70">
        ▼ 帰属を切替
      </span>
    </div>
  );

  // 明細ごとの作品セレクト(作品1:文書N:明細N)。両ビュー共通。works が無ければ非表示。
  //   未選択(空)= 文書単位の作品にフォールバック。
  const workSelect = (it: LineItem, idx: number) => {
    if (!Array.isArray(works) || works.length === 0) return null;
    return (
      <select
        value={it.work_id != null ? String(it.work_id) : ""}
        onChange={(e) =>
          update(idx, {
            work_id: e.target.value ? Number(e.target.value) : undefined,
          })
        }
        disabled={readOnly}
        className={cn(
          "w-full text-[11px] font-mono rounded-sm border px-2 py-1.5 cursor-pointer",
          "focus:outline-none focus:ring-1 focus:ring-foreground/40 disabled:opacity-60",
          it.work_id != null
            ? "border-sky-400 bg-sky-50 text-sky-800"
            : "border-input bg-muted/50 text-muted-foreground"
        )}
        title="この明細の成果物作品。未選択なら文書の作品に従います。複数タイトル混在の発注書で行ごとに指定。"
      >
        <option value="">（文書の作品に従う）</option>
        {works.map((w) => (
          <option key={w.id} value={String(w.id)}>
            {w.work_code ? `[${w.work_code}] ` : ""}
            {w.title || `作品#${w.id}`}
          </option>
        ))}
      </select>
    );
  };

  // Phase 23.0.4: カード型レンダラ (lg 未満で使う)。
  //   <table> は狭幅で列が潰れて読めなくなるため、モバイル/タブレット用に
  //   1 行 = 1 カードで縦並び。spec のモーダル / サブスク詳細モーダルは共通利用。
  const renderCard = (it: LineItem, idx: number) => {
    const amount =
      it.amount_ex_tax ?? computeAmount(it);
    return (
      <div
        key={idx}
        className="rounded-md border border-border bg-card p-3 shadow-sm space-y-3"
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            行 {idx + 1}
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => removeRow(idx)}
              className="text-muted-foreground hover:text-destructive transition-colors p-1.5 rounded-sm"
              title="この行を削除"
              aria-label="この行を削除"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        <label className="block">
          <span className="text-[10px] font-mono text-muted-foreground block mb-1">
            品目名
          </span>
          {cellInput(
            it.item_name,
            (v) => update(idx, { item_name: v }),
            "text",
            "例: ノートPC"
          )}
        </label>
        <label className="block">
          <span className="text-[10px] font-mono text-muted-foreground block mb-1">
            仕様
          </span>
          {cellTextarea(
            idx,
            it.spec,
            (v) => update(idx, { spec: v }),
            "規格・モデル (3行まで表示)"
          )}
        </label>
        <label className="block">
          <span className="text-[10px] font-mono text-muted-foreground block mb-1">
            成果物帰属
          </span>
          {ownershipSelect(it, idx)}
        </label>
        {works.length > 0 && (
          <label className="block">
            <span className="text-[10px] font-mono text-muted-foreground block mb-1">
              作品（この明細）
            </span>
            {workSelect(it, idx)}
          </label>
        )}
        {/* 仕様ロック: 帰属で分岐しない。全行で 単価/数量/確定額/支払方法 を表示。 */}
        <>
        <div className="grid grid-cols-3 gap-3 items-end">
          <label className="block">
            <span className="text-[10px] font-mono text-muted-foreground block mb-1">
              単価
            </span>
            {cellInput(
              it.unit_price,
              (v) => update(idx, { unit_price: Number(v) || 0 }),
              "number",
              "0"
            )}
          </label>
          <label className="block">
            <span className="text-[10px] font-mono text-muted-foreground block mb-1">
              数量
            </span>
            {cellInput(
              it.quantity,
              (v) => update(idx, { quantity: Number(v) || 0 }),
              "number",
              "1"
            )}
          </label>
          <div>
            <span className="text-[10px] font-mono text-muted-foreground block mb-1">
              確定額 (税抜)
            </span>
            {(() => {
              const d = formatAmountDisplay(it);
              return (
                <div className={cn("text-right text-sm font-mono py-1", d.muted ? "text-amber-700 text-[11px] font-semibold" : "font-bold")}>
                  {d.primary}
                  {d.note && <div className="text-[10px] text-amber-700 font-normal">{d.note}</div>}
                </div>
              );
            })()}
          </div>
        </div>
        {showPaymentColumns && (
          <>
            <label className="block">
              <span className="text-[10px] font-mono text-muted-foreground block mb-1">
                計算方式
              </span>
              <div className="flex items-center gap-2">
                <select
                  value={it.calc_method || "FIXED"}
                  onChange={(e) =>
                    update(idx, {
                      calc_method: e.target.value as LineItem["calc_method"],
                      ...(e.target.value === "SUBSCRIPTION" && !it.cycle
                        ? { cycle: "MONTHLY" as const }
                        : {}),
                      // 支払日未設定のまま PDF に「支払日未設定」と出るのを防ぐため、
                      // SUBSCRIPTION 切替時は「翌月末日払い」(月末締め翌月末払い) を既定にする。
                      ...(e.target.value === "SUBSCRIPTION" &&
                      it.billing_day == null
                        ? { billing_day: 0 }
                        : {}),
                      ...(e.target.value === "SUBSCRIPTION" &&
                      !it.billing_timing
                        ? { billing_timing: "NEXT_MONTH" as const }
                        : {}),
                      // ROYALTY 切替時、計算式方法が未設定なら表示デフォルト(製造)を
                      // 明示的に永続化する。未設定のまま送信されると PDF が
                      // フォールバック表示になり、フォーム表示と食い違うため。
                      ...(e.target.value === "ROYALTY" && !it.royalty_calc_basis
                        ? { royalty_calc_basis: "manufacturing" as const }
                        : {}),
                    })
                  }
                  disabled={readOnly}
                  className={cn(
                    "flex-1 min-w-0 text-xs font-mono bg-transparent",
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
                {it.calc_method === "SUBSCRIPTION" && !readOnly && (
                  <button
                    type="button"
                    onClick={() => setSubEditIdx(idx)}
                    className="flex-shrink-0 p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted"
                    title="サブスク詳細を編集"
                    aria-label="サブスク詳細を編集"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                )}
              </div>
            </label>
            {it.calc_method === "ROYALTY" && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[10px] font-mono text-muted-foreground block mb-1">計算式方法</span>
                  <select
                    value={it.royalty_calc_basis || "manufacturing"}
                    onChange={(e) => update(idx, { royalty_calc_basis: e.target.value })}
                    disabled={readOnly}
                    className="w-full text-xs font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground disabled:opacity-60"
                  >
                    {CALC_BASIS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}（{o.formula}）</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] font-mono text-muted-foreground block mb-1">料率 (%)</span>
                  {cellInput(it.rate_pct, (v) => update(idx, { rate_pct: Number(v) || 0 }), "number", "例: 5.0")}
                  <span className="text-[10px] font-mono text-muted-foreground/70 block mt-1">利用許諾料は別途（利用許諾計算書による算定）</span>
                </label>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] font-mono text-muted-foreground block mb-1">
                  {it.calc_method === "SUBSCRIPTION" ? "周期" : "契約種別"}
                </span>
                {it.calc_method === "SUBSCRIPTION" ? (
                  <div className="flex items-center gap-1">
                    <Repeat className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    {subCycleSelect(it, idx)}
                  </div>
                ) : (
                  <select
                    value={(() => {
                      const cur =
                        it.payment_terms ?? it.payment_method ?? "";
                      return cur === "請負" || cur === "準委任" ? cur : "";
                    })()}
                    onChange={(e) =>
                      update(idx, {
                        payment_terms: e.target.value,
                        payment_method: e.target.value,
                      })
                    }
                    disabled={readOnly}
                    className={cn(
                      "w-full text-xs font-mono bg-transparent",
                      "border-b border-input py-1 px-1 focus:outline-none focus:border-foreground",
                      "disabled:opacity-60 disabled:cursor-not-allowed"
                    )}
                  >
                    {PAYMENT_TERMS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label className="block">
                <span className="text-[10px] font-mono text-muted-foreground block mb-1">
                  {it.calc_method === "SUBSCRIPTION" ? "支払日" : "納期"}
                </span>
                {it.calc_method === "SUBSCRIPTION" ? (
                  subBillingDaySelect(it, idx)
                ) : (
                  cellInput(
                    it.delivery_date,
                    (v) => update(idx, { delivery_date: v }),
                    "date"
                  )
                )}
              </label>
            </div>
            <label className="block">
              <span className="text-[10px] font-mono text-muted-foreground block mb-1">
                {it.calc_method === "SUBSCRIPTION" ? "契約期間" : "支払日"}
              </span>
              {it.calc_method === "SUBSCRIPTION" ? (
                <span className="text-xs font-mono py-1 block">
                  {formatTermRange(it.term_start, it.term_end) || (
                    <span className="text-muted-foreground/60 italic">
                      未設定
                    </span>
                  )}
                </span>
              ) : it.calc_method === "ROYALTY" && computeAmount(it) <= 0 ? (
                <span className="text-xs font-mono py-1 block text-amber-700">
                  利用許諾料計算書の通り
                </span>
              ) : (
                cellInput(
                  it.payment_date,
                  (v) => update(idx, { payment_date: v }),
                  "date"
                )
              )}
            </label>
          </>
        )}
        </>
      </div>
    );
  };

  return (
    <div className="col-span-full">
      {/* Phase 23.0.4: lg 未満はカード型、lg 以上は従来テーブル */}
      {items.length === 0 ? (
        <EmptyState
          title="明細はまだ追加されていません"
          description={
            readOnly ? undefined : "下の「行追加」から開始してください。"
          }
          compact
        />
      ) : (
        <>
          <div className="space-y-3 lg:hidden">
            {items.map((it, idx) => renderCard(it, idx))}
            <div className="rounded-md border border-foreground/30 bg-muted/40 px-3 py-2 flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                合計 (税抜)
              </span>
              <span className="text-sm font-mono font-bold">
                ¥ {grandTotal.toLocaleString("ja-JP")}
              </span>
            </div>
          </div>
          <div className="hidden lg:block overflow-x-auto">
            {/* min-w で各入力欄に十分な幅を確保。狭い画面では潰さずに横スクロール。 */}
            <table className="w-full min-w-[1240px] text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider">
              <th className="w-8 text-left p-2">#</th>
              <th className="text-left p-2 min-w-[200px]">品目名</th>
              <th className="text-left p-2 min-w-[220px]">仕様</th>
              <th className="text-left p-2 w-44 min-w-[150px]">成果物帰属</th>
              <th className="text-right p-2 w-28 min-w-[96px]">単価</th>
              <th className="text-right p-2 w-24 min-w-[80px]">数量</th>
              <th className="text-right p-2 w-28 min-w-[104px]">小計 (税抜)</th>
              {showPaymentColumns && (
                <>
                  <th className="text-left p-2 w-40 min-w-[160px]">計算方式</th>
                  {/* Phase 22.21.45: 「支払条件」→「契約種別」に名称変更。
                      請負/準委任 は民法上の契約類型なので "契約種別" のほうが正確。
                      内部フィールド名は後方互換のため payment_terms のまま維持。 */}
                  <th className="text-left p-2 w-32 min-w-[120px]">契約種別</th>
                  <th className="text-left p-2 w-40 min-w-[150px]">納期</th>
                  <th className="text-left p-2 w-40 min-w-[150px]">支払日</th>
                </>
              )}
              {!readOnly && <th className="w-8 p-2"></th>}
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
                const amount =
                  it.amount_ex_tax ?? computeAmount(it);
                return (
                  <tr
                    key={idx}
                    className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                  >
                    <td className="p-2 text-muted-foreground">{idx + 1}</td>
                    <td className="p-2">
                      {cellInput(it.item_name, (v) => update(idx, { item_name: v }), "text", "例: ノートPC")}
                    </td>
                    <td className="p-2 align-top">
                      {/* Phase 22.7: 仕様は複数行 OK だが行高はキャップ。
                          長文は右上 [⤢] ボタンで詳細編集モーダル経由。 */}
                      {cellTextarea(
                        idx,
                        it.spec,
                        (v) => update(idx, { spec: v }),
                        "規格・モデル (3行まで表示)"
                      )}
                    </td>
                    <td className="p-2 align-top">
                      {ownershipSelect(it, idx)}
                      {works.length > 0 && (
                        <div className="mt-1">{workSelect(it, idx)}</div>
                      )}
                    </td>
                    {/* 仕様ロック: 帰属で行を分岐しない。全行で 単価/数量/確定額/支払方法/計算式方法 を表示。 */}
                    <>
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
                    {(() => {
                      const d = formatAmountDisplay(it);
                      return (
                        <td className={cn("p-2 text-right", d.muted ? "text-amber-700 text-[10px] font-semibold" : "font-bold")}>
                          {d.primary}
                          {d.note && <div className="text-[9px] text-amber-700 font-normal">{d.note}</div>}
                        </td>
                      );
                    })()}
                    {showPaymentColumns && (
                      <>
                        {/* Phase 13: 計算方式 (FIXED / SUBSCRIPTION / ROYALTY)
                            Phase 22.8: SUBSCRIPTION のときは右に「⚙ サブスク」ボタンを出して
                            cycle / term_start / term_end / billing_day をモーダル編集できるように。 */}
                        <td className="p-2 align-top">
                          <div className="flex items-center gap-1">
                            <select
                              value={it.calc_method || "FIXED"}
                              onChange={(e) =>
                                update(idx, {
                                  calc_method: e.target
                                    .value as LineItem["calc_method"],
                                  // SUBSCRIPTION 切替時に cycle が未設定なら MONTHLY を初期値に
                                  ...(e.target.value === "SUBSCRIPTION" &&
                                  !it.cycle
                                    ? { cycle: "MONTHLY" as const }
                                    : {}),
                                  // 支払日は「翌月末日払い」を既定に (未設定のまま PDF に出るのを防ぐ)
                                  ...(e.target.value === "SUBSCRIPTION" &&
                                  it.billing_day == null
                                    ? { billing_day: 0 }
                                    : {}),
                                  ...(e.target.value === "SUBSCRIPTION" &&
                                  !it.billing_timing
                                    ? { billing_timing: "NEXT_MONTH" as const }
                                    : {}),
                                })
                              }
                              disabled={readOnly}
                              className={cn(
                                "flex-1 min-w-0 text-xs font-mono bg-transparent",
                                "border-b border-input py-1.5 px-1 focus:outline-none focus:border-foreground",
                                "disabled:opacity-60 disabled:cursor-not-allowed"
                              )}
                            >
                              {CALC_METHOD_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            {it.calc_method === "SUBSCRIPTION" && !readOnly && (
                              <button
                                type="button"
                                onClick={() => setSubEditIdx(idx)}
                                className="flex-shrink-0 p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted"
                                title="サブスク詳細を編集 (周期 / 開始日 / 終了日 / 支払日)"
                              >
                                <Settings className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          {it.calc_method === "ROYALTY" && (
                            <div className="mt-1 space-y-1">
                              <select
                                value={it.royalty_calc_basis || "manufacturing"}
                                onChange={(e) => update(idx, { royalty_calc_basis: e.target.value })}
                                disabled={readOnly}
                                className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground disabled:opacity-60"
                                title="計算式方法(利用許諾計算書と共通)"
                              >
                                {CALC_BASIS_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                              <input
                                type="number"
                                value={it.rate_pct ?? ""}
                                onChange={(e) =>
                                  update(idx, {
                                    rate_pct: Number(e.target.value) || 0,
                                  })
                                }
                                placeholder="料率% 例: 5.0"
                                disabled={readOnly}
                                className="w-full text-xs font-mono bg-transparent border-b border-input py-1 px-1 focus:outline-none focus:border-foreground placeholder:text-muted-foreground/40 placeholder:text-[10px] disabled:opacity-60"
                              />
                              <span className="text-[9px] font-mono text-muted-foreground/70 block">
                                利用許諾料は別途（利用許諾計算書）
                              </span>
                            </div>
                          )}
                        </td>
                        {/* Phase 22.8: SUBSCRIPTION なら 周期 ラベル
                            Phase 22.21.44: それ以外は 請負/準委任 のプルダウン (旧自由テキスト廃止) */}
                        <td className="p-2 align-top">
                          {it.calc_method === "SUBSCRIPTION" ? (
                            <div className="flex items-center gap-1">
                              <Repeat className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                              {subCycleSelect(it, idx)}
                            </div>
                          ) : (
                            <select
                              value={
                                // 旧自由テキストが入っていた場合、請負/準委任 以外は
                                // 未選択扱いにして select の初期値を空に戻す。
                                (() => {
                                  const cur =
                                    it.payment_terms ?? it.payment_method ?? "";
                                  return cur === "請負" || cur === "準委任"
                                    ? cur
                                    : "";
                                })()
                              }
                              onChange={(e) =>
                                update(idx, {
                                  payment_terms: e.target.value,
                                  payment_method: e.target.value,
                                })
                              }
                              disabled={readOnly}
                              className={cn(
                                "w-full text-xs font-mono bg-transparent",
                                "border-b border-input py-1.5 px-1 focus:outline-none focus:border-foreground",
                                "disabled:opacity-60 disabled:cursor-not-allowed"
                              )}
                              title="業務委託の類型を選択 (請負: 成果物単位 / 準委任: 役務単位)"
                            >
                              {PAYMENT_TERMS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        {/* 納期: SUBSCRIPTION=役務提供期間 (契約期間・⚙で編集)、それ以外=delivery_date。
                            旧実装は納期列に支払日サマリ・支払日列に期間を出しており PDF 上で
                            「支払日が期間に見える」逆転が起きていた。 */}
                        <td className="p-2 align-top">
                          {it.calc_method === "SUBSCRIPTION" ? (
                            <span
                              className="text-[10px] font-mono text-foreground/70 whitespace-nowrap"
                              title="役務提供期間 (契約期間)。⚙ から編集。"
                            >
                              {formatTermRange(it.term_start, it.term_end) || (
                                <span className="text-muted-foreground/60 italic">
                                  期間未設定
                                </span>
                              )}
                            </span>
                          ) : (
                            cellInput(
                              it.delivery_date,
                              (v) => update(idx, { delivery_date: v }),
                              "date"
                            )
                          )}
                        </td>
                        {/* 支払日: SUBSCRIPTION=払月+支払日セレクト / ROYALTY固定報酬なし=利用許諾料計算書の通り / それ以外=日付 */}
                        <td className="p-2 align-top">
                          {it.calc_method === "SUBSCRIPTION" ? (
                            subBillingDaySelect(it, idx)
                          ) : it.calc_method === "ROYALTY" && computeAmount(it) <= 0 ? (
                            <span className="text-[10px] font-mono text-amber-700 whitespace-nowrap">
                              利用許諾料計算書の通り
                            </span>
                          ) : (
                            cellInput(
                              it.payment_date,
                              (v) => update(idx, { payment_date: v }),
                              "date"
                            )
                          )}
                        </td>
                      </>
                    )}
                      </>
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
              })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/20 bg-muted/30 font-bold">
              <td colSpan={6} className="p-2 text-right text-[10px] uppercase tracking-wider">
                合計 (税抜)
              </td>
              <td className="p-2 text-right text-[13px]">
                ¥ {grandTotal.toLocaleString("ja-JP")}
              </td>
              {/* Phase 17h: 計算方式 / 契約種別 / 納期 / 支払日 の 4 列 */}
              {showPaymentColumns && <td colSpan={4}></td>}
              {!readOnly && <td></td>}
            </tr>
          </tfoot>
        </table>
          </div>
        </>
      )}

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

      {/* Phase 22.8: サブスク詳細編集モーダル — calc_method=SUBSCRIPTION の行で
          cycle / term_start / term_end / billing_day をまとめて編集。
          顧問契約・SaaS 月額・年額ライセンスなど継続課金パターンを
          構造化して入力できる。 */}
      {subEditIdx !== null && subEditItem && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{
            backgroundColor: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(2px)",
          }}
          onClick={() => setSubEditIdx(null)}
        >
          <div
            className="rounded-md border border-border shadow-2xl flex flex-col w-full max-w-xl"
            style={{ backgroundColor: "#ffffff", isolation: "isolate" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <Repeat className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-mono font-bold uppercase tracking-[0.16em]">
                  サブスク詳細編集
                </h3>
                <span className="text-[10px] font-mono text-muted-foreground">
                  行 {subEditIdx + 1} ·{" "}
                  {subEditItem.item_name || "(品目名未入力)"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSubEditIdx(null)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-sm hover:bg-muted"
                title="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* 周期 */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  周期
                </label>
                <select
                  value={subEditItem.cycle || "MONTHLY"}
                  onChange={(e) =>
                    update(subEditIdx, {
                      cycle: e.target.value as LineItem["cycle"],
                    })
                  }
                  className="w-full text-xs font-mono bg-transparent border-b border-input py-1.5 focus:outline-none focus:border-foreground"
                >
                  {CYCLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              {/* カスタム周期: 間隔 (Nヶ月ごと / N日ごと) */}
              {subEditItem.cycle === "CUSTOM" && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    任意周期の間隔
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-muted-foreground">毎</span>
                    <input
                      type="number"
                      min={1}
                      value={subEditItem.interval_count ?? ""}
                      onChange={(e) =>
                        update(subEditIdx, {
                          interval_count:
                            e.target.value === "" ? undefined : Math.max(1, Number(e.target.value)),
                        })
                      }
                      placeholder="2"
                      className="w-20 text-xs font-mono bg-transparent border-b border-input py-1.5 px-1 focus:outline-none focus:border-foreground"
                    />
                    <select
                      value={subEditItem.interval_unit || "MONTH"}
                      onChange={(e) =>
                        update(subEditIdx, {
                          interval_unit: e.target.value as LineItem["interval_unit"],
                        })
                      }
                      className="text-xs font-mono bg-transparent border-b border-input py-1.5 focus:outline-none focus:border-foreground"
                    >
                      <option value="MONTH">ヶ月ごと</option>
                      <option value="DAY">日ごと</option>
                    </select>
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground/70 italic">
                    例: 「毎 3 ヶ月ごと」=四半期相当 / 「毎 90 日ごと」。日ごとの場合、下の
                    支払日(毎期X日)は使わず開始日からの経過日で計算します。
                  </p>
                </div>
              )}

              {/* 開始日 / 終了日 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    契約開始日 <span className="text-amber-600">*</span>
                  </label>
                  <input
                    type="date"
                    value={subEditItem.term_start || ""}
                    onChange={(e) =>
                      update(subEditIdx, { term_start: e.target.value })
                    }
                    className="w-full text-xs font-mono bg-transparent border-b border-input py-1.5 focus:outline-none focus:border-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    契約終了日 (任意)
                  </label>
                  <input
                    type="date"
                    value={subEditItem.term_end || ""}
                    onChange={(e) =>
                      update(subEditIdx, { term_end: e.target.value })
                    }
                    className="w-full text-xs font-mono bg-transparent border-b border-input py-1.5 focus:outline-none focus:border-foreground"
                  />
                  <p className="text-[10px] font-mono text-muted-foreground/70 italic">
                    空欄なら PDF に「継続中」と記載
                  </p>
                </div>
              </div>
              {/* 支払日 */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  支払日 (締めた期の分を いつ・何日に支払うか)
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={subEditItem.billing_timing || ""}
                    onChange={(e) =>
                      update(subEditIdx, {
                        billing_timing: (e.target.value ||
                          undefined) as LineItem["billing_timing"],
                      })
                    }
                    title="支払月。締めた期の分を当月/翌月/翌々月のどの月に支払うか。"
                    className="w-28 text-xs font-mono bg-transparent border-b border-input py-1.5 px-1 focus:outline-none focus:border-foreground"
                  >
                    <option value="">— 払月 未指定 —</option>
                    <option value="SAME_MONTH">当月払い</option>
                    <option value="NEXT_MONTH">翌月払い</option>
                    <option value="MONTH_AFTER_NEXT">翌々月払い</option>
                  </select>
                  <select
                    value={billingDayToSelectValue(subEditItem.billing_day)}
                    onChange={(e) =>
                      update(subEditIdx, {
                        billing_day: selectValueToBillingDay(e.target.value),
                      })
                    }
                    className="w-32 text-xs font-mono bg-transparent border-b border-input py-1.5 px-1 focus:outline-none focus:border-foreground"
                  >
                    {BILLING_DAY_SELECT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground/70 italic">
                  プレビュー:{" "}
                  <strong>
                    {formatBillingDay(
                      subEditItem.billing_day,
                      subEditItem.cycle,
                      subEditItem.billing_timing
                    ) || "(未設定)"}
                  </strong>
                  {" "}— 例: 月次で「翌月払い・末日」= 月末締め翌月末払い
                </p>
              </div>
              {/* 支払予定日(任意の日に個別指定 / 周期から自動生成) */}
              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    支払予定日(各回の支払日)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-muted-foreground">回数</span>
                    <input
                      type="number"
                      min={1}
                      max={600}
                      value={subPeriods}
                      onChange={(e) => setSubPeriods(Math.max(1, Number(e.target.value) || 1))}
                      title="終了日が空のときに生成する回数"
                      className="w-14 text-xs font-mono bg-transparent border-b border-input py-1 px-1 focus:outline-none focus:border-foreground"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        update(subEditIdx, {
                          payment_schedule: generatePaymentSchedule(subEditItem, subPeriods),
                        })
                      }
                      className="text-[10px] font-mono uppercase tracking-wider border border-foreground/40 bg-foreground text-background hover:opacity-80 px-2.5 py-1 rounded-sm"
                      title="周期・開始日・支払日から支払予定日を自動生成(既存リストは置換)"
                    >
                      ⟳ 自動生成
                    </button>
                  </div>
                </div>

                {(subEditItem.payment_schedule?.length ?? 0) === 0 ? (
                  <p className="text-[10px] font-mono text-muted-foreground/70 italic">
                    「⟳ 自動生成」で周期から展開するか、「+ 行追加」で支払日を個別に列挙できます。
                  </p>
                ) : (
                  <div className="max-h-52 overflow-auto rounded-sm border border-border">
                    <table className="w-full text-[11px] font-mono">
                      <thead>
                        <tr className="bg-muted/40 text-muted-foreground">
                          <th className="text-left px-2 py-1 w-8">#</th>
                          <th className="text-left px-2 py-1">支払予定日</th>
                          <th className="text-right px-2 py-1">金額</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(subEditItem.payment_schedule || []).map((row, ri) => (
                          <tr key={ri} className="border-t border-border">
                            <td className="px-2 py-1 text-muted-foreground">{ri + 1}</td>
                            <td className="px-2 py-1">
                              <input
                                type="date"
                                value={row.date || ""}
                                onChange={(e) => {
                                  const next = (subEditItem.payment_schedule || []).slice();
                                  next[ri] = { ...next[ri], date: e.target.value };
                                  update(subEditIdx, { payment_schedule: next });
                                }}
                                className="w-full bg-transparent border-b border-input py-0.5 focus:outline-none focus:border-foreground"
                              />
                            </td>
                            <td className="px-2 py-1 text-right">
                              <input
                                type="number"
                                value={row.amount ?? ""}
                                onChange={(e) => {
                                  const next = (subEditItem.payment_schedule || []).slice();
                                  next[ri] = {
                                    ...next[ri],
                                    amount: e.target.value === "" ? undefined : Number(e.target.value),
                                  };
                                  update(subEditIdx, { payment_schedule: next });
                                }}
                                className="w-24 text-right bg-transparent border-b border-input py-0.5 focus:outline-none focus:border-foreground"
                              />
                            </td>
                            <td className="px-1 py-1 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = (subEditItem.payment_schedule || []).filter(
                                    (_, i) => i !== ri
                                  );
                                  update(subEditIdx, { payment_schedule: next });
                                }}
                                className="text-muted-foreground hover:text-destructive"
                                title="この行を削除"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border bg-muted/20">
                          <td colSpan={2} className="px-2 py-1 text-right text-muted-foreground">
                            合計 ({subEditItem.payment_schedule?.length || 0} 回)
                          </td>
                          <td className="px-2 py-1 text-right font-bold">
                            {yenLI(
                              (subEditItem.payment_schedule || []).reduce(
                                (s, r) => s + (Number(r.amount) || 0),
                                0
                              )
                            )}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const next = (subEditItem.payment_schedule || []).slice();
                    next.push({ date: "", amount: Number(subEditItem.unit_price) || 0 });
                    update(subEditIdx, { payment_schedule: next });
                  }}
                  className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 hover:bg-muted px-2.5 py-1 rounded-sm"
                >
                  + 行追加
                </button>
              </div>

              {/* 数量 ヒント */}
              <div className="rounded-sm bg-amber-50 border border-amber-200 px-3 py-2 text-[10px] font-mono text-amber-900 leading-relaxed">
                ※ 単価=1周期あたりの料金、数量=期間内の周期数 で
                <strong> 小計 = 期間総額</strong> になります。
                例: 月額 100,000 円 × 12 ヶ月 = 1,200,000 円。
              </div>
            </div>
            <div className="px-4 py-3 border-t border-border bg-muted/30 flex justify-end">
              <button
                type="button"
                onClick={() => setSubEditIdx(null)}
                className="text-[11px] font-mono uppercase tracking-wider border border-foreground/30 hover:bg-muted px-4 py-1.5 rounded-sm transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 22.7: 仕様詳細編集モーダル — 長文の規格・モデル説明を快適に書ける広い textarea。
          画面サイズに応じてサイズが拡大し、split-preview でも編集に十分なスペースを確保。 */}
      {specEditIdx !== null && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{
            backgroundColor: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(2px)",
          }}
          onClick={() => setSpecEditIdx(null)}
        >
          <div
            className="rounded-md border border-border shadow-2xl flex flex-col w-full max-w-2xl max-h-[80vh]"
            style={{ backgroundColor: "#ffffff", isolation: "isolate" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <Maximize2 className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-mono font-bold uppercase tracking-[0.16em]">
                  仕様詳細編集
                </h3>
                <span className="text-[10px] font-mono text-muted-foreground">
                  行 {specEditIdx + 1} ·{" "}
                  {items[specEditIdx]?.item_name || "(品目名未入力)"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSpecEditIdx(null)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-sm hover:bg-muted"
                title="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto">
              <textarea
                value={specEditValue}
                onChange={(e) => update(specEditIdx, { spec: e.target.value })}
                placeholder="規格・モデル・仕様・備考などを自由に記入&#10;改行も保持されます (PDF にもそのまま反映)"
                rows={16}
                className={cn(
                  "w-full text-[12px] font-mono bg-transparent",
                  "border border-input rounded-sm p-3",
                  "focus:outline-none focus:border-foreground focus:ring-1 focus:ring-foreground/20",
                  "placeholder:text-muted-foreground/40",
                  "whitespace-pre-wrap break-words leading-relaxed resize-y"
                )}
                autoFocus
              />
              <p className="mt-2 text-[10px] font-mono text-muted-foreground italic">
                編集内容は即座に明細行に反映されます。閉じるだけで保存完了。
              </p>
            </div>
            <div className="px-4 py-3 border-t border-border bg-muted/30 flex justify-end">
              <button
                type="button"
                onClick={() => setSpecEditIdx(null)}
                className="text-[11px] font-mono uppercase tracking-wider border border-foreground/30 hover:bg-muted px-4 py-1.5 rounded-sm transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
