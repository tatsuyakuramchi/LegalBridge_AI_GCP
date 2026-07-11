/**
 * データ構造刷新 — 旧明細 → 統一条件明細(condition_lines) 変換ロジック (共有)。
 *
 * 概念/実装設計:
 *   docs/condition_lines_unification_design.md
 *   docs/condition_lines_implementation_plan.md (Phase C-2 / C-5)
 *
 * このモジュールは「純関数」のみを置く (DB アクセスなし)。
 *   - Phase C-2 のバックフィルスクリプト (scripts/restructure_c2_condition_lines.ts)
 *   - Phase C-5 の二重書き込み (worker の検収/計算/契約登録パス)
 * の両方が同一の変換ルールを使うことで、移行データと新規データの整合を保つ。
 *
 * payment_scheme 判定マッピング表 (⚠ 実データの calc_method 値域は
 *   `SELECT DISTINCT calc_method FROM capability_line_items` 等で要確認):
 *
 *   capability_line_items:
 *     calc_method='SUBSCRIPTION'                  → subscription
 *     cycle あり / billing_day あり               → subscription
 *     quantity あり かつ unit_price あり          → per_unit
 *     それ以外                                    → lump_sum
 *
 *   capability_financial_conditions:
 *     calc_method='FIXED' かつ rate_pct が空      → lump_sum (一括許諾)
 *     それ以外                                    → royalty
 */

export type PaymentScheme =
  | "lump_sum"
  | "per_unit"
  | "installment"
  | "subscription"
  | "royalty";

const isPresent = (v: any): boolean =>
  v !== null && v !== undefined && String(v).trim() !== "";

const num = (v: any): number | null =>
  isPresent(v) && !Number.isNaN(Number(v)) ? Number(v) : null;

// ---- capability_line_items → condition_lines -----------------------------

export interface LineItemLike {
  id?: number | null;
  line_no?: any;
  item_name?: any;
  spec?: any;
  category?: any;
  calc_method?: any;
  payment_method?: any;
  payment_terms?: any;
  payment_date?: any;
  fee_type?: any;
  quantity?: any;
  unit_price?: any;
  amount_ex_tax?: any;
  delivery_date?: any;
  cycle?: any;
  billing_day?: any;
  term_start?: any;
  term_end?: any;
  // 2c: 横断検索・編集メタ(capability_line_items 固有)
  source_ip_id?: any;
  master_contract_id?: any;
  ringi_id?: any;
  status_flags?: any;
  is_inbound?: any;
  flow_direction?: any;
  // 明細ごとの成果物作品(作品1:文書N:明細N)。NULL は文書単位 work へフォールバック。
  work_id?: any;
}

export function determineLineItemScheme(li: LineItemLike): PaymentScheme {
  const cm = String(li.calc_method ?? "").trim().toUpperCase();
  if (cm === "SUBSCRIPTION") return "subscription";
  if (isPresent(li.cycle) || isPresent(li.billing_day)) return "subscription";
  if (isPresent(li.quantity) && isPresent(li.unit_price)) return "per_unit";
  return "lump_sum";
}

/**
 * condition_lines に INSERT する列値を生成 (capability_line_items 由来)。
 * direction は常に 'payable' (イン側=当社支払)。
 * 消化型(per_unit/lump_sum)は amount_ex_tax 必須 (CHECK cl_scheme_depletable_target)
 * のため、欠損は 0 で埋める。
 */
