/**
 * Common billing math for the LegalBridge document pipeline.
 *
 * Both the 発注書↔検収書 flow and the 利用許諾条件書↔利用許諾料計算書
 * flow ultimately compute the same shape of number:
 *
 *   gross_ex_tax (depends on 計算型)
 *     ↓ × acceptance_ratio (歩留率)
 *   after_acceptance
 *     ↓ − MG 消化
 *   after_mg
 *     ↓ − AG 相殺
 *   actual_ex_tax
 *     ↓ × tax_rate (ceil)
 *   total_inc_tax
 *
 * The shape of `gross_ex_tax` depends on the contract pricing model:
 *
 *   固定額型 (FixedTerms)
 *     gross = ceil(unit_price × (quantity − sample_quantity))
 *
 *   サブスク型 (SubscriptionTerms)
 *     gross = ceil(period_amount × period_count + initial_fee)
 *
 *   業績連動型 (PerformanceTerms)
 *     gross = ceil(base_price × (quantity − sample_quantity) × rate_pct/100)
 *
 * The remaining cascade is identical regardless of pricing model, which
 * is why we unify here.
 *
 * Rounding policy (Legal-confirmed):
 *   - 消費税: Math.ceil (切り上げ).
 *   - その他の中間計算: 同じく Math.ceil で統一. 発注書側で歴史的に
 *     Math.round を使っていた箇所は最大 1 円のズレが生じるが, 統一の
 *     方がエンジニアリング上の正しさ保証が強い (Legal とも合意).
 *
 * MG / AG model:
 *   - MG (Minimum Guarantee): 最低保証額. ロイヤリティが MG に達するまで
 *     支払いなし, 達したら超過分のみ支払い.
 *   - AG (Advance Guarantee): 前払い保証金. 将来の発生額から相殺.
 *   - 計算順序は MG 先, 残りに対して AG.
 *   - サブスク型のイニシャル費用も同じ gross に統合され, MG/AG 相殺対象.
 *   - mg_consumed_before / ag_consumed_before は呼び出し側 (DB 集計) で
 *     渡す. このモジュールは pure function.
 */

// ─────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────

export type FixedTerms = {
  type: "fixed";
  unit_price: number; // 単価
  quantity: number; // 評価個数
};

export type SubscriptionTerms = {
  type: "subscription";
  period_amount: number; // 1 期間あたり料金
  period_count: number; // 期間数
  period_unit?: "monthly" | "yearly"; // metadata only (表示用)
  initial_fee?: number; // イニシャル費用 (MG/AG 相殺対象)
};

export type PerformanceTerms = {
  type: "performance";
  base_price: number; // 基準価格 (MSRP 等)
  rate_pct: number; // 料率 %
  quantity: number; // 評価個数
};

export type FeeTerms = FixedTerms | SubscriptionTerms | PerformanceTerms;

export type Adjustments = {
  /** 歩留率 0.0–1.0. default 1.0 (全量). サブスクには通常適用しない. */
  acceptance_ratio?: number;
  /** 不課金分の数量. fixed / performance のみ意味を持つ. */
  sample_quantity?: number;

  /** MG (最低保証) 総額. */
  mg_amount?: number;
  /** これまでに消化済の MG 累計. DB 集計で渡す. */
  mg_consumed_before?: number;

  /** AG (前払い保証) 総額. */
  ag_amount?: number;
  /** これまでに相殺済の AG 累計. DB 集計で渡す. */
  ag_consumed_before?: number;
};

export type FeeResult = {
  // 内訳 (audit-friendly)
  gross_ex_tax: number;
  after_acceptance: number;

  mg_consumed_this_time: number;
  mg_remaining_after: number;
  mg_fully_consumed: boolean;

  ag_offset_this_time: number;
  ag_remaining_after: number;
  ag_fully_consumed: boolean;

  actual_ex_tax: number; // ユーザに請求する税抜額
  tax_rate: number;
  tax_amount: number;
  total_inc_tax: number;

  // 試算根拠 (フォーム表示・ログ用)
  formula_breakdown: string;
};

// ─────────────────────────────────────────────────────────────────
//  Gross calculation by pricing model
// ─────────────────────────────────────────────────────────────────

