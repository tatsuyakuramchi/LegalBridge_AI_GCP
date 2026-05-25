/**
 * Common billing math for the LegalBridge document pipeline.
 *
 * Both the 発注書↔検収書 flow and the 利用許諾条件書↔利用許諾料計算書
 * flow ultimately compute the same shape of number:
 *
 *   gross_ex_tax (depends on 計算型)
 *     ↓ × acceptance_ratio (歩留率)
 *   after_acceptance
 *     ↓ MG floor (Phase 22.21.95: max(after_acceptance, mg_amount))
 *   after_mg
 *     ↓ − AG 相殺 (累積消化)
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
 * MG / AG model (Phase 22.21.95 — semantically corrected):
 *   - MG (Minimum Guarantee): 各計算書での **floor (最低保証)**.
 *       actual = max(after_acceptance, mg_amount). MG 自体は消化されない
 *       (毎期チェックされる単純な floor). 累積管理は不要。
 *   - AG (Advance Guarantee): 前払い保証金 (累積消化型).
 *       将来発生分から相殺。AG 残高を超えるまで実支払はゼロ。
 *   - 計算順序: gross → acceptance → **MG floor** → **AG offset** → actual.
 *   - サブスク型のイニシャル費用も同じ gross に統合される.
 *   - ag_consumed_before は呼び出し側 (DB 集計) で渡す.
 *
 *   旧バージョン (Phase 22.21.94 まで) は mg_amount を AG と同じ消化型として
 *   扱っていた (誤実装)。Phase 22.21.95 で MG=floor / AG=consume に修正。
 *   旧コードの戻り値 mg_consumed_* は AG として再解釈すべきデータだが、
 *   既存呼び出し側との互換性のため返却 shape は当面維持し、AG 用フィールドを
 *   追加する形にしている。
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

  /**
   * MG (最低保証 = floor) 総額. Phase 22.21.95:
   * 累積消化ではなく毎期 floor として扱う。actual = max(after_acceptance, mg_amount).
   * mg_consumed_before は MG では使われない (互換のため shape は残す).
   */
  mg_amount?: number;
  /** @deprecated Phase 22.21.95: MG が floor 化したため使用しない. */
  mg_consumed_before?: number;

  /** AG (前払い保証 = 累積消化) 総額. */
  ag_amount?: number;
  /** これまでに消化済の AG 累計. DB 集計で渡す. */
  ag_consumed_before?: number;
};

export type FeeResult = {
  // 内訳 (audit-friendly)
  gross_ex_tax: number;
  after_acceptance: number;

  /**
   * Phase 22.21.95: MG が floor として適用された場合の上乗せ額.
   *   mg_topup_this_time = max(0, mg_amount - after_acceptance)
   * これが > 0 なら "MG floor 適用 (グロス < MG)" の状態.
   */
  mg_topup_this_time: number;
  mg_floor_applied: boolean; // mg_topup_this_time > 0 か否か

  /** @deprecated Phase 22.21.95: MG は floor 化したため常に 0 を返す. */
  mg_consumed_this_time: number;
  /** @deprecated Phase 22.21.95: MG remaining の概念が無くなった. mg_amount をそのまま返す. */
  mg_remaining_after: number;
  /** @deprecated Phase 22.21.95: 互換のため false 固定. */
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

  // 3. MG floor (Phase 22.21.95 — semantically corrected).
  //    MG は「最低保証額」= 各計算書での floor。グロスが MG を下回ったら
  //    MG を採用する。MG 自体は消化されない (毎期独立の floor チェック)。
  const mgTotal = Number(adjustments.mg_amount) || 0;
  const after_mg = Math.max(after_acceptance, mgTotal);
  const mg_topup_this_time = Math.max(0, after_mg - after_acceptance);
  const mg_floor_applied = mg_topup_this_time > 0;
  // 旧 shape 互換 (mg_consumed_* は使われなくなった)
  const mg_consumed_this_time = 0;
  const mg_remaining_after = mgTotal;
  const mg_fully_consumed = false;

  // 4. AG offset (= 累積消化型. 前払い保証金から差し引き).
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
    mg_topup_this_time,
    mg_floor_applied,
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