export function mapLineItemToConditionLine(
  li: LineItemLike,
  capabilityId: number,
  lineNo: number,
  lineCode: string | null
): Record<string, any> {
  const scheme = determineLineItemScheme(li);
  const recurring = scheme === "subscription";
  return {
    capability_id: capabilityId,
    line_no: lineNo,
    line_code: lineCode,
    subject: isPresent(li.item_name) ? String(li.item_name) : null,
    direction: "payable",
    payment_scheme: scheme,
    rights_attribution: null,
    currency: "JPY",
    notes: isPresent(li.spec) ? String(li.spec) : null,
    // Phase E-2(a) 表示用フィールド (旧 capability_line_items 由来)
    spec: isPresent(li.spec) ? String(li.spec) : null,
    category: isPresent(li.category) ? String(li.category) : null,
    calc_method: isPresent(li.calc_method) ? String(li.calc_method) : null,
    payment_method: isPresent(li.payment_method) ? String(li.payment_method) : null,
    payment_terms: isPresent(li.payment_terms) ? String(li.payment_terms) : null,
    payment_date: isPresent(li.payment_date) ? li.payment_date : null,
    fee_type: isPresent(li.fee_type) ? String(li.fee_type) : null,
    calc_period: null,
    formula_text: null,
    source_seq_no: num(li.line_no),
    // 2c-2: 数量・単価・金額は全方式で保存(subscription も生値を持つ)。横断検索が
    //   raw 明細として表示するため。CHECK cl_scheme_depletable_target は subscription の
    //   amount を許容(NULL/値どちらでも可)。コックピットの remaining は status_v 側で
    //   消化型のみに限定(0066)するので subscription は「残—」を維持。
    quantity: num(li.quantity),
    unit_price: num(li.unit_price),
    amount_ex_tax: num(li.amount_ex_tax) ?? 0,
    delivery_date: isPresent(li.delivery_date) ? li.delivery_date : null,
    // 継続型(subscription)の期間・サイクル
    term_start: recurring && isPresent(li.term_start) ? li.term_start : null,
    term_end: recurring && isPresent(li.term_end) ? li.term_end : null,
    cycle: recurring && isPresent(li.cycle) ? String(li.cycle) : null,
    billing_day: recurring ? num(li.billing_day) : null,
    // royalty 専用列は line item には無い
    rate_pct: null,
    base_price_label: null,
    mg_amount: null,
    ag_amount: null,
    // 2c: 横断検索・編集メタ(旧 capability_line_items 由来)。status_flags は
    //   JSONB(NOT NULL DEFAULT '{}')なので欠損は '{}'、is_inbound は false。
    source_ip_id: li.source_ip_id ?? null,
    master_contract_id: li.master_contract_id ?? null,
    ringi_id: li.ringi_id ?? null,
    status_flags: li.status_flags != null ? JSON.stringify(li.status_flags) : "{}",
    is_inbound: li.is_inbound === true,
    flow_direction: isPresent(li.flow_direction) ? String(li.flow_direction) : null,
    // 明細ごとの作品(NULL は後段 linkage で文書 work へ COALESCE)。
    work_id: num(li.work_id),
    source_line_item_id: li.id ?? null,
    source_condition_id: null,
  };
}

// ---- capability_financial_conditions → condition_lines -------------------

export interface FinancialConditionLike {
  id?: number | null;
  condition_no?: any;
  region_language_label?: any;
  calc_method?: any;
  rate_pct?: any;
  base_price_label?: any;
  calc_period?: any;
  calc_period_kind?: any;
  calc_period_close_month?: any;
  currency?: any;
  formula_text?: any;
  payment_terms?: any;
  mg_amount?: any;
  ag_amount?: any;
  // 利用許諾条件(明細)ごとの作品。受注者帰属明細から継承(D2)。
  work_id?: any;
}

export interface ParentCapTerms {
  effective_date?: any;
  expiration_date?: any;
}

export function determineFinancialScheme(
  fc: FinancialConditionLike
): PaymentScheme {
  const cm = String(fc.calc_method ?? "").trim().toUpperCase();
  if (cm === "FIXED" && !isPresent(fc.rate_pct)) return "lump_sum";
  return "royalty";
}

/**
 * condition_lines に INSERT する列値を生成 (capability_financial_conditions 由来)。
 * 一括許諾(lump_sum)は amount_ex_tax 必須のため mg_amount を金額として転記
 * (一括許諾の金額は mg_amount に入っている運用が多い。無ければ 0)。
 * royalty は rate_pct/mg/ag を保持し、term_* は親契約の期間をコピー。
 */
