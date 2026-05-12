/**
 * Royalty + MG (Minimum Guarantee) arithmetic for the licensing pipeline.
 *
 * Mirrors calc.ts (発注書/検収書 用) for the 個別利用許諾条件書 →
 * 利用許諾料計算書 flow. Same rounding policy:
 *   - 消費税およびロイヤリティ算定は Math.ceil で切り上げ
 *     (Legal-confirmed).
 *   - 数量 / 料率は DECIMAL(10,4) / DECIMAL(7,4) なので JS number
 *     経由でも実用上の誤差は出ない。
 *
 * MG model:
 *   - mg_amount は license_financial_conditions 単位の総額。
 *   - 各 royalty_calculations 行は mg_consumed_this_time に「今回
 *     消化した額」を保存する。
 *   - 過去消化分は SUM(prior royalty_calculations.mg_consumed_this_time)
 *     で読み出す (calc_license.ts でカプセル化)。
 */

import { query } from "./db.ts";
import { calculateTax } from "./calc.ts";

// -------------------------------------------------------------------
// Pure helpers (no DB)
// -------------------------------------------------------------------

/**
 * 総ロイヤリティ (税抜) を計算する。
 *   gross = ceil(unit_price × billable_quantity × rate_pct / 100)
 */
export function calculateGrossRoyalty(
  unitPrice: number,
  billableQuantity: number,
  ratePct: number
): number {
  const up = Number(unitPrice) || 0;
  const qty = Number(billableQuantity) || 0;
  const rate = Number(ratePct) || 0;
  return Math.ceil(up * qty * (rate / 100));
}

/**
 * MG 消化を適用する。grossRoyalty と mgRemainingBefore を受け取り、
 * 今回消化額・残額・MG 消化完了フラグ・実支払額を返す。
 *
 * ルール:
 *   - MG 残 0 以下: gross 全額が actual_royalty。
 *   - MG 残 >= gross: 今回 gross 全額を MG から相殺、actual_royalty = 0。
 *   - MG 残 < gross: MG 全額消化、actual_royalty = gross - MG残。
 */
export function applyMgConsumption(
  grossRoyalty: number,
  mgRemainingBefore: number
): {
  mg_consumed_this_time: number;
  mg_remaining_after: number;
  mg_fully_consumed: boolean;
  actual_royalty: number;
} {
  const gross = Number(grossRoyalty) || 0;
  const remainBefore = Number(mgRemainingBefore) || 0;

  if (remainBefore <= 0) {
    return {
      mg_consumed_this_time: 0,
      mg_remaining_after: 0,
      mg_fully_consumed: true,
      actual_royalty: gross,
    };
  }
  if (remainBefore >= gross) {
    return {
      mg_consumed_this_time: gross,
      mg_remaining_after: remainBefore - gross,
      mg_fully_consumed: false,
      actual_royalty: 0,
    };
  }
  // 部分: MG が gross の一部しかカバーしない
  return {
    mg_consumed_this_time: remainBefore,
    mg_remaining_after: 0,
    mg_fully_consumed: true,
    actual_royalty: gross - remainBefore,
  };
}

// -------------------------------------------------------------------
// DB-touching helpers
// -------------------------------------------------------------------

/**
 * 指定ライセンス契約 (任意で特定の金銭条件) のこれまでの MG 累積
 * 消化額を返す。Phase 5b の preview/save エンドポイントで「今回前の
 * MG 残」を求めるのに使う。
 *
 * 注: license_financial_condition_id で絞らない場合、その契約全体の
 *      MG 累積消化を返す (金銭条件単位の MG が複数ある場合に注意)。
 */
export async function getMgConsumedToDate(
  licenseContractId: number,
  licenseFinancialConditionId?: number,
  excludeCalculationId?: number
): Promise<number> {
  const conditions: string[] = ["license_contract_id = $1"];
  const params: any[] = [licenseContractId];
  if (licenseFinancialConditionId != null) {
    params.push(licenseFinancialConditionId);
    conditions.push(`license_financial_condition_id = $${params.length}`);
  }
  if (excludeCalculationId != null) {
    params.push(excludeCalculationId);
    conditions.push(`id <> $${params.length}`);
  }
  const res = await query(
    `SELECT COALESCE(SUM(mg_consumed_this_time), 0) AS consumed
       FROM royalty_calculations
      WHERE ${conditions.join(" AND ")}`,
    params
  );
  return Number(res.rows[0].consumed) || 0;
}

