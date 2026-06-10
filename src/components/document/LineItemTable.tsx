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
import {
  CALC_TYPE_OPTIONS,
  buildFormulaText,
  composeRegionLabel,
  readRegionParts,
  type CalcType,
} from "@/src/components/document/FinancialConditionTable";

export type LineItem = {
  line_no?: number;
  item_name: string;
  spec?: string;
  unit_price: number;
  quantity: number;
  // amount_ex_tax is derived in render — kept in state for round-trips
  amount_ex_tax?: number;
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
    const payDate = dayBased ? cursor : applyBillingDay(cursor, it.billing_day);
    if (end && payDate.getTime() > end.getTime()) break;
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

// サブスクの「支払日 表示」を組み立てる。
//   月次: "毎月25日" / 月末: "毎月末日"
//   四半期/半年/年次: "毎期25日" (or 月末)
function formatBillingDay(day?: number, cycle?: LineItem["cycle"]): string {
  if (!day && day !== 0) return "";
  const cycleLabel =
    cycle === "QUARTERLY"
      ? "毎四半期"
      : cycle === "SEMIANNUAL"
        ? "毎半期"
        : cycle === "ANNUAL"
          ? "毎年"
          : cycle === "CUSTOM"
            ? "毎回"
            : "毎月";
  if (day === 0 || day > 30) return `${cycleLabel}末日`;
  return `${cycleLabel}${day}日`;
}

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

// 行小計(業務報酬・確定額)の計算。
//   - 受注者帰属でも「業務報酬(執筆料等)」は 単価×数量 で確定額に計上する。
//     ※ 利用許諾料(料率・MG/AG)は別建て(確定額外)で、amount には含めない。
//   - 発注者帰属の ROYALTY は 単価×数量×料率%。
//   - それ以外(FIXED / SUBSCRIPTION)は 単価×数量。
const computeAmount = (
  it: Pick<
    LineItem,
    "unit_price" | "quantity" | "calc_method" | "rate_pct" | "deliverable_ownership"
  >
): number => {
  const up = Number(it.unit_price) || 0;
  const qty = Number(it.quantity) || 0;
  // 受注者帰属の業務報酬は FIXED(単価×数量)。料率は利用許諾条件側で使うため amount には反映しない。
  if (it.deliverable_ownership === "受注者") return ceilProduct(up, qty);
  if (it.calc_method === "ROYALTY") {
    const rate = Number(it.rate_pct) || 0;
    return Math.ceil((up * qty * rate) / 100);
  }
  return ceilProduct(up, qty);
};

const yenLI = (n: number) => "¥ " + (Number(n) || 0).toLocaleString("ja-JP");

export const LineItemTable: React.FC<Props> = ({
  items,
  onChange,
  readOnly = false,
  showPaymentColumns = true,
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

  // 受注者帰属の利用許諾条件フィールド変更時の再計算。
  //   ※ 業務報酬の calc_method(=FIXED) は変更しない。料率(計算式タイプ)は利用許諾条件側の
  //     概念で、業務明細の計算方式表示や業務報酬の金額には影響させない。
  const recalcCond = (idx: number, patch: Partial<LineItem>) => {
    const merged = { ...items[idx], ...patch };
    update(idx, {
      ...patch,
      formula_text: buildFormulaText(merged as any),
    });
  };
  const isBaseRateLI = (t?: CalcType) =>
    t === "BASE_QTY_RATE" || t === "BASE_RATE";

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
  const selCls =
    "w-full text-xs font-mono bg-transparent border-b border-input py-1.5 px-1 focus:outline-none focus:border-foreground disabled:opacity-60";
  const renderLicenseFields = (it: LineItem, idx: number) => (
    <div className="rounded-sm border border-amber-300/60 bg-amber-50/30 p-2 space-y-2">
      <div className="text-[10px] font-mono font-bold text-amber-700">
        利用許諾条件（受注者帰属）— 確定額には含めません
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 block">
          <span className={labelCls}>条件名称 (任意)</span>
          {cellInput(
            it.condition_name,
            (v) => update(idx, { condition_name: v }),
            "text",
            "例: 訳者印税 / 既存イラスト利用許諾"
          )}
        </label>
        <label className="block">
          <span className={labelCls}>テリトリー (任意)</span>
          {cellInput(
            readRegionParts(it).territory,
            (v) => {
              const language = readRegionParts(it).language;
              update(idx, {
                region_territory: v,
                region_language: language,
                region_language_label: composeRegionLabel(v, language),
              });
            },
            "text",
            "例: 国内 / 北米 / 全世界"
          )}
        </label>
        <label className="block">
          <span className={labelCls}>言語 (任意)</span>
          {cellInput(
            readRegionParts(it).language,
            (v) => {
              const territory = readRegionParts(it).territory;
              update(idx, {
                region_territory: territory,
                region_language: v,
                region_language_label: composeRegionLabel(territory, v),
              });
            },
            "text",
            "例: 日本語 / 英語 / 全言語"
          )}
        </label>
        <label className="col-span-2 block">
          <span className={labelCls}>支払条件 (任意)</span>
          {cellInput(
            it.payment_terms,
            (v) => update(idx, { payment_terms: v }),
            "text",
            "例: 半期締め翌月末払い / 検収後30日以内"
          )}
          <span className="text-[9px] font-mono text-muted-foreground/70 block mt-0.5">
            ※ 利用許諾料計算書の「支払条件」に引用されます。
          </span>
        </label>
        <label className="block">
          <span className={labelCls}>計算式タイプ</span>
          <select
            value={it.calc_type || ""}
            onChange={(e) =>
              recalcCond(idx, {
                calc_type: (e.target.value || undefined) as CalcType | undefined,
              })
            }
            disabled={readOnly}
            className={selCls}
          >
            <option value="">— 選択 —</option>
            {CALC_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {isBaseRateLI(it.calc_type) && (
          <label className="block">
            <span className={labelCls}>料率 (%)</span>
            {cellInput(
              it.rate_pct,
              (v) => recalcCond(idx, { rate_pct: Number(v) || 0 }),
              "number",
              "例: 8.0"
            )}
          </label>
        )}
        {isBaseRateLI(it.calc_type) && (
          <label className="col-span-2 block">
            <span className={labelCls}>基準価格ラベル</span>
            {cellInput(
              it.base_price_label,
              (v) => recalcCond(idx, { base_price_label: v }),
              "text",
              "例: 税抜定価 / 受領額"
            )}
          </label>
        )}
        {it.calc_type === "FIXED" && (
          <>
            <label className="block">
              <span className={labelCls}>支払区分</span>
              <select
                value={it.fixed_kind || "LUMP"}
                onChange={(e) =>
                  recalcCond(idx, {
                    fixed_kind: e.target.value as "LUMP" | "INSTALLMENT",
                  })
                }
                disabled={readOnly}
                className={selCls}
              >
                <option value="LUMP">一括</option>
                <option value="INSTALLMENT">分割</option>
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>固定額</span>
              {cellInput(
                it.unit_amount,
                (v) => recalcCond(idx, { unit_amount: Number(v) || 0 }),
                "number",
                "0"
              )}
            </label>
          </>
        )}
        {it.calc_type === "SUBSCRIPTION" && (
          <>
            <label className="block">
              <span className={labelCls}>課金サイクル</span>
              <select
                value={it.subscription_cycle || "MONTHLY"}
                onChange={(e) =>
                  recalcCond(idx, {
                    subscription_cycle: e.target.value as "MONTHLY" | "ANNUAL",
                  })
                }
                disabled={readOnly}
                className={selCls}
              >
                <option value="MONTHLY">月払い</option>
                <option value="ANNUAL">年払い</option>
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>単価</span>
              {cellInput(
                it.unit_amount,
                (v) => recalcCond(idx, { unit_amount: Number(v) || 0 }),
                "number",
                "0"
              )}
            </label>
          </>
        )}
        {isBaseRateLI(it.calc_type) && (
          <>
            <label className="block">
              <span className={labelCls}>保証 (MG/AG)</span>
              <select
                value={it.guarantee_type || "NONE"}
                onChange={(e) => {
                  const g = e.target.value as "NONE" | "MG" | "AG";
                  if (g === "MG")
                    update(idx, { guarantee_type: "MG", ag_amount: 0 });
                  else if (g === "AG")
                    update(idx, { guarantee_type: "AG", mg_amount: 0 });
                  else
                    update(idx, {
                      guarantee_type: "NONE",
                      mg_amount: 0,
                      ag_amount: 0,
                    });
                }}
                disabled={readOnly}
                className={selCls}
              >
                <option value="NONE">なし</option>
                <option value="MG">MG (最低保証)</option>
                <option value="AG">AG (前払い保証)</option>
              </select>
            </label>
            {(it.guarantee_type === "MG" || it.guarantee_type === "AG") && (
              <label className="block">
                <span className={labelCls}>
                  {it.guarantee_type === "AG" ? "AG 額" : "MG 額"}
                </span>
                {cellInput(
                  it.guarantee_type === "AG" ? it.ag_amount : it.mg_amount,
                  (v) =>
                    update(
                      idx,
                      it.guarantee_type === "AG"
                        ? { ag_amount: Number(v) || 0 }
                        : { mg_amount: Number(v) || 0 }
                    ),
                  "number",
                  "0"
                )}
              </label>
            )}
          </>
        )}
      </div>
      {it.formula_text && (
        <div className="text-[10px] font-mono text-muted-foreground/80">
          計算式: {it.formula_text}
        </div>
      )}
      <div className="text-[10px] font-mono text-amber-700/80">
        ※ 保存時に「利用許諾条件」へ振り分け、利用許諾料計算書・分配に連動します。
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
        <div className="text-[9px] font-mono text-muted-foreground/70">
          報酬が無く利用許諾料のみの場合は単価=0のままにしてください。
        </div>
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
        {it.deliverable_ownership === "受注者" && (
          <>
            {renderServiceFeeFields(it, idx)}
            {renderLicenseFields(it, idx)}
          </>
        )}
        {it.deliverable_ownership !== "受注者" && (
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
              小計 (税抜)
            </span>
            <div className="text-right text-sm font-mono font-bold py-1">
              ¥ {Number(amount).toLocaleString("ja-JP")}
            </div>
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
              <label className="block">
                <span className="text-[10px] font-mono text-muted-foreground block mb-1">
                  料率 (%)
                </span>
                {cellInput(
                  it.rate_pct,
                  (v) => update(idx, { rate_pct: Number(v) || 0 }),
                  "number",
                  "例: 5.0"
                )}
                <span className="text-[10px] font-mono text-muted-foreground/70 block mt-1">
                  小計 = 単価(基準価格) × 数量 × 料率%（切り上げ）
                </span>
              </label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] font-mono text-muted-foreground block mb-1">
                  {it.calc_method === "SUBSCRIPTION" ? "周期" : "契約種別"}
                </span>
                {it.calc_method === "SUBSCRIPTION" ? (
                  <div className="flex items-center gap-1 text-xs font-mono py-1">
                    <Repeat className="w-3 h-3 text-muted-foreground" />
                    <span>
                      {CYCLE_OPTIONS.find(
                        (o) => o.value === (it.cycle || "MONTHLY")
                      )?.short || "月次"}
                    </span>
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
                  <span className="text-xs font-mono py-1 block">
                    {formatBillingDay(it.billing_day, it.cycle) || (
                      <span className="text-muted-foreground/60 italic">
                        未設定
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
        )}
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
                    </td>
                    {it.deliverable_ownership === "受注者" ? (
                      <td
                        colSpan={showPaymentColumns ? 7 : 3}
                        className="p-2 align-top"
                      >
                        {renderServiceFeeFields(it, idx)}
                        {renderLicenseFields(it, idx)}
                      </td>
                    ) : (
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
                    <td className="p-2 text-right font-bold">
                      ¥ {Number(amount).toLocaleString("ja-JP")}
                    </td>
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
                            <div className="mt-1">
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
                              <span className="text-[9px] font-mono text-muted-foreground/70 block mt-0.5">
                                単価×数量×料率%
                              </span>
                            </div>
                          )}
                        </td>
                        {/* Phase 22.8: SUBSCRIPTION なら 周期 ラベル
                            Phase 22.21.44: それ以外は 請負/準委任 のプルダウン (旧自由テキスト廃止) */}
                        <td className="p-2 align-top">
                          {it.calc_method === "SUBSCRIPTION" ? (
                            <div className="flex items-center gap-1 text-[11px] font-mono">
                              <Repeat className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                              <span className="text-foreground/80">
                                {CYCLE_OPTIONS.find(
                                  (o) => o.value === (it.cycle || "MONTHLY")
                                )?.short || "月次"}
                              </span>
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
                        {/* Phase 22.8: SUBSCRIPTION なら 支払日サマリ (毎月N日)、それ以外なら delivery_date */}
                        <td className="p-2 align-top">
                          {it.calc_method === "SUBSCRIPTION" ? (
                            <span className="text-[11px] font-mono text-foreground/80">
                              {formatBillingDay(it.billing_day, it.cycle) || (
                                <span className="text-muted-foreground/60 italic text-[10px]">
                                  支払日未設定
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
                        {/* Phase 22.8: SUBSCRIPTION なら 期間サマリ (start〜end)、それ以外なら payment_date */}
                        <td className="p-2 align-top">
                          {it.calc_method === "SUBSCRIPTION" ? (
                            <span className="text-[10px] font-mono text-foreground/70 whitespace-nowrap">
                              {formatTermRange(it.term_start, it.term_end) || (
                                <span className="text-muted-foreground/60 italic">
                                  期間未設定
                                </span>
                              )}
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
                  支払日 (毎周期の何日に支払うか)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={31}
                    value={
                      subEditItem.billing_day === undefined ||
                      subEditItem.billing_day === null
                        ? ""
                        : subEditItem.billing_day
                    }
                    onChange={(e) => {
                      const raw = e.target.value;
                      update(subEditIdx, {
                        billing_day: raw === "" ? undefined : Number(raw),
                      });
                    }}
                    placeholder="25"
                    className="w-24 text-xs font-mono bg-transparent border-b border-input py-1.5 px-1 focus:outline-none focus:border-foreground"
                  />
                  <span className="text-[11px] font-mono text-muted-foreground">
                    日 (0 または 31 以上で「末日」扱い)
                  </span>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground/70 italic">
                  プレビュー:{" "}
                  <strong>
                    {formatBillingDay(
                      subEditItem.billing_day,
                      subEditItem.cycle
                    ) || "(未設定)"}
                  </strong>
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