export function mapFinancialConditionToConditionLine(
  fc: FinancialConditionLike,
  parentCap: ParentCapTerms | null | undefined,
  capabilityId: number,
  lineNo: number,
  lineCode: string | null
): Record<string, any> {
  const scheme = determineFinancialScheme(fc);
  const royalty = scheme === "royalty";
  // 取引区分: calc_type='SUPPLY_QTY'(供給価格×個数)= プロダクトイン(完成品の仕入)。
  //   それ以外の金銭条件はライセンスイン。プロダクトインは inbound(仕入=in)。
  const isProductIn = String((fc as any).calc_type ?? "").trim().toUpperCase() === "SUPPLY_QTY";
  return {
    capability_id: capabilityId,
    line_no: lineNo,
    line_code: lineCode,
    subject: isPresent(fc.region_language_label)
      ? String(fc.region_language_label)
      : null,
    direction: "payable",
    payment_scheme: scheme,
    rights_attribution: null,
    currency: isPresent(fc.currency) ? String(fc.currency) : "JPY",
    notes:
      [fc.formula_text, fc.payment_terms]
        .filter((x) => isPresent(x))
        .map((x) => String(x))
        .join(" / ") || null,
    // Phase E-2(a) 表示用フィールド (旧 capability_financial_conditions 由来)
    spec: null,
    category: null,
    calc_method: isPresent(fc.calc_method) ? String(fc.calc_method) : null,
    payment_method: null,
    payment_terms: isPresent(fc.payment_terms) ? String(fc.payment_terms) : null,
    payment_date: null,
    fee_type: null,
    calc_period: isPresent(fc.calc_period) ? String(fc.calc_period) : null,
    formula_text: isPresent(fc.formula_text) ? String(fc.formula_text) : null,
    source_seq_no: num(fc.condition_no),
    quantity: null,
    unit_price: null,
    // lump_sum は金額必須 → mg_amount を転記(無ければ0)。royalty は null。
    amount_ex_tax: royalty ? null : num(fc.mg_amount) ?? 0,
    delivery_date: null,
    term_start: parentCap?.effective_date ?? null,
    term_end: parentCap?.expiration_date ?? null,
    cycle: null,
    billing_day: null,
    calc_period_kind: isPresent(fc.calc_period_kind)
      ? String(fc.calc_period_kind)
      : null,
    calc_period_close_month: num(fc.calc_period_close_month),
    // royalty 専用列 (非 royalty では null = CHECK cl_scheme_royalty_cols)
    rate_pct: royalty ? num(fc.rate_pct) : null,
    base_price_label:
      royalty && isPresent(fc.base_price_label)
        ? String(fc.base_price_label)
        : null,
    mg_amount: royalty ? num(fc.mg_amount) : null,
    ag_amount: royalty ? num(fc.ag_amount) : null,
    // 2c: 紐付け/状態は line item 固有。financial 由来は既定値。
    source_ip_id: null,
    master_contract_id: null,
    ringi_id: null,
    status_flags: "{}",
    is_inbound: isProductIn ? true : false,
    flow_direction: isProductIn ? "in" : null,
    transaction_kind: isProductIn ? "product" : "license",
    // 明細ごとの作品(NULL は後段 linkage で文書 work へ COALESCE)。
    work_id: num(fc.work_id),
    source_line_item_id: null,
    source_condition_id: fc.id ?? null,
  };
}

// condition_lines への INSERT を組み立てる共通ヘルパ。
//   cols(列名配列) と values(同順の値配列) を返す。スクリプト/ランタイム双方が
//   parameterized INSERT に流し込む。
export const CONDITION_LINE_COLUMNS = [
  "capability_id",
  "line_no",
  "line_code",
  "subject",
  "direction",
  "payment_scheme",
  "rights_attribution",
  "currency",
  "notes",
  "spec",
  "category",
  "calc_method",
  "payment_method",
  "payment_terms",
  "payment_date",
  "fee_type",
  "calc_period",
  "formula_text",
  "source_seq_no",
  "quantity",
  "unit_price",
  "amount_ex_tax",
  "delivery_date",
  "term_start",
  "term_end",
  "cycle",
  "billing_day",
  "calc_period_kind",
  "calc_period_close_month",
  "rate_pct",
  "base_price_label",
  "mg_amount",
  "ag_amount",
  // 0101 で DROP 済み(source_ip_id / master_contract_id)。列配列から除去して
  //   直INSERT経路(decompose 等)が 42703 で 500 にならないようにする(S4)。
  "ringi_id",
  "status_flags",
  "is_inbound",
  "flow_direction",
  "transaction_kind",
  "work_id",
  "source_line_item_id",
  "source_condition_id",
] as const;

export function conditionLineInsertValues(
  row: Record<string, any>
): any[] {
  return CONDITION_LINE_COLUMNS.map((c) => row[c] ?? null);
}