/**
 * 利用許諾料計算書を 1 件 preview する (まだ保存しない)。
 * フロントが「数量を 100 に変更したら税込いくら？」と問い合わせる用途。
 *
 * 戻り値は royalty_calculations にそのまま挿入できる shape にしてある。
 */
export async function previewRoyaltyCalculation(params: {
  license_contract_id: number;
  license_financial_condition_id: number;
  unit_price: number;
  quantity: number;
  sample_quantity?: number;
  tax_rate?: number;
}): Promise<{
  unit_price: number;
  quantity: number;
  sample_quantity: number;
  billable_quantity: number;
  rate_pct: number;
  gross_royalty_ex_tax: number;
  mg_amount: number;
  mg_consumed_before: number;
  mg_consumed_this_time: number;
  mg_consumed_after: number;
  mg_remaining: number;
  mg_fully_consumed: boolean;
  actual_royalty_ex_tax: number;
  tax_rate: number;
  tax_amount: number;
  total_payment_inc_tax: number;
  currency: string;
}> {
  const condRes = await query(
    `SELECT rate_pct, mg_amount, currency
       FROM license_financial_conditions
      WHERE id = $1`,
    [params.license_financial_condition_id]
  );
  if (condRes.rows.length === 0) {
    throw new Error(
      `license_financial_condition ${params.license_financial_condition_id} not found`
    );
  }
  const ratePct = Number(condRes.rows[0].rate_pct) || 0;
  const mgAmount = Number(condRes.rows[0].mg_amount) || 0;
  const currency = condRes.rows[0].currency || "JPY";

  const unitPrice = Number(params.unit_price) || 0;
  const quantity = Number(params.quantity) || 0;
  const sampleQty = Number(params.sample_quantity) || 0;
  const billableQty = Math.max(0, quantity - sampleQty);

  const gross = calculateGrossRoyalty(unitPrice, billableQty, ratePct);

  const consumedToDate = await getMgConsumedToDate(
    params.license_contract_id,
    params.license_financial_condition_id
  );
  const mgRemainingBefore = Math.max(0, mgAmount - consumedToDate);

  const mg = applyMgConsumption(gross, mgRemainingBefore);

  const taxRate = params.tax_rate != null ? Number(params.tax_rate) : 10;
  const { taxAmount, amountIncTax } = calculateTax(mg.actual_royalty, taxRate);

  return {
    unit_price: unitPrice,
    quantity,
    sample_quantity: sampleQty,
    billable_quantity: billableQty,
    rate_pct: ratePct,
    gross_royalty_ex_tax: gross,
    mg_amount: mgAmount,
    mg_consumed_before: consumedToDate,
    mg_consumed_this_time: mg.mg_consumed_this_time,
    mg_consumed_after: consumedToDate + mg.mg_consumed_this_time,
    mg_remaining: mg.mg_remaining_after,
    mg_fully_consumed: mg.mg_fully_consumed,
    actual_royalty_ex_tax: mg.actual_royalty,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total_payment_inc_tax: amountIncTax,
    currency,
  };
}

/**
 * ライセンス契約の MG ステータス (総額・累積消化・残額) を返す。
 * Admin UI のヘッダや warning バナーで使う想定。
 */
export async function getLicenseMgStatus(
  licenseContractId: number
): Promise<
  Array<{
    condition_no: number;
    condition_id: number;
    mg_amount: number;
    consumed_total: number;
    remaining: number;
    fully_consumed: boolean;
  }>
> {
  const conds = await query(
    `SELECT id, condition_no, mg_amount
       FROM license_financial_conditions
      WHERE license_contract_id = $1
      ORDER BY condition_no ASC`,
    [licenseContractId]
  );

  const results: Array<any> = [];
  for (const c of conds.rows) {
    const consumed = await getMgConsumedToDate(licenseContractId, Number(c.id));
    const mgAmount = Number(c.mg_amount) || 0;
    const remaining = Math.max(0, mgAmount - consumed);
    results.push({
      condition_no: Number(c.condition_no),
      condition_id: Number(c.id),
      mg_amount: mgAmount,
      consumed_total: consumed,
      remaining,
      fully_consumed: mgAmount > 0 && consumed >= mgAmount,
    });
  }
  return results;
}