function calcGross(terms: FeeTerms, adj: Adjustments): {
  gross: number;
  breakdown: string;
} {
  switch (terms.type) {
    case "fixed": {
      const samples = Number(adj.sample_quantity) || 0;
      const billable = Math.max(0, Number(terms.quantity) - samples);
      const unit = Number(terms.unit_price) || 0;
      const gross = Math.ceil(unit * billable);
      const breakdown = samples > 0
        ? `${unit} × (${terms.quantity} − ${samples}) = ${gross}`
        : `${unit} × ${billable} = ${gross}`;
      return { gross, breakdown };
    }
    case "subscription": {
      const periodAmount = Number(terms.period_amount) || 0;
      const periodCount = Number(terms.period_count) || 0;
      const initial = Number(terms.initial_fee) || 0;
      const recurring = periodAmount * periodCount;
      const gross = Math.ceil(recurring + initial);
      const breakdown = initial > 0
        ? `${periodAmount} × ${periodCount} (${terms.period_unit || "period"}) + initial ${initial} = ${gross}`
        : `${periodAmount} × ${periodCount} (${terms.period_unit || "period"}) = ${gross}`;
      return { gross, breakdown };
    }
    case "performance": {
      const samples = Number(adj.sample_quantity) || 0;
      const billable = Math.max(0, Number(terms.quantity) - samples);
      const base = Number(terms.base_price) || 0;
      const rate = Number(terms.rate_pct) || 0;
      const gross = Math.ceil(base * billable * (rate / 100));
      const breakdown = samples > 0
        ? `${base} × (${terms.quantity} − ${samples}) × ${rate}% = ${gross}`
        : `${base} × ${billable} × ${rate}% = ${gross}`;
      return { gross, breakdown };
    }
  }
}

// ─────────────────────────────────────────────────────────────────
//  Main entry
// ─────────────────────────────────────────────────────────────────

/**
 * Compute the full fee cascade for a single calculation event.
 *
 *   gross → ×acceptance → −MG → −AG → +tax = total
 *
 * Pure function; no DB. Callers supply mg_consumed_before /
 * ag_consumed_before from their own SUM() queries.
 */
export function calculateFee(
  terms: FeeTerms,
  adjustments: Adjustments = {},
  taxRate: number = 10
): FeeResult {
  // 1. Gross
  const { gross, breakdown } = calcGross(terms, adjustments);

  // 2. Acceptance ratio
  const rawRatio = adjustments.acceptance_ratio;
  const ratio =
    rawRatio == null || !Number.isFinite(Number(rawRatio))
      ? 1.0
      : Math.max(0, Math.min(1, Number(rawRatio)));
  const after_acceptance = Math.ceil(gross * ratio);

  // 3. MG offset
  const mgTotal = Number(adjustments.mg_amount) || 0;
  const mgConsumedBefore = Number(adjustments.mg_consumed_before) || 0;
  const mgRemainBefore = Math.max(0, mgTotal - mgConsumedBefore);
  const mg_consumed_this_time = Math.min(after_acceptance, mgRemainBefore);
  const mg_remaining_after = mgRemainBefore - mg_consumed_this_time;
  const mg_fully_consumed =
    mgTotal > 0 && mgConsumedBefore + mg_consumed_this_time >= mgTotal;
  const after_mg = after_acceptance - mg_consumed_this_time;

  // 4. AG offset (applied after MG)
  const agTotal = Number(adjustments.ag_amount) || 0;
  const agConsumedBefore = Number(adjustments.ag_consumed_before) || 0;
  const agRemainBefore = Math.max(0, agTotal - agConsumedBefore);
  const ag_offset_this_time = Math.min(after_mg, agRemainBefore);
  const ag_remaining_after = agRemainBefore - ag_offset_this_time;
  const ag_fully_consumed =
    agTotal > 0 && agConsumedBefore + ag_offset_this_time >= agTotal;
  const actual_ex_tax = after_mg - ag_offset_this_time;

  // 5. Tax (ceil)
  const safeTaxRate = Number(taxRate) || 0;
  const tax_amount = Math.ceil(actual_ex_tax * (safeTaxRate / 100));
  const total_inc_tax = actual_ex_tax + tax_amount;

  return {
    gross_ex_tax: gross,
    after_acceptance,
    mg_consumed_this_time,
    mg_remaining_after,
    mg_fully_consumed,
    ag_offset_this_time,
    ag_remaining_after,
    ag_fully_consumed,
    actual_ex_tax,
    tax_rate: safeTaxRate,
    tax_amount,
    total_inc_tax,
    formula_breakdown: breakdown,
  };
}

// ─────────────────────────────────────────────────────────────────
//  Convenience helpers (thin wrappers around calculateFee)
// ─────────────────────────────────────────────────────────────────

/**
 * Just compute the gross of a single line (no tax, no adjustments).
 * Used by order_line_items and similar "1 row = 1 line" tables.
 */
export function grossOf(terms: FeeTerms): number {
  return calcGross(terms, {}).gross;
}
